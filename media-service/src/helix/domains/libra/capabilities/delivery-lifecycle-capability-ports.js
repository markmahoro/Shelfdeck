'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createDeliverablePromotionStore } = require('../persistence/deliverable-promotion-store');

const PUBLISH='libra.product_package.publish@1';
function requireNamed(context,names){for(const name of names)if(!context?.namedInputs||!Object.hasOwn(context.namedInputs,name))
  throw new TypeError('Deliverable Promotion Capability input is absent: '+name);}

function createDeliveryLifecycleCapabilityPorts(options){
  const now=options?.now||Date.now,store=createDeliverablePromotionStore(options);
  return Object.freeze({[PUBLISH]:Object.freeze({
    validateInputs(context){requireNamed(context,['libraDeliverablePromotionDecision','responsibilityControlCommitHandle']);},
    execute(context){
      const decision=context.namedInputs.libraDeliverablePromotionDecision;
      const effectId=canonicalDigest(['responsibility_control_commit',context.idempotencyKey]);
      const commitMarker='libra-promotion-marker-'+canonicalDigest({eventId:context.eventId,
        decisionDigest:decision.decisionDigest}).slice(0,40);
      const effectReceiptId='libra-promotion-effect-'+canonicalDigest({eventId:context.eventId,
        decisionDigest:decision.decisionDigest}).slice(0,40);
      const committed=store.publish({transactionId:'helix.transaction.libra-deliverable-promotion',decision,
        controlCommitHandle:context.namedInputs.responsibilityControlCommitHandle,eventId:context.eventId,effectReceiptId,
        commitMarker:Object.freeze({commitMarker,effectId,commitDigest:decision.decisionDigest}),
        resultId:'libra-promotion-result-'+canonicalDigest({eventId:context.eventId,decisionDigest:decision.decisionDigest}).slice(0,40)});
      const result=committed.receipt,outputDigest=canonicalDigest(result),committedAtMs=result.committedAtMs||now();
      const effectReceipt=Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
        effectReceiptId,effectId,
        effectClass:'responsibility_control_commit',idempotencyKey:context.idempotencyKey,
        commitMarker,
        externalReceiptRef:null,outputDigest,verificationEvidenceDigest:decision.decisionDigest,committedAtMs});
      const committedEvidenceDigest=canonicalDigest(decision);
      const evidence=Object.freeze({evidenceId:'libra-promotion-evidence-'+decision.decisionDigest.slice(0,40),
        evidenceKind:'libra_deliverable_promotion',producerRef:PUBLISH,basisDigest:decision.decisionDigest,
        payloadDigest:committedEvidenceDigest,observedAtMs:committedAtMs});
      return Object.freeze({kind:'succeeded',resultSchemaRef:'helix://contracts/capabilities/libra.product_package.publish/v1/result',
        result,evidenceSchemaRef:'helix://contracts/capabilities/libra.product_package.publish/v1/evidence',evidence,effectReceipt});
    },
    validateResult(_context,outcome){if(outcome?.result?.receiptKind!=='libra_product_package_published'||!outcome.result.offerId)
      throw new TypeError('Deliverable Promotion receipt is invalid.');},
  })});
}

module.exports=Object.freeze({PUBLISH,createDeliveryLifecycleCapabilityPorts});
