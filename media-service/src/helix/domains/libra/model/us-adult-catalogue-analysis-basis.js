'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buffaloModelReference,assertBuffaloModelReference}=require('../../../contracts/buffalo-model-reference');
const {assertGeneration}=require('../../../contracts/face-catalogue-generation');
const {policy:createSelectionPolicy}=require('./us-adult-catalogue-assessment');
const {assertProbeEvidence}=require('./media-production-contracts');
const {samplingPoints}=require('./us-adult-catalogue-sampling');
const {assertCatalogueSearchPolicy,catalogueSearchPolicySchema}=require('../../../contracts/face-catalogue-search-policy');
const {assertRepresentativeImagePolicy,representativeImagePolicySchema}=require('../../../contracts/buffalo-representative-policy');
const SCHEMA='helix://contracts/domain-types/UsAdultCatalogueAnalysisBasis/v1';
const PROBE='shared.material.media.probe@1',PROBE_SCHEMA='helix://contracts/capabilities/shared.material.media.probe/v1/result';
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),id=()=>({type:'string',minLength:1,maxLength:256}),
  integer=(minimum,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum}),
  object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const budgetProperties={cpuSlots:{const:1},memoryBytes:integer(536870912,8589934592),maximumFrames:{const:40},maximumFacesPerFrame:{const:32},
  maximumFrameBytes:integer(1,10485760),maximumWorkspaceBytes:integer(1,2147483648),frameDeadlineMs:integer(1,30000),
  imageDeadlineMs:integer(1,60000),analysisDeadlineMs:integer(1,3600000)};
function fail(message){throw Object.assign(new TypeError(message),{code:'US_ADULT_CATALOGUE_BASIS_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function sourceProbeReferenceSchema(){return object({workId:id(),attemptId:id(),planId:id(),eventId:id(),resultId:id(),capabilityRef:{const:PROBE},
  resultSchemaRef:{const:PROBE_SCHEMA},resultDigest:digest(),inputBindingDigest:digest()});}
function schema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCHEMA,title:'UsAdultCatalogueAnalysisBasis@1',
  'x-helix-ssotRefs':['8.6.18'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':32768,
  ...object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},analysisId:digest(),contentProfile:{const:'western_adult'},libraRunId:id(),subjectId:id(),
    expectedRunStateRevision:integer(1),runExecutionBasisDigest:digest(),resolvedIdentityDigest:digest(),workspaceId:id(),
    sourceHandle:{$ref:'helix://contracts/types/PhysicalMaterialReadHandle/v1'},sourceProbeRef:sourceProbeReferenceSchema(),durationMs:integer(1),
    faceModelRef:{$ref:'helix://contracts/domain-types/FaceModelRef/v1'},catalogueGeneration:{$ref:'helix://contracts/domain-types/FaceCatalogueGeneration/v1'},catalogueSearchPolicy:catalogueSearchPolicySchema(),
    samplingPlan:{$ref:'helix://contracts/domain-types/SamplingPlan/v1'},clusterParameters:{$ref:'helix://contracts/domain-types/ClusterParameters/v1'},representativeImagePolicy:representativeImagePolicySchema(),
    selectionPolicy:object({schema:{const:'libra.us-adult-catalogue-assessment-policy@1'},maximumDistance:{type:'number',exclusiveMinimum:0,maximum:1},
      minimumDistanceMargin:{type:'number',exclusiveMinimum:0,maximum:1},minimumRepresentativeStrata:integer(2,3),minimumCoverageStrata:integer(3,20),policyDigest:digest()}),
    resourceBudget:object(budgetProperties),basisDigest:digest()})};}
