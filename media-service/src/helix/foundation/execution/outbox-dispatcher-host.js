'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { createInboxCoordinator } = require('../persistence/outbox-inbox');

function repository(schemaManifest){return createRepositoryDefinition({repositoryId:'outbox_dispatcher',owner:'execution-foundation',schemaManifest,statements:{
  list_due:{kind:'select-in',tableId:'fx_outbox_deliveries',columns:['message_id','consumer_domain','state','attempt_count','next_attempt_at_ms','acked_at_ms'],keyColumn:'state',maxItems:3,safeIntegers:true},
  find_message:{kind:'select-one',tableId:'fx_outbox',columns:['message_id','producer_domain','message_kind','aggregate_type','aggregate_id','aggregate_revision','dedup_key',
    'payload_schema_ref','payload_json','payload_digest','state','available_at_ms','created_at_ms'],keyColumns:['message_id'],safeIntegers:true}
}});}
function createOutboxDispatcherHost(options){const repo=repository(options.schemaManifest),inbox=createInboxCoordinator(options),now=options.now||Date.now;
  const deferredDeliveryKeys=new Set(options.deferredDeliveryKeys||[]);
  if([...deferredDeliveryKeys].some((item)=>typeof item!=='string'||!item.includes('->')))throw new TypeError('Deferred Outbox delivery keys are invalid.');
  const libraReceiptRepository=createRepositoryDefinition({repositoryId:'libra_intake_delivery_receipt',owner:'libra',schemaManifest:options.schemaManifest,
    statements:{read_head:{kind:'select-one',tableId:'libra_subject_continuity_heads',columns:['head_id'],keyColumns:['head_id']},
      intake_receipt:{kind:'select-one',tableId:'libra_handoff_a_receipts',columns:['receipt_id','receipt_digest','offer_id','candidate_package_id','package_digest'],keyColumns:['intake_decision_id']},
      read_product_package:{kind:'select-one',tableId:'libra_product_packages',columns:['on_deck_package_id','package_digest'],keyColumns:['on_deck_package_id']}}});
  const libraRoutingSignalRepository=createRepositoryDefinition({repositoryId:'libra_routing_policy_signal',owner:'libra',readOnly:true,schemaManifest:options.schemaManifest,
    statements:{find_head:{kind:'select-one',tableId:'libra_field_routing_heads',columns:['field_id','current_routing_policy_id','current_policy_revision'],keyColumns:['field_id']}}});
  const perceptionWakeRepository=createRepositoryDefinition({repositoryId:'perception_wake_signal',owner:'perception',readOnly:true,schemaManifest:options.schemaManifest,
    statements:{find_source:{kind:'select-one',tableId:'perception_sources',columns:['perception_source_id','config_revision'],keyColumns:['perception_source_id']}}});
  const procurementControlSignalRepository=createRepositoryDefinition({repositoryId:'procurement_control_release_signal',owner:'procurement',readOnly:true,schemaManifest:options.schemaManifest,
    statements:{find_material:{kind:'select-one',tableId:'proc_field_materials',columns:['field_id','material_key'],keyColumns:['field_id','material_key']}}});
  let state='created',timer=null,running=null;
  function due(recoverRetryIntents=false){return options.unitOfWork.execute([{participantId:'outbox_dispatcher_due',owner:'execution-foundation',repositories:[repo],execute(context){
    const r=context.repository(repo.repositoryId);return r.invoke('list_due',{values:['pending','failed','delivered']}).filter((item)=>recoverRetryIntents||Number(item.next_attempt_at_ms)<=now())
      .map((delivery)=>Object.freeze({delivery,message:r.invoke('find_message',{message_id:delivery.message_id})}))
      .filter((item)=>!recoverRetryIntents||(item.message.message_kind==='procurement_retry_intent_available'&&item.delivery.consumer_domain==='procurement'))
      .filter((item)=>item.delivery.state!=='delivered'||item.message.message_kind==='libra.product-offer.available@1'&&item.delivery.consumer_domain==='arca')
      .filter((item)=>!deferredDeliveryKeys.has(item.message.message_kind+'->'+item.delivery.consumer_domain)).slice(0,100);}}]).outbox_dispatcher_due;}
  function envelope(item,payload){return Object.freeze({messageId:item.message.message_id,dedupKey:item.message.dedup_key,producerDomain:item.message.producer_domain,
    consumerDomain:item.delivery.consumer_domain,payloadSchemaRef:item.message.payload_schema_ref,payloadDigest:item.message.payload_digest,payload});}
  function consumeArcaOffer(item,admitted,resultDigest){
    const message={messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'arca'},
      consumed=inbox.readConsumption(message);
    if(consumed){
      // Recovery generations and later Owner closure do not rewrite the first
      // durable admission result for this message.
      options.unitOfWork.execute([admitted.admissionParticipant]);return;
    }
    inbox.consume({message,resultDigest,domainParticipant:admitted.admissionParticipant});
  }
  async function deliver(item){let payload;try{payload=JSON.parse(item.message.payload_json);}catch{throw new Error('Outbox payload JSON is corrupt.');}
    if(canonicalDigest(payload)!==item.message.payload_digest)throw new Error('Outbox payload digest is corrupt.');
    if(['people.candidate.opened','people.merge-candidate.opened'].includes(item.message.message_kind)&&item.delivery.consumer_domain==='people'){
      if(item.message.producer_domain!=='people'||item.message.aggregate_type!=='people-candidate'||
          item.message.payload_schema_ref!=='helix://contracts/signals/people-candidate-opened/v1'||
          payload.candidateId!==item.message.aggregate_id||payload.candidateRevision!==Number(item.message.aggregate_revision))
        throw new Error('Person Candidate signal does not match its committed aggregate.');
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'people'},
        resultDigest:canonicalDigest({schema:'people.candidate-signal-consumption@1',...payload}),
        domainParticipant:item.message.message_kind==='people.merge-candidate.opened'?options.peopleCoordinator.mergeCandidateSignalParticipant(payload):options.peopleCoordinator.candidateSignalParticipant(payload)});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'people'});return;
    }
    if(item.message.message_kind==='people.person.merged'&&item.delivery.consumer_domain==='people'){
      if(item.message.producer_domain!=='people'||item.message.aggregate_type!=='person'||item.message.payload_schema_ref!=='helix://contracts/signals/people-person-merged/v1'||
          payload.targetPersonId!==item.message.aggregate_id||payload.targetPersonRevision!==Number(item.message.aggregate_revision))throw new Error('Merge signal differs from its committed target revision.');
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'people'},
        resultDigest:canonicalDigest({schema:'people.merge-signal-consumption@1',...payload}),domainParticipant:options.peopleCoordinator.mergeSignalParticipant(payload)});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'people'});return;
    }
    if(item.message.message_kind==='people.person.registered'&&item.delivery.consumer_domain==='people'){
      if(item.message.producer_domain!=='people'||item.message.aggregate_type!=='person'||
          item.message.payload_schema_ref!=='helix://contracts/signals/people-person-registered/v1'||
          payload.personId!==item.message.aggregate_id||payload.personRevision!==Number(item.message.aggregate_revision))
        throw new Error('Person registration signal does not match its committed aggregate.');
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'people'},
        resultDigest:canonicalDigest({schema:'people.registration-signal-consumption@1',...payload}),
        domainParticipant:options.peopleCoordinator.registrationSignalParticipant(payload)});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'people'});return;
    }
    if(item.message.message_kind==='people.reference.updated'&&item.delivery.consumer_domain==='people'){
      if(item.message.producer_domain!=='people'||item.message.aggregate_type!=='person-reference'||
        item.message.payload_schema_ref!=='helix://contracts/signals/people-reference-updated/v1'||payload.personId!==item.message.aggregate_id||
        payload.referenceRevision!==Number(item.message.aggregate_revision))throw new Error('Reference update signal does not match its committed aggregate.');
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'people'},
        resultDigest:canonicalDigest({schema:'people.reference-signal-consumption@1',...payload}),domainParticipant:options.peopleCoordinator.referenceSignalParticipant(payload)});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'people'});return;
    }
    if(item.message.message_kind==='rule_template_published'&&item.delivery.consumer_domain==='read-model'){
      if(item.message.producer_domain!=='arca'||item.message.aggregate_type!=='rule_template'||
          item.message.payload_schema_ref!=='helix://contracts/messages/ArcaRuleTemplatePublished/v1'||
          payload.messageKind!=='rule_template_published'||payload.ruleTemplateId!==item.message.aggregate_id||
          payload.ruleTemplateRevision!==Number(item.message.aggregate_revision)||
          !Number.isSafeInteger(payload.ruleTemplateRevision)||payload.ruleTemplateRevision<1||
          !/^[a-f0-9]{64}$/.test(payload.rulesDigest)||!/^[a-f0-9]{64}$/.test(payload.affectedShelfSetDigest))
        throw new Error('Rule Template publication signal is invalid.');
      const published=options.readPublishedRuleTemplate?.(payload.ruleTemplateId,payload.ruleTemplateRevision);
      if(!published||published.templateId!==payload.ruleTemplateId||published.revision!==payload.ruleTemplateRevision||published.rulesDigest!==payload.rulesDigest)
        throw new Error('Rule Template publication does not match the durable Arca revision.');
      // Shelf Standards and their read projections are published atomically by Arca.
      // Receipt this exact immutable revision; never reapply an old publication.
      const resultDigest=canonicalDigest({schema:'read-model.rule-template-publication-consumption@1',
        templateId:published.templateId,revision:published.revision,rulesDigest:published.rulesDigest});
      inbox.consumeProjectionSignal({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'read-model'},resultDigest});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'read-model'});return;
    }
    if(item.message.message_kind==='procurement_candidate_offer_available'&&item.delivery.consumer_domain==='libra'){
      const admitted=options.intakeCoordinator.admitOffer(payload);
      if(admitted.kind==='administratively_retired'){
        const resultDigest=canonicalDigest({schema:'libra.retired-intake-consumption@1',processId:admitted.processId,
          retirementReceiptId:admitted.retirementReceipt.receiptId,retirementReceiptDigest:admitted.retirementReceipt.receiptDigest});
        inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'libra'},resultDigest,
          domainParticipant:admitted.admissionParticipant});
        inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});return;
      }
      if(admitted.kind==='terminal'){
        const receipt=admitted.terminalReceipt,resultDigest=canonicalDigest({schema:'libra.terminal-intake-consumption@1',
          processId:admitted.processId,receiptId:receipt.receipt_id,receiptDigest:receipt.receipt_digest});
        inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'libra'},resultDigest,
          domainParticipant:{participantId:'libra_terminal_intake_consumption',owner:'libra',repositories:[libraReceiptRepository],execute(context){
            const current=context.repository(libraReceiptRepository.repositoryId).invoke('intake_receipt',{intake_decision_id:admitted.processId});
            if(!current||current.receipt_id!==receipt.receipt_id||current.receipt_digest!==receipt.receipt_digest||
              current.offer_id!==payload.offerId||current.candidate_package_id!==payload.candidatePackageId||current.package_digest!==payload.packageDigest)
              throw new Error('Terminal Intake Receipt changed before consumption.');
            return {receiptId:current.receipt_id};
          }}});
        inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});return;
      }
      const resultDigest=canonicalDigest({schema:'libra.intake-offer-consumption@1',
        processId:admitted.processId,workId:admitted.work.workId,basisDigest:admitted.work.executionBasisDigest});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'libra'},resultDigest,
        domainParticipant:{participantId:'libra_intake_offer_admission_receipt',owner:'libra',repositories:[libraReceiptRepository],
          execute:()=>({processId:admitted.processId,workId:admitted.work.workId})}});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='libra.product-offer.available@1'&&item.delivery.consumer_domain==='arca'){
      const admitted=options.arcaCoordinator.admitOffer(payload);
      if(admitted.kind==='offer_withdrawn'){
        const receipt=admitted.withdrawalReceipt,resultDigest=canonicalDigest({schema:'arca.withdrawn-offer-consumption@1',
          offerId:admitted.processId,receiptId:receipt.receiptId,receiptDigest:receipt.receiptDigest});
        consumeArcaOffer(item,admitted,resultDigest);
        inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'arca'});return;
      }
      if(admitted.kind==='administratively_retired'){
        const resultDigest=canonicalDigest({schema:'arca.retired-offer-consumption@1',offerId:admitted.processId,
          retirementReceiptId:admitted.retirementReceipt.receiptId,retirementReceiptDigest:admitted.retirementReceipt.receiptDigest});
        consumeArcaOffer(item,admitted,resultDigest);
        inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'arca'});return;
      }
      const resultDigest=canonicalDigest({
        schema:'arca.handoff-b-offer-admission@1',offerId:admitted.processId,workId:admitted.work.workId,
        basisDigest:admitted.work.executionBasisDigest,recoveryGeneration:admitted.recovery.recoveryGeneration});
      consumeArcaOffer(item,admitted,resultDigest);
      inbox.recordDeliveryAttempt({messageId:item.message.message_id,consumerDomain:'arca',delivered:true,nextAttemptAtMs:now()+1000});
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
      options.wakeWorkspaceReclaimer?.();options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='libra_candidate_accepted'&&item.delivery.consumer_domain==='procurement'){
      options.acceptanceConsumer.consume(envelope(item,payload));inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'procurement'});return;
    }
    if(item.message.message_kind==='libra_candidate_rejected'&&item.delivery.consumer_domain==='procurement'){
      options.rejectionConsumer.consume(envelope(item,payload));inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'procurement'});return;
    }
    if(item.message.message_kind==='procurement_retry_intent_available'&&item.delivery.consumer_domain==='procurement'){
      if(item.message.payload_schema_ref!==
          'helix://contracts/application-types/ProcurementRetryIntentAvailableMessage/v1')
        throw new Error('Procurement Retry Intent Available payload schema is invalid.');
      if(!options.failedPreparationRetryService?.consumeAvailable)
        throw new Error('Procurement Retry Intent Available consumer is unavailable.');
      const consumed=options.failedPreparationRetryService.consumeAvailable(payload);
      const resultDigest=canonicalDigest({schema:'procurement.retry-intent-wake-consumption@1',
        retryIntentId:payload.retryIntentId,intentDigest:payload.intentDigest,
        terminalIntentState:consumed.retryAdmissionResult.terminalIntentState,
        admissionResultDigest:consumed.resultDigest});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'procurement'},
        resultDigest,domainParticipant:consumed.inboxParticipant});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'procurement'});
      options.executionRuntimeHost.wake();return;
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
    if(item.message.message_kind==='libra.subject-abandoned@1'&&item.delivery.consumer_domain==='libra'){
      const resultDigest=canonicalDigest({schema:'libra.subject-abandon-wake-consumption@1',messageId:item.message.message_id,
        subjectId:payload.subjectId,decisionDigest:payload.decisionDigest});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'libra'},resultDigest,
        domainParticipant:{participantId:'libra_subject_abandon_wake_receipt',owner:'libra',repositories:[libraReceiptRepository],execute:()=>payload}});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});
      options.executionRuntimeHost.wake();return;
    }
    if(item.message.message_kind==='libra.workspace-cleanup.requested@1'&&item.delivery.consumer_domain==='libra'){
      const resultDigest=canonicalDigest({schema:'libra.workspace-cleanup-request-consumption@1',messageId:item.message.message_id,
        libraRunId:payload.libraRunId,cleanupScopeId:payload.cleanupScopeId||null,triggerDigest:payload.triggerDigest||null});
      inbox.consume({message:{messageId:item.message.message_id,dedupKey:item.message.dedup_key,consumerDomain:'libra'},resultDigest,
        domainParticipant:{participantId:'libra_workspace_cleanup_wake_receipt',owner:'libra',repositories:[libraReceiptRepository],
          execute:()=>({libraRunId:payload.libraRunId,cleanupScopeId:payload.cleanupScopeId||null})}});
      inbox.acknowledge({messageId:item.message.message_id,consumerDomain:'libra'});
      options.wakeWorkspaceReclaimer?.();options.executionRuntimeHost.wake();return;
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
  async function drainOnce(){if(['stopping','stopped'].includes(state))return {kind:'inactive',delivered:0};if(running)return running;running=(async()=>{let delivered=0;for(const item of due()){
    if(['stopping','stopped'].includes(state))break;
    try{await deliver(item);delivered+=1;}catch(error){inbox.recordDeliveryAttempt({messageId:item.delivery.message_id,consumerDomain:item.delivery.consumer_domain,
      delivered:false,nextAttemptAtMs:now()+Math.min(60_000,1000*Math.max(1,Number(item.delivery.attempt_count)+1))});options.onError?.(error);}}
    return Object.freeze({kind:delivered?'advanced':'idle',delivered});})().finally(()=>{running=null;});return running;}
  async function recoverCommittedRetryIntents(){
    if(!['created','stopped'].includes(state)||running)throw new Error('Retry Intent recovery must precede Outbox startup.');
    // This synchronous Owner command is resumed by its durable message, before
    // the general asynchronous Event runtime inspects nonterminal Plans.
    // Startup deliberately retries failed delivery immediately; errors remain fatal.
    let delivered=0;
    for(;;){const items=due(true);if(!items.length)break;
      for(const item of items){await deliver(item);delivered+=1;}}
    return Object.freeze({kind:delivered?'advanced':'idle',delivered});
  }
  return Object.freeze({recoverCommittedRetryIntents,async start(){if(!['created','stopped'].includes(state))throw new Error('Outbox must be inactive before starting.');state='ready';await drainOnce();if(state==='ready'){timer=setInterval(()=>drainOnce(),1000);timer.unref?.();}return {state};},
    wake(){if(state==='ready')queueMicrotask(()=>drainOnce());},drainOnce,async stop(){state='stopping';if(timer)clearInterval(timer);timer=null;if(running)await running;state='stopped';return {state};}});
}
module.exports=Object.freeze({createOutboxDispatcherHost});
