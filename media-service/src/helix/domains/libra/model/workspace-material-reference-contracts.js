'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { workspaceStateDigest } = require('./workspace-admission-contracts');

class WorkspaceMaterialReferenceContractError extends Error {
  constructor(code, message) { super(message); this.name = 'WorkspaceMaterialReferenceContractError'; this.code = code; }
}
const fail = (code, message) => { throw new WorkspaceMaterialReferenceContractError(code, message); };
const DIGEST = /^[a-f0-9]{64}$/;
const text = (value, name) => { if (typeof value !== 'string' || !value) fail('P9_REFERENCE_VALUE', name + ' is required.'); return value; };
const digest = (value, name) => { if (!DIGEST.test(value || '')) fail('P9_REFERENCE_DIGEST', name + ' is invalid.'); return value; };
const positive = (value, name) => { if (!Number.isSafeInteger(value) || value < 1) fail('P9_REFERENCE_REVISION', name + ' is invalid.'); return value; };
const nonNegative = (value, name) => { if (!Number.isSafeInteger(value) || value < 0) fail('P9_REFERENCE_REVISION', name + ' is invalid.'); return value; };

function validateEpisodeClaims(value) {
  if (!Array.isArray(value) || value.length > 32) fail('P9_REFERENCE_CLAIMS', 'Episode claims exceed their bound.');
  const claims = value.map((item) => Object.freeze({ episodeKey:text(item?.episodeKey, 'episodeKey'),
    seasonClaimDigest:digest(item?.seasonClaimDigest, 'seasonClaimDigest'), claimDigest:digest(item?.claimDigest, 'claimDigest') }));
  const sorted = [...claims].sort((left, right) => Buffer.from(left.episodeKey).compare(Buffer.from(right.episodeKey)));
  if (new Set(sorted.map((item) => item.episodeKey)).size !== sorted.length || canonicalJson(claims) !== canonicalJson(sorted))
    fail('P9_REFERENCE_CLAIMS', 'Episode claims must be unique and sorted by episodeKey.');
  return Object.freeze(sorted);
}

function episodeScopeDigest(claims) {
  return canonicalDigest({ schema:'libra.production-episode-scope@1', items:claims });
}

