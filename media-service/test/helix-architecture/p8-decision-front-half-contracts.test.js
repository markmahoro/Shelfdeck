'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildDecisionBasisRevision,buildDecisionInputSet,decisionHeadDigest,inputSnapshotRows}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {buildRoutingDecision,evaluateRoutingExpression,resolveRoutingAssessment}=require('../../src/helix/domains/libra/model/routing-contracts');
const {buildProductScope,resolveAcceptanceSpec}=require('../../src/helix/domains/libra/model/acceptance-spec-contracts');

const D='a'.repeat(64);
function signed(value,field){const result={...value};result[field]=canonicalDigest(result);return result;}
function subject(){return signed({subjectId:'subject-1',status:'active',intakeRevision:1,structureKind:'single',contentProfile:'movie',
  routingAnchorIntakeDecisionId:'intake-1',routingProvenance:{candidatePackageId:'candidate-1',sourceFieldId:'field-1',sourceFieldAccessRevision:2,
    sourceFieldContextDigest:D,candidateIdentityClaimDigest:'b'.repeat(64)},currentIdentityRevision:null,currentIdentityDigest:null,
  continuitySetDigest:'c'.repeat(64),episodeScopeDigest:'d'.repeat(64)},'snapshotDigest');}
function projection(shelfId,status='active'){const currentStandardRevision=status==='active'?1:null,currentStandardDigest=status==='active'?'e'.repeat(64):null;
  const value={shelfId,status,routingProjectionRevision:1,currentStandardRevision,currentStandardDigest};value.projectionDigest=canonicalDigest({schema:'arca.shelf-routing-target-projection@1',...value});return value;}
function routingFact(kind,value){return signed({factKind:kind,sourceObjectId:'subject-1',sourceRevision:1,schemaRef:'RoutingDecisionFact@1',value},'factDigest');}
function policyAuthority(targets){const policyTargets=targets.map((item,index)=>{const matchExpression=item.expression;return {shelfId:item.shelfId,rank:index+1,matchExpression,matchRuleDigest:canonicalDigest(matchExpression)};});
  const policy=signed({routingPolicyId:'policy-1',revision:3,fieldId:'field-1',mode:'sorting',targets:policyTargets},'policyDigest');
  return signed({authorityKind:'policy',policy},'authorityDigest');}
function routingInput(authority,targets,facts){return {basisKind:'routing',subjectSnapshot:subject(),expectedDecisionHead:{revision:0,digest:null,
  currentRoutingDecisionId:null,currentDecisionBasisId:null,currentAcceptanceSpecId:null},readiness:{result:'ready'},routingAuthoritySnapshot:authority,
  shelfRoutingTargets:targets,routingDecision:null,shelfStandardProjection:null,productScope:null,decisionFacts:facts,queryResults:[]};}

test('freezes Decision Input, relation snapshots, Basis identity, and first Decision head',()=>{
  const expression={nodeKind:'predicate',factKind:'content_profile',operator:'eq',expectedValue:'movie'};
  const set=buildDecisionInputSet(routingInput(policyAuthority([{shelfId:'shelf-1',expression}]),[projection('shelf-1')],[routingFact('content_profile','movie')]));
  assert.equal(set.routingInputDigest.length,64);assert.equal(set.specInputDigest,null);assert.equal(inputSnapshotRows(set).length,4);
  const basis=buildDecisionBasisRevision(set,1,100,'marker-basis-1');assert.equal(basis.decisionBasisId.length,64);assert.equal(basis.factDigest,basis.basisDigest);
  assert.equal(decisionHeadDigest('subject-1',1,null,basis.decisionBasisId,null).length,64);
});

test('stops at unknown higher-priority policy rule and never falls through',()=>{
  const unknown={nodeKind:'predicate',factKind:'release_year',operator:'gte',expectedValue:2000};
  const always={nodeKind:'always'};const set=buildDecisionInputSet(routingInput(policyAuthority([{shelfId:'shelf-1',expression:unknown},{shelfId:'shelf-2',expression:always}]),
    [projection('shelf-1'),projection('shelf-2')],[routingFact('content_profile','movie')]));
  const basis=buildDecisionBasisRevision(set,1,100,'marker-basis-1');const assessment=resolveRoutingAssessment({...set,decisionBasisId:basis.decisionBasisId});
  assert.equal(assessment.result,'unresolved');assert.equal(assessment.unresolvedReasonCode,'higher_priority_rule_unknown');assert.equal(assessment.evaluatedTargets.length,1);
});

