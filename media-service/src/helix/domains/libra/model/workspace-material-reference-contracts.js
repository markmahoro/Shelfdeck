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

function validateProductVerification(value, handle, libraRunId) {
  if (value === null || value === undefined) return null;
  const verification = value.verificationValue;
  if (value.schemaRef !== 'ProductMediaVerification@1' || !verification ||
      verification.schemaRef !== 'helix://contracts/types/ProductMediaVerification/v1' || verification.schemaVersion !== 1 ||
      verification.verificationKind !== 'libra_product_media' || verification.result !== 'passed' ||
      verification.candidateKind !== 'workspace_output' || verification.libraRunId !== libraRunId ||
      verification.productMaterialHandleId !== handle.handleId || verification.productMaterialHandleDigest !== canonicalDigest(handle) ||
      verification.productMaterialFenceDigest !== handle.fenceDigest)
    fail('P9_REFERENCE_VERIFICATION', 'Product Verification does not bind the same Run and Workspace Handle.');
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
  const verificationDigest = canonicalDigest(verification);
  if (verification.verificationId !== verificationId || value.verificationId !== verificationId || value.verificationDigest !== verificationDigest)
    fail('P9_REFERENCE_VERIFICATION', 'Product Verification identity or digest is invalid.');
  const snapshot = Object.freeze({ schemaRef:value.schemaRef, verificationId, verificationValue:verification, verificationDigest });
  if (Buffer.byteLength(canonicalJson(snapshot)) > 16 * 1024) fail('P9_REFERENCE_VERIFICATION_SIZE', 'Product Verification exceeds 16 KiB.');
  return snapshot;
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
