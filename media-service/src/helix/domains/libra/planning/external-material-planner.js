'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const external = require('../model/external-material-contracts');
const {
  buildMediaRequirement,
  buildProductMediaCandidateInput,
  buildPlannedProductCandidateReference,
  buildProductOutputSelectionInput,
} = require('../model/media-production-contracts');
const {
  externalAcquireVerificationWork,
  externalImportSelectionWork,
  externalSearchSelectionWork,
} = require('./external-material-work');
const { workspaceId } = require('../model/workspace-admission-contracts');

const QUERY = 'libra.external_material.query.prepare@1';
const SEARCH = 'libra.external_material.search@1';
const SELECT = 'libra.external_material.candidate.select@1';
const REQUEST = 'libra.external_material.acquire.request@1';
const OBSERVE = 'libra.external_material.acquire.observe@1';
const RESOLVE = 'libra.external_material.output.resolve@1';
const STABILITY = 'libra.external_material.stability.observe@1';
const IDENTITY = 'libra.external_material.identity.verify@1';
const PACKAGE = 'libra.external_material.package.verify@1';
const IMPORT = 'libra.workspace.material.import@1';
const PROBE = 'shared.material.media.probe@1';
const VERIFY = 'libra.product_media.verify@1';
const OUTPUT = 'libra.product_output.select@1';
const IMPORTED_CANDIDATE =
  'helix://libra/input-projections/ExternalImportedProductMediaCandidateInput/v1';
const EXTERNAL_SELECTION =
  'helix://libra/input-projections/ExternalProductOutputSelectionInput/v1';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function literal(portName, value) {
  return Object.freeze({ portName, bindingKind:'literal', value });
}

function eventResult(portName, eventId, resultSchemaRef) {
  return Object.freeze({ portName, bindingKind:'event_result', eventId,
    resultSchemaRef });
}

function projected(portName, eventId, resultSchemaRef, projectionRef,
  parameters = {}) {
  return Object.freeze({ portName, bindingKind:'projected_event_result',
    eventId, resultSchemaRef, projectionRef, parameters:Object.freeze(parameters) });
}

function projectedResults(portName, eventResults, projectionRef,
  parameters = {}) {
  return Object.freeze({ portName, bindingKind:'projected_event_results',
    eventResults:Object.freeze(eventResults), projectionRef,
    parameters:Object.freeze(parameters) });
}

function bindings(values) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/EventInputBindingSet/v1',
    schemaVersion: 1,
    bindings: Object.freeze(values),
  });
}

function demand(resourceKinds) {
  const value = { resourceKinds:Object.freeze(resourceKinds) };
  return Object.freeze({ ...value, demandDigest:canonicalDigest(value) });
}

function node(options) {
  const manifest = options.registry.resolve(options.capabilityRef, 'libra').manifest;
  const policy = options.policyRegistry.bindingFor(options.capabilityRef,
    manifest.effectClass);
  const fence = {
    basisDigest: options.request.executionBasisDigest,
    inputSetDigest: canonicalDigest(options.inputBindings),
    eventFenceDigest: canonicalDigest({
      schema: 'libra.external-material-event-fence@1',
      eventId: options.eventId,
      workId: options.request.workId,
    }),
    effectScopeDigest: canonicalDigest({
      schema: 'libra.external-material-event-scope@1',
      libraRunId: options.request.processId,
      eventId: options.eventId,
      capabilityRef: options.capabilityRef,
    }),
  };
  return Object.freeze({
    nodeId: options.nodeId,
    eventId: options.eventId,
    capabilityRef: options.capabilityRef,
    contractVersion: 1,
    inputBindingsSchemaRef: manifest.parametersSchemaRef
      .replace(/\/parameters$/, '/inputs'),
    inputBindings: bindings(options.inputBindings),
    parametersSchemaRef: manifest.parametersSchemaRef,
    parameters: Object.freeze(options.parameters || {}),
    dependsOn: Object.freeze(options.dependsOn || []),
    whenSchemaRef: null,
    when: null,
    effectClass: manifest.effectClass,
    resourceDemandSchemaRef: manifest.resourceDemandSchemaRef,
    resourceDemand: demand(options.resourceKinds),
    approvalRequirementRef: null,
    authorizationRequirementRef: null,
    fenceSchemaRef: manifest.fenceSchemaRef,
    fenceBasis: Object.freeze(fence),
    retryPolicyRef: policy.retryPolicyRef,
    timeoutPolicyRef: policy.timeoutPolicyRef,
    outputContractRef: manifest.resultSchemaRef,
  });
}

