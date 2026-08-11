'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { activeTriageRule } = require('../model/procurement-run-contracts');

const IDENTITY='procurement.triage.identity_claim.resolve@1',MANIFEST='procurement.triage.primary_manifest.build@1',PUBLISH='procurement.candidate.publish@1';
const DRAFT_PROJECTION='helix://procurement/input-projections/CandidateDraft/v1';
const COMMIT_HANDLE_PROJECTION='helix://procurement/input-projections/CandidateCommitHandle/v1';
const IDENTITY_INPUT_PROJECTION='helix://procurement/input-projections/TriageIdentityResolutionInput/v1';
const MANIFEST_INPUT_PROJECTION='helix://procurement/input-projections/TriageManifestBuildInput/v1';
function stableId(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function without(value,...fields){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function literal(portName,value){return Object.freeze({portName,bindingKind:'literal',value});}
function results(portName,eventResults,projectionRef,parameters){return Object.freeze({portName,bindingKind:'projected_event_results',eventResults:Object.freeze(eventResults),projectionRef,parameters:Object.freeze(parameters)});}
function ownerFacts(portName,request,projectionRef,parameters){return Object.freeze({portName,bindingKind:'projected_owner_facts',
  ownerDomain:request.ownerDomain,processType:request.processType,processId:request.processId,projectionRef,parameters:Object.freeze(parameters)});}
function set(bindings){return Object.freeze({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:Object.freeze(bindings)});}
function demand(kinds){const value={resourceKinds:Object.freeze(kinds)};return Object.freeze({...value,demandDigest:canonicalDigest(value)});}
function eventNode(options,ref,nodeId,eventId,bindings,dependencies,kinds){const m=options.registry.resolve(ref,'procurement').manifest,p=options.policyRegistry.bindingFor(ref,m.effectClass);
  const fence={basisDigest:options.request.executionBasisDigest,inputSetDigest:canonicalDigest(bindings),
    eventFenceDigest:canonicalDigest({schema:'procurement.candidate-event-fence@1',eventId,workId:options.request.workId}),
    effectScopeDigest:canonicalDigest({schema:'procurement.candidate-event-scope@1',eventId,runId:options.snapshot.run.procurement_run_id})};
  return Object.freeze({nodeId,eventId,capabilityRef:ref,contractVersion:1,inputBindingsSchemaRef:m.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
    inputBindings:set(bindings),parametersSchemaRef:m.parametersSchemaRef,parameters:Object.freeze({}),dependsOn:Object.freeze(dependencies),whenSchemaRef:null,when:null,
    effectClass:m.effectClass,resourceDemandSchemaRef:m.resourceDemandSchemaRef,resourceDemand:demand(kinds),approvalRequirementRef:null,authorizationRequirementRef:null,
    fenceSchemaRef:m.fenceSchemaRef,fenceBasis:Object.freeze(fence),retryPolicyRef:p.retryPolicyRef,timeoutPolicyRef:p.timeoutPolicyRef,outputContractRef:m.resultSchemaRef});}
function evidenceWorkId(snapshot){return stableId('procurement-evidence-work-',{runId:snapshot.run.procurement_run_id,basis:snapshot.run.run_basis_digest});}
function unplannable(planner,request,catalogDigest,diagnosticClassification){return Object.freeze({
  schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
  planId:stableId('candidate-plan-',{attempt:request.workAttemptId}),workAttemptId:request.workAttemptId,
  ownerDomain:'procurement',plannerContractRef:planner.plannerContractRef,plannerVersion:1,
  workObjectiveTypeRef:'helix://procurement/work/CandidateAssembly/v1',workObjectiveVersion:1,
  executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest,
  resolution:'contract_unplannable',diagnosticClassification,nodes:Object.freeze([])});}
function createCandidateAssemblyPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);return Object.freeze({
  plannerContractRef:'helix://procurement/planners/CandidateAssembly/v1',plannerVersion:1,plan(request){const run=options.triageReader.readRunHeader(request.processId),snapshot=run&&Object.freeze({run}),found=run&&options.evidenceIndex.findCandidate(request.workId,run.procurement_run_id,evidenceWorkId(snapshot));
    if(!run||!found)return unplannable(this,request,catalogDigest,'candidate_structure_unit_unavailable');
    const {structure,unit,ordinal}=found,rule=activeTriageRule(options.triageRuleRegistry);
    // Related Material is reconstructed from the frozen Observation scope, not
    // embedded in Structure.  Its exclusive disposition scope nevertheless has
    // the same closed 1024-member handoff bound.  Detect an unrepresentable
    // Candidate while planning so it becomes a terminal business Work outcome;
    // never publish a known-invalid Capability input and fault the global Host.
    const context=options.candidateContextReader.read({runId:run.procurement_run_id,
      evidenceWorkId:evidenceWorkId(snapshot),unitId:unit.unitId,workId:request.workId});
    if(!context)return unplannable(this,request,catalogDigest,'candidate_structure_unit_unavailable');
    if(context.relatedReferences.length>1024){
      return unplannable(this,request,catalogDigest,'candidate_disposition_scope_unrepresentable');
    }
    const identityEvent='candidate-'+String(ordinal).padStart(4,'0')+'-identity-'+canonicalDigest(request.workAttemptId).slice(0,20);
    const manifestEvent='candidate-'+String(ordinal).padStart(4,'0')+'-manifest-'+canonicalDigest(request.workAttemptId).slice(0,20);
    const publishEvent='candidate-'+String(ordinal).padStart(4,'0')+'-publish-'+canonicalDigest(request.workAttemptId).slice(0,20);
    const identityRef={eventId:identityEvent,resultSchemaRef:options.registry.resolve(IDENTITY,'procurement').manifest.resultSchemaRef};
    const manifestRef={eventId:manifestEvent,resultSchemaRef:options.registry.resolve(MANIFEST,'procurement').manifest.resultSchemaRef};
    const projectionParameters={runId:snapshot.run.procurement_run_id,unitId:unit.unitId,ordinal,workId:request.workId,
      idempotencyKey:request.idempotencyKey,publishEventId:publishEvent};
    const nodes=[eventNode({registry:options.registry,policyRegistry:options.policyRegistry,request,snapshot},IDENTITY,'identity',identityEvent,
      [ownerFacts('triageIdentityResolutionInput',request,IDENTITY_INPUT_PROJECTION,{unitId:unit.unitId,workId:request.workId}),literal('procurementTriageRuleSnapshot',rule)],[],['cpu']),
    eventNode({registry:options.registry,policyRegistry:options.policyRegistry,request,snapshot},MANIFEST,'manifest',manifestEvent,
      [ownerFacts('triageManifestBuildInput',request,MANIFEST_INPUT_PROJECTION,{unitId:unit.unitId,workId:request.workId}),literal('procurementTriageRuleSnapshot',rule)],[],['cpu']),
    eventNode({registry:options.registry,policyRegistry:options.policyRegistry,request,snapshot},PUBLISH,'publication',publishEvent,
      [results('candidateDraft',[identityRef,manifestRef],DRAFT_PROJECTION,projectionParameters),
        results('domainFactCommitHandle',[identityRef,manifestRef],COMMIT_HANDLE_PROJECTION,projectionParameters)],
      [{eventId:identityEvent,satisfaction:'success'},{eventId:manifestEvent,satisfaction:'success'}],['cpu'])];
    return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:stableId('candidate-plan-',{attempt:request.workAttemptId}),
      workAttemptId:request.workAttemptId,ownerDomain:'procurement',plannerContractRef:this.plannerContractRef,plannerVersion:1,
      workObjectiveTypeRef:'helix://procurement/work/CandidateAssembly/v1',workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,
      capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,nodes:Object.freeze(nodes)});}});}

