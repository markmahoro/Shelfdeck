'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const Database = require('better-sqlite3');
const { withResetOperatorLease } = require('../scripts/formation-reset-operator-lease');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-lease-')));
  const operationRoot = path.join(root, 'operator'), dataDir = path.join(root, 'data');
  fs.mkdirSync(operationRoot); fs.mkdirSync(dataDir);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { Database, operationRoot, dataDir };
}

test('independent Operator leases reject overlap and release after an exception', async t => {
  const f = fixture(t);
  await assert.rejects(withResetOperatorLease({ ...f, run: async () => {
    await assert.rejects(withResetOperatorLease({ ...f, run() { assert.fail('overlapping write'); } }), { code: 'RESET_OPERATOR_BUSY' });
    throw Object.assign(new Error('interrupted'), { code: 'INJECTED_FAILURE' });
  } }), { code: 'INJECTED_FAILURE' });
  assert.equal(await withResetOperatorLease({ ...f, run: () => 'retry' }), 'retry');
  assert.deepEqual(fs.readdirSync(f.dataDir), [], 'lease does not open or create a business database');
});

test('killing a real lease holder releases the OS lock without deleting a stale lock file', async t => {
  const f = fixture(t);
  const code = `const {withResetOperatorLease}=require(${JSON.stringify(require.resolve('../scripts/formation-reset-operator-lease'))});
    const Database=require(${JSON.stringify(require.resolve('better-sqlite3'))});
    withResetOperatorLease({...JSON.parse(process.argv[1]),Database,run:()=>new Promise(()=>{
      process.send({ready:true}); setInterval(()=>{},1000);
    })}).catch(error=>{process.send({failure:error.code});process.exitCode=1;process.disconnect();});`;
  const child = spawn(process.execPath, ['-e', code, JSON.stringify({ operationRoot: f.operationRoot, dataDir: f.dataDir })],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const [message] = await Promise.race([once(child, 'message'), closed.then(() => { throw Error('lease child exited before readiness'); })]);
    assert.deepEqual(message, { ready: true });
    await assert.rejects(withResetOperatorLease({ ...f, run: () => assert.fail('concurrent child entered') }), { code: 'RESET_OPERATOR_BUSY' });
    child.kill('SIGKILL'); await closed;
    assert.equal(await withResetOperatorLease({ ...f, run: () => 'recovered' }), 'recovered');
    assert.equal(fs.readdirSync(f.operationRoot).filter(name => name.endsWith('.sqlite')).length, 1);
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; }
});

test('another data directory has a different lease and corrupt lease identity fails closed', async t => {
  const f = fixture(t), second = path.join(f.operationRoot, 'other-data'); fs.mkdirSync(second);
  await withResetOperatorLease({ ...f, run: () => withResetOperatorLease({ ...f, dataDir: second, run: () => 'independent' }) });
  const file = fs.readdirSync(f.operationRoot).find(name => name.endsWith('.sqlite'));
  const database = new Database(path.join(f.operationRoot, file));
  const identity = database.prepare('SELECT data_dir FROM operator_identity').get().data_dir;
  database.exec("UPDATE operator_identity SET data_dir='unexpected'"); database.close();
  await assert.rejects(withResetOperatorLease({ ...f, dataDir: identity, run: () => assert.fail('corrupt lease entered') }),
    { code: 'RESET_OPERATOR_LEASE_CORRUPT' });
});