function planId(request) {
  return stable('libra-external-material-plan-', {
    workId: request.workId,
    attempt: request.workAttemptId,
  });
}

function envelope(options, request, work, nodes) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1',
    schemaVersion: 1,
    planId: planId(request),
    workAttemptId: request.workAttemptId,
    ownerDomain: 'libra',
    plannerContractRef: options.plannerContractRef,
    plannerVersion: 1,
    workObjectiveTypeRef: work.workObjectiveTypeRef,
    workObjectiveVersion: 1,
    executionBasisDigest: request.executionBasisDigest,
    capabilityCatalogDigest: options.catalogDigest,
    resolution: 'planned',
    diagnosticClassification: null,
    nodes: Object.freeze(nodes),
  });
}

function result(options, work, capabilityRef) {
  return options.workResultReader.read(work.workId).find((item) =>
    item.outcomeKind === 'succeeded' && item.capabilityRef === capabilityRef)
    ?.result || null;
}

function resolvedIdentity(options, snapshot) {
  const fact = options.movieProductionReader.readFact(
    snapshot.run.libraRunId, 'resolved_identity', 1);
  if (!fact?.factValue?.identityDigest) {
    throw new Error('External acquisition requires Resolved Product Identity.');
  }
  return fact.factValue;
}

function productStructure(snapshot) {
  const claims = Object.freeze((snapshot.episodeClaims || []).map((item) =>
    Object.freeze({
      episodeKey: item.episodeKey,
      seasonClaimDigest: item.seasonClaimDigest,
      claimDigest: item.claimDigest,
    })));
  const body = {
    objectId: stable('libra-product-structure-', {
      libraRunId: snapshot.run.libraRunId,
      executionBasisDigest: snapshot.run.executionBasisDigest,
    }),
    revision: 1,
    subjectId: snapshot.run.subjectId,
    structureKind: snapshot.spec.structureKind,
    episodeClaims: claims,
  };
  const structureDigest = canonicalDigest({
    schema: 'libra.product-structure@1',
    subjectId: body.subjectId,
    structureKind: body.structureKind,
    episodeClaims: claims,
  });
  return Object.freeze({ ...body, digest:structureDigest, structureDigest });
}

function episodeDelivery(snapshot) {
  const claims = Object.freeze((snapshot.episodeClaims || []).map((item) =>
    Object.freeze({
      episodeKey: item.episodeKey,
      seasonClaimDigest: item.seasonClaimDigest,
      outputRequirementDigest: item.outputRequirementDigest,
      claimDigest: item.claimDigest,
    })));
  const body = {
    objectId: stable('libra-episode-delivery-', {
      libraRunId: snapshot.run.libraRunId,
      executionBasisDigest: snapshot.run.executionBasisDigest,
    }),
    revision: 1,
    libraRunId: snapshot.run.libraRunId,
    subjectId: snapshot.run.subjectId,
    structureKind: snapshot.spec.structureKind,
    seasonScopeDigest: snapshot.spec.structureKind === 'season'
      ? canonicalDigest({ schema:'libra.external-season-scope@1', claims })
      : null,
    episodeClaims: claims,
  };
  const deliveryDigest = canonicalDigest({
    schema: 'libra.episode-delivery-manifest@1',
    ...body,
  });
  return Object.freeze({ ...body, digest:deliveryDigest, deliveryDigest });
}

function identityRequirement(identity, snapshot) {
  const body = {
    requirementId: stable('libra-external-identity-requirement-', {
      libraRunId: snapshot.run.libraRunId,
      identityDigest: identity.identityDigest,
    }),
    revision: 1,
    schemaRef: 'IdentityRequirement@1',
    expectedIdentityDigest: identity.identityDigest,
    strengthClass: 'exact_provider_identity',
  };
  return Object.freeze({ ...body, digest:canonicalDigest(body) });
}

function integration(options, operationId) {
  const handle = options.resolveExternalMaterialIntegrationHandle?.({
    operationId,
  });
  if (!handle || handle.allowedOperation !== operationId ||
      handle.integrationType !== 'moviepilot') {
    throw new Error('MoviePilot Integration Handle is unavailable for ' +
      operationId + '.');
  }
  return handle;
}

