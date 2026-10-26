'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { configurationForNas, closureProof, prepareNasResetManagement, continueNasResetManagement } = require('../scripts/nas-reset-bootstrap');
const { parseArgs, composeYaml } = require('../scripts/deploy-nas');
function facts() {
  const stop = { operationId: 'c'.repeat(64), kind: 'stop', state: 'completed', result: { mode: 'stopped' } };
  return { old: { Id: 'a'.repeat(64), Image: 'sha256:' + 'b'.repeat(64),
    State: { Running: false, Pid: 0, OOMKilled: false, ExitCode: 0 },
    Mounts: [{ Source: '/data', Destination: '/app/data', RW: true }] }, remaining: [], dataDir: '/data', stop,
    intent: { desiredMode: 'stopped', revision: 7, pendingReset: null },
    runtime: { mode: 'stopped', desiredMode: 'stopped', normalSupplyAllowed: false, revision: 7, error: null, operation: stop,
      activity: { state: 'quiesced', inFlightEvents: 0, inFlightPlanning: 0, inFlightRecoveries: 0, inFlightOwnerReconciliations: 0, inFlightAdminCommands: 0 } } };
}
const configuration = { schema: 'shelfdeck.reset-configuration@1', operationRoot: '/operator-backups/job/operations',
  backupParent: '/operator-backups/job/archives', backupSourceOptions: { roots: [
    { id: 'data', path: '/app/data' }, { id: 'workspace', path: '/transcode' }] }, storage: {} };
test('fresh management deploy is explicit and cannot be combined with clean initialization or an unbudgeted deployment', () => {
  const args = ['shelfdeck-candidate.tar', '--fresh-reset-config', 'job.json', '--capacity-plan', 'space.json', '--sha256', 'a'.repeat(64)];
  assert.equal(parseArgs(args).freshResetConfig, 'job.json');
  assert.throws(() => parseArgs([...args, '--helix-clean-init']));
  assert.throws(() => parseArgs(['shelfdeck-candidate.tar', '--fresh-reset-config', 'job.json']));
  assert.throws(() => parseArgs(['shelfdeck-candidate.tar', '--continue-fresh-reset']));
  assert.equal(parseArgs([...args, '--continue-fresh-reset']).continueFreshReset, true);
  const yaml = composeYaml('shelfdeck:test', configuration);
  assert.match(yaml, /SHELFDECK_RESET_BOOTSTRAP_FILE=\/operator-backups\/job\/operations\/deployment-bootstrap.json/);
  assert.match(yaml, /reset-config.json:\/run\/shelfdeck-reset\/config.json:ro/);
  assert.doesNotMatch(composeYaml('shelfdeck:test'), /RESET_BOOTSTRAP/);
});