function validateWorkspaceMaterialHandle(value) {
  const identity = value?.physicalIdentity;
  const handle = { schemaRef:text(value?.schemaRef, 'schemaRef'), schemaVersion:value?.schemaVersion,
    handleId:digest(value?.handleId, 'handleId'), workspaceId:digest(value?.workspaceId, 'workspaceId'),
    ownerDomain:text(value?.ownerDomain, 'ownerDomain'), processId:text(value?.processId, 'processId'),
    endpointId:text(value?.endpointId, 'endpointId'), materialKey:digest(value?.materialKey, 'materialKey'),
    physicalIdentity:{ mountScopeId:text(identity?.mountScopeId, 'mountScopeId'), inode:text(identity?.inode, 'inode'),
      contentHashAlgorithm:identity?.contentHashAlgorithm, contentHash:digest(identity?.contentHash, 'contentHash') },
    rootHandleRef:text(value?.rootHandleRef, 'rootHandleRef'), relativePath:text(value?.relativePath, 'relativePath'),
    digestAlgorithm:value?.digestAlgorithm, digestHex:digest(value?.digestHex, 'digestHex'), sizeBytes:value?.sizeBytes,
    referenceRevision:value?.referenceRevision, accessScope:value?.accessScope, fenceDigest:digest(value?.fenceDigest, 'fenceDigest') };
  if (handle.schemaRef !== 'helix://contracts/types/WorkspaceMaterialHandle/v1' || handle.schemaVersion !== 1 ||
      handle.ownerDomain !== 'libra' || handle.physicalIdentity.contentHashAlgorithm !== 'sha256' || handle.digestAlgorithm !== 'sha256' ||
      handle.accessScope !== 'workspace_material_read' || !/^(0|[1-9][0-9]*)$/.test(handle.physicalIdentity.inode) ||
      !Number.isSafeInteger(handle.sizeBytes) || handle.sizeBytes < 0 || !Number.isSafeInteger(handle.referenceRevision) ||
      handle.referenceRevision < 1 || handle.digestHex !== handle.physicalIdentity.contentHash)
    fail('P9_REFERENCE_HANDLE', 'Workspace Material Handle violates its nominal contract.');
  const materialKey = canonicalDigest({ schema:'physical-material-identity@1', mountScopeId:handle.physicalIdentity.mountScopeId,
    inode:handle.physicalIdentity.inode, contentHashAlgorithm:'sha256', contentHash:handle.physicalIdentity.contentHash });
  const handleId = canonicalDigest({ schema:'foundation.workspace-material-handle-id@1', workspaceId:handle.workspaceId,
    materialKey:handle.materialKey, relativePath:handle.relativePath, referenceRevision:handle.referenceRevision });
  const fenceDigest = canonicalDigest({ schema:'foundation.workspace-material-handle-fence@1', handleId:handle.handleId,
    workspaceId:handle.workspaceId, ownerDomain:handle.ownerDomain, processId:handle.processId, endpointId:handle.endpointId,
    materialKey:handle.materialKey, physicalIdentity:handle.physicalIdentity, rootHandleRef:handle.rootHandleRef,
    relativePath:handle.relativePath, digestAlgorithm:handle.digestAlgorithm, digestHex:handle.digestHex,
    sizeBytes:handle.sizeBytes, referenceRevision:handle.referenceRevision, accessScope:handle.accessScope });
  if (handle.materialKey !== materialKey || handle.handleId !== handleId || handle.fenceDigest !== fenceDigest)
    fail('P9_REFERENCE_HANDLE', 'Workspace Material Handle identity or fence is invalid.');
  if (Buffer.byteLength(canonicalJson(handle)) > 4 * 1024) fail('P9_REFERENCE_HANDLE_SIZE', 'Workspace Material Handle exceeds 4 KiB.');
  return Object.freeze(handle);
}

const ARTIFACT_ROLES = Object.freeze({ metadata_sidecar:'nfo', poster:'poster', fanart:'fanart' });
const STRUCTURAL_ROLES = new Set(['structural_dependency','subtitle','external_audio','chapter']);

function validateArtifactRequirement(value) {
  if (!value || typeof value.requirementPayload !== 'object' || value.requirementPayload === null ||
      Array.isArray(value.requirementPayload)) fail('P9_REFERENCE_VERIFICATION', 'Artifact Requirement is invalid.');
  const requirement = { requirementId:text(value.requirementId, 'requirementId'),
    revision:positive(value.revision, 'requirement.revision'), schemaRef:text(value.schemaRef, 'requirement.schemaRef'),
    artifactKind:text(value.artifactKind, 'requirement.artifactKind'), requirementPayload:value.requirementPayload,
    requirementDigest:digest(value.requirementDigest, 'requirement.requirementDigest') };
  const expectedDigest = canonicalDigest({ schema:'shared.artifact-requirement@1', revision:requirement.revision,
    schemaRef:requirement.schemaRef, artifactKind:requirement.artifactKind, requirementPayload:requirement.requirementPayload });
  const expectedId = canonicalDigest({ schema:'shared.artifact-requirement-id@1', requirementDigest:expectedDigest });
  if (requirement.requirementDigest !== expectedDigest || requirement.requirementId !== expectedId)
    fail('P9_REFERENCE_VERIFICATION', 'Artifact Requirement identity is invalid.');
  return Object.freeze(requirement);
}

