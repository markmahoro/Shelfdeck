'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { canonicalDigest: D } = require('../../src/helix/contracts/canonical-json');
const { proveLegacyPeriodicAcquisition: prove } = require('../../src/helix/domains/perception/model/legacy-acquisition-origin');
function fixture(previousId = 'prior') {
  const scope = { mode: 'provider', collection: 'watched_movies', sourceId: 'source',
    acquisitionWindow: { kind: 'full_snapshot', openedAtMs: 8 } };
  const acquisition = { perceptionAcquisitionId: 'perception-douban-acquisition-' + D({ sourceId: 'source',
    idempotencyKey: 'periodic-douban-acquisition:source:config-2:after-' + (previousId || 'none') }).slice(0, 40),
    perceptionSourceId: 'source', sourceConfigRevision: 2, scopeJson: JSON.stringify(scope), scopeDigest: D(scope), createdAtMs: 10 };
  const history = previousId ? [{ perceptionAcquisitionId: previousId, perceptionSourceId: 'source', state: 'completed', terminalAtMs: 7 }] : [];
  return { acquisition, history, scope };
}
test('old periodic request identity proves its source without rewriting immutable Scope or cursor', () => {
  for (const previous of [null, 'prior']) {
    const f = fixture(previous), before = JSON.stringify(f);
    assert.deepEqual(prove(f.acquisition, f.history), { executionOrigin: 'periodic', scopeDigest: f.acquisition.scopeDigest,
      previousAcquisitionId: previous });
    assert.equal(JSON.stringify(f), before);
  }
});
for (const [name, change] of [
  ['manual identity', f => { f.acquisition.perceptionAcquisitionId = 'manual'; }],
  ['foreign source', f => { f.acquisition.perceptionSourceId = 'foreign'; }],
  ['other config', f => { f.acquisition.sourceConfigRevision++; }],
  ['changed digest', f => { f.acquisition.scopeDigest = D('changed'); }],
  ['missing predecessor', f => { f.history = []; }],
  ['future predecessor', f => { f.history[0].terminalAtMs = 11; }],
  ['active predecessor', f => { f.history[0].state = 'active'; }],
  ['ambiguous proof', f => { f.history.push({ ...f.history[0] }); }],
  ['new invalid origin', f => { f.scope.executionOrigin = 'unknown'; f.acquisition.scopeJson = JSON.stringify(f.scope); f.acquisition.scopeDigest = D(f.scope); }],
  ['other collection', f => { f.scope.collection = 'other'; f.acquisition.scopeJson = JSON.stringify(f.scope); f.acquisition.scopeDigest = D(f.scope); }],
]) test('legacy origin does not guess from ' + name, () => {
  const f = fixture(); change(f); assert.equal(prove(f.acquisition, f.history), null);
});