test('cold continuation reuses the original closure and verified backup, and never stops or invents a new source generation', async () => {
  const { canonicalDigest } = require('../media-service/src/helix/contracts/canonical-json');
  for (const failure of [null, 'receipt', 'configuration', 'old-container', 'shared-mount', 'backup-bytes', 'bootstrap']) {
    const f = facts(), closure = closureProof(f), events = [], files = {};
    const operationHost = '/archives/job/operations';
    const original = { dataDir: '/app/data', sourceOptions: configuration.backupSourceOptions, closure };
    const backupBody = { schema: 'shelfdeck.deployment-backup@1', closureDigest: canonicalDigest(closure),
      manifestFile: configuration.operationRoot + '/deployment-backup-manifest.json',
      backup: { targetRoot: configuration.backupParent + '/pre-deployment', verificationDigest: 'a'.repeat(64) } };
    const backup = { ...backupBody, receiptDigest: canonicalDigest(backupBody) };
    const { schema, ...spec } = { ...configuration, dataDir: '/app/data' };
    const bootstrap = { dataDir: '/app/data', configuration: spec, closure: { ...closure, backupReceiptDigest: backup.receiptDigest },
      outputFile: configuration.operationRoot + '/deployment-bootstrap.json', qualificationPath: configuration.operationRoot + '/first-attempt.db' };
    if (failure === 'receipt') backup.receiptDigest = 'f'.repeat(64);
    if (failure === 'configuration') bootstrap.configuration = { ...spec, operationRoot: '/operator-backups/other' };
    files[operationHost + '/deployment-backup-request.json'] = original;
    files[operationHost + '/deployment-bootstrap-request.json'] = bootstrap;
    files[operationHost + '/deployment-backup-receipt.json'] = backup;
    const action = continueNasResetManagement({ configuration, dataDir: '/data', transcodeDir: '/workspace',
      backupHost: '/archives', secretFile: '/secret.env', targetImage: 'shelfdeck:fixed',
      publishConfiguration: async () => events.push('publish'),
      upload: async (file, content) => { events.push('request'); files[file] = JSON.parse(content); },
      execute: async command => {
        assert.doesNotMatch(command, /docker (?:stop|rm|exec)/);
        if (command.startsWith('test -f ')) {
          const file = Object.keys(files).find(file => command.endsWith("cat '" + file + "'"));
          assert.ok(file, command); return JSON.stringify(files[file]);
        }
        if (command === 'docker ps -aq') return ['old-container', 'shared-mount'].includes(failure) ? 'd'.repeat(64) : '';
        if (command.startsWith('docker inspect ')) return JSON.stringify([failure === 'old-container' ? f.old :
          { Id: 'd'.repeat(64), Mounts: [{ Source: '/workspace/active', Destination: '/other' }] }]);
        if (command.includes('verifyBackupFiles')) {
          events.push('verify-backup'); assert.equal(events.includes('publish'), false);
          if (failure === 'backup-bytes') throw Error('backup changed');
          return JSON.stringify({ receiptDigest: backup.receiptDigest });
        }
        if (command.includes('node scripts/formation-reset-bootstrap.js')) {
          events.push('bootstrap'); assert.match(command, /\/data:\/app\/data:ro/);
          assert.equal(events.includes('publish'), false);
          const continuation = files[operationHost + '/deployment-bootstrap-continuation-request.json'];
          assert.deepEqual(continuation.closure, bootstrap.closure);
          assert.equal(continuation.outputFile, bootstrap.outputFile);
          assert.notEqual(continuation.qualificationPath, bootstrap.qualificationPath);
          if (failure === 'bootstrap') throw Error('source changed');
        }
        return '';
      } });
    if (failure) { await assert.rejects(action); assert.equal(events.includes('publish'), false); }
    else { await action; assert.deepEqual(events, ['verify-backup', 'request', 'bootstrap', 'publish']); }
  }
});
test('only a completed safe Stop plus successful removal and exclusive data mounts is a deployment closure proof', () => {
  const f = facts(), proof = closureProof(f);
  assert.equal(proof.oldContainerRemoved, true); assert.equal(proof.stopOperationId, f.stop.operationId);
  for (const patch of [{ Running: true }, { Pid: 12 }, { ExitCode: 137 }, { OOMKilled: true }])
    assert.throws(() => closureProof({ ...f, old: { ...f.old, State: { ...f.old.State, ...patch } } }), { code: 'RESET_DEPLOY_EXIT_UNPROVEN' });
  assert.throws(() => closureProof({ ...f, runtime: { ...f.runtime, activity: { ...f.runtime.activity, inFlightEvents: 1 } } }), { code: 'RESET_DEPLOY_STOP_UNPROVEN' });
  assert.throws(() => closureProof({ ...f, intent: { ...f.intent, revision: 8 } }), { code: 'RESET_DEPLOY_STOP_UNPROVEN' });
  assert.throws(() => closureProof({ ...f, remaining: [f.old] }), { code: 'RESET_DEPLOY_REMOVAL_UNPROVEN' });
  for (const Source of ['/', '/data', '/data/diagnostics']) assert.throws(() => closureProof({ ...f,
    remaining: [{ Id: 'd'.repeat(64), State: { Running: false }, Mounts: [{ Source, Destination: '/other' }] }] }), { code: 'RESET_DEPLOY_DATA_MOUNT_SHARED' });
});
test('NAS work and backup roots must remain explicit disjoint paths on the declared volume', () => {
  assert.deepEqual(configurationForNas(configuration), configuration);
  for (const operationRoot of ['/app/data/job', '/operator-backups/../data', '/operator-backups//job', '/operator-backups/', configuration.backupParent])
    assert.throws(() => configurationForNas({ ...configuration, operationRoot }));
});
test('deployment preparation cannot stop a container when Runtime Stop is absent', async () => {
  let touched = false;
  await assert.rejects(prepareNasResetManagement({ configuration, readRuntime: async () => ({ mode: 'running' }),
    transcodeDir: '/workspace', composeFile: '/app/docker-compose.yml', publishConfiguration() { touched = true; },
    execute() { touched = true; }, upload() { touched = true; } }), { code: 'RESET_DEPLOY_STOP_UNPROVEN' });
  assert.equal(touched, false);
});

test('fresh deployment publishes configuration only after cold full-backup verification; backup failure leaves it untouched', async () => {
  for (const backupFails of [false, true]) {
    const f = facts(), events = []; let backupRequest, removed = false;
    const action = prepareNasResetManagement({ configuration, dataDir: '/data', transcodeDir: '/workspace',
      composeFile: '/app/docker-compose.yml', secretFile: '/app/secret.env', backupHost: '/archives', targetImage: 'shelfdeck:test',
      readRuntime: async () => f.runtime,
      publishConfiguration: async () => events.push('publish'),
      upload: async (file, contents) => { if (file.endsWith('deployment-backup-request.json')) backupRequest = JSON.parse(contents); },
      execute: async command => {
        if (command === 'docker inspect shelfdeck' || command === `docker inspect '${f.old.Id}'`) return JSON.stringify([f.old]);
        if (command.startsWith('docker exec')) return JSON.stringify({ intent: f.intent, stop: f.stop });
        if (command === 'docker ps -aq') return removed ? '' : f.old.Id;
        if (command.startsWith('docker stop')) { events.push('stop'); return ''; }
        if (command.startsWith('docker rm')) { removed = true; events.push('remove'); return ''; }
        if (command.includes('node scripts/formation-reset-deployment-backup.js')) {
          events.push('backup'); assert.equal(events.includes('publish'), false);
          assert.match(command, /\/data:\/app\/data:ro/); assert.match(command, /\/workspace:\/transcode:ro/);
          assert.equal(backupRequest.configFiles.length, 2);
          if (backupFails) throw Error('backup failed');
          return JSON.stringify({ closureDigest: require('../media-service/src/helix/contracts/canonical-json').canonicalDigest(backupRequest.closure),
            receiptDigest: 'c'.repeat(64), backupVerificationDigest: 'd'.repeat(64) });
        }
        if (command.includes('node scripts/formation-reset-bootstrap.js')) events.push('bootstrap');
        return '';
      } });
    if (backupFails) { await assert.rejects(action, /backup failed/); assert.deepEqual(events, ['stop','remove','backup']); }
    else { await action; assert.deepEqual(events, ['stop','remove','backup','publish','bootstrap']); }
  }
});
