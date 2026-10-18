'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const model=require('../model/us-adult-recommendation-claim');
const {createUsAdultRecommendationClaimStore}=require('../persistence/us-adult-recommendation-claim-store');
const CONFLICTS=new Set(['US_ADULT_RECOMMENDATION_SOURCE_STALE','US_ADULT_ACTOR_CHOICE_STALE','US_ADULT_ACTOR_HANDOFF_CONFLICT',
  'PEOPLE_US_ACTOR_SNAPSHOT_STALE','P3_COMMAND_IDEMPOTENCY_CONFLICT']);
function fail(code,message){throw Object.assign(new Error(message),{code});}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))
  fail('PEOPLE_RECOMMENDATION_CLAIM_INVALID','推荐认领参数无效。');}
function summary(claim){return Object.freeze({claimId:claim.claimId,state:claim.state,revision:claim.revision,personId:claim.person?.personId||null,
  failureCode:claim.lastFailureCode,sourceConfirmed:claim.state==='completed',source:Object.freeze({subjectId:claim.payload.source.subjectId,
    libraRunId:claim.payload.source.libraRunId,title:claim.payload.source.originalName.originalFileName})});}
function createUsAdultRecommendationClaims(options){
  if(!options.recommendationQuery||!options.sources||!options.images||!options.imageOperations||!options.peopleStore||!options.confirmation)
    throw new TypeError('Recommendation claims require People persistence and formal image, source and confirmation ports.');
  const store=options.claimStore||createUsAdultRecommendationClaimStore(options);
  function read(claimId){const claim=store.get(claimId);if(!claim)fail('PEOPLE_RECOMMENDATION_CLAIM_NOT_FOUND','未找到这次推荐认领。');return claim;}
  async function reconcile(claimId){
    let claim=read(claimId);if(!model.ACTIVE.includes(claim.state))return summary(claim);
    try{
      if(claim.state==='preparing_person'){
        const prepared=claim.payload.target.preparedRegistration;
        options.imageOperations.beginPrepared(prepared);
        const operation=options.imageOperations.reconcile(prepared.operationId);
        if(operation.state==='failed')return summary(store.advance(claim,{state:'person_failed',lastFailureCode:operation.failureCode}));
        if(operation.state!=='completed')return summary(claim);
        const result=operation.result,person={schema:model.PERSON,personId:result.personId,personRevision:result.personRevision,referenceRevision:result.referenceRevision};
        claim=store.advance(claim,{state:'confirming_source',person});
      }
      const receipt=await options.confirmation.confirmSource({schemaRef:'helix://contracts/domain-types/UsAdultRecommendationConfirmation/v1',schemaVersion:1,
        claimId:claim.claimId,actorId:claim.actorId,source:claim.payload.source,personId:claim.person.personId,
        expectedPersonRevision:claim.person.personRevision,expectedReferenceRevision:claim.person.referenceRevision});
      options.afterSourceConfirmation?.({claimId:claim.claimId,receipt});
      return summary(store.advance(claim,{state:'completed',ack:{schema:model.ACK,receipt}}));
    }catch(error){
      const current=read(claimId);
      if(!model.ACTIVE.includes(current.state)||current.revision!==claim.revision)return summary(current);
      const lastFailureCode=/^[A-Z0-9_]{1,128}$/.test(error.code||'')?error.code:'PEOPLE_RECOMMENDATION_RELAY_FAILED';
      options.onClaimFailure?.({claimId,errorCode:lastFailureCode});
      return summary(store.advance(current,{state:CONFLICTS.has(error.code)?'conflict':current.state,lastFailureCode}));
    }
  }
  return Object.freeze({reconcile,listPendingPage:store.listPendingPage,get:claimId=>summary(read(claimId)),
    findActive:sourceId=>{const claim=store.findActive(sourceId);return claim?summary(claim):null;},
    async begin(recommendationId,body,actorId){
      exact(body,['idempotencyKey','expectedPublicationRevision','expectedSnapshotDigest','target']);
      if(typeof recommendationId!=='string'||!/^[a-f0-9]{64}$/.test(recommendationId)||typeof actorId!=='string'||!actorId||actorId.length>256||
        typeof body.idempotencyKey!=='string'||!body.idempotencyKey||body.idempotencyKey.length>128||!Number.isSafeInteger(body.expectedPublicationRevision)||
        body.expectedPublicationRevision<1||!/^[a-f0-9]{64}$/.test(body.expectedSnapshotDigest||''))fail('PEOPLE_RECOMMENDATION_CLAIM_INVALID','推荐认领版本或操作标识无效。');
      if(body.target?.kind==='existing')exact(body.target,['kind','personId','expectedPersonRevision','expectedReferenceRevision']);
      else if(body.target?.kind==='create')exact(body.target,['kind','canonicalName','aliases','image']);
      else fail('PEOPLE_RECOMMENDATION_CLAIM_INVALID','请选择已有演员或新建演员。');
      const requestDigest=canonicalDigest({recommendationId,body}),existing=store.findCommand(actorId,body.idempotencyKey);
      if(existing){
        if(existing.requestDigest!==requestDigest)fail('PEOPLE_RECOMMENDATION_CLAIM_COMMAND_CONFLICT','此操作标识已用于其他认领内容。');
        return Object.freeze({claimRef:existing.claimId,replayed:true,...await reconcile(existing.claimId)});
      }
      const selected=options.recommendationQuery.read(recommendationId),publication=selected.publication,source=selected.group.representative.source,
        evidence=selected.group.representative.image;
      if(publication.publicationRevision!==body.expectedPublicationRevision||publication.snapshotDigest!==body.expectedSnapshotDigest)
        fail('PEOPLE_RECOMMENDATION_CLAIM_REVISION_CONFLICT','推荐快照已变化，请刷新后重试。');
      const active=store.findActive(source.sourceId);
      if(active)fail('PEOPLE_RECOMMENDATION_CLAIM_IN_PROGRESS','该影片的认领操作正在执行，请等待完成。');
      const claimId=model.claimId(actorId,body.idempotencyKey);let target;
      if(body.target.kind==='existing'){
        const {personId,expectedPersonRevision,expectedReferenceRevision}=body.target;
        options.peopleStore.readUsAdultPersonSnapshot({personId,expectedPersonRevision,expectedReferenceRevision});target=body.target;
      }else{
        let image=body.target.image;
        if(image?.kind==='recommendation'){
          exact(image,['kind']);
          const prepared=await options.images.readImage({source,expectedEvidenceDigest:evidence.evidenceDigest});
          image={kind:'upload',bytesBase64:prepared.bytes.toString('base64')};
        }
        const preparedRegistration=await options.imageOperations.prepareRegistration({idempotencyKey:'us-rec-person-'+claimId,libraryKind:'us_adult',
          canonicalName:body.target.canonicalName,aliases:body.target.aliases,image},actorId);
        target={kind:'create',preparedRegistration};
      }
      options.sources.readSource(source);
      const payload={schema:model.PAYLOAD,claimId,actorId,recommendationId,publicationWindowKey:publication.windowKey,
        publicationRevision:publication.publicationRevision,source,imageEvidenceDigest:evidence.evidenceDigest,target},
        claim=store.create({actorId,idempotencyKey:body.idempotencyKey,requestDigest,payload});
      options.wakeClaims?.();return Object.freeze({claimRef:claim.claimId,replayed:false,...await reconcile(claim.claimId)});
    },
  });
}
module.exports=Object.freeze({summary,createUsAdultRecommendationClaims});
