'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function parseJson(value) {
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function relationEvidenceDigest(value) {
  return canonicalDigest({
    schema: 'arca.ondeck-person-evidence@1',
    shelfEntryId: value.shelfEntryId,
    inventoryRevision: value.inventoryRevision,
    relationId: value.relationId,
    relationDigest: value.relationDigest,
    originEvidenceDigest: value.originEvidenceDigest || null,
    displayName: value.displayName || null,
    displayNameNormalized: value.displayNameNormalized || null,
    role: value.role || null,
    providerIdentities: value.providerIdentities,
  });
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
      page_relations: {
        kind: 'select-page-after',
        tableId: 'arca_inventory_person_relations',
        keyColumn: 'relation_id',
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
        columns: ['shelf_entry_id', 'status', 'current_inventory_revision'],
      },
    },
  });

  function listPage({ cursor, limit }) {
    const pageLimit = Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 ? limit : 100;
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_person_evidence_page',
      owner: 'arca',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const rows = repo.invoke('page_relations', { cursor: cursor || null, limit: pageLimit });
        return rows.map((row) => {
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
            inventoryRevision: Number(row.inventory_revision),
            relationId: row.relation_id,
            relationDigest: row.relation_digest,
            originEvidenceDigest: row.origin_evidence_digest,
            displayName: row.display_name,
            displayNameNormalized: row.display_name_normalized,
            role: row.role,
            providerIdentities,
          });
          const strong = providerIdentities.some((item) => item && item.provider && item.providerKey);
          return Object.freeze({
            cursor: row.relation_id,
            scope: Object.freeze({
              skipped: false,
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
            }),
          });
        });
      },
    }]).arca_ondeck_person_evidence_page;
  }

  return Object.freeze({ listPage });
}

module.exports = Object.freeze({ createOnDeckPersonEvidenceProjection, relationEvidenceDigest });