function validateArtifactHandle(value, handle, libraRunId, materialRole) {
  const ownerScope = value?.ownerScope, provenanceRef = value?.provenanceRef;
  const artifact = { schemaRef:value?.schemaRef, schemaVersion:value?.schemaVersion,
    artifactHandleId:text(value?.artifactHandleId, 'artifactHandleId'), artifactKind:text(value?.artifactKind, 'artifactKind'),
    ownerDomain:text(value?.ownerDomain, 'artifact.ownerDomain'),
    ownerScope:{ scopeType:text(ownerScope?.scopeType, 'artifact.ownerScope.scopeType'),
      scopeId:text(ownerScope?.scopeId, 'artifact.ownerScope.scopeId') },
    storageRef:text(value?.storageRef, 'artifact.storageRef'), digestAlgorithm:value?.digestAlgorithm,
    digestHex:digest(value?.digestHex, 'artifact.digestHex'), sizeBytes:value?.sizeBytes,
    mediaType:text(value?.mediaType, 'artifact.mediaType'),
    provenanceRef:{ objectType:text(provenanceRef?.objectType, 'artifact.provenanceRef.objectType'),
      objectId:text(provenanceRef?.objectId, 'artifact.provenanceRef.objectId'),
      revision:positive(provenanceRef?.revision, 'artifact.provenanceRef.revision'),
      digest:digest(provenanceRef?.digest, 'artifact.provenanceRef.digest') },
    referenceRevision:positive(value?.referenceRevision, 'artifact.referenceRevision') };
  const scopeIsRun = artifact.ownerScope.scopeType === 'libra_run' && artifact.ownerScope.scopeId === libraRunId;
  const scopeIsWorkspace = artifact.ownerScope.scopeType === 'libra_workspace' && artifact.ownerScope.scopeId === handle.workspaceId;
  if (artifact.schemaRef !== 'helix://contracts/types/ArtifactHandle/v1' || artifact.schemaVersion !== 1 ||
      artifact.ownerDomain !== 'libra' || (!scopeIsRun && !scopeIsWorkspace) || artifact.digestAlgorithm !== 'sha256' ||
      artifact.digestHex !== handle.digestHex || artifact.sizeBytes !== handle.sizeBytes ||
      artifact.artifactKind !== ARTIFACT_ROLES[materialRole])
    fail('P9_REFERENCE_VERIFICATION', 'Artifact Handle does not bind the same role, Run/Workspace, and bytes.');
  return Object.freeze(artifact);
}

function validateMediaVerification(value, handle, libraRunId) {
  const verification = value.verificationValue;
  if (value.materialRole !== 'primary_payload' || value.schemaRef !== 'ProductMediaVerification@1' || !verification ||
      verification.schemaRef !== 'helix://contracts/types/ProductMediaVerification/v1' || verification.schemaVersion !== 1 ||
      verification.verificationKind !== 'libra_product_media' || verification.result !== 'passed' ||
      verification.candidateKind !== 'workspace_output' || verification.libraRunId !== libraRunId ||
      verification.productMaterialHandleId !== handle.handleId || verification.productMaterialHandleDigest !== canonicalDigest(handle) ||
      verification.productMaterialFenceDigest !== handle.fenceDigest)
    fail('P9_REFERENCE_VERIFICATION', 'Media Verification does not bind the same Run, role, and Workspace Handle.');
  for (const [name, item] of [['basisDigest',verification.basisDigest],['candidateBasisDigest',verification.candidateBasisDigest],
    ['mediaRequirementDigest',verification.mediaRequirementDigest],['sourceProbeEvidenceDigest',verification.sourceProbeEvidenceDigest],
    ['outputProbeEvidenceDigest',verification.outputProbeEvidenceDigest]]) digest(item, name);
  text(verification.workspaceMediaHandleId, 'workspaceMediaHandleId');
  text(verification.producingEventId, 'producingEventId');
  const verificationId = canonicalDigest({ schema:'libra.product-media-verification-id@1', candidateId:verification.candidateId,
    candidateNodeId:verification.candidateNodeId,candidateBasisDigest:verification.candidateBasisDigest,
    candidateKind:verification.candidateKind,libraRunId,productMaterialHandleId:handle.handleId,
    productMaterialFenceDigest:handle.fenceDigest,mediaRequirementDigest:verification.mediaRequirementDigest,
    sourceProbeEvidenceDigest:verification.sourceProbeEvidenceDigest,outputProbeEvidenceDigest:verification.outputProbeEvidenceDigest });
  if (verification.verificationId !== verificationId) fail('P9_REFERENCE_VERIFICATION', 'Media Verification identity is invalid.');
  return verificationId;
}

