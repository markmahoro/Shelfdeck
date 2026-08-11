'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildAcceptedIntakePayload, buildLibraBindingDraft } = require('../model/intake-acceptance-contracts');
const { createIntakeAcceptanceStore } = require('../persistence/intake-acceptance-store');
const { createIntakeRejectionStore } = require('../persistence/intake-rejection-store');

const BASE = 'helix://contracts/capabilities/';
const CANDIDATE = 'helix://contracts/types/CandidateContractVerification/v1';
const MATERIAL = 'helix://contracts/types/IntakeMaterialVerification/v1';
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function envelope(ref, result, at) { return Object.freeze({ evidenceId:'libra-intake-evidence-' + canonicalDigest({ref,result}).slice(0,40),
  evidenceKind:'libra_intake_verification', producerRef:ref, basisDigest:result.basisDigest || canonicalDigest(result),
  payloadDigest:canonicalDigest(result), observedAtMs:at }); }
function outcome(ref, result, at, effectReceipt) { return Object.freeze({ kind:'succeeded',
  resultSchemaRef:BASE + ref.replace('@1','/v1/result'), result,
  evidenceSchemaRef:BASE + ref.replace('@1','/v1/evidence'), evidence:envelope(ref,result,at), ...(effectReceipt ? {effectReceipt} : {}) }); }
function committedOutcome(ref,result,evidence,effectReceipt){return Object.freeze({kind:'succeeded',
  resultSchemaRef:BASE+ref.replace('@1','/v1/result'),result,evidenceSchemaRef:BASE+ref.replace('@1','/v1/evidence'),evidence,effectReceipt});}
