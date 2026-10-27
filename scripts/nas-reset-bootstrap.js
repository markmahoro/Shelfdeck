'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../media-service/src/helix/contracts/canonical-json');
function fail(code) { throw Object.assign(new Error(code), { code }); }
const q = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
function overlaps(a, b) { return a === '/' || b === '/' || a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); }
function configurationForNas(value) {
  if (value?.schema !== 'shelfdeck.reset-configuration@1' ||
      Object.keys(value).some(key => !['schema','operationRoot','backupParent','backupSourceOptions','storage'].includes(key))) fail('RESET_CONFIGURATION_INVALID');
  for (const directory of [value.operationRoot, value.backupParent]) {
    if (typeof directory !== 'string' || !/^\/operator-backups\/[a-zA-Z0-9_/-]+$/.test(directory) ||
        directory.endsWith('/') || path.posix.normalize(directory) !== directory) fail('RESET_DEPLOY_VOLUME_INVALID');
  }
  if (overlaps(value.operationRoot, value.backupParent)) fail('RESET_PREFLIGHT_ARCHIVE_OVERLAP');
  return { ...value };
}
function assertStopped({ runtime, intent, stop }) {
  if (runtime?.mode !== 'stopped' || runtime.desiredMode !== 'stopped' || runtime.normalSupplyAllowed !== false || runtime.error ||
      runtime.activity?.state !== 'quiesced' || Object.entries(runtime.activity).some(([key, value]) => key.startsWith('inFlight') && value !== 0) ||
      runtime.operation?.kind !== 'stop' || runtime.operation.state !== 'completed' ||
      intent?.desiredMode !== 'stopped' || intent.pendingReset || intent.revision !== runtime.revision ||
      stop?.operationId !== runtime.operation.operationId || stop.kind !== 'stop' || stop.state !== 'completed' || stop.result?.mode !== 'stopped')
    fail('RESET_DEPLOY_STOP_UNPROVEN');
}
function closureProof({ old, remaining, runtime, intent, stop, dataDir }) {
  assertStopped({ runtime, intent, stop });
  if (!old || !/^[a-f0-9]{64}$/.test(old.Id || '') || !/^sha256:[a-f0-9]{64}$/.test(old.Image || '') ||
      old.State?.Running !== false || old.State.Pid !== 0 || old.State.OOMKilled !== false || old.State.ExitCode !== 0 ||
      !old.Mounts?.some(m => m.Source === dataDir && m.Destination === '/app/data' && m.RW === true)) fail('RESET_DEPLOY_EXIT_UNPROVEN');
  if (!Array.isArray(remaining) || remaining.some(c => c.Id === old.Id)) fail('RESET_DEPLOY_REMOVAL_UNPROVEN');
  const mounts = remaining.flatMap(c => (c.Mounts || []).filter(m => overlaps(m.Source, dataDir)).map(m => ({ containerId: c.Id, source: m.Source, destination: m.Destination })));
  if (mounts.length) fail('RESET_DEPLOY_DATA_MOUNT_SHARED');
  return { schema: 'shelfdeck.deployment-closure@1', oldContainerId: old.Id, oldImageId: old.Image,
    oldContainerRemoved: true, remainingDataMounts: mounts, inventoryDigest: canonicalDigest(remaining.map(c => ({ id: c.Id, state: c.State, mounts: c.Mounts }))),
    closedAt: new Date().toISOString(), runtimeRevision: intent.revision, intentDigest: canonicalDigest(intent),
    stopOperationId: stop.operationId, stopReceiptDigest: canonicalDigest(stop) };
}

