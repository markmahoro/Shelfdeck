'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {createCustomTargetStore}=require('../persistence/custom-target-store');
const {validateBasis,buildCustomTargetPreview,confirmCustomTarget}=require('../model/custom-target-records');

function fail(code){throw Object.assign(new Error(code),{code});}
function exact(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||canonicalJson(Object.keys(value).sort())!==canonicalJson([...keys].sort()))
    fail('LIBRA_CUSTOM_TARGET_COMMAND_INVALID');
}
function text(value,limit=256){if(typeof value!=='string'||!value.trim()||value.length>limit)fail('LIBRA_CUSTOM_TARGET_COMMAND_INVALID');return value;}
function createCustomTargetApplication(options){
  if(!options?.unitOfWork||typeof options.unitOfWork.captureReadFence!=='function'||typeof options.currentViewReader?.read!=='function'||
      typeof options.readCurrentCustomTargetBaseline!=='function')
    throw new TypeError('Custom target commands require a fenced current Owner view.');
  const targets=options.customTargetStore||createCustomTargetStore(options),coordinator=createCommandCommitCoordinator(options),now=options.now||Date.now;
  function view(subjectId,libraRunId){
    const result=options.currentViewReader.read(Object.freeze({subjectId,libraRunId}));
    if(result?.kind==='pending')return null;
    if(!result||result.kind!=='ready')fail('LIBRA_CUSTOM_TARGET_VIEW_INVALID');
    const basis=validateBasis(result.basis);
    if(basis.subjectId!==subjectId||basis.libraRunId!==libraRunId)
      fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
    const baseline=options.readCurrentCustomTargetBaseline(Object.freeze({subjectId,libraRunId,productScopeDigest:basis.productScopeDigest}));
    if(baseline?.kind==='unavailable')return null;
    if(!baseline||baseline.kind!=='ready'||!['no_offer','not_accepted','accepted'].includes(baseline.handoffState))
      fail('LIBRA_CUSTOM_TARGET_BASELINE_INVALID');
    if(baseline.handoffState==='accepted'||basis.handoffState==='accepted')fail('LIBRA_CUSTOM_TARGET_ARCA_RESPONSIBILITY');
    if(baseline.subjectId!==subjectId||baseline.productScopeDigest!==basis.productScopeDigest||baseline.standardSpecDigest!==basis.baseSpecDigest||
        baseline.shelfId!==basis.shelfId||baseline.shelfStandardRevision!==basis.shelfStandardRevision||
        baseline.shelfStandardDigest!==basis.shelfStandardDigest||baseline.identityDigest!==basis.identityDigest||
        baseline.handoffState!==basis.handoffState)fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
    return result;
  }
  function command(kind,actorId,idempotencyKey,requestDigest,record,currentBasis,readFence,replayOnly=false){
    const id=canonicalDigest({schema:'libra.custom-target-command-receipt@1',kind,actorId,idempotencyKey}),
      contract='libra.custom-target.'+(kind==='intent'?'confirm':'preview')+'@1',
      domain=targets.participant({kind,record,idempotencyKey,requestDigest,currentBasis,readFence}),
      participant=replayOnly?{...domain,execute(){fail('LIBRA_CUSTOM_TARGET_RECEIPT_MISSING');}}:domain;
    const result=coordinator.execute({readFence,command:{commandReceiptId:id,ownerDomain:'libra',commandContract:contract,
      callerScope:'admin:'+actorId,idempotencyKey,requestDigest,targetType:'libra_run',targetId:record.basis.libraRunId},
      domainParticipant:participant,commitMarker:{commitMarker:id,scopeType:'libra_run',scopeId:record.basis.libraRunId,commitDigest:requestDigest},
      auditRecords:[{auditId:id,actorType:'admin',actorId,action:contract,scopeType:'libra_run',scopeId:record.basis.libraRunId}],
      resultEnvelope:result=>({resultSchemaRef:'libra.custom-target-command-result@1',resultRef:result})});
    const found=targets.findCommand(kind,actorId,idempotencyKey),saved=found?.record,receipt=result.receipt,
      savedId=kind==='preview'?saved?.previewDigest:saved?.intentId,savedDigest=kind==='preview'?saved?.previewDigest:saved?.intentDigest,
      expectedRequest=kind==='preview'&&saved?canonicalDigest({schema:'libra.custom-target-preview-request@1',
        subjectId:saved.basis.subjectId,libraRunId:saved.basis.libraRunId}):saved?.requestDigest;
    if(!found||found.requestDigest!==requestDigest||expectedRequest!==requestDigest||receipt.commandReceiptId!==id||
        receipt.requestDigest!==requestDigest||receipt.targetType!=='libra_run'||receipt.targetId!==saved.basis.libraRunId||
        receipt.resultSchemaRef!=='libra.custom-target-command-result@1'||
        canonicalJson(receipt.resultRef)!==canonicalJson({recordId:savedId,recordDigest:savedDigest}))
      fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');
    return Object.freeze({kind:kind==='preview'?'preview':'confirmed',record:saved,replayed:result.replayed});
  }
  function prior(kind,actorId,idempotencyKey,requestDigest){
    const found=targets.findCommand(kind,actorId,idempotencyKey);
    if(!found)return null;
    if(found.requestDigest!==requestDigest)fail('LIBRA_CUSTOM_TARGET_IDEMPOTENCY_CONFLICT');
    return command(kind,actorId,idempotencyKey,requestDigest,found.record,found.record.basis,
      options.unitOfWork.captureReadFence(),true);
  }
  function readPreview(actorId,previewDigest){
    text(actorId);const record=targets.preview(text(previewDigest));
    if(record.actorId!==actorId)fail('LIBRA_CUSTOM_TARGET_PREVIEW_NOT_FOUND');
    return record;
  }
  return Object.freeze({
    preparePreview(actorId,body){
      text(actorId);exact(body,['subjectId','libraRunId','idempotencyKey']);
      const subjectId=text(body.subjectId),libraRunId=text(body.libraRunId),key=text(body.idempotencyKey,128),
        requestDigest=canonicalDigest({schema:'libra.custom-target-preview-request@1',subjectId,libraRunId});
      const replay=prior('preview',actorId,key,requestDigest);if(replay)return replay;
      const readFence=options.unitOfWork.captureReadFence(),current=view(subjectId,libraRunId);
      if(!current)return Object.freeze({kind:'evidence_pending',replayed:false});
      const record=buildCustomTargetPreview({basis:current.basis,requirements:current.requirements,episodeScopes:current.episodeScopes,
        proposals:current.proposals,actorId,createdAtMs:now()});
      return command('preview',actorId,key,requestDigest,record,current.basis,readFence);
    },
    readPreview,
    confirm(actorId,body){
      text(actorId);exact(body,['previewDigest','selectedChangeDigests','acknowledged','idempotencyKey']);
      const key=text(body.idempotencyKey,128),existing=targets.findCommand('intent',actorId,key);
      if(existing){
        if(body.previewDigest!==existing.record.previewDigest||body.acknowledged!==true||
            !Array.isArray(body.selectedChangeDigests)||body.selectedChangeDigests.some(item=>typeof item!=='string')||
            canonicalJson([...body.selectedChangeDigests].sort())!==canonicalJson(existing.record.selectedChangeDigests))
          fail('LIBRA_CUSTOM_TARGET_IDEMPOTENCY_CONFLICT');
        return prior('intent',actorId,key,existing.requestDigest);
      }
      const preview=readPreview(actorId,body.previewDigest),
        provisional=confirmCustomTarget({preview,expectedPreviewDigest:body.previewDigest,currentBasis:preview.basis,
          selectedChangeDigests:body.selectedChangeDigests,acknowledged:body.acknowledged,actorId,idempotencyKey:key,confirmedAtMs:now()}),
        replay=prior('intent',actorId,key,provisional.requestDigest);
      if(replay)return replay;
      const readFence=options.unitOfWork.captureReadFence(),current=view(preview.basis.subjectId,preview.basis.libraRunId);
      if(!current)return Object.freeze({kind:'evidence_pending',replayed:false});
      const record=confirmCustomTarget({preview,expectedPreviewDigest:body.previewDigest,currentBasis:current.basis,
        selectedChangeDigests:body.selectedChangeDigests,acknowledged:body.acknowledged,actorId,idempotencyKey:key,confirmedAtMs:provisional.confirmedAtMs});
      return command('intent',actorId,key,record.requestDigest,record,current.basis,readFence);
    },
  });
}

module.exports=Object.freeze({createCustomTargetApplication});
