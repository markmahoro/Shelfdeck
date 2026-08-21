'use strict';

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
} = require('../../../foundation/persistence/material-control');
const {
  SCHEMA_REF: EPISODE_CLAIMS_SCHEMA,
  buildArcaMaterialEpisodeClaims,
  parseArcaMaterialEpisodeClaims,
} = require('../model/material-episode-claims');

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

function stable(schema, value) {
  return canonicalDigest({ schema, ...value });
}

function outboxPayloadDigest(value) {
  return canonicalDigest(value);
}

function arcaDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'arca_ondeck_store',
    owner: 'arca',
    schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one',
        tableId: 'arca_ondeck_runs',
        columns: [
          'on_deck_run_id', 'custody_id', 'final_inventory_decision_digest',
          'state', 'created_at_ms', 'terminal_at_ms',
        ],
        keyColumns: ['on_deck_run_id'],
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
          'content_fingerprint', 'digest_hex', 'size_bytes', 'active_guard',
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
          'content_fingerprint', 'digest_hex', 'size_bytes', 'active_guard',
        ],
        keyColumns: ['shelf_entry_id', 'inventory_revision'],
        safeIntegers: true,
      },
      insert_related: {
        kind: 'insert',
        tableId: 'arca_inventory_related_references',
        columns: [
          'shelf_entry_id', 'inventory_revision', 'reference_id',
          'primary_ordinal', 'role', 'material_identity_hint', 'endpoint_id',
          'location', 'checksum_hex',
        ],
      },
      insert_fact: {
        kind: 'insert',
        tableId: 'arca_inventory_product_facts',
        columns: [
          'shelf_entry_id', 'inventory_revision', 'fact_kind',
          'fact_revision', 'fact_schema_ref', 'fact_json', 'fact_digest',
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
      return Object.freeze({
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
    const digestValue = canonicalDigest({
      schema: 'arca.inventory-representation@1',
      shelfEntryId,
      inventoryRevision,
      sourcePackageId: representation?.source_package_id,
      members,
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
            !['ready', 'offloading', 'committed'].includes(existingRun.state) ||
            canonicalJson(parseDecision(existingDecision)) !==
              canonicalJson(decision) ||
            existingDecision.shelf_id !== request.shelf.shelfId ||
            Number(existingDecision.placement_revision) !==
              request.shelf.currentPlacementRevision ||
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

  function setOffloading(onDeckRunId, decisionDigest) {
    return options.unitOfWork.execute([{
      participantId: 'arca_ondeck_start',
      owner: 'arca',
      repositories: [arca],
      execute(context) {
        const repo = context.repository(arca.repositoryId);
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
        return 'offloading';
      },
    }]).arca_ondeck_start;
  }

  function commit(request) {
    const packageValue = request.package;
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
    const canonicalIdentityKey = canonicalDigest({
      schema: 'arca.canonical-content-identity-key@1',
      shelfId: request.shelf.shelfId,
      structureKind: identityValue.structureKind,
      identityKind: identityValue.identityKind,
      provider: providerIdentity.provider || null,
      providerKey: providerIdentity.providerKey || null,
      identityDigest: identityValue.identityDigest,
    });
    const shelfEntryId = stable('arca.shelf-entry-id@1', {
      shelfId: request.shelf.shelfId,
      canonicalIdentityKey,
    });
    const inventoryRevision = 1;
    const deckFactRevision = 1;
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
      materialKey: item.materialKey,
      physicalIdentity: item.physicalIdentity,
      role: item.role,
      endpointId: item.endpointId,
      location: item.location,
      bindingRevision: 1,
      digestHex: item.digestHex,
      sizeBytes: item.sizeBytes,
      episodeClaims: item.episodeClaims,
    }));
    if (canonicalJson(stagedManifestMembers) !==
        canonicalJson(expectedStagedMembers)) {
      fail('P14_ONDECK_STAGED_MANIFEST_DRIFT',
        'Staged Inventory Manifest does not conserve its exact members.');
    }
    const inventoryMembers = Object.freeze(stagedMembers.map(
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
      }),
    ));
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
    const changes = [
      ...[...oldMaterials.values()].map((member) => {
        const control = request.custodyControls.find((item) =>
          item.materialKey === member.materialKey);
        if (!control) {
          fail('P14_ONDECK_CUSTODY_CONTROL_MISSING',
            'On-deck Commit lost a Custody Control member.');
        }
        return Object.freeze({
          identity: member.physicalIdentity,
          action: 'release',
          expectedRevision: control.controlRevision,
          expectedProjectionDigest: control.projectionDigest,
          fromScope: Object.freeze({
            ownerDomain: 'arca',
            scopeType: 'on_deck_custody',
            scopeId: request.custodyId,
          }),
          toScope: null,
        });
      }),
      ...stagedMembers.map((member) => {
        const control = request.targetControls.find((item) =>
          item.materialKey === member.materialKey);
        if (!control || control.controlRevision !== 0 ||
            control.controlState !== 'uncontrolled') {
          fail('P14_ONDECK_TARGET_CONTROL_CONFLICT',
            'Final Inventory target Material is already controlled.');
        }
        return Object.freeze({
          identity: member.physicalIdentity,
          action: 'acquire',
          expectedRevision: 0,
          expectedProjectionDigest: control.projectionDigest,
          fromScope: null,
          toScope: Object.freeze({
            ownerDomain: 'arca',
            scopeType: 'shelf_entry',
            scopeId: shelfEntryId,
          }),
        });
      }),
    ].sort((left, right) =>
      Buffer.compare(Buffer.from(left.identity.materialKey),
        Buffer.from(right.identity.materialKey)));
    if (new Set(changes.map((item) => item.identity.materialKey)).size !==
        changes.length) {
      fail('P14_ONDECK_CONTROL_SET_OVERLAP',
        'Input release and final Inventory acquire sets overlap.');
    }
    const authorizedControlScopeDigest = controlScopeDigest(changes);
    const representationDigest = canonicalDigest({
      schema: 'arca.inventory-representation@1',
      shelfEntryId,
      inventoryRevision,
      sourcePackageId: packageValue.onDeckPackageId,
      members: inventoryMembers,
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
        if (!run || run.custody_id !== request.custodyId ||
            run.state !== 'offloading' ||
            run.final_inventory_decision_digest !==
              request.finalInventoryDecision.decisionDigest ||
            canonicalJson(parseDecision(decision)) !==
              canonicalJson(request.finalInventoryDecision) ||
            repo.invoke('find_entry', { shelf_entry_id: shelfEntryId })) {
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
        repo.invoke('insert_entry', {
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
        repo.invoke('insert_identity', {
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
            active_guard: item.role === 'primary_payload' ? 1 : 0,
          });
        });
        packageValue.productFactManifest.items.forEach((item) => {
          repo.invoke('insert_fact', {
            shelf_entry_id: shelfEntryId,
            inventory_revision: inventoryRevision,
            fact_kind: item.factKind,
            fact_revision: item.factRevision,
            fact_schema_ref: item.schemaRef,
            fact_json: canonicalJson(item.factValue),
            fact_digest: item.factDigest,
            source_package_id: packageValue.onDeckPackageId,
            provenance_digest: item.evidenceDigest,
            committed_at_ms: context.commitTimeMs,
          });
        });
        for (const item of packageValue.mediaCastSnapshot.relations || []) {
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
          evidence_schema_ref:
            request.fulfillmentVerification.schemaRef,
          evidence_json: canonicalJson(request.fulfillmentVerification),
          evidence_digest:
            request.fulfillmentVerificationDigest,
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
        replay, verify, control, domain, foundationWrite,
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

  function readCommitted(request) {
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
            Number(entry.current_inventory_revision),
            Number(entry.current_deck_fact_revision),
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
        const inventoryHistory = entry &&
          verifyInventoryHistory(
            repo,
            entry.shelf_entry_id,
            Number(entry.current_inventory_revision),
            Number(entry.current_deck_fact_revision),
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

  return Object.freeze({
    verifyAcceptedResponsibility,
    setOffloading,
    commit,
    readCommitted,
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
});
