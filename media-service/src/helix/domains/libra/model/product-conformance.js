'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildMediaRequirement } = require('./media-production-contracts');

class ProductConformanceError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductConformanceError'; this.code = code; }
}

const fail = (code, message) => { throw new ProductConformanceError(code, message); };
const DIGEST = /^[a-f0-9]{64}$/;
const UNMET_ORDER = Object.freeze(['identity_unmet', 'season_identity_unmet', 'structure_unmet',
  'episode_coverage_unmet', 'metadata_field_unmet', 'metadata_artifact_unmet', 'sidecar_unrenderable',
  'image_undecodable', 'media_form_unmet', 'video_codec_unmet', 'container_unmet', 'file_extension_unmet',
  'minimum_raster_unmet', 'system_upscale_forbidden', 'primary_audio_unmet', 'max_size_exceeded',
  'domain_binding_unmet', 'checksum_unmet', 'artifact_materialization_unmet', 'layout_unmet']);
const FACT_SCHEMAS = Object.freeze({
  resolved_identity: 'helix://contracts/types/ResolvedProductIdentity/v1',
  product_metadata: 'helix://contracts/types/ProductMetadataFact/v1',
  media_cast: 'helix://contracts/types/MediaCastFact/v1'
});

function clone(value) { return JSON.parse(canonicalJson(value)); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function digest(value, name) {
  if (!DIGEST.test(value || '')) fail('P9_CONFORMANCE_DIGEST', name + ' is invalid.');
  return value;
}
function text(value, name) {
  if (typeof value !== 'string' || !value) fail('P9_CONFORMANCE_VALUE', name + ' is required.');
  return value;
}
function without(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }
function assertDigest(value, field, code = 'P9_CONFORMANCE_INTEGRITY') {
  if (!value || canonicalDigest(without(value, field)) !== value[field]) fail(code, field + ' does not match the complete typed value.');
}
function assertSorted(values, comparator, code) {
  const sorted = [...values].sort(comparator);
  if (canonicalJson(sorted) !== canonicalJson(values)) fail(code, 'Typed collection order is not canonical.');
}
const utf8 = (left, right) => Buffer.from(left).compare(Buffer.from(right));

function expectedFactDigest(kind, value) {
  if (kind === 'resolved_identity') return value?.identityDigest;
  return value?.factDigest;
}

function validateFactValue(kind, value) {
  if (kind === 'resolved_identity') {
    for (const item of value.providerIdentities || []) assertDigest(item, 'identityAnchorDigest');
    if (canonicalDigest({schema:'libra.resolved-provider-identity-set@1',items:value.providerIdentities}) !== value.providerIdentitySetDigest ||
        canonicalDigest({schema:'libra.resolved-product-identity@1',subjectId:value.subjectId,structureKind:value.structureKind,
          contentProfile:value.contentProfile,identityKind:value.identityKind,providerIdentities:value.providerIdentities,
          providerIdentitySetDigest:value.providerIdentitySetDigest,exactSeasonContinuityClaims:value.exactSeasonContinuityClaims,
          exactSeasonContinuitySetDigest:value.exactSeasonContinuitySetDigest,displayIdentity:value.displayIdentity}) !== value.identityDigest)
      fail('P9_CONFORMANCE_FACT_VALUE', 'Resolved Product Identity digest closure failed.');
  } else if (kind === 'product_metadata') {
    const body={subjectId:value.subjectId,resolvedIdentityDigest:value.resolvedIdentityDigest,sourceBasisKind:value.sourceBasisKind,
      sourceBasisDigest:value.sourceBasisDigest,metadataObservationSetDigest:value.metadataObservationSetDigest,
      westernAnalysisVariantDigest:value.westernAnalysisVariantDigest,fieldProvenance:value.fieldProvenance,
      descriptiveFacts:value.descriptiveFacts,providerIdentities:value.providerIdentities,mediaCastFactRef:value.mediaCastFactRef,
      verifiedArtifactManifestDigest:value.verifiedArtifactManifestDigest};
    if(canonicalDigest({schema:'libra.product-metadata@1',...body})!==value.productMetadataDigest||value.factDigest!==value.productMetadataDigest)
      fail('P9_CONFORMANCE_FACT_VALUE','Product Metadata Fact digest closure failed.');
  } else {
    const relationsDigest=canonicalDigest({schema:'libra.media-cast-relations@1',relations:value.relations});
    const factDigest=canonicalDigest({schema:'libra.media-cast-fact@1',subjectId:value.subjectId,sourceBasisKind:value.sourceBasisKind,
      sourceBasisDigest:value.sourceBasisDigest,relations:value.relations,relationsDigest,relationCount:value.relations.length});
    if(value.relationsDigest!==relationsDigest||value.relationCount!==value.relations.length||value.factDigest!==factDigest)
      fail('P9_CONFORMANCE_FACT_VALUE','Media Cast Fact digest closure failed.');
  }
}

function buildProductConformanceFactSnapshot(value) {
  const factKind = text(value?.factKind, 'factKind'), factValue = clone(value?.factValue);
  if (!Object.hasOwn(FACT_SCHEMAS, factKind) || factValue?.schemaRef !== FACT_SCHEMAS[factKind])
    fail('P9_CONFORMANCE_FACT_KIND', 'Product Fact variant and typed value disagree.');
  validateFactValue(factKind, factValue);
  const result = { productFactId:text(value.productFactId, 'productFactId'), factKind,
    factRevision:value.factRevision, schemaRef:FACT_SCHEMAS[factKind], factValue,
    factDigest:digest(value.factDigest, 'factDigest'), evidenceDigest:digest(value.evidenceDigest, 'evidenceDigest') };
  if (!Number.isSafeInteger(result.factRevision) || result.factRevision < 1 ||
      (factKind !== 'resolved_identity' && (result.productFactId !== factValue.factId || result.factRevision !== factValue.revision)) ||
      expectedFactDigest(factKind, factValue) !== result.factDigest)
    fail('P9_CONFORMANCE_FACT_CONTINUITY', 'Product Fact ID, revision, or digest continuity failed.');
  result.referenceDigest = canonicalDigest(result);
  return freeze(result);
}

function validateArtifactVerificationSnapshot(value, manifestItem) {
  const result = clone(value), verified = result?.verifiedManifestItem, verification = result?.verificationValue;
  if (!Number.isSafeInteger(result?.ordinal) || result.ordinal < 0 || verified?.ordinal !== result.ordinal ||
      canonicalJson(result.verificationResultRef) !== canonicalJson(verified?.verificationResultRef) ||
      result.verificationResultRef?.resultDigest !== canonicalDigest(verification) || verification?.result !== 'passed' ||
      verification?.schemaRef !== 'helix://contracts/types/ArtifactManifestVerification/v1')
    fail('P9_CONFORMANCE_ARTIFACT_VERIFICATION', 'Artifact verification snapshot is not closed over its passed Result.');
  if (!verification.verifiedArtifacts?.some((item) => item.artifactHandleId === verified.artifactHandleId &&
      item.artifactRevision === verified.artifactRevision && item.artifactDigest === verified.artifactDigest))
    fail('P9_CONFORMANCE_ARTIFACT_VERIFICATION', 'Artifact verification Result does not cover the manifest item.');
  const requirement=verification.requirement,expectedRequirementDigest=canonicalDigest({schema:'shared.artifact-requirement@1',
    revision:requirement?.revision,schemaRef:requirement?.schemaRef,artifactKind:requirement?.artifactKind,requirementPayload:requirement?.requirementPayload}),
    expectedRequirementId=canonicalDigest({schema:'shared.artifact-requirement-id@1',requirementDigest:expectedRequirementDigest});
  if(!requirement||requirement.requirementDigest!==expectedRequirementDigest||requirement.requirementId!==expectedRequirementId||
      verified.requirementId!==requirement.requirementId||verified.requirementRevision!==requirement.revision||
      verified.requirementSchemaRef!==requirement.schemaRef||verified.requirementDigest!==requirement.requirementDigest)
    fail('P9_CONFORMANCE_ARTIFACT_REQUIREMENT','Artifact verification Requirement continuity failed.');
  const verificationItems=verification.verifiedArtifacts;
  assertSorted(verificationItems,(a,b)=>utf8(a.artifactKind,b.artifactKind)||utf8(a.artifactHandleId,b.artifactHandleId)||
    a.artifactRevision-b.artifactRevision,'P9_CONFORMANCE_ARTIFACT_VERIFICATION');
  verificationItems.forEach((item,ordinal)=>{if(item.ordinal!==ordinal)fail('P9_CONFORMANCE_ARTIFACT_VERIFICATION','Artifact verification ordinal is invalid.');
    assertDigest(item,'referenceDigest');});
  const expectedManifestDigest=canonicalDigest({schema:'shared.artifact-verification-input-manifest@1',
    requirementDigest:requirement.requirementDigest,items:verificationItems});
  const expectedBasisDigest=canonicalDigest({schema:'shared.artifact-manifest-verification-basis@1',manifestDigest:expectedManifestDigest,
    requirementDigest:requirement.requirementDigest});
  if(verification.manifestDigest!==expectedManifestDigest||verification.basisDigest!==expectedBasisDigest||
      verification.verificationId!==canonicalDigest({schema:'shared.artifact-manifest-verification-id@1',manifestDigest:expectedManifestDigest,
        requirementDigest:requirement.requirementDigest,basisDigest:expectedBasisDigest})||
      canonicalJson(verification.artifactDigests)!==canonicalJson(verificationItems.map((item)=>item.artifactDigest))||
      verification.verificationDigest!==canonicalDigest(without(verification,'verificationDigest'))||
      verified.verificationEvidenceId!==verification.verificationId||verified.verificationEvidenceDigest!==verification.verificationDigest)
    fail('P9_CONFORMANCE_ARTIFACT_VERIFICATION','Artifact verification digest closure failed.');
  if (result.artifactManifestItem !== null && (!manifestItem ||
      ['artifactHandleId','artifactKind','artifactRevision','artifactDigest','requirementDigest'].some((key) =>
        result.artifactManifestItem[key] !== verified[key] || result.artifactManifestItem[key] !== manifestItem[key])))
    fail('P9_CONFORMANCE_ARTIFACT_CONTINUITY', 'Artifact materialization does not match the verified item.');
  assertDigest(result, 'snapshotDigest');
  return freeze(result);
}

function validateInventory(value, libraRunId) {
  const inventory = clone(value), structure = inventory?.productStructureSnapshot,
    material = inventory?.productMaterialManifest, artifact = inventory?.artifactManifest;
  if (!structure || !material || !artifact || material.libraRunId !== libraRunId || artifact.libraRunId !== libraRunId)
    fail('P9_CONFORMANCE_INVENTORY', 'Product inventory does not belong to the exact Libra Run.');
  assertDigest(structure, 'productStructureDigest');
  if(material.manifestRole!=='product_delivery'||material.members.length<1||material.members.length>1024)
    fail('P9_CONFORMANCE_MATERIAL_MANIFEST','Conformance requires one bounded Product Delivery Manifest.');
  assertSorted(material.members,(a,b)=>utf8(a.materialKey,b.materialKey),'P9_CONFORMANCE_MATERIAL_ORDER');
  const episodeByKey=new Map();
  material.members.forEach((member,ordinal)=>{
    if(member.ordinal!==ordinal)fail('P9_CONFORMANCE_MATERIAL_ORDER','Material ordinal is not continuous.');
    assertDigest(member,'memberDigest');
    assertSorted(member.episodeClaims,(a,b)=>utf8(a.episodeKey,b.episodeKey),'P9_CONFORMANCE_EPISODE_ORDER');
    for(const claim of member.episodeClaims){
      if(canonicalDigest({schema:'libra.production-material-episode-claim@1',episodeKey:claim.episodeKey,
        seasonClaimDigest:claim.seasonClaimDigest})!==claim.claimDigest)fail('P9_CONFORMANCE_EPISODE_CLAIM','Episode Claim digest is invalid.');
      const previous=episodeByKey.get(claim.episodeKey);
      if(previous&&canonicalJson(previous)!==canonicalJson(claim))fail('P9_CONFORMANCE_EPISODE_CLAIM','Episode Claim tuple conflicts.');
      episodeByKey.set(claim.episodeKey,claim);
    }
    if(canonicalDigest({schema:'libra.production-material-episode-claims@1',items:member.episodeClaims})!==member.episodeClaimSetDigest)
      fail('P9_CONFORMANCE_EPISODE_CLAIM','Episode Claim set digest is invalid.');
  });
  const episodeScope=[...episodeByKey.values()].sort((a,b)=>utf8(a.episodeKey,b.episodeKey));
  if(canonicalDigest({schema:'libra.production-material-members@1',items:material.members})!==material.memberSetDigest||
      canonicalDigest({schema:'libra.production-episode-scope@1',items:episodeScope})!==material.episodeScopeDigest)
    fail('P9_CONFORMANCE_MATERIAL_MANIFEST','Material Manifest set digest is invalid.');
  assertDigest(material, 'manifestDigest');
  assertSorted(artifact.items,(a,b)=>utf8(a.artifactKind,b.artifactKind)||utf8(a.artifactHandleId,b.artifactHandleId)||a.artifactRevision-b.artifactRevision,
    'P9_CONFORMANCE_ARTIFACT_ORDER');
  for(const item of artifact.items)assertDigest(item,'referenceDigest');
  if(canonicalDigest({schema:'libra.product-artifact-set@1',items:artifact.items})!==artifact.artifactSetDigest)
    fail('P9_CONFORMANCE_ARTIFACT_MANIFEST','Artifact Manifest set digest is invalid.');
  assertDigest(artifact, 'manifestDigest');
  assertDigest(inventory, 'inventoryDigest');
  if(structure.episodeScopeDigest!==material.episodeScopeDigest||structure.primaryMaterialCount!==material.members.filter((item)=>item.role==='primary_payload').length||
      structure.structuralDependencyCount!==material.members.filter((item)=>item.role==='structural_dependency').length)
    fail('P9_CONFORMANCE_INVENTORY','Structure summary does not match the Product Material Manifest.');
  return freeze(inventory);
}

function buildProductConformanceInputSnapshot(value) {
  const acceptanceSpec = clone(value?.acceptanceSpec), libraRunId = text(value?.libraRunId, 'libraRunId'),
    runExecutionBasisDigest = digest(value?.runExecutionBasisDigest, 'runExecutionBasisDigest');
  if (acceptanceSpec?.schemaRef !== 'libra.acceptance-spec@1' || acceptanceSpec.acceptanceSpecId !== value.acceptanceSpecId ||
      acceptanceSpec.recordDigest !== value.acceptanceSpecRecordDigest)
    fail('P9_CONFORMANCE_SPEC', 'Acceptance Spec does not match the frozen Run basis reference.');
  const facts = value.productFactSnapshots.map((item) => buildProductConformanceFactSnapshot(item));
  if (facts.length < 1 || facts.length > 3) fail('P9_CONFORMANCE_FACT_SET', 'Product Fact set cardinality is invalid.');
  assertSorted(facts, (a, b) => utf8(a.factKind, b.factKind) || utf8(a.productFactId, b.productFactId) || a.factRevision - b.factRevision,
    'P9_CONFORMANCE_FACT_ORDER');
  if (new Set(facts.map((item) => item.factKind)).size !== facts.length || facts.filter((item) => item.factKind === 'resolved_identity').length !== 1)
    fail('P9_CONFORMANCE_FACT_SET', 'Product Fact set must contain exactly one resolved identity and at most one optional Fact kind.');
  const resolvedIdentitySnapshot = facts.find((item) => item.factKind === 'resolved_identity');
  if (canonicalJson(value.resolvedIdentitySnapshot) !== canonicalJson(resolvedIdentitySnapshot))
    fail('P9_CONFORMANCE_RESOLVED_IDENTITY', 'Resolved identity snapshot is not the exact Fact set member.');
  const inventorySnapshot = validateInventory(value.inventorySnapshot, libraRunId), verifiedArtifactManifest = clone(value.verifiedArtifactManifest);
  if (verifiedArtifactManifest?.libraRunId !== libraRunId) fail('P9_CONFORMANCE_ARTIFACT_MANIFEST', 'Verified Artifact Manifest belongs to another Run.');
  assertSorted(verifiedArtifactManifest.items,(a,b)=>utf8(a.artifactKind,b.artifactKind)||utf8(a.artifactHandleId,b.artifactHandleId)||
    a.artifactRevision-b.artifactRevision,'P9_CONFORMANCE_ARTIFACT_ORDER');
  verifiedArtifactManifest.items.forEach((item,ordinal)=>{if(item.ordinal!==ordinal)fail('P9_CONFORMANCE_ARTIFACT_ORDER','Verified Artifact ordinal is not continuous.');
    assertDigest(item,'referenceDigest');});
  if(canonicalDigest({schema:'libra.verified-artifact-set@1',items:verifiedArtifactManifest.items})!==verifiedArtifactManifest.artifactSetDigest||
      canonicalDigest({schema:'libra.verified-artifact-manifest-id@1',libraRunId,artifactSetDigest:verifiedArtifactManifest.artifactSetDigest})!==
        verifiedArtifactManifest.manifestId)fail('P9_CONFORMANCE_ARTIFACT_MANIFEST','Verified Artifact Manifest identity is invalid.');
  assertDigest(verifiedArtifactManifest, 'manifestDigest');
  const artifactItems = new Map((inventorySnapshot.artifactManifest.items || []).map((item) => [item.artifactHandleId, item]));
  const artifactVerificationSnapshots = value.artifactVerificationSnapshots.map((item) =>
    validateArtifactVerificationSnapshot(item, artifactItems.get(item.verifiedManifestItem?.artifactHandleId)));
  assertSorted(artifactVerificationSnapshots, (a, b) => a.ordinal - b.ordinal, 'P9_CONFORMANCE_ARTIFACT_ORDER');
  if (artifactVerificationSnapshots.length !== verifiedArtifactManifest.items.length ||
      artifactVerificationSnapshots.some((item, index) => item.ordinal !== index ||
        canonicalJson(item.verifiedManifestItem) !== canonicalJson(verifiedArtifactManifest.items[index])))
    fail('P9_CONFORMANCE_ARTIFACT_COVERAGE', 'Artifact verification snapshots must exactly cover the verified manifest.');
  const mediaRequirement=buildMediaRequirement(acceptanceSpec),selectedProducts = value.selectedProducts.map((item) => clone(item));
  assertSorted(selectedProducts, (a, b) => utf8(a.selectedProduct.selectedHandleId, b.selectedProduct.selectedHandleId) ||
    utf8(a.selectedProduct.selectedVerificationId, b.selectedProduct.selectedVerificationId), 'P9_CONFORMANCE_SELECTED_ORDER');
  if (!selectedProducts.length || selectedProducts.length > 32 || new Set(selectedProducts.map((item) =>
    item.selectedProduct.selectedHandleId + '\0' + item.selectedProduct.selectedVerificationId)).size !== selectedProducts.length)
    fail('P9_CONFORMANCE_SELECTED_SET', 'Selected Product set cardinality or identity is invalid.');
  for (const item of selectedProducts) {
    const selected = item.selectedProduct, verification = item.verification;
    if (selected.result !== 'selected' || verification.result !== 'passed' ||
        selected.selectedVerificationId !== verification.verificationId || selected.selectedVerificationDigest !== canonicalDigest(verification) ||
        selected.selectedHandleId !== verification.productMaterialHandleId || selected.libraRunId !== libraRunId || verification.libraRunId !== libraRunId ||
        selected.acceptanceSpecId!==acceptanceSpec.acceptanceSpecId||selected.mediaRequirementDigest!==mediaRequirement.requirementDigest||
        verification.mediaRequirementId!==mediaRequirement.requirementId||verification.mediaRequirementDigest!==mediaRequirement.requirementDigest||
        verification.reasonCodes.length!==0||
        (verification.candidateKind === 'workspace_output') !== Boolean(item.workspaceHandleDigest))
      fail('P9_CONFORMANCE_SELECTED_CONTINUITY', 'Selected Product and passed verification continuity failed.');
    const expectedVerificationId=canonicalDigest({schema:'libra.product-media-verification-id@1',candidateId:verification.candidateId,
      candidateNodeId:verification.candidateNodeId,candidateBasisDigest:verification.candidateBasisDigest,candidateKind:verification.candidateKind,
      libraRunId:verification.libraRunId,productMaterialHandleId:verification.productMaterialHandleId,
      productMaterialFenceDigest:verification.productMaterialFenceDigest,mediaRequirementDigest:verification.mediaRequirementDigest,
      sourceProbeEvidenceDigest:verification.sourceProbeEvidenceDigest,outputProbeEvidenceDigest:verification.outputProbeEvidenceDigest});
    if(verification.verificationId!==expectedVerificationId)fail('P9_CONFORMANCE_SELECTED_CONTINUITY','Product Media Verification identity is invalid.');
  }
  const productFactSetDigest = canonicalDigest({ schema:'libra.product-conformance-fact-set@1', items:facts });
  const artifactVerificationSetDigest = canonicalDigest({ schema:'libra.product-conformance-artifact-verification-set@1', items:artifactVerificationSnapshots });
  const selectedProductSetDigest = canonicalDigest({ schema:'libra.product-conformance-selected-product-set@1', items:selectedProducts });
  const productSnapshotDigest = canonicalDigest({ schema:'libra.product-conformance-product-snapshot@1',
    resolvedIdentityReferenceDigest:resolvedIdentitySnapshot.referenceDigest,
    productStructureDigest:inventorySnapshot.productStructureSnapshot.productStructureDigest, productFactSetDigest,
    verifiedArtifactManifestDigest:verifiedArtifactManifest.manifestDigest, artifactVerificationSetDigest,
    inventoryDigest:inventorySnapshot.inventoryDigest, selectedProductSetDigest });
  const result = { snapshotId:'', libraRunId, runExecutionBasisDigest, acceptanceSpec,
    resolvedIdentitySnapshot, productStructureSnapshot:inventorySnapshot.productStructureSnapshot,
    productFactSnapshots:facts, verifiedArtifactManifest, artifactVerificationSnapshots,
    inventorySnapshot, selectedProducts, productFactSetDigest, artifactVerificationSetDigest,
    selectedProductSetDigest, productSnapshotDigest };
  result.snapshotId = canonicalDigest({ schema:'libra.product-conformance-input-id@1', libraRunId, runExecutionBasisDigest,
    acceptanceSpecRecordDigest:acceptanceSpec.recordDigest, productSnapshotDigest });
  result.snapshotDigest = canonicalDigest(result);
  if (Buffer.byteLength(canonicalJson(result), 'utf8') > 8 * 1024 * 1024) fail('P9_CONFORMANCE_INPUT_SIZE', 'Conformance input exceeds 8 MiB.');
  return freeze(result);
}

function nonEmpty(value) { return value !== null && value !== undefined && (!(typeof value === 'string') || value.length > 0); }
function evaluateProductConformance(value) {
  let input = value?.input;
  try {
    const rebuilt = buildProductConformanceInputSnapshot({ ...input, acceptanceSpecId:input.acceptanceSpec.acceptanceSpecId,
      acceptanceSpecRecordDigest:input.acceptanceSpec.recordDigest });
    if (canonicalJson(rebuilt) !== canonicalJson(input)) fail('P9_CONFORMANCE_INTEGRITY', 'Conformance snapshot is not canonical.');
    input = rebuilt;
  } catch { return integrityFailure(input, value?.verifiedAtMs); }
  const requirements = input.acceptanceSpec.requirements, facts = new Map(input.productFactSnapshots.map((item) => [item.factKind, item.factValue])),
    identity = facts.get('resolved_identity'), metadata = facts.get('product_metadata'), cast = facts.get('media_cast'), unmet = new Set();
  const identities = identity.providerIdentities || [], identityRequirement = requirements.identity,
    namespace = identityRequirement.identityKind === 'tmdb_series_season' ? 'tmdb_series' : identityRequirement.identityKind;
  const matchingIdentity = identities.find((item) => item.namespace === namespace);
  if (!matchingIdentity) unmet.add('identity_unmet');
  if (identityRequirement.requireSeasonNumber && !matchingIdentity?.seasonNumber) unmet.add('season_identity_unmet');
  const structure = input.productStructureSnapshot, material = input.inventorySnapshot.productMaterialManifest,
    primaries = material.members.filter((item) => item.role === 'primary_payload');
  if (structure.structureKind !== requirements.structure.structureKind ||
      (requirements.structure.primaryModel === 'single_primary' && primaries.length !== 1)) unmet.add('structure_unmet');
  const requiredEpisodes = input.acceptanceSpec.productScope.episodeKeys || [], claimedEpisodes = new Set(primaries.flatMap((item) =>
    (item.episodeClaims || []).map((claim) => claim.episodeKey)));
  if (requirements.structure.requireOnePrimaryPerEpisode && requiredEpisodes.some((key) => !claimedEpisodes.has(key))) unmet.add('episode_coverage_unmet');
  const descriptive = new Map((metadata?.descriptiveFacts?.entries || []).map((item) => [item.key, item.value]));
  for (const code of requirements.metadata.requiredFieldCodes || []) {
    let present;
    if (code === 'tmdb_movie_id') present = identities.some((item) => item.namespace === 'tmdb_movie');
    else if (code === 'tmdb_series_id') present = identities.some((item) => item.namespace === 'tmdb_series');
    else if (code === 'jav_code') present = identities.some((item) => item.namespace === 'jav_code');
    else if (code === 'internal_identity') present = identities.some((item) => item.namespace === 'internal_identity');
    else if (code === 'actor') present = Boolean(cast?.relations?.length);
    else if (code === 'season_number') present = identities.some((item) => item.namespace === 'tmdb_series' && item.seasonNumber);
    else if (code === 'episode_number') present = claimedEpisodes.size > 0;
    else present = nonEmpty(descriptive.get(code));
    if (!present) unmet.add('metadata_field_unmet');
  }
  const verifiedKinds = new Set(input.verifiedArtifactManifest.items.map((item) => item.artifactKind));
  if ((requirements.metadata.requiredArtifactKinds || []).some((kind) => !verifiedKinds.has(kind))) unmet.add('metadata_artifact_unmet');
  if (requirements.metadata.requireRenderableSidecar && !verifiedKinds.has('nfo')) unmet.add('sidecar_unrenderable');
  if (requirements.metadata.requireDecodableImages && (requirements.metadata.requiredArtifactKinds || [])
    .filter((kind) => kind === 'poster' || kind === 'fanart').some((kind) => !verifiedKinds.has(kind))) unmet.add('image_undecodable');
  const mediaCodes = new Set(['media_form_unmet','video_codec_unmet','container_unmet','file_extension_unmet','minimum_raster_unmet',
    'system_upscale_forbidden','primary_audio_unmet','max_size_exceeded']);
  for (const selected of input.selectedProducts) for (const code of selected.verification.reasonCodes || []) if (mediaCodes.has(code)) unmet.add(code);
  const inventory = requirements.inventory, members = material.members;
  if (inventory.requireDomainBinding && members.some((item) => !['libra_material_binding','workspace_material_reference'].includes(item.bindingKind)))
    unmet.add('domain_binding_unmet');
  if (inventory.requireChecksum && members.some((item) => item.physicalIdentity?.contentHashAlgorithm !== 'sha256')) unmet.add('checksum_unmet');
  const artifactManifest = input.inventorySnapshot.artifactManifest;
  if ((inventory.requiredMaterializedArtifactKinds || []).some((kind) => !artifactManifest.items.some((item) =>
    item.artifactKind === kind && item.materializationState === 'included_product') || !members.some((item) => item.role ===
      (kind === 'nfo' ? 'metadata_sidecar' : kind)))) unmet.add('artifact_materialization_unmet');
  if ((inventory.layoutModel === 'single' && (structure.structureKind !== 'single' || primaries.length !== 1 || claimedEpisodes.size)) ||
      (inventory.layoutModel === 'season_episode' && (structure.structureKind !== 'season' || requiredEpisodes.some((key) => !claimedEpisodes.has(key)) ||
        [...claimedEpisodes].some((key) => !requiredEpisodes.includes(key))))) unmet.add('layout_unmet');
  return buildEvidence(input, value.verifiedAtMs, [...unmet]);
}

function integrityFailure(input, verifiedAtMs) { return buildEvidence(input, verifiedAtMs, [], ['snapshot_integrity_failure']); }
function buildEvidence(input, verifiedAtMs, unmetValues, reasons = []) {
  const unmetRequirementCodes = UNMET_ORDER.filter((code) => unmetValues.includes(code)), acceptanceSpec = input?.acceptanceSpec || {};
  const evaluatedRequirementSetDigest = canonicalDigest({ schema:'libra.product-conformance-requirements@1',
    acceptanceSpecId:acceptanceSpec.acceptanceSpecId, recordDigest:acceptanceSpec.recordDigest, requirements:acceptanceSpec.requirements });
  const verificationId = canonicalDigest({ schema:'libra.product-conformance-verification-id@1', libraRunId:input?.libraRunId,
    runExecutionBasisDigest:input?.runExecutionBasisDigest, productSnapshotDigest:input?.productSnapshotDigest, evaluatedRequirementSetDigest });
  return freeze({ schemaRef:'helix://contracts/types/ProductConformanceEvidence/v1', schemaVersion:1, verificationId,
    verificationKind:'libra_product_conformance', basisDigest:input?.snapshotDigest, result:reasons.length || unmetRequirementCodes.length ? 'failed' : 'passed',
    reasonCodes:freeze([...reasons]), evidenceRefs:freeze(input?.productFactSnapshots?.map((item) => item.productFactId) || []),
    verifiedAtMs, libraRunId:input?.libraRunId, acceptanceSpecId:acceptanceSpec.acceptanceSpecId,
    acceptanceSpecRecordDigest:acceptanceSpec.recordDigest, runExecutionBasisDigest:input?.runExecutionBasisDigest,
    productSnapshotDigest:input?.productSnapshotDigest, productFactSetDigest:input?.productFactSetDigest,
    evaluatedRequirementSetDigest, unmetRequirementCodes:freeze(unmetRequirementCodes) });
}

module.exports = Object.freeze({ ProductConformanceError, UNMET_ORDER, buildProductConformanceFactSnapshot,
  buildProductConformanceInputSnapshot, evaluateProductConformance });
