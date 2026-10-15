'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {SOURCE_CAPABILITY,CAPABILITY,SCOPE_SCHEMA,javCorrectionAssetsWorkId}=require('./jav-correction-execution-contract');
const {assertJavCorrectionRecoveryReceipt}=require('./jav-correction-recovery');
const fail=()=>{throw Object.assign(new Error('Correction cancellation requires a terminal source failure with no write attempts or registered outputs.'),
  {code:'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN'});};
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function parse(value,digest){try{const parsed=JSON.parse(value);if(canonicalJson(parsed)!==value||canonicalDigest(parsed)!==digest)fail();return parsed;}catch{fail();}}
function bindings(value){try{return JSON.parse(value);}catch{fail();}}

// This observation is not a cancellation command or a terminal Receipt. The
// eventual Owner commit must obtain it again inside its atomic unit of work.
function observeSourceFailure({record,currentBasisDigest,snapshot,authorization}){
  if(record?.state!=='attention_required'||!text(record.correctionId)||!text(record.shelfEntryId)||!Number.isSafeInteger(record.stateRevision)||record.stateRevision<3||
      record.terminalAtMs!==null||record.terminalEvidenceDigest!==null||!hex(record.admissionDigest)||
      currentBasisDigest!==record.proof?.basis?.basisDigest||!snapshot)fail();
  for(const name of ['works','attempts','plans','nodes','edges','events','eventAttempts','effects','results','registries','materials','artifacts'])
    if(!Array.isArray(snapshot[name])||snapshot[name].length>64)fail();
  if(snapshot.works.length!==1||snapshot.attempts.length!==1||snapshot.plans.length!==1||snapshot.nodes.length!==2||
      snapshot.edges.length!==1||snapshot.events.length!==2||snapshot.effects.length||snapshot.results.length||
      snapshot.registries.length||snapshot.materials.length||snapshot.artifacts.length)fail();
  const work=snapshot.works[0],attempt=snapshot.attempts[0],plan=snapshot.plans[0];
  if(!text(work.work_id)||!text(attempt.attempt_id)||!text(plan.plan_id)||work.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==record.correctionId||
      work.work_kind!=='jav_correction_assets'||work.state!=='failed'||
      work.definition_schema_ref!=='helix://foundation/types/SupportingWorkDefinition/v1')fail();
  const definition=parse(work.definition_json,work.definition_digest),dependency=definition.dependencyRefs;
  if(definition.workId!==work.work_id||definition.ownerDomain!=='arca'||definition.processType!==work.process_type||
      definition.processId!==record.correctionId||definition.workKind!==work.work_kind||definition.executionBasisDigest!==work.basis_digest||
      !Array.isArray(dependency)||dependency.length!==(authorization.recoveryReceipt?2:1)||dependency[0].ownerDomain!=='arca'||
      dependency[0].objectType!=='jav_identity_correction'||dependency[0].objectId!==record.correctionId||
      dependency[0].digest!==record.admissionDigest||dependency[0].revision!==authorization.businessRevision||
      attempt.work_id!==work.work_id||attempt.state!=='failed'||Number(attempt.ordinal)!==1||attempt.basis_digest!==work.basis_digest||
      !text(attempt.failure_code)||plan.attempt_id!==attempt.attempt_id||plan.state!=='planned'||
      plan.basis_digest!==work.basis_digest||plan.planner_ref!=='helix://arca/planners/jav-correction-assets/v1'||
      Number(plan.planner_version)!==1||!hex(plan.graph_digest))fail();
  const expectedDependency=[{ownerDomain:'arca',objectType:'jav_identity_correction',objectId:record.correctionId,revision:authorization.businessRevision,digest:record.admissionDigest}];
  if(authorization.recoveryReceipt)expectedDependency.push({ownerDomain:'arca',objectType:'jav_correction_recovery_intent',objectId:authorization.recoveryReceipt.recoveryId,
    revision:authorization.businessRevision,digest:authorization.recoveryReceipt.receiptDigest});
  if(!same(dependency,expectedDependency))fail();
  const source=snapshot.events.find(item=>item.capability_ref===SOURCE_CAPABILITY),assets=snapshot.events.find(item=>item.capability_ref===CAPABILITY);
  if(!source||!assets||!text(source.event_id)||!text(assets.event_id)||source.event_id===assets.event_id||source.state!=='failed'||assets.state!=='cancelled'||
      snapshot.events.some(item=>item.work_id!==work.work_id||item.attempt_id!==attempt.attempt_id||item.plan_id!==plan.plan_id||
        item.owner_domain!=='arca'||item.result_id!==null))fail();
  const sourceNode=snapshot.nodes.find(item=>item.node_id===source.node_id),assetsNode=snapshot.nodes.find(item=>item.node_id===assets.node_id),edge=snapshot.edges[0];
  if(!sourceNode||!assetsNode||sourceNode.capability_ref!==SOURCE_CAPABILITY||sourceNode.effect_class!=='pure_observation'||
      assetsNode.capability_ref!==CAPABILITY||assetsNode.effect_class!=='workspace_write'||
      snapshot.nodes.some(item=>item.plan_id!==plan.plan_id)||edge.plan_id!==plan.plan_id||edge.from_node_id!==source.node_id||
      edge.to_node_id!==assets.node_id||edge.dependency_kind!=='success')fail();
  const observationInputs=bindings(sourceNode.input_bindings_json),assetsInputs=bindings(assetsNode.input_bindings_json),binding=observationInputs?.bindings?.[0];
  if(observationInputs?.bindings?.length!==1||binding?.bindingKind!=='projected_owner_facts'||binding.ownerDomain!=='arca'||
      binding.processType!==work.process_type||binding.processId!==record.correctionId||binding.portName!=='javCorrectionScope'||
      binding.projectionRef!=='helix://arca/jav-correction-projections/Scope/v1'||binding.parameters?.expectedScopeDigest!==work.basis_digest||
      assetsInputs?.bindings?.length!==2||!same(assetsInputs.bindings[0],binding)||
      assetsInputs.bindings[1].bindingKind!=='projected_event_result'||assetsInputs.bindings[1].eventId!==source.event_id)fail();
  // Use the persisted active revision; never synthesize an active current Record.
  const scope={schemaRef:SCOPE_SCHEMA,schemaVersion:1,objectId:record.correctionId,revision:authorization.executionRevision,
    objectKind:'jav-correction-scope',correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,
    basisDigest:record.proof.basis.basisDigest,proposalDigest:record.proof.proposal.proposalDigest,
    expectedStateRevision:authorization.executionRevision,workspaceRootHandleRef:snapshot.workspaceRootHandleRef};
  const scopeDigest=canonicalDigest(scope);
  if(!hex(snapshot.workspaceRootHandleRef)||scopeDigest!==work.basis_digest||work.work_id!==authorization.workId)fail();
  if(!snapshot.eventAttempts.length||snapshot.eventAttempts.some(item=>item.event_id!==source.event_id||item.state!=='completed'||
      item.outcome_kind!=='failed'||!text(item.event_attempt_id)||!text(item.failure_code)||!Number.isSafeInteger(Number(item.ordinal))||Number(item.ordinal)<1))fail();
  const ordinals=snapshot.eventAttempts.map(item=>Number(item.ordinal)).sort((a,b)=>a-b);
  if(ordinals.some((ordinal,index)=>ordinal!==index+1)||new Set(snapshot.eventAttempts.map(item=>item.event_attempt_id)).size!==ordinals.length)fail();
  const failures=snapshot.eventAttempts.map(item=>({eventAttemptId:item.event_attempt_id,ordinal:Number(item.ordinal),failureCode:item.failure_code}))
    .sort((a,b)=>a.ordinal-b.ordinal);
  const body={schema:'arca.jav-correction-no-effect-observation@1',correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,
    admissionDigest:record.admissionDigest,expectedStateRevision:record.stateRevision,basisDigest:currentBasisDigest,scopeDigest,
    workId:work.work_id,workDefinitionDigest:work.definition_digest,planId:plan.plan_id,planDigest:plan.graph_digest,
    sourceEventId:source.event_id,unexecutedAssetsEventId:assets.event_id,failures};
  return Object.freeze({...body,observationDigest:canonicalDigest(body)});
}
function buildJavCorrectionNoEffectObservation({record,currentBasisDigest,snapshot,recoveryHistory=[]}){
  if(!record||!text(record.correctionId)||!text(record.shelfEntryId)||!hex(record.admissionDigest)||!snapshot||!Array.isArray(recoveryHistory)||recoveryHistory.length>63)fail();
  for(const [name,maximum] of Object.entries({works:64,attempts:64,plans:64,nodes:128,edges:64,events:128,eventAttempts:256,effects:256,results:128,registries:1,materials:4,artifacts:3}))
    if(!Array.isArray(snapshot[name])||snapshot[name].length>maximum)fail();
  if(['effects','results','registries','materials','artifacts'].some(name=>snapshot[name].length)||
      Boolean(record.recoveryIntent)!==Boolean(recoveryHistory.length))fail();
  const executionRevision=2,scope={schemaRef:SCOPE_SCHEMA,schemaVersion:1,objectId:record.correctionId,revision:executionRevision,objectKind:'jav-correction-scope',
    correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,basisDigest:record.proof?.basis?.basisDigest,
    proposalDigest:record.proof?.proposal?.proposalDigest,expectedStateRevision:executionRevision,workspaceRootHandleRef:snapshot.workspaceRootHandleRef};
  if(!hex(scope.basisDigest)||!hex(scope.proposalDigest)||!hex(scope.workspaceRootHandleRef))fail();
  const scopeDigest=canonicalDigest(scope),baseWorkId=javCorrectionAssetsWorkId({...scope,digest:scopeDigest}),
    authorizations=[{workId:baseWorkId,businessRevision:2,executionRevision,recoveryReceipt:null}];let previousDigest=null;
  for(const receipt of [...recoveryHistory].sort((a,b)=>a.acceptedStateRevision-b.acceptedStateRevision)){
    try{assertJavCorrectionRecoveryReceipt(receipt,record);}catch{fail();}
    const previous=authorizations.at(-1),lineage=receipt.workLineage[0];
    if(receipt.mode!=='continue_correction'||receipt.sourceResultReference!==null||receipt.filePlanDigest!==null||receipt.executionRevision!==executionRevision||
        receipt.scopeDigest!==scopeDigest||receipt.previousIntentDigest!==previousDigest||receipt.expectedStateRevision!==previous.businessRevision+1||
        receipt.failedWorkId!==previous.workId||receipt.workLineage.length!==1||lineage.workKind!=='jav_correction_assets'||lineage.baseWorkId!==baseWorkId||lineage.previousWorkId!==previous.workId||
        authorizations.some(item=>item.workId===lineage.workId))fail();
    authorizations.push({workId:lineage.workId,businessRevision:receipt.acceptedStateRevision,executionRevision,recoveryReceipt:receipt});previousDigest=receipt.receiptDigest;
  }
  if(previousDigest!==(record.recoveryIntent?.receiptDigest||null)||record.stateRevision!==authorizations.at(-1).businessRevision+1||snapshot.works.length!==authorizations.length||
      new Set(snapshot.works.map(work=>work.work_id)).size!==authorizations.length||
      snapshot.works.some(work=>!authorizations.some(item=>item.workId===work.work_id))||snapshot.attempts.length!==authorizations.length||
      snapshot.plans.length!==authorizations.length||snapshot.events.length!==authorizations.length*2||snapshot.nodes.length!==authorizations.length*2||snapshot.edges.length!==authorizations.length)fail();
  const observations=authorizations.map(authorization=>{
    const works=snapshot.works.filter(work=>work.work_id===authorization.workId),attempts=snapshot.attempts.filter(attempt=>attempt.work_id===authorization.workId),
      plans=snapshot.plans.filter(plan=>attempts.some(attempt=>attempt.attempt_id===plan.attempt_id)),planIds=new Set(plans.map(plan=>plan.plan_id)),
      events=snapshot.events.filter(event=>event.work_id===authorization.workId),eventIds=new Set(events.map(event=>event.event_id));
    return observeSourceFailure({record,currentBasisDigest,authorization,snapshot:{...snapshot,works,attempts,plans,events,
      nodes:snapshot.nodes.filter(node=>planIds.has(node.plan_id)),edges:snapshot.edges.filter(edge=>planIds.has(edge.plan_id)),eventAttempts:snapshot.eventAttempts.filter(attempt=>eventIds.has(attempt.event_id))}});
  });
  if(observations.reduce((count,observation)=>count+observation.failures.length,0)!==snapshot.eventAttempts.length)fail();
  if(observations.length===1)return observations[0];
  const {observationDigest,...latest}=observations.at(-1),body={...latest,
    failures:observations.flatMap(observation=>observation.failures.map(failure=>({...failure,workId:observation.workId,sourceEventId:observation.sourceEventId}))),
    sourceFailureHistory:observations.map((observation,index)=>({workId:observation.workId,admissionRevision:authorizations[index].businessRevision,
      recoveryIntentDigest:authorizations[index].recoveryReceipt?.receiptDigest||null,noEffectObservationDigest:observation.observationDigest})),executionHistoryDigest:canonicalDigest(snapshot)};
  return Object.freeze({...body,observationDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({buildJavCorrectionNoEffectObservation});