function draft(parameters,sourceResults){const identity=sourceResults.find((source)=>source.resultSchemaRef.includes('identity_claim.resolve')).result;
  const manifest=sourceResults.find((source)=>source.resultSchemaRef.includes('primary_manifest.build')).result;
  const {snapshot,structure,unit,candidateMembers,rule,ordinal}=parameters;
  const relatedReferences=Object.freeze([...(parameters.relatedReferences || [])].sort((a,b)=>Buffer.compare(Buffer.from(a.referenceId),Buffer.from(b.referenceId))));
  const relatedDispositionItems=Object.freeze(relatedReferences.map((reference)=>Object.freeze({
    referenceId:reference.referenceId,primaryMaterialKey:reference.primaryMaterialKey,role:reference.role,
    materialKey:reference.identity.materialKey,dispositionBasisDigest:reference.dispositionBasisDigest})));
  const controls=Object.freeze([...(candidateMembers || unit.members)].sort((a,b)=>Buffer.compare(Buffer.from(a.materialKey),Buffer.from(b.materialKey))).map((member)=>Object.freeze({
    materialKey:member.materialKey,admittedControlRevision:member.admittedControlRevision,admittedControlProjectionDigest:member.admittedControlProjectionDigest})));
  const value={draftId:stableId('candidate-draft-',{runId:snapshot.run.procurement_run_id,unitId:unit.unitId}),draftKind:'procurement_candidate',
    basisDigest:structure.payloadDigest,draftDigest:'',producedAtMs:0,candidatePackageId:stableId('candidate-package-',{runId:snapshot.run.procurement_run_id,unitId:unit.unitId}),
    procurementRunId:snapshot.run.procurement_run_id,runBasisDigest:snapshot.run.run_basis_digest,
    triageRule:{ruleRef:rule.ruleRef,revision:rule.revision,authorityDigest:rule.authorityDigest},materialFieldContextRef:{fieldId:snapshot.run.field_id,
      accessRevision:Number(snapshot.run.access_revision),contextDigest:structure.materialFieldContextDigest},mediaType:unit.mediaType,contentProfile:unit.contentProfile,
    displayIdentity:unit.displayIdentity,identityMetadata:unit.identityMetadata,identityClaim:identity,materialInputForm:unit.materialInputForm,
    structureEvidence:{evidenceId:structure.evidenceId,payloadDigest:structure.payloadDigest,unit},primaryInputManifestDraft:manifest,
    seasonContinuityClaims:unit.seasonContinuityClaims,seasonContinuityClaimSetDigest:unit.seasonContinuityClaimSetDigest,relatedReferences,
    relatedReferenceSetDigest:canonicalDigest({schema:'procurement.related-reference-set@1',items:relatedReferences}),
    relatedDispositionScopeDigest:canonicalDigest({schema:'procurement.related-disposition-scope@1',items:relatedDispositionItems}),
    memberControlEvidenceSetDigest:canonicalDigest({schema:'procurement.candidate-member-control-evidence@1',items:controls}),candidateDraftDigest:''};
  value.candidateDraftDigest=canonicalDigest(without(value,'draftDigest','candidateDraftDigest'));value.draftDigest=value.candidateDraftDigest;return Object.freeze(value);}
