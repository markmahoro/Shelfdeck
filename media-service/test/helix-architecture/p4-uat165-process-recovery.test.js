'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const worker = path.resolve(__dirname, '../fixtures/helix-startup-effect-crash-worker.js');

for (const scenario of ['superseded', 'unknown-old', 'live-unresolved', 'uncertain-material']) {
  test(`UAT-165 actual process restart preserves recovery boundaries: ${scenario}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-uat165-'));
    const database = path.join(root, 'shelfdeck.db');
    function run(operation, expectedCode) {
      const result = spawnSync(process.execPath, [worker, database, operation, scenario], { encoding: 'utf8', timeout: 30000, windowsHide: true });
      assert.equal(result.status, expectedCode, result.stderr || String(result.error));
      return result.stdout ? JSON.parse(result.stdout) : null;
    }
    try {
      run('seed-crash', 95);
      if (scenario === 'superseded') run('recover-crash', 96);
      const first = run('recover', 0);
      const second = run('recover', 0);
      assert.deepEqual(second, first, 'A further process restart must preserve the durable result.');
      const states = Object.fromEntries(first.effects.map(effect => [effect.event_attempt_id, effect.state]));
      if (scenario === 'superseded') {
        assert.equal(first.result.state, 'ready');
        assert.equal(first.result.normalSupplyAllowed, true);
        assert.deepEqual(states, { current: 'failed', old: 'failed' });
      } else if (scenario === 'unknown-old') {
        assert.equal(first.result.state, 'faulted');
        assert.equal(first.result.normalSupplyAllowed, false);
        assert.equal(states.old, 'reconcile_required');
      } else if (scenario === 'live-unresolved') {
        assert.equal(first.result.state, 'recovering');
        assert.equal(first.result.normalSupplyAllowed, false);
        assert.equal(states.current, 'reconcile_required');
        assert.equal(states.old, 'failed');
      } else {
        assert.equal(first.result.state, 'ready');
        assert.equal(states.old, 'reconcile_required', 'Terminal Attempt failure cannot erase uncertain material effects.');
      }
      assert.equal(first.attempts[0].outcome_kind, scenario === 'unknown-old' ? 'deferred' : 'failed');
      assert.equal(first.attempts[1].outcome_kind, 'deferred');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
