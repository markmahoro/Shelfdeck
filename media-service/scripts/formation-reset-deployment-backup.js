'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { writeAtomic } = require('../src/clean-runtime-operations');
const { fileDigest } = require('./formation-reset-generation');
const { inventoryBackupSources, createVerifiedBackup } = require('./formation-reset-backup');
function fail(code = 'RESET_DEPLOY_BACKUP_INVALID') { throw Object.assign(new Error(code), { code }); }
function real(value, directory = true) {
  if (!path.isAbsolute(value) || path.resolve(value) === path.parse(value).root) fail();
  const stat = fs.lstatSync(value);
  if (stat.isSymbolicLink() || fs.realpathSync.native(value) !== value || (directory ? !stat.isDirectory() : !stat.isFile())) fail();
}

// An independent cold deployment backup precedes publishing any new Compose,
// secret or management configuration. This is not the later Reset backup.
async function createDeploymentBackup({ dataDir, sourceOptions, configFiles, operationRoot, backupParent, closure,
  reserveBytes, checkpoint }) {
  for (const directory of [dataDir, operationRoot, backupParent]) real(directory);
  if (closure?.schema !== 'shelfdeck.deployment-closure@1' || closure.oldContainerRemoved !== true ||
      !/^[a-f0-9]{64}$/.test(closure.stopOperationId || '') ||
      !Array.isArray(sourceOptions?.roots) || !sourceOptions.roots.some(root => root.path === dataDir) ||
      !Array.isArray(configFiles) || configFiles.length < 2 ||
      configFiles.some(row => !/^[a-zA-Z0-9_.-]+$/.test(row.name)) ||
      new Set(configFiles.map(row => row.name)).size !== configFiles.length) fail();
  const configRoot = path.join(operationRoot, 'original-deployment-config');
  const read = file => { real(file, false); return JSON.parse(fs.readFileSync(file, 'utf8')); };
  const assertStopped = () => {
    const intent = read(path.join(dataDir, 'operator-runtime', 'intent.json'));
    const stop = read(path.join(dataDir, 'operator-runtime', closure.stopOperationId + '.json'));
    if (intent.desiredMode !== 'stopped' || intent.pendingReset || intent.revision !== closure.runtimeRevision ||
        canonicalDigest(intent) !== closure.intentDigest || canonicalDigest(stop) !== closure.stopReceiptDigest ||
        stop.state !== 'completed' || stop.kind !== 'stop' || stop.result?.mode !== 'stopped') fail('RESET_DEPLOY_STOP_CHANGED');
  };
  assertStopped();
  const configEvidence = configFiles.map(row => { real(row.path, false); return { ...row, sha256: fileDigest(row.path) }; });
  if (!fs.existsSync(configRoot)) fs.mkdirSync(configRoot, { mode: 0o700 });
  real(configRoot);
  for (const row of configEvidence) {
    const target = path.join(configRoot, row.name);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(row.path, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o600);
      const fd = fs.openSync(target, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    real(target, false);
    if (fileDigest(target) !== row.sha256 || fileDigest(row.path) !== row.sha256) fail('RESET_DEPLOY_CONFIG_CHANGED');
  }
  if (fs.readdirSync(configRoot).sort().join('\n') !== configEvidence.map(row => row.name).sort().join('\n')) fail();
  const sources = { ...sourceOptions, roots: [...sourceOptions.roots, { id: 'deployment-config', path: configRoot }] };
  const manifest = inventoryBackupSources(sources);
  const manifestFile = path.join(operationRoot, 'deployment-backup-manifest.json');
  if (fs.existsSync(manifestFile)) {
    if (canonicalDigest(read(manifestFile)) !== canonicalDigest(manifest)) fail('RESET_DEPLOY_BACKUP_SOURCE_CHANGED');
  } else writeAtomic(manifestFile, manifest);
  const backup = await createVerifiedBackup({ sourceOptions: sources, manifest,
    targetRoot: path.join(backupParent, 'pre-deployment'), assertStopped, reserveBytes, checkpoint });
  assertStopped();
  for (const row of configEvidence) if (fileDigest(row.path) !== row.sha256) fail('RESET_DEPLOY_CONFIG_CHANGED');
  const body = { schema: 'shelfdeck.deployment-backup@1', closureDigest: canonicalDigest(closure),
    configEvidence, manifestFile, backup };
  const receipt = { ...body, receiptDigest: canonicalDigest(body) };
  writeAtomic(path.join(operationRoot, 'deployment-backup-receipt.json'), receipt);
  return receipt;
}

if (require.main === module) {
  Promise.resolve().then(() => {
    const file = process.argv[2]; real(file, false);
    return createDeploymentBackup(JSON.parse(fs.readFileSync(file, 'utf8')));
  }).then(receipt => console.log(JSON.stringify({ receiptDigest: receipt.receiptDigest,
    backupVerificationDigest: receipt.backup.verificationDigest, closureDigest: receipt.closureDigest })))
    .catch(error => { console.error(error.code || 'RESET_DEPLOY_BACKUP_FAILED'); process.exitCode = 1; });
}
module.exports = Object.freeze({ createDeploymentBackup });
