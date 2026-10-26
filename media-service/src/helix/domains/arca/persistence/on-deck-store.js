'use strict';
const {createSeriesPresentationStore}=require('./series-presentation-store');
const {assertRequiredUsAdultActor}=require('../../../contracts/us-adult-actor-package');
const { readControlProjections } = require('../persistence/read-control-projections');
const {inventoryMappingFact,FACT_SCHEMA}=require('../../../contracts/related-primary-mappings');
const {committedRelatedMappings}=require('../model/committed-related-mappings');
const {createInventoryVerificationStore}=require('./inventory-verification-store');
const { splitEpisodeMetadata } = require('../../../contracts/episode-metadata-records');
const {acceptedInventoryArtifactScopes,readInventoryArtifactScope}=require('../model/inventory-artifact-scope');

const path = require('node:path');
const {canonicalContentIdentity}=require('../model/canonical-content-identity');
const {validateSeriesExtension,isRetainedSeriesMaterial,extendInventory}=require('../model/series-inventory-extension');
const {
  canonicalDigest,
  canonicalJson,
} = require('../../../contracts/canonical-json');
const {
  createRepositoryDefinition,
} = require('../../../foundation/persistence/owner-repository');
const {
  controlScopeDigest,
  createMaterialControlParticipant,
  createMaterialControlAdmissionReadParticipant,
  createMaterialControlProjectionPort,
} = require('../../../foundation/persistence/material-control');
const {
  SCHEMA_REF: EPISODE_CLAIMS_SCHEMA,
  buildArcaMaterialEpisodeClaims,
  parseArcaMaterialEpisodeClaims,
} = require('../model/material-episode-claims');

const {seedStatement: cleanupSeedStatement}=require('./source-cleanup-store');

const RESULT_SCHEMA = 'helix://contracts/types/OnDeckCommitResult/v1';
const RECEIPT_SCHEMA = 'helix://contracts/types/OnDeckCommitReceipt/v1';
const COMPLETION_SCHEMA = 'helix://contracts/types/OffloadCompletionFact/v1';

class OnDeckStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OnDeckStoreError';
    this.code = code;
    this.details = details;
  }
}

class Replay extends Error {
  constructor(result) {
    super('On-deck Commit replay');
    this.result = result;
  }
}

function fail(code, message, details) {
  throw new OnDeckStoreError(code, message, details);
}

function assertAcceptedTargetScope(shelf, targetLocation) {
  const root = path.resolve(shelf.target.rootLocation);
  const target = path.resolve(targetLocation);
  const relativeTarget = path.relative(root, target);
  if (!path.isAbsolute(shelf.target.rootLocation) ||
      relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    fail('P14_ONDECK_TARGET_SCOPE_CHANGED',
      'Accepted Final Inventory Decision is outside the current Shelf Target.');
  }
}

function stable(schema, value) {
  return canonicalDigest({ schema, ...value });
}

function outboxPayloadDigest(value) {
  return canonicalDigest(value);
}

function retiredStagedNfoMembers({ manifests, stagedMembers, packageManifestDigest, onDeckRunId }) {
  const finalBySource = new Map(stagedMembers.map(member => [member.sourceMaterialKey, member]));
  const retired = new Map();
  for (const manifest of manifests) {
    const { manifestDigest, ...body } = manifest;
    if (manifest.schemaRef !== 'helix://contracts/types/StagedInventoryManifest/v1' ||
        manifestDigest !== canonicalDigest(body) ||
        manifest.manifestId !== canonicalDigest({ schema:'arca.staged-inventory-manifest-id@1', onDeckRunId }) ||
        manifest.sourceProductManifestDigest !== packageManifestDigest) {
      fail('ARCA_ONDECK_STAGED_CONTROL_EVIDENCE_INVALID', 'Staged Custody evidence is not bound to this On-deck Run and Product.');
    }
    for (const member of manifest.stagedMembers) {
      const final = finalBySource.get(member.sourceMaterialKey);
      if (!final || final.role !== member.role) {
        fail('ARCA_ONDECK_STAGED_CONTROL_EVIDENCE_INVALID', 'Staged Custody member has no exact Final Product member.');
      }
      if (member.physicalIdentity.materialKey === final.materialKey) continue;
      if (member.role !== 'metadata_sidecar' ||
          member.physicalIdentity.mountScopeId !== final.physicalIdentity.mountScopeId ||
          member.physicalIdentity.inode !== final.physicalIdentity.inode) {
        fail('ARCA_ONDECK_STAGED_CONTROL_REALITY_UNRESOLVED', 'A superseded Stage identity lacks same-file Final NFO verification.');
      }
      retired.set(member.physicalIdentity.materialKey, member);
    }
  }
  return retired;
}

function deriveOnDeckControlChanges(options) {
  const oldMaterials = options.oldMaterials;
  const stagedMembers = options.stagedMembers;
  const custodyByKey = new Map(options.custodyControls.map((item) =>
    [item.materialKey, item]));
  const targetByKey = new Map(options.targetControls.map((item) =>
    [item.materialKey, item]));
  const stagedByKey = new Map(stagedMembers.map((item) =>
    [item.materialKey, item]));
  const custodyScope = Object.freeze({
    ownerDomain: 'arca',
    scopeType: 'on_deck_custody',
    scopeId: options.custodyId,
  });
  const shelfEntryScope = Object.freeze({
    ownerDomain: 'arca',
    scopeType: 'shelf_entry',
    scopeId: options.shelfEntryId,
  });
  const changes = [];

  for (const [materialKey, member] of oldMaterials) {
    const control = custodyByKey.get(materialKey);
    if (!control) {
      fail('P14_ONDECK_CUSTODY_CONTROL_MISSING',
        'On-deck Commit lost a Custody Control member.');
    }
    const retained = stagedByKey.has(materialKey);
    if (retained) {
      const targetControl = targetByKey.get(materialKey);
      if (!targetControl ||
          targetControl.projectionDigest !== control.projectionDigest) {
        fail('P14_ONDECK_CONTROL_PROJECTION_DRIFT',
          'On-deck Commit observed different Control projections for a retained Material.');
      }
    }
    changes.push(Object.freeze({
      identity: member.physicalIdentity,
      action: retained ? 'transfer' : 'release',
      expectedRevision: control.controlRevision,
      expectedProjectionDigest: control.projectionDigest,
      fromScope: custodyScope,
      toScope: retained ? shelfEntryScope : null,
    }));
  }

  for (const member of stagedMembers) {
    if (oldMaterials.has(member.materialKey)) continue;
    const control = targetByKey.get(member.materialKey);
    if (!control || control.resultKind !== 'available') {
      fail('P14_ONDECK_TARGET_CONTROL_CONFLICT',
        'Final Inventory target Material is already controlled.');
    }
    const alreadyInCustody = control.controlState === 'controlled' &&
      control.ownerDomain === 'arca' &&
      control.ownerScopeType === 'on_deck_custody' &&
      control.ownerScopeId === options.custodyId;
    if (alreadyInCustody) {
      changes.push(Object.freeze({
        identity: member.physicalIdentity,
        action: 'transfer',
        expectedRevision: control.controlRevision,
        expectedProjectionDigest: control.projectionDigest,
        fromScope: custodyScope,
        toScope: shelfEntryScope,
      }));
      continue;
    }
    if(options.previous&&isRetainedSeriesMaterial(options.previous,member)&&control.controlState==='controlled'&&
        control.ownerDomain==='arca'&&control.ownerScopeType==='shelf_entry'&&control.ownerScopeId===options.shelfEntryId)continue;
    if (control.controlState !== 'uncontrolled') {
      fail('P14_ONDECK_TARGET_CONTROL_CONFLICT',
        'Final Inventory target Material is already controlled.');
    }
    changes.push(Object.freeze({
      identity: member.physicalIdentity,
      action: 'acquire',
      expectedRevision: control.controlRevision,
      expectedProjectionDigest: control.projectionDigest,
      fromScope: null,
      toScope: shelfEntryScope,
    }));
  }

  return Object.freeze(changes.sort((left, right) =>
    Buffer.compare(Buffer.from(left.identity.materialKey),
      Buffer.from(right.identity.materialKey))));
}

function arcaDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'arca_ondeck_store',
    owner: 'arca',
    schemaManifest,
    statements: {
      insert_source_cleanup: cleanupSeedStatement,
      find_run: {
        kind: 'select-one',
        tableId: 'arca_ondeck_runs',
        columns: [
          'on_deck_run_id', 'custody_id', 'final_inventory_decision_digest',
          'state', 'created_at_ms', 'terminal_at_ms',
          'target_reserved_at_ms',
        ],
        keyColumns: ['on_deck_run_id'],
        safeIntegers: true,
      },
      find_custody: {
        kind: 'select-one',
        tableId: 'arca_ondeck_custodies',
        columns: ['custody_id', 'state'],
        keyColumns: ['custody_id'],
      },
      find_receipt_by_offer: {
        kind: 'select-one',
        tableId: 'arca_handoff_b_receipts',
        columns: ['offer_id', 'outcome', 'custody_id'],
        keyColumns: ['offer_id'],
      },
      find_run_by_custody: {
        kind: 'select-one',
        tableId: 'arca_ondeck_runs',
        columns: [
          'on_deck_run_id', 'custody_id', 'final_inventory_decision_digest',
          'state', 'created_at_ms', 'terminal_at_ms',
        ],
        keyColumns: ['custody_id'],
        safeIntegers: true,
      },
      advance_run: {
        kind: 'update',
        tableId: 'arca_ondeck_runs',
        setColumns: ['state', 'terminal_at_ms'],
        keyColumns: ['on_deck_run_id'],
        compareColumns: [
          { column: 'state', parameter: 'expected_state' },
          {
            column: 'final_inventory_decision_digest',
            parameter: 'expected_final_inventory_decision_digest',
          },
        ],
      },
      reserve_target: {
        kind:'update', tableId:'arca_ondeck_runs', setColumns:['target_reserved_at_ms'],
        keyColumns:['on_deck_run_id'],
        compareColumns:[{column:'state',parameter:'expected_state'}],
      },
      find_decision: {
        kind: 'select-one',
        tableId: 'arca_final_inventory_decisions',
        columns: [
          'final_inventory_decision_id', 'on_deck_run_id', 'shelf_id',
          'placement_revision', 'target_endpoint_id', 'target_location',
          'product_manifest_digest', 'offload_context_digest',
          'decision_schema_ref', 'decision_json', 'decision_digest',
          'decided_at_ms',
        ],
        keyColumns: ['on_deck_run_id'],
        safeIntegers: true,
      },
      list_target_candidates: {
        kind: 'select-all', tableId: 'arca_ondeck_runs',
        columns: ['on_deck_run_id', 'state', 'created_at_ms', 'target_reserved_at_ms'],
        keyColumns: ['state'], safeIntegers:true,
      },
      find_entry: {
        kind: 'select-one',
        tableId: 'arca_shelf_entries',
        columns: [
          'shelf_entry_id', 'shelf_id', 'structure_kind', 'status',
          'canonical_identity_revision', 'canonical_identity_key',
          'current_inventory_revision', 'current_deck_fact_revision',
          'created_at_ms', 'terminal_at_ms',
        ],
        keyColumns: ['shelf_entry_id'],
        safeIntegers: true,
      },
      advance_entry:{kind:'update',tableId:'arca_shelf_entries',setColumns:['current_inventory_revision','current_deck_fact_revision'],
        keyColumns:['shelf_entry_id'],compareColumns:[{column:'status',parameter:'expected_status'},
          {column:'current_inventory_revision',parameter:'expected_inventory_revision'},{column:'current_deck_fact_revision',parameter:'expected_deck_fact_revision'}]},
      clear_active_guards:{kind:'update',tableId:'arca_inventory_materials',setColumns:['active_guard'],keyColumns:['shelf_entry_id','inventory_revision']},
      list_reservations:{kind:'select-all',tableId:'arca_offdeck_reservations',columns:['reservation_id','shelf_entry_id','state'],keyColumns:['shelf_entry_id']},
      list_facts:{kind:'select-all',tableId:'arca_inventory_product_facts',columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_schema_ref','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest','source_package_id','provenance_digest','committed_at_ms'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
      list_people:{kind:'select-all',tableId:'arca_inventory_person_relations',columns:['relation_id','shelf_entry_id','inventory_revision','person_id','display_name','display_name_normalized','role','relation_source','provider_identity_schema_ref','provider_identity_json','provider_identity_digest','origin_evidence_digest','confidence_class','relation_digest'],keyColumns:['shelf_entry_id','inventory_revision']},
      list_related:{kind:'select-all',tableId:'arca_inventory_related_references',columns:['shelf_entry_id','inventory_revision','reference_id','primary_ordinal','role','reference_kind','material_identity_hint','endpoint_id','location','checksum_hex'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
      insert_entry: {
        kind: 'insert',
        tableId: 'arca_shelf_entries',
        columns: [
          'shelf_entry_id', 'shelf_id', 'structure_kind', 'status',
          'canonical_identity_revision', 'canonical_identity_key',
          'current_inventory_revision', 'current_deck_fact_revision',
          'created_at_ms', 'terminal_at_ms',
        ],
      },
      insert_identity: {
        kind: 'insert',
        tableId: 'arca_canonical_identity_revisions',
        columns: [
          'shelf_entry_id', 'revision', 'structure_kind', 'identity_kind',
          'provider', 'provider_key', 'identity_digest', 'committed_at_ms',
        ],
      },
      insert_representation: {
        kind: 'insert',
        tableId: 'arca_inventory_representations',
        columns: [
          'shelf_entry_id', 'revision', 'representation_digest',
          'source_package_id', 'committed_at_ms',
        ],
      },
      find_representation: {
        kind: 'select-one',
        tableId: 'arca_inventory_representations',
        columns: [
          'shelf_entry_id', 'revision', 'representation_digest',
          'source_package_id', 'committed_at_ms',
        ],
        keyColumns: ['shelf_entry_id', 'revision'],
        safeIntegers: true,
      },
      insert_material: {
        kind: 'insert',
        tableId: 'arca_inventory_materials',
        columns: [
          'shelf_entry_id', 'inventory_revision', 'ordinal', 'material_key',
          'role', 'episode_claims_schema_ref', 'episode_claims_json',
          'episode_claim_set_digest', 'endpoint_id', 'location',
          'binding_revision', 'mount_scope_id', 'inode',
          'fingerprint_algorithm', 'fingerprint_version',
          'content_fingerprint', 'digest_hex', 'size_bytes', 'artifact_scope_schema_ref','artifact_scope_json', 'active_guard',
        ],
      },
      list_materials: {
        kind: 'select-all',
        tableId: 'arca_inventory_materials',
        columns: [
          'shelf_entry_id', 'inventory_revision', 'ordinal', 'material_key',
          'role', 'episode_claims_schema_ref', 'episode_claims_json',
          'episode_claim_set_digest', 'endpoint_id', 'location',
          'binding_revision', 'mount_scope_id', 'inode',
          'fingerprint_algorithm', 'fingerprint_version',
          'content_fingerprint', 'digest_hex', 'size_bytes', 'artifact_scope_schema_ref','artifact_scope_json', 'active_guard',
        ],
        keyColumns: ['shelf_entry_id', 'inventory_revision'],
        safeIntegers: true,
      },
      insert_related: {
        kind: 'insert',
        tableId: 'arca_inventory_related_references',
        columns: [
          'shelf_entry_id', 'inventory_revision', 'reference_id',
          'primary_ordinal', 'role', 'reference_kind', 'material_identity_hint', 'endpoint_id',
          'location', 'checksum_hex',
        ],
      },
      insert_fact: {
        kind: 'insert',
        tableId: 'arca_inventory_product_facts',
        columns: [
          'shelf_entry_id', 'inventory_revision', 'fact_kind',
          'fact_revision', 'fact_schema_ref', 'fact_json','episode_metadata_schema_ref','episode_metadata_json', 'fact_digest',
          'source_package_id', 'provenance_digest', 'committed_at_ms',
        ],
      },
      insert_person: {
        kind: 'insert',
        tableId: 'arca_inventory_person_relations',
        columns: [
          'relation_id', 'shelf_entry_id', 'inventory_revision', 'person_id',
          'display_name', 'display_name_normalized', 'role',
          'relation_source', 'provider_identity_schema_ref',
          'provider_identity_json', 'provider_identity_digest',
          'origin_evidence_digest', 'confidence_class', 'relation_digest',
        ],
      },
      insert_deck: {
        kind: 'insert',
        tableId: 'arca_deck_fact_revisions',
        columns: [
          'shelf_entry_id', 'revision', 'state', 'inventory_revision',
          'standard_revision', 'fact_digest', 'committed_at_ms',
        ],
      },
      find_deck: {
        kind: 'select-one',
        tableId: 'arca_deck_fact_revisions',
        columns: [
          'shelf_entry_id', 'revision', 'state', 'inventory_revision',
          'standard_revision', 'fact_digest', 'committed_at_ms',
        ],
        keyColumns: ['shelf_entry_id', 'revision'],
        safeIntegers: true,
      },
      find_receipt: {
        kind: 'select-one',
        tableId: 'arca_ondeck_commit_receipts',
        columns: [
          'receipt_id', 'on_deck_run_id', 'shelf_entry_id',
          'inventory_revision', 'deck_fact_revision',
          'control_revision_set_digest', 'related_disposition_completion_digest',
          'commit_digest', 'committed_at_ms',
        ],
        keyColumns: ['on_deck_run_id'],
        safeIntegers: true,
      },
      insert_receipt: {
        kind: 'insert',
        tableId: 'arca_ondeck_commit_receipts',
        columns: [
          'receipt_id', 'on_deck_run_id', 'shelf_entry_id',
          'inventory_revision', 'deck_fact_revision',
          'control_revision_set_digest', 'related_disposition_completion_digest',
          'commit_digest', 'committed_at_ms',
        ],
      },
      find_completion: {
        kind: 'select-one',
        tableId: 'arca_offload_completions',
        columns: [
          'offload_completion_id', 'on_deck_run_id', 'shelf_entry_id',
          'inventory_revision', 'package_id', 'completion_digest',
          'committed_at_ms',
        ],
        keyColumns: ['on_deck_run_id'],
        safeIntegers: true,
      },
      find_completion_by_package: {
        kind: 'select-one',
        tableId: 'arca_offload_completions',
        columns: [
          'offload_completion_id', 'on_deck_run_id', 'shelf_entry_id',
          'inventory_revision', 'package_id', 'completion_digest',
          'committed_at_ms',
        ],
        keyColumns: ['package_id'],
        safeIntegers: true,
      },
      insert_completion: {
        kind: 'insert',
        tableId: 'arca_offload_completions',
        columns: [
          'offload_completion_id', 'on_deck_run_id', 'shelf_entry_id',
          'inventory_revision', 'package_id', 'completion_digest',
          'committed_at_ms',
        ],
      },
    },
  });
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'arca_ondeck_foundation',
    owner: 'execution-foundation',
    schemaManifest,
    statements: {
      insert_result: {
        kind: 'insert',
        tableId: 'fx_event_result_bindings',
        columns: [
          'result_id', 'event_id', 'outcome_kind', 'result_schema_ref',
          'result_json', 'result_digest', 'evidence_schema_ref',
          'evidence_json', 'evidence_digest', 'effect_receipt_id',
          'committed_at_ms',
        ],
      },
      insert_marker: {
        kind: 'insert',
        tableId: 'fx_commit_markers',
        columns: [
          'commit_marker', 'effect_id', 'owner_domain', 'scope_type',
          'scope_id', 'commit_digest', 'result_id', 'result_schema_ref',
          'result_digest', 'committed_at_ms',
        ],
      },
      insert_outbox: {
        kind: 'insert',
        tableId: 'fx_outbox',
        columns: [
          'message_id', 'producer_domain', 'message_kind', 'aggregate_type',
          'aggregate_id', 'aggregate_revision', 'dedup_key',
          'consumer_set_digest', 'intended_consumer_count',
          'payload_schema_ref', 'payload_json', 'payload_digest', 'state',
          'available_at_ms', 'created_at_ms', 'all_acked_at_ms',
        ],
      },
      insert_outbox_delivery: {
        kind: 'insert',
        tableId: 'fx_outbox_deliveries',
        columns: [
          'message_id', 'consumer_domain', 'state', 'attempt_count',
          'next_attempt_at_ms', 'acked_at_ms',
        ],
      },
    },
  });
}

