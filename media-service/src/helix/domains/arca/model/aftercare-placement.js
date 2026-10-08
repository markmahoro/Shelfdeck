'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { physicalIdentityFromInventoryRow } = require('./aftercare-contract');
const {readInventoryArtifactScope}=require('./inventory-artifact-scope');
const {aftercareProviderIdentity}=require('./aftercare-provider-identity');

const PLACEMENT_LAYOUT_FIELDS = Object.freeze([
  'folderTemplate',
  'primaryTemplate',
  'nfoTemplate',
  'subtitleTemplate',
  'posterTemplate',
  'fanartTemplate',
]);

function classifyAcceptedPlacement(context) {
  const initial = context?.raw?.initialPlacementDecision;
  const initialPolicy = context?.raw?.initialPlacement?.value;
  const currentPolicy = context?.raw?.placement?.value;
  const shelf = context?.raw?.shelf;
  if (!initial || !initialPolicy || !currentPolicy || !shelf) {
    return Object.freeze({ state:'not_assessable', reasonCode:'placement_baseline_unavailable' });
  }
  const currentRoot = path.resolve(shelf.target_root_location);
  const initialTarget = path.resolve(initial.target_location);
  const endpointChanged = initial.target_endpoint_id !== shelf.target_endpoint_id;
  const rootChanged = initialTarget !== currentRoot &&
    !initialTarget.startsWith(currentRoot + path.sep);
  const layoutChanged = PLACEMENT_LAYOUT_FIELDS.some((field) =>
    initialPolicy[field] !== currentPolicy[field]);
  if (endpointChanged || rootChanged || layoutChanged) {
    return Object.freeze({ state:'recompute', reasonCode:endpointChanged
      ? 'target_endpoint_changed' : rootChanged ? 'target_root_changed' : 'layout_policy_changed' });
  }
  return Object.freeze({ state:'accepted', reasonCode:Number(initial.placement_revision) ===
    Number(context.basis?.placementRevision) ? 'accepted_revision_current' :
    'non_layout_policy_change' });
}

function metadataIdentity(context) {
  const resolvedFact = context.raw.facts.find((item) =>
    item.fact_kind === 'resolved_identity')?.value || {};
  const resolvedIdentity=resolvedFact.resolvedProductIdentity||resolvedFact;
  const displayEntries = new Map((resolvedIdentity.displayIdentity?.entries || [])
    .map((item) => [item.key, item.value]));
  const metadata = context.raw.facts.find((item) =>
    item.fact_kind === 'product_metadata')?.value || {};
  const entries = new Map((metadata.descriptiveFacts?.entries || [])
    .map((item) => [item.key, item.value]));
  const title = displayEntries.get('title') || entries.get('title') ||
    (context.raw.entry.structure_kind==='season'?entries.get('series_title'):null) ||
    entries.get('display_title') ||
    (context.raw.entry.structure_kind==='season'?null:context.raw.identity.provider_key || context.shelfEntryId);
  if(typeof title!=='string'||!title.trim())throw new TypeError('Aftercare placement requires an accepted display title.');
  const rawYear = displayEntries.get('year') || entries.get('year') ||
    entries.get('year_or_release_date') || entries.get('release_year') ||
    entries.get('release_date') || null;
  const yearMatch = String(rawYear || '').match(/^(\d{4})(?:\D|$)/);
  const year = yearMatch && Number.isSafeInteger(Number(yearMatch[1]))
    ? Number(yearMatch[1]) : null;
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
  const series=context.raw.entry.structure_kind==='season';
  let seriesIdentity;
  if(series) {
    aftercareProviderIdentity(context,{providerId:context.raw.identity.provider,
      providerObjectId:context.raw.identity.provider_key,identityDigest:context.raw.identity.identity_digest});
    const fact=context.raw.facts.find(item=>item.fact_kind==='resolved_identity').value;
    seriesIdentity=fact.resolvedProductIdentity||fact;
  }
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
    resolvedIdentitySnapshot: Object.freeze({ factValue:series?Object.freeze({...seriesIdentity,...identity}):identity }),
    ...(series?{productFactManifest:Object.freeze({items:Object.freeze(context.raw.facts.map(item=>
      Object.freeze({factKind:item.fact_kind,factValue:item.value,sourcePackageId:item.source_package_id})))})}:{}),
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
    ...(series?{inventoryArtifactScopes:Object.freeze(context.raw.materials.filter(item=>item.role==='metadata_sidecar')
      .map(item=>Object.freeze({materialKey:item.material_key,scope:readInventoryArtifactScope(item)})))}:{}),
  };
  const finalInventoryDecision = inventoryPort.prepare(base);
  return Object.freeze({ ...base, finalInventoryDecision });
}

function placementMatchesInventory(context,request) {
  const members=request.finalInventoryDecision.members,materials=context.raw.materials;
  if(!Array.isArray(members)||members.length!==materials.length||
      new Set(members.map(item=>item.sourceMaterialKey)).size!==members.length||
      members.some(item=>!materials.some(row=>row.material_key===item.sourceMaterialKey)))
    throw new TypeError('Aftercare placement decision does not cover the exact current Inventory.');
  return members.every(item=>{
    const row=materials.find(row=>row.material_key===item.sourceMaterialKey);
    return item.targetEndpointId===row.endpoint_id&&path.resolve(item.targetLocation)===path.resolve(row.location);
  });
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
  return Object.freeze(manifest.stagedMembers.flatMap((member) => {
    const source = previous.get(member.sourceMaterialKey);
    if (!source) {
      throw new Error('Aftercare staged member has no current Inventory source.');
    }
    const retiredIdentity = physicalIdentityFromInventoryRow(source);
    const sourcePath=path.resolve(source.location),targetPath=path.resolve(member.location),
      sameLocation=process.platform==='win32'?sourcePath.toLowerCase()===targetPath.toLowerCase():sourcePath===targetPath;
    if(source.endpoint_id===member.endpointId&&sameLocation&&retiredIdentity.materialKey===member.physicalIdentity.materialKey)
      return [];
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
        finalMaterialKey: member.physicalIdentity.materialKey,
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
        requiresSettlement: !sameLocation,
      })]),
    };
    return [Object.freeze(base)];
  }).sort((left, right) => left.finalMaterialIdentity.materialKey.localeCompare(
    right.finalMaterialIdentity.materialKey)));
}

module.exports = Object.freeze({ buildAftercareInventoryRequest, classifyAcceptedPlacement,
  metadataIdentity, placementMaterialReceipts, placementMatchesInventory });