function validateArtifactVerification(value, handle, libraRunId) {
  const verification = value.verificationValue, role = value.materialRole, expectedKind = ARTIFACT_ROLES[role];
  if (!expectedKind || value.schemaRef !== 'ArtifactManifestVerification@1' || !verification ||
      verification.schemaRef !== 'helix://contracts/types/ArtifactManifestVerification/v1' || verification.schemaVersion !== 1 ||
      verification.verificationKind !== 'artifact_manifest' || verification.result !== 'passed')
    fail('P9_REFERENCE_VERIFICATION', 'Artifact Verification branch is invalid.');
  const artifactHandle = validateArtifactHandle(value.artifactHandle, handle, libraRunId, role);
  const requirement = validateArtifactRequirement(value.artifactRequirement);
  if (requirement.artifactKind !== expectedKind || canonicalJson(verification.requirement) !== canonicalJson(requirement) ||
      verification.contractRef !== requirement.schemaRef || verification.verificationId !== value.verificationId ||
      !Array.isArray(verification.verifiedArtifacts) || !verification.verifiedArtifacts.some((item) =>
        item.artifactHandleId === artifactHandle.artifactHandleId && item.artifactKind === artifactHandle.artifactKind &&
        item.artifactRevision === artifactHandle.referenceRevision && item.artifactDigest === artifactHandle.digestHex))
    fail('P9_REFERENCE_VERIFICATION', 'Artifact Verification does not bind the exact Artifact Handle and Requirement.');
  return Object.freeze({ verificationId:verification.verificationId, artifactHandle, artifactRequirement:requirement });
}

function validateStructuralVerification(value, handle, libraRunId) {
  const verification = value.verificationValue, role = value.materialRole, typedManifest = value.typedManifest,
    manifestContract = value.manifestContract, memberDigest = digest(value.verifiedMemberDigest, 'verifiedMemberDigest');
  if (!STRUCTURAL_ROLES.has(role) || value.schemaRef !== 'ManifestVerification@1' || !verification ||
      verification.schemaRef !== 'helix://contracts/types/ManifestVerification/v1' || verification.schemaVersion !== 1 ||
      verification.result !== 'passed' || verification.verificationId !== value.verificationId ||
      typedManifest?.schemaRef !== 'helix://contracts/domain-types/TypedManifest/v1' || typedManifest?.schemaVersion !== 1 ||
      typedManifest.objectId !== handle.handleId || typedManifest.digest !== memberDigest ||
      typedManifest.manifest?.objectId !== handle.handleId || typedManifest.manifest?.digest !== memberDigest ||
      manifestContract?.schemaRef !== 'helix://contracts/domain-types/ManifestContract/v1' || manifestContract?.schemaVersion !== 1 ||
      verification.manifestDigest !== typedManifest.digest || verification.contractRef !== manifestContract.contractId)
    fail('P9_REFERENCE_VERIFICATION', 'Structural Verification branch is invalid.');
  const expectedMemberDigest = canonicalDigest({ schema:'libra.workspace-structural-member@1', libraRunId,
    materialRole:role, workspaceMaterialHandleId:handle.handleId, workspaceMaterialHandleDigest:canonicalDigest(handle),
    workspaceMaterialFenceDigest:handle.fenceDigest });
  const parameters = new Map((manifestContract.typedParameters || []).map((item) => [item.parameter,item]));
  const expectedParameters = { libraRunId, materialRole:role, workspaceMaterialHandleDigest:canonicalDigest(handle),
    workspaceMaterialFenceDigest:handle.fenceDigest };
  if (memberDigest !== expectedMemberDigest || manifestContract.manifestKind !== role ||
      !Array.isArray(manifestContract.typedParameters) || parameters.size !== manifestContract.typedParameters.length ||
      Object.entries(expectedParameters).some(([name, expected]) => {
        const parameter=parameters.get(name);
        return !parameter || parameter.valueType !== 'string' || parameter.value !== expected ||
          parameter.valueDigest !== canonicalDigest({ schema:'libra.manifest-contract-parameter@1', parameter:name, valueType:'string', value:expected });
      }))
    fail('P9_REFERENCE_VERIFICATION', 'Structural Manifest/Contract does not bind the same Run, role, and Workspace Handle.');
  return verification.verificationId;
}

