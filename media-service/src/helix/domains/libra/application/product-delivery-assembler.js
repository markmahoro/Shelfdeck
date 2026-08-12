'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const {
  buildImportedWorkspaceMediaHandle,
} = require('../model/external-material-contracts');
const { projectMaterialControlRow } =
  require('../../../foundation/persistence/material-control');
const {
  buildProductConformanceFactSnapshot,
  buildProductConformanceInputSnapshot,
} = require('../model/product-conformance');
const {
  onDeckProductPackageDigest,
} = require('../model/delivery-lifecycle-contracts');
const {
  artifactVerificationContext,
} = require('../planning/libra-production-planners');
const {
  buildOutputRequirement,
} = require('../model/run-admission-contracts');

const RECEIPT_CONTRACT = Object.freeze({
  receiptSchemaRef:
    'helix://contracts/types/OnDeckProductPackageCommitReceipt/v1',
  controlRevisionSetSchemaRef: 'libra.product-control-revision-set@1',
});

function utf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function without(value, field) {
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => name !== field));
}

function complete(value, field) {
  return Object.freeze({ ...value, [field]: canonicalDigest(value) });
}

function productStagingReference(value) {
  return Object.freeze({
    referenceId: value.referenceId,
    workspaceId: value.workspaceId,
    libraRunId: value.libraRunId,
    materialHandleId: value.materialHandleId,
    materialKey: value.materialKey,
    workspaceMaterialHandle: value.workspaceMaterialHandle,
    workspaceHandleDigest: value.workspaceHandleDigest,
    referenceRevision: value.referenceRevision,
    state: value.state,
    episodeClaims: value.episodeClaims,
    episodeScopeDigest: value.episodeScopeDigest,
    productVerificationRef: value.productVerificationRef,
    previousReferenceRevision: value.previousReferenceRevision,
    committedWorkspaceRevision: value.committedWorkspaceRevision,
    referenceDigest: value.referenceDigest,
  });
}

function emptyClaimSetDigest() {
  return canonicalDigest({
    schema: 'libra.production-material-episode-claims@1',
    items: [],
  });
}

function episodeScopeDigest(claims) {
  return canonicalDigest({
    schema: 'libra.production-episode-scope@1',
    items: claims,
  });
}

function productRole(role) {
  if (role === 'nfo') return 'metadata_sidecar';
  if (['poster', 'fanart', 'subtitle', 'external_audio', 'chapter', 'sidecar']
    .includes(role)) return role;
  throw new TypeError(
    'Related Material role is not representable in the Product Manifest: ' + role,
  );
}

function productFactSnapshots(options, runId) {
  const facts = ['resolved_identity', 'media_cast', 'product_metadata']
    .map((kind) => options.movieProductionReader.readFact(runId, kind, 1))
    .filter(Boolean)
    .map(buildProductConformanceFactSnapshot)
    .sort((left, right) => utf8(left.factKind, right.factKind) ||
      utf8(left.productFactId, right.productFactId));
  if (facts.length !== 3) {
    throw new Error('Product Delivery requires Identity, Metadata, and Media-Cast facts.');
  }
  return Object.freeze(facts);
}

function selectedContext(options, snapshot, selectedWorkId) {
  const results = options.workResultReader.read(selectedWorkId)
    .filter((item) => item.outcomeKind === 'succeeded');
  const selected = results.find((item) =>
    item.capabilityRef === 'libra.product_output.select@1')?.result;
  const verification = results.find((item) =>
    item.capabilityRef === 'libra.product_media.verify@1' &&
    item.result?.verificationId === selected?.selectedVerificationId)?.result;
  if (!selected || selected.result !== 'selected' || !verification ||
      verification.result !== 'passed') {
    throw new Error('Selected Product output and verification are unavailable.');
  }
  let workspaceMediaHandle = null;
  if (selected.selectedCandidateKind === 'workspace_output') {
    workspaceMediaHandle = results.find((item) =>
      ['libra.media.remux@1', 'libra.media.transcode@1']
        .includes(item.capabilityRef) &&
      item.result?.workspaceMediaHandleId ===
        selected.selectedWorkspaceMediaHandleId)?.result || null;
    if (!workspaceMediaHandle) {
      const imported = results.find((item) =>
        item.capabilityRef === 'libra.workspace.material.import@1' &&
        item.result?.handleId === selected.selectedHandleId);
      const contract = imported?.inputBindings?.bindings?.find((item) =>
        item.portName === 'workspaceDeliveryContract' &&
        item.bindingKind === 'literal')?.value;
      if (imported && contract) {
        const eventExecutionKey = canonicalDigest({
          schema: 'helix.event-execution-key@1',
          eventId: imported.eventId,
          workAttemptId: imported.attemptId,
          planId: imported.planId,
        });
        workspaceMediaHandle = buildImportedWorkspaceMediaHandle({
          workspaceDeliveryContract: contract,
          workspaceMaterialHandle: imported.result,
          producingEventId: imported.eventId,
          idempotencyKey: eventExecutionKey,
        });
      }
    }
    if (!workspaceMediaHandle ||
        workspaceMediaHandle.workspaceMaterialHandle.handleId !==
          selected.selectedHandleId) {
      throw new Error('Selected Workspace media Handle is unavailable.');
    }
  }
  return Object.freeze({ results, selected, verification, workspaceMediaHandle });
}

