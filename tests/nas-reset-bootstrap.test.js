'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { configurationForNas, closureProof, prepareNasResetManagement } = require('../scripts/nas-reset-bootstrap');
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
  backupParent: '/operator-backups/job/archives', backupSourceOptions: {}, storage: {} };
test('fresh management deploy is explicit and cannot be combined with clean initialization or an unbudgeted deployment', () => {
  const args = ['shelfdeck-candidate.tar', '--fresh-reset-config', 'job.json', '--capacity-plan', 'space.json', '--sha256', 'a'.repeat(64)];
  assert.equal(parseArgs(args).freshResetConfig, 'job.json');
  assert.throws(() => parseArgs([...args, '--helix-clean-init']));
  assert.throws(() => parseArgs(['shelfdeck-candidate.tar', '--fresh-reset-config', 'job.json']));
  const yaml = composeYaml('shelfdeck:test', configuration);
  assert.match(yaml, /SHELFDECK_RESET_BOOTSTRAP_FILE=\/operator-backups\/job\/operations\/deployment-bootstrap.json/);
  assert.match(yaml, /reset-config.json:\/run\/shelfdeck-reset\/config.json:ro/);
  assert.doesNotMatch(composeYaml('shelfdeck:test'), /RESET_BOOTSTRAP/);
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
    execute() { touched = true; }, upload() { touched = true; } }), { code: 'RESET_DEPLOY_STOP_UNPROVEN' });
  assert.equal(touched, false);
});
