'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { SCHEMA } = require('./series-presentation');
const { assertSeriesPresentationBasis } = require('../../../contracts/series-presentation-basis');
const { REQUEST } = require('../../../contracts/series-maintenance-basis');

function fail(code) { throw Object.assign(new Error(code), { code }); }

// The offline Operator supplies a frozen Arca snapshot. Only Arca classifies
// whether an active builder belongs to collection maintenance or to an
// unfinished incoming Season. No file location is a deletion authorization.
function describeFreshResetSeriesRetention({ scopes, builds, committedEntryIds, retainedVersions = [] }) {
  const entries = new Set(committedEntryIds), byBuild = new Map(builds.map(row => [row.build_id, row]));
  if (entries.size !== committedEntryIds.length || byBuild.size !== builds.length ||
      new Set(scopes.map(row => row.scope_id)).size !== scopes.length) fail('ARCA_RESET_SERIES_SNAPSHOT_INVALID');
  const preservedBuilders = [], droppedHeads = [];
  for (const head of [...scopes].sort((a, b) => a.scope_id.localeCompare(b.scope_id))) {
    if (!head.active_build_id) continue;
    const row = byBuild.get(head.active_build_id);
    if (!row) fail('ARCA_RESET_SERIES_BUILD_MISSING');
    const scope = JSON.parse(row.scope_json), { digest: scopeDigest, ...frozenScope } = scope;
    // Inspect persisted facts without resolving their Linux paths on the
    // Operator's Windows host. Execution rebuilds its own platform scope;
    // offline retention verifies the original immutable bytes and identity.
    if (scope.schemaRef !== SCHEMA || scope.schemaVersion !== 1 ||
        scopeDigest !== canonicalDigest(frozenScope)) fail('ARCA_RESET_SERIES_BUILD_CHANGED');
    assertSeriesPresentationBasis(scope.basis);
    if (scope.objectId !== row.build_id || scope.scopeId !== head.scope_id || scope.digest !== row.scope_digest ||
        scope.basis.basisDigest !== row.basis_digest || canonicalJson(scope.basis) !== row.basis_json ||
        scope.shelfId !== head.shelf_id || scope.rootLocation !== head.root_location ||
        scope.basis.sourceObservation.providerKey !== head.provider_key || scope.expectedVersion !== Number(head.current_version))
      fail('ARCA_RESET_SERIES_BUILD_CHANGED');
    if (scope.basis.schema === REQUEST) {
      const binding = scope.basis.entryBinding;
      if (!entries.has(binding.shelfEntryId) || binding.shelfId !== head.shelf_id || binding.rootLocation !== head.root_location)
        fail('ARCA_RESET_MAINTENANCE_COLLECTION_MISSING');
      preservedBuilders.push({ buildId: row.build_id, scopeId: head.scope_id,
        scopeDigest: scope.digest, shelfEntryId: binding.shelfEntryId });
    } else {
      // The incoming build is not a retained maintenance obligation, even if
      // another Season of this show has already committed.
      droppedHeads.push({ scopeId: head.scope_id, buildId: row.build_id, headDigest: head.state_digest,
        scopeDigest: scope.digest, currentVersion: Number(head.current_version) });
    }
  }
  const metadataBases = [];
  for (const version of retainedVersions) {
    const row = byBuild.get(version.build_id), head = scopes.find(scope => scope.scope_id === version.scope_id);
    if (!row || !head) fail('ARCA_RESET_SERIES_BUILD_MISSING');
    const scope = JSON.parse(row.scope_json), { digest: scopeDigest, ...body } = scope;
    assertSeriesPresentationBasis(scope.basis);
    if (scope.schemaRef !== SCHEMA || scope.schemaVersion !== 1 || scopeDigest !== canonicalDigest(body) ||
        scope.objectId !== version.build_id || scope.scopeId !== version.scope_id || row.scope_id !== version.scope_id ||
        scope.digest !== row.scope_digest || scope.basis.basisDigest !== row.basis_digest ||
        canonicalJson(scope.basis) !== row.basis_json || scope.basis.sourceObservation.providerKey !== head.provider_key ||
        scope.expectedVersion + 1 !== Number(version.revision)) fail('ARCA_RESET_SERIES_BUILD_CHANGED');
    if (scope.basis.schema === 'shelfdeck.series-presentation-basis@1')
      metadataBases.push({ buildId: row.build_id, basis: scope.basis });
  }
  metadataBases.sort((a, b) => a.buildId.localeCompare(b.buildId));
  if (new Set(metadataBases.map(row => row.buildId)).size !== metadataBases.length) fail('ARCA_RESET_SERIES_SNAPSHOT_INVALID');
  const body = { schemaRef: 'arca.fresh-reset-series-retention@1', preservedBuilders, droppedHeads, metadataBases };
  return Object.freeze({ ...body, digest: canonicalDigest(body) });
}

module.exports = Object.freeze({ describeFreshResetSeriesRetention });