function validateProductVerification(value, handle, libraRunId) {
  if (value === null || value === undefined) return null;
  if (!['media','artifact','structural'].includes(value.verificationKind) ||
      value.libraRunId !== libraRunId || value.workspaceMaterialHandleId !== handle.handleId ||
      value.workspaceMaterialHandleDigest !== canonicalDigest(handle) || value.workspaceMaterialFenceDigest !== handle.fenceDigest)
    fail('P9_REFERENCE_VERIFICATION', 'Product Verification Snapshot scope is invalid.');
  let verificationId, extras = {};
  if (value.verificationKind === 'media') verificationId = validateMediaVerification(value, handle, libraRunId);
  else if (value.verificationKind === 'artifact') {
    const validated = validateArtifactVerification(value, handle, libraRunId);
    verificationId = validated.verificationId;
    extras = { artifactHandle:validated.artifactHandle, artifactRequirement:validated.artifactRequirement };
  } else verificationId = validateStructuralVerification(value, handle, libraRunId);
  const verificationDigest = canonicalDigest(value.verificationValue);
  if (value.verificationId !== verificationId || value.verificationValue.verificationId !== verificationId ||
      value.verificationDigest !== verificationDigest)
    fail('P9_REFERENCE_VERIFICATION', 'Product Verification identity or digest is invalid.');
  const snapshot = { verificationKind:value.verificationKind, materialRole:value.materialRole, libraRunId,
    workspaceMaterialHandleId:handle.handleId, workspaceMaterialHandleDigest:canonicalDigest(handle),
    workspaceMaterialFenceDigest:handle.fenceDigest, schemaRef:value.schemaRef, verificationId,
    verificationValue:value.verificationValue, verificationDigest, ...extras };
  if (value.verificationKind === 'structural') {
    snapshot.typedManifest=value.typedManifest;
    snapshot.manifestContract=value.manifestContract;
    snapshot.verifiedMemberDigest=value.verifiedMemberDigest;
  }
  snapshot.snapshotDigest=canonicalDigest(snapshot);
  if (value.snapshotDigest !== snapshot.snapshotDigest)
    fail('P9_REFERENCE_VERIFICATION', 'Product Verification Snapshot digest is invalid.');
  if (Buffer.byteLength(canonicalJson(snapshot)) > 128 * 1024)
    fail('P9_REFERENCE_VERIFICATION_SIZE', 'Product Verification exceeds 128 KiB.');
  return Object.freeze(snapshot);
}

function referenceId(workspaceId, materialHandleId) {
  return canonicalDigest({ schema:'libra.workspace-reference-id@1', workspaceId, materialHandleId });
}
function absentReferenceDigest(workspaceId, materialHandleId) {
  return canonicalDigest({ schema:'libra.workspace-reference-absent@1', workspaceId, materialHandleId });
}

