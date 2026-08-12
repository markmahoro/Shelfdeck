'use strict';

const { canonicalDigest, canonicalJson } =
  require('../../../contracts/canonical-json');
const {
  absentReferenceDigest,
  buildReferenceDecision,
  episodeScopeDigest,
} = require('../model/workspace-material-reference-contracts');
const {
  createWorkspaceMaterialReferenceStore,
} = require('../persistence/workspace-material-reference-store');
const {
  artifactVerificationContext,
} = require('../planning/libra-production-planners');
const {
  buildImportedWorkspaceMediaHandle,
} = require('../model/external-material-contracts');

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function artifactRole(kind) {
  if (kind === 'nfo') return 'metadata_sidecar';
  if (kind === 'poster' || kind === 'fanart') return kind;
  throw new TypeError('Unsupported Product Artifact role: ' + kind);
}

function artifactVerificationSnapshot(runId, role, materialized, value) {
  const body = {
    verificationKind: 'artifact',
    materialRole: role,
    libraRunId: runId,
    workspaceMaterialHandleId: materialized.workspaceMaterialHandle.handleId,
    workspaceMaterialHandleDigest:
      canonicalDigest(materialized.workspaceMaterialHandle),
    workspaceMaterialFenceDigest:
      materialized.workspaceMaterialHandle.fenceDigest,
    schemaRef: 'ArtifactManifestVerification@1',
    verificationId: value.verification.verificationId,
    verificationValue: value.verification,
    verificationDigest: canonicalDigest(value.verification),
    artifactHandle: materialized.artifactHandle,
    artifactRequirement: value.requirement,
  };
  return Object.freeze({ ...body, snapshotDigest: canonicalDigest(body) });
}

function mediaVerificationSnapshot(runId, workspaceMediaHandle, verification) {
  const material = workspaceMediaHandle.workspaceMaterialHandle;
  const body = {
    verificationKind: 'media',
    materialRole: 'primary_payload',
    libraRunId: runId,
    workspaceMaterialHandleId: material.handleId,
    workspaceMaterialHandleDigest: canonicalDigest(material),
    workspaceMaterialFenceDigest: material.fenceDigest,
    schemaRef: 'ProductMediaVerification@1',
    verificationId: verification.verificationId,
    verificationValue: verification,
    verificationDigest: canonicalDigest(verification),
  };
  return Object.freeze({ ...body, snapshotDigest: canonicalDigest(body) });
}

