'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const model=require('../model/us-adult-recommendation-claim');
const COLUMNS=['claim_id','actor_id','idempotency_key','request_digest','source_id','active_source_id','state','revision',
  'payload_schema_ref','payload_json','payload_digest','person_schema_ref','person_json','person_digest','receipt_schema_ref','receipt_json','receipt_digest',
  'last_failure_code','created_at_ms','updated_at_ms'];
function fail(code,message,details){throw Object.assign(new Error(message),{code,details});}
function corrupt(){fail('PEOPLE_RECOMMENDATION_CLAIM_CORRUPT','Recommendation claim record is invalid.');}
function encode(prefix,value,maximum){
  if(value===null)return {[prefix+'_schema_ref']:null,[prefix+'_json']:null,[prefix+'_digest']:null};
  const text=canonicalJson(value);if(Buffer.byteLength(text,'utf8')>maximum)corrupt();
  return {[prefix+'_schema_ref']:value.schema,[prefix+'_json']:text,[prefix+'_digest']:canonicalDigest(value)};
}
function parse(row,prefix,maximum){
  if(row[prefix+'_json']===null){if(row[prefix+'_schema_ref']!==null||row[prefix+'_digest']!==null)corrupt();return null;}
  let value;try{value=JSON.parse(row[prefix+'_json']);}catch{corrupt();}
  if(canonicalJson(value)!==row[prefix+'_json']||canonicalDigest(value)!==row[prefix+'_digest']||value.schema!==row[prefix+'_schema_ref']||
    Buffer.byteLength(row[prefix+'_json'],'utf8')>maximum)corrupt();
  return value;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function createUsAdultRecommendationClaimStore(options){
  const repository=createRepositoryDefinition({repositoryId:'people_us_recommendation_claims',owner:'people',schemaManifest:options.schemaManifest,statements:{
    get:{kind:'select-one',tableId:'people_us_recommendation_claims',keyColumns:['claim_id'],columns:COLUMNS,safeIntegers:true},
    command:{kind:'select-one',tableId:'people_us_recommendation_claims',keyColumns:['actor_id','idempotency_key'],columns:COLUMNS,safeIntegers:true},
    active:{kind:'select-one',tableId:'people_us_recommendation_claims',keyColumns:['active_source_id'],columns:COLUMNS,safeIntegers:true},
    pending:{kind:'select-page-after',tableId:'people_us_recommendation_claims',fixedKeyColumns:['state'],keyColumn:'claim_id',columns:['claim_id'],maxItems:100},
    insert:{kind:'insert',tableId:'people_us_recommendation_claims',columns:COLUMNS},
    update:{kind:'update',tableId:'people_us_recommendation_claims',setColumns:['state','active_source_id','revision','person_schema_ref','person_json','person_digest',
      'receipt_schema_ref','receipt_json','receipt_digest','last_failure_code','updated_at_ms'],keyColumns:['claim_id'],
      compareColumns:[{column:'revision',parameter:'expected_revision'},{column:'payload_digest',parameter:'expected_payload_digest'}]},
  }});
  const execute=body=>options.unitOfWork.execute([{participantId:'people_us_recommendation_claims',owner:'people',repositories:[repository],
    execute:context=>body(context.repository(repository.repositoryId),context.commitTimeMs)}]).people_us_recommendation_claims;
  function map(row){
    if(!row)return null;
    const payload=model.assertPayload(parse(row,'payload',131072)),person=parse(row,'person',16384),ack=parse(row,'receipt',16384),revision=Number(row.revision),
      active=model.ACTIVE.includes(row.state),createdAtMs=Number(row.created_at_ms),updatedAtMs=Number(row.updated_at_ms);
    options.contractValidator.validate(payload.source.schemaRef,payload.source);
    if(payload.target.kind==='create')options.contractValidator.validate('helix://contracts/domain-types/PeopleSelectedImageHandle/v1',payload.target.preparedRegistration.payload.selectedImage);
    if(person)model.assertPerson(person,payload);
    if(ack){model.assertAck(ack,payload,person);options.contractValidator.validate('helix://contracts/domain-types/UsAdultActorChoiceReceipt/v1',ack.receipt);}
    if(!['preparing_person','confirming_source','completed','conflict','person_failed'].includes(row.state)||row.claim_id!==model.claimId(row.actor_id,row.idempotency_key)||
      payload.claimId!==row.claim_id||payload.actorId!==row.actor_id||payload.source.sourceId!==row.source_id||
      row.active_source_id!==(active?row.source_id:null)||![revision,createdAtMs,updatedAtMs].every(Number.isSafeInteger)||revision<1||
      !/^[a-f0-9]{64}$/.test(row.request_digest)||row.last_failure_code!==null&&!/^[A-Z0-9_]{1,128}$/.test(row.last_failure_code)||
      row.state==='preparing_person'&&(payload.target.kind!=='create'||person!==null)||row.state==='confirming_source'&&person===null||
      row.state==='person_failed'&&(payload.target.kind!=='create'||person!==null||!row.last_failure_code)||
      row.state==='conflict'&&!row.last_failure_code||row.state==='completed'&&(!person||!ack||row.last_failure_code!==null)||row.state!=='completed'&&ack!==null)corrupt();
    return freeze({claimId:row.claim_id,actorId:row.actor_id,idempotencyKey:row.idempotency_key,requestDigest:row.request_digest,
      payloadDigest:row.payload_digest,payload,state:row.state,revision,person,ack,lastFailureCode:row.last_failure_code,createdAtMs,updatedAtMs});
  }
  return Object.freeze({
    get:claimId=>execute(repo=>map(repo.invoke('get',{claim_id:claimId}))),
    findCommand:(actorId,idempotencyKey)=>execute(repo=>map(repo.invoke('command',{actor_id:actorId,idempotency_key:idempotencyKey}))),
    findActive:sourceId=>execute(repo=>map(repo.invoke('active',{active_source_id:sourceId}))),
    listPendingPage({cursor,limit}){return execute(repo=>model.ACTIVE.flatMap(state=>repo.invoke('pending',{state,cursor,limit}))
      .sort((a,b)=>Buffer.compare(Buffer.from(a.claim_id),Buffer.from(b.claim_id))).slice(0,limit)
      .map(row=>({cursor:row.claim_id,scope:{claimId:row.claim_id}})));},
    create({actorId,idempotencyKey,requestDigest,payload}){return execute((repo,at)=>{
      model.assertPayload(payload);
      if(typeof actorId!=='string'||!actorId||actorId.length>256||typeof idempotencyKey!=='string'||!idempotencyKey||idempotencyKey.length>128||
        !/^[a-f0-9]{64}$/.test(requestDigest)||payload.actorId!==actorId||payload.claimId!==model.claimId(actorId,idempotencyKey))
        fail('PEOPLE_RECOMMENDATION_CLAIM_INVALID','推荐认领请求无效。');
      const existing=map(repo.invoke('command',{actor_id:actorId,idempotency_key:idempotencyKey}));
      if(existing){if(existing.requestDigest!==requestDigest)fail('PEOPLE_RECOMMENDATION_CLAIM_COMMAND_CONFLICT','操作标识已用于其他认领内容。');return existing;}
      const active=map(repo.invoke('active',{active_source_id:payload.source.sourceId}));
      if(active)fail('PEOPLE_RECOMMENDATION_CLAIM_IN_PROGRESS','此来源影片已有认领操作正在执行。',{claimId:active.claimId});
      const person=payload.target.kind==='existing'?model.personForExisting(payload.target):null,
        state=person?'confirming_source':'preparing_person';
      repo.invoke('insert',{claim_id:payload.claimId,actor_id:actorId,idempotency_key:idempotencyKey,request_digest:requestDigest,
        source_id:payload.source.sourceId,active_source_id:payload.source.sourceId,state,revision:1,
        ...encode('payload',payload,131072),...encode('person',person,16384),...encode('receipt',null,16384),last_failure_code:null,created_at_ms:at,updated_at_ms:at});
      options.afterClaimInsert?.({claimId:payload.claimId});return map(repo.invoke('get',{claim_id:payload.claimId}));
    });},
    advance(expected,{state,person=expected.person,ack=null,lastFailureCode=null}){return execute((repo,at)=>{
      const current=map(repo.invoke('get',{claim_id:expected.claimId}));
      if(!current||current.revision!==expected.revision||current.payloadDigest!==expected.payloadDigest)
        fail('PEOPLE_RECOMMENDATION_CLAIM_REVISION_CONFLICT','认领操作版本已变化，请重试。');
      const transitions={preparing_person:['preparing_person','confirming_source','person_failed'],confirming_source:['confirming_source','completed','conflict']};
      if(!transitions[current.state]?.includes(state))fail('PEOPLE_RECOMMENDATION_CLAIM_REVISION_CONFLICT','认领操作已结束或不能执行此状态变更。');
      if(person)model.assertPerson(person,current.payload);
      if(ack){model.assertAck(ack,current.payload,person);options.contractValidator.validate('helix://contracts/domain-types/UsAdultActorChoiceReceipt/v1',ack.receipt);}
      const fields={claim_id:current.claimId,expected_revision:current.revision,expected_payload_digest:current.payloadDigest,state,
        active_source_id:model.ACTIVE.includes(state)?current.payload.source.sourceId:null,revision:current.revision+1,
        ...encode('person',person,16384),...encode('receipt',ack,16384),last_failure_code:lastFailureCode,updated_at_ms:at};
      if(repo.invoke('update',fields).changes!==1)fail('PEOPLE_RECOMMENDATION_CLAIM_REVISION_CONFLICT','认领操作版本已变化，请重试。');
      options.afterClaimAdvance?.({claimId:current.claimId,state});return map(repo.invoke('get',{claim_id:current.claimId}));
    });},
  });
}
module.exports=Object.freeze({createUsAdultRecommendationClaimStore});
