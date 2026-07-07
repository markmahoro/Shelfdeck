'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-freshness-'));
const previousDataDir = process.env.CONTROL_PLANE_DATA_DIR;
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const factsFreshnessService = require('../src/factsFreshnessService');
const lifecycleProjection = require('../src/lifecycleProjection');
const taskCreationPolicy = require('../src/taskCreationPolicy');

test.after(() => {
  if (previousDataDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
  else process.env.CONTROL_PLANE_DATA_DIR = previousDataDir;
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // better-sqlite3 may keep a Windows handle until process exit.
  }
});

function completeItem(patch = {}) {
  return {
    itemId: patch.itemId || `item-${Math.random().toString(16).slice(2)}`,
    source: 'emby',
    subLibraryId: 'lib-1',
    sourceId: 'emby-1',
    name: 'Complete Item',
    type: 'movie',
    path: '/media/movie.mkv',
    size: 1024 * 1024 * 1024,
    duration: 3600,
    bitrate: 5_000_000,
    equivalentBitrate: 5,
    resolution: '1920x1080',
    codec: 'h264',
    metadataStatus: 'complete',
    metadataComplete: true,
    metadataMissingReasons: [],
    optimizeObjectiveStatus: 'ready',
    optimizeObjective: {
      targetMediaFacts: { targetCodec: 'h265', targetBitrate: 3 },
    },
    lastRefreshedAt: '2026-01-01T00:00:00.000Z',
    metadataUpdatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

test('facts freshness uses formal persisted rows and decorates item projection', () => {
  const item = completeItem({ itemId: 'freshness-row-item' });

  factsFreshnessService.markFresh(item.itemId, ['mediaFacts'], {
    now: '2026-01-02T00:00:00.000Z',
    evidence: { source: 'test' },
  });
  factsFreshnessService.markStale(item.itemId, ['metadataFacts'], {
    now: '2026-01-03T00:00:00.000Z',
    reason: 'external_source_changed',
    source: 'source_adapter',
  });

  const decorated = factsFreshnessService.decorateItem(item);
  assert.strictEqual(decorated.factsFreshness.mediaFacts.status, 'fresh');
  assert.strictEqual(decorated.factsFreshness.metadataFacts.status, 'stale');
  assert.strictEqual(decorated.factsFreshness.metadataFacts.refreshTargetGate, 'metadata');
  assert.deepStrictEqual(decorated.factsFreshness.mediaFacts.evidence, { source: 'test' });
});

test('metadata gate fails when complete fields are stale', () => {
  const item = completeItem({
    itemId: 'stale-metadata-item',
    factsFreshness: {
      sourceFacts: { status: 'fresh', ownerGate: 'ingest' },
      mediaFacts: { status: 'stale', ownerGate: 'metadata', staleReason: 'file_fingerprint_changed', refreshTargetGate: 'metadata' },
      metadataFacts: { status: 'fresh', ownerGate: 'metadata' },
      userPerceptionFacts: { status: 'fresh', ownerGate: 'perception' },
      gateFacts: { status: 'fresh', ownerGate: 'lifecycle' },
    },
  });

  const projected = lifecycleProjection.decorateItem(item, {});
  assert.strictEqual(projected.lifecycleNextTask, 'metadata');
  assert.strictEqual(projected.lifecycleReason, 'metadata_facts_stale');
  assert.strictEqual(projected.metadataGate.status, 'stale');
});

test('post-optimize pending canonical refresh projects ingest before re-optimizing', () => {
  const item = completeItem({
    itemId: 'pending-refresh-source-stale',
    optimizeGate: {
      gate: 'optimize',
      passed: false,
      status: 'pending_canonical_refresh',
      reason: 'canonical_facts_stale_after_optimize',
      flowKind: 'transcode',
    },
    factsFreshness: {
      sourceFacts: { status: 'stale', refreshTargetGate: 'ingest', staleReason: 'post_optimize_replace' },
      mediaFacts: { status: 'stale', refreshTargetGate: 'metadata', staleReason: 'post_optimize_replace' },
      metadataFacts: { status: 'stale', refreshTargetGate: 'metadata', staleReason: 'post_optimize_replace' },
      userPerceptionFacts: { status: 'fresh' },
      gateFacts: { status: 'fresh' },
    },
  });

  const projected = lifecycleProjection.decorateItem(item, {});
  assert.strictEqual(projected.lifecycleNextTask, 'ingest');
  assert.strictEqual(projected.ingestGate.status, 'stale');
  assert.strictEqual(projected.optimizeGate.status, 'pending_canonical_refresh');
  assert.strictEqual(projected.optimizeGate.passed, false);
});

test('post-optimize pending canonical refresh projects metadata after source refresh', () => {
  const item = completeItem({
    itemId: 'pending-refresh-metadata-stale',
    optimizeGate: {
      gate: 'optimize',
      passed: false,
      status: 'pending_canonical_refresh',
      reason: 'canonical_facts_stale_after_optimize',
      flowKind: 'transcode',
    },
    factsFreshness: {
      sourceFacts: { status: 'fresh' },
      mediaFacts: { status: 'stale', refreshTargetGate: 'metadata', staleReason: 'post_optimize_replace' },
      metadataFacts: { status: 'stale', refreshTargetGate: 'metadata', staleReason: 'post_optimize_replace' },
      userPerceptionFacts: { status: 'fresh' },
      gateFacts: { status: 'fresh' },
    },
  });

  const projected = lifecycleProjection.decorateItem(item, {});
  assert.strictEqual(projected.lifecycleNextTask, 'metadata');
  assert.strictEqual(projected.metadataGate.status, 'stale');
  assert.strictEqual(projected.optimizeGate.status, 'pending_canonical_refresh');
  assert.strictEqual(projected.optimizeGate.passed, false);
});

test('fresh canonical facts re-evaluate objective instead of keeping stale pending optimize gate', () => {
  const item = completeItem({
    itemId: 'pending-refresh-now-fresh',
    bitrate: 3_000_000,
    equivalentBitrate: 3,
    codec: 'h265',
    optimizeGate: {
      gate: 'optimize',
      passed: false,
      status: 'pending_canonical_refresh',
      reason: 'canonical_facts_stale_after_optimize',
      flowKind: 'transcode',
    },
    factsFreshness: {
      sourceFacts: { status: 'fresh' },
      mediaFacts: { status: 'fresh' },
      metadataFacts: { status: 'fresh' },
      userPerceptionFacts: { status: 'fresh' },
      gateFacts: { status: 'fresh' },
    },
  });

  const projected = lifecycleProjection.decorateItem(item, {});
  assert.strictEqual(projected.lifecycleNextTask, 'archive');
  assert.strictEqual(projected.optimizeGate.passed, true);
  assert.strictEqual(projected.optimizeGate.reason, 'objective_already_satisfied');
});

test('needs_check remains non-blocking until source adapter finds evidence', () => {
  const item = completeItem({
    itemId: 'needs-check-item',
    factsFreshness: {
      sourceFacts: { status: 'needs_check', ownerGate: 'ingest' },
      mediaFacts: { status: 'needs_check', ownerGate: 'metadata' },
      metadataFacts: { status: 'fresh', ownerGate: 'metadata' },
      userPerceptionFacts: { status: 'fresh', ownerGate: 'perception' },
      gateFacts: { status: 'fresh', ownerGate: 'lifecycle' },
    },
  });

  const projected = lifecycleProjection.decorateItem(item, {});
  assert.notStrictEqual(projected.lifecycleNextTask, 'metadata');
  assert.strictEqual(projected.ingestGate.passed, true);
});

test('metadata admission distinguishes complete-fresh from complete-stale and manual refresh intent', () => {
  const freshItem = completeItem({
    itemId: 'admission-fresh',
    factsFreshness: {
      sourceFacts: { status: 'fresh' },
      mediaFacts: { status: 'fresh' },
      metadataFacts: { status: 'fresh' },
      userPerceptionFacts: { status: 'fresh' },
      gateFacts: { status: 'fresh' },
    },
  });
  const staleItem = completeItem({
    itemId: 'admission-stale',
    factsFreshness: {
      sourceFacts: { status: 'fresh' },
      mediaFacts: { status: 'stale', refreshTargetGate: 'metadata' },
      metadataFacts: { status: 'fresh' },
      userPerceptionFacts: { status: 'fresh' },
      gateFacts: { status: 'fresh' },
    },
  });

  const fresh = taskCreationPolicy.canCreateTargetTask({
    item: freshItem,
    itemInfo: freshItem,
    targetGate: 'metadata',
    source: 'manual',
    tasks: [],
    config: {},
  });
  assert.strictEqual(fresh.allowed, false);
  assert.strictEqual(fresh.reason, 'metadata_already_complete');

  const stale = taskCreationPolicy.canCreateTargetTask({
    item: staleItem,
    itemInfo: staleItem,
    targetGate: 'metadata',
    source: 'manual',
    tasks: [],
    config: {},
  });
  assert.strictEqual(stale.allowed, true);
  assert.strictEqual(stale.taskTarget.targetGate, 'metadata');

  const explicitRefresh = taskCreationPolicy.canCreateTargetTask({
    item: freshItem,
    itemInfo: freshItem,
    targetGate: 'metadata',
    gateObjective: { kind: 'metadata_refresh', refreshFacts: ['mediaFacts', 'metadataFacts'] },
    source: 'manual',
    tasks: [],
    config: {},
  });
  assert.strictEqual(explicitRefresh.allowed, true);
  assert.strictEqual(explicitRefresh.taskTarget.gateObjective.kind, 'metadata_refresh');
});

test('optimize admission blocks stale canonical media facts', () => {
  const item = completeItem({
    itemId: 'optimize-stale',
    factsFreshness: {
      sourceFacts: { status: 'fresh' },
      mediaFacts: { status: 'stale', refreshTargetGate: 'metadata' },
      metadataFacts: { status: 'fresh' },
      userPerceptionFacts: { status: 'fresh' },
      gateFacts: { status: 'fresh' },
    },
  });

  const result = taskCreationPolicy.canCreateTargetTask({
    item,
    itemInfo: item,
    targetGate: 'optimize',
    gateObjective: item.optimizeObjective,
    source: 'manual',
    tasks: [],
    config: {},
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'metadata_facts_stale');
});

test('duplicate active metadata refresh task is still rejected', () => {
  const item = completeItem({
    itemId: 'duplicate-refresh',
    factsFreshness: {
      sourceFacts: { status: 'fresh' },
      mediaFacts: { status: 'stale', refreshTargetGate: 'metadata' },
      metadataFacts: { status: 'fresh' },
      userPerceptionFacts: { status: 'fresh' },
      gateFacts: { status: 'fresh' },
    },
  });

  const result = taskCreationPolicy.canCreateTargetTask({
    item,
    itemInfo: item,
    targetGate: 'metadata',
    gateObjective: { kind: 'metadata_refresh' },
    source: 'manual',
    tasks: [{
      id: 'active-task',
      itemId: item.itemId,
      status: 'queued',
      taskTarget: { targetGate: 'metadata' },
    }],
    config: {},
  });

  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'active_task_exists');
});
