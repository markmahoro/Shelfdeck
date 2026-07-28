'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  H1_PHASES,
  IMMUTABLE_VERTICAL_BASELINE,
  SENTINEL_REGRESSIONS,
  classifyPath,
  routeImplementationStatus,
} = require('../../scripts/p14-h1-change-scope-guard');

test('freezes the accepted vertical baseline and exact H1 phase order', () => {
  assert.equal(
    IMMUTABLE_VERTICAL_BASELINE,
    'ddc3e51909ca4e9f5729c4326b05daee4792326f',
  );
  assert.deepEqual(H1_PHASES, [
    'H1.0',
    'H1.1',
    'H1.2',
    'H1.3',
    'H1.4',
    'H1.5',
  ]);
});

test('H1.0 permits only its two existing documents and mechanical guard files', () => {
  const allowed = [
    'docs/helix/implementation/CURRENT_PHASE.md',
    'docs/helix/implementation/evidence/P14_BETA_IMPL_03_PRODUCT_SURFACE_CONSTRUCTION_MATRIX.md',
    'media-service/scripts/p14-h1-change-scope-guard.js',
    'media-service/test/helix-architecture/p14-h1-change-scope-guard.test.js',
  ];
  for (const file of allowed) {
    assert.equal(classifyPath('H1.0', file).allowed, true, file);
  }
  assert.equal(
    classifyPath('H1.0', 'media-service/src/helix/platform/application/integration-registry.js').allowed,
    false,
  );
  assert.equal(
    classifyPath('H1.0', 'docs/helix/implementation/evidence/H1_NEW_ACTIVE_PLAN.md').allowed,
    false,
  );
});

test('all H1 phases fail closed on SSOT, Feature baseline, vertical core, DTO, Worker, and Desktop changes', () => {
  const forbidden = [
    'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
    'docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md',
    'media-service/src/helix/domains/procurement/application/movie-run-coordinator.js',
    'media-service/src/helix/domains/libra/application/movie-formation-coordinator.js',
    'media-service/src/helix/domains/arca/application/on-deck-store.js',
    'media-service/src/helix/contracts/types/MetadataObservation/v1/schema.json',
    'media-service/src/helix/foundation/persistence/sqlite-kernel.js',
    'media-service/src/app.js',
    'media-worker/src/server.js',
    'media-desktop/src/main.js',
  ];
  for (const phase of H1_PHASES) {
    for (const file of forbidden) {
      const decision = classifyPath(phase, file);
      assert.equal(decision.allowed, false, `${phase}: ${file}`);
      assert.equal(
        decision.reason,
        'immutable_vertical_or_product_boundary',
        `${phase}: ${file}`,
      );
    }
  }
});

test('future H1 phases allow only Platform, Integration, Composition, test, and evidence seams', () => {
  for (const phase of H1_PHASES.slice(1)) {
    assert.equal(
      classifyPath(phase, 'media-service/src/helix/platform/application/integration-registry.js').allowed,
      true,
    );
    assert.equal(
      classifyPath(phase, 'media-service/src/helix/integrations/tmdb-adapter.js').allowed,
      true,
    );
    assert.equal(
      classifyPath(phase, 'media-service/src/helix/composition/create-clean-facades.js').allowed,
      true,
    );
    assert.equal(
      classifyPath(phase, 'media-service/src/clean-service-host.js').allowed,
      true,
    );
    assert.equal(
      classifyPath(phase, 'media-service/web/src/setup.tsx').allowed,
      false,
    );
  }
  assert.equal(
    classifyPath('H1.4', 'media-service/package.json').allowed,
    true,
  );
  assert.equal(
    classifyPath('H1.3', 'media-service/package.json').allowed,
    false,
  );
  assert.equal(
    classifyPath('H1.5', 'media-service/src/helix/projections/projection-builder.js').allowed,
    true,
  );
  assert.equal(
    classifyPath('H1.1', 'media-service/src/helix/projections/projection-builder.js').allowed,
    false,
  );
});

test('reports exact current product route construction status without crediting backend verticals', () => {
  const status = routeImplementationStatus();
  assert.deepEqual(status.counts, {
    total: 114,
    real: 36,
    workerBeta404: 6,
    unavailable503: 72,
  });
  assert.equal(
    status.rows.filter((row) => row.state === 'real').length,
    36,
  );
});

test('every delivery phase retains accepted Movie, Series, JAV, Western, and cleanup sentinels', () => {
  for (const phase of H1_PHASES.slice(1)) {
    const sentinels = SENTINEL_REGRESSIONS[phase];
    assert.ok(sentinels.includes('test/helix-architecture/p14-clean-service-entrypoint.test.js'), phase);
    assert.ok(sentinels.includes('test/helix-architecture/p14-series-handoff-a.test.js'), phase);
    assert.ok(sentinels.includes('test/helix-architecture/p14-jav-routing-spec-run.test.js'), phase);
    assert.ok(sentinels.includes('test/helix-architecture/p14-western-routing-spec-run.test.js'), phase);
    assert.ok(sentinels.includes('test/helix-architecture/p14-workspace-cleanup-audit.test.js'), phase);
  }
});