test('resolves the first true target and produces one immutable Routing Decision',()=>{
  const first={nodeKind:'predicate',factKind:'content_profile',operator:'eq',expectedValue:'series'},second={nodeKind:'always'};
  const set=buildDecisionInputSet(routingInput(policyAuthority([{shelfId:'shelf-1',expression:first},{shelfId:'shelf-2',expression:second}]),
    [projection('shelf-1'),projection('shelf-2')],[routingFact('content_profile','movie')]));
  const basis=buildDecisionBasisRevision(set,1,100,'marker-basis-1'),assessment=resolveRoutingAssessment({...set,decisionBasisId:basis.decisionBasisId});
  const decision=buildRoutingDecision(assessment,1);assert.equal(decision.result,'resolved');assert.equal(decision.targetShelfId,'shelf-2');assert.equal(decision.decisionDigest.length,64);
});

test('uses closed three-valued AST semantics',()=>{
  const expression={nodeKind:'all',children:[{nodeKind:'predicate',factKind:'content_profile',operator:'eq',expectedValue:'movie'},
    {nodeKind:'predicate',factKind:'release_year',operator:'gte',expectedValue:2000}].sort((a,b)=>canonicalDigest(a).localeCompare(canonicalDigest(b)))};
  assert.equal(evaluateRoutingExpression(expression,[routingFact('content_profile','movie')]),'unknown');
});

function requirements(){return {identity:{identityKind:'tmdb_movie',requiredProvider:'tmdb',requireSeasonNumber:false},
  structure:{structureKind:'single',primaryModel:'single_primary',requireOnePrimaryPerEpisode:false},
  metadata:{requiredFieldCodes:['title'],requiredArtifactKinds:['nfo'],requireRenderableSidecar:true,requireDecodableImages:true},
  mandatoryMedia:{mediaForm:'stream_file',videoCodec:'any',container:'any',fileExtension:'any',minimumRasterClass:'none',acceptedPrimaryAudioClasses:[],forbidSystemUpscaleFor4k:true},
  space:{unit:'product',maxSizeGiB:null,maxSizeBytes:null},inventory:{requireDomainBinding:true,requireChecksum:true,requiredMaterializedArtifactKinds:['nfo'],layoutModel:'single'}};}
function standardProjection(shelfId){const profile=signed({contentProfile:'movie',decisionInputKinds:[],baseRequirements:requirements(),decisionBranches:[]},'profileRuleSetDigest');
  const standard=signed({shelfId,standardRevision:1,ruleTemplateId:'template-1',ruleTemplateRevision:1,profileRuleSets:[profile]},'standardDigest');
  const route=projection(shelfId);return signed({shelfId,status:'active',routingProjectionRevision:route.routingProjectionRevision,projectionDigest:route.projectionDigest,standard},'projectionResultDigest');}

test('publishes a six-class Acceptance Spec from the exact ready Basis',()=>{
  const expression={nodeKind:'always'},rset=buildDecisionInputSet(routingInput(policyAuthority([{shelfId:'shelf-1',expression}]),[projection('shelf-1')],[]));
  const rbasis=buildDecisionBasisRevision(rset,1,100,'basis-1'),assessment=resolveRoutingAssessment({...rset,decisionBasisId:rbasis.decisionBasisId});
  const routing=buildRoutingDecision(assessment,1),snapshot=subject(),scope=buildProductScope(snapshot,[]);
  const expectedDecisionHead={revision:2,digest:decisionHeadDigest('subject-1',2,routing.routingDecisionId,rbasis.decisionBasisId,null),
    currentRoutingDecisionId:routing.routingDecisionId,currentDecisionBasisId:rbasis.decisionBasisId,currentAcceptanceSpecId:null};
  const inputSet=buildDecisionInputSet({basisKind:'acceptance_spec',subjectSnapshot:snapshot,expectedDecisionHead,readiness:{result:'ready'},
    routingAuthoritySnapshot:null,shelfRoutingTargets:[],routingDecision:routing,shelfStandardProjection:standardProjection('shelf-1'),productScope:scope,decisionFacts:[],queryResults:[]});
  const basis=buildDecisionBasisRevision(inputSet,2,200,'basis-2');const spec=resolveAcceptanceSpec({inputSet,decisionBasis:basis,specRevision:1,producedAtMs:201,publishedAtMs:202});
  assert.equal(spec.contentProfile,'movie');assert.deepEqual(Object.keys(spec.requirements).sort(),['identity','inventory','mandatoryMedia','metadata','space','structure']);
  assert.equal(spec.acceptanceSpecId.length,64);assert.equal(spec.recordDigest.length,64);
});

test('rejects season as a content profile and incomplete Requirement classes',()=>{
  const invalid=subject();invalid.contentProfile='season';invalid.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(invalid).filter(([key])=>key!=='snapshotDigest')));
  assert.throws(()=>buildProductScope(invalid,[]),/frozen Subject snapshot/);
  const value=requirements();delete value.inventory;assert.throws(()=>require('../../src/helix/domains/libra/model/acceptance-spec-contracts').validateRequirements(value,'movie','single'),/exactly six/);
});
