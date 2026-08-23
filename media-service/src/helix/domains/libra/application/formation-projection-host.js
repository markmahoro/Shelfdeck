'use strict';

const { createReconcileCursorStore } = require('../../../foundation/execution/reconcile-cursor-store');
const { buildFormationProjectionRow } = require('./formation-query');

const OWNER_DOMAIN = 'libra';
const RECONCILER_KEY = 'media-formation-projection';
const PAGE_LIMIT = 100;
const CADENCE_MS = 30_000;

function createFormationProjectionHost(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.source || !options.store) {
    throw new TypeError('Formation projection host requires source facts and durable projection persistence.');
  }
  const now = options.now || Date.now;
  const cursorStore = createReconcileCursorStore({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork, now });
  const queue = new Set();
  let lifecycle = 'created', timer = null, running = null, asOfMs = null, lastError = null, startupComplete = false;

  function rebuildRows(subjectRows) {
    if (!subjectRows.length) return Object.freeze({ processed: 0, writes: 0, noOps: 0 });
    const items = options.source.buildBatch(subjectRows);
    let writes = 0, noOps = 0;
    for (const item of items) {
      const result = options.store.upsert(buildFormationProjectionRow(item, now()));
      if (result.kind === 'no_op') noOps += 1; else writes += 1;
    }
    asOfMs = now();
    return Object.freeze({ processed: items.length, writes, noOps });
  }
  async function drainExact() {
    if (!queue.size) return;
    const ids = [...queue].sort().slice(0, PAGE_LIMIT);
    ids.forEach((id) => queue.delete(id));
    const subjects = ids.map((id) => options.source.readSubject(id)).filter(Boolean);
    rebuildRows(subjects);
  }
  async function sweepPage() {
    const head = cursorStore.read({ ownerDomain: OWNER_DOMAIN, reconcilerKey: RECONCILER_KEY });
    const subjects = options.source.readPage(head.cursor);
    rebuildRows(subjects);
    const nextCursor = subjects.length < PAGE_LIMIT ? null : subjects.at(-1).subject_id;
    cursorStore.advance({ ownerDomain: OWNER_DOMAIN, reconcilerKey: RECONCILER_KEY,
      expectedRevision: head.revision, cursor: nextCursor });
    return Object.freeze({ processed: subjects.length, cursor: nextCursor });
  }
  async function run(reason = 'fallback') {
    if (running) return running;
    running = (async () => {
      try {
        await drainExact();
        if (reason !== 'exact') {
          const page = await sweepPage();
          if (!startupComplete && page.cursor === null) startupComplete = true;
          lastError = null;
          return page;
        }
        lastError = null;
        return Object.freeze({ processed: 0, cursor: null });
      } catch (error) {
        lastError = error; throw error;
      } finally {
        running = null;
        if (queue.size && lifecycle === 'ready') {
          setImmediate(() => run('exact').catch((error) => options.onError?.(error)));
        }
      }
    })();
    return running;
  }
  async function completeStartupSweep() {
    for (;;) {
      const result = await run('startup');
      if (result.cursor === null) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    startupComplete = true;
  }
  return Object.freeze({
    enqueue(subjectId) {
      if (typeof subjectId !== 'string' || !subjectId) return false;
      queue.add(subjectId);
      if (lifecycle === 'ready') setImmediate(() => run('exact').catch((error) => options.onError?.(error)));
      return true;
    },
    async start() {
      if (lifecycle !== 'created') throw new Error('Formation projection host starts exactly once.');
      lifecycle = 'ready';
      timer = setInterval(() => run('fallback').catch((error) => options.onError?.(error)), CADENCE_MS); timer.unref?.();
      setImmediate(() => completeStartupSweep().catch((error) => options.onError?.(error)));
      return Object.freeze({ state: lifecycle });
    },
    wake() { if (lifecycle === 'ready') setImmediate(() => run('exact').catch((error) => options.onError?.(error))); },
    async stop() { lifecycle = 'stopping'; if (timer) clearInterval(timer); timer = null; if (running) await running; lifecycle = 'stopped'; },
    state() { return Object.freeze({ status: lastError ? 'stale' : startupComplete ? 'ready' : 'rebuilding', asOfMs: asOfMs || now(),
      queued: queue.size, errorCode: lastError?.code || null }); },
    runOnce: () => run('fallback')
  });
}

module.exports = Object.freeze({ CADENCE_MS, PAGE_LIMIT, createFormationProjectionHost });
