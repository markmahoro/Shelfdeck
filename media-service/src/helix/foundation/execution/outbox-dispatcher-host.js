'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { createInboxCoordinator } = require('../persistence/outbox-inbox');

function repository(schemaManifest){return createRepositoryDefinition({repositoryId:'outbox_dispatcher',owner:'execution-foundation',schemaManifest,statements:{
  list_due:{kind:'select-all',tableId:'fx_outbox_deliveries',columns:['message_id','consumer_domain','state','attempt_count','next_attempt_at_ms','acked_at_ms'],keyColumns:[],safeIntegers:true},
  find_message:{kind:'select-one',tableId:'fx_outbox',columns:['message_id','producer_domain','message_kind','aggregate_type','aggregate_id','aggregate_revision','dedup_key',
    'payload_schema_ref','payload_json','payload_digest','state','available_at_ms','created_at_ms'],keyColumns:['message_id'],safeIntegers:true}
}});}
function createOutboxDispatcherHost(options){const repo=repository(options.schemaManifest),inbox=createInboxCoordinator(options),now=options.now||Date.now;
  const libraReceiptRepository=createRepositoryDefinition({repositoryId:'libra_intake_delivery_receipt',owner:'libra',schemaManifest:options.schemaManifest,
    statements:{read_head:{kind:'select-one',tableId:'libra_subject_continuity_heads',columns:['head_id'],keyColumns:['head_id']}}});
  let state='created',timer=null,running=null;
  function due(){return options.unitOfWork.execute([{participantId:'outbox_dispatcher_due',owner:'execution-foundation',repositories:[repo],execute(context){
    const r=context.repository(repo.repositoryId);return r.invoke('list_due',{}).filter((item)=>item.state!=='acked'&&Number(item.next_attempt_at_ms)<=now()).slice(0,100)
      .map((delivery)=>Object.freeze({delivery,message:r.invoke('find_message',{message_id:delivery.message_id})}));}}]).outbox_dispatcher_due;}
  function envelope(item,payload){return Object.freeze({messageId:item.message.message_id,dedupKey:item.message.dedup_key,producerDomain:item.message.producer_domain,
    consumerDomain:item.delivery.consumer_domain,payloadSchemaRef:item.message.payload_schema_ref,payloadDigest:item.message.payload_digest,payload});}
  async function deliver(item){let payload;try{payload=JSON.parse(item.message.payload_json);}catch{throw new Error('Outbox payload JSON is corrupt.');}
    if(canonicalDigest(payload)!==item.message.payload_digest)throw new Error('Outbox payload digest is corrupt.');
    if(item.message.message_kind==='procurement_candidate_offer_available'&&item.delivery.consumer_domain==='libra'){
      const admitted=options.intakeCoordinator.admitOffer(payload),resultDigest=canonicalDigest({schema:'libra.intake-offer-consumption@1',
        processId:admitted.processId,workId:admitted.work.workId,basisDigest:admitted.work.executionBasisDigest});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'libra'},resultDigest,
        domainParticipant:{participantId:'libra_intake_offer_admission_receipt',owner:'libra',repositories:[libraReceiptRepository],
          execute:()=>({processId:admitted.processId,workId:admitted.work.workId})}});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='libra_candidate_accepted'&&item.delivery.consumer_domain==='procurement'){
      options.acceptanceConsumer.consume(envelope(item,payload));inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'procurement'});return;
    }
    if(item.message.message_kind==='libra_candidate_rejected'&&item.delivery.consumer_domain==='procurement'){
      options.rejectionConsumer.consume(envelope(item,payload));inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'procurement'});return;
    }
    throw new Error('No Outbox consumer is registered for '+item.message.message_kind+' -> '+item.delivery.consumer_domain);
  }
  async function drainOnce(){if(running)return running;running=(async()=>{let delivered=0;for(const item of due()){
    try{await deliver(item);delivered+=1;}catch(error){inbox.recordDeliveryAttempt({messageId:item.delivery.message_id,consumerDomain:item.delivery.consumer_domain,
      delivered:false,nextAttemptAtMs:now()+Math.min(60_000,1000*Math.max(1,Number(item.delivery.attempt_count)+1))});options.onError?.(error);}}
    return Object.freeze({kind:delivered?'advanced':'idle',delivered});})().finally(()=>{running=null;});return running;}
  return Object.freeze({async start(){state='ready';await drainOnce();timer=setInterval(()=>drainOnce(),1000);timer.unref?.();return {state};},
    wake(){if(state==='ready')queueMicrotask(()=>drainOnce());},drainOnce,async stop(){state='stopping';if(timer)clearInterval(timer);timer=null;if(running)await running;state='stopped';return {state};}});
}
module.exports=Object.freeze({createOutboxDispatcherHost});