function buildReferenceDecision(value) {
  if (!['attach_working','promote_to_product_staging'].includes(value?.operation))
    fail('P9_REFERENCE_OPERATION', 'Reference operation is invalid.');
  const handle = validateWorkspaceMaterialHandle(value.workspaceMaterialHandle), libraRunId = text(value.libraRunId, 'libraRunId'),
    workspaceId = digest(value.workspaceId, 'workspaceId'), claims = validateEpisodeClaims(value.episodeClaims || []),
    scopeDigest = episodeScopeDigest(claims), verification = validateProductVerification(value.productVerificationRef, handle, libraRunId),
    expected = { state:value.expectedReference?.state, revision:nonNegative(value.expectedReference?.revision, 'expectedReference.revision'),
      digest:digest(value.expectedReference?.digest, 'expectedReference.digest') };
  if (handle.workspaceId !== workspaceId || handle.processId !== libraRunId) fail('P9_REFERENCE_HANDLE_SCOPE', 'Handle scope is invalid.');
  if (value.episodeScopeDigest !== scopeDigest) fail('P9_REFERENCE_CLAIMS', 'Episode scope digest is invalid.');
  if (value.operation === 'attach_working') {
    if (expected.state !== 'absent' || expected.revision !== 0 || expected.digest !== absentReferenceDigest(workspaceId, handle.handleId) || verification !== null)
      fail('P9_REFERENCE_EXPECTED', 'Attach requires the exact absent Reference and no Verification.');
  } else if (expected.state !== 'present' || expected.revision < 1 || verification === null) {
    fail('P9_REFERENCE_EXPECTED', 'Promotion requires a present Reference and passed Verification.');
  }
  const decision = { decisionId:'', operation:value.operation, libraRunId, workspaceId,
    expectedWorkspaceRevision:positive(value.expectedWorkspaceRevision, 'expectedWorkspaceRevision'),
    expectedWorkspaceStateDigest:digest(value.expectedWorkspaceStateDigest, 'expectedWorkspaceStateDigest'),
    expectedReference:expected, workspaceMaterialHandle:handle, episodeClaims:claims, episodeScopeDigest:scopeDigest,
    productVerificationRef:verification };
  decision.decisionId = canonicalDigest({ schema:'libra.workspace-reference-decision-id@1', operation:decision.operation,
    workspaceId, materialHandleId:handle.handleId, expectedReferenceState:expected.state,
    expectedReferenceRevision:expected.revision, workspaceMaterialFenceDigest:handle.fenceDigest });
  decision.decisionDigest = canonicalDigest(decision);
  if ((value.decisionId !== undefined && value.decisionId !== decision.decisionId) ||
      (value.decisionDigest !== undefined && value.decisionDigest !== decision.decisionDigest))
    fail('P9_REFERENCE_DECISION', 'Reference Decision identity or digest is invalid.');
  return Object.freeze(decision);
}

function buildReferenceSnapshot(value) {
  const snapshot = { referenceId:referenceId(value.workspaceId, value.workspaceMaterialHandle.handleId), workspaceId:value.workspaceId,
    libraRunId:value.libraRunId, materialHandleId:value.workspaceMaterialHandle.handleId, materialKey:value.workspaceMaterialHandle.materialKey,
    workspaceMaterialHandle:value.workspaceMaterialHandle, workspaceHandleDigest:canonicalDigest(value.workspaceMaterialHandle),
    referenceRevision:positive(value.referenceRevision, 'referenceRevision'), state:value.state,
    episodeClaims:value.episodeClaims, episodeScopeDigest:value.episodeScopeDigest,
    productVerificationRef:value.productVerificationRef || null, previousReferenceRevision:value.previousReferenceRevision || null,
    committedWorkspaceRevision:positive(value.committedWorkspaceRevision, 'committedWorkspaceRevision') };
  if (!['working','product_staging','released'].includes(snapshot.state)) fail('P9_REFERENCE_STATE', 'Reference state is invalid.');
  snapshot.referenceDigest = canonicalDigest(snapshot);
  return Object.freeze(snapshot);
}

function referenceSetDigest(workspaceId, snapshots) {
  const items = snapshots.filter((item) => item.state !== 'released')
    .sort((left, right) => Buffer.from(left.referenceId).compare(Buffer.from(right.referenceId)));
  return canonicalDigest({ schema:'libra.workspace-reference-set@1', workspaceId, items });
}

module.exports = Object.freeze({ WorkspaceMaterialReferenceContractError, absentReferenceDigest, buildReferenceDecision,
  buildReferenceSnapshot, episodeScopeDigest, referenceId, referenceSetDigest, validateEpisodeClaims,
  validateProductVerification, validateWorkspaceMaterialHandle, workspaceStateDigest });