function workspaceMember(reference, role, outputRequirementDigest,
  originCandidateDeliveryRef, controlProjection) {
  const handle = reference.workspaceMaterialHandle;
  return {
    ordinal: 0,
    materialKey: handle.materialKey,
    role,
    physicalIdentity: Object.freeze({
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
      schemaVersion: 2,
      materialKey: handle.materialKey,
      ...handle.physicalIdentity,
    }),
    sizeBytes: handle.sizeBytes,
    location: Object.freeze({
      locationKind: 'workspace_handle',
      endpointId: handle.endpointId,
      location: null,
      rootHandleRef: handle.rootHandleRef,
      relativePath: handle.relativePath,
    }),
    bindingKind: 'workspace_material_reference',
    bindingRevision: reference.referenceRevision,
    originCandidateDeliveryRef,
    workspaceReferenceId: reference.referenceId,
    workspaceMaterialHandle: handle,
    admittedControlRevision: null,
    admittedControlProjectionDigest: null,
    bindingEvidenceDigest: reference.referenceDigest,
    episodeClaims: reference.episodeClaims,
    episodeClaimSetDigest: canonicalDigest({
      schema: 'libra.production-material-episode-claims@1',
      items: reference.episodeClaims,
    }),
    outputRequirementDigest,
    sourceRelatedReferenceId: null,
    derivedAuthorityDigest: null,
    controlOperation: 'acquire_workspace_product',
    expectedControlRevision: null,
    expectedControlProjectionDigest: null,
    committedControlRevision: 1,
    committedControlProjectionDigest: controlProjection.projectionDigest,
  };
}

function directPrimaryMember(member, verification) {
  return {
    ordinal: 0,
    materialKey: member.materialKey,
    role: 'primary_payload',
    physicalIdentity: member.physicalIdentity,
    sizeBytes: member.sizeBytes,
    location: Object.freeze({
      locationKind: 'domain_binding',
      endpointId: member.endpointId,
      location: member.location,
      rootHandleRef: null,
      relativePath: null,
    }),
    bindingKind: 'libra_material_binding',
    bindingRevision: member.bindingRevision,
    originCandidateDeliveryRef: member.originCandidateDeliveryRef,
    workspaceReferenceId: null,
    workspaceMaterialHandle: null,
    admittedControlRevision: member.admittedControlRevision,
    admittedControlProjectionDigest: member.admittedControlProjectionDigest,
    bindingEvidenceDigest: member.bindingEvidenceDigest,
    episodeClaims: member.episodeClaims,
    episodeClaimSetDigest: member.episodeClaimSetDigest,
    outputRequirementDigest: verification.mediaRequirementDigest,
    sourceRelatedReferenceId: null,
    derivedAuthorityDigest: null,
    controlOperation: 'assert_existing_input',
    expectedControlRevision: member.admittedControlRevision,
    expectedControlProjectionDigest: member.admittedControlProjectionDigest,
    committedControlRevision: member.admittedControlRevision,
    committedControlProjectionDigest: member.admittedControlProjectionDigest,
  };
}

