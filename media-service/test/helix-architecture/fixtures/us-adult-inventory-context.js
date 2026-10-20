'use strict';
const {canonicalDigest:D} = require('../../../src/helix/contracts/canonical-json');
const {originalNameProvenance} = require('../../../src/helix/contracts/us-adult-presentation');
function fixture() {
  const original = originalNameProvenance('Studio.Scene.1080p.mp4');
  const relation = { relationId: 'relation', personId: 'person', displayName: 'Current Actor', displayNameNormalized: 'current actor',
    role: 'actor', source: 'user_actor_choice', providerIdentities: [], originEvidenceDigest: D('choice'), confidenceClass: 'user_confirmed' };
  relation.relationDigest = D(relation);
  return { shelfEntryId: 'entry', raw: {
    entry: { shelf_entry_id: 'entry', status: 'active', structure_kind: 'single', current_inventory_revision: 2,
      current_deck_fact_revision:1,canonical_identity_revision:1,canonical_identity_key:D('canonical key') },
    shelf:{status:'active'},reservations:[],correctionGate:null,
    identity: { identity_kind: 'internal_identity', identity_digest: D('unchanged canonical identity') },
    inventory: { representation_digest: D('inventory representation') },
    facts: [
      { fact_kind: 'resolved_identity', value: { resolvedProductIdentity: { contentProfile: 'western_adult', identityKind: 'internal_identity',
        structureKind: 'single', identityDigest:D('unchanged canonical identity'), displayIdentity: { entries: [{ key: 'title', value: 'Initial title' },
          { key: 'original_file_name', value: original.originalFileName }, { key: 'original_file_name_digest', value: original.provenanceDigest }] } } } },
      { fact_kind: 'product_metadata', value: { descriptiveFacts: { entries: [{ key: 'title', value: 'Previous Actor Studio.Scene.1080p' }] } } },
      { fact_kind: 'media_cast', value: { schemaRef:'helix://contracts/types/MediaCastFact/v1',sourceBasisKind:'us_adult_actor',
        relations: [relation], relationCount: 1, relationsDigest: D({schema:'libra.media-cast-relations@1',relations:[relation]}) } },
    ],
    people: [{ shelf_entry_id: 'entry', inventory_revision: 2, relation_id: relation.relationId, person_id: relation.personId,
      display_name: relation.displayName, display_name_normalized: relation.displayNameNormalized, role: relation.role,
      relation_source: relation.source, provider_identity_json: null, provider_identity_digest: null,
      origin_evidence_digest: relation.originEvidenceDigest, confidence_class: relation.confidenceClass, relation_digest: D(relation) }],
  } };
}

module.exports = Object.freeze({fixture});
