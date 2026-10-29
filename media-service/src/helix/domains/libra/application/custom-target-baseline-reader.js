'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buildDecisionInputSet}=require('../model/decision-front-half-contracts');
const {buildProductScope,resolveCurrentRequirements}=require('../model/acceptance-spec-contracts');

function fail(){throw Object.assign(new Error('Current custom target Owner projection is invalid.'),{code:'LIBRA_CUSTOM_TARGET_BASELINE_INVALID'});}

// Both dependencies are public Owner projections. The caller captures the
// Foundation opaque fence before this read and Admission verifies it later.
function createCustomTargetBaselineReader(options){
  if(typeof options?.acceptanceSpecContextReader?.read!=='function'||typeof options.readHandoffResponsibility!=='function')
    throw new TypeError('Custom target baseline requires current Spec and Arca responsibility projections.');
  return Object.freeze({read(request){
    if(typeof request?.subjectId!=='string'||!request.subjectId||typeof request.libraRunId!=='string'||!request.libraRunId||
        !/^[a-f0-9]{64}$/.test(request.productScopeDigest||''))fail();
    const context=options.acceptanceSpecContextReader.read(request.subjectId,request.libraRunId);
    if(!context||!['ready','current','basis_ready'].includes(context.kind)||!context.inputSet)
      return Object.freeze({kind:'unavailable',reasonCode:'standard_or_perception_pending'});
    const input=buildDecisionInputSet(context.inputSet);
    if(canonicalJson(input)!==canonicalJson(context.inputSet)||input.basisKind!=='acceptance_spec'||input.readiness.result!=='ready')fail();
    const subject=input.subjectSnapshot,scope=input.productScope,projection=input.shelfStandardProjection,routing=input.routingDecision;
    if(subject.subjectId!==request.subjectId||!scope||!projection||!routing||routing.targetShelfId!==projection.shelfId||
        canonicalJson(buildProductScope(subject,scope.episodeKeys))!==canonicalJson(scope))fail();
    if(scope.scopeDigest!==request.productScopeDigest)
      return Object.freeze({kind:'unavailable',reasonCode:'product_scope_changed'});
    if(!/^[a-f0-9]{64}$/.test(subject.currentIdentityDigest||''))
      return Object.freeze({kind:'unavailable',reasonCode:'current_identity_pending'});
    const requirements=resolveCurrentRequirements(input),standard=projection.standard,
      standardSpecDigest=canonicalDigest({schema:'libra.acceptance-spec-semantic@1',targetShelfId:routing.targetShelfId,
        contentProfile:subject.contentProfile,structureKind:subject.structureKind,
        productScope:{scopeKind:scope.scopeKind,episodeKeys:scope.episodeKeys},requirements}),
      responsibility=options.readHandoffResponsibility(Object.freeze({subjectId:request.subjectId,libraRunId:request.libraRunId,
        productScopeDigest:scope.scopeDigest}));
    if(!responsibility||responsibility.kind!=='ready')
      return Object.freeze({kind:'unavailable',reasonCode:'handoff_responsibility_pending'});
    if(responsibility.subjectId!==request.subjectId||responsibility.libraRunId!==request.libraRunId||
        responsibility.productScopeDigest!==scope.scopeDigest||!['no_offer','not_accepted','accepted'].includes(responsibility.handoffState))fail();
    return Object.freeze({kind:'ready',subjectId:subject.subjectId,productScopeDigest:scope.scopeDigest,standardSpecDigest,
      shelfId:projection.shelfId,shelfStandardRevision:standard.standardRevision,shelfStandardDigest:standard.standardDigest,
      identityDigest:subject.currentIdentityDigest,handoffState:responsibility.handoffState});
  }});
}

module.exports=Object.freeze({createCustomTargetBaselineReader});