function relatedAuthority(snapshot, binding) {
  const reference = snapshot.relatedReferences.find((item) =>
    item.referenceId === snapshot.relatedDispositionScope.items.find((scope) =>
      scope.materialKey === binding.materialKey &&
      scope.primaryMaterialKey === binding.primaryMaterialKey &&
      scope.role === binding.role)?.referenceId);
  if (!reference) throw new Error('Frozen Related reference is unavailable.');
  const derivedAuthorityDigest = canonicalDigest({
    schema: 'libra.related-derived-authority@1',
    subjectId: snapshot.run.subjectId,
    sourceRelatedReferenceId: reference.referenceId,
    primaryMaterialKey: binding.primaryMaterialKey,
    role: binding.role,
    sourceMaterialKey: binding.materialKey,
    associationEvidenceDigest: binding.associationEvidenceDigest,
    dispositionBasisDigest: binding.dispositionBasisDigest,
    bindingRevision: binding.bindingRevision,
    bindingEvidenceDigest: binding.bindingEvidenceDigest,
  });
  const assertion = {
    sourceRelatedReferenceId: reference.referenceId,
    primaryMaterialKey: binding.primaryMaterialKey,
    role: binding.role,
    sourceMaterialKey: binding.materialKey,
    finalProductMaterialKey: binding.materialKey,
    associationEvidenceDigest: binding.associationEvidenceDigest,
    dispositionBasisDigest: binding.dispositionBasisDigest,
    bindingRevision: binding.bindingRevision,
    bindingEvidenceDigest: binding.bindingEvidenceDigest,
    dispositionKind: 'carried_forward',
    derivedAuthorityDigest,
  };
  assertion.assertionDigest = canonicalDigest(assertion);
  return Object.freeze({ reference, binding, assertion:Object.freeze(assertion) });
}

function relatedProductMember(value, originCandidateDeliveryRef) {
  const { reference, binding, assertion } = value;
  const member = {
    ordinal: 0,
    materialKey: binding.materialKey,
    role: productRole(binding.role),
    physicalIdentity: binding.physicalIdentity,
    sizeBytes: binding.physicalIdentity.sizeBytes,
    location: Object.freeze({
      locationKind: 'domain_binding',
      endpointId: binding.endpointId,
      location: binding.location,
      rootHandleRef: null,
      relativePath: null,
    }),
    bindingKind: 'libra_material_binding',
    bindingRevision: binding.bindingRevision,
    originCandidateDeliveryRef,
    workspaceReferenceId: null,
    workspaceMaterialHandle: null,
    admittedControlRevision: null,
    admittedControlProjectionDigest: null,
    bindingEvidenceDigest: binding.bindingEvidenceDigest,
    episodeClaims: Object.freeze([]),
    episodeClaimSetDigest: emptyClaimSetDigest(),
    outputRequirementDigest: binding.dispositionBasisDigest,
    sourceRelatedReferenceId: reference.referenceId,
    derivedAuthorityDigest: assertion.derivedAuthorityDigest,
    controlOperation: 'assert_related_input',
    expectedControlRevision: null,
    expectedControlProjectionDigest: null,
    committedControlRevision: null,
    committedControlProjectionDigest: null,
  };
  return member;
}

function finalizeMembers(items) {
  return Object.freeze(items.sort((left, right) =>
    utf8(left.materialKey, right.materialKey)).map((item, ordinal) => {
    const body = { ...item, ordinal };
    return Object.freeze({ ...body, memberDigest:canonicalDigest(body) });
  }));
}

function finalizeProductMembers(items, acceptanceSpec) {
  return finalizeMembers(items.map((item) => ({
    ...item,
    outputRequirementDigest: buildOutputRequirement({
      acceptanceSpec,
      manifestRole: 'product_delivery',
      materialKey: item.materialKey,
      materialRole: item.role,
      episodeKeys: item.episodeClaims.map((claim) => claim.episodeKey),
    }).outputRequirementDigest,
  })));
}

function artifactManifest(runId, packageRevision, context) {
  const items = context.artifactMaterials.map((item) => {
    const body = {
      artifactHandleId: item.artifactHandle.artifactHandleId,
      artifactKind: item.artifactHandle.artifactKind,
      artifactRevision: item.artifactHandle.referenceRevision,
      artifactDigest: item.artifactHandle.digestHex,
      requirementDigest: item.requirement.requirementDigest,
      materializationState: 'included_product',
    };
    return Object.freeze({ ...body, referenceDigest:canonicalDigest(body) });
  }).sort((left, right) => utf8(left.artifactKind, right.artifactKind) ||
    utf8(left.artifactHandleId, right.artifactHandleId) ||
    left.artifactRevision - right.artifactRevision);
  const body = {
    manifestId: canonicalDigest({
      schema: 'libra.product-submanifest-id@1',
      manifestKind: 'artifact',
      libraRunId: runId,
      packageRevision,
    }),
    manifestRevision: packageRevision,
    libraRunId: runId,
    items: Object.freeze(items),
    artifactSetDigest: canonicalDigest({
      schema: 'libra.product-artifact-set@1',
      items,
    }),
  };
  return Object.freeze({ ...body, manifestDigest:canonicalDigest(body) });
}