function parseDecision(row) {
  if (!row) return null;
  let decision;
  try {
    decision = JSON.parse(row.decision_json);
  } catch {
    fail('P14_FINAL_INVENTORY_DECISION_CORRUPT',
      'Final Inventory Decision JSON is corrupt.');
  }
  if (canonicalDigest({
    schema: 'arca.final-inventory-decision@1',
    ...Object.fromEntries(Object.entries(decision)
      .filter(([name]) => !['digest', 'decisionDigest'].includes(name))),
    targetEndpointId: row.target_endpoint_id,
    targetLocation: row.target_location,
    productManifestDigest: row.product_manifest_digest,
    offloadContextDigest: row.offload_context_digest,
  }) !== row.decision_digest ||
      decision.digest !== row.decision_digest ||
      decision.decisionDigest !== row.decision_digest) {
    fail('P14_FINAL_INVENTORY_DECISION_CORRUPT',
      'Final Inventory Decision digest cannot be reconstructed.');
  }
  return Object.freeze(decision);
}

function createOnDeckStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P14_ONDECK_STORE_DEPENDENCIES',
      'On-deck Store requires clean Arca persistence.');
  }
  const arca = arcaDefinition(options.schemaManifest);
  const foundation = foundationDefinition(options.schemaManifest);

  function verifyInventoryHistory(
    repo,
    shelfEntryId,
    inventoryRevision,
    deckFactRevision,
    packageDigest,
  ) {
    const representation = repo.invoke('find_representation', {
      shelf_entry_id: shelfEntryId,
      revision: inventoryRevision,
    });
    const rows = repo.invoke('list_materials', {
      shelf_entry_id: shelfEntryId,
      inventory_revision: inventoryRevision,
    }).sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
    const members = rows.map((row, ordinal) => {
      if (Number(row.ordinal) !== ordinal) {
        fail('P14_ONDECK_INVENTORY_HISTORY',
          'Inventory Material ordinals are not contiguous.');
      }
      const physicalIdentity = Object.freeze({
        schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
        schemaVersion: 2,
        materialKey: row.material_key,
        mountScopeId: row.mount_scope_id,
        inode: row.inode,
        sizeBytes: Number(row.size_bytes),
        fingerprintAlgorithm: row.fingerprint_algorithm,
        fingerprintVersion: Number(row.fingerprint_version),
        contentFingerprint: row.content_fingerprint,
      });
      if (canonicalDigest({
        schema: 'physical-material-identity@2',
        mountScopeId: physicalIdentity.mountScopeId,
        inode: physicalIdentity.inode,
        sizeBytes: physicalIdentity.sizeBytes,
        fingerprintAlgorithm: physicalIdentity.fingerprintAlgorithm,
        fingerprintVersion: physicalIdentity.fingerprintVersion,
        contentFingerprint: physicalIdentity.contentFingerprint,
      }) !== physicalIdentity.materialKey) {
        fail('P14_ONDECK_INVENTORY_HISTORY',
          'Inventory Material Physical Identity cannot be reconstructed.');
      }
      const artifactScope=readInventoryArtifactScope(row);
      return Object.freeze({
        ...(artifactScope?{artifactScope}:{}),
        ordinal,
        materialKey: row.material_key,
        role: row.role,
        episodeClaims: parseArcaMaterialEpisodeClaims(row),
        endpointId: row.endpoint_id,
        location: row.location,
        bindingRevision: Number(row.binding_revision),
        physicalIdentity,
        digestHex: row.digest_hex,
        sizeBytes: Number(row.size_bytes),
      });
    });
    const mappingFacts = repo.invoke('list_facts', { shelf_entry_id: shelfEntryId, inventory_revision: inventoryRevision })
      .filter(row => row.fact_kind === 'related_primary_mapping' && row.source_package_id === representation?.source_package_id);
    let relatedPrimaryMappings = [];
    if (mappingFacts.length) {
      const completion = repo.invoke('find_completion_by_package', { package_id: representation.source_package_id });
      const decision = completion && parseDecision(repo.invoke('find_decision', { on_deck_run_id: completion.on_deck_run_id }));
      relatedPrimaryMappings = committedRelatedMappings({ facts: mappingFacts, materials: rows, decision,
        sourcePackageId: representation.source_package_id, packageDigest });
    }
    const digestValue = canonicalDigest({
      schema: 'arca.inventory-representation@1',
      shelfEntryId,
      inventoryRevision,
      sourcePackageId: representation?.source_package_id,
      members,
      ...(relatedPrimaryMappings.length ? { relatedPrimaryMappings } : {}),
    });
    if (!representation ||
        representation.representation_digest !== digestValue) {
      fail('P14_ONDECK_INVENTORY_HISTORY',
        'Inventory Representation cannot be reconstructed from Arca rows.');
    }
    const deck = repo.invoke('find_deck', {
      shelf_entry_id: shelfEntryId,
      revision: deckFactRevision,
    });
    const deckFactDigest = deck && canonicalDigest({
      schema: 'arca.deck-fact@1',
      shelfEntryId,
      revision: deckFactRevision,
      state: deck.state,
      inventoryRevision,
      standardRevision: Number(deck.standard_revision),
      representationDigest: digestValue,
      packageDigest,
    });
    if (!deck ||
        deck.state !== 'active' ||
        Number(deck.inventory_revision) !== inventoryRevision ||
        deck.fact_digest !== deckFactDigest) {
      fail('P14_ONDECK_DECK_HISTORY',
        'Deck Fact cannot be reconstructed from exact Inventory history.');
    }
    return Object.freeze({ representation, members, deck });
  }

  function verifyAcceptedResponsibility(request) {
    const decision = request.finalInventoryDecision;
    assertAcceptedTargetScope(request.shelf, request.targetLocation);
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_accepted_responsibility_read',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const existingRun = repo.invoke('find_run', {
          on_deck_run_id: request.onDeckRunId,
        });
        const existingDecision = repo.invoke('find_decision', {
          on_deck_run_id: request.onDeckRunId,
        });
        if (!existingRun || !existingDecision ||
            existingRun.custody_id !== request.custodyId ||
            existingRun.final_inventory_decision_digest !==
              decision.decisionDigest ||
            !['ready', 'offloading', 'blocked', 'committed'].includes(existingRun.state) ||
            canonicalJson(parseDecision(existingDecision)) !==
              canonicalJson(decision) ||
            existingDecision.shelf_id !== request.shelf.shelfId ||
            Number(existingDecision.placement_revision) !==
              decision.placementRevision ||
            existingDecision.target_endpoint_id !==
              request.shelf.target.endpointId ||
            existingDecision.target_location !== request.targetLocation ||
            existingDecision.product_manifest_digest !==
              request.package.productMaterialManifest.manifestDigest ||
            existingDecision.offload_context_digest !==
              request.package.offloadContextManifest.manifestDigest) {
          fail('P14_ONDECK_ACCEPTED_RESPONSIBILITY_MISSING',
            'Handoff B Accepted did not atomically establish its On-deck Run and Final Inventory Decision.');
        }
        return Object.freeze({
          replayed: true,
          state: existingRun.state,
          decision,
        });
      },
    }]).arca_ondeck_accepted_responsibility_read;
  }

  function targetAvailability(repo, onDeckRunId, decisionDigest) {
    const run = repo.invoke('find_run', { on_deck_run_id:onDeckRunId });
    const decision = repo.invoke('find_decision', { on_deck_run_id:onDeckRunId });
    if (!run || !decision || run.final_inventory_decision_digest !== decisionDigest ||
        decision.decision_digest !== decisionDigest) {
      fail('P14_ONDECK_RUN_MISSING', 'On-deck Run does not match its immutable Decision.');
    }
    if (run.state === 'committed') return Object.freeze({ available:true });
    const contenders = ['ready','offloading','blocked'].flatMap(state =>
      repo.invoke('list_target_candidates', {state})).filter(row => {
      const target = repo.invoke('find_decision', {on_deck_run_id:row.on_deck_run_id});
      return target?.target_endpoint_id === decision.target_endpoint_id &&
        target.target_location === decision.target_location;
    });
    // An interrupted physical transaction keeps its reservation until Commit.
    const holders = contenders.filter(row => row.target_reserved_at_ms !== null);
    const ordered = (holders.length ? holders : contenders.filter(row=>row.state==='ready'||row.on_deck_run_id===onDeckRunId)).sort((a,b) =>
      Number(a.created_at_ms)-Number(b.created_at_ms) ||
      Buffer.compare(Buffer.from(a.on_deck_run_id),Buffer.from(b.on_deck_run_id)));
    const blocker = ordered.find(row => row.on_deck_run_id !== onDeckRunId);
    const available = holders.length ? !blocker : ordered[0]?.on_deck_run_id === onDeckRunId;
    return Object.freeze({ available, blockingRunId:available ? null :
      (holders.length ? blocker?.on_deck_run_id : ordered[0]?.on_deck_run_id) });
  }

  function readTargetAvailability(onDeckRunId, decisionDigest) {
    return options.unitOfWork.execute([{
      participantId:'arca_ondeck_target_availability', owner:'arca', repositories:[arca],
      execute(context) { return targetAvailability(context.repository(arca.repositoryId),onDeckRunId,decisionDigest); },
    }]).arca_ondeck_target_availability;
  }

  function setOffloading(onDeckRunId, decisionDigest) {
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_start',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const availability = targetAvailability(repo,onDeckRunId,decisionDigest);
        if (!availability.available) fail('P14_ONDECK_TARGET_RESERVED',
          'Final Inventory target is reserved by another On-deck Run.',availability);
        const run = repo.invoke('find_run', { on_deck_run_id: onDeckRunId });
        if (!run || run.final_inventory_decision_digest !== decisionDigest) {
          fail('P14_ONDECK_RUN_MISSING',
            'On-deck Run does not match its immutable Decision.');
        }
        if (run.state === 'offloading' || run.state === 'committed') {
          return run.state;
        }
        if (run.state !== 'ready' || repo.invoke('advance_run', {
          state: 'offloading',
          terminal_at_ms: null,
          on_deck_run_id: onDeckRunId,
          expected_state: 'ready',
          expected_final_inventory_decision_digest: decisionDigest,
        }).changes !== 1) {
          fail('P14_ONDECK_RUN_CAS',
            'On-deck Run lost its readiness CAS.');
        }
        if(repo.invoke('reserve_target',{on_deck_run_id:onDeckRunId,
          target_reserved_at_ms:context.commitTimeMs,expected_state:'offloading'}).changes!==1)
          fail('P14_ONDECK_TARGET_RESERVATION_CAS','On-deck target reservation lost its state fence.');
        return 'offloading';
      },
    }]).arca_ondeck_start;
  }

  function recoveryEligibility(onDeckRunId) {
    return options.unitOfWork.execute([{
      participantId:'arca_ondeck_recovery_eligibility', owner:'arca', repositories:[arca],
      execute(context) {
        const repo=context.repository(arca.repositoryId);
        const run=repo.invoke('find_run',{on_deck_run_id:onDeckRunId});
        if(!run)return Object.freeze({eligible:false,reasonCode:'on_deck_run_absent'});
        const custody=repo.invoke('find_custody',{custody_id:run.custody_id});
        if(!custody||custody.state!=='active')return Object.freeze({eligible:false,reasonCode:'custody_not_active'});
        if(run.state!=='blocked')return Object.freeze({eligible:false,reasonCode:'on_deck_run_not_blocked',state:run.state});
        if(!targetAvailability(repo,onDeckRunId,run.final_inventory_decision_digest).available)
          return Object.freeze({eligible:false,reasonCode:'on_deck_target_reserved',state:run.state});
        return Object.freeze({eligible:true,reasonCode:null,state:run.state,custodyId:run.custody_id,
          decisionDigest:run.final_inventory_decision_digest});
      },
    }]).arca_ondeck_recovery_eligibility;
  }

  function attentionRetryEligibility(onDeckRunId) {
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_attention_retry_eligibility', owner: 'arca', repositories: [arca],
      execute(context) {
        const repo=context.repository(arca.repositoryId),run=repo.invoke('find_run',{on_deck_run_id:onDeckRunId});
        if(!run)return Object.freeze({eligible:false,reasonCode:'on_deck_run_missing'});
        const custody=repo.invoke('find_custody',{custody_id:run.custody_id});
        if(!custody||custody.state!=='active')return Object.freeze({eligible:false,reasonCode:'custody_not_active'});
        if(run.state!=='blocked')return Object.freeze({eligible:false,reasonCode:'on_deck_run_not_blocked',state:run.state});
        if(!targetAvailability(repo,onDeckRunId,run.final_inventory_decision_digest).available)
          return Object.freeze({eligible:false,reasonCode:'on_deck_target_reserved',state:run.state});
        return Object.freeze({eligible:true,reasonCode:null,state:run.state,custodyId:run.custody_id,
          decisionDigest:run.final_inventory_decision_digest});
      },
    }]).arca_ondeck_attention_retry_eligibility;
  }

  function findRunByOffer(offerId) {
    return options.unitOfWork.execute([{
      participantId:'arca_ondeck_find_by_offer',owner:'arca',repositories:[arca],execute(context){
        const repo=context.repository(arca.repositoryId),receipt=repo.invoke('find_receipt_by_offer',{offer_id:offerId});
        if(!receipt||receipt.outcome!=='accepted'||!receipt.custody_id)return null;
        const run=repo.invoke('find_run_by_custody',{custody_id:receipt.custody_id});
        return run?Object.freeze({onDeckRunId:run.on_deck_run_id,custodyId:run.custody_id,
          finalInventoryDecisionDigest:run.final_inventory_decision_digest,state:run.state,
          createdAtMs:Number(run.created_at_ms),terminalAtMs:run.terminal_at_ms===null?null:Number(run.terminal_at_ms)}):null;
      },
    }]).arca_ondeck_find_by_offer;
  }

  function block(onDeckRunId, decisionDigest) {
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_block', owner: 'arca', repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const run = repo.invoke('find_run', { on_deck_run_id:onDeckRunId });
        if (!run || run.final_inventory_decision_digest !== decisionDigest) {
          fail('P14_ONDECK_RUN_MISSING', 'On-deck Run does not match its immutable Decision.');
        }
        if (run.state === 'blocked') return Object.freeze({ state:'blocked', replayed:true });
        if (!['ready', 'offloading'].includes(run.state) || repo.invoke('advance_run', {
          state:'blocked', terminal_at_ms:null, on_deck_run_id:onDeckRunId,
          expected_state:run.state, expected_final_inventory_decision_digest:decisionDigest,
        }).changes !== 1) {
          fail('P14_ONDECK_BLOCK_CAS', 'On-deck Run lost its blocking CAS.');
        }
        return Object.freeze({ state:'blocked', replayed:false });
      },
    }]).arca_ondeck_block;
  }

  function requireAttention(onDeckRunId, decisionDigest) {
    return options.unitOfWork.execute([{
      participantId:'arca_ondeck_require_attention',owner:'arca',repositories:[arca],execute(context){
        const repo=context.repository(arca.repositoryId),run=repo.invoke('find_run',{on_deck_run_id:onDeckRunId});
        if(!run||run.final_inventory_decision_digest!==decisionDigest)
          fail('P14_ONDECK_RUN_MISSING','On-deck Run does not match its immutable Decision.');
        if(run.state!=='blocked')fail('P14_ONDECK_ATTENTION_STATE','Only a blocked On-deck Run can exhaust recovery.');
        return Object.freeze({state:'blocked',replayed:true});
      },
    }]).arca_ondeck_require_attention;
  }

  function resume(onDeckRunId, decisionDigest, expectedState = 'blocked') {
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_resume', owner: 'arca', repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const availability=targetAvailability(repo,onDeckRunId,decisionDigest);
        if(!availability.available)fail('P14_ONDECK_TARGET_RESERVED',
          'Final Inventory target is reserved by another On-deck Run.',availability);
        const run = repo.invoke('find_run', { on_deck_run_id:onDeckRunId });
        if (!run || run.final_inventory_decision_digest !== decisionDigest) {
          fail('P14_ONDECK_RUN_MISSING', 'On-deck Run does not match its immutable Decision.');
        }
        if (run.state === 'offloading') return Object.freeze({ state:'offloading', replayed:true });
        if (run.state !== expectedState || repo.invoke('advance_run', {
          state:'offloading', terminal_at_ms:null, on_deck_run_id:onDeckRunId,
          expected_state:expectedState, expected_final_inventory_decision_digest:decisionDigest,
        }).changes !== 1) {
          fail('P14_ONDECK_RESUME_CAS', 'On-deck Run lost its recovery CAS.');
        }
        if(run.target_reserved_at_ms===null&&repo.invoke('reserve_target',{
          on_deck_run_id:onDeckRunId,target_reserved_at_ms:context.commitTimeMs,expected_state:'offloading'}).changes!==1)
          fail('P14_ONDECK_TARGET_RESERVATION_CAS','On-deck target reservation lost its recovery fence.');
        return Object.freeze({ state:'offloading', replayed:false });
      },
    }]).arca_ondeck_resume;
  }

  function commit(request) {
    const packageValue = request.package;
    assertRequiredUsAdultActor(packageValue);
    const verificationRecord = request.fulfillmentVerificationRecord;
    if (verificationRecord?.schemaRef !== 'helix://contracts/types/FulfillmentVerificationRecord/v1' ||
        verificationRecord.processType !== 'arca_ondeck_run' || verificationRecord.processId !== request.onDeckRunId ||
        canonicalDigest(createInventoryVerificationStore(options).resolve(verificationRecord)) !== request.fulfillmentVerificationDigest) {
      fail('P14_ONDECK_FULFILLMENT_RECORD', 'On-deck Commit requires its exact immutable Fulfillment Verification Record.');
    }
    if (request.fulfillmentVerificationDigest !==
        canonicalDigest(request.fulfillmentVerification)) {
      fail('P14_ONDECK_FULFILLMENT_DIGEST',
        'Fulfillment Verification digest does not match its exact typed value.');
    }
    if (typeof request.relatedDispositionCompletionDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(request.relatedDispositionCompletionDigest)) {
      fail('P14_ONDECK_DISPOSITION_COMPLETION_REQUIRED',
        'On-deck Commit requires the complete source-to-final settlement digest.');
    }
    const identityValue =
      packageValue.resolvedIdentitySnapshot?.factValue
        ?.resolvedProductIdentity ||
      packageValue.resolvedIdentitySnapshot?.factValue;
    if (!identityValue || !identityValue.identityDigest) {
      fail('P14_ONDECK_IDENTITY_MISSING',
        'On-deck Commit requires the exact resolved Product Identity.');
    }
    const providerIdentity = identityValue.providerIdentities?.[0] || {};
    const {canonicalIdentityKey,shelfEntryId}=canonicalContentIdentity(request.shelf.shelfId,identityValue,request.onDeckRunId);
    const previous=readSeasonInventory(request.shelf.shelfId,packageValue);
    const inventoryRevision=previous?Number(previous.entry.current_inventory_revision)+1:1;
    const deckFactRevision=previous?Number(previous.entry.current_deck_fact_revision)+1:1;
    const stagedMembers = [...request.staged.members].sort((left, right) =>
      Buffer.compare(Buffer.from(left.sourceMaterialKey),
        Buffer.from(right.sourceMaterialKey)) ||
      Buffer.compare(Buffer.from(left.materialKey),
        Buffer.from(right.materialKey)));
    if (new Set(stagedMembers.map((item) => item.sourceMaterialKey)).size !==
        stagedMembers.length ||
        new Set(stagedMembers.map((item) => item.materialKey)).size !==
        stagedMembers.length) {
      fail('P14_ONDECK_STAGED_IDENTITY_DUPLICATE',
        'Staged source and target Material identities must be unique.');
    }
    const productMembers = new Map(
      packageValue.productMaterialManifest.members.map((member) =>
        [member.materialKey, member]),
    );
    const series =
      packageValue.productStructureSnapshot?.structureKind === 'season';
    for (const stagedMember of stagedMembers) {
      const source = productMembers.get(stagedMember.sourceMaterialKey);
      const episodeClaims = buildArcaMaterialEpisodeClaims(
        stagedMember.episodeClaims,
        {
          requireNonEmpty:
            series && stagedMember.role === 'primary_payload',
          requireEmpty:
            stagedMember.role !== 'primary_payload' || !series,
        },
      );
      if (!source || source.role !== stagedMember.role ||
          canonicalJson(source.episodeClaims || []) !==
            canonicalJson(episodeClaims.items) ||
          source.episodeClaimSetDigest !==
            episodeClaims.episodeClaimSetDigest) {
        fail('P14_ONDECK_EPISODE_CLAIMS',
          'Staged Inventory Episode Claims do not match the Product member.');
      }
      const finalMemberId = stable('arca.final-inventory-member-id@1', {
        onDeckRunId: request.onDeckRunId,
        sourceMaterialKey: stagedMember.sourceMaterialKey,
      });
      if (!request.finalInventoryDecision.members.some((member) =>
        member.objectId === finalMemberId)) {
        fail('P14_ONDECK_FINAL_MEMBER_CONTINUITY',
          'Staged source Material is absent from the Final Inventory Decision.');
      }
      if (canonicalJson(stagedMember.episodeClaims) !==
          canonicalJson(episodeClaims)) {
        fail('P14_ONDECK_EPISODE_CLAIMS',
          'Staged Inventory Episode Claims are not canonical.');
      }
    }
    const stagedManifestMembers = [...request.staged.manifest.stagedMembers];
    const expectedStagedMembers = stagedMembers.map((item) => ({
      sourceMaterialKey: item.sourceMaterialKey,
      physicalIdentity: item.physicalIdentity,
      role: item.role,
      endpointId: item.endpointId,
      location: item.location,
      bindingRevision: 1,
      episodeClaims: item.episodeClaims,
    }));
    if (canonicalJson(stagedManifestMembers) !==
        canonicalJson(expectedStagedMembers)) {
      fail('P14_ONDECK_STAGED_MANIFEST_DRIFT',
        'Staged Inventory Manifest does not conserve its exact members.');
    }
    const artifactScopes=acceptedInventoryArtifactScopes(packageValue);
    const inventoryMembers = extendInventory(previous,Object.freeze(stagedMembers.map(
      (item, ordinal) => Object.freeze({
        ordinal,
        materialKey: item.materialKey,
        role: item.role,
        episodeClaims: item.episodeClaims,
        endpointId: item.endpointId,
        location: item.location,
        bindingRevision: 1,
        physicalIdentity: item.physicalIdentity,
        digestHex: item.digestHex,
        sizeBytes: item.sizeBytes,
        ...(artifactScopes.has(item.sourceMaterialKey)?{artifactScope:artifactScopes.get(item.sourceMaterialKey)}:{}),
      }),
    )));
    const oldMaterials = new Map();
    const controlledProductMembers =
      packageValue.productMaterialManifest.members.filter((member) =>
        member.controlOperation !== 'assert_related_input');
    const controlledOffloadMembers =
      packageValue.offloadContextManifest.members.filter((member) =>
        member.contextRole !== 'related_input');
    for (const member of [
      ...controlledProductMembers,
      ...controlledOffloadMembers,
    ]) {
      if (!oldMaterials.has(member.materialKey)) {
        oldMaterials.set(member.materialKey, member);
      }
    }
    const retiredStageMembers = retiredStagedNfoMembers({
      manifests: request.stagedCustodyManifests || [],
      stagedMembers,
      packageManifestDigest: packageValue.productMaterialManifest.manifestDigest,
      onDeckRunId: request.onDeckRunId,
    });
    for (const [key, member] of retiredStageMembers) {
      if (oldMaterials.has(key)) continue;
      const projection = request.custodyControls.find(item => item.materialKey === key);
      if (projection?.resultKind !== 'available' || projection.controlState !== 'controlled' ||
          projection.ownerDomain !== 'arca' || projection.ownerScopeType !== 'on_deck_custody' ||
          projection.ownerScopeId !== request.custodyId) {
        fail('ARCA_ONDECK_STAGED_CONTROL_SCOPE_DRIFT', 'Retired Stage identity no longer belongs to the exact Custody.');
      }
      oldMaterials.set(key, member);
    }
    const changes = deriveOnDeckControlChanges({
      previous,
      oldMaterials,
      stagedMembers,
      custodyControls: request.custodyControls,
      targetControls: request.targetControls,
      custodyId: request.custodyId,
      shelfEntryId,
    });
    const retainedControlChecks=previous?[createMaterialControlAdmissionReadParticipant({schemaManifest:options.schemaManifest,
      participantId:'arca_series_retained_controls',boundBusinessOwner:'arca',materialKeys:previous.materials.map(row=>row.material_key).sort(),
      accept(projections){
        for(const projection of projections){
          const expected=request.targetControls.find(item=>item.materialKey===projection.materialKey);
          if(projection.resultKind!=='available'||projection.controlState!=='controlled'||projection.ownerDomain!=='arca'||
              projection.ownerScopeType!=='shelf_entry'||projection.ownerScopeId!==shelfEntryId||
              (expected&&expected.projectionDigest!==projection.projectionDigest))
            fail('ARCA_SERIES_RETAINED_CONTROL_STALE','Existing Season Inventory Control changed before Commit.');
        }
      }})]:[];
    const authorizedControlScopeDigest = controlScopeDigest(changes);
    const representationDigest = canonicalDigest({
      schema: 'arca.inventory-representation@1',
      shelfEntryId,
      inventoryRevision,
      sourcePackageId: packageValue.onDeckPackageId,
      members: inventoryMembers,
      ...(packageValue.relatedPrimaryMappings?.length?{relatedPrimaryMappings:packageValue.relatedPrimaryMappings}:{}),
    });
    const deckFactBase = {
      schema: 'arca.deck-fact@1',
      shelfEntryId,
      revision: deckFactRevision,
      state: 'active',
      inventoryRevision,
      standardRevision: request.shelf.currentStandardRevision,
      representationDigest,
      packageDigest: packageValue.packageDigest,
    };
    const deckFactDigest = canonicalDigest(deckFactBase);
    const commitBasis = {
      schema: 'arca.on-deck-commit-basis@1',
      onDeckRunId: request.onDeckRunId,
      custodyId: request.custodyId,
      finalInventoryDecisionDigest:
        request.finalInventoryDecision.decisionDigest,
      stagedInventoryManifestDigest: request.staged.manifest.manifestDigest,
      fulfillmentVerificationDigest:
        request.fulfillmentVerificationDigest,
      shelfEntryId,
      inventoryRevision,
      deckFactRevision,
      deckFactDigest,
      representationDigest,
      controlScopeDigest: authorizedControlScopeDigest,
      relatedDispositionCompletionDigest:
        request.relatedDispositionCompletionDigest,
    };
    const commitDigest = canonicalDigest(commitBasis);
    const markerId = stable('arca.on-deck-commit-marker@1', {
      onDeckRunId: request.onDeckRunId,
      commitDigest,
    });
    const resultId = stable('arca.on-deck-commit-result@1', {
      onDeckRunId: request.onDeckRunId,
    });
    const controlHandle = Object.freeze({
      schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
      schemaVersion: 1,
      handleId: stable('arca.on-deck-control-handle@1', {
        onDeckRunId: request.onDeckRunId,
        commitDigest,
      }),
      operationKind: 'replace_control_set',
      ownerDomain: 'arca',
      processType: 'arca_on_deck_run',
      processId: request.onDeckRunId,
      basisRef: Object.freeze({
        objectType: 'final_inventory_decision',
        objectId: request.finalInventoryDecision.objectId,
        revision: request.finalInventoryDecision.revision,
        digest: request.finalInventoryDecision.decisionDigest,
      }),
      basisDigest: commitDigest,
      canonicalFactSetDigest: canonicalDigest({
        schema: 'arca.on-deck-canonical-fact-set@1',
        representationDigest,
        deckFactDigest,
        productFactManifestDigest:
          packageValue.productFactManifest.manifestDigest,
      }),
      bindingSetDigest: representationDigest,
      controlScopeDigest: authorizedControlScopeDigest,
      expectedControlRevisions: Object.freeze(changes.map((item) =>
        Object.freeze({
          materialKey: item.identity.materialKey,
          revision: item.expectedRevision,
        }))),
      receiptContract: Object.freeze({
        receiptSchemaRef: 'helix://contracts/types/OnDeckCommitReceipt/v1',
        controlRevisionSetSchemaRef: 'arca.on-deck-committed-control-set@1',
      }),
      eventFenceDigest: canonicalDigest({
        schema: 'arca.on-deck-commit-event-fence@1',
        onDeckRunId: request.onDeckRunId,
        commitDigest,
      }),
    });
    let receipt;
    let completion;
    let result;
    let controlResults;
    const replay = {
      participantId: 'arca_ondeck_replay',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const storedReceipt = repo.invoke('find_receipt', {
          on_deck_run_id: request.onDeckRunId,
        });
        if (!storedReceipt) return;
        const storedCompletion = repo.invoke('find_completion', {
          on_deck_run_id: request.onDeckRunId,
        });
        if (!storedCompletion || storedReceipt.commit_digest !== commitDigest ||
            storedReceipt.shelf_entry_id !== shelfEntryId ||
            storedReceipt.related_disposition_completion_digest !==
              request.relatedDispositionCompletionDigest ||
            storedCompletion.package_id !== packageValue.onDeckPackageId) {
          fail('P14_ONDECK_REPLAY_CORRUPT',
            'On-deck Commit replay conflicts with immutable Owner facts.');
        }
        throw new Replay(resultFromRows(storedReceipt, storedCompletion,
          commitDigest));
      },
    };
    const verify = {
      participantId: 'arca_ondeck_verify',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const run = repo.invoke('find_run', {
          on_deck_run_id: request.onDeckRunId,
        });
        const decision = repo.invoke('find_decision', {
          on_deck_run_id: request.onDeckRunId,
        });
        if(previous) {
          const current=readSeriesInventoryFromRepo(repo,request.shelf.shelfId,packageValue);
          if(canonicalJson(current)!==canonicalJson(previous))fail('ARCA_SERIES_EXTENSION_STALE','Series Inventory changed before Commit.');
        }

        if (!run || run.custody_id !== request.custodyId ||
            run.state !== 'offloading' ||
            run.final_inventory_decision_digest !==
              request.finalInventoryDecision.decisionDigest ||
            canonicalJson(parseDecision(decision)) !==
              canonicalJson(request.finalInventoryDecision) ||
            (!previous && repo.invoke('find_entry', { shelf_entry_id: shelfEntryId }))) {
          fail('P14_ONDECK_COMMIT_FENCE',
            'On-deck Commit Owner fence is stale or conflicts with an Entry.');
        }
      },
    };
    const rawControl = createMaterialControlParticipant({
      schemaManifest: options.schemaManifest,
      participantId: 'arca_ondeck_control',
      handle: controlHandle,
      changes,
      authorizedScopeDigest: authorizedControlScopeDigest,
      commitMarker: markerId,
    });
    const control = Object.freeze({
      ...rawControl,
      execute(context) {
        controlResults = rawControl.execute(context);
        return controlResults;
      },
    });
    const domain = {
      participantId: 'arca_ondeck_domain',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const controlRevisionSetDigest = canonicalDigest({
          schema: 'arca.on-deck-control-revision-set@1',
          onDeckRunId: request.onDeckRunId,
          items: controlResults.map((item) => ({
            materialKey: item.materialKey,
            action: item.action,
            committedControlRevision: item.revision,
            committedControlProjectionDigest: item.projection.projectionDigest,
          })).sort((left, right) =>
            Buffer.compare(Buffer.from(left.materialKey),
              Buffer.from(right.materialKey))),
        });
        if(previous) {
          if(repo.invoke('advance_entry',{shelf_entry_id:shelfEntryId,current_inventory_revision:inventoryRevision,current_deck_fact_revision:deckFactRevision,
              expected_status:'active',expected_inventory_revision:previous.entry.current_inventory_revision,
              expected_deck_fact_revision:previous.entry.current_deck_fact_revision}).changes!==1)
            fail('ARCA_SERIES_EXTENSION_CAS','Series extension lost the Entry revision fence.');
          repo.invoke('clear_active_guards',{shelf_entry_id:shelfEntryId,inventory_revision:previous.entry.current_inventory_revision,active_guard:0});
        } else repo.invoke('insert_entry', {
          shelf_entry_id: shelfEntryId,
          shelf_id: request.shelf.shelfId,
          structure_kind: identityValue.structureKind,
          status: 'active',
          canonical_identity_revision: 1,
          canonical_identity_key: canonicalIdentityKey,
          current_inventory_revision: inventoryRevision,
          current_deck_fact_revision: deckFactRevision,
          created_at_ms: context.commitTimeMs,
          terminal_at_ms: null,
        });
        repo.invoke('insert_source_cleanup', {
          cleanup_id:request.onDeckRunId,on_deck_run_id:request.onDeckRunId,shelf_entry_id:shelfEntryId,state:'pending',
          check_revision:1,checks_schema_ref:'helix://contracts/application-types/SourceCleanupChecks/v1',checks_json:'[]',created_at_ms:context.commitTimeMs,
          updated_at_ms:context.commitTimeMs,next_check_at_ms:context.commitTimeMs,
        });
        if(!previous)repo.invoke('insert_identity', {
          shelf_entry_id: shelfEntryId,
          revision: 1,
          structure_kind: identityValue.structureKind,
          identity_kind: identityValue.identityKind,
          provider: providerIdentity.provider || null,
          provider_key: providerIdentity.providerKey || null,
          identity_digest: identityValue.identityDigest,
          committed_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_representation', {
          shelf_entry_id: shelfEntryId,
          revision: inventoryRevision,
          representation_digest: representationDigest,
          source_package_id: packageValue.onDeckPackageId,
          committed_at_ms: context.commitTimeMs,
        });
        inventoryMembers.forEach((item) => {
          repo.invoke('insert_material', {
            shelf_entry_id: shelfEntryId,
            inventory_revision: inventoryRevision,
            ordinal: item.ordinal,
            material_key: item.materialKey,
            role: item.role,
            episode_claims_schema_ref: EPISODE_CLAIMS_SCHEMA,
            episode_claims_json: canonicalJson(item.episodeClaims),
            episode_claim_set_digest:
              item.episodeClaims.episodeClaimSetDigest,
            endpoint_id: item.endpointId,
            location: item.location,
            binding_revision: 1,
            mount_scope_id: item.physicalIdentity.mountScopeId,
            inode: item.physicalIdentity.inode,
            fingerprint_algorithm: item.physicalIdentity.fingerprintAlgorithm,
            fingerprint_version: String(item.physicalIdentity.fingerprintVersion),
            content_fingerprint: item.physicalIdentity.contentFingerprint,
            digest_hex: item.digestHex,
            size_bytes: item.sizeBytes,
            artifact_scope_schema_ref: item.artifactScope?.schemaRef??null,
            artifact_scope_json: item.artifactScope?canonicalJson(item.artifactScope):null,
            active_guard: item.role === 'primary_payload' ? 1 : 0,
          });
        });
        if(previous) {
          for(const row of previous.facts)repo.invoke('insert_fact',{...row,inventory_revision:inventoryRevision});
          for(const row of previous.people)repo.invoke('insert_person',{...row,inventory_revision:inventoryRevision});
          for(const row of previous.related)repo.invoke('insert_related',{...row,inventory_revision:inventoryRevision});
        }
        for(const [index,mapping] of (packageValue.relatedPrimaryMappings||[]).entries()){
          const related=stagedMembers.find(item=>item.sourceMaterialKey===mapping.relatedMaterialKey),
            primary=stagedMembers.find(item=>item.sourceMaterialKey===mapping.finalPrimaryMaterialKey);
          if(!related||!primary)fail('ARCA_RELATED_PRIMARY_MAPPING_MISSING','Inventory mapping must bind both exact staged members.');
          const fact=inventoryMappingFact(mapping,related.materialKey,primary.materialKey);
          repo.invoke('insert_fact',{shelf_entry_id:shelfEntryId,inventory_revision:inventoryRevision,fact_kind:'related_primary_mapping',
            fact_revision:(previous?.facts.filter(row=>row.fact_kind==='related_primary_mapping').reduce((max,row)=>Math.max(max,Number(row.fact_revision)),0)||0)+index+1,
            fact_schema_ref:FACT_SCHEMA,fact_json:canonicalJson(fact),episode_metadata_schema_ref:null,episode_metadata_json:null,
            fact_digest:canonicalDigest(fact),source_package_id:packageValue.onDeckPackageId,provenance_digest:packageValue.packageDigest,committed_at_ms:context.commitTimeMs});
        }
        packageValue.productFactManifest.items.forEach((item) => {
          const stored = splitEpisodeMetadata(item.factValue);
          repo.invoke('insert_fact', {
            shelf_entry_id: shelfEntryId,
            inventory_revision: inventoryRevision,
            fact_kind: item.factKind,
            fact_revision: item.factRevision,
            fact_schema_ref: item.schemaRef,
            fact_json: canonicalJson(stored.value),
            episode_metadata_schema_ref:stored.recordsJson?'helix://contracts/types/EpisodeMetadataRecordSet/v1':null,
            episode_metadata_json:stored.recordsJson,
            fact_digest: item.factDigest,
            source_package_id: packageValue.onDeckPackageId,
            provenance_digest: item.evidenceDigest,
            committed_at_ms: context.commitTimeMs,
          });
        });
        for(const primary of packageValue.productionProvenance?.shelfAcceptancePrimaryReadSet?.primaryInputs||[]){
          const verification=primary.productMediaVerification;
          if(!verification?.qualitySummary?.editionEvidence)continue;
          repo.invoke('insert_fact',{shelf_entry_id:shelfEntryId,inventory_revision:inventoryRevision,
            fact_kind:'product_media_verification',fact_revision:primary.ordinal+1,fact_schema_ref:verification.schemaRef,
            episode_metadata_schema_ref:null,episode_metadata_json:null,fact_json:canonicalJson(verification),fact_digest:canonicalDigest(verification),source_package_id:packageValue.onDeckPackageId,
            provenance_digest:packageValue.productionProvenance.provenanceDigest,committed_at_ms:context.commitTimeMs});
        }
        const authorizedDefectManifest =
          packageValue.productionAttestation?.acceptanceKind === 'accepted_with_defects'
            ? packageValue.productionAttestation.authorizedDefectManifest : null;
        if (authorizedDefectManifest) {
          repo.invoke('insert_fact', {
            shelf_entry_id: shelfEntryId,
            inventory_revision: inventoryRevision,
            fact_kind: 'authorized_defect_manifest',
            fact_revision: 1,
            fact_schema_ref: authorizedDefectManifest.schemaRef,
            episode_metadata_schema_ref:null,episode_metadata_json:null,fact_json: canonicalJson(authorizedDefectManifest),
            fact_digest: authorizedDefectManifest.manifestDigest,
            source_package_id: packageValue.onDeckPackageId,
            provenance_digest: packageValue.productionAttestation.attestationDigest,
            committed_at_ms: context.commitTimeMs,
          });
        }
        for (const item of packageValue.mediaCastSnapshot.relations || []) {
          if(previous?.people.some(row=>row.relation_id===item.relationId||row.relation_digest===canonicalDigest(item)))continue;
          const providerIdentities = item.providerIdentities || [];
          repo.invoke('insert_person', {
            relation_id: item.relationId,
            shelf_entry_id: shelfEntryId,
            inventory_revision: inventoryRevision,
            person_id: item.personId,
            display_name: item.displayName,
            display_name_normalized: item.displayNameNormalized,
            role: item.role,
            relation_source: item.source,
            provider_identity_schema_ref: providerIdentities.length
              ? 'helix://contracts/types/ProviderIdentitySet/v1'
              : null,
            provider_identity_json: providerIdentities.length
              ? canonicalJson(providerIdentities)
              : null,
            provider_identity_digest: providerIdentities.length
              ? canonicalDigest(providerIdentities)
              : null,
            origin_evidence_digest: item.originEvidenceDigest,
            confidence_class: item.confidenceClass,
            relation_digest: canonicalDigest(item),
          });
        }
        repo.invoke('insert_deck', {
          shelf_entry_id: shelfEntryId,
          revision: deckFactRevision,
          state: 'active',
          inventory_revision: inventoryRevision,
          standard_revision: request.shelf.currentStandardRevision,
          fact_digest: deckFactDigest,
          committed_at_ms: context.commitTimeMs,
        });
        const receiptValue = {
          schemaRef: RECEIPT_SCHEMA,
          schemaVersion: 1,
          receiptId: stable('arca.on-deck-commit-receipt-id@1', {
            onDeckRunId: request.onDeckRunId,
            commitDigest,
          }),
          receiptKind: 'on_deck_committed',
          ownerDomain: 'arca',
          scopeType: 'on_deck_run',
          scopeId: request.onDeckRunId,
          scopeDigest: commitDigest,
          effectReceiptRef: null,
          committedAtMs: context.commitTimeMs,
          shelfEntryId,
          inventoryRevision,
          deckFactRevision,
          controlRevisionSetDigest,
          relatedDispositionCompletionDigest:
            request.relatedDispositionCompletionDigest,
        };
        receipt = Object.freeze(receiptValue);
        const completionCore = {
          onDeckRunId: request.onDeckRunId,
          shelfEntryId,
          inventoryRevision,
          packageId: packageValue.onDeckPackageId,
        };
        const completionDigest = canonicalDigest({
          schema: 'arca.offload-completion@1',
          ...completionCore,
          packageDigest: packageValue.packageDigest,
        });
        const factBase = {
          schemaRef: COMPLETION_SCHEMA,
          schemaVersion: 1,
          factId: stable('arca.offload-completion-id@1', {
            onDeckRunId: request.onDeckRunId,
          }),
          ownerDomain: 'arca',
          aggregateType: 'on_deck_run',
          aggregateId: request.onDeckRunId,
          revision: 1,
          factSchemaRef: 'arca.offload-completion@1',
          commitMarker: markerId,
          committedAtMs: context.commitTimeMs,
          ...completionCore,
          completionDigest,
        };
        completion = Object.freeze({
          ...factBase,
          factDigest: canonicalDigest(factBase),
        });
        repo.invoke('insert_receipt', {
          receipt_id: receipt.receiptId,
          on_deck_run_id: request.onDeckRunId,
          shelf_entry_id: shelfEntryId,
          inventory_revision: inventoryRevision,
          deck_fact_revision: deckFactRevision,
          control_revision_set_digest: controlRevisionSetDigest,
          related_disposition_completion_digest:
            request.relatedDispositionCompletionDigest,
          commit_digest: commitDigest,
          committed_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_completion', {
          offload_completion_id: completion.factId,
          on_deck_run_id: request.onDeckRunId,
          shelf_entry_id: shelfEntryId,
          inventory_revision: inventoryRevision,
          package_id: packageValue.onDeckPackageId,
          completion_digest: completionDigest,
          committed_at_ms: context.commitTimeMs,
        });
        result = Object.freeze({
          schemaRef: RESULT_SCHEMA,
          schemaVersion: 1,
          onDeckCommitReceipt: receipt,
          offloadCompletionFact: completion,
        });
        return result;
      },
    };
    const foundationWrite = {
      participantId: 'arca_ondeck_foundation',
      owner: 'execution-foundation',
      boundBusinessOwner: 'arca',
      repositories: [foundation],
      execute(context) {
        const repo = context.repository(foundation.repositoryId);
        const resultDigest = canonicalDigest(result);
        repo.invoke('insert_result', {
          result_id: resultId,
          event_id: null,
          outcome_kind: 'succeeded',
          result_schema_ref: RESULT_SCHEMA,
          result_json: canonicalJson(result),
          result_digest: resultDigest,
          evidence_schema_ref: verificationRecord.schemaRef,
          evidence_json: canonicalJson(verificationRecord),
          evidence_digest: canonicalDigest(verificationRecord),
          effect_receipt_id: null,
          committed_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_marker', {
          commit_marker: markerId,
          effect_id: null,
          owner_domain: 'arca',
          scope_type: 'on_deck_run',
          scope_id: request.onDeckRunId,
          commit_digest: commitDigest,
          result_id: resultId,
          result_schema_ref: RESULT_SCHEMA,
          result_digest: resultDigest,
          committed_at_ms: context.commitTimeMs,
        });
        const message = Object.freeze({
          messageKind: 'arca.offload.completed@1',
          messageId: stable('arca.offload-completion-message-id@1', {
            onDeckRunId: request.onDeckRunId,
            completionDigest: completion.completionDigest,
          }),
          onDeckPackageId: packageValue.onDeckPackageId,
          packageDigest: packageValue.packageDigest,
          offloadCompletionFact: completion,
        });
        repo.invoke('insert_outbox', {
          message_id: message.messageId,
          producer_domain: 'arca',
          message_kind: message.messageKind,
          aggregate_type: 'on_deck_run',
          aggregate_id: request.onDeckRunId,
          aggregate_revision: 1,
          dedup_key: message.messageId,
          consumer_set_digest: canonicalDigest(['libra']),
          intended_consumer_count: 1,
          payload_schema_ref: COMPLETION_SCHEMA,
          payload_json: canonicalJson(message),
          payload_digest: outboxPayloadDigest(message),
          state: 'pending',
          available_at_ms: context.commitTimeMs,
          created_at_ms: context.commitTimeMs,
          all_acked_at_ms: null,
        });
        repo.invoke('insert_outbox_delivery', {
          message_id: message.messageId,
          consumer_domain: 'libra',
          state: 'pending',
          attempt_count: 0,
          next_attempt_at_ms: context.commitTimeMs,
          acked_at_ms: null,
        });
      },
    };
    try {
      options.unitOfWork.execute([
        replay, verify, ...retainedControlChecks,
        ...[createSeriesPresentationStore(options).commitControlParticipant(request)].filter(Boolean), control, domain,
        ...[createSeriesPresentationStore(options).commitReferenceParticipant(request,shelfEntryId)].filter(Boolean), foundationWrite,
      ]);
      return Object.freeze({ replayed: false, result, commitDigest });
    } catch (error) {
      if (error instanceof Replay) {
        return Object.freeze({
          replayed: true,
          result: error.result,
          commitDigest,
        });
      }
      throw error;
    }
  }

  function finalize(onDeckRunId, decisionDigest) {
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_finalize',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const run = repo.invoke('find_run', { on_deck_run_id: onDeckRunId });
        const receipt = repo.invoke('find_receipt', {
          on_deck_run_id: onDeckRunId,
        });
        if (!run || !receipt ||
            run.final_inventory_decision_digest !== decisionDigest) {
          fail('P14_ONDECK_FINALIZE_FENCE',
            'On-deck Run cannot finalize without its exact Commit Receipt.');
        }
        if (run.state === 'committed') return 'committed';
        if (run.state !== 'offloading' || repo.invoke('advance_run', {
          state: 'committed',
          terminal_at_ms: context.commitTimeMs,
          on_deck_run_id: onDeckRunId,
          expected_state: 'offloading',
          expected_final_inventory_decision_digest: decisionDigest,
        }).changes !== 1) {
          fail('P14_ONDECK_FINALIZE_CAS',
            'On-deck Run finalization lost its state fence.');
        }
        return 'committed';
      },
    }]).arca_ondeck_finalize;
  }

  function readCommittedRecord(request, historical) {
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_committed_read',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const run = repo.invoke('find_run', {
          on_deck_run_id: request.onDeckRunId,
        });
        const receipt = repo.invoke('find_receipt', {
          on_deck_run_id: request.onDeckRunId,
        });
        if (!receipt) return null;
        const completion = repo.invoke('find_completion', {
          on_deck_run_id: request.onDeckRunId,
        });
        const entry = repo.invoke('find_entry', {
          shelf_entry_id: receipt.shelf_entry_id,
        });
        const inventoryHistory = entry &&
          verifyInventoryHistory(
            repo,
            entry.shelf_entry_id,
            Number(historical ? receipt.inventory_revision : entry.current_inventory_revision),
            Number(historical ? receipt.deck_fact_revision : entry.current_deck_fact_revision),
            request.packageDigest,
          );
        if (!run || !completion || !entry ||
            run.custody_id !== request.custodyId ||
            run.final_inventory_decision_digest !==
              request.finalInventoryDecisionDigest ||
            completion.package_id !== request.onDeckPackageId ||
            completion.shelf_entry_id !== receipt.shelf_entry_id ||
            entry.shelf_id !== request.shelfId ||
            inventoryHistory.representation.source_package_id !==
              request.onDeckPackageId) {
          fail('P14_ONDECK_REPLAY_CORRUPT',
            'Committed On-deck result cannot be reconstructed from exact Arca rows.');
        }
        return Object.freeze({
          replayed: true,
          result: resultFromRows(receipt, completion,
            receipt.commit_digest),
          commitDigest: receipt.commit_digest,
        });
      },
    }]).arca_ondeck_committed_read;
  }

  function readCommittedByPackage(request) {
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_package_committed_read',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
        const completion = repo.invoke('find_completion_by_package', {
          package_id: request.onDeckPackageId,
        });
        if (!completion) return null;
        const run = repo.invoke('find_run', {
          on_deck_run_id: completion.on_deck_run_id,
        });
        const receipt = repo.invoke('find_receipt', {
          on_deck_run_id: completion.on_deck_run_id,
        });
        const decision = repo.invoke('find_decision', {
          on_deck_run_id: completion.on_deck_run_id,
        });
        const entry = repo.invoke('find_entry', {
          shelf_entry_id: completion.shelf_entry_id,
        });
        const inventoryHistory = entry && receipt &&
          verifyInventoryHistory(
            repo,
            entry.shelf_entry_id,
            Number(receipt.inventory_revision),
            Number(receipt.deck_fact_revision),
            request.packageDigest,
          );
        let finalInventoryDecision;
        try {
          finalInventoryDecision = decision &&
            JSON.parse(decision.decision_json);
        } catch {
          fail('P14_ONDECK_REPLAY_CORRUPT',
            'Committed Final Inventory Decision JSON is corrupt.');
        }
        if (!run || !receipt || !decision || !entry ||
            !['offloading', 'committed'].includes(run.state) ||
            run.custody_id !== request.custodyId ||
            run.final_inventory_decision_digest !==
              decision.decision_digest ||
            finalInventoryDecision?.decisionDigest !==
              decision.decision_digest ||
            completion.package_id !== request.onDeckPackageId ||
            completion.shelf_entry_id !== receipt.shelf_entry_id ||
            entry.shelf_id !== request.shelfId ||
            inventoryHistory.representation.source_package_id !==
              request.onDeckPackageId) {
          fail('P14_ONDECK_REPLAY_CORRUPT',
            'Committed On-deck package history failed its exact Arca fences.');
        }
        return Object.freeze({
          replayed: true,
          onDeckRunId: run.on_deck_run_id,
          custodyId: run.custody_id,
          finalInventoryDecision: Object.freeze(finalInventoryDecision),
          result: resultFromRows(receipt, completion,
            receipt.commit_digest),
          commitDigest: receipt.commit_digest,
        });
      },
    }]).arca_ondeck_package_committed_read;
  }

  function jsonRow(row) {
    return Object.fromEntries(Object.entries(row).map(([key,value])=>{
      if(typeof value!=='bigint')return [key,value];
      const number=Number(value);
      if(!Number.isSafeInteger(number))fail('ARCA_SERIES_INTEGER_RANGE','Inventory snapshot integer exceeds the exact JSON range.');
      return [key,number];
    }));
  }
  function readSeriesInventoryFromRepo(repo,shelfId,packageValue) {
    if(packageValue?.productStructureSnapshot?.structureKind!=='season')return null;
    const identity=packageValue.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity||packageValue.resolvedIdentitySnapshot?.factValue;
    const {shelfEntryId}=canonicalContentIdentity(shelfId,identity),storedEntry=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId});
    if(!storedEntry)return null;
    const entry=jsonRow(storedEntry);
    if(repo.invoke('list_reservations',{shelf_entry_id:shelfEntryId}).some(row=>row.state==='active'))
      fail('ARCA_SERIES_EXTENSION_RESERVED','Off-deck Reservation prevents Series extension.');
    const params={shelf_entry_id:shelfEntryId,inventory_revision:entry.current_inventory_revision};
    const materials=repo.invoke('list_materials',params).map(jsonRow).sort((a,b)=>Number(a.ordinal)-Number(b.ordinal));
    validateSeriesExtension({entry,materials,packageValue});
    return Object.freeze({entry:Object.freeze(entry),materials:Object.freeze(materials),
      facts:repo.invoke('list_facts',params).map(jsonRow),people:repo.invoke('list_people',params).map(jsonRow),related:repo.invoke('list_related',params).map(jsonRow)});
  }
  function readSeasonInventory(shelfId,packageValue) {
    if(packageValue?.productStructureSnapshot?.structureKind!=='season')return null;
    return options.unitOfWork.execute([{participantId:'arca_series_inventory',owner:'arca',repositories:[arca],execute(context){
      return readSeriesInventoryFromRepo(context.repository(arca.repositoryId),shelfId,packageValue);
    }}]).arca_series_inventory;
  }

  function acquireStagedCustody(request) {
    const previous=readSeasonInventory(request.shelfId,request.package);
    const members = request.stagedInventoryManifest?.stagedMembers || [];
    const keys = [...new Set(members.map((item) =>
      item.physicalIdentity.materialKey))].sort();
    if (keys.length === 0) return Object.freeze({ acquired: 0 });
    const projections = readControlProjections(createMaterialControlProjectionPort(options),keys);
    const byKey = new Map(projections.map((item) => [item.materialKey, item]));
    const custodyScope = Object.freeze({
      ownerDomain: 'arca',
      scopeType: 'on_deck_custody',
      scopeId: request.custodyId,
    });
    const changes = [];
    for (const member of members) {
      const control = byKey.get(member.physicalIdentity.materialKey);
      if (control?.controlState === 'controlled' &&
          control.ownerDomain === 'arca' &&
          control.ownerScopeType === 'on_deck_custody' &&
          control.ownerScopeId === request.custodyId) {
        continue;
      }
      if(previous&&isRetainedSeriesMaterial(previous,member)) {
        if(control?.resultKind!=='available'||control.controlState!=='controlled'||control.ownerDomain!=='arca'||
            control.ownerScopeType!=='shelf_entry'||control.ownerScopeId!==previous.entry.shelf_entry_id)
          fail('P14_ONDECK_RETAINED_CONTROL_CONFLICT','Retained Season Material lost its exact Shelf Entry Control.');
        continue;
      }
      if (!control || control.resultKind !== 'available' ||
          control.controlState !== 'uncontrolled') {
        fail('P14_ONDECK_STAGED_CONTROL_CONFLICT',
          'Staged Inventory Material is already controlled.',
          { materialKey: member.physicalIdentity.materialKey });
      }
      changes.push(Object.freeze({
        identity: member.physicalIdentity,
        action: 'acquire',
        expectedRevision: control.controlRevision,
        expectedProjectionDigest: control.projectionDigest,
        fromScope: null,
        toScope: custodyScope,
      }));
    }
    if (changes.length === 0) return Object.freeze({ acquired: 0 });
    const authorizedControlScopeDigest = controlScopeDigest(changes);
    const basisDigest = request.stagedInventoryManifest.manifestDigest;
    const controlHandle = Object.freeze({
      schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
      schemaVersion: 1,
      handleId: stable('arca.staged-custody-control-handle@1', {
        onDeckRunId: request.onDeckRunId,
        manifestDigest: basisDigest,
      }),
      operationKind: 'acquire',
      ownerDomain: 'arca',
      processType: 'arca_on_deck_run',
      processId: request.onDeckRunId,
      basisRef: Object.freeze({
        objectType: 'staged_inventory_manifest',
        objectId: request.stagedInventoryManifest.manifestId,
        revision: 1,
        digest: basisDigest,
      }),
      basisDigest,
      canonicalFactSetDigest: basisDigest,
      bindingSetDigest: request.stagedInventoryManifest.membersDigest,
      controlScopeDigest: authorizedControlScopeDigest,
      expectedControlRevisions: Object.freeze(changes.map((item) =>
        Object.freeze({
          materialKey: item.identity.materialKey,
          revision: item.expectedRevision,
        }))),
      receiptContract: Object.freeze({
        receiptSchemaRef: 'helix://contracts/types/StagedInventoryManifest/v1',
        controlRevisionSetSchemaRef: 'arca.staged-custody-control-set@1',
      }),
      eventFenceDigest: canonicalDigest({
        schema: 'arca.staged-custody-event-fence@1',
        onDeckRunId: request.onDeckRunId,
        manifestDigest: basisDigest,
      }),
    });
    options.unitOfWork.execute([createMaterialControlParticipant({
      schemaManifest: options.schemaManifest,
      participantId: 'arca_staged_custody_control',
      handle: controlHandle,
      changes,
      authorizedScopeDigest: authorizedControlScopeDigest,
      commitMarker: stable('arca.staged-custody-control-marker@1', {
        onDeckRunId: request.onDeckRunId,
        manifestDigest: basisDigest,
      }),
    })]);
    return Object.freeze({ acquired: changes.length });
  }

  return Object.freeze({
    verifyAcceptedResponsibility,
    readTargetAvailability,
    setOffloading,
    recoveryEligibility,
    attentionRetryEligibility,
    findRunByOffer,
    block,
    requireAttention,
    resume,
    acquireStagedCustody,
    commit,
    readCommitted: request => readCommittedRecord(request, false),
    // Historical responsibility proof uses the receipt's immutable revisions.
    // Current Inventory may legitimately have advanced through Aftercare.
    readHistoricalCommitted: request => readCommittedRecord(request, true),
    readCommittedByPackage,
    finalize,
  });
}

