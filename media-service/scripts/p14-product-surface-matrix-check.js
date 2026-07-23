'use strict';

const assert = require('node:assert/strict');
const manifest = require('../src/helix/contracts/manifests/route-inventory.json');

const workerRoute = (route) => route.facade === 'PlatformAdminFacade' && route.facadeMethod.includes('workers');
const coreRouteIds = new Set([
  'get:/v1/health',
  'post:/v1/admin/session',
  'delete:/v1/admin/session',
  'get:/v1/admin/settings/security',
]);
const libraRoutingRouteIds = new Set([
  'get:/v1/admin/routing/material-fields/:fieldId',
  'post:/v1/admin/routing/material-fields/:fieldId/actions/preview',
  'patch:/v1/admin/routing/material-fields/:fieldId',
  'get:/v1/admin/routing/material-fields/:fieldId/revisions',
]);
const familyTargets = Object.freeze({
  OverviewQueryFacade: 'projections.public.OverviewQuery',
  PlatformAdminFacade: 'platform.public',
  ProcurementAdminFacade: 'procurement.public',
  LibraFormationFacade: 'libra.public',
  ArcaShelfAdminFacade: 'arca.public',
  ArcaCollectionFacade: 'arca.public',
  ArcaCareFacade: 'arca.public',
  ArcaOffdeckFacade: 'arca.public',
  PerceptionAdminFacade: 'perception.public',
  PeopleAdminFacade: 'people.public',
});
const forbiddenTarget = /store|legacy|worker|desktop/i;
const entries = manifest.entries.map((entry) => ({ ...entry.contract, routeId: entry.id }));
const assignments = new Map();

function assign(route, batch, target) {
  assert.equal(assignments.has(route.routeId), false, `duplicate construction assignment: ${route.routeId}`);
  assignments.set(route.routeId, Object.freeze({ batch, target }));
}

for (const route of entries) {
  if (coreRouteIds.has(route.routeId)) {
    assign(route, 'implemented-core', 'clean-composition.core');
    continue;
  }
  if (workerRoute(route)) {
    assign(route, 'beta-404', 'beta-excluded');
    continue;
  }
  const target = familyTargets[route.facade];
  assert.ok(target, `missing construction assignment: ${route.routeId}`);
  const batch = route.facade === 'LibraFormationFacade'
    ? (libraRoutingRouteIds.has(route.routeId) ? 'setup-foundation' : 'formation-product')
    : ['OverviewQueryFacade', 'PlatformAdminFacade', 'ProcurementAdminFacade', 'ArcaShelfAdminFacade'].includes(route.facade)
      ? 'setup-foundation'
      : 'collection-postdeck';
  assert.doesNotMatch(target, forbiddenTarget, `forbidden route target: ${route.routeId}`);
  assign(route, batch, target);
}
const workers = entries.filter(workerRoute);
assert.equal(workers.length, 6);
assert.equal(entries.length, 114);
assert.equal(assignments.size, entries.length);
assert.equal([...assignments.values()].filter((item) => item.batch === 'implemented-core').length, 4);
assert.equal([...assignments.values()].filter((item) => item.batch === 'beta-404').length, 6);
assert.equal([...assignments.values()].filter((item) => item.batch === 'setup-foundation').length, 59);
assert.equal([...assignments.values()].filter((item) => item.batch === 'formation-product').length, 7);
assert.equal([...assignments.values()].filter((item) => item.batch === 'collection-postdeck').length, 38);
process.stdout.write(`${JSON.stringify({
  ok: true,
  routeCount: entries.length,
  workerBeta404Count: workers.length,
  batchCounts: Object.fromEntries(['implemented-core', 'beta-404', 'setup-foundation', 'formation-product', 'collection-postdeck']
    .map((batch) => [batch, [...assignments.values()].filter((item) => item.batch === batch).length])),
  assignments: Object.fromEntries([...assignments.entries()].sort(([left], [right]) => left.localeCompare(right))),
}, null, 2)}\n`);
