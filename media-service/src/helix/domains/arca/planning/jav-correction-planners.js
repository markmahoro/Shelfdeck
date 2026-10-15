'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {executionCatalogDigest}=require('../../../foundation/execution/workflow-plan');
const {CAPABILITY,SOURCE_CAPABILITY,STAGE_CAPABILITY,PUBLISH_CAPABILITY,VERIFY_CAPABILITY}=require('../model/jav-correction-execution-contract');
const {CAPABILITY:COMMIT_CAPABILITY}=require('../model/jav-correction-commit-contract');
const {CAPABILITY:RETIREMENT_CAPABILITY}=require('../model/jav-correction-retirement-contract');
const {CAPABILITY:RECLAIM_CAPABILITY}=require('../model/jav-correction-workspace-reclaim-contract');
const {RECOVERY_SOURCE_PROJECTION,readJavCorrectionSourceResult}=require('../model/jav-correction-source-result');
const PLANNER='helix://arca/planners/jav-correction-assets/v1';
const OBJECTIVE='helix://arca/work/jav_correction_assets/v1';
const P=Object.freeze({scope:'helix://arca/jav-correction-projections/Scope/v1',verifiedSource:'helix://arca/jav-correction-projections/VerifiedSource/v1',retirement:'helix://arca/jav-correction-projections/RetirementScope/v1',reclaim:'helix://arca/jav-correction-projections/WorkspaceReclaimScope/v1'});
function createJavCorrectionPlanner(options,files=false) {
  const reclaim=files==='workspace_reclaim',objective=reclaim?'helix://arca/work/jav_correction_workspace_reclaim/v1':files==='retirement'?'helix://arca/work/jav_correction_formal_retirement/v1':files==='commit'?'helix://arca/work/jav_correction_commit/v1':files==='verify'?'helix://arca/work/jav_correction_verify/v1':files==='publish'?'helix://arca/work/jav_correction_publish/v1':files?'helix://arca/work/jav_correction_files/v1':OBJECTIVE,
    planner=reclaim?'helix://arca/planners/jav-correction-workspace-reclaim/v1':files==='retirement'?'helix://arca/planners/jav-correction-retirement/v1':files==='commit'?'helix://arca/planners/jav-correction-commit/v1':files==='verify'?'helix://arca/planners/jav-correction-verify/v1':files==='publish'?'helix://arca/planners/jav-correction-publish/v1':files?'helix://arca/planners/jav-correction-files/v1':PLANNER;
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:planner,plannerVersion:1,plan(request){
    const c=reclaim?options.workspaceReclaimPreparation.readScope(request.processId):files==='retirement'?options.retirementPreparation.readScope(request.processId):options.correctionContextReader.read(request.processId),base={schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
      planId:'arca-correction-plan-'+canonicalDigest({workAttemptId:request.workAttemptId,objective}).slice(0,40),workAttemptId:request.workAttemptId,
      ownerDomain:'arca',plannerContractRef:planner,plannerVersion:1,workObjectiveTypeRef:objective,workObjectiveVersion:1,
      executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest};
    if(!c||request.processType!=='arca_jav_identity_correction'||request.executionBasisDigest!==c.scope.digest)
      return {...base,resolution:'contract_unplannable',diagnosticClassification:'ARCA_JAV_CORRECTION_SCOPE_STALE',nodes:[]};
    const owner=(portName,projectionRef)=>({portName,bindingKind:'projected_owner_facts',ownerDomain:'arca',processType:request.processType,
      processId:request.processId,projectionRef,parameters:{expectedScopeDigest:c.scope.digest}}),suffix=canonicalDigest(request.workAttemptId).slice(0,20),
      sourceEvent='jav-correction-source-'+suffix,assetsEvent='jav-correction-assets-'+suffix;
    function node(ref,eventId,bindings,dependsOn,resourceKinds) {
      const manifest=options.registry.resolve(ref,'arca').manifest,policy=options.policyRegistry.bindingFor(ref,manifest.effectClass),demand={resourceKinds};
      return {nodeId:eventId,eventId,capabilityRef:ref,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
        inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings},parametersSchemaRef:manifest.parametersSchemaRef,parameters:{},
        dependsOn,whenSchemaRef:null,when:null,effectClass:manifest.effectClass,resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
        resourceDemand:{...demand,demandDigest:canonicalDigest(demand)},approvalRequirementRef:null,authorizationRequirementRef:null,
        fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:{basisDigest:request.executionBasisDigest,inputSetDigest:canonicalDigest(bindings),
          eventFenceDigest:canonicalDigest({schema:'arca.jav-correction-event@1',eventId,workId:request.workId}),
          effectScopeDigest:canonicalDigest({schema:'arca.jav-correction-effect-scope@1',eventId,correctionId:request.processId})},
        retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef};
    }
    const sourceManifest=options.registry.resolve(SOURCE_CAPABILITY,'arca').manifest;
    if(files)return {...base,resolution:'planned',diagnosticClassification:null,nodes:[node(reclaim?RECLAIM_CAPABILITY:files==='retirement'?RETIREMENT_CAPABILITY:files==='commit'?COMMIT_CAPABILITY:files==='verify'?VERIFY_CAPABILITY:files==='publish'?PUBLISH_CAPABILITY:STAGE_CAPABILITY,'jav-correction-files-'+suffix,
      [owner(reclaim?'javCorrectionWorkspaceReclaimScope':files==='retirement'?'javCorrectionRetirementScope':'javCorrectionScope',reclaim?P.reclaim:files==='retirement'?P.retirement:P.scope)],[],['cpu','disk_io'])]};
    if(c.record.recoveryIntent?.sourceResultReference)return {...base,resolution:'planned',diagnosticClassification:null,nodes:[
      node(CAPABILITY,assetsEvent,[owner('javCorrectionScope',P.scope),owner('javCorrectionSourceVerified',RECOVERY_SOURCE_PROJECTION)],[],['cpu','disk_io','network'])]};
    return {...base,resolution:'planned',diagnosticClassification:null,nodes:[
      node(SOURCE_CAPABILITY,sourceEvent,[owner('javCorrectionScope',P.scope)],[],['cpu','network']),
      node(CAPABILITY,assetsEvent,[owner('javCorrectionScope',P.scope),
        {portName:'javCorrectionSourceVerified',bindingKind:'projected_event_result',eventId:sourceEvent,resultSchemaRef:sourceManifest.resultSchemaRef,
          projectionRef:P.verifiedSource,parameters:{expectedScopeDigest:c.scope.digest}}],[{eventId:sourceEvent,satisfaction:'success'}],['cpu','disk_io','network'])
    ]};
  }});
}
function createJavCorrectionAssetsPlanner(options){return createJavCorrectionPlanner(options);}
function createJavCorrectionFilesPlanner(options){return createJavCorrectionPlanner(options,true);}
function createJavCorrectionPublishPlanner(options){return createJavCorrectionPlanner(options,'publish');}
function createJavCorrectionVerifyPlanner(options){return createJavCorrectionPlanner(options,'verify');}
function createJavCorrectionRetirementPlanner(options){return createJavCorrectionPlanner(options,'retirement');}
function createJavCorrectionWorkspaceReclaimPlanner(options){return createJavCorrectionPlanner(options,'workspace_reclaim');}
function createJavCorrectionCommitPlanner(options){return createJavCorrectionPlanner(options,'commit');}
function createJavCorrectionProjections(options) {
  const reader=options.correctionContextReader;
  const scopeFor=({ownerScope,parameters})=>{if(ownerScope.ownerDomain!=='arca'||ownerScope.processType!=='arca_jav_identity_correction')throw new TypeError('Correction projection owner scope is invalid.');
    const value=reader.read(ownerScope.processId);if(!value||parameters?.expectedScopeDigest!==value.scope.digest)
      throw Object.assign(new Error('Correction projection scope changed.'),{code:'ARCA_JAV_CORRECTION_SCOPE_STALE'});return value;};
  return Object.freeze([
    {projectionRef:RECOVERY_SOURCE_PROJECTION,projection:{project:input=>{const c=scopeFor(input);if(!c.record.recoveryIntent?.sourceResultReference)throw new Error('Recovery Source Intent is absent.');
      return readJavCorrectionSourceResult({...options,...c}).result;}}},
    {projectionRef:P.reclaim,projection:{project:({ownerScope,parameters})=>{if(ownerScope.ownerDomain!=='arca'||ownerScope.processType!=='arca_jav_identity_correction')throw new TypeError('Workspace reclaim projection owner is invalid.');const c=options.workspaceReclaimPreparation.readScope(ownerScope.processId);if(c.scope.digest!==parameters.expectedScopeDigest)throw new Error('Workspace reclaim scope changed.');return c.scope;}}},
    {projectionRef:P.retirement,projection:{project:({ownerScope,parameters})=>{if(ownerScope.ownerDomain!=='arca'||ownerScope.processType!=='arca_jav_identity_correction')throw new TypeError('Retirement projection owner is invalid.');const c=options.retirementPreparation.readScope(ownerScope.processId);if(c.scope.digest!==parameters.expectedScopeDigest)throw new Error('Retirement scope changed.');return c.scope;}}},
    {projectionRef:P.scope,projection:{project:input=>scopeFor(input).scope}},
    {projectionRef:P.verifiedSource,projection:{project:input=>{scopeFor(input);return options.evidenceReader.resolveSource(input.sourceResult);}}}
  ]);
}
module.exports=Object.freeze({PLANNER,OBJECTIVE,P,createJavCorrectionAssetsPlanner,createJavCorrectionFilesPlanner,createJavCorrectionPublishPlanner,createJavCorrectionVerifyPlanner,createJavCorrectionCommitPlanner,createJavCorrectionRetirementPlanner,createJavCorrectionWorkspaceReclaimPlanner,createJavCorrectionProjections});
