'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {assertArcaCustomAcceptanceBasis}=require('../model/custom-acceptance-target');
const {assertCollectionCareTarget}=require('../model/collection-care-target');

const SCHEMA='arca.collection-target-intent@1';
const SHA=/^[a-f0-9]{64}$/;
function fail(code='ARCA_COLLECTION_TARGET_INVALID'){throw Object.assign(new Error('Collection target evidence is incomplete or inconsistent.'),{code});}
function without(value,key){return Object.fromEntries(Object.entries(value||{}).filter(([name])=>name!==key));}
function same(a,b){return canonicalJson(a)===canonicalJson(b);}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),[...keys].sort());}
function stable(schema,value){return canonicalDigest({schema,...value});}
function readDecision(repo,foundation,runId){
  const run=repo.invoke('run',{on_deck_run_id:runId}),custody=run&&repo.invoke('custody',{custody_id:run.custody_id}),
    row=custody&&repo.invoke('decision',{acceptance_decision_id:custody.acceptance_decision_id});
  if(!run||!custody||!row||row.result!=='accepted'||row.on_deck_package_id!==custody.on_deck_package_id||
      row.package_digest!==custody.package_digest||!SHA.test(row.decision_digest||''))fail('ARCA_COLLECTION_TARGET_ACCEPTANCE_MISSING');
  const resultId=stable('arca.handoff-b-accepted-result@1',{acceptanceDecisionId:row.acceptance_decision_id}),
    markerId=stable('arca.handoff-b-accepted-marker@1',{acceptanceDecisionId:row.acceptance_decision_id,decisionDigest:row.decision_digest}),
    result=foundation.invoke('result',{result_id:resultId}),marker=foundation.invoke('marker',{commit_marker:markerId});
  let decision;try{decision=result&&JSON.parse(result.evidence_json);}catch{fail('ARCA_COLLECTION_TARGET_ACCEPTANCE_CORRUPT');}
  if(!result||!marker||!decision||result.event_id!==null||result.outcome_kind!=='succeeded'||
      result.evidence_schema_ref!=='helix://contracts/domain-types/ArcaAcceptanceDecision/v1'||
      result.evidence_json!==canonicalJson(decision)||result.evidence_digest!==row.decision_digest||
      decision.decisionDigest!==row.decision_digest||decision.decisionDigest!==canonicalDigest(without(decision,'decisionDigest'))||
      decision.acceptanceDecisionId!==row.acceptance_decision_id||decision.result!=='accepted'||
      decision.onDeckPackageId!==custody.on_deck_package_id||decision.packageDigest!==custody.package_digest||
      decision.shelfId!==row.shelf_id||marker.owner_domain!=='arca'||marker.scope_type!=='acceptance_decision'||
      marker.scope_id!==row.acceptance_decision_id||marker.commit_digest!==row.decision_digest||marker.result_id!==resultId||
      marker.result_schema_ref!==result.result_schema_ref||marker.result_digest!==result.result_digest)
    fail('ARCA_COLLECTION_TARGET_ACCEPTANCE_CORRUPT');
  return Object.freeze({run,custody,row,decision});
}
function buildInitialIntent({shelfEntryId,shelfId,onDeckRunId,packageValue,decision}){
  const basis=assertArcaCustomAcceptanceBasis({packageValue,shelf:{shelfId},basis:decision.customAcceptanceBasis});
  const intentId=stable('arca.initial-collection-target-intent@1',{shelfEntryId,acceptanceDecisionId:decision.acceptanceDecisionId,
    decisionDigest:decision.decisionDigest,basisDigest:basis.basisDigest}),body={schemaRef:SCHEMA,intentId,shelfEntryId,shelfId,
    targetRevision:1,targetKind:'user_custom',onDeckRunId,onDeckPackageId:packageValue.onDeckPackageId,
    packageDigest:packageValue.packageDigest,acceptanceDecisionId:decision.acceptanceDecisionId,
    acceptanceDecisionDigest:decision.decisionDigest,customAcceptanceBasis:basis,requirements:basis.customRequirements,
    requirementsDigest:canonicalDigest(basis.customRequirements)};
  const result=Object.freeze({...body,intentDigest:canonicalDigest(body)});
  if(Buffer.byteLength(canonicalJson(result),'utf8')>64*1024)fail('ARCA_COLLECTION_TARGET_TOO_LARGE');
  return result;
}
function assertInitialIntent(intent,row,head,entry,accepted){
  const keys=['schemaRef','intentId','shelfEntryId','shelfId','targetRevision','targetKind','onDeckRunId','onDeckPackageId','packageDigest',
    'acceptanceDecisionId','acceptanceDecisionDigest','customAcceptanceBasis','requirements','requirementsDigest','intentDigest'];
  if(!exact(intent,keys)||intent.schemaRef!==SCHEMA||intent.targetKind!=='user_custom'||intent.targetRevision!==1||
      intent.intentDigest!==canonicalDigest(without(intent,'intentDigest'))||intent.requirementsDigest!==canonicalDigest(intent.requirements)||
      intent.intentId!==stable('arca.initial-collection-target-intent@1',{shelfEntryId:intent.shelfEntryId,
        acceptanceDecisionId:intent.acceptanceDecisionId,decisionDigest:intent.acceptanceDecisionDigest,
        basisDigest:intent.customAcceptanceBasis?.basisDigest})||intent.shelfEntryId!==entry.shelf_entry_id||intent.shelfId!==entry.shelf_id||
      row.intent_schema_ref!==SCHEMA||row.intent_id!==intent.intentId||row.shelf_entry_id!==intent.shelfEntryId||
      Number(row.target_revision)!==intent.targetRevision||row.target_kind!==intent.targetKind||row.intent_digest!==intent.intentDigest||
      row.intent_json!==canonicalJson(intent)||head.intent_id!==intent.intentId||head.intent_digest!==intent.intentDigest||
      Number(head.current_revision)!==intent.targetRevision||accepted.run.on_deck_run_id!==intent.onDeckRunId||
      accepted.row.acceptance_decision_id!==intent.acceptanceDecisionId||accepted.row.decision_digest!==intent.acceptanceDecisionDigest||
      accepted.row.shelf_id!==intent.shelfId||accepted.custody.on_deck_package_id!==intent.onDeckPackageId||
      accepted.custody.package_digest!==intent.packageDigest||!same(accepted.decision.customAcceptanceBasis,intent.customAcceptanceBasis)||
      !same(intent.requirements,intent.customAcceptanceBasis?.customRequirements)||
      intent.customAcceptanceBasis.basisDigest!==canonicalDigest(without(intent.customAcceptanceBasis,'basisDigest')))
    fail('ARCA_COLLECTION_TARGET_CORRUPT');
  return intent;
}

