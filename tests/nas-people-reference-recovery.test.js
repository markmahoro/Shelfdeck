'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { canonicalDigest } = require('../media-service/src/helix/contracts/canonical-json');
const { recoveryScope, prepareNasPeopleReferenceRecovery } = require('../scripts/nas-people-reference-recovery');
const { parseArgs, composeYaml } = require('../scripts/deploy-nas');
const configuration = { schema: 'shelfdeck.reset-configuration@1', operationRoot: '/operator-backups/job/operations',
  backupParent: '/operator-backups/job/archives', backupSourceOptions: { roots: [{ id: 'data', path: '/app/data' }, { id: 'workspace', path: '/transcode' }] },
  storage: { roots: ['/transcode'], protectedDirectories: ['/media'] } };
const scope = { schema: 'shelfdeck.people-reference-recovery@1', resetGeneration: 'a'.repeat(64), originalSourceDigest: 'b'.repeat(64),
  expectedCount: 18, expectedHandlesDigest: 'c'.repeat(64), expectedReferenceDigest: 'd'.repeat(64),
  originalManifestFile: '/operator-backups/original/manifest.json', originalBackupRoot: '/operator-backups/original/archive' };
const closure = { schema: 'shelfdeck.deployment-closure@1', oldContainerRemoved: true, oldContainerId: 'e'.repeat(64) };

test('dependency recovery is an explicit deployment action and retains Reset config without requesting another Bootstrap', () => {
  const args = ['shelfdeck-candidate.tar', '--sha256', '1'.repeat(64), '--capacity-plan', 'capacity.json',
    '--fresh-reset-config', 'job.json', '--recover-people-references', 'scope.json'];
  assert.equal(parseArgs(args).peopleRecoveryFile, 'scope.json');
  assert.equal(parseArgs([...args, '--continue-people-reference-recovery']).continuePeopleRecovery, true);
  for (const bad of [['shelfdeck-candidate.tar', '--continue-people-reference-recovery'],
    ['shelfdeck-candidate.tar', '--recover-people-references', 'scope.json'], [...args, '--continue-fresh-reset']])
    assert.throws(() => parseArgs(bad));
  const yaml = composeYaml('shelfdeck:candidate', configuration, { coldBootstrap: false });
  assert.match(yaml, /SHELFDECK_RESET_CONFIG_FILE=/); assert.doesNotMatch(yaml, /RESET_BOOTSTRAP_FILE/);
  assert.match(yaml, /reset-config.json:\/run\/shelfdeck-reset\/config.json:ro/);
});

test('a recovery scope must name exact source evidence and a bounded missing-handle set', () => {
  assert.deepEqual(recoveryScope(scope), scope);
  for (const patch of [{ expectedCount: 0 }, { expectedCount: 4097 }, { expectedHandlesDigest: '' },
    { originalManifestFile: '/operator-backups/../other/file' }, { originalBackupRoot: '/app/data' }, { extra: true }])
    assert.throws(() => recoveryScope({ ...scope, ...patch }), { code: 'PEOPLE_RECOVERY_SCOPE_INVALID' });
});

test('original recovery archives cannot overlap the new work or backup roots', async () => {
  await assert.rejects(prepareNasPeopleReferenceRecovery({ configuration,
    recoveryScope: { ...scope, originalBackupRoot: configuration.backupParent }, publishConfiguration() {} },
  { prepareStoppedBackup() { assert.fail('Archive overlap must be rejected before production closure.'); } }),
  { code: 'PEOPLE_RECOVERY_ARCHIVE_OVERLAP' });
});

test('standard recovery publishes config only after closed backup, exclusive mounts and a complete matching repair receipt', async () => {
  for (const failure of [null, 'backup', 'before-mount', 'operator', 'receipt', 'after-mount']) {
    const events = []; let inspections = 0;
    const options = { configuration, recoveryScope: scope, dataDir: '/data', transcodeDir: '/workspace', backupHost: '/archives', targetImage: 'shelfdeck:candidate',
      async publishConfiguration() { events.push('publish'); } };
    options.upload = async (_file, contents) => { const request = JSON.parse(contents);
      assert.deepEqual(request.closure, closure); assert.deepEqual(request.scope, scope); events.push('request'); };
    options.execute = async command => {
      if (command === 'docker ps -aq') return 'f'.repeat(64);
      if (command.startsWith('docker inspect ')) {
        inspections++;
        const shared = failure === 'before-mount' && inspections === 1 || failure === 'after-mount' && inspections === 2;
        return JSON.stringify([{ Id: 'f'.repeat(64), Mounts: shared ? [{ Source: '/data' }] : [] }]);
      }
      if (command.includes('node --max-old-space-size=768 scripts/formation-reset-people-recovery-run.js')) {
        events.push('operator'); if (failure === 'operator') throw new Error('injected operator failure');
        return JSON.stringify({ state: 'completed', desiredMode: 'stopped', databaseGeneration: scope.resetGeneration,
          recoveredCount: failure === 'receipt' ? 17 : 18, proofDigest: '1'.repeat(64), receiptDigest: '2'.repeat(64) });
      }
      return '';
    };
    const action = prepareNasPeopleReferenceRecovery(options, { async prepareStoppedBackup() {
      events.push('backup'); if (failure === 'backup') throw new Error('injected backup failure'); return { closure };
    } });
    if (failure) { await assert.rejects(action); assert.equal(events.includes('publish'), false); }
    else { const result = await action; assert.deepEqual(events, ['backup', 'request', 'operator', 'publish']);
      assert.equal(result.closureDigest, canonicalDigest(closure)); }
  }
});

test('interrupted recovery continues its original proof instead of inventing another Stop or clearing new work', async () => {
  const events = [], request = { schema: 'shelfdeck.people-reference-recovery-request@1', dataDir: '/app/data',
    operationRoot: configuration.operationRoot, deploymentBackupReceiptFile: configuration.operationRoot + '/deployment-backup-receipt.json', closure, scope };
  const result = await prepareNasPeopleReferenceRecovery({ configuration, recoveryScope: scope, continueRecovery: true,
    dataDir: '/data', transcodeDir: '/workspace', backupHost: '/archives', targetImage: 'shelfdeck:candidate',
    async publishConfiguration() { events.push('publish'); }, async upload() { assert.fail('Continuation cannot replace its original request.'); },
    async execute(command) {
      if (command.startsWith('cat ')) return JSON.stringify(request);
      if (command === 'docker ps -aq') return '';
      if (command.includes('scripts/formation-reset-people-recovery-run.js')) { events.push('operator');
        return JSON.stringify({ state: 'completed', desiredMode: 'stopped', databaseGeneration: scope.resetGeneration,
          recoveredCount: 18, proofDigest: '1'.repeat(64), receiptDigest: '2'.repeat(64) }); }
      return '';
    } }, { async prepareStoppedBackup() { assert.fail('Continuation cannot fabricate a new closure.'); } });
  assert.equal(result.recoveredCount, 18); assert.deepEqual(events, ['operator', 'publish']);
});