function productFactManifest(runId, packageRevision, facts) {
  const items = facts.map((item) => {
    const body = {
      productFactId: item.productFactId,
      factKind: item.factKind,
      factRevision: item.factRevision,
      schemaRef: item.schemaRef,
      factValue: item.factValue,
      factDigest: item.factDigest,
      evidenceDigest: item.evidenceDigest,
    };
    return Object.freeze({ ...body, referenceDigest:canonicalDigest(body) });
  });
  const body = {
    manifestId: canonicalDigest({
      schema: 'libra.product-submanifest-id@1',
      manifestKind: 'product_fact',
      libraRunId: runId,
      packageRevision,
    }),
    manifestRevision: packageRevision,
    libraRunId: runId,
    items: Object.freeze(items),
    factSetDigest: canonicalDigest({ schema:'libra.product-fact-set@1', items }),
  };
  return Object.freeze({ ...body, manifestDigest:canonicalDigest(body) });
}

function createProductDeliveryAssembler(options) {
  if (!options?.movieProductionReader || !options.workResultReader ||
      !options.workspaceProductPort) {
    throw new TypeError('Product Delivery assembly requires exact typed readers.');
  }

  function context(libraRunId, selectedWorkId) {
    const snapshot = options.movieProductionReader.readRunSnapshot(libraRunId);
    const selected = selectedContext(options, snapshot, selectedWorkId);
    const artifacts = artifactVerificationContext(options, libraRunId);
    const facts = productFactSnapshots(options, libraRunId);
    const packageRevision = snapshot.run.packageRevisionHead + 1;
    const onDeckPackageId = canonicalDigest({
      schema: 'libra.on-deck-package-id@1',
      libraRunId,
      packageRevision,
    });
    const workspace = options.movieProductionReader.readWorkspace(
      canonicalDigest({ schema:'libra.workspace-id@1', libraRunId }),
    );
    if (!workspace) throw new Error('Libra Workspace is unavailable.');
    const staging = workspace.references.filter((item) =>
      item.state === 'product_staging');
    const mediaReference = selected.workspaceMediaHandle
      ? staging.find((item) => item.materialHandleId ===
        selected.workspaceMediaHandle.workspaceMaterialHandle.handleId)
      : null;
    if (selected.workspaceMediaHandle && !mediaReference) {
      throw new Error('Selected Workspace media is not in Product Staging.');
    }
    const origin = snapshot.members.find((item) =>
      item.role === 'primary_payload')?.originCandidateDeliveryRef || null;
    const productMembers = [];
    if (selected.selected.selectedCandidateKind === 'direct_input') {
      const primary = snapshot.members.filter((item) =>
        item.role === 'primary_payload');
      if (primary.length !== 1) {
        throw new Error('Direct Movie Product requires exactly one Primary input.');
      }
      productMembers.push(directPrimaryMember(primary[0], selected.verification));
    } else {
      const projected = projectMaterialControlRow(
        mediaReference.materialKey,
        {
          control_revision: 1,
          state: 'controlled',
          owner_domain: 'libra',
          owner_scope_type: 'on_deck_package',
          owner_scope_id: onDeckPackageId,
        },
      );
      productMembers.push(workspaceMember(
        mediaReference,
        'primary_payload',
        selected.verification.mediaRequirementDigest,
        null,
        projected,
      ));
    }
    for (const item of artifacts.artifactMaterials) {
      const materialized = options.workspaceProductPort
        .readMaterializedArtifact(item.artifactHandle);
      const reference = staging.find((candidate) =>
        candidate.materialHandleId === materialized.workspaceMaterialHandle.handleId);
      if (!reference || reference.productVerificationRef?.verificationKind !== 'artifact') {
        throw new Error('Verified Artifact is not in Product Staging.');
      }
      const projected = projectMaterialControlRow(reference.materialKey, {
        control_revision: 1,
        state: 'controlled',
        owner_domain: 'libra',
        owner_scope_type: 'on_deck_package',
        owner_scope_id: onDeckPackageId,
      });
      productMembers.push(workspaceMember(
        reference,
        productRole(item.artifactHandle.artifactKind),
        item.requirement.requirementDigest,
        null,
        projected,
      ));
    }
    const related = snapshot.relatedBindings.map((binding) =>
      relatedAuthority(snapshot, binding));
    for (const item of related) {
      productMembers.push(relatedProductMember(item, origin));
    }
    const members = finalizeProductMembers(productMembers, snapshot.spec);
    const productMaterialBody = {
      manifestId: canonicalDigest({
        schema: 'libra.production-material-manifest-id@1',
        manifestRole: 'product_delivery',
        libraRunId,
        manifestRevision: packageRevision,
      }),
      manifestRole: 'product_delivery',
      manifestRevision: packageRevision,
      libraRunId,
      scopeKind: snapshot.spec.structureKind === 'season'
        ? 'episode_delivery' : 'single',
      members,
      memberSetDigest: canonicalDigest({
        schema: 'libra.production-material-members@1',
        items: members,
      }),
      episodeScopeDigest: episodeScopeDigest(snapshot.episodeClaims),
    };
    const productMaterialManifest = Object.freeze({
      ...productMaterialBody,
      manifestDigest: canonicalDigest(productMaterialBody),
    });
    const artifactValue = artifactManifest(libraRunId, packageRevision, artifacts);
    const primaryCount = members.filter((item) =>
      item.role === 'primary_payload').length;
    const structuralCount = members.filter((item) =>
      item.role === 'structural_dependency').length;
    const productStructureSnapshot = complete({
      structureKind: snapshot.spec.structureKind,
      contentProfile: snapshot.spec.contentProfile,
      productScopeDigest: snapshot.spec.productScope.scopeDigest,
      episodeScopeDigest: productMaterialManifest.episodeScopeDigest,
      primaryMaterialCount: primaryCount,
      structuralDependencyCount: structuralCount,
    }, 'productStructureDigest');
    const inventoryBody = {
      productStructureSnapshot,
      productMaterialManifest,
      artifactManifest: artifactValue,
    };
    const inventorySnapshot = Object.freeze({
      ...inventoryBody,
      inventoryDigest: canonicalDigest(inventoryBody),
    });
    const artifactByHandle = new Map(artifactValue.items.map((item) =>
      [item.artifactHandleId, item]));
    const artifactVerificationSnapshots = artifacts.artifactMaterials
      .map((item) => {
        const verifiedManifestItem = artifacts.verifiedArtifactManifest.items
          .find((candidate) => candidate.artifactHandleId ===
            item.artifactHandle.artifactHandleId);
        const body = {
          ordinal: verifiedManifestItem.ordinal,
          verifiedManifestItem,
          artifactManifestItem: artifactByHandle.get(
            item.artifactHandle.artifactHandleId),
          verificationResultRef: verifiedManifestItem.verificationResultRef,
          verificationValue: item.verification,
        };
        return Object.freeze({ ...body, snapshotDigest:canonicalDigest(body) });
      }).sort((left, right) => left.ordinal - right.ordinal);
    const selectedProducts = Object.freeze([Object.freeze({
      selectedProduct: selected.selected,
      verification: selected.verification,
      workspaceHandleDigest: selected.workspaceMediaHandle
        ? canonicalDigest(selected.workspaceMediaHandle) : null,
    })]);
    const conformanceInput = buildProductConformanceInputSnapshot({
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      acceptanceSpec: snapshot.spec,
      resolvedIdentitySnapshot: facts.find((item) =>
        item.factKind === 'resolved_identity'),
      productFactSnapshots: facts,
      verifiedArtifactManifest: artifacts.verifiedArtifactManifest,
      artifactVerificationSnapshots,
      inventorySnapshot,
      selectedProducts,
    });
    return Object.freeze({
      snapshot,
      selected,
      artifacts,
      facts,
      packageRevision,
      onDeckPackageId,
      workspace,
      productStagingReferences: Object.freeze(staging
        .map(productStagingReference)
        .sort((left, right) => utf8(left.referenceId, right.referenceId))),
      related: Object.freeze(related),
      productMaterialManifest,
      productStructureSnapshot,
      artifactManifest: artifactValue,
      inventorySnapshot,
      conformanceInput,
    });
  }

  function conformanceInput(libraRunId, selectedWorkId) {
    return context(libraRunId, selectedWorkId).conformanceInput;
  }

  function promotion(libraRunId, selectedWorkId, conformance,
    eventFenceDigest) {
    const value = context(libraRunId, selectedWorkId);
    if (!conformance || conformance.result !== 'passed' ||
        conformance.libraRunId !== libraRunId ||
        conformance.basisDigest !== value.conformanceInput.snapshotDigest) {
      throw new Error('Promotion requires the exact passed Conformance Evidence.');
    }
    const snapshot = value.snapshot;
    const factManifest = productFactManifest(
      libraRunId,
      value.packageRevision,
      value.facts,
    );
    const cast = value.facts.find((item) => item.factKind === 'media_cast');
    const mediaCastSnapshot = Object.freeze({
      mediaCastFactId: cast.productFactId,
      mediaCastFactRevision: cast.factRevision,
      schemaRef: cast.schemaRef,
      factValue: cast.factValue,
      factDigest: cast.factDigest,
      evidenceDigest: cast.evidenceDigest,
      relations: cast.factValue.relations,
      relationsDigest: cast.factValue.relationsDigest,
    });
    const selectedFinalKey = value.selected.selected.selectedHandleId ===
        value.selected.workspaceMediaHandle?.workspaceMaterialHandle.handleId
      ? value.selected.workspaceMediaHandle.workspaceMaterialHandle.materialKey
      : snapshot.members.find((item) => item.role === 'primary_payload').materialKey;
    const originalDisposition = value.selected.selected.selectedCandidateKind ===
      'direct_input' ? 'carried_forward' : 'replaced_and_settled';
    const offloadItems = snapshot.members.map((member) => {
      const body = {
        ordinal: 0,
        materialKey: member.materialKey,
        contextRole: member.role === 'structural_dependency'
          ? 'structural_dependency' : 'original_input',
        sourceRelatedReferenceId: null,
        finalProductMaterialKey: selectedFinalKey,
        dispositionKind: originalDisposition,
        physicalIdentity: member.physicalIdentity,
        endpointId: member.endpointId,
        location: member.location,
        bindingRevision: member.bindingRevision,
        bindingEvidenceDigest: member.bindingEvidenceDigest,
        admittedControlRevision: member.admittedControlRevision,
        admittedControlProjectionDigest: member.admittedControlProjectionDigest,
        derivedAuthorityDigest: null,
        settlementExpectation: originalDisposition === 'carried_forward'
          ? 'replace_or_move' : 'remove_after_place',
      };
      return body;
    });
    for (const item of value.related) {
      offloadItems.push({
        ordinal: 0,
        materialKey: item.binding.materialKey,
        contextRole: 'related_input',
        sourceRelatedReferenceId: item.reference.referenceId,
        finalProductMaterialKey: item.binding.materialKey,
        dispositionKind: 'carried_forward',
        physicalIdentity: item.binding.physicalIdentity,
        endpointId: item.binding.endpointId,
        location: item.binding.location,
        bindingRevision: item.binding.bindingRevision,
        bindingEvidenceDigest: item.binding.bindingEvidenceDigest,
        admittedControlRevision: null,
        admittedControlProjectionDigest: null,
        derivedAuthorityDigest: item.assertion.derivedAuthorityDigest,
        settlementExpectation: 'replace_or_move',
      });
    }
    const offloadMembers = finalizeMembers(offloadItems);
    const offloadBody = {
      manifestId: canonicalDigest({
        schema: 'libra.product-submanifest-id@1',
        manifestKind: 'offload_context',
        libraRunId,
        packageRevision: value.packageRevision,
      }),
      manifestRevision: value.packageRevision,
      libraRunId,
      members: offloadMembers,
      memberSetDigest: canonicalDigest({
        schema: 'libra.offload-context-members@1',
        items: offloadMembers,
      }),
    };
    const offloadContextManifest = Object.freeze({
      ...offloadBody,
      manifestDigest: canonicalDigest(offloadBody),
    });
    const planItems = [];
    const evidenceItems = [];
    const verificationItems = [];
    const workKinds = [
      'product_identity', 'product_metadata_observation',
      'artifact_production', 'product_fact_assembly',
      'workspace_media_production', 'product_conformance',
    ];
    for (const workKind of workKinds) {
      const works = options.workResultReader.listWorks({
        ownerDomain: 'libra',
        processType: 'libra_run',
        processId: libraRunId,
        workKind,
      }).filter((item) => item.state === 'succeeded');
      for (const work of works) for (const result of
        options.workResultReader.read(work.work_id)) {
        if (result.planId && result.planDigest &&
            !planItems.some((item) => item.planId === result.planId)) {
          planItems.push({
            planId: result.planId,
            planRevision: result.planRevision,
            planDigest: result.planDigest,
          });
        }
        if (result.evidence?.evidenceId && result.evidenceDigest &&
            !evidenceItems.some((item) =>
              item.evidenceId === result.evidence.evidenceId)) {
          evidenceItems.push({
            evidenceId: result.evidence.evidenceId,
            evidenceDigest: result.evidenceDigest,
          });
        }
        if (result.result?.verificationId &&
            !verificationItems.some((item) =>
              item.verificationId === result.result.verificationId)) {
          verificationItems.push({
            verificationId: result.result.verificationId,
            verificationDigest: canonicalDigest(result.result),
          });
        }
      }
    }
    planItems.sort((left, right) => utf8(left.planId, right.planId));
    evidenceItems.sort((left, right) => utf8(left.evidenceId, right.evidenceId));
    verificationItems.sort((left, right) =>
      utf8(left.verificationId, right.verificationId));
    const provenanceBody = {
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      workflowPlanRefs: Object.freeze(planItems),
      productVerificationRefs: Object.freeze(verificationItems),
      externalRealityObservationRefs: Object.freeze(evidenceItems),
    };
    const productionProvenance = Object.freeze({
      ...provenanceBody,
      provenanceDigest: canonicalDigest(provenanceBody),
    });
    const attestationBody = {
      attestationId: canonicalDigest({
        schema: 'libra.production-attestation-id@1',
        libraRunId,
        onDeckPackageId: value.onDeckPackageId,
        productConformanceEvidenceId: conformance.verificationId,
        productConformanceEvidenceDigest: canonicalDigest(conformance),
      }),
      libraRunId,
      onDeckPackageId: value.onDeckPackageId,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      productConformanceEvidenceId: conformance.verificationId,
      productConformanceEvidenceDigest: canonicalDigest(conformance),
      evaluatedRequirementSetDigest: conformance.evaluatedRequirementSetDigest,
      productSnapshotDigest: conformance.productSnapshotDigest,
      unmetRequirementCount: conformance.unmetRequirementCodes.length,
      attestedAtMs: conformance.verifiedAtMs,
    };
    const productionAttestation = Object.freeze({
      ...attestationBody,
      attestationDigest: canonicalDigest(attestationBody),
    });
    const assertions = Object.freeze(value.related.map((item) =>
      item.assertion).sort((left, right) =>
      utf8(left.sourceRelatedReferenceId, right.sourceRelatedReferenceId)));
    const relatedDispositionSetDigest = canonicalDigest({
      schema: 'libra.related-disposition-set@1',
      items: assertions,
    });
    const controlItems = value.productMaterialManifest.members
      .filter((item) => item.controlOperation !== 'assert_related_input')
      .map((item) => item.controlOperation === 'assert_existing_input'
        ? Object.freeze({
          controlOperation: 'assert_existing_input',
          materialKey: item.materialKey,
          expectedControlRevision: item.expectedControlRevision,
          expectedControlProjectionDigest:
            item.expectedControlProjectionDigest,
          ownerDomain: 'libra',
          ownerScopeType: 'subject',
          ownerScopeId: snapshot.run.subjectId,
        })
        : Object.freeze({
          controlOperation: 'acquire_workspace_product',
          materialKey: item.materialKey,
          expectedControlState: 'absent',
          toOwnerDomain: 'libra',
          toOwnerScopeType: 'on_deck_package',
          toOwnerScopeId: value.onDeckPackageId,
        }))
      .sort((left, right) => utf8(left.materialKey, right.materialKey));
    const controlCommitScope = Object.freeze({
      items: Object.freeze(controlItems),
      controlScopeDigest: canonicalDigest({
        schema: 'libra.product-control-commit-scope@1',
        libraRunId,
        onDeckPackageId: value.onDeckPackageId,
        items: controlItems,
      }),
    });
    const workspaceRefs = value.productStagingReferences;
    const resolvedIdentity = factManifest.items.find((item) =>
      item.factKind === 'resolved_identity');
    const decision = {
      decisionId: '',
      libraRunRef: {
        libraRunId,
        stateRevision: snapshot.run.stateRevision,
        stateDigest: snapshot.run.stateDigest,
        executionBasisDigest: snapshot.run.executionBasisDigest,
        runScopeDigest: snapshot.run.runScopeDigest,
        expectedPackageRevisionHead: snapshot.run.packageRevisionHead,
      },
      runMaterialManifestRef: {
        manifestId: snapshot.run.runMaterialManifestId,
        manifestDigest: snapshot.run.runMaterialManifestDigest,
      },
      workspaceRef: workspaceRefs.length ? {
        workspaceId: value.workspace.workspaceId,
        workspaceRevision: value.workspace.currentRevision,
        workspaceStateDigest: value.workspace.stateDigest,
      } : null,
      productStagingReferences: workspaceRefs,
      acceptanceSpecRef: {
        acceptanceSpecId: snapshot.spec.acceptanceSpecId,
        recordDigest: snapshot.spec.recordDigest,
      },
      resolvedIdentitySnapshot: {
        productFactId: resolvedIdentity.productFactId,
        factRevision: resolvedIdentity.factRevision,
        schemaRef: resolvedIdentity.schemaRef,
        factValue: resolvedIdentity.factValue,
        factDigest: resolvedIdentity.factDigest,
        evidenceDigest: resolvedIdentity.evidenceDigest,
      },
      productStructureSnapshot: value.productStructureSnapshot,
      productFactManifest: factManifest,
      artifactManifest: value.artifactManifest,
      mediaCastSnapshot,
      productMaterialManifest: value.productMaterialManifest,
      offloadContextManifest,
      productionProvenance,
      productionAttestation,
      relatedDispositionSetDigest,
      relatedAuthorityAssertions: assertions,
      controlCommitScope,
      onDeckPackageId: value.onDeckPackageId,
      packageRevision: value.packageRevision,
      packageDigest: '',
      offerId: '',
      decisionDigest: '',
    };
    decision.packageDigest = onDeckProductPackageDigest(
      decision,
      snapshot.run.subjectId,
      snapshot.spec.targetShelfId || snapshot.spec.shelfId,
    );
    decision.offerId = canonicalDigest({
      schema: 'libra.product-offer-id@1',
      onDeckPackageId: value.onDeckPackageId,
      packageDigest: decision.packageDigest,
    });
    decision.decisionId = canonicalDigest({
      schema: 'libra.deliverable-promotion-decision-id@1',
      libraRunId,
      packageRevision: value.packageRevision,
      packageDigest: decision.packageDigest,
      controlScopeDigest: controlCommitScope.controlScopeDigest,
    });
    decision.decisionDigest = canonicalDigest(without(decision, 'decisionDigest'));
    const controlHandle = Object.freeze({
      schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
      schemaVersion: 1,
      handleId: canonicalDigest({
        schema: 'libra.deliverable-promotion-control-handle-id@1',
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
      ownerDomain: 'libra',
      processType: 'libra_run',
      processId: libraRunId,
      operationKind: 'replace_control_set',
      basisRef: {
        objectType: 'deliverable_promotion',
        objectId: decision.decisionId,
        revision: value.packageRevision,
        digest: decision.decisionDigest,
      },
      basisDigest: decision.decisionDigest,
      canonicalFactSetDigest: factManifest.factSetDigest,
      bindingSetDigest: value.productMaterialManifest.memberSetDigest,
      controlScopeDigest: controlCommitScope.controlScopeDigest,
      expectedControlRevisions: Object.freeze(controlItems.map((item) => ({
        materialKey: item.materialKey,
        revision: item.controlOperation === 'assert_existing_input'
          ? item.expectedControlRevision : 0,
      }))),
      receiptContract: RECEIPT_CONTRACT,
      eventFenceDigest,
    });
    return Object.freeze({
      decision: Object.freeze(decision),
      responsibilityControlCommitHandle: controlHandle,
    });
  }

  return Object.freeze({ conformanceInput, promotion });
}

module.exports = Object.freeze({ createProductDeliveryAssembler });