function typedParameters(values){return Object.keys(values).sort().map(parameter=>{
  const value={parameter,valueType:Number.isSafeInteger(values[parameter])?'integer':typeof values[parameter],value:values[parameter]};
  return {...value,valueDigest:canonicalDigest(value)};
});}
function catalogueSamplingPlan(durationMs){
  if(!Number.isSafeInteger(durationMs)||durationMs<1)fail('Catalogue sampling requires a known positive source duration.');
  const points=samplingPoints(durationMs),initial=points.initial.map(x=>x.timestampMs),supplement=points.supplement.map(x=>x.timestampMs);
  const value={contractId:canonicalDigest({schema:'libra.buffalo-sampling-id@1',durationMs}),revision:1,
    schemaRef:'helix://contracts/domain-types/SamplingPlan/v1',intervalMs:Math.min(86400000,Math.max(1,Math.floor(durationMs/20))),maxFrames:initial.length+supplement.length,
    frameProfileDigest:canonicalDigest({schema:'libra.buffalo-frame-profile@1',format:'jpeg',width:1280,height:1280,fit:'inside',quality:2}),
    typedParameters:typedParameters({duration_ms:durationMs,strategy:'buffalo_strata_centers_and_quarters@1',initial_points_ms:JSON.stringify(initial),
      supplement_points_ms:JSON.stringify(supplement),strata_count:20})};
  return freeze({...value,digest:canonicalDigest(value)});
}
function catalogueClusterParameters(threshold,ambiguityMargin){
  if(!Number.isFinite(threshold)||threshold<=0||threshold>1||!Number.isFinite(ambiguityMargin)||ambiguityMargin<0||ambiguityMargin>1)
    fail('Catalogue grouping requires explicit bounded threshold and ambiguity margin.');
  const model=buffaloModelReference('western_frame_set'),value={parameterSetId:canonicalDigest({schema:'libra.buffalo-clustering-id@1',modelRefDigest:model.digest,threshold,ambiguityMargin}),
    revision:1,schemaRef:'helix://contracts/domain-types/ClusterParameters/v1',modelRefDigest:model.digest,distanceMetric:'cosine',distanceThreshold:threshold,minClusterSize:1,
    typedParameters:typedParameters({algorithm:'nearest_centroid_guarded',ambiguity_margin:ambiguityMargin,maximum_representatives:3,preserve_member_vectors:true})};
  return freeze({...value,digest:canonicalDigest(value)});
}
function assertBudget(value){
  if(!exact(value,Object.keys(budgetProperties)))fail('The complete resource budget must be frozen explicitly.');
  for(const [key,rule]of Object.entries(budgetProperties))if(rule.const!==undefined?value[key]!==rule.const:
    !Number.isSafeInteger(value[key])||value[key]<rule.minimum||value[key]>rule.maximum)fail('A video resource budget is outside its qualified bounds.');
  if(value.analysisDeadlineMs<value.frameDeadlineMs||value.analysisDeadlineMs<value.imageDeadlineMs)fail('The overall deadline is shorter than an individual operation.');
  return value;
}
function assertSelectionPolicy(value){
  if(!exact(value,['schema','maximumDistance','minimumDistanceMargin','minimumRepresentativeStrata','minimumCoverageStrata','policyDigest']))fail('The selection policy is not closed.');
  const {schema:marker,policyDigest,...parameters}=value;
  if(marker!=='libra.us-adult-catalogue-assessment-policy@1'||createSelectionPolicy(parameters).policyDigest!==policyDigest)fail('The selection policy digest changed.');
}
function assertCatalogueAnalysisBasis(value,{validator}={}){
  if(validator)validator.validate(SCHEMA,value);
  if(!exact(value,Object.keys(schema().properties))||value.schemaRef!==SCHEMA||value.schemaVersion!==1||value.contentProfile!=='western_adult'||
    !['libraRunId','subjectId','workspaceId'].every(key=>typeof value[key]==='string'&&value[key]&&value[key].length<=256)||
    !Number.isSafeInteger(value.expectedRunStateRevision)||value.expectedRunStateRevision<1||
    !['runExecutionBasisDigest','resolvedIdentityDigest'].every(key=>/^[a-f0-9]{64}$/.test(value[key]||'')))fail('The video Basis identity or closed shape is invalid.');
  assertBudget(value.resourceBudget);assertSelectionPolicy(value.selectionPolicy);assertGeneration(value.catalogueGeneration);assertCatalogueSearchPolicy(value.catalogueSearchPolicy);
  assertRepresentativeImagePolicy(value.representativeImagePolicy);
  if(value.selectionPolicy.maximumDistance>value.catalogueSearchPolicy.maximumDistance)fail('Identity eligibility exceeds the frozen retrieval range.');
  assertBuffaloModelReference(value.faceModelRef,'western_frame_set');
  if(value.sourceHandle?.schemaRef!=='helix://contracts/types/PhysicalMaterialReadHandle/v1'||value.sourceHandle.ownerDomain!=='libra'||
    value.sourceHandle.ownerScope?.scopeType!=='libra_run'||value.sourceHandle.ownerScope.scopeId!==value.libraRunId)fail('The video Basis does not own its exact source read scope.');
  const reference=value.sourceProbeRef;
  if(!exact(reference,Object.keys(sourceProbeReferenceSchema().properties))||reference.capabilityRef!==PROBE||reference.resultSchemaRef!==PROBE_SCHEMA||
    !['workId','attemptId','planId','eventId','resultId'].every(key=>typeof reference[key]==='string'&&reference[key]&&reference[key].length<=256)||
    !['resultDigest','inputBindingDigest'].every(key=>/^[a-f0-9]{64}$/.test(reference[key]||'')))fail('The exact successful source Probe reference is missing.');
  const grouping=value.clusterParameters,margin=grouping?.typedParameters?.find(item=>item.parameter==='ambiguity_margin')?.value;
  if(canonicalJson(value.samplingPlan)!==canonicalJson(catalogueSamplingPlan(value.durationMs))||
    canonicalJson(grouping)!==canonicalJson(catalogueClusterParameters(grouping?.distanceThreshold,margin)))fail('Frozen sampling or grouping parameters changed.');
  const {analysisId,basisDigest,...body}=value;
  if(Buffer.byteLength(canonicalJson(value))>32768||basisDigest!==canonicalDigest(body)||
    analysisId!==canonicalDigest({schema:'libra.us-adult-catalogue-analysis-id@1',libraRunId:value.libraRunId,basisDigest}))fail('The video Basis digest or identity changed.');
  return value;
}
function buildCatalogueAnalysisBasis({snapshot,sourceHandle,sourceProbeRecord,workspaceId,catalogueGeneration,catalogueSearchPolicy,representativeImagePolicy,clusterThreshold,clusterAmbiguityMargin,selectionPolicy,resourceBudget,contractValidator}){
  const record=sourceProbeRecord,probe=record?.result;
  if(typeof contractValidator?.validate!=='function'||!snapshot?.run||snapshot?.spec?.contentProfile!=='western_adult'||snapshot.materialInputForm!=='stream_file'||
    snapshot.members?.filter(item=>item.role==='primary_payload').length!==1||record?.outcomeKind!=='succeeded'||record.capabilityRef!==PROBE||record.resultSchemaRef!==PROBE_SCHEMA||
    !record.inputBindings||record.inputBindingDigest!==canonicalDigest(record.inputBindings)||record.resultDigest!==canonicalDigest(probe)||
    probe?.resultKind!=='probed'||probe.sourceHandleDigest!==canonicalDigest(sourceHandle)||!Number.isSafeInteger(probe.durationMs)||probe.durationMs<1)
    fail('Video recognition requires the complete successful same-source formal Probe.');
  contractValidator.validate(PROBE_SCHEMA,probe);assertProbeEvidence(probe);
  if(probe.sizeBytes!==sourceHandle.expectedSizeBytes||probe.videoStreams.length===0)fail('The successful Probe describes another size or no video stream.');
  const primary=snapshot.members.find(item=>item.role==='primary_payload');
  if(!primary.physicalIdentity||canonicalDigest(primary.physicalIdentity)!==canonicalDigest(sourceHandle.identity)||primary.materialKey!==sourceHandle.identity.materialKey)
    fail('The source Handle does not identify the unique frozen Primary material.');
  const value={schemaRef:SCHEMA,schemaVersion:1,contentProfile:'western_adult',libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,
    expectedRunStateRevision:snapshot.run.stateRevision,runExecutionBasisDigest:snapshot.run.executionBasisDigest,resolvedIdentityDigest:snapshot.resolvedIdentityDigest,workspaceId,
    sourceHandle,sourceProbeRef:Object.fromEntries(Object.keys(sourceProbeReferenceSchema().properties).map(key=>[key,record[key]])),durationMs:probe.durationMs,
    faceModelRef:buffaloModelReference('western_frame_set'),catalogueGeneration,catalogueSearchPolicy,samplingPlan:catalogueSamplingPlan(probe.durationMs),
    clusterParameters:catalogueClusterParameters(clusterThreshold,clusterAmbiguityMargin),representativeImagePolicy,selectionPolicy,resourceBudget},basisDigest=canonicalDigest(value);
  // Own immutable JSON; freezing the caller's objects would change another component's state.
  const result=JSON.parse(canonicalJson({...value,basisDigest,analysisId:canonicalDigest({schema:'libra.us-adult-catalogue-analysis-id@1',libraRunId:value.libraRunId,basisDigest})}));
  return freeze(assertCatalogueAnalysisBasis(result,{validator:contractValidator}));
}
module.exports=Object.freeze({SCHEMA,schema,catalogueSamplingPlan,catalogueClusterParameters,assertBudget,buildCatalogueAnalysisBasis,assertCatalogueAnalysisBasis});
