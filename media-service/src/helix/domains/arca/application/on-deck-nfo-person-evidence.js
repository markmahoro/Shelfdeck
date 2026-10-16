'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { isAftercareArtifactMaterial } = require('../model/aftercare-contract');
const { MAX_NFO_BYTES, projectMovieNfoPersonObservations } = require('../model/aftercare-nfo');

function createOnDeckNfoPersonEvidence(options) {
  const store = options.contextReader.store, now = options.now || Date.now;
  const cache = new Map();
  const unavailable = reasonCode => Object.freeze({ kind:'unavailable', reasonCode, items:Object.freeze([]) });
  function observeEntry({ shelfEntryId }) {
    const current = store.currentNfoContext(shelfEntryId);
    if (!current || current.entry.status !== 'active' || current.shelf.status !== 'active') return unavailable('entry_not_active');
    const revision = Number(current.entry.current_inventory_revision), previous = cache.get(shelfEntryId);
    if (previous && previous.revision === revision && now() - previous.at < 600000) return previous.value;
    const files = current.materials.filter(row => row.role !== 'primary_payload' && isAftercareArtifactMaterial(row, 'nfo'));
    if (files.length > 16) return unavailable('nfo_file_bound');
    const items = [];
    for (const row of files) {
      let snapshot;
      try { snapshot = options.readBoundedFileSnapshotSync(row.location, MAX_NFO_BYTES); }
      catch (error) { return unavailable(error.code || 'nfo_observation_failed'); }
      const parsed = projectMovieNfoPersonObservations(snapshot.bytes);
      if (!parsed.usable) return unavailable(parsed.reasonCode);
      if (items.length + parsed.actors.length > 256 || parsed.actors.some(actor =>
        actor.displayName.length > 512 || (actor.character || '').length > 512)) return unavailable('nfo_person_evidence_bound');
      const nfoObservationDigest = canonicalDigest({ schema:'arca.nfo-person-observation@1',
        shelfEntryId, materialOrdinal:Number(row.ordinal), contentFingerprint:snapshot.contentFingerprint });
      for (const actor of parsed.actors) {
        const originEvidenceDigest = canonicalDigest({ schema:'arca.nfo-person-origin@1',nfoObservationDigest,ordinal:actor.ordinal });
        const evidence = { shelfEntryId, inventoryRevision:revision, relationId:null, relationDigest:null,
          originEvidenceDigest, nfoObservationDigest, displayName:actor.displayName,
          displayNameNormalized:actor.displayNameNormalized, role:actor.role, providerIdentities:actor.providerIdentities,
          identityStrength:actor.providerIdentities.length ? 'strong' : 'weak' };
        const { inventoryRevision:_revision, ...stableEvidence } = evidence;
        items.push(Object.freeze({ ...evidence, evidenceDigest:canonicalDigest({schema:'arca.ondeck-nfo-person-evidence@1',...stableEvidence}) }));
      }
    }
    const latest = store.currentNfoContext(shelfEntryId);
    if (!latest || latest.entry.status !== 'active' || latest.shelf.status !== 'active' ||
      Number(latest.entry.current_inventory_revision) !== revision) return unavailable('inventory_revision_changed');
    const value = Object.freeze({kind:'observed',items:Object.freeze(items)});
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(shelfEntryId,{revision,at:now(),value});
    return value;
  }
  return Object.freeze({ listPage:({cursor,limit}) => store.listEntryPage(cursor,limit), observeEntry });
}

module.exports = Object.freeze({ createOnDeckNfoPersonEvidence });
