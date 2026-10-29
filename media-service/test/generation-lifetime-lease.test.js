'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process'), { once } = require('node:events');
const { acquireGenerationLease } = require('../src/clean-generation-lease');

test('a live Supervisor excludes another process; an actual killed process releases the lifetime lease', async t => {
  const dataDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'generation-lifetime-')));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const code = `const {acquireGenerationLease}=require(${JSON.stringify(require.resolve('../src/clean-generation-lease'))});
    const lease=acquireGenerationLease({dataDir:process.argv[1]});process.send({ready:true});setInterval(()=>lease.assertHeld(),1000);`;
  const child = spawn(process.execPath, ['-e', code, dataDir], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const close = once(child, 'close'), timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const [message] = await Promise.race([once(child, 'message'), close.then(() => { throw Error('child exited before taking lease'); })]);
    assert.equal(message.ready, true);
    assert.throws(() => acquireGenerationLease({ dataDir }), { code: 'RESET_SUPERVISOR_ALREADY_ACTIVE' });
    child.kill('SIGKILL'); await close;
    const recovered = acquireGenerationLease({ dataDir });
    try { recovered.assertHeld(); assert.equal(fs.existsSync(path.join(dataDir, 'shelfdeck.db')), false); }
    finally { recovered.close(); }
    assert.throws(recovered.assertHeld, { code: 'RESET_LIFETIME_NOT_HELD' });
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await close; }
});
