'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildDecisionBasisRevision,buildDecisionInputSet,decisionHeadDigest,inputSnapshotRows}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {buildRoutingDecision,evaluateRoutingExpression,resolveRoutingAssessment}=require('../../src/helix/domains/libra/model/routing-contracts');
const {parseNfo,parseProvider,providerCandidateSelection,observeProductIdentity}=require('../../src/helix/domains/libra/capabilities/routing-capability-ports');
const {buildProductScope,resolveAcceptanceSpec}=require('../../src/helix/domains/libra/model/acceptance-spec-contracts');

const D='a'.repeat(64);
function signed(value,field){const result={...value};result[field]=canonicalDigest(result);return result;}
function headSnapshot(subjectId,headRevision=0,currentRoutingDecisionId=null,currentDecisionBasisId=null,currentAcceptanceSpecId=null){
  const headState=headRevision===0?'absent':'present',headDigest=headRevision===0?null:decisionHeadDigest(subjectId,headRevision,currentRoutingDecisionId,currentDecisionBasisId,currentAcceptanceSpecId);
  const value={subjectId,headState,headRevision,headDigest,currentRoutingDecisionId,currentDecisionBasisId,currentAcceptanceSpecId};
  value.snapshotDigest=canonicalDigest({schema:'libra.subject-decision-head-snapshot@1',...value});return value;
}
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
function routingInput(authority,targets,facts){return {basisKind:'routing',subjectSnapshot:subject(),expectedDecisionHead:headSnapshot('subject-1'),readiness:{result:'ready'},routingAuthoritySnapshot:authority,
  shelfRoutingTargets:targets,routingDecision:null,shelfStandardProjection:null,productScope:null,decisionFacts:facts,queryResults:[]};}

test('freezes Decision Input, relation snapshots, Basis identity, and first Decision head',()=>{
  const expression={nodeKind:'predicate',factKind:'content_profile',operator:'eq',expectedValue:'movie'};
  const set=buildDecisionInputSet(routingInput(policyAuthority([{shelfId:'shelf-1',expression}]),[projection('shelf-1')],[routingFact('content_profile','movie')]));
  assert.equal(set.routingInputDigest.length,64);assert.equal(set.specInputDigest,null);assert.equal(inputSnapshotRows(set).length,5);
  assert.equal(inputSnapshotRows(set)[1].inputKind,'decision_head_snapshot');assert.equal(inputSnapshotRows(set)[1].inputRevision,0);
  const basis=buildDecisionBasisRevision(set,1,100,'marker-basis-1');assert.equal(basis.decisionBasisId.length,64);assert.equal(basis.factDigest,basis.basisDigest);
  assert.equal(basis.expectedHeadSnapshotDigest,set.expectedDecisionHead.snapshotDigest);
  assert.equal(decisionHeadDigest('subject-1',1,null,basis.decisionBasisId,null).length,64);
});

test('stops at unknown higher-priority policy rule and never falls through',()=>{
  const unknown={nodeKind:'predicate',factKind:'release_year',operator:'gte',expectedValue:2000};
  const always={nodeKind:'always'};const set=buildDecisionInputSet(routingInput(policyAuthority([{shelfId:'shelf-1',expression:unknown},{shelfId:'shelf-2',expression:always}]),
    [projection('shelf-1'),projection('shelf-2')],[routingFact('content_profile','movie')]));
  const basis=buildDecisionBasisRevision(set,1,100,'marker-basis-1');const assessment=resolveRoutingAssessment({...set,decisionBasisId:basis.decisionBasisId});
  assert.equal(assessment.result,'unresolved');assert.equal(assessment.unresolvedReasonCode,'higher_priority_rule_unknown');assert.equal(assessment.evaluatedTargets.length,1);
});

