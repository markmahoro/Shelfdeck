'use strict';
const {canonicalDigest, canonicalJson} = require('../../../contracts/canonical-json');
const {executionCatalogDigest} = require('../../../foundation/execution/workflow-plan');
const {FRAME, EMBED, CLUSTER, MATCH, resultRef, frameWork, matchWork, exactResult} = require('../model/us-adult-analysis-work');
const PREFIX = 'helix://libra/input-projections/UsAdultAnalysis';
const PROJECTIONS = Object.freeze({source:PREFIX + 'Source/v1', sampling:PREFIX + 'Sampling/v1', target:PREFIX + 'FrameTarget/v1',
  model:PREFIX + 'Model/v1', cluster:PREFIX + 'Clustering/v1', frameList:PREFIX + 'FrameList/v1', clusters:PREFIX + 'Clusters/v1', references:PREFIX + 'References/v1'});
const stable = (prefix, value) => prefix + canonicalDigest(value).slice(0, 40);
function owner(portName, request, projectionRef, parameters) {
  return {portName, bindingKind:'projected_owner_facts', ownerDomain:'libra', processType:'libra_run', processId:request.processId,
    projectionRef, parameters};
}
function frameTarget(options, basis) {
  const workspace = options.movieProductionReader.readWorkspace(basis.workspaceId), rootSnapshot = options.workspaceProductPort.rootSnapshot();
  if (!workspace || workspace.state !== 'active' || workspace.libraRunId !== basis.libraRunId) throw new Error('US Adult frame target requires its active Run Workspace.');
  const targetRelativePath = 'analysis/frames/' + basis.analysisId + '.json', outputKind = 'frame_set',
    sourceInputDigest = canonicalDigest({sourceHandle:basis.sourceHandle, samplingPlan:basis.samplingPlan}),
    targetId = canonicalDigest({schema:'libra.workspace-artifact-output-target-id@1', workspaceId:basis.workspaceId, targetRelativePath, outputKind, sourceInputDigest}),
    value = {targetId, libraRunId:basis.libraRunId, executionBasisDigest:basis.runExecutionBasisDigest, workspaceId:basis.workspaceId,
      expectedWorkspaceRevision:workspace.currentRevision, expectedWorkspaceStateDigest:workspace.stateDigest, rootSnapshot,
      workspaceScopeDigest:workspace.workspaceScopeDigest, targetRelativePath, outputKind, sourceInputDigest};
  const effectScopeDigest = canonicalDigest({schema:'libra.workspace-artifact-output-effect-scope@1', targetId, libraRunId:value.libraRunId,
    executionBasisDigest:value.executionBasisDigest, workspaceId:value.workspaceId, expectedWorkspaceRevision:value.expectedWorkspaceRevision,
    expectedWorkspaceStateDigest:value.expectedWorkspaceStateDigest, rootSnapshotDigest:rootSnapshot.snapshotDigest,
    workspaceScopeDigest:value.workspaceScopeDigest, outputKind, sourceInputDigest});
  const target = {...value, effectScopeDigest}; return Object.freeze({...target, targetDigest:canonicalDigest(target)});
}
function readBasis(options, scope, parameters) {
  const basis = options.usAdultAnalysisStore.getByRun(scope.processId), snapshot = options.movieProductionReader.readRunSnapshot(scope.processId);
  if (!basis || !snapshot || scope.ownerDomain !== 'libra' || scope.processType !== 'libra_run' ||
      snapshot.spec.contentProfile !== 'western_adult' || snapshot.run.executionBasisDigest !== basis.runExecutionBasisDigest ||
      parameters.analysisId !== basis.analysisId) throw new Error('US Adult analysis projection has a stale Owner basis.');
  return {basis, snapshot};
}
function createUsAdultAnalysisPlanner(options) {
  const catalogDigest = executionCatalogDigest(options.registry, options.policyRegistry);
  return Object.freeze({plannerContractRef:'helix://libra/planners/UsAdultAnalysis/v1', plannerVersion:1, plan(request) {
    const basis = options.usAdultAnalysisStore.getByRun(request.processId), snapshot = options.movieProductionReader.readRunSnapshot(request.processId);
    if (!basis || request.executionBasisDigest !== basis.runExecutionBasisDigest) throw new Error('US Adult analysis planning basis changed.');
    const frames = frameWork(snapshot, basis), parameters = {analysisId:basis.analysisId}; let work = frames, pageOrdinal = null;
    if (request.workId !== frames.workId) {
      const match = /^libra-us-adult-match-(\d+)-work-/.exec(request.workId); pageOrdinal = match ? Number(match[1]) : -1;
      work = matchWork(snapshot, basis, pageOrdinal);
    }
    if (request.workId !== work.workId) throw new Error('US Adult analysis Work differs from the frozen reference page.');
    const node = (name, capabilityRef, inputBindings, dependencies = []) => {
      const manifest = options.registry.resolve(capabilityRef, 'libra').manifest, policy = options.policyRegistry.bindingFor(capabilityRef, manifest.effectClass),
        eventId = stable('libra-us-adult-' + name + '-event-', {attempt:request.workAttemptId}),
        resourceKinds = capabilityRef===FRAME?['cpu','disk_io']:capabilityRef===EMBED?['compute_device','cpu','disk_io']:['compute_device','cpu'],
        resourceDemand = {resourceKinds};
      return Object.freeze({nodeId:name, eventId, capabilityRef, contractVersion:1,
        inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1', schemaVersion:1, bindings:inputBindings},
        parametersSchemaRef:manifest.parametersSchemaRef, parameters:{}, dependsOn:dependencies,
        whenSchemaRef:null, when:null, effectClass:manifest.effectClass, resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
        resourceDemand:{...resourceDemand, demandDigest:canonicalDigest(resourceDemand)}, approvalRequirementRef:null, authorizationRequirementRef:null,
        fenceSchemaRef:manifest.fenceSchemaRef, fenceBasis:{basisDigest:request.executionBasisDigest, inputSetDigest:canonicalDigest(inputBindings),
          eventFenceDigest:canonicalDigest({schema:'libra.us-adult-event-fence@1', eventId, workId:request.workId}),
          effectScopeDigest:canonicalDigest({schema:'libra.us-adult-event-scope@1', eventId, analysisId:basis.analysisId, capabilityRef})},
        retryPolicyRef:policy.retryPolicyRef, timeoutPolicyRef:policy.timeoutPolicyRef, outputContractRef:manifest.resultSchemaRef});
    };
    const projected = (portName, event, projectionRef) => ({portName, bindingKind:'projected_event_result', eventId:event.eventId,
      resultSchemaRef:resultRef(event.capabilityRef), projectionRef, parameters});
    let nodes;
    if (pageOrdinal === null) {
      const extracted = node('frames', FRAME, [owner('physicalMaterialReadHandleOrWorkspaceMaterialHandle', request, PROJECTIONS.source, parameters),
        owner('samplingPlan', request, PROJECTIONS.sampling, parameters), owner('workspaceArtifactOutputTarget', request, PROJECTIONS.target, parameters)]),
        embedded = node('embedding', EMBED, [projected('artifactHandleList', extracted, PROJECTIONS.frameList),
          owner('faceModelRef', request, PROJECTIONS.model, parameters)], [{eventId:extracted.eventId,satisfaction:'success'}]),
        clustered = node('clustering', CLUSTER, [{portName:'faceEmbeddingSetHandle', bindingKind:'event_result', eventId:embedded.eventId,
          resultSchemaRef:resultRef(EMBED)}, owner('clusterParameters', request, PROJECTIONS.cluster, parameters)], [{eventId:embedded.eventId,satisfaction:'success'}]);
      nodes = [extracted, embedded, clustered];
    } else nodes = [node('reference_match', MATCH, [owner('faceClusterSetHandle', request, PROJECTIONS.clusters, parameters),
      owner('personReferenceProjectionList', request, PROJECTIONS.references, {...parameters, pageOrdinal})])];
    return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1', schemaVersion:1,
      planId:stable('libra-us-adult-plan-', {attempt:request.workAttemptId}), workAttemptId:request.workAttemptId,
      ownerDomain:'libra', plannerContractRef:this.plannerContractRef, plannerVersion:1, workObjectiveTypeRef:work.workObjectiveTypeRef,
      workObjectiveVersion:1, executionBasisDigest:request.executionBasisDigest, capabilityCatalogDigest:catalogDigest,
      resolution:'planned', diagnosticClassification:null, nodes:Object.freeze(nodes)});
  }});
}
function createUsAdultAnalysisProjections(options) {
  const projectors = {
    source:({basis}) => basis.sourceHandle, sampling:({basis}) => basis.samplingPlan, target:({basis}) => frameTarget(options, basis),
    model:({basis}) => basis.faceModelRef, cluster:({basis}) => basis.clusterParameters,
    frameList:({basis, sourceResult}) => {
      if (sourceResult.libraRunId !== basis.libraRunId || sourceResult.workspaceId !== basis.workspaceId ||
          sourceResult.sourceMaterialDigest !== canonicalDigest(basis.sourceHandle) || sourceResult.samplingPlanDigest !== basis.samplingPlan.digest) {
        throw new Error('US Adult frame Result differs from its frozen source or sampling.');
      }
      return Object.freeze([sourceResult.frameSetArtifactHandle]);
    },
    clusters:({basis, snapshot}) => exactResult(options, frameWork(snapshot, basis), CLUSTER).result,
    references:({basis, parameters}) => options.usAdultAnalysisStore.readPage(basis.analysisId, parameters.pageOrdinal).items.map(item => item.referenceProjection),
  };
  return Object.freeze(Object.entries(projectors).map(([name, project]) => Object.freeze({projectionRef:PROJECTIONS[name],
    projection:Object.freeze({project(input) { return project({...input, ...readBasis(options, input.ownerScope, input.parameters)}); }})})));
}
module.exports = Object.freeze({PROJECTIONS, frameTarget, createUsAdultAnalysisPlanner, createUsAdultAnalysisProjections});