// Shared closed-generation backup for explicit Reset or dependency recovery.
// Credentials never enter shell text or logged results.
async function prepareNasStoppedBackup({ execute, upload, readRuntime, configuration,
  dataDir, transcodeDir, composeFile, backupHost, secretFile, targetImage }) {
  configuration = configurationForNas(configuration);
  if (!path.posix.isAbsolute(transcodeDir || '') ||
      !path.posix.isAbsolute(composeFile || '')) fail('RESET_DEPLOY_BACKUP_CONFIGURATION_REQUIRED');
  if (!Array.isArray(configuration.backupSourceOptions?.roots) ||
      configuration.backupSourceOptions.roots.map(root => root.path).sort().join(',') !== '/app/data,/transcode')
    fail('RESET_DEPLOY_BACKUP_CONFIGURATION_REQUIRED');
  const runtime = await readRuntime();
  if (runtime?.mode !== 'stopped' || runtime.operation?.kind !== 'stop' || runtime.operation.state !== 'completed') fail('RESET_DEPLOY_STOP_UNPROVEN');
  const original = JSON.parse(await execute('docker inspect shelfdeck'))[0];
  if (!/^[a-f0-9]{64}$/.test(original?.Id || '') || !original.Mounts?.some(m => m.Source === dataDir && m.Destination === '/app/data' && m.RW === true))
    fail('RESET_DEPLOY_CONTAINER_INVALID');
  await execute(`test -d ${q(dataDir)} && test "$(readlink -f ${q(dataDir)})" = ${q(dataDir)}`);
  // Read only the exact Runtime records while the old process still exists.
  const script = `const fs=require('fs'),p='/app/data/operator-runtime/';const intent=JSON.parse(fs.readFileSync(p+'intent.json','utf8'));const stop=JSON.parse(fs.readFileSync(p+${JSON.stringify(runtime.operation.operationId)}+'.json','utf8'));console.log(JSON.stringify({intent,stop}));`;
  const records = JSON.parse(await execute(`docker exec ${q(original.Id)} node -e ${q(script)}`));
  // Reject before stopping a container when its Runtime did not complete Stop.
  assertStopped({ runtime, ...records });
  const translate = directory => backupHost + directory.slice('/operator-backups'.length);
  const operationHost = translate(configuration.operationRoot), backupParentHost = translate(configuration.backupParent);
  for (const directory of [operationHost, backupParentHost])
    await execute(`test -d ${q(directory)} && test "$(readlink -f ${q(directory)})" = ${q(directory)}`);
  async function inventory() {
    const ids = (await execute('docker ps -aq')).trim().split(/\s+/).filter(Boolean);
    if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) fail('RESET_DEPLOY_CONTAINER_INVALID');
    return ids.length ? JSON.parse(await execute('docker inspect ' + ids.map(q).join(' '))) : [];
  }
  if ((await inventory()).some(c => c.Id !== original.Id && (c.Mounts || []).some(m =>
    overlaps(m.Source, dataDir) || overlaps(m.Source, transcodeDir)))) fail('RESET_DEPLOY_DATA_MOUNT_SHARED');
  await execute(`docker stop --time 75 ${q(original.Id)}`);
  const exited = JSON.parse(await execute(`docker inspect ${q(original.Id)}`))[0];
  closureProof({ old: exited, remaining: [], runtime, ...records, dataDir });
  await execute(`docker rm ${q(original.Id)}`);
  const remaining = await inventory();
  if (remaining.some(c => (c.Mounts || []).some(m => overlaps(m.Source, transcodeDir)))) fail('RESET_DEPLOY_DATA_MOUNT_SHARED');
  const closure = closureProof({ old: exited, remaining, runtime, ...records, dataDir });
  const configFiles = [{ name: 'docker-compose.yml', path: composeFile }, { name: 'secret.env', path: secretFile }];
  const previousResetConfig = path.posix.join(path.posix.dirname(composeFile), 'reset-config.json');
  if ((await execute(`if [ -e ${q(previousResetConfig)} ] || [ -L ${q(previousResetConfig)} ]; then printf present; fi`)) === 'present')
    configFiles.push({ name: 'reset-config.json', path: previousResetConfig });
  for (const file of configFiles) await execute(`test -f ${q(file.path)} && test ! -L ${q(file.path)} && test "$(readlink -f ${q(file.path)})" = ${q(file.path)}`);
  const backupRequest = { dataDir: '/app/data', sourceOptions: configuration.backupSourceOptions,
    configFiles: configFiles.map(file => ({ name: file.name, path: '/deployment-original/' + file.name })),
    operationRoot: configuration.operationRoot, backupParent: configuration.backupParent, closure };
  const backupRequestHost = operationHost + '/deployment-backup-request.json';
  await execute(`test ! -e ${q(backupRequestHost)}`);
  await upload(backupRequestHost, JSON.stringify(backupRequest));
  const backup = JSON.parse(await execute(['docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=64m',
    `-v ${q(dataDir + ':/app/data:ro')}`, `-v ${q(transcodeDir + ':/transcode:ro')}`,
    `-v ${q(backupHost + ':/operator-backups')}`,
    ...configFiles.map(file => `--mount ${q('type=bind,source=' + file.path + ',target=/deployment-original/' + file.name + ',readonly')}`),
    q(targetImage), 'node scripts/formation-reset-deployment-backup.js',
    q(configuration.operationRoot + '/deployment-backup-request.json')].join(' ')));
  if (backup.closureDigest !== canonicalDigest(closure) || !/^[a-f0-9]{64}$/.test(backup.receiptDigest || '') ||
      !/^[a-f0-9]{64}$/.test(backup.backupVerificationDigest || '')) fail('RESET_DEPLOY_BACKUP_UNVERIFIED');
  return { closure, backup, configuration, operationHost, backupParentHost, translate };
}
async function prepareNasResetManagement(options) {
  const { publishConfiguration, execute, upload, dataDir, backupHost, secretFile, targetImage } = options;
  if (typeof publishConfiguration !== 'function') fail('RESET_DEPLOY_BACKUP_CONFIGURATION_REQUIRED');
  const { closure, backup, configuration, operationHost, backupParentHost, translate } = await prepareNasStoppedBackup(options);
  // No new configuration is published until the entire stopped generation and
  // original configuration have an independently verified recovery baseline.
  await publishConfiguration();
  closure.backupReceiptDigest = backup.receiptDigest;
  const spec = { ...configuration, dataDir: '/app/data' }; delete spec.schema;
  const outputFile = configuration.operationRoot + '/deployment-bootstrap.json';
  const request = { dataDir: '/app/data', configuration: spec, closure, outputFile,
    qualificationPath: configuration.operationRoot + '/deployment-schema-qualification.db' };
  // The complete tree must already have been reviewed and created during the
  // capacity preparation stage; no guessed directories or recursive mkdir.
  for (const directory of [operationHost, backupParentHost])
    await execute(`test -d ${q(directory)} && test "$(readlink -f ${q(directory)})" = ${q(directory)}`);
  const requestHost = operationHost + '/deployment-bootstrap-request.json';
  await execute(`test ! -e ${q(requestHost)} && test ! -e ${q(translate(outputFile))}`);
  await upload(requestHost, JSON.stringify(request));
  await execute(['docker run --rm', `--env-file ${q(secretFile)}`, `-v ${q(dataDir + ':/app/data')}`,
    `-v ${q(backupHost + ':/operator-backups')}`, q(targetImage), 'node scripts/formation-reset-bootstrap.js',
    q(configuration.operationRoot + '/deployment-bootstrap-request.json')].join(' '));
  return { bootstrapFile: outputFile, closureDigest: canonicalDigest(closure), backupReceiptDigest: backup.receiptDigest };
}
// Resume only the pre-management deployment phase from its original durable
// closure and verified backup. Never recreate a Stop proof from current state.
async function continueNasResetManagement({ execute, upload, publishConfiguration, configuration,
  dataDir, transcodeDir, backupHost, secretFile, targetImage }) {
  configuration = configurationForNas(configuration);
  const translate = directory => backupHost + directory.slice('/operator-backups'.length);
  const operationHost = translate(configuration.operationRoot);
  for (const directory of [dataDir, transcodeDir, operationHost, translate(configuration.backupParent)])
    await execute(`test -d ${q(directory)} && test "$(readlink -f ${q(directory)})" = ${q(directory)}`);
  const read = async file => JSON.parse(await execute(`test -f ${q(file)} && test ! -L ${q(file)} && test "$(readlink -f ${q(file)})" = ${q(file)} && cat ${q(file)}`));
  const original = await read(operationHost + '/deployment-backup-request.json');
  const bootstrap = await read(operationHost + '/deployment-bootstrap-request.json');
  const backup = await read(operationHost + '/deployment-backup-receipt.json');
  const { receiptDigest, ...backupBody } = backup;
  const { schema, ...expectedConfiguration } = { ...configuration, dataDir: '/app/data' };
  if (typeof publishConfiguration !== 'function' ||
      original.dataDir !== '/app/data' || original.closure?.schema !== 'shelfdeck.deployment-closure@1' ||
      original.closure.oldContainerRemoved !== true || !/^[a-f0-9]{64}$/.test(original.closure.oldContainerId || '') ||
      canonicalDigest(original.sourceOptions) !== canonicalDigest(configuration.backupSourceOptions) ||
      backupBody.schema !== 'shelfdeck.deployment-backup@1' || canonicalDigest(backupBody) !== receiptDigest ||
      backupBody.closureDigest !== canonicalDigest(original.closure) ||
      !/^[a-f0-9]{64}$/.test(backupBody.backup?.verificationDigest || '') ||
      backupBody.backup.targetRoot !== configuration.backupParent + '/pre-deployment' ||
      backupBody.manifestFile !== configuration.operationRoot + '/deployment-backup-manifest.json' ||
      bootstrap.dataDir !== '/app/data' || canonicalDigest(bootstrap.configuration) !== canonicalDigest(expectedConfiguration) ||
      canonicalDigest(bootstrap.closure) !== canonicalDigest({ ...original.closure, backupReceiptDigest: receiptDigest }) ||
      bootstrap.outputFile !== configuration.operationRoot + '/deployment-bootstrap.json') fail('RESET_DEPLOY_CONTINUATION_UNPROVEN');
  async function exclusive() {
    const ids = (await execute('docker ps -aq')).trim().split(/\s+/).filter(Boolean);
    if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) fail('RESET_DEPLOY_CONTAINER_INVALID');
    const containers = ids.length ? JSON.parse(await execute('docker inspect ' + ids.map(q).join(' '))) : [];
    if (containers.some(c => c.Id === original.closure.oldContainerId)) fail('RESET_DEPLOY_REMOVAL_UNPROVEN');
    if (containers.some(c => (c.Mounts || []).some(m => overlaps(m.Source, dataDir) || overlaps(m.Source, transcodeDir))))
      fail('RESET_DEPLOY_DATA_MOUNT_SHARED');
  }
  await exclusive();
  const verifyBackup = `const fs=require('fs'),{canonicalDigest}=require('./src/helix/contracts/canonical-json'),{verifyBackupFiles}=require('./scripts/formation-reset-backup');const b=JSON.parse(fs.readFileSync(${JSON.stringify(configuration.operationRoot + '/deployment-backup-receipt.json')},'utf8')),m=JSON.parse(fs.readFileSync(b.manifestFile,'utf8'));const verified=verifyBackupFiles({targetRoot:b.backup.targetRoot,manifest:m});if(canonicalDigest({manifest:m,verified})!==b.backup.verificationDigest)throw Error('RESET_DEPLOY_BACKUP_UNVERIFIED');console.log(JSON.stringify({receiptDigest:b.receiptDigest}));`;
  const verified = JSON.parse(await execute(['docker run --rm --network none --read-only',
    `-v ${q(backupHost + ':/operator-backups:ro')}`, q(targetImage), 'node -e', q(verifyBackup)].join(' ')));
  if (verified.receiptDigest !== receiptDigest) fail('RESET_DEPLOY_BACKUP_UNVERIFIED');
  const request = { ...bootstrap, qualificationPath: configuration.operationRoot + '/deployment-schema-continuation.db' };
  const requestHost = operationHost + '/deployment-bootstrap-continuation-request.json';
  const exists = await execute(`if [ -e ${q(requestHost)} ]; then printf present; fi`);
  if (exists === 'present') {
    if (canonicalDigest(await read(requestHost)) !== canonicalDigest(request)) fail('RESET_DEPLOY_CONTINUATION_CHANGED');
  } else await upload(requestHost, JSON.stringify(request));
  // The image revalidates the backed-up main DB, exact current file set,
  // original Stop receipt, schema and credential on its own private copy.
  await execute(['docker run --rm --network none', `--env-file ${q(secretFile)}`,
    `-v ${q(dataDir + ':/app/data:ro')}`, `-v ${q(backupHost + ':/operator-backups')}`,
    q(targetImage), 'node scripts/formation-reset-bootstrap.js',
    q(configuration.operationRoot + '/deployment-bootstrap-continuation-request.json')].join(' '));
  await exclusive();
  await publishConfiguration();
  return { bootstrapFile: bootstrap.outputFile, closureDigest: canonicalDigest(bootstrap.closure), backupReceiptDigest: receiptDigest };
}
module.exports = Object.freeze({ configurationForNas, closureProof, prepareNasStoppedBackup, prepareNasResetManagement, continueNasResetManagement });
