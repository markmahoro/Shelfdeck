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

// The standard deploy controller invokes this only for an explicitly selected
// fresh Reset cutover. Credentials never enter shell text or logged results.
async function prepareNasResetManagement({ execute, upload, readRuntime, publishConfiguration, configuration,
  dataDir, transcodeDir, composeFile, backupHost, secretFile, targetImage }) {
  configuration = configurationForNas(configuration);
  if (typeof publishConfiguration !== 'function' || !path.posix.isAbsolute(transcodeDir || '') ||
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
module.exports = Object.freeze({ configurationForNas, closureProof, prepareNasResetManagement });