test('treats an inactive higher-priority Shelf as unresolved and never falls through',()=>{
  const always={nodeKind:'always'};
  const set=buildDecisionInputSet(routingInput(
    policyAuthority([{shelfId:'shelf-1',expression:always},{shelfId:'shelf-2',expression:always}]),
    [projection('shelf-1','deregistered'),projection('shelf-2')],
    [routingFact('content_profile','movie')],
  ));
  const basis=buildDecisionBasisRevision(set,1,100,'marker-inactive');
  const assessment=resolveRoutingAssessment({...set,decisionBasisId:basis.decisionBasisId});
  assert.equal(assessment.result,'unresolved');
  assert.equal(assessment.unresolvedReasonCode,'higher_priority_rule_unknown');
  assert.equal(assessment.evaluatedTargets.length,1);
  assert.equal(assessment.evaluatedTargets[0].shelfId,'shelf-1');
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

function typedRoutingFact(kind,body){return signed({factKind:kind,sourceObjectId:'source-1',sourceRevision:1,schemaRef:'RoutingDecisionFact@1',...body},'factDigest');}
function predicate(factKind,operator,expectedValue){return {nodeKind:'predicate',factKind,operator,expectedValue};}

test('evaluates the complete Routing Fact operator vocabulary without coercion',()=>{
  const year=typedRoutingFact('release_year',{year:2014});
  assert.equal(evaluateRoutingExpression(predicate('release_year','eq',2014),[year]),'true');
  assert.equal(evaluateRoutingExpression(predicate('release_year','one_of',[1989,2014]),[year]),'true');
  assert.equal(evaluateRoutingExpression(predicate('release_year','gte',2020),[year]),'false');
  assert.equal(evaluateRoutingExpression(predicate('release_year','lte',2014),[year]),'true');
  assert.equal(evaluateRoutingExpression(predicate('release_year','exists',true),[year]),'true');

  const region=typedRoutingFact('region',{countryCodes:['CN','JP']});
  assert.equal(evaluateRoutingExpression(predicate('region','eq',['JP','CN']),[region]),'true');
  assert.equal(evaluateRoutingExpression(predicate('region','one_of',['US','JP']),[region]),'true');
  assert.equal(evaluateRoutingExpression(predicate('region','one_of',['US']),[region]),'false');

  const identityValue={provider:'tmdb',namespace:'tmdb_movie',providerKey:'123',identityRevision:1};
  identityValue.identityDigest=canonicalDigest(identityValue);
  const identity=typedRoutingFact('resolved_provider_identity',identityValue);
  assert.equal(evaluateRoutingExpression(predicate('resolved_provider_identity','eq',identityValue),[identity]),'true');
  assert.equal(evaluateRoutingExpression(predicate('resolved_provider_identity','one_of',[identityValue]),[identity]),'true');
  assert.equal(evaluateRoutingExpression(predicate('release_year','exists',false),[]),'unknown');
  assert.equal(evaluateRoutingExpression(predicate('release_year','eq',2014),[year,year]),'unknown');
});

function observationIntent(sourceKind,requestedFactKinds){return {intentId:'intent-1',intentDigest:D,subjectId:'subject-1',sourceKind,
  relatedReferenceId:sourceKind==='related_nfo'?'related-1':null,candidateDisplayTitle:'0.5毫米',yearHint:null,strongProviderAnchor:null,
  requestedFactKinds};}

test('classifies bounded NFO Routing observations as observed, absent, or ambiguous',()=>{
  const handle={location:'C:/fixture/movie.nfo',bindingRevision:7};
  const observed=parseNfo(observationIntent('related_nfo',['release_year','region','genre','resolved_provider_identity']),
    '<movie><year>1989</year><countrycode>CN</countrycode><genre>Drama</genre><tmdbid>42</tmdbid></movie>',handle);
  assert.equal(observed.result,'observed');
  assert.deepEqual(observed.facts.map((fact)=>fact.factKind),['release_year','region','genre','resolved_provider_identity']);
  assert.equal(parseNfo(observationIntent('related_nfo',['release_year']),'<movie><title>Unknown</title></movie>',handle).result,'not_found');
  assert.equal(parseNfo(observationIntent('related_nfo',['release_year']),'<movie><year>1989</year><releasedate>2025-01-01</releasedate></movie>',handle).result,'ambiguous');
  assert.throws(()=>parseNfo(observationIntent('related_nfo',['release_year']),'not xml',handle),(error)=>error.code==='LIBRA_ROUTING_NFO_PROTOCOL');
});

test('accepts only a unique deterministic Provider match and keeps protocol failures technical',()=>{
  const intent=observationIntent('provider',['release_year','resolved_provider_identity']);
  const handle={integrationId:'tmdb-test',configRevision:3};
  const unique=[{providerKey:'100',title:'0.5毫米',originalTitle:'0.5 mm',releaseYear:2014,regionCodes:['JP'],genreCodes:['drama']}];
  const observed=parseProvider(intent,unique,handle);
  assert.equal(observed.result,'observed');assert.equal(observed.candidateMatchCount,1);
  assert.equal(parseProvider(intent,[],handle).result,'not_found');
  const ambiguous=[...unique,{...unique[0],providerKey:'101'}];
  assert.equal(parseProvider(intent,ambiguous,handle).result,'ambiguous');
  assert.throws(()=>providerCandidateSelection(intent,[unique[0],unique[0]]),(error)=>error.code==='LIBRA_ROUTING_PROVIDER_PROTOCOL');
});

function nfoIdentityIntent(title, yearHint) {
  return {
    intentId:'intent-nfo-identity',
    libraRunId:'run-1',
    subjectId:'subject-1',
    sourceKind:'related_nfo',
    relatedReferenceId:'related-1',
    contentProfile:'movie',
    associationKind:'nfo_claim',
    aliases:[{ value:title }],
    yearHint,
    intentDigest:D,
  };
}

test('NFO actor TMDB person IDs do not conflict with the unique movie identity', async () => {
  const xml = [
    '<movie>',
    '<title>007：大破天幕杀机</title>',
    '<year>2012</year>',
    '<tmdbid>37724</tmdbid>',
    '<uniqueid type="tmdb">37724</uniqueid>',
    '<actor><name>Daniel Craig</name><tmdbid>8784</tmdbid></actor>',
    '<actor><name>Judi Dench</name><tmdbid>5309</tmdbid></actor>',
    '<set><name>James Bond Collection</name><tmdbid>645</tmdbid></set>',
    '</movie>',
  ].join('');
  const parsed = parseNfo(observationIntent('related_nfo', ['release_year', 'resolved_provider_identity']),
    xml, { location:'C:/fixture/skyfall.nfo', bindingRevision:1 });
  assert.equal(parsed.result, 'observed');
  assert.equal(parsed.facts.find((item) => item.factKind === 'resolved_provider_identity').providerKey, '37724');
  assert.equal(parsed.facts.find((item) => item.factKind === 'release_year').year, 2012);
  const observation = await observeProductIdentity({
    readRelatedNfo: async () => xml,
    observeRoutingProvider: async () => { throw new Error('must not search TMDB when NFO already has a unique movie ID'); },
  }, nfoIdentityIntent('007：大破天幕杀机', 2012), { location:'C:/fixture/skyfall.nfo', bindingRevision:1 });
  assert.equal(observation.result, 'resolved');
  assert.equal(observation.verifiedIdentity.providerKey, '37724');
  assert.equal(observation.candidates.length, 0);
});

test('NFO with multiple movie-level TMDB IDs exposes those identities as user-confirmable candidates', async () => {
  const observation = await observeProductIdentity({
    readRelatedNfo: async () => '<movie><title>Demo</title><tmdbid>11</tmdbid><uniqueid type="tmdb">22</uniqueid></movie>',
    observeRoutingProvider: async () => { throw new Error('must not search TMDB when NFO already has multiple IDs'); },
  }, nfoIdentityIntent('Demo', 2016), { location:'C:/fixture/movie.nfo', bindingRevision:1 });
  assert.equal(observation.result, 'ambiguous');
  assert.equal(observation.reasonCode, 'nfo_association_conflicting');
  assert.deepEqual(observation.candidates.map((item) => item.providerKey).sort(), ['11', '22']);
});

test('keeps the Routing Process Coordinator outside planning and execution infrastructure',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../src/helix/domains/libra/application/routing-process-coordinator.js'),'utf8');
  for(const forbidden of ['/capabilities/','/planning/','event-runtime','resource-governor','executor-dispatcher','capability-registry'])
    assert.equal(source.includes(forbidden),false,'Routing Coordinator imports forbidden execution concern: '+forbidden);
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
  const expectedDecisionHead=headSnapshot('subject-1',2,routing.routingDecisionId,rbasis.decisionBasisId,null);
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
