'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createDeploymentBackup } = require('../scripts/formation-reset-deployment-backup');
function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-backup-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['data', 'workspace', 'config', 'operations', 'archives']) fs.mkdirSync(path.join(root, name));
  const dataDir = path.join(root, 'data'); fs.mkdirSync(path.join(dataDir, 'operator-runtime'));
  const intent = { desiredMode: 'stopped', revision: 3, pendingReset: null };
  const stop = { operationId: 'a'.repeat(64), kind: 'stop', state: 'completed', result: { mode: 'stopped' } };
  fs.writeFileSync(path.join(dataDir, 'operator-runtime', 'intent.json'), JSON.stringify(intent));
  fs.writeFileSync(path.join(dataDir, 'operator-runtime', stop.operationId + '.json'), JSON.stringify(stop));
  fs.writeFileSync(path.join(dataDir, 'shelfdeck.db'), 'cold original database');
  fs.writeFileSync(path.join(root, 'workspace', 'partial.mp4'), 'interrupted output');
  const configFiles = ['docker-compose.yml', 'secret.env'].map(name => ({ name, path: path.join(root, 'config', name) }));
  for (const row of configFiles) fs.writeFileSync(row.path, 'original ' + row.name);
  return { root, dataDir, operationRoot: path.join(root, 'operations'), backupParent: path.join(root, 'archives'), configFiles,
    sourceOptions: { roots: [{ id: 'data', path: dataDir }, { id: 'workspace', path: path.join(root, 'workspace') }] },
    closure: { schema: 'shelfdeck.deployment-closure@1', oldContainerRemoved: true, runtimeRevision: intent.revision,
      intentDigest: canonicalDigest(intent), stopOperationId: stop.operationId, stopReceiptDigest: canonicalDigest(stop) }, reserveBytes: 0n };
}
test('cold deployment baseline includes original external configuration and interrupted workspace, with exact retry', async t => {
  const f = fixture(t), receipt = await createDeploymentBackup(f);
  assert.equal(receipt.backup.fileCount, 6);
  for (const row of f.configFiles) assert.equal(fs.readFileSync(path.join(receipt.backup.targetRoot, 'deployment-config', row.name), 'utf8'), 'original ' + row.name);
  assert.equal(fs.readFileSync(path.join(receipt.backup.targetRoot, 'workspace', 'partial.mp4'), 'utf8'), 'interrupted output');
  assert.deepEqual(await createDeploymentBackup(f), receipt);
  assert.equal(JSON.stringify(receipt).includes('original secret.env'), false);
});
test('interruption preserves frozen manifest and retries; config drift or loss of Stop blocks the backup', async t => {
  const f = fixture(t);
  await assert.rejects(createDeploymentBackup({ ...f, checkpoint() { throw Error('interrupted'); } }), /interrupted/);
  assert.equal(fs.existsSync(path.join(f.operationRoot, 'deployment-backup-receipt.json')), false);
  await createDeploymentBackup(f);
  fs.writeFileSync(f.configFiles[0].path, 'new config');
  await assert.rejects(createDeploymentBackup(f), { code: 'RESET_DEPLOY_CONFIG_CHANGED' });
  fs.writeFileSync(path.join(f.dataDir, 'operator-runtime', 'intent.json'), '{}');
  await assert.rejects(createDeploymentBackup(f), { code: 'RESET_DEPLOY_STOP_CHANGED' });
});
test('insufficient capacity never creates a successful baseline receipt', async t => {
  const f = fixture(t);
  await assert.rejects(createDeploymentBackup({ ...f, reserveBytes: 2n ** 62n }), { code: 'RESET_BACKUP_SPACE_INSUFFICIENT' });
  assert.equal(fs.existsSync(path.join(f.operationRoot, 'deployment-backup-receipt.json')), false);
});
