'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const SHA=/^[a-f0-9]{64}$/;
const PAGE_SIZE=100;
function fail(){throw Object.assign(new Error('Libra Run Handoff responsibility evidence is inconsistent.'),
  {code:'LIBRA_HANDOFF_RESPONSIBILITY_INVALID'});}

// Libra enumerates its own immutable Offers. Arca alone supplies the
// responsibility for each exact Offer. The fence must also cover the caller's
// later write; this read does not authorize admission on its own. "accepted"
// is a conservative blocking signal, not proof of an Accepted receipt.
function createLibraHandoffResponsibilityReader(options){
  if(!options?.schemaManifest||typeof options.unitOfWork?.captureReadFence!=='function'||
      typeof options.unitOfWork?.execute!=='function'||typeof options.readArcaOfferResponsibility!=='function')
    throw new TypeError('Libra Handoff responsibility requires Owner projections and an opaque read fence.');
  const repository=createRepositoryDefinition({repositoryId:'libra_handoff_responsibility',owner:'libra',
    schemaManifest:options.schemaManifest,readOnly:true,statements:{
      run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','acceptance_spec_id','package_revision_head'],
        keyColumns:['libra_run_id'],safeIntegers:true},
      spec:{kind:'select-one',tableId:'libra_acceptance_specs',columns:['acceptance_spec_id','subject_id','product_scope_digest'],
        keyColumns:['acceptance_spec_id']},
      packages:{kind:'select-page-after',tableId:'libra_product_packages',fixedKeyColumns:['libra_run_id'],keyColumn:'package_revision',
        maxItems:PAGE_SIZE,safeIntegers:true,columns:['on_deck_package_id','offer_id','package_revision','libra_run_id','subject_id',
          'shelf_id','acceptance_spec_id','package_digest','related_disposition_set_digest','state']},
      delivery:{kind:'select-one',tableId:'libra_delivery_receipts',columns:['offer_id','on_deck_package_id','package_digest','result'],
        keyColumns:['offer_id']},
    }});
  const read=(execute,readFence)=>options.unitOfWork.execute([{participantId:'libra_handoff_responsibility_read',owner:'libra',
    repositories:[repository],execute}],{readFence}).libra_handoff_responsibility_read;
  return Object.freeze({read(request,{readFence=options.unitOfWork.captureReadFence()}={}){
    if(!request||typeof request.subjectId!=='string'||!request.subjectId||typeof request.libraRunId!=='string'||!request.libraRunId||
        !SHA.test(request.productScopeDigest||''))fail();
    const run=read(context=>{
      const repo=context.repository(repository.repositoryId),row=repo.invoke('run',{libra_run_id:request.libraRunId}),
        spec=row&&repo.invoke('spec',{acceptance_spec_id:row.acceptance_spec_id});
      if(!row||!spec||row.subject_id!==request.subjectId||spec.subject_id!==request.subjectId||
          spec.product_scope_digest!==request.productScopeDigest||!Number.isSafeInteger(Number(row.package_revision_head))||
          Number(row.package_revision_head)<0)fail();
      return row;
    },readFence);
    let cursor=null,count=0,accepted=false,more=true;
    while(more){
      const page=read(context=>{
        const repo=context.repository(repository.repositoryId),rows=repo.invoke('packages',{
          libra_run_id:request.libraRunId,cursor,limit:PAGE_SIZE});
        return rows.map(row=>({row,delivery:repo.invoke('delivery',{offer_id:row.offer_id})}));
      },readFence);
      for(const {row,delivery} of page){
        const revision=Number(row.package_revision),onDeckPackageId=canonicalDigest({schema:'libra.on-deck-package-id@1',
          libraRunId:request.libraRunId,packageRevision:revision});
        if(!Number.isSafeInteger(revision)||revision!==count+1||row.on_deck_package_id!==onDeckPackageId||
            row.libra_run_id!==request.libraRunId||row.subject_id!==request.subjectId||row.acceptance_spec_id!==run.acceptance_spec_id||
            row.state!=='published'||typeof row.shelf_id!=='string'||!row.shelf_id||!SHA.test(row.package_digest||'')||
            !SHA.test(row.related_disposition_set_digest||'')||row.offer_id!==canonicalDigest({schema:'libra.product-offer-id@1',
              onDeckPackageId,packageDigest:row.package_digest}))fail();
        if(delivery&&(delivery.offer_id!==row.offer_id||delivery.on_deck_package_id!==onDeckPackageId||
            delivery.package_digest!==row.package_digest||!['accepted','rejected'].includes(delivery.result)))fail();
        const offer=Object.freeze({offerId:row.offer_id,onDeckPackageId,packageRevision:revision,packageDigest:row.package_digest,
          shelfId:row.shelf_id,libraRunId:request.libraRunId,subjectId:request.subjectId,acceptanceSpecId:row.acceptance_spec_id,
          relatedDispositionSetDigest:row.related_disposition_set_digest}),status=options.readArcaOfferResponsibility(offer);
        if(!status||status.kind==='unavailable')return Object.freeze({kind:'unavailable',reasonCode:'arca_offer_responsibility_pending'});
        if(status.kind!=='ready'||!status.offer||canonicalJson(status.offer)!==canonicalJson(offer)||
            !['not_accepted','acceptance_present','withdrawn'].includes(status.state)||
            status.state==='withdrawn'&&(!status.withdrawalReceipt?.offer||canonicalJson(status.withdrawalReceipt.offer)!==canonicalJson(offer))||
            status.state==='withdrawn'&&delivery?.result==='accepted')fail();
        if(status.state==='acceptance_present'||delivery?.result==='accepted')accepted=true;
        count++;cursor=revision;
      }
      more=page.length===PAGE_SIZE;
    }
    if(count!==Number(run.package_revision_head))fail();
    read(()=>null,readFence);
    return Object.freeze({kind:'ready',subjectId:request.subjectId,libraRunId:request.libraRunId,
      productScopeDigest:request.productScopeDigest,handoffState:accepted?'accepted':count?'not_accepted':'no_offer'});
  }});
}
module.exports=Object.freeze({createLibraHandoffResponsibilityReader});
