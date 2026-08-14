'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { physicalIdentityFromInventoryRow } = require('./aftercare-contract');

function metadataIdentity(context) {
  const metadata = context.raw.facts.find((item) =>
    item.fact_kind === 'product_metadata')?.value || {};
  const entries = new Map((metadata.descriptiveFacts?.entries || [])
    .map((item) => [item.key, item.value]));
  const title = entries.get('title') || entries.get('display_title') ||
    context.raw.identity.provider_key || context.shelfEntryId;
  const rawYear = entries.get('year') || entries.get('release_year') || null;
  const year = Number.isSafeInteger(Number(rawYear)) ? Number(rawYear) : null;
  return Object.freeze({ title, year });
}

function inventoryMember(row) {
  const physicalIdentity = physicalIdentityFromInventoryRow(row);
  const episodeClaims = JSON.parse(row.episode_claims_json);
  const base = {
    ordinal: Number(row.ordinal),
    materialKey: row.material_key,
    role: row.role,
    physicalIdentity,
    sizeBytes: Number(row.size_bytes),
    location: Object.freeze({
      locationKind: 'physical_path',
      endpointId: row.endpoint_id,
      location: row.location,
    }),
    bindingRevision: Number(row.binding_revision),
    episodeClaims: Object.freeze(episodeClaims.items || episodeClaims.claims || []),
    episodeClaimSetDigest: row.episode_claim_set_digest,
  };
  return Object.freeze({ ...base, memberDigest:canonicalDigest(base) });
}

function buildAftercareInventoryRequest(context, inventoryPort, at, caseId) {
  const members = context.raw.materials.map(inventoryMember)
    .sort((left, right) => left.materialKey.localeCompare(right.materialKey));
  const identity = metadataIdentity(context);
  const manifestBase = {
    manifestId: caseId + ':placement-product-manifest',
    manifestRevision: 1,
    members: Object.freeze(members),
  };
  const productMaterialManifest = Object.freeze({
    ...manifestBase,
    manifestDigest: canonicalDigest(manifestBase),
  });
  const offloadBase = {
    manifestId: caseId + ':placement-offload-context',
    manifestRevision: 1,
    members: Object.freeze([]),
  };
  const offloadContextManifest = Object.freeze({
    ...offloadBase,
    manifestDigest: canonicalDigest(offloadBase),
  });
  const packageBase = {
    onDeckPackageId: caseId + ':placement-package',
    packageRevision: 1,
    shelfId: context.raw.shelf.shelf_id,
    productStructureSnapshot: Object.freeze({
      structureKind: context.raw.entry.structure_kind === 'season' ? 'season' : 'single',
    }),
    resolvedIdentitySnapshot: Object.freeze({ factValue:identity }),
    productMaterialManifest,
    offloadContextManifest,
  };
  const onDeckProductPackage = Object.freeze({
    ...packageBase,
    packageDigest: canonicalDigest(packageBase),
  });
  const shelf = Object.freeze({
    shelfId: context.raw.shelf.shelf_id,
    status: context.raw.shelf.status,
    currentStandardRevision: Number(context.raw.shelf.current_standard_revision),
    currentPlacementRevision: Number(context.raw.shelf.current_placement_revision),
    target: Object.freeze({
      endpointId: context.raw.shelf.target_endpoint_id,
      rootLocation: context.raw.shelf.target_root_location,
      mountScopeId: context.raw.shelf.target_mount_scope_id,
      mountScopeRevision: Number(context.raw.shelf.target_mount_scope_revision),
    }),
    placement: Object.freeze({
      revision: Number(context.raw.placement.revision),
      value: context.raw.placement.value,
      digest: context.raw.placement.policy_digest,
    }),
  });
  const base = {
    onDeckRunId: caseId,
    custodyId: caseId,
    aftercareCaseId: caseId,
    shelf,
    onDeckProductPackage,
    observedAtMs: at,
    replayCommitted: false,
  };
  const finalInventoryDecision = inventoryPort.prepare(base);
  return Object.freeze({ ...base, finalInventoryDecision });
}

function placementMaterialReceipts(context, workResultReader, sourceWorkId,
    aftercareCase, frozenMaterials = context.raw.materials) {
  if (!sourceWorkId) return Object.freeze([]);
  const results = workResultReader.read(sourceWorkId)
    .filter((item) => item.outcomeKind === 'succeeded');
  const manifest = results.find((item) =>
    item.result?.schemaRef ===
      'helix://contracts/types/StagedInventoryManifest/v1')?.result;
  const placement = results.find((item) =>
    item.result?.receiptKind === 'placement_switched')?.result;
  if (!manifest || !placement) return Object.freeze([]);
  const previous = new Map(frozenMaterials.map((item) =>
    [item.material_key, item]));
  return Object.freeze(manifest.stagedMembers.map((member) => {
    const source = previous.get(member.sourceMaterialKey);
    if (!source) {
      throw new Error('Aftercare staged member has no current Inventory source.');
    }
    const retiredIdentity = physicalIdentityFromInventoryRow(source);
    const targetBindingDigest = canonicalDigest({
      endpointId: member.endpointId,
      location: member.location,
      identity: member.physicalIdentity,
    });
    const base = {
      schemaRef: 'helix://contracts/types/MaterialEffectReceipt/v1',
      schemaVersion: 1,
      receiptId: canonicalDigest({
        schema: 'arca.aftercare-placement-material-receipt-id@1',
        aftercareCaseId: aftercareCase.aftercareCaseId,
        sourceMaterialKey: member.sourceMaterialKey,
        finalMaterialKey: member.materialKey,
      }),
      receiptKind: 'aftercare_placement_materialized',
      ownerDomain: 'arca',
      scopeType: 'aftercare_case',
      scopeId: aftercareCase.aftercareCaseId,
      scopeDigest: aftercareCase.careRequirementDigest,
      effectReceiptRef: placement.effectReceiptRef || null,
      committedAtMs: placement.committedAtMs,
      targetBindingDigest,
      materialEffectKind: 'placement_migrate',
      effectReceiptId: placement.receiptId,
      finalRealityDigest: canonicalDigest({
        identity: member.physicalIdentity,
        endpointId: member.endpointId,
        location: member.location,
      }),
      finalMaterialIdentity: member.physicalIdentity,
      targetEndpointId: member.endpointId,
      targetLocation: member.location,
      retiredMaterials: Object.freeze([Object.freeze({
        identity: retiredIdentity,
        location: source.location,
        requiresSettlement: true,
      })]),
    };
    return Object.freeze(base);
  }).sort((left, right) => left.finalMaterialIdentity.materialKey.localeCompare(
    right.finalMaterialIdentity.materialKey)));
}

module.exports = Object.freeze({ buildAftercareInventoryRequest, metadataIdentity,
  placementMaterialReceipts });