function createProductStagingService(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      !options.movieProductionReader || !options.workResultReader ||
      !options.workspaceProductPort) {
    throw new TypeError(
      'Product Staging requires Owner facts, Foundation results, and Workspace ports.',
    );
  }
  const store = createWorkspaceMaterialReferenceStore(options);

  function commit(decision) {
    const key = {
      operation: decision.operation,
      decisionDigest: decision.decisionDigest,
    };
    return store.commit({
      decision,
      commitMarker: stable('libra-product-staging-marker-', key),
      resultId: stable('libra-product-staging-result-', key),
    });
  }

  function ensureReference(snapshot, workspaceId, handle, claims, verification) {
    let workspace = options.movieProductionReader.readWorkspace(workspaceId);
    let reference = workspace.references.find((item) =>
      item.materialHandleId === handle.handleId);
    if (!reference) {
      const attach = buildReferenceDecision({
        operation: 'attach_working',
        libraRunId: snapshot.run.libraRunId,
        workspaceId,
        expectedWorkspaceRevision: workspace.currentRevision,
        expectedWorkspaceStateDigest: workspace.stateDigest,
        expectedReference: {
          state: 'absent',
          revision: 0,
          digest: absentReferenceDigest(workspaceId, handle.handleId),
        },
        workspaceMaterialHandle: handle,
        episodeClaims: claims,
        episodeScopeDigest: episodeScopeDigest(claims),
        productVerificationRef: null,
      });
      commit(attach);
      workspace = options.movieProductionReader.readWorkspace(workspaceId);
      reference = workspace.references.find((item) =>
        item.materialHandleId === handle.handleId);
    }
    if (reference?.state === 'working') {
      const promote = buildReferenceDecision({
        operation: 'promote_to_product_staging',
        libraRunId: snapshot.run.libraRunId,
        workspaceId,
        expectedWorkspaceRevision: workspace.currentRevision,
        expectedWorkspaceStateDigest: workspace.stateDigest,
        expectedReference: {
          state: 'present',
          revision: reference.referenceRevision,
          digest: reference.referenceDigest,
        },
        workspaceMaterialHandle: handle,
        episodeClaims: claims,
        episodeScopeDigest: episodeScopeDigest(claims),
        productVerificationRef: verification,
      });
      commit(promote);
      workspace = options.movieProductionReader.readWorkspace(workspaceId);
      reference = workspace.references.find((item) =>
        item.materialHandleId === handle.handleId);
    }
    if (!reference || reference.state !== 'product_staging' ||
        canonicalJson(reference.productVerificationRef) !==
          canonicalJson(verification)) {
      throw new Error(
        'Workspace Product reference did not reach exact Product Staging.',
      );
    }
    return Object.freeze({ workspace, reference });
  }

  function ensure(snapshot, selectedWork) {
    const workspaceId = selectedWork.workspaceId;
    let workspace = options.movieProductionReader.readWorkspace(workspaceId);
    if (!workspace || workspace.libraRunId !== snapshot.run.libraRunId ||
        workspace.state !== 'active') {
      throw new Error('Active Libra Workspace is unavailable for Product Staging.');
    }
    const artifactContext = artifactVerificationContext(
      options,
      snapshot.run.libraRunId,
    );
    const staged = [];
    for (const item of artifactContext.artifactMaterials) {
      const materialized = options.workspaceProductPort
        .readMaterializedArtifact(item.artifactHandle);
      const verification = artifactVerificationSnapshot(
        snapshot.run.libraRunId,
        artifactRole(item.artifactHandle.artifactKind),
        materialized,
        item,
      );
      const result = ensureReference(
        snapshot,
        workspaceId,
        materialized.workspaceMaterialHandle,
        Object.freeze([]),
        verification,
      );
      workspace = result.workspace;
      staged.push(result.reference);
    }

    const results = options.workResultReader.read(selectedWork.workId)
      .filter((item) => item.outcomeKind === 'succeeded');
    const selection = results.find((item) =>
      item.capabilityRef === 'libra.product_output.select@1')?.result;
    if (!selection || selection.result !== 'selected') {
      throw new Error('Selected media Work lacks its terminal selected output.');
    }
    if (selection.selectedCandidateKind === 'workspace_output') {
      const verification = results.find((item) =>
        item.capabilityRef === 'libra.product_media.verify@1' &&
        item.result?.verificationId === selection.selectedVerificationId)?.result;
      let media = results.find((item) =>
        ['libra.media.remux@1', 'libra.media.transcode@1']
          .includes(item.capabilityRef) &&
        item.result?.workspaceMediaHandleId ===
          selection.selectedWorkspaceMediaHandleId)?.result;
      if (!media) {
        const imported = results.find((item) =>
          item.capabilityRef === 'libra.workspace.material.import@1' &&
          item.result?.handleId === selection.selectedHandleId);
        const contract = imported?.inputBindings?.bindings?.find((item) =>
          item.portName === 'workspaceDeliveryContract' &&
          item.bindingKind === 'literal')?.value;
        if (imported && contract) {
          media = buildImportedWorkspaceMediaHandle({
            workspaceDeliveryContract: contract,
            workspaceMaterialHandle: imported.result,
            producingEventId: imported.eventId,
            idempotencyKey: canonicalDigest({
              schema: 'helix.event-execution-key@1',
              eventId: imported.eventId,
              workAttemptId: imported.attemptId,
              planId: imported.planId,
            }),
          });
        }
      }
      if (!verification || !media || verification.result !== 'passed' ||
          media.workspaceMaterialHandle.handleId !== selection.selectedHandleId) {
        throw new Error(
          'Selected Workspace media cannot be reconstructed from durable Results.',
        );
      }
      const snapshotValue = mediaVerificationSnapshot(
        snapshot.run.libraRunId,
        media,
        verification,
      );
      const result = ensureReference(
        snapshot,
        workspaceId,
        media.workspaceMaterialHandle,
        snapshot.episodeClaims,
        snapshotValue,
      );
      workspace = result.workspace;
      staged.push(result.reference);
    }
    return Object.freeze({
      workspace,
      productStagingReferences: Object.freeze(staged.sort((left, right) =>
        Buffer.compare(Buffer.from(left.referenceId), Buffer.from(right.referenceId)))),
      artifactContext,
      selectedWorkResults: Object.freeze(results),
      selection,
    });
  }

  return Object.freeze({ ensure });
}

module.exports = Object.freeze({
  artifactVerificationSnapshot,
  createProductStagingService,
  mediaVerificationSnapshot,
});
