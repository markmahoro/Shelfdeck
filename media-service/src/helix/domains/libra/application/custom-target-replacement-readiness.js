'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createRunAdmissionStore}=require('../persistence/run-admission-store');
const {assertStandardAcceptanceSpec}=require('../model/custom-acceptance-spec');

function fail(code,message){throw Object.assign(new Error(message),{code});}
function createCustomTargetReplacementReadiness(options){
  if(!options?.schemaManifest||!options.unitOfWork||typeof options.unitOfWork.captureReadFence!=='function'||
      typeof options.customTargetStore?.current!=='function'||typeof options.customTargetStore?.intentEvidence!=='function'||
      typeof options.workResultReader?.createExecutionStateReadParticipant!=='function'||typeof options.cancelProcessWorks!=='function')
    throw new TypeError('Custom replacement readiness requires Libra, Foundation and cancellation ports.');
  const repository=createRepositoryDefinition({repositoryId:'libra_custom_replacement_readiness',owner:'libra',
    schemaManifest:options.schemaManifest,readOnly:true,statements:{run:{kind:'select-one',tableId:'libra_runs',
      columns:['libra_run_id','subject_id','state','acceptance_spec_id','execution_basis_digest','execution_basis_record_json',
        'supersedes_run_id','superseded_by_run_id','package_revision_head'],keyColumns:['libra_run_id'],safeIntegers:true},
      spec:{kind:'select-one',tableId:'libra_acceptance_specs',columns:['acceptance_spec_id','subject_id','record_digest','spec_digest','spec_json'],
        keyColumns:['acceptance_spec_id']},
      packages:{kind:'select-all',tableId:'libra_product_packages',columns:['on_deck_package_id','offer_id','package_revision',
        'libra_run_id','subject_id','shelf_id','acceptance_spec_id','package_digest','related_disposition_set_digest','state'],
        keyColumns:['libra_run_id'],safeIntegers:true},
      delivery:{kind:'select-one',tableId:'libra_delivery_receipts',columns:['offer_id','on_deck_package_id','package_digest','result'],
        keyColumns:['offer_id']}}});
  const admissions=createRunAdmissionStore(options);
  function readScope(libraRunId){
    const value=options.unitOfWork.execute([{participantId:'libra_custom_replacement_scope',owner:'libra',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),run=repo.invoke('run',{libra_run_id:libraRunId});
      if(!run)fail('LIBRA_REPLACEMENT_RUN_NOT_FOUND','Replacement Run is absent.');
      let basis;try{basis=JSON.parse(run.execution_basis_record_json);}catch{fail('LIBRA_REPLACEMENT_BASIS_INVALID','Replacement Run Basis is unreadable.');}
      const specRow=repo.invoke('spec',{acceptance_spec_id:run.acceptance_spec_id});let spec;
      try{spec=JSON.parse(specRow?.spec_json);}catch{fail('LIBRA_REPLACEMENT_BASIS_INVALID','Run Spec is unreadable.');}
      if(!specRow||specRow.subject_id!==run.subject_id||spec.acceptanceSpecId!==run.acceptance_spec_id||
          spec.recordDigest!==specRow.record_digest||spec.specDigest!==specRow.spec_digest)
        fail('LIBRA_REPLACEMENT_BASIS_INVALID','Run Spec identity is inconsistent.');
      const target=basis?.collectionTargetRef;
      if(!target){
        if(spec.targetKind==='user_custom')fail('LIBRA_REPLACEMENT_BASIS_INVALID','Custom Run lost its target reference.');
        assertStandardAcceptanceSpec(spec);
        return Object.freeze({kind:'not_custom',libraRunId});
      }
      if(spec.targetKind!=='user_custom'||target.targetKind!=='user_custom'||basis.subjectSnapshot?.subjectId!==run.subject_id||
          basis.subjectSnapshot?.contentProfile!=='movie'||basis.subjectSnapshot?.structureKind!=='single'||
          basis.acceptanceSpec?.acceptanceSpecId!==run.acceptance_spec_id||basis.executionBasisDigest!==run.execution_basis_digest||
          !/^[a-f0-9]{64}$/.test(basis.acceptanceSpec?.productScopeDigest||'')||!run.supersedes_run_id)
        fail('LIBRA_REPLACEMENT_BASIS_INVALID','Replacement target or Run scope is inconsistent.');
      const chain=[],visited=new Set([libraRunId]);let child=run;
      while(child.supersedes_run_id){
        if(visited.has(child.supersedes_run_id))fail('LIBRA_REPLACEMENT_RELATION_INVALID','Replacement ancestry contains a cycle.');
        const prior=repo.invoke('run',{libra_run_id:child.supersedes_run_id});
        if(!prior||prior.subject_id!==run.subject_id||prior.state!=='superseded'||prior.superseded_by_run_id!==child.libra_run_id||
            !Number.isSafeInteger(Number(prior.package_revision_head))||Number(prior.package_revision_head)<0)
          fail('LIBRA_REPLACEMENT_RELATION_INVALID','Replacement ancestry is not an exact superseded Run chain.');
        chain.push(prior);visited.add(prior.libra_run_id);child=prior;
      }
      return {kind:'custom',run,basis,target,chain};
    }}]).libra_custom_replacement_scope;
    if(value.kind!=='custom')return value;
    const {run,basis,target,chain}=value,selected=options.customTargetStore.current({subjectId:run.subject_id,
      productScopeDigest:basis.acceptanceSpec.productScopeDigest});
    if(!selected||selected.intentId!==target.intentId||selected.intentDigest!==target.intentDigest||selected.revision!==target.targetRevision)
      fail('LIBRA_COLLECTION_TARGET_NOT_CURRENT','Replacement Run target is no longer current.');
    const evidence=options.customTargetStore.intentEvidence(target.intentId),admitted=admissions.readConfirmedTargetReplacement(evidence);
    if(!admitted||admitted.libraRunId!==libraRunId||admitted.supersededRunRef?.libraRunId!==chain[0]?.libra_run_id||
        admitted.executionBasisDigest!==run.execution_basis_digest||evidence.intent.basis.libraRunId!==chain[0].libra_run_id)
      fail('LIBRA_REPLACEMENT_RELATION_INVALID','Replacement admission cannot be reconstructed from the exact target.');
    return {kind:'custom',run,basis,target,chain};
  }
  function readOffers(chain){return options.unitOfWork.execute([{participantId:'libra_custom_replacement_offers',owner:'libra',repositories:[repository],
    execute(context){const repo=context.repository(repository.repositoryId),offers=[];
      for(const previous of chain){
        const rows=repo.invoke('packages',{libra_run_id:previous.libra_run_id})
          .sort((left,right)=>Number(left.package_revision)-Number(right.package_revision));
        if(rows.length!==Number(previous.package_revision_head))
          fail('LIBRA_REPLACEMENT_OFFER_EVIDENCE_INVALID','Published Offer history does not match its Run head.');
        for(const [index,row] of rows.entries()){
          const packageRevision=index+1,onDeckPackageId=canonicalDigest({schema:'libra.on-deck-package-id@1',
            libraRunId:previous.libra_run_id,packageRevision});
          if(Number(row.package_revision)!==packageRevision||row.on_deck_package_id!==onDeckPackageId||row.libra_run_id!==previous.libra_run_id||
              row.subject_id!==previous.subject_id||row.acceptance_spec_id!==previous.acceptance_spec_id||row.state!=='published'||
              typeof row.shelf_id!=='string'||!row.shelf_id||!/^[a-f0-9]{64}$/.test(row.package_digest||'')||
              !/^[a-f0-9]{64}$/.test(row.related_disposition_set_digest||'')||
              row.offer_id!==canonicalDigest({schema:'libra.product-offer-id@1',onDeckPackageId,packageDigest:row.package_digest}))
            fail('LIBRA_REPLACEMENT_OFFER_EVIDENCE_INVALID','Published Offer identity differs from its Run.');
          const delivery=repo.invoke('delivery',{offer_id:row.offer_id});
          if(delivery&&(delivery.on_deck_package_id!==onDeckPackageId||delivery.package_digest!==row.package_digest||
              !['accepted','rejected'].includes(delivery.result)))
            fail('LIBRA_REPLACEMENT_OFFER_EVIDENCE_INVALID','Libra delivery receipt differs from its Offer.');
          offers.push({offer:{offerId:row.offer_id,onDeckPackageId,packageRevision,packageDigest:row.package_digest,shelfId:row.shelf_id,
            libraRunId:previous.libra_run_id,subjectId:previous.subject_id,acceptanceSpecId:row.acceptance_spec_id,
            relatedDispositionSetDigest:row.related_disposition_set_digest},delivery});
        }
      }
      return offers;
    }}]).libra_custom_replacement_offers;}
  function withdrawalMatches(receipt,offer){
    const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
      canonicalJson(Object.keys(value).sort())===canonicalJson(keys.sort());
    if(!exact(receipt,['schemaRef','receiptId','ownerDomain','reasonCode','offer','deliveryFence','closedAtMs','receiptDigest'])||
        receipt.schemaRef!=='arca.offer-withdrawal-receipt@1'||receipt.ownerDomain!=='arca'||
        receipt.reasonCode!=='target_not_current'||canonicalJson(receipt.offer)!==canonicalJson(offer)||
        receipt.receiptId!==canonicalDigest({schema:'arca.offer-withdrawal-id@1',offerId:offer.offerId,packageDigest:offer.packageDigest})||
        !Number.isSafeInteger(receipt.closedAtMs)||receipt.closedAtMs<0||!/^[a-f0-9]{64}$/.test(receipt.receiptDigest||''))return false;
    const {receiptDigest,...body}=receipt,fence=receipt.deliveryFence;
    if(canonicalDigest(body)!==receiptDigest||!exact(fence,['eligibility','reasonCode','libraRunId','runState','runStateRevision',
        'runStateDigest','acceptanceSpecId','packageRevisionHead','deliveryReceiptAbsent','fenceDigest'])||
        fence.eligibility!=='ineligible'||fence.reasonCode!=='target_not_current'||
        !['active','suspended','frozen','superseded','completed','discarded'].includes(fence.runState)||
        !Number.isSafeInteger(fence.runStateRevision)||fence.runStateRevision<1||!/^[a-f0-9]{64}$/.test(fence.runStateDigest||'')||
        fence.libraRunId!==offer.libraRunId||fence.acceptanceSpecId!==offer.acceptanceSpecId||fence.deliveryReceiptAbsent!==true||
        !Number.isSafeInteger(fence.packageRevisionHead)||fence.packageRevisionHead<offer.packageRevision||
        !/^[a-f0-9]{64}$/.test(fence.fenceDigest||''))return false;
    const {fenceDigest,...fenceBody}=fence;
    return canonicalDigest(fenceBody)===fenceDigest;
  }  function identity(value){return canonicalJson({runId:value.run.libra_run_id,subjectId:value.run.subject_id,
    runState:value.run.state,runBasis:value.run.execution_basis_digest,target:value.target,
    previous:value.chain.map(row=>({id:row.libra_run_id,next:row.superseded_by_run_id,head:Number(row.package_revision_head)}))});}
  return Object.freeze({check(libraRunId,{allowSuspended=false}={}){
    if(typeof libraRunId!=='string'||!libraRunId)throw new TypeError('Exact replacement Run is required.');
    const before=readScope(libraRunId);
    if(before.kind==='not_custom')return before;
    if(before.run.state!=='active'&&!(allowSuspended===true&&before.run.state==='suspended'))
      return Object.freeze({kind:'pending',reasonCode:'replacement_run_not_active',libraRunId});
    // Repeated cancellation is deliberate: a crash after admission must not
    // leave the prior Work running merely because the command was replayed.
    for(const previous of before.chain)options.cancelProcessWorks(Object.freeze({ownerDomain:'libra',processType:'libra_run',
      processId:previous.libra_run_id,reasonCode:'LIBRA_RUN_SUPERSEDED'}));
    const readFence=options.unitOfWork.captureReadFence(),current=readScope(libraRunId);
    if(current.kind!=='custom'||identity(current)!==identity(before))
      fail('LIBRA_REPLACEMENT_RELATION_CHANGED','Replacement or its target changed while draining prior Work.');
    const offers=readOffers(current.chain),closedOfferIds=[];
    if(offers.length&&typeof options.readArcaFormationStatus!=='function')
      return Object.freeze({kind:'pending',reasonCode:'prior_offer_closure_unproven',libraRunId});
    if(offers.some(item=>item.delivery))
      return Object.freeze({kind:'pending',reasonCode:'prior_offer_outcome_review_required',libraRunId});
    for(let offset=0;offset<offers.length;offset+=100){
      const batch=offers.slice(offset,offset+100),statuses=options.readArcaFormationStatus(batch.map(item=>item.offer.offerId));
      if(!(statuses instanceof Map))fail('LIBRA_REPLACEMENT_OFFER_EVIDENCE_INVALID','Arca Offer projection is invalid.');
      for(const {offer} of batch){
        const status=statuses.get(offer.offerId);
        if(!status||status.stage!=='offer_withdrawn')
          return Object.freeze({kind:'pending',reasonCode:'prior_offer_closure_unproven',libraRunId});
        if(!withdrawalMatches(status.withdrawalReceipt,offer))
          fail('LIBRA_REPLACEMENT_OFFER_EVIDENCE_INVALID','Arca withdrawal does not prove this exact Offer closure.');
        closedOfferIds.push(offer.offerId);
      }
    }
    const scopes=[...current.chain.map(row=>({ownerDomain:'libra',processType:'libra_run',processId:row.libra_run_id})),
      ...closedOfferIds.map(processId=>({ownerDomain:'arca',processType:'arca_acceptance',processId}))];
    let draining=false;
    for(let offset=0;offset<scopes.length;offset+=1000){
      const participant=options.workResultReader.createExecutionStateReadParticipant(scopes.slice(offset,offset+1000),summaries=>{
        if(summaries.some(item=>item.hasOpenWork||item.hasOpenEvent||item.hasUnsettledEffect))draining=true;
      });
      options.unitOfWork.execute([participant],{readFence});
    }
    if(draining)return Object.freeze({kind:'pending',reasonCode:'prior_execution_draining',libraRunId});
    return Object.freeze({kind:'ready',libraRunId,previousRunIds:Object.freeze(current.chain.map(row=>row.libra_run_id)),
      closedOfferIds:Object.freeze(closedOfferIds),readFence});
  }});
}
module.exports=Object.freeze({createCustomTargetReplacementReadiness});
