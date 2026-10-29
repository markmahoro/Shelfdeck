'use strict';

const {canonicalDigest,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {buildDecisionBasisRevision,buildDecisionInputSet,decisionHeadDigest}=require('../../../src/helix/domains/libra/model/decision-front-half-contracts');
const {buildRoutingDecision,resolveRoutingAssessment}=require('../../../src/helix/domains/libra/model/routing-contracts');
const {buildProductScope,resolveAcceptanceSpec}=require('../../../src/helix/domains/libra/model/acceptance-spec-contracts');
const {BETA_RECOMMENDED_RULES}=require('../../../src/helix/domains/arca/model/rule-template-contracts');
const {describeCustomRequirement}=require('../../../src/helix/contracts/custom-acceptance-requirements');
const {buildCustomTargetPreview,confirmCustomTarget}=require('../../../src/helix/domains/libra/model/custom-target-records');
const {buildCustomAcceptanceSpec,assertCustomAcceptanceSpec}=require('../../../src/helix/domains/libra/model/custom-acceptance-spec');
const D=canonicalDigest,signed=(value,key)=>({...value,[key]:D(value)});
function fixture(profile='movie',libraRunId='old-run',basisOverrides={}){
  const subject=signed({subjectId:'subject',status:'active',intakeRevision:1,structureKind:profile==='series'?'season':'single',contentProfile:profile,
    routingAnchorIntakeDecisionId:'intake',routingProvenance:{candidatePackageId:'candidate',sourceFieldId:'field',sourceFieldAccessRevision:1,
      sourceFieldContextDigest:D('field'),candidateIdentityClaimDigest:D('claim')},currentIdentityRevision:null,currentIdentityDigest:null,
    continuitySetDigest:D('continuity'),episodeScopeDigest:D('episode-scope')},'snapshotDigest');
  function head(revision=0,routingId=null,basisId=null){const value={subjectId:'subject',headState:revision?'present':'absent',headRevision:revision,
    headDigest:revision?decisionHeadDigest('subject',revision,routingId,basisId,null):null,currentRoutingDecisionId:routingId,
    currentDecisionBasisId:basisId,currentAcceptanceSpecId:null};return {...value,snapshotDigest:D({schema:'libra.subject-decision-head-snapshot@1',...value})};}
  const ruleSet=BETA_RECOMMENDED_RULES.profileRuleSets.find(row=>row.contentProfile===profile),
    requirements=profile==='western_adult'?ruleSet.baseRequirements:ruleSet.decisionBranches.find(row=>row.rating===5).requirements,
    standard=signed({shelfId:'shelf',standardRevision:1,ruleTemplateId:'template',ruleTemplateRevision:1,profileRuleSets:[
      signed({contentProfile:profile,decisionInputKinds:[],baseRequirements:requirements,decisionBranches:[]},'profileRuleSetDigest')]},'standardDigest'),
    routeBase={shelfId:'shelf',status:'active',routingProjectionRevision:1,currentStandardRevision:1,currentStandardDigest:standard.standardDigest},
    routeProjection={...routeBase,projectionDigest:D({schema:'arca.shelf-routing-target-projection@1',...routeBase})},expression={nodeKind:'always'},
    policy=signed({routingPolicyId:'policy',revision:1,fieldId:'field',mode:'sorting',targets:[{shelfId:'shelf',rank:1,matchExpression:expression,
      matchRuleDigest:D(expression)}]},'policyDigest'),
    routeInputs=buildDecisionInputSet({basisKind:'routing',subjectSnapshot:subject,expectedDecisionHead:head(),readiness:{result:'ready'},
      routingAuthoritySnapshot:signed({authorityKind:'policy',policy},'authorityDigest'),shelfRoutingTargets:[routeProjection],routingDecision:null,
      shelfStandardProjection:null,productScope:null,decisionFacts:[],queryResults:[]}),
    routeBasis=buildDecisionBasisRevision(routeInputs,1,100,'route-marker'),
    routing=buildRoutingDecision(resolveRoutingAssessment({...routeInputs,decisionBasisId:routeBasis.decisionBasisId}),1),
    episodeScopes=profile==='series'?[{episodeKey:'E001',seasonNumber:1,episodeNumber:1},{episodeKey:'E002',seasonNumber:1,episodeNumber:2}]:[],
    scope=buildProductScope(subject,episodeScopes.map(row=>row.episodeKey)),
    inputSet=buildDecisionInputSet({basisKind:'acceptance_spec',subjectSnapshot:subject,expectedDecisionHead:head(2,routing.routingDecisionId,routeBasis.decisionBasisId),
      readiness:{result:'ready'},routingAuthoritySnapshot:null,shelfRoutingTargets:[],routingDecision:routing,
      shelfStandardProjection:signed({shelfId:'shelf',status:'active',routingProjectionRevision:1,projectionDigest:routeProjection.projectionDigest,standard},'projectionResultDigest'),
      productScope:scope,decisionFacts:[],queryResults:[]}),basis=buildDecisionBasisRevision(inputSet,2,200,'spec-marker'),
    baseSpec=resolveAcceptanceSpec({inputSet,decisionBasis:basis,specRevision:1,producedAtMs:201,publishedAtMs:202}),
    targetBasis={subjectId:subject.subjectId,libraRunId,runState:'frozen',runStateRevision:3,runStateDigest:D('frozen'),runPackageRevisionHead:0,
      runExecutionBasisDigest:D('execution'),baseAcceptanceSpecId:baseSpec.acceptanceSpecId,baseSpecRecordDigest:baseSpec.recordDigest,
      runAcceptanceSpecId:baseSpec.acceptanceSpecId,runSpecRecordDigest:baseSpec.recordDigest,runSpecDigest:baseSpec.specDigest,
      baseSpecDigest:baseSpec.specDigest,decisionHeadDigest:D('current-head'),decisionHeadAcceptanceSpecId:baseSpec.acceptanceSpecId,shelfId:'shelf',shelfStandardDigest:standard.standardDigest,
      shelfStandardRevision:1,productScopeDigest:scope.scopeDigest,materialSetDigest:D('members'),identityDigest:D('identity'),gapEvidenceSetDigest:D('gaps'),
      customTargetRevision:0,handoffState:'no_offer',contentProfile:profile,structureKind:subject.structureKind,...basisOverrides};
  function target(changes,actorId='admin'){
    const preview=buildCustomTargetPreview({basis:targetBasis,requirements,episodeScopes,actorId,createdAtMs:1000,
      proposals:changes.map(change=>({change:describeCustomRequirement(requirements,change,episodeScopes),
        evidenceRefs:[{resultId:'actual-result',resultDigest:D('actual-evidence')}]}))}),
      intent=confirmCustomTarget({preview,expectedPreviewDigest:preview.previewDigest,currentBasis:targetBasis,
        selectedChangeDigests:preview.proposals.map(row=>row.changeDigest),actorId,idempotencyKey:'custom',acknowledged:true,confirmedAtMs:1100});
    return {preview,intent};
  }
  const build=(chosen,overrides={})=>buildCustomAcceptanceSpec({baseSpec,...chosen,specRevision:2,producedAtMs:1200,publishedAtMs:1300,...overrides});
  return {baseSpec,target,build,episodeScopes,targetBasis,inputSet,basis,routing};
}

module.exports={fixture};
