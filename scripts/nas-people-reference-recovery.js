'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../media-service/src/helix/contracts/canonical-json');
const { configurationForNas, prepareNasStoppedBackup } = require('./nas-reset-bootstrap');
const q = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function fail(code) { throw Object.assign(new Error(code), { code }); }
function recoveryScope(value) {
  if (value?.schema !== 'shelfdeck.people-reference-recovery@1' ||
      Object.keys(value).sort().join(',') !== 'expectedCount,expectedHandlesDigest,expectedReferenceDigest,originalBackupRoot,originalManifestFile,originalSourceDigest,resetGeneration,schema' ||
      !['resetGeneration', 'originalSourceDigest', 'expectedHandlesDigest', 'expectedReferenceDigest'].every(key => /^[a-f0-9]{64}$/.test(value[key] || '')) ||
      !Number.isSafeInteger(value.expectedCount) || value.expectedCount < 1 || value.expectedCount > 4096)
    fail('PEOPLE_RECOVERY_SCOPE_INVALID');
  for (const key of ['originalBackupRoot', 'originalManifestFile']) if (!/^\/operator-backups\/[a-zA-Z0-9_./-]+$/.test(value[key] || '') ||
    path.posix.normalize(value[key]) !== value[key] || value[key].endsWith('/')) fail('PEOPLE_RECOVERY_SCOPE_INVALID');
  return JSON.parse(JSON.stringify(value));
}
async function prepareNasPeopleReferenceRecovery(options, { prepareStoppedBackup = prepareNasStoppedBackup } = {}) {
  const { execute, upload, publishConfiguration, dataDir, transcodeDir, backupHost, targetImage, continueRecovery } = options;
  const configuration = configurationForNas(options.configuration), scope = recoveryScope(options.recoveryScope);
  if (typeof publishConfiguration !== 'function') fail('PEOPLE_RECOVERY_CONFIGURATION_REQUIRED');
  const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
  if ([configuration.operationRoot, configuration.backupParent].some(directory =>
    overlaps(directory, scope.originalBackupRoot) || overlaps(directory, path.posix.dirname(scope.originalManifestFile))))
    fail('PEOPLE_RECOVERY_ARCHIVE_OVERLAP');
  const translate = directory => backupHost + directory.slice('/operator-backups'.length);
  const operationHost = translate(configuration.operationRoot), requestFile = configuration.operationRoot + '/people-reference-recovery-request.json';
  for (const directory of [operationHost, translate(configuration.backupParent)])
    await execute(`test -d ${q(directory)} && test ! -L ${q(directory)} && test "$(readlink -f ${q(directory)})" = ${q(directory)}`);
  let closure;
  if (continueRecovery) {
    const previous = JSON.parse(await execute('cat ' + q(translate(requestFile))));
    if (previous.schema !== 'shelfdeck.people-reference-recovery-request@1' || previous.dataDir !== '/app/data' ||
        previous.operationRoot !== configuration.operationRoot || canonicalDigest(previous.scope) !== canonicalDigest(scope) ||
        previous.deploymentBackupReceiptFile !== configuration.operationRoot + '/deployment-backup-receipt.json' ||
        previous.closure?.oldContainerRemoved !== true || !/^[a-f0-9]{64}$/.test(previous.closure.oldContainerId || ''))
      fail('PEOPLE_RECOVERY_CONTINUATION_CHANGED');
    closure = previous.closure;
  } else {
    const prepared = await prepareStoppedBackup(options);
    closure = prepared.closure;
    const request = { schema: 'shelfdeck.people-reference-recovery-request@1', dataDir: '/app/data',
      operationRoot: configuration.operationRoot, closure, scope,
      deploymentBackupReceiptFile: configuration.operationRoot + '/deployment-backup-receipt.json' };
    await execute(`test ! -e ${q(translate(requestFile))}`);
    await upload(translate(requestFile), JSON.stringify(request));
  }
  async function exclusive() {
    const ids = (await execute('docker ps -aq')).trim().split(/\s+/).filter(Boolean);
    if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) fail('PEOPLE_RECOVERY_CONTAINER_INVALID');
    const containers = ids.length ? JSON.parse(await execute('docker inspect ' + ids.map(q).join(' '))) : [];
    const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
    if (containers.some(container => container.Id === closure.oldContainerId || (container.Mounts || []).some(mount =>
      overlaps(mount.Source, dataDir) || overlaps(mount.Source, transcodeDir)))) fail('PEOPLE_RECOVERY_DATA_MOUNT_SHARED');
  }
  await exclusive();
  const result = JSON.parse(await execute(['docker run --rm --network none --read-only --cpus 1 --memory 1536m --memory-swap 1536m',
    '--tmpfs /tmp:rw,nosuid,size=64m', `-v ${q(dataDir + ':/app/data')}`, `-v ${q(backupHost + ':/operator-backups')}`,
    `--mount ${q('type=bind,source=' + translate(scope.originalBackupRoot) + ',target=' + scope.originalBackupRoot + ',readonly')}`,
    `--mount ${q('type=bind,source=' + translate(scope.originalManifestFile) + ',target=' + scope.originalManifestFile + ',readonly')}`,
    q(targetImage), 'node --max-old-space-size=768 scripts/formation-reset-people-recovery-run.js', q(requestFile)].join(' ')));
  if (result.state !== 'completed' || result.desiredMode !== 'stopped' || result.databaseGeneration !== scope.resetGeneration ||
      result.recoveredCount !== scope.expectedCount || !/^[a-f0-9]{64}$/.test(result.receiptDigest || '') ||
      !/^[a-f0-9]{64}$/.test(result.proofDigest || '')) fail('PEOPLE_RECOVERY_NOT_COMPLETED');
  await exclusive();
  await publishConfiguration();
  return { ...result, closureDigest: canonicalDigest(closure) };
}
module.exports = Object.freeze({ recoveryScope, prepareNasPeopleReferenceRecovery });