function exactWork(request, work) {
  if (request.workId !== work.workId ||
      request.executionBasisDigest !== work.executionBasisDigest) {
    throw new Error('External Material Work basis changed.');
  }
}

function createExternalMaterialPlanner(options) {
  const catalogDigest = executionCatalogDigest(options.registry,
    options.policyRegistry);
  const plannerContractRef = 'helix://libra/planners/WorkspaceMediaProduction/v1';
  const configured = { plannerContractRef, catalogDigest };
  function handles(request) {
    const snapshot = options.movieProductionReader.readRunSnapshot(
      request.processId);
    return Array.from({length:5},(_,index)=>index+1).flatMap((attempt)=>[
      externalSearchSelectionWork(snapshot,attempt),
      externalAcquireVerificationWork(snapshot,attempt),
      externalImportSelectionWork(snapshot,attempt)])
      .some((work) => work.workId === request.workId);
  }
  return Object.freeze({
    plannerContractRef,
    plannerVersion: 1,
    handles,
    plan(request) {
      const snapshot = options.movieProductionReader.readRunSnapshot(
        request.processId);
      const identity = resolvedIdentity(options, snapshot);
      const structure = productStructure(snapshot);
      const acquisitionAttempt=Array.from({length:5},(_,index)=>index+1).find((attempt)=>[
        externalSearchSelectionWork(snapshot,attempt).workId,externalAcquireVerificationWork(snapshot,attempt).workId,
        externalImportSelectionWork(snapshot,attempt).workId].includes(request.workId));
      if(!acquisitionAttempt)throw new Error('External acquisition attempt is outside the configured bound.');
      const searchWork = externalSearchSelectionWork(snapshot,acquisitionAttempt);
      if (request.workId === searchWork.workId) {
        exactWork(request, searchWork);
        const firstSearchWork=externalSearchSelectionWork(snapshot,1);
        if(acquisitionAttempt>1){
          const frozenQuery=result(options,firstSearchWork,QUERY),frozenCandidates=result(options,firstSearchWork,SEARCH);
          if(!frozenQuery||!frozenCandidates)throw new Error('Later acquisition selection requires the first frozen Candidate Snapshot.');
          const criteria=external.buildSelectionCriteria({revision:1,queryDigest:frozenQuery.queryDigest,attemptOrdinal:acquisitionAttempt});
          const selectEvent=stable('libra-external-select-event-',{attempt:request.workAttemptId});
          return envelope(configured,request,searchWork,[node({...options,request,nodeId:'external_candidate_selection',
            eventId:selectEvent,capabilityRef:SELECT,inputBindings:[literal('candidates',frozenCandidates),
              literal('selectionCriteria',criteria)],resourceKinds:['disk_io','network']})]);
        }
        const mediaRequirement=buildMediaRequirement(snapshot.spec),searchIntegration=integration(options,SEARCH),
          acquisitionSettings=options.readExternalAcquisitionSettings({integrationId:searchIntegration.integrationId,
            configRevision:searchIntegration.configRevision}),
          acquisitionPolicy=external.buildAcquisitionPolicy({integrationId:searchIntegration.integrationId,
            configRevision:searchIntegration.configRevision,maxDownloadAttempts:acquisitionSettings.maxDownloadAttempts});
        const expectedQuery = external.buildAcquisitionQuery({
          resolvedProductIdentity: identity,
          productStructure: structure,
          executionContext: {
            libraRunId: snapshot.run.libraRunId,
            runExecutionBasisDigest: snapshot.run.executionBasisDigest,
          },
          mediaRequirement,acquisitionPolicy,
          producedAtMs: 0,
        });
        const criteria = external.buildSelectionCriteria({
          revision: 1,
          queryDigest: expectedQuery.queryDigest,
          attemptOrdinal:acquisitionAttempt,
        });
        const queryEvent = stable('libra-external-query-event-', {
          attempt: request.workAttemptId,
        });
        const searchEvent = stable('libra-external-search-event-', {
          attempt: request.workAttemptId,
        });
        const selectEvent = stable('libra-external-select-event-', {
          attempt: request.workAttemptId,
        });
        const nodes = [
          node({ ...options, request, nodeId:'external_query',
            eventId:queryEvent, capabilityRef:QUERY,
            inputBindings:[literal('resolvedProductIdentity', identity),
              literal('productStructure', structure),literal('mediaRequirement',mediaRequirement),
              literal('acquisitionPolicy',acquisitionPolicy)], resourceKinds:['cpu','disk_io','network'] }),
          node({ ...options, request, nodeId:'external_search',
            eventId:searchEvent, capabilityRef:SEARCH,
            inputBindings:[eventResult('acquisitionQuery', queryEvent,
              options.registry.resolve(QUERY, 'libra').manifest.resultSchemaRef),
            literal('integrationHandle', searchIntegration)],
            dependsOn:[{eventId:queryEvent,satisfaction:'success'}],
            resourceKinds:['disk_io','network'] }),
          node({ ...options, request, nodeId:'external_candidate_selection',
            eventId:selectEvent, capabilityRef:SELECT,
            inputBindings:[eventResult('candidates', searchEvent,
              options.registry.resolve(SEARCH, 'libra').manifest.resultSchemaRef),
            literal('selectionCriteria', criteria)],
            dependsOn:[{eventId:searchEvent,satisfaction:'success'}],
            resourceKinds:['disk_io','network'] }),
        ];
        return envelope(configured, request, searchWork, nodes);
      }

      const acquireWork = externalAcquireVerificationWork(snapshot,acquisitionAttempt);
      if (request.workId === acquireWork.workId) {
        exactWork(request, acquireWork);
        const selected = result(options, searchWork, SELECT);
        const query = result(options, externalSearchSelectionWork(snapshot,1), QUERY);
        if (!selected || selected.result !== 'selected' || !query) {
          throw new Error('External acquisition Work requires one selected Provider Candidate.');
        }
        const requestEvent = stable('libra-external-request-event-', {
          attempt: request.workAttemptId,
        });
        const observeEvent = stable('libra-external-observe-event-', {
          attempt: request.workAttemptId,
        });
        const resolveEvent = stable('libra-external-resolve-event-', {
          attempt: request.workAttemptId,
        });
        const stabilityEvent = stable('libra-external-stability-event-', {
          attempt: request.workAttemptId,
        });
        const identityEvent = stable('libra-external-identity-event-', {
          attempt: request.workAttemptId,
        });
        const packageEvent = stable('libra-external-package-event-', {
          attempt: request.workAttemptId,
        });
        const nodes = [
          node({ ...options, request, nodeId:'external_acquire_request',
            eventId:requestEvent, capabilityRef:REQUEST,
            inputBindings:[literal('selectedCandidateSelected', selected),
              literal('acquisitionQuery', query),
              literal('integrationHandle', integration(options, REQUEST))],
            resourceKinds:['disk_io','network'] }),
          node({ ...options, request, nodeId:'external_acquire_observation',
            eventId:observeEvent, capabilityRef:OBSERVE,
            inputBindings:[eventResult('externalJobReceipt', requestEvent,
              options.registry.resolve(REQUEST, 'libra').manifest.resultSchemaRef),
            literal('integrationHandle', integration(options, OBSERVE))],
            parameters:{ phase:'transfer' },
            dependsOn:[{eventId:requestEvent,satisfaction:'success'}],
            resourceKinds:['disk_io','network'] }),
          node({ ...options, request, nodeId:'external_output_resolution',
            eventId:resolveEvent, capabilityRef:RESOLVE,
            inputBindings:[eventResult('acquisitionObservation', observeEvent,
              options.registry.resolve(OBSERVE, 'libra').manifest.resultSchemaRef),
            literal('productStructure', structure)],
            dependsOn:[{eventId:observeEvent,satisfaction:'success'}],
            resourceKinds:['cpu','disk_io','network'] }),
          node({ ...options, request, nodeId:'external_stability_observation',
            eventId:stabilityEvent, capabilityRef:STABILITY,
            inputBindings:[eventResult('externalMaterialHandle', resolveEvent,
              options.registry.resolve(RESOLVE, 'libra').manifest.resultSchemaRef),
            literal('integrationHandle', integration(options, STABILITY))],
            parameters:{ quietWindowMs:60_000 },
            dependsOn:[{eventId:resolveEvent,satisfaction:'success'}],
            resourceKinds:['disk_io','network'] }),
          node({ ...options, request, nodeId:'external_identity_verification',
            eventId:identityEvent, capabilityRef:IDENTITY,
            inputBindings:[eventResult('stableEvidence', stabilityEvent,
              options.registry.resolve(STABILITY, 'libra').manifest.resultSchemaRef),
            literal('resolvedProductIdentity', identity)],
            dependsOn:[{eventId:stabilityEvent,satisfaction:'success'}],
            resourceKinds:['cpu','disk_io','network'] }),
          node({ ...options, request, nodeId:'external_package_verification',
            eventId:packageEvent, capabilityRef:PACKAGE,
            inputBindings:[eventResult('stableEvidence', stabilityEvent,
              options.registry.resolve(STABILITY, 'libra').manifest.resultSchemaRef),
            eventResult('identityVerification', identityEvent,
              options.registry.resolve(IDENTITY, 'libra').manifest.resultSchemaRef),
            literal('episodeDeliveryManifest', episodeDelivery(snapshot)),
            literal('identityRequirement', identityRequirement(identity, snapshot))],
            dependsOn:[{eventId:stabilityEvent,satisfaction:'success'},
              {eventId:identityEvent,satisfaction:'success'}],
            resourceKinds:['cpu','disk_io','network'] }),
        ];
        return envelope(configured, request, acquireWork, nodes);
      }

      const importWork = externalImportSelectionWork(snapshot,acquisitionAttempt);
      exactWork(request, importWork);
      const stableEvidence = result(options, acquireWork, STABILITY);
      const verified = result(options, acquireWork, PACKAGE);
      if (!stableEvidence || !verified || verified.result !== 'passed') {
        throw new Error('External import requires one passed verified Package.');
      }
      const workspace = options.movieProductionReader.readWorkspace(
        workspaceId(snapshot.run.libraRunId));
      if (!workspace || workspace.state !== 'active') {
        throw new Error('External import requires an active Libra Workspace.');
      }
      const contracts = external.buildWorkspaceDeliveryContracts({
        verifiedExternalPackage: verified,
        stableEvidence,
        libraRunId: snapshot.run.libraRunId,
        workspaceId: workspace.workspaceId,
        expectedWorkspaceRevision: workspace.currentRevision,
        expectedWorkspaceStateDigest: workspace.stateDigest,
        rootSnapshot: options.workspaceProductPort.rootSnapshot(),
      });
      if (contracts.length !== 1) {
        throw new Error('Movie external import requires exactly one verified media member.');
      }
      const contract = contracts[0];
      const importEvent = stable('libra-external-import-event-', {
        attempt: request.workAttemptId,
      });
      const probeEvent = stable('libra-external-import-probe-event-', {
        attempt: request.workAttemptId,
      });
      const verifyEvent = stable('libra-external-import-verify-event-', {
        attempt: request.workAttemptId,
      });
      const selectEvent = stable('libra-external-import-select-event-', {
        attempt: request.workAttemptId,
      });
      const eventExecutionKey = canonicalDigest({
        schema: 'helix.event-execution-key@1',
        eventId: importEvent,
        workAttemptId: request.workAttemptId,
        planId: planId(request),
      });
      const mediaRequirement = buildMediaRequirement(snapshot.spec);
      const candidateNodeId = 'external_import_output';
      const candidateRef = buildPlannedProductCandidateReference({
        rank:1,
        candidateKind:'workspace_output',
        candidateNodeId,
        mediaRequirementDigest:mediaRequirement.requirementDigest,
        outputTargetId:contract.contractId,
        outputTargetDigest:contract.digest,
        productionIntentDigest:contract.digest,
      });
      const nodes = [
        node({ ...options, request, nodeId:'external_workspace_import',
          eventId:importEvent, capabilityRef:IMPORT,
          inputBindings:[literal('stableEvidence', stableEvidence),
            literal('verifiedExternalPackage', verified),
            literal('workspaceDeliveryContract', contract)],
          resourceKinds:['disk_io','network'] }),
        node({ ...options, request, nodeId:'external_import_probe',
          eventId:probeEvent, capabilityRef:PROBE,
          inputBindings:[eventResult(
            'physicalMaterialReadHandleOrWorkspaceMaterialHandle', importEvent,
            options.registry.resolve(IMPORT, 'libra').manifest.resultSchemaRef)],
          dependsOn:[{eventId:importEvent,satisfaction:'success'}],
          resourceKinds:['cpu','disk_io'] }),
        node({ ...options, request, nodeId:'external_import_verification',
          eventId:verifyEvent, capabilityRef:VERIFY,
          inputBindings:[projectedResults('productMediaCandidateInput', [
            {eventId:importEvent,resultSchemaRef:
              options.registry.resolve(IMPORT, 'libra').manifest.resultSchemaRef},
            {eventId:probeEvent,resultSchemaRef:
              options.registry.resolve(PROBE, 'libra').manifest.resultSchemaRef},
          ], IMPORTED_CANDIDATE, { workspaceDeliveryContract:contract,
            importEventId:importEvent, eventExecutionKey, mediaRequirement,
            candidateNodeId, libraRunId:snapshot.run.libraRunId })],
          dependsOn:[{eventId:importEvent,satisfaction:'success'},
            {eventId:probeEvent,satisfaction:'success'}],
          resourceKinds:['cpu','disk_io'] }),
        node({ ...options, request, nodeId:'external_import_selection',
          eventId:selectEvent, capabilityRef:OUTPUT,
          inputBindings:[projected('productOutputSelectionInput', verifyEvent,
            options.registry.resolve(VERIFY, 'libra').manifest.resultSchemaRef,
            EXTERNAL_SELECTION, { candidateNodeId,
              libraRunId:snapshot.run.libraRunId,
              acceptanceSpecId:snapshot.spec.acceptanceSpecId,
              acceptanceSpecRecordDigest:snapshot.spec.recordDigest,
              mediaRequirementDigest:mediaRequirement.requirementDigest,
              rankedCandidates:Object.freeze([candidateRef]) })],
          dependsOn:[{eventId:verifyEvent,satisfaction:'success'}],
          resourceKinds:['cpu'] }),
      ];
      return envelope(configured, request, importWork, nodes);
    },
  });
}

