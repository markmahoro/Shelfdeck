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
  const deferredDeliveryKeys=new Set(options.deferredDeliveryKeys||[]);
  if([...deferredDeliveryKeys].some((item)=>typeof item!=='string'||!item.includes('->')))throw new TypeError('Deferred Outbox delivery keys are invalid.');
  const libraReceiptRepository=createRepositoryDefinition({repositoryId:'libra_intake_delivery_receipt',owner:'libra',schemaManifest:options.schemaManifest,
    statements:{read_head:{kind:'select-one',tableId:'libra_subject_continuity_heads',columns:['head_id'],keyColumns:['head_id']},
      read_product_package:{kind:'select-one',tableId:'libra_product_packages',columns:['on_deck_package_id','package_digest'],keyColumns:['on_deck_package_id']}}});
  const libraRoutingSignalRepository=createRepositoryDefinition({repositoryId:'libra_routing_policy_signal',owner:'libra',readOnly:true,schemaManifest:options.schemaManifest,
    statements:{find_head:{kind:'select-one',tableId:'libra_field_routing_heads',columns:['field_id','current_routing_policy_id','current_policy_revision'],keyColumns:['field_id']}}});
  const perceptionWakeRepository=createRepositoryDefinition({repositoryId:'perception_wake_signal',owner:'perception',readOnly:true,schemaManifest:options.schemaManifest,
    statements:{find_source:{kind:'select-one',tableId:'perception_sources',columns:['perception_source_id','config_revision'],keyColumns:['perception_source_id']}}});
  const procurementControlSignalRepository=createRepositoryDefinition({repositoryId:'procurement_control_release_signal',owner:'procurement',readOnly:true,schemaManifest:options.schemaManifest,
    statements:{find_material:{kind:'select-one',tableId:'proc_field_materials',columns:['field_id','material_key'],keyColumns:['field_id','material_key']}}});
  let state='created',timer=null,running=null;
  function due(){return options.unitOfWork.execute([{participantId:'outbox_dispatcher_due',owner:'execution-foundation',repositories:[repo],execute(context){
    const r=context.repository(repo.repositoryId);return r.invoke('list_due',{}).filter((item)=>['pending','failed'].includes(item.state)&&Number(item.next_attempt_at_ms)<=now())
      .map((delivery)=>Object.freeze({delivery,message:r.invoke('find_message',{message_id:delivery.message_id})}))
      .filter((item)=>!deferredDeliveryKeys.has(item.message.message_kind+'->'+item.delivery.consumer_domain)).slice(0,100);}}]).outbox_dispatcher_due;}
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
    if(item.message.message_kind==='libra.product-offer.available@1'&&item.delivery.consumer_domain==='arca'){
      const admitted=options.arcaCoordinator.admitOffer(payload),resultDigest=canonicalDigest({
        schema:'arca.handoff-b-offer-admission@1',offerId:admitted.processId,workId:admitted.work.workId,
        basisDigest:admitted.work.executionBasisDigest,recoveryGeneration:admitted.recovery.recoveryGeneration});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'arca'},
        resultDigest,domainParticipant:admitted.admissionParticipant});
      inbox.recordDeliveryAttempt({messageId:item.message.message_id,consumerDomain:'arca',delivered:true,nextAttemptAtMs:now()});
      options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='arca.product.accepted@1'&&item.delivery.consumer_domain==='libra'){
      options.handoffBOutcomeConsumer.consumeAccepted(envelope(item,payload));
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});
      options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='arca_product_rejected'&&item.delivery.consumer_domain==='libra'){
      options.handoffBOutcomeConsumer.consumeRejected(envelope(item,payload));
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});
      options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='arca.offload.completed@1'&&item.delivery.consumer_domain==='libra'){
      const resultDigest=canonicalDigest({schema:'libra.offload-completion-wake-consumption@1',messageId:payload.messageId,
        onDeckPackageId:payload.onDeckPackageId,packageDigest:payload.packageDigest,
        completionDigest:payload.offloadCompletionFact?.completionDigest});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'libra'},resultDigest,
        domainParticipant:{participantId:'libra_offload_completion_wake_receipt',owner:'libra',repositories:[libraReceiptRepository],execute(context){
          const pkg=context.repository(libraReceiptRepository.repositoryId).invoke('read_product_package',{on_deck_package_id:payload.onDeckPackageId});
          if(!pkg||pkg.package_digest!==payload.packageDigest)throw new Error('Off-load Completion wake does not match its Libra Product Package.');
          return {onDeckPackageId:payload.onDeckPackageId,completionDigest:payload.offloadCompletionFact?.completionDigest};
        }}});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});
      options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='libra_candidate_accepted'&&item.delivery.consumer_domain==='procurement'){
      options.acceptanceConsumer.consume(envelope(item,payload));inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'procurement'});return;
    }
    if(item.message.message_kind==='libra_candidate_rejected'&&item.delivery.consumer_domain==='procurement'){
      options.rejectionConsumer.consume(envelope(item,payload));inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'procurement'});return;
    }
    if(item.message.message_kind==='arca.shelf_deregistration.control_released@1'&&item.delivery.consumer_domain==='procurement'){
      if(!Array.isArray(payload.materialIds)||payload.materialIds.length<1||payload.materialIds.length>100||
          new Set(payload.materialIds).size!==payload.materialIds.length||canonicalDigest([...payload.materialIds].sort())!==payload.materialKeySetDigest)
        throw new Error('Shelf Deregistration Control release signal is invalid.');
      const reconciled=options.procurementAutomation.reconcileMaterialControlChanges(Object.freeze([...payload.materialIds].sort()));
      const resultDigest=canonicalDigest({schema:'procurement.shelf-deregistration-control-release-consumption@1',
        signalId:payload.signalId,materialKeySetDigest:payload.materialKeySetDigest,
        affectedFieldIds:reconciled.map((item)=>item.fieldId).sort()});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'procurement'},resultDigest,
        domainParticipant:{participantId:'procurement_control_release_signal_receipt',owner:'procurement',repositories:[procurementControlSignalRepository],execute:()=>({
          signalId:payload.signalId,materialKeySetDigest:payload.materialKeySetDigest,affectedFieldCount:reconciled.length})}});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'procurement'});options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='field_routing_policy_published'&&item.delivery.consumer_domain==='libra'){
      const resultDigest=canonicalDigest({schema:'libra.routing-policy-signal-consumption@1',fieldId:payload.fieldId,
        routingPolicyId:payload.routingPolicyId,policyRevision:payload.policyRevision,policyDigest:payload.policyDigest});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'libra'},resultDigest,
        domainParticipant:{participantId:'libra_routing_policy_signal_receipt',owner:'libra',repositories:[libraRoutingSignalRepository],execute(context){
          const head=context.repository(libraRoutingSignalRepository.repositoryId).invoke('find_head',{field_id:payload.fieldId});
          if(!head||head.current_routing_policy_id!==payload.routingPolicyId||Number(head.current_policy_revision)<Number(payload.policyRevision))
            throw new Error('Routing Policy signal is ahead of the durable Libra head.');
          return {fieldId:payload.fieldId,policyRevision:Number(payload.policyRevision)};
        }}});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});
      options.routingCoordinator.reconcileField(payload.fieldId,100);options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind.startsWith('perception.')&&item.delivery.consumer_domain==='perception'){
      const resultDigest=canonicalDigest({schema:'perception.internal-wake-consumption@1',messageKind:item.message.message_kind,
        aggregateId:payload.aggregateId,aggregateRevision:payload.aggregateRevision,factDigest:payload.factDigest});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'perception'},resultDigest,
        domainParticipant:{participantId:'perception_internal_wake_receipt',owner:'perception',repositories:[perceptionWakeRepository],execute:()=>payload}});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'perception'});
      if(item.message.message_kind==='perception.records.committed')options.perceptionCoordinator?.reconcileAcquisition(payload.aggregateId);
      options.executionRuntimeHost.wake();return;
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
