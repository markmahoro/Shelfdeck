'use strict';

const {statement:personEvidenceOriginStatement,evidenceInventoryRevision}=require('../persistence/person-evidence-origin');
const {projectionItem,matchesProjection}=require('../model/person-evidence-projection-item');
const { inventoryContentProfile } = require('../model/product-content-profile');
const { relationEvidenceDigest } = require('../model/on-deck-person-evidence');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function parseJson(value) {
  if(value===null)return [];
  const parsed=JSON.parse(value);
  if(!Array.isArray(parsed))throw Object.assign(new TypeError('Stored Arca Provider identities must be an array.'),{code:'ARCA_PERSON_EVIDENCE_INVALID'});
  return parsed;
}

function createOnDeckPersonEvidenceProjection(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('On-deck Person Evidence Projection requires Arca persistence.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'arca_ondeck_person_evidence',
    owner: 'arca',
    readOnly: true,
    schemaManifest: options.schemaManifest,
    statements: {
      find_identity: {kind:'select-one',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','identity_kind'],keyColumns:['shelf_entry_id','revision']},
      find_person_evidence_origin:personEvidenceOriginStatement,
      find_relation:{kind:'select-one',tableId:'arca_inventory_person_relations',keyColumns:['relation_id','shelf_entry_id','inventory_revision'],safeIntegers:true,
        columns:['relation_id','shelf_entry_id','inventory_revision','person_id','display_name','display_name_normalized','role','provider_identity_json','provider_identity_digest','origin_evidence_digest','confidence_class','relation_digest']},
      page_relations: {
        kind: 'select-joined-page',
        tableId: 'arca_inventory_person_relations',
        joins:[{tableId:'arca_shelf_entries',alias:'entry',on:[{column:'shelf_entry_id',otherAlias:'base',otherColumn:'shelf_entry_id'},{column:'current_inventory_revision',otherAlias:'base',otherColumn:'inventory_revision'}]}],
        filters:[{alias:'entry',column:'status',kind:'equals',parameter:'status'},{column:'relation_id',kind:'greater_than',parameter:'cursor',optional:true}],
        orderBy:[{column:'relation_id',direction:'asc'}],
        maxItems: 100,
        safeIntegers: true,
        columns: [
          'relation_id', 'shelf_entry_id', 'inventory_revision', 'person_id', 'display_name', 'display_name_normalized',
          'role', 'provider_identity_json', 'provider_identity_digest', 'origin_evidence_digest',
          'confidence_class', 'relation_digest',
        ],
      },
      find_entry: {
        kind: 'select-one',
        tableId: 'arca_shelf_entries',
        keyColumns: ['shelf_entry_id'],
        safeIntegers: true,
        columns: ['shelf_entry_id', 'status', 'structure_kind', 'canonical_identity_revision', 'current_inventory_revision'],
      },
    },
  });

  function projectRow(repo,row){
          const entry = repo.invoke('find_entry', { shelf_entry_id: row.shelf_entry_id });
          if (!entry || entry.status !== 'active' || Number(entry.current_inventory_revision) !== Number(row.inventory_revision)) {
            return Object.freeze({
              cursor: row.relation_id,
              scope: Object.freeze({ skipped: true, relationId: row.relation_id }),
            });
          }
          const providerIdentities = parseJson(row.provider_identity_json);
          const evidenceDigest = relationEvidenceDigest({
            shelfEntryId: row.shelf_entry_id,
            inventoryRevision: evidenceInventoryRevision(repo,row),
            relationId: row.relation_id,
            relationDigest: row.relation_digest,
            originEvidenceDigest: row.origin_evidence_digest,
            displayName: row.display_name,
            displayNameNormalized: row.display_name_normalized,
            role: row.role,
            providerIdentities,
          });
          const strong = providerIdentities.some((item) => item && item.provider && item.providerKey);
          const scope=Object.freeze({
              skipped: false,
              contentProfile: inventoryContentProfile(repo.invoke('find_identity', {shelf_entry_id:entry.shelf_entry_id,revision:entry.canonical_identity_revision}),entry.structure_kind),
              personId:row.person_id||null,
              relationId: row.relation_id,
              shelfEntryId: row.shelf_entry_id,
              inventoryRevision: Number(row.inventory_revision),
              relationDigest: row.relation_digest,
              originEvidenceDigest: row.origin_evidence_digest || null,
              displayName: row.display_name,
              displayNameNormalized: row.display_name_normalized,
              role: row.role,
              providerIdentities: Object.freeze(providerIdentities),
              evidenceDigest,
              identityStrength: strong ? 'strong' : 'weak',
            });
          return Object.freeze({cursor:row.relation_id,scope:Object.freeze({...scope,projectionItem:projectionItem(scope,'media_cast')})});
  }
  function listPage({ cursor, limit }) {
    const pageLimit = Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 ? limit : 100;
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_person_evidence_page',
      owner: 'arca',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const rows = repo.invoke('page_relations', { cursor: cursor || '',status:'active',offset:0,limit: pageLimit });
        return rows.map(row=>projectRow(repo,row));
      },
    }]).arca_ondeck_person_evidence_page;
  }

  function read(input){
    return options.unitOfWork.execute([{participantId:'arca_ondeck_person_evidence_exact',owner:'arca',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),row=repo.invoke('find_relation',{relation_id:input.relationId,shelf_entry_id:input.shelfEntryId,inventory_revision:input.inventoryRevision});
      if(!row)return null;const value=projectRow(repo,row)?.scope?.projectionItem;
      return value&&matchesProjection(value,input)?value:null;
    }}]).arca_ondeck_person_evidence_exact;
  }
  return Object.freeze({ listPage,read });
}

module.exports = Object.freeze({ createOnDeckPersonEvidenceProjection, relationEvidenceDigest });