function createExternalMaterialProjections() {
  return Object.freeze([
    Object.freeze({
      projectionRef: IMPORTED_CANDIDATE,
      projection: Object.freeze({
        project({ sourceResults, parameters }) {
          const imported = sourceResults.find((item) =>
            item.resultSchemaRef ===
              'helix://contracts/capabilities/libra.workspace.material.import/v1/result')?.result;
          const probe = sourceResults.find((item) =>
            item.resultSchemaRef ===
              'helix://contracts/capabilities/shared.material.media.probe/v1/result')?.result;
          if (!imported || !probe) {
            throw new Error('External imported media projection lacks import or Probe Result.');
          }
          const workspaceMediaHandle = external.buildImportedWorkspaceMediaHandle({
            workspaceDeliveryContract: parameters.workspaceDeliveryContract,
            workspaceMaterialHandle: imported,
            producingEventId: parameters.importEventId,
            idempotencyKey: parameters.eventExecutionKey,
          });
          return buildProductMediaCandidateInput({
            libraRunId: parameters.libraRunId,
            candidateNodeId: parameters.candidateNodeId,
            candidateKind: 'workspace_output',
            mediaRequirement: parameters.mediaRequirement,
            workspaceMediaHandle,
            sourceProbeEvidence: probe,
            outputProbeEvidence: probe,
          });
        },
      }),
    }),
    Object.freeze({
      projectionRef: EXTERNAL_SELECTION,
      projection: Object.freeze({
        project({ sourceResult: result, parameters }) {
          if (!Array.isArray(parameters.rankedCandidates) ||
              parameters.rankedCandidates.length !== 1 ||
              parameters.rankedCandidates[0].candidateNodeId !==
                parameters.candidateNodeId) {
            throw new Error(
              'External Product Output rank is absent from the immutable Plan.',
            );
          }
          return buildProductOutputSelectionInput({
            libraRunId: parameters.libraRunId,
            acceptanceSpecId: parameters.acceptanceSpecId,
            acceptanceSpecRecordDigest:
              parameters.acceptanceSpecRecordDigest,
            mediaRequirementDigest: parameters.mediaRequirementDigest,
            rankedCandidates: parameters.rankedCandidates,
            candidates: [result],
          });
        },
      }),
    }),
  ]);
}

module.exports = Object.freeze({
  EXTERNAL_SELECTION,
  IMPORTED_CANDIDATE,
  createExternalMaterialPlanner,
  createExternalMaterialProjections,
  episodeDelivery,
  identityRequirement,
  productStructure,
});