function resultFromRows(receipt, completion, commitDigest) {
  const onDeckCommitReceipt = Object.freeze({
    schemaRef: RECEIPT_SCHEMA,
    schemaVersion: 1,
    receiptId: receipt.receipt_id,
    receiptKind: 'on_deck_committed',
    ownerDomain: 'arca',
    scopeType: 'on_deck_run',
    scopeId: receipt.on_deck_run_id,
    scopeDigest: commitDigest,
    effectReceiptRef: null,
    committedAtMs: Number(receipt.committed_at_ms),
    shelfEntryId: receipt.shelf_entry_id,
    inventoryRevision: Number(receipt.inventory_revision),
    deckFactRevision: Number(receipt.deck_fact_revision),
    controlRevisionSetDigest: receipt.control_revision_set_digest,
    relatedDispositionCompletionDigest:
      receipt.related_disposition_completion_digest,
  });
  const completionCore = {
    onDeckRunId: completion.on_deck_run_id,
    shelfEntryId: completion.shelf_entry_id,
    inventoryRevision: Number(completion.inventory_revision),
    packageId: completion.package_id,
  };
  const offloadCompletionFactBase = {
    schemaRef: COMPLETION_SCHEMA,
    schemaVersion: 1,
    factId: completion.offload_completion_id,
    ownerDomain: 'arca',
    aggregateType: 'on_deck_run',
    aggregateId: completion.on_deck_run_id,
    revision: 1,
    factSchemaRef: 'arca.offload-completion@1',
    commitMarker: stable('arca.on-deck-commit-marker@1', {
      onDeckRunId: completion.on_deck_run_id,
      commitDigest,
    }),
    committedAtMs: Number(completion.committed_at_ms),
    ...completionCore,
    completionDigest: completion.completion_digest,
  };
  const offloadCompletionFact = Object.freeze({
    ...offloadCompletionFactBase,
    factDigest: canonicalDigest(offloadCompletionFactBase),
  });
  return Object.freeze({
    schemaRef: RESULT_SCHEMA,
    schemaVersion: 1,
    onDeckCommitReceipt,
    offloadCompletionFact,
  });
}

module.exports = Object.freeze({
  OnDeckStoreError,
  createOnDeckStore,
  assertAcceptedTargetScope,
  deriveOnDeckControlChanges,
  retiredStagedNfoMembers,
});
