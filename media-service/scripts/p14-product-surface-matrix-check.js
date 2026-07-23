'use strict';

const assert = require('node:assert/strict');
const manifest = require('../src/helix/contracts/manifests/route-inventory.json');

const assignments = Object.freeze({
  HealthFacade: 'implemented-core',
  OverviewQueryFacade: 'setup-foundation:projections.public.OverviewQuery',
  PlatformAdminFacade: 'setup-foundation:platform.public',
  ProcurementAdminFacade: 'setup-foundation:procurement.public',
  LibraFormationFacade: 'formation-product:libra.public',
  ArcaShelfAdminFacade: 'setup-foundation:arca.public',
  ArcaCollectionFacade: 'collection-postdeck:arca.public',
  ArcaCareFacade: 'collection-postdeck:arca.public',
  ArcaOffdeckFacade: 'collection-postdeck:arca.public',
  PerceptionAdminFacade: 'collection-postdeck:perception.public',
  PeopleAdminFacade: 'collection-postdeck:people.public',
});

const workerRoute = (route) => route.facade === 'PlatformAdminFacade' && route.facadeMethod.includes('workers');
const forbiddenTarget = /store|legacy|worker|desktop/i;
const entries = manifest.entries.map((entry) => ({ ...entry.contract, routeId: entry.id }));
for (const route of entries) {
  const target = assignments[route.facade];
  assert.ok(target, `missing construction assignment: ${route.routeId}`);
  if (workerRoute(route)) {
    assert.equal(target, 'setup-foundation:platform.public');
    continue;
  }
  assert.doesNotMatch(target, forbiddenTarget, `forbidden route target: ${route.routeId}`);
}
const workers = entries.filter(workerRoute);
assert.equal(workers.length, 6);
assert.equal(entries.length, 114);
process.stdout.write(`${JSON.stringify({
  ok: true,
  routeCount: entries.length,
  workerBeta404Count: workers.length,
  assignments,
}, null, 2)}\n`);
