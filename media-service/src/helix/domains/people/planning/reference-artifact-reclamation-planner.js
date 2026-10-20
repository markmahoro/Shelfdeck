'use strict';
const {canonicalDigest:D}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {AUDIT,RECLAIM}=require('../../../contracts/people-artifact-reclamation');
const PLANNER='helix://people/planners/ReferenceArtifactReclamation/v1',PROJECTION='helix://people/input-projections/ReferenceArtifactAudit/v1',
  RECLAIM_PROJECTION='helix://people/input-projections/ReferenceArtifactReclamation/v1';
function createReferenceArtifactReclamationPlanning(options){
  const query=options.artifactReclamation,catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry),
    planner={plannerContractRef:PLANNER,plannerVersion:1,plan(request){const work=query.definition(request.workId),audit=work.workKind==='reference_artifact_audit',
      capabilityRef=audit?AUDIT:RECLAIM,manifest=options.registry.resolve(capabilityRef,'people').manifest,policy=options.policyRegistry.bindingFor(capabilityRef,manifest.effectClass),
      eventId='people-gc-event-'+D(request.workAttemptId),bindings=[{portName:audit?'peopleArtifactReferenceAuditInput':'peopleArtifactReferenceEvidence',
        bindingKind:'projected_owner_facts',ownerDomain:'people',processType:work.processType,processId:work.processId,
        projectionRef:audit?PROJECTION:RECLAIM_PROJECTION,parameters:{workId:work.workId}}],
      resource={resourceKinds:audit?['cpu','disk_io']:['cpu','disk_io','sqlite_write']};
    if(request.executionBasisDigest!==work.executionBasisDigest||request.processId!==work.processId)throw new TypeError('Reference Artifact planner requires the exact frozen Work.');
    return {schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:'people-gc-plan-'+D(request.workAttemptId),
      workAttemptId:request.workAttemptId,ownerDomain:'people',plannerContractRef:PLANNER,plannerVersion:1,workObjectiveTypeRef:request.workObjectiveTypeRef,workObjectiveVersion:1,
      executionBasisDigest:work.executionBasisDigest,capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,nodes:[{
        nodeId:audit?'audit':'reclaim',eventId,capabilityRef,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace('/parameters','/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},
        dependsOn:[],whenSchemaRef:null,when:null,effectClass:manifest.effectClass,resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
        resourceDemand:{...resource,demandDigest:D(resource)},approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,
        fenceBasis:{basisDigest:work.executionBasisDigest,inputSetDigest:D(bindings),eventFenceDigest:D({workId:work.workId,eventId}),effectScopeDigest:D({processId:work.processId,eventId})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef}]};
  }};
  const projection=(projectionRef,reclaim)=>({projectionRef,projection:{project({ownerScope,parameters}){
    const work=query.definition(parameters.workId);if(ownerScope.ownerDomain!=='people'||ownerScope.processType!==work.processType||ownerScope.processId!==work.processId)
      throw new TypeError('Reference Artifact projection is outside its exact Owner process.');
    const input=query.input(parameters.workId);return reclaim?input.previousEvidence:input;
  }}});
  return {planners:['reference_artifact_audit','reference_artifact_reclaim'].map(workKind=>({ownerDomain:'people',workKind,plannerContractRef:PLANNER,plannerVersion:1,planner})),
    bindingProjections:[projection(PROJECTION,false),projection(RECLAIM_PROJECTION,true)]};
}
module.exports=Object.freeze({createReferenceArtifactReclamationPlanning});
