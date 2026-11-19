'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createBuffaloSessionPool } = require('../../src/helix/integrations/buffalo-session-pool');

function fakeSessionFactory() {
  const created = [];
  function createSession(settings) {
    let healthy = true;
    let stopped = 0;
    let loads = 0;
    let catalogueLoads = 0;
    let failNextSearch = null;
    const session = {
      settings,
      faceModelRef: { digest: canonicalDigest('model') },
      isHealthy: () => healthy,
      async load() {
        loads += 1;
        return { faceModelRef: session.faceModelRef };
      },
      async loadCatalogue() {
        catalogueLoads += 1;
        return { size: 10 };
      },
      async searchCatalogue() {
        if (failNextSearch) {
          const error = failNextSearch;
          failNextSearch = null;
          throw error;
        }
        return { matches: [] };
      },
      async analyzeEvidence() { return { faces: [] }; },
      async groupFaces() { return []; },
      async renderRepresentative() { return { bytes: Buffer.from([1]), proof: {} }; },
      async stop() {
        healthy = false;
        stopped += 1;
      },
      inspect: () => ({ loads, catalogueLoads, stopped, healthy, setFailNextSearch(err) { failNextSearch = err; } }),
    };
    created.push(session);
    return session;
  }
  return { created, createSession };
}

test('session pool reuses healthy warm sessions across stop() without recreating workers', async () => {
  const { created, createSession } = fakeSessionFactory();
  const pool = createBuffaloSessionPool({ createSession, idleTimeoutMs: 60_000 });
  const settings = { modelRoot: '/models', catalogueRoot: '/catalogue', catalogueGeneration: { generationId: 'g1' }, catalogueSearchPolicy: { queryCount: 16 } };

  const leaseA = pool.acquire(settings);
  await leaseA.load();
  await leaseA.loadCatalogue();
  assert.deepEqual(pool.stats(), { idleCount: 0, activeCount: 1 });
  await leaseA.stop();
  assert.deepEqual(pool.stats(), { idleCount: 1, activeCount: 0 });
  assert.equal(created.length, 1);
  assert.equal(created[0].inspect().stopped, 0);

  await assert.rejects(() => leaseA.searchCatalogue([]), { code: 'BUFFALO_CPU_CLOSED' });

  const leaseB = pool.acquire(settings);
  await leaseB.load();
  await leaseB.searchCatalogue([]);
  assert.equal(created.length, 1);
  await leaseB.stop();

  await pool.close();
  assert.equal(created[0].inspect().stopped, 1);
  assert.deepEqual(pool.stats(), { idleCount: 0, activeCount: 0 });
  assert.throws(() => pool.acquire(settings), { code: 'BUFFALO_CPU_CLOSED' });
});

test('session pool separates model-only and model+catalogue config keys', async () => {
  const { created, createSession } = fakeSessionFactory();
  const pool = createBuffaloSessionPool({ createSession, idleTimeoutMs: 60_000 });

  const modelLease = pool.acquire({ modelRoot: '/models' });
  await modelLease.stop();

  const catalogueLease = pool.acquire({ modelRoot: '/models', catalogueRoot: '/cat' });
  await catalogueLease.stop();

  assert.equal(created.length, 2);
  assert.deepEqual(pool.stats(), { idleCount: 2, activeCount: 0 });

  const reusedModelLease = pool.acquire({ modelRoot: '/models' });
  assert.equal(created.length, 2);
  await reusedModelLease.stop();
  await pool.close();
});

test('session pool evicts tainted sessions on FACE_CATALOGUE_FILES_CHANGED or timeout instead of reusing them', async () => {
  const { created, createSession } = fakeSessionFactory();
  const pool = createBuffaloSessionPool({ createSession, idleTimeoutMs: 60_000 });
  const settings = { modelRoot: '/models', catalogueRoot: '/cat' };

  const lease1 = pool.acquire(settings);
  created[0].inspect().setFailNextSearch(Object.assign(new Error('changed'), { code: 'FACE_CATALOGUE_FILES_CHANGED' }));
  await assert.rejects(() => lease1.searchCatalogue([]), { code: 'FACE_CATALOGUE_FILES_CHANGED' });
  await lease1.stop();
  assert.equal(created[0].inspect().stopped, 1);
  assert.deepEqual(pool.stats(), { idleCount: 0, activeCount: 0 });

  const lease2 = pool.acquire(settings);
  assert.equal(created.length, 2);
  created[1].inspect().setFailNextSearch(Object.assign(new Error('timeout'), { code: 'BUFFALO_CPU_TIMEOUT' }));
  await assert.rejects(() => lease2.searchCatalogue([]), { code: 'BUFFALO_CPU_TIMEOUT' });
  await lease2.stop();
  assert.equal(created[1].inspect().stopped, 1);

  const lease3 = pool.acquire(settings);
  assert.equal(created.length, 3);
  await lease3.stop();
  await pool.close();
});

test('session pool evicts idle sessions after timeout and calls unref() on timers', async () => {
  const { created, createSession } = fakeSessionFactory();
  const scheduled = [];
  let unrefCalls = 0;
  let cleared = 0;
  const pool = createBuffaloSessionPool({
    createSession,
    idleTimeoutMs: 1234,
    setTimer(fn, ms) {
      const handle = {
        fn,
        ms,
        unref() { unrefCalls += 1; },
      };
      scheduled.push(handle);
      return handle;
    },
    clearTimer() { cleared += 1; },
  });

  const lease = pool.acquire({ modelRoot: '/models' });
  await lease.stop();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 1234);
  assert.equal(unrefCalls, 1);
  assert.deepEqual(pool.stats(), { idleCount: 1, activeCount: 0 });

  scheduled[0].fn();
  await Promise.resolve();
  assert.equal(created[0].inspect().stopped, 1);
  assert.deepEqual(pool.stats(), { idleCount: 0, activeCount: 0 });

  const lease2 = pool.acquire({ modelRoot: '/models' });
  await lease2.stop();
  assert.equal(scheduled.length, 2);
  await pool.close();
  assert.equal(cleared, 1);
});