function candidateResult(snapshot, at) {
  const linked = snapshot?.deliverySnapshotDigest === canonicalDigest(without(snapshot,'deliverySnapshotDigest')) &&
    snapshot.offer?.candidatePackageId === snapshot.candidatePackage?.candidatePackageId &&
    snapshot.offer?.packageRevision === snapshot.candidatePackage?.packageRevision &&
    snapshot.offer?.packageDigest === snapshot.candidatePackage?.packageDigest &&
    snapshot.offer?.acceptanceBasisDigest === snapshot.acceptanceBasis?.acceptanceBasisDigest &&
    snapshot.primaryInputManifest?.manifestDigest === snapshot.candidatePackage?.primaryInputManifestRef?.manifestDigest;
  const basisDigest = snapshot?.deliverySnapshotDigest || canonicalDigest(snapshot || {});
  return Object.freeze({ schemaRef:CANDIDATE, schemaVersion:1,
    verificationId:'candidate-contract-verification-' + canonicalDigest({basisDigest}).slice(0,40),
    verificationKind:'candidate_contract', basisDigest, result:linked?'passed':'failed',
    reasonCodes:Object.freeze(linked?[]:['candidate_contract_invalid']), evidenceRefs:Object.freeze([basisDigest]), verifiedAtMs:at,
    offerId:snapshot.offer.offerId, candidatePackageId:snapshot.candidatePackage.candidatePackageId,
    packageRevision:snapshot.candidatePackage.packageRevision, packageDigest:snapshot.candidatePackage.packageDigest,
    acceptanceBasisDigest:snapshot.acceptanceBasis.acceptanceBasisDigest,
    primaryInputManifestDigest:snapshot.primaryInputManifest.manifestDigest,
    candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest });
}
async function materialResult(snapshot, handles, at, fingerprint) {
  const deliveries = [...snapshot.primaryMaterialDeliveries].sort((a,b)=>a.materialKey.localeCompare(b.materialKey));
  const byKey = new Map(handles.map((handle)=>[handle.identity.materialKey,handle]));
  const reasons = new Set(), verified = [];
  for (const item of deliveries) {
    const handle = byKey.get(item.materialKey);
    if (!handle || handle.identity.materialKey !== item.materialKey || handle.location !== item.location) {
      reasons.add('candidate_material_unavailable'); continue;
    }
    try {
      const observed = await fingerprint(handle.location);
      const identity = handle.identity;
      if (String(observed.stat.ino)!==String(identity.inode) || Number(observed.stat.size)!==identity.sizeBytes ||
          observed.contentFingerprint!==identity.contentFingerprint) { reasons.add('candidate_material_identity_changed'); continue; }
      const readHandleDigest=canonicalDigest(handle), locationEvidenceDigest=item.deliveryMemberDigest;
      verified.push(Object.freeze({materialKey:item.materialKey,bindingRevision:handle.bindingRevision,locationEvidenceDigest,
        readHandleDigest,verificationDigest:canonicalDigest({schema:'libra.intake-material-verification-item@1',
          materialKey:item.materialKey,bindingRevision:handle.bindingRevision,locationEvidenceDigest,readHandleDigest})}));
    } catch (error) {
      if (error?.code === 'PHYSICAL_MATERIAL_STAT_FENCE_CHANGED') throw error;
      reasons.add(error?.details?.causeCode === 'EACCES' ? 'candidate_material_unreadable' : 'candidate_material_unavailable');
    }
  }
  const orderedReasons=[...reasons].sort(), basisDigest=snapshot.deliverySnapshotDigest;
  return Object.freeze({ schemaRef:MATERIAL,schemaVersion:1,verificationId:'material-verification-'+canonicalDigest({basisDigest}).slice(0,40),
    verificationKind:'physical_material_reality',basisDigest,result:orderedReasons.length?'failed':'passed',reasonCodes:Object.freeze(orderedReasons),
    evidenceRefs:Object.freeze([basisDigest]),verifiedAtMs:at,candidatePackageId:snapshot.candidatePackage.candidatePackageId,
    packageDigest:snapshot.candidatePackage.packageDigest,candidateDeliverySnapshotDigest:basisDigest,
    verifiedMaterials:Object.freeze(verified),verifiedMaterialSetDigest:canonicalDigest({schema:'libra.verified-material-set@1',items:verified}) });
}
function effectReceipt(context, effectClass, effectReceiptId, output, marker, verificationEvidenceDigest, committedAtMs) {
  const effectId=canonicalDigest([effectClass,context.idempotencyKey]);
  return Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
    effectReceiptId,
    effectId,effectClass,idempotencyKey:context.idempotencyKey,commitMarker:marker,externalReceiptRef:null,
    outputDigest:canonicalDigest(output),verificationEvidenceDigest,committedAtMs});
}
function createIntakeCapabilityPorts(options) {
  if (typeof options?.computeFingerprint !== 'function') {
    throw new TypeError('Libra Intake requires a Composition-provided bounded Physical Material fingerprint port.');
  }
  const acceptance=createIntakeAcceptanceStore(options), rejection=createIntakeRejectionStore(options), now=options.now || Date.now;
  const pure=(ref,fn)=>Object.freeze({validateInputs(context){if(!context?.namedInputs)throw new TypeError(ref+' inputs are required.');},
    async execute(context){const result=await fn(context.namedInputs);return outcome(ref,result,now());},
    validateResult(_context,value){if(!value?.result)throw new TypeError(ref+' Result is absent.');}});
  return Object.freeze({
    'libra.intake.candidate.verify@1':pure('libra.intake.candidate.verify@1',({candidateDeliverySnapshot})=>candidateResult(candidateDeliverySnapshot,now())),
    'libra.intake.material.verify@1':pure('libra.intake.material.verify@1',({candidateDeliverySnapshot,physicalMaterialReadHandleList})=>
      materialResult(candidateDeliverySnapshot,physicalMaterialReadHandleList,now(),options.computeFingerprint)),
    'libra.intake.binding.resolve@1':pure('libra.intake.binding.resolve@1',({candidateDeliverySnapshot,subjectContinuityResolutionDecision})=>
      buildLibraBindingDraft(candidateDeliverySnapshot,subjectContinuityResolutionDecision,0)),
    'libra.intake.accept.commit@1':Object.freeze({validateInputs(c){if(!c?.namedInputs?.acceptedIntakePayload)throw new TypeError('Acceptance inputs are required.');},
      execute(context){const payload=context.namedInputs.acceptedIntakePayload;
        const marker='libra-intake-accepted-marker-'+canonicalDigest({decisionId:payload.intakeDecisionId,payloadDigest:payload.payloadDigest}).slice(0,40);
        const commitDigest=canonicalDigest({schema:'libra.handoff-a-accepted-commit@1',intakeDecisionId:payload.intakeDecisionId,payloadDigest:payload.payloadDigest});
        const effectReceiptId='libra-intake-effect-'+canonicalDigest({eventId:context.eventId}).slice(0,40),
          evidence=envelope('libra.intake.accept.commit@1',{basisDigest:payload.payloadDigest,intakeDecisionId:payload.intakeDecisionId},now());
        const committed=acceptance.accept({deliverySnapshot:context.__deliverySnapshot || payload.__deliverySnapshot || options.offerReader.read(payload.intakeDecisionId).snapshot,
          payload,responsibilityControlCommitHandle:context.namedInputs.responsibilityControlCommitHandle,
          commitMarker:Object.freeze({commitMarker:marker,effectId:canonicalDigest(['responsibility_control_commit',context.idempotencyKey]),commitDigest}),
          resultBinding:Object.freeze({resultId:'libra-intake-result-'+canonicalDigest({eventId:context.eventId}).slice(0,40),eventId:context.eventId,
            evidenceSchemaRef:BASE+'libra.intake.accept.commit/v1/evidence',evidence,effectReceiptId})});
        const receipt=committed.receipt;return committedOutcome('libra.intake.accept.commit@1',receipt,evidence,
          effectReceipt(context,'responsibility_control_commit',effectReceiptId,receipt,committed.commitMarker,commitDigest,receipt.committedAtMs));},
      validateResult(_c,value){if(!value?.result?.receiptDigest)throw new TypeError('Acceptance Receipt is absent.');}}),
    'libra.intake.rejection.commit@1':Object.freeze({validateInputs(c){if(!c?.namedInputs?.intakeRejectionDecision)throw new TypeError('Rejection inputs are required.');},
      execute(context){const decision=context.namedInputs.intakeRejectionDecision,read=options.offerReader.read(decision.intakeDecisionId);
        const marker=canonicalDigest({schema:'libra.intake-rejection-marker@1',decisionId:decision.intakeDecisionId,decisionDigest:decision.decisionDigest});
        const effectReceiptId='libra-intake-rejection-effect-'+canonicalDigest({eventId:context.eventId}).slice(0,40),
          evidence=envelope('libra.intake.rejection.commit@1',{basisDigest:decision.decisionDigest,intakeDecisionId:decision.intakeDecisionId},now());
        const committed=rejection.reject({deliverySnapshot:read.snapshot,reasons:decision.structuredRejection.reasons,decidedAtMs:decision.structuredRejection.decidedAtMs,
          domainFactCommitHandle:context.namedInputs.domainFactCommitHandle,
          commitMarker:Object.freeze({commitMarker:marker,effectId:canonicalDigest(['domain_fact_commit',context.idempotencyKey]),commitDigest:decision.decisionDigest}),
          resultBinding:Object.freeze({resultId:'libra-intake-rejection-result-'+canonicalDigest({eventId:context.eventId}).slice(0,40),eventId:context.eventId,
            evidenceSchemaRef:BASE+'libra.intake.rejection.commit/v1/evidence',evidence,effectReceiptId})});
        return committedOutcome('libra.intake.rejection.commit@1',committed.receipt,evidence,
          effectReceipt(context,'domain_fact_commit',effectReceiptId,committed.receipt,committed.commitMarker,decision.decisionDigest,committed.receipt.committedAtMs));},
      validateResult(_c,value){if(!value?.result?.receiptDigest)throw new TypeError('Rejection Receipt is absent.');}})
  });
}

module.exports=Object.freeze({createIntakeCapabilityPorts,candidateResult,materialResult});