function hydrate(parameters,options){
  const run=options.triageReader.readRunHeader(parameters.runId);
  if(!run)throw new Error('Candidate projection Run is unavailable.');
  const context=options.candidateContextReader.read({runId:parameters.runId,evidenceWorkId:evidenceWorkId({run}),unitId:parameters.unitId,workId:parameters.workId});
  if(!context)throw new Error('Candidate projection source Structure Unit is unavailable.');
  return Object.freeze({...parameters,snapshot:context.snapshot,structure:context.structure,unit:context.unit,
    candidateMembers:context.candidateMembers,relatedReferences:context.relatedReferences,rule:context.rule});}
function createCandidateDraftProjection(options){return Object.freeze({project({sourceResults,parameters}){return draft(hydrate(parameters,options),sourceResults);}});}
function createCandidateCommitHandleProjection(options){return Object.freeze({project({sourceResults,parameters}){const value=draft(hydrate(parameters,options),sourceResults);return Object.freeze({
  schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:stableId('candidate-commit-handle-',{draftId:value.draftId}),
  ownerDomain:'procurement',aggregateType:'candidate_package',aggregateId:value.candidatePackageId,factType:'CandidateDraft',
  factSchemaRef:'helix://contracts/domain-types/CandidateDraft/v1',expectedRevision:0,payloadDigest:canonicalDigest(value),
  resultSchemaRef:'helix://contracts/types/CandidatePublicationReceipt/v1',commitIdempotencyKey:parameters.idempotencyKey,
  eventFenceDigest:canonicalDigest({schema:'procurement.candidate-event-fence@1',eventId:parameters.publishEventId,workId:parameters.workId})});}});}

function createCandidateIdentityInputProjection(options){return Object.freeze({project({ownerScope,parameters}){const hydrated=hydrate({
  runId:ownerScope.processId,unitId:parameters.unitId,workId:parameters.workId},options);return Object.freeze({procurementRunId:ownerScope.processId,
  runBasisDigest:hydrated.snapshot.run.run_basis_digest,triageRuleAuthorityDigest:hydrated.rule.authorityDigest,
  structureEvidenceId:hydrated.structure.evidenceId,structureEvidencePayloadDigest:hydrated.structure.payloadDigest,
  unit:hydrated.unit,inputDigest:hydrated.structure.payloadDigest});}});}
function createCandidateManifestInputProjection(options){return Object.freeze({project({ownerScope,parameters}){const hydrated=hydrate({
  runId:ownerScope.processId,unitId:parameters.unitId,workId:parameters.workId},options);return Object.freeze({preallocatedManifestId:stableId('primary-input-manifest-',{
    runId:ownerScope.processId,unitId:parameters.unitId}),procurementRunId:ownerScope.processId,
  runBasisDigest:hydrated.snapshot.run.run_basis_digest,structureEvidencePayloadDigest:hydrated.structure.payloadDigest,
  triageRuleAuthorityDigest:hydrated.rule.authorityDigest,structureEvidenceId:hydrated.structure.evidenceId,unit:hydrated.unit,
  candidateMembers:hydrated.candidateMembers,inputDigest:hydrated.structure.payloadDigest});}});}

module.exports=Object.freeze({DRAFT_PROJECTION,COMMIT_HANDLE_PROJECTION,IDENTITY_INPUT_PROJECTION,MANIFEST_INPUT_PROJECTION,
  createCandidateAssemblyPlanner,createCandidateDraftProjection,createCandidateCommitHandleProjection,
  createCandidateIdentityInputProjection,createCandidateManifestInputProjection});