function createCollectionTargetStore(options){
  if(!options?.schemaManifest||!options.unitOfWork)throw new TypeError('Collection target store requires Arca persistence.');
  const arca=createRepositoryDefinition({repositoryId:'arca_collection_targets',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    entry:{kind:'select-one',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','status','structure_kind','current_inventory_revision'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    head:{kind:'select-one',tableId:'arca_collection_target_heads',columns:['shelf_entry_id','current_revision','intent_id','intent_digest','updated_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    intent:{kind:'select-one',tableId:'arca_collection_target_intents',columns:['intent_id','shelf_entry_id','target_revision','target_kind','intent_schema_ref','intent_json','intent_digest','created_at_ms'],keyColumns:['intent_id'],safeIntegers:true},
    commits:{kind:'select-all',tableId:'arca_ondeck_commit_receipts',columns:['shelf_entry_id','on_deck_run_id','inventory_revision'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    run:{kind:'select-one',tableId:'arca_ondeck_runs',columns:['on_deck_run_id','custody_id'],keyColumns:['on_deck_run_id']},
    custody:{kind:'select-one',tableId:'arca_ondeck_custodies',columns:['custody_id','acceptance_decision_id','on_deck_package_id','package_digest'],keyColumns:['custody_id']},
    decision:{kind:'select-one',tableId:'arca_acceptance_decisions',columns:['acceptance_decision_id','result','shelf_id','on_deck_package_id','package_digest','decision_digest'],keyColumns:['acceptance_decision_id']},
    insert_intent:{kind:'insert',tableId:'arca_collection_target_intents',columns:['intent_id','shelf_entry_id','target_revision','target_kind','intent_schema_ref','intent_json','intent_digest','created_at_ms']},
    insert_head:{kind:'insert',tableId:'arca_collection_target_heads',columns:['shelf_entry_id','current_revision','intent_id','intent_digest','updated_at_ms']},
  }}),foundation=createRepositoryDefinition({repositoryId:'arca_collection_target_acceptance_evidence',owner:'execution-foundation',
    schemaManifest:options.schemaManifest,readOnly:true,statements:{
      result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_digest','evidence_schema_ref','evidence_json','evidence_digest'],keyColumns:['result_id']},
      marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest'],keyColumns:['commit_marker']},
    }});
  function onDeckParticipants({request,shelfEntryId,inventoryRevision}){
    if(!request.package?.productionProvenance?.acceptanceRequirementSnapshot?.customAcceptanceHandoff)return [];
    const expected=request.acceptedDecision;
    if(!expected||expected.decisionDigest!==canonicalDigest(without(expected,'decisionDigest')))
      fail('ARCA_COLLECTION_TARGET_ACCEPTANCE_MISSING');
    const intent=buildInitialIntent({shelfEntryId,shelfId:request.shelf.shelfId,onDeckRunId:request.onDeckRunId,
      packageValue:request.package,decision:expected});let ownerRows,accepted;
    return [
      {participantId:'arca_collection_target_accepted_owner',owner:'arca',repositories:[arca],execute(context){
        const repo=context.repository(arca.repositoryId),entry=repo.invoke('entry',{shelf_entry_id:shelfEntryId}),
          run=repo.invoke('run',{on_deck_run_id:request.onDeckRunId}),custody=run&&repo.invoke('custody',{custody_id:run.custody_id}),
          row=custody&&repo.invoke('decision',{acceptance_decision_id:custody.acceptance_decision_id});
        if(!entry||entry.shelf_id!==request.shelf.shelfId||Number(entry.current_inventory_revision)!==inventoryRevision||
            !run||run.custody_id!==request.custodyId||!custody||!row||repo.invoke('head',{shelf_entry_id:shelfEntryId}))
          fail('ARCA_COLLECTION_TARGET_COMMIT_FENCE');
        ownerRows={entry,run,custody,row};
      }},
      {participantId:'arca_collection_target_accepted_evidence',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(context){
        const fakeRepo={invoke(name){return name==='decision'?ownerRows.row:ownerRows[name];}},acceptedRead=readDecision(fakeRepo,context.repository(foundation.repositoryId),request.onDeckRunId);
        if(!same(acceptedRead.decision,expected))fail('ARCA_COLLECTION_TARGET_ACCEPTANCE_CORRUPT');accepted=acceptedRead;
      }},
      {participantId:'arca_collection_target_commit',owner:'arca',repositories:[arca],execute(context){
        if(!accepted||accepted.custody.custody_id!==request.custodyId)fail('ARCA_COLLECTION_TARGET_COMMIT_FENCE');
        const repo=context.repository(arca.repositoryId);
        repo.invoke('insert_intent',{intent_id:intent.intentId,shelf_entry_id:shelfEntryId,target_revision:1,target_kind:'user_custom',
          intent_schema_ref:SCHEMA,intent_json:canonicalJson(intent),intent_digest:intent.intentDigest,created_at_ms:context.commitTimeMs});
        repo.invoke('insert_head',{shelf_entry_id:shelfEntryId,current_revision:1,intent_id:intent.intentId,
          intent_digest:intent.intentDigest,updated_at_ms:context.commitTimeMs});
      }},
    ];
  }
  function readMany(ids,{readFence}={}){
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id)||!readFence)
      fail('ARCA_COLLECTION_TARGET_READER_UNAVAILABLE');
    const answer=new Map();
    for(let offset=0;offset<ids.length;offset+=500){const batch=ids.slice(offset,offset+500),rows=new Map();
      options.unitOfWork.execute([
        {participantId:'arca_collection_target_read_owner',owner:'arca',repositories:[arca],execute(context){
          const repo=context.repository(arca.repositoryId);
          for(const id of batch){const entry=repo.invoke('entry',{shelf_entry_id:id}),head=repo.invoke('head',{shelf_entry_id:id}),
            intentRow=head&&repo.invoke('intent',{intent_id:head.intent_id}),commits=repo.invoke('commits',{shelf_entry_id:id})
              .sort((a,b)=>Number(a.inventory_revision)-Number(b.inventory_revision));
            let intent;try{intent=intentRow&&JSON.parse(intentRow.intent_json);}catch{fail('ARCA_COLLECTION_TARGET_CORRUPT');}
            const runId=intent?.onDeckRunId||commits[0]?.on_deck_run_id,run=runId&&repo.invoke('run',{on_deck_run_id:runId}),
              custody=run&&repo.invoke('custody',{custody_id:run.custody_id}),row=custody&&repo.invoke('decision',{acceptance_decision_id:custody.acceptance_decision_id});
            if(!entry||entry.status!=='active'||!commits.length||!run||!custody||!row||head&&!intentRow||
                !commits.some(commit=>commit.on_deck_run_id===runId))
              fail('ARCA_COLLECTION_TARGET_ACCEPTANCE_MISSING');
            rows.set(id,{entry,head,intentRow,intent,run,custody,row});
          }
        }},
        {participantId:'arca_collection_target_read_evidence',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute(context){
          const repo=context.repository(foundation.repositoryId);
          for(const [id,value] of rows){const source={invoke(name){return name==='decision'?value.row:value[name];}},accepted=readDecision(source,repo,value.run.on_deck_run_id);
            if(!value.head){if(accepted.decision.customAcceptanceBasis)fail('ARCA_COLLECTION_TARGET_HEAD_MISSING');answer.set(id,null);continue;}
            const intent=assertInitialIntent(value.intent,value.intentRow,value.head,value.entry,accepted),body={schemaRef:'arca.collection-care-target@1',
              shelfEntryId:id,shelfId:value.entry.shelf_id,inventoryRevision:Number(value.entry.current_inventory_revision),
              contentProfile:'movie',structureKind:'single',targetKind:intent.targetKind,targetRevision:intent.targetRevision,
              intentId:intent.intentId,intentDigest:intent.intentDigest,requirements:intent.requirements,requirementsDigest:intent.requirementsDigest},
              projection=Object.freeze({...body,projectionDigest:canonicalDigest(body)});
            answer.set(id,assertCollectionCareTarget(projection,id,{shelfId:value.entry.shelf_id,inventoryRevision:value.entry.current_inventory_revision}));
          }
        }},
      ],{readFence});
    }
    return answer;
  }
  return Object.freeze({onDeckParticipants,readMany});
}
module.exports=Object.freeze({createCollectionTargetStore});
