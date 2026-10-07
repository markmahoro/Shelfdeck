'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { createRoutingContextReader } = require('../../src/helix/domains/libra/application/routing-context-reader');
const { parseNfo, parseProvider } = require('../../src/helix/domains/libra/capabilities/routing-capability-ports');
const { createTmdbProviderAdapter } = require('../../src/helix/integrations/tmdb-provider-adapter');
const { createMaterialFieldStore } = require('../../src/helix/domains/procurement/persistence/material-field-store');
const { createFieldObservationAdminService } = require('../../src/helix/domains/procurement/application/field-observation-admin-service');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { assertProbeEvidence } = require('../../src/helix/domains/libra/model/media-production-contracts');
const {createRepositoryDefinition}=require('../../src/helix/foundation/persistence/owner-repository');
const {createOnDeckStore}=require('../../src/helix/domains/arca/persistence/on-deck-store');
const { createMovieProductionReader } = require('../../src/helix/domains/libra/persistence/movie-production-reader');

const D = value => canonicalDigest({ value });
const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const operationId = 'libra.routing.fact.observe@1';
function handle(operation = operationId) {
  return { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1, handleId:'series-routing-handle',
    integrationId:'tmdb-main', integrationType:'tmdb', configRevision:1, secretRef:'fixture-secret',
    allowedOperation:operation, expiresAtMs:Number.MAX_SAFE_INTEGER, fenceDigest:D(operation) };
}
function context(profile = 'series') {
  const seasonClaim = { claimKind:'explicit_number', seasonNumber:1 };
  seasonClaim.claimDigest = canonicalDigest(seasonClaim);
  return { subject:{subjectId:'subject-1',contentProfile:profile,structureKind:profile==='series'?'season':'single',
      routingAnchorIntakeDecisionId:'intake-1',routingProvenance:{decisionIdentityEvidenceDigest:D('anchor')}},
    deliverySnapshot:{deliverySnapshotDigest:D('delivery'),candidatePackage:{
      identityClaim:{schemaRef:'helix://contracts/types/IdentityClaim/v1',schemaVersion:1,draftId:'claim-1',
        draftKind:'identity_claim',basisDigest:D('basis'),draftDigest:D('draft'),producedAtMs:1,
        claimKind:profile==='series'?'series_season':'movie_title',contentProfile:profile,mediaType:profile==='series'?'group':'single',
        claimedTitle:'Demo Show',displayIdentity:'Demo Show',claimedYear:'2020',identityMetadataDigest:D('metadata'),
        structureUnitDigest:D('structure'),sourceHints:[],claimDigest:D('claim'),...(profile==='series'?{seasonClaim}:{})},
      relatedReferences:[{role:'nfo',referenceId:'show-nfo',referenceDigest:D('reference'),
        identity:{sizeBytes:10},endpointId:'endpoint-1',location:'/source/tvshow.nfo'}]}} };
}
function reader() {
  return createRoutingContextReader({schemaManifest,unitOfWork:{execute(){throw Error('Unexpected persistence read.');}},
    readArcaRoutingTargets:()=>[]});
}
function intent(source = 'provider', kinds = ['release_year']) {
  return reader().factObservationIntent(context(),source,kinds);
}
function harness(overrides = {}) {
  const calls = [];
  const adapter = createTmdbProviderAdapter({
    integrationQueryPort:{query:()=>({state:'active',integrationType:'tmdb',integrationId:'tmdb-main',
      configRevision:1,endpoint:'https://api.themoviedb.org/3',secretKind:'tmdb_access_token',secretRef:'fixture-secret',
      settings:{language:'zh-CN'}})},
    integrationHandleResolverPort:{resolve:request=>handle(request.allowedOperation)},
    secretLeaseResolverPort:{resolve:()=>({leaseId:'fixture-lease'})},
    secretLeaseConsumer:{consumeAsync:async(_lease,consume)=>consume(Buffer.from('disposable-secret'))},
    fetchImpl:async url=>{
      calls.push(url);
      if(overrides.error)throw overrides.error;
      const search=url.pathname.endsWith('/search/tv'),season=url.pathname.includes('/season/'),episode=url.pathname.includes('/episode/');
      const episodeNumber=Number(url.pathname.split('/').at(-1));
      const result=search?(overrides.search??{results:[{id:1399,name:'Demo Show'}]}):episode?
        {id:63055+episodeNumber,season_number:1,episode_number:episodeNumber,name:'Episode '+episodeNumber,
          overview:'Episode '+episodeNumber+' plot',air_date:'2020-01-01'}:season?
        (overrides.season??{id:3624,season_number:1}):(overrides.show??{
          id:1399,name:'Demo Show',original_name:'Demo Show',first_air_date:'2020-01-01',
          origin_country:['US'],genres:[{id:18,name:'Drama'}],overview:'Series plot',
          credits:{cast:[{id:1001,name:'Fixture Actor'}],crew:[]}});
      return new Response(JSON.stringify(result),{status:season?(overrides.seasonStatus??200):200});
    },
  });
  const observe = ({intent:value,integrationHandle,operationId:operation=operationId}) => adapter.observationPort.execute({
    operationId:operation,integrationHandle,timeoutMs:1000,input:{contentProfile:value.contentProfile,
      title:value.candidateDisplayTitle,yearHint:value.yearHint,strongProviderKey:value.strongProviderAnchor?.providerKey??null,
      seasonNumber:value.seasonNumber}});
  const fetchMetadata=({metadataFetchIntent:value,integrationHandle})=>adapter.observationPort.execute({
    operationId:'libra.product_metadata.fetch@1',integrationHandle,timeoutMs:1000,input:{
      resolvedProviderIdentity:value.resolvedProviderIdentity,requestedFields:value.requestedFields,
      ...(value.episodeScope?{episodeScope:value.episodeScope}:{})}});
  return {calls,observe,fetchMetadata};
}
function validator() {
  const contracts = path.resolve(__dirname, '../../src/helix/contracts');
  const schemas = ['types','domain-types','application-types'].flatMap(group=>
    fs.readdirSync(path.join(contracts,group)).map(name=>{
      const root=path.join(contracts,group,name),version=fs.readdirSync(root).find(entry=>/^v[0-9]+$/.test(entry));
      return JSON.parse(fs.readFileSync(path.join(root,version,'schema.json'),'utf8'));
    }));
  return createCapabilityContractValidator({schemas});
}

test('Routing Owner freezes the accepted Series profile and Season on both source intents',()=>{
  for(const source of ['provider','related_nfo']) {
    const value=intent(source),{intentId,intentDigest,...body}=value;
    assert.equal(value.contentProfile,'series');assert.equal(value.seasonNumber,1);
    assert.equal(intentDigest,canonicalDigest(body));
    assert.equal(intentId,canonicalDigest({schema:'libra.routing-fact-observation-intent-id@1',
      subjectId:body.subjectId,sourceKind:body.sourceKind,intentDigest}));
  }
  const movie=reader().factObservationIntent(context('movie'),'provider',['release_year']);
  assert.equal(movie.contentProfile,'movie');assert.equal(Object.hasOwn(movie,'seasonNumber'),false);
});
for(const mutation of ['number','digest','profile','structure']) test('Routing rejects a stale frozen Season '+mutation,()=>{
  const value=context();
  if(mutation==='number')value.deliverySnapshot.candidatePackage.identityClaim.seasonClaim.seasonNumber=2;
  if(mutation==='digest')value.deliverySnapshot.candidatePackage.identityClaim.seasonClaim.claimDigest=D('foreign');
  if(mutation==='profile')value.deliverySnapshot.candidatePackage.identityClaim.contentProfile='movie';
  if(mutation==='structure')value.subject.structureKind='single';
  assert.throws(()=>reader().factObservationIntent(value,'provider',['release_year']),/exact frozen positive Season/);
});

test('Actual Routing Adapter queries TV and verifies Season before publishing requested facts',async()=>{
  const value=intent('provider',['genre','region','release_year','resolved_provider_identity']),adapter=harness();
  const observed=parseProvider(value,await adapter.observe({intent:value,integrationHandle:handle()}),handle());
  assert.deepEqual(adapter.calls.map(url=>url.pathname),['/3/search/tv','/3/tv/1399','/3/tv/1399/season/1']);
  assert.equal(adapter.calls[0].searchParams.get('first_air_date_year'),'2020');
  assert.equal(observed.result,'observed');
  assert.deepEqual(observed.facts.map(fact=>fact.factKind),value.requestedFactKinds);
  assert.equal(observed.facts.find(fact=>fact.factKind==='resolved_provider_identity').namespace,'tmdb_series');
  validator().validate('helix://contracts/types/RoutingFactObservation/v1',observed);
});
for(const [name,overrides,code] of [
  ['Movie object',{show:{id:1399,title:'Demo Show'}},'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID'],
  ['foreign TV',{show:{id:1400,name:'Demo Show'}},'PLATFORM_TMDB_IDENTITY_MISMATCH'],
  ['foreign Season',{season:{id:3624,season_number:2}},'PLATFORM_TMDB_IDENTITY_MISMATCH'],
  ['invalid JSON schema',{season:{season_number:1}},'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID'],
  ['transport failure',{error:new Error('fixture transport failed')},'PLATFORM_INTEGRATION_NETWORK_FAILED'],
]) test('Routing preserves technical failure for '+name,async()=>{
  const adapter=harness(overrides);
  await assert.rejects(adapter.observe({intent:intent(),integrationHandle:handle()}),{code});
});
test('Absent Season and title/year mismatch remain unresolved business observations',async()=>{
  for(const overrides of [{seasonStatus:404},{show:{id:1399,name:'Foreign title',first_air_date:'2020-01-01'}},
    {show:{id:1399,name:'Demo Show',first_air_date:'2021-01-01'}}]) {
    const value=intent(),adapter=harness(overrides);
    assert.equal(parseProvider(value,await adapter.observe({intent:value,integrationHandle:handle()}),handle()).result,'not_found');
  }
});
test('Series Routing refuses a raw Provider result from another namespace or Season',()=>{
  for(const candidate of [{namespace:'tmdb_movie',seasonNumber:1},{namespace:'tmdb_series',seasonNumber:2}]) {
    assert.throws(()=>parseProvider(intent(),[{providerKey:'1399',title:'Demo Show',releaseYear:2020,...candidate}],handle()),
      {code:'LIBRA_ROUTING_PROVIDER_PROTOCOL'});
  }
});
test('Series NFO Routing observes only show-level facts and never Episode or actor identity',()=>{
  const value=intent('related_nfo',['genre','region','release_year','resolved_provider_identity']);
  const observed=parseNfo(value,'<tvshow><title>Demo Show</title><year>2020</year><season>1</season><genre>Drama</genre>'+
    '<country>US</country><uniqueid type="tmdb">1399</uniqueid><actor><year>1990</year><tmdbid>400</tmdbid></actor>'+
    '<episodedetails><year>2021</year><season>2</season><tmdbid>500</tmdbid></episodedetails></tvshow>',
    {location:'/source/tvshow.nfo',bindingRevision:1});
  assert.equal(observed.result,'observed');assert.equal(observed.facts.find(fact=>fact.factKind==='release_year').year,2020);
  assert.equal(observed.facts.find(fact=>fact.factKind==='resolved_provider_identity').providerKey,'1399');
  validator().validate('helix://contracts/types/RoutingFactObservation/v1',observed);
  for(const xml of ['<episodedetails><year>2020</year><tmdbid>500</tmdbid></episodedetails>',
    '<tvshow><season>2</season><year>2020</year></tvshow>','<!DOCTYPE tvshow><tvshow><year>2020</year></tvshow>']) {
    const absent=parseNfo(value,xml,{location:'/source/tvshow.nfo',bindingRevision:1});
    assert.equal(absent.result,'not_found');assert.deepEqual(absent.facts,[]);
  }
});
test('Closed Routing schemas retain Movie shape and fence Series profile, Season and Provider namespace',()=>{
  const v=validator(),ref='helix://contracts/domain-types/RoutingFactObservationIntent/v1';
  for(const source of ['provider','related_nfo'])v.validate(ref,intent(source));
  const movie=reader().factObservationIntent(context('movie'),'provider',['release_year']);
  v.validate(ref,movie);
  for(const mutation of [{seasonNumber:0},{seasonNumber:undefined},{contentProfile:'movie'},
    {strongProviderAnchor:{provider:'tmdb',namespace:'tmdb_movie',providerKey:'1399'}}])
    assert.throws(()=>v.validate(ref,{...intent(),...mutation}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  assert.throws(()=>v.validate(ref,{...movie,seasonNumber:1}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
});

function mediaProbe() {
  return {async probe(readHandle) {
    const body={resultKind:'probed',sourceHandleDigest:canonicalDigest(readHandle),durationMs:1000,
      videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],
      audioStreams:[],subtitleStreams:[],discTopology:null};
    return {...body,payloadDigest:canonicalDigest(body)};
  }};
}
for(const {episodeCount,append,anchored,concurrent,bounded} of [{episodeCount:2,bounded:true},{episodeCount:2},{episodeCount:24},{episodeCount:2,append:true},{episodeCount:2,append:true,anchored:true},{episodeCount:2,anchored:true,concurrent:true}]) test('Isolated Host schedules '+episodeCount+' Episodes through metadata and Direct On-deck Commit'+(bounded?' with an exact per-Episode cap':concurrent?' with concurrent non-overlapping E03':append?' and appends E03 from '+(anchored?'an explicit Series anchor':'an unanchored Candidate'):''), {timeout:180000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-routing-'));
  const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),source=path.join(root,'source',anchored?'Demo Show (2020) {tmdb-series-1399}':'Demo Show (2020)','Season 01');
  fs.mkdirSync(adminDistDir,{recursive:true});fs.mkdirSync(source,{recursive:true});
  fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const episodeNumbers=Array.from({length:episodeCount},(_,index)=>index+1);
  const episodeKeys=episodeNumbers.map(number=>'E'+String(number).padStart(3,'0'));
  const sources=episodeNumbers.map(number=>path.join(source,'Demo Show.S01E'+String(number).padStart(2,'0')+'.mkv'));
  sources.forEach(file=>fs.writeFileSync(file,'read-only-series-fixture'));
  if(concurrent){
    const batch=path.join(root,'source2','Batch B {tmdb-series-1399}','Season 01');
    fs.mkdirSync(batch,{recursive:true});fs.writeFileSync(path.join(batch,'Demo Show.S01E03.mkv'),'concurrent-third-series-fixture');
  }
  const secretRoot='disposable-series-routing-secret',initialized=initializeCleanData({
    dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot});
  const adapter=harness(),providerCalls=[],appendCommitAudits=[];let unitOfWork,runtimeError,db;
  const poster=await sharp({create:{width:4,height:6,channels:3,background:'#224466'}}).jpeg().toBuffer();
  const host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,mediaProbe:mediaProbe(),
    mediaProductionEffectPort:{
      async verifyPlayback(){return {samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('fixture-decode')};},
      async executeRemux(){throw new Error('Direct fixture must not Remux.');},
      async executeTranscode(){throw new Error('Direct fixture must not Transcode.');},
      async verifyTranscodeInput(){throw new Error('Direct fixture must not assess Transcode.');},
    },
    unitOfWorkDecorator(value){
      unitOfWork=Object.freeze({...value,execute(participants,...args){
        if(!append||!participants.some(item=>item.participantId==='arca_ondeck_domain')||
            db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n!==1)return value.execute(participants,...args);
        const tables=['arca_shelf_entries','arca_inventory_materials','arca_inventory_product_facts','arca_deck_fact_revisions',
          'arca_ondeck_commit_receipts','arca_offload_completions','arca_source_cleanup_checks','arca_offdeck_reservations',
          'arca_canonical_identity_revisions','arca_inventory_representations','arca_inventory_person_relations','arca_inventory_related_references',
          'fx_material_controls','fx_material_control_revisions','fx_commit_markers','fx_event_result_bindings','fx_outbox','fx_outbox_deliveries'];
        const snapshot=()=>JSON.stringify(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
        const before=snapshot();
        const reservationRepo=createRepositoryDefinition({repositoryId:'fixture_series_reservation',owner:'arca',schemaManifest,
          statements:{insert:{kind:'insert',tableId:'arca_offdeck_reservations',columns:['reservation_id','shelf_entry_id','state']},
            insert_deck:{kind:'insert',tableId:'arca_deck_fact_revisions',columns:['shelf_entry_id','revision','state','inventory_revision','standard_revision','fact_digest','committed_at_ms']},
            advance:{kind:'update',tableId:'arca_shelf_entries',setColumns:['current_deck_fact_revision'],keyColumns:['shelf_entry_id']}}});
        const entry=db.prepare('SELECT * FROM arca_shelf_entries').get();
        const reserve={participantId:'fixture_series_reserve',owner:'arca',repositories:[reservationRepo],execute(context){
          context.repository(reservationRepo.repositoryId).invoke('insert',{reservation_id:'fixture-reservation',shelf_entry_id:entry.shelf_entry_id,state:'active'});}};
        assert.throws(()=>value.execute([reserve,...participants],...args),{code:'ARCA_SERIES_EXTENSION_RESERVED'});
        assert.equal(snapshot(),before);
        const drift={participantId:'fixture_series_drift',owner:'arca',repositories:[reservationRepo],execute(context){
          const repo=context.repository(reservationRepo.repositoryId);
          repo.invoke('insert_deck',{shelf_entry_id:entry.shelf_entry_id,revision:entry.current_deck_fact_revision+1,state:'active',
            inventory_revision:entry.current_inventory_revision,standard_revision:1,fact_digest:D('concurrent-deck'),committed_at_ms:Date.now()});
          repo.invoke('advance',{shelf_entry_id:entry.shelf_entry_id,current_deck_fact_revision:entry.current_deck_fact_revision+1});
        }};
        assert.throws(()=>value.execute([drift,...participants],...args),{code:'ARCA_SERIES_EXTENSION_STALE'});
        assert.equal(snapshot(),before);
        const crash={participantId:'fixture_series_crash',owner:'arca',repositories:[reservationRepo],execute(){throw new Error('Injected post-write Series crash');}};
        assert.throws(()=>value.execute([...participants,crash],...args),/Injected post-write Series crash/);
        assert.equal(snapshot(),before);
        const result=value.execute(participants,...args),committed=snapshot();
        let replay;
        try{value.execute(participants,...args);}catch(error){replay=error;}
        assert.equal(replay?.result?.onDeckCommitReceipt?.shelfEntryId,entry.shelf_entry_id);
        assert.equal(snapshot(),committed);
        appendCommitAudits.push({reservationRejected:true,headDriftRejected:true,rollbackVerified:true,replayVerified:true});
        return result;
      }});
      return unitOfWork;
    },
    routingIntegrationHandleResolver:request=>handle(request.operationId),
    routingProviderObservation:request=>{providerCalls.push(request);return adapter.observe(request);},
    productIntegrationHandleResolver:request=>handle(request.operationId),
    currentProductIntegrationHandleResolver:request=>handle(request.operationId),
    productProviderMetadataFetch:adapter.fetchMetadata,
    productProviderArtifactFetch:async request=>({resultKind:'acquired',bytes:poster,artifactKind:request.artifactKind,
      integrationId:request.integrationHandle.integrationId,configRevision:request.integrationHandle.configRevision,
      mediaType:'image/jpeg',resolvedProviderIdentity:request.resolvedProviderIdentity}),
    onExecutionRuntimeError(error){runtimeError=error;}});
  t.after(async()=>{
    await host.close();db?.close();
    assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('helix-series-routing-'));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});
  assert.equal(login.statusCode,204,login.body);const cookie=login.headers['set-cookie'];
  async function request(method,url,payload) {
    const response=await host.inject({method,url,headers:{cookie},payload});
    assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response;
  }
  await request('POST','/v1/admin/settings/automatic-operation/actions/enable-full', {
    idempotencyKey:'series-settlement',expectedRevision:0,coverExclusiveRelatedInput:true});
  const policyValue={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
  const access={fieldId:'series-field',revision:1,endpointId:'series-endpoint',rootLocation:path.join(root,'source'),
    mountScopeId:'series-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/series-field-access/v1'};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'series-register',fieldId:'series-field',name:'Series fixture',
    contentProfileHint:'series',policy:{extractionPolicyId:'series-policy',revision:1,
      policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy:policyValue,
      policyDigest:canonicalDigest({extractionPolicyId:'series-policy',revision:1,...policyValue})},
    access:{...access,accessDigest:canonicalDigest(access)}});
  let ruleTemplateId='system-beta-recommended',expectedTemplateRevision=1;
  if(bounded){
    ruleTemplateId='series-bounded-template';expectedTemplateRevision=2;
    await request('POST','/v1/admin/rule-templates/system-beta-recommended/actions/copy',{
      idempotencyKey:'bounded-copy',sourceTemplateId:'system-beta-recommended',newTemplateId:ruleTemplateId,
      name:'Bounded Series fixture',expectedSourceRevision:1});
    const draft=(await request('GET','/v1/admin/rule-templates/'+ruleTemplateId+'/draft')).json().draft;
    const rules=structuredClone(draft.rules),profile=rules.profileRuleSets.find(item=>item.contentProfile==='series');
    for(const requirements of [profile.baseRequirements,...profile.decisionBranches.map(item=>item.requirements)]){
      requirements.space={unit:'episode',maxSizeGiB:24/1073741824,maxSizeBytes:24};
    }
    profile.profileRuleSetDigest=canonicalDigest(Object.fromEntries(Object.entries(profile).filter(([key])=>key!=='profileRuleSetDigest')));
    const rulesDigest=canonicalDigest(rules);
    await request('PATCH','/v1/admin/rule-templates/'+ruleTemplateId+'/draft',{
      idempotencyKey:'bounded-draft',templateId:ruleTemplateId,expectedDraftRevision:1,basePublishedRevision:1,
      rulesSchemaRef:draft.rulesSchemaRef,rules,rulesDigest});
    const basis={templateId:ruleTemplateId,expectedCurrentRevision:1,expectedDraftRevision:2,expectedDraftDigest:rulesDigest};
    const preview=(await request('POST','/v1/admin/rule-templates/'+ruleTemplateId+'/actions/preview',{
      idempotencyKey:'bounded-preview',...basis})).json();
    await request('POST','/v1/admin/rule-templates/'+ruleTemplateId+'/actions/publish',{
      idempotencyKey:'bounded-publish',...basis,previewId:preview.previewId,previewDigest:preview.previewDigest});
  }
  const target=path.join(root,'shelf');fs.mkdirSync(target);
  await request('POST','/v1/admin/shelves',{idempotencyKey:'series-shelf',shelfId:'series-shelf',name:'Series fixture',
    targetRootLocation:target,ruleTemplateId,expectedTemplateRevision,
    placementPolicy:{folderTemplate:'{title}',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',
      subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
  await request('PATCH','/v1/admin/routing/material-fields/series-field',{idempotencyKey:'series-routing',fieldId:'series-field',
    expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:'series-routing',mode:'sorting',targets:[
      {shelfId:'series-shelf',rank:1,matchExpression:{nodeKind:'predicate',factKind:'release_year',operator:'gte',expectedValue:2020}}]}});
  if(concurrent){
    const secondAccess={...access,fieldId:'series-field-2',endpointId:'series-endpoint-2',rootLocation:path.join(root,'source2'),mountScopeId:'series-mount-2'};
    await request('POST','/v1/admin/material-fields',{idempotencyKey:'series-register-2',fieldId:'series-field-2',name:'Second batch fixture',
      contentProfileHint:'series',policy:{extractionPolicyId:'series-policy-2',revision:1,
        policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy:policyValue,
        policyDigest:canonicalDigest({extractionPolicyId:'series-policy-2',revision:1,...policyValue})},
      access:{...secondAccess,accessDigest:canonicalDigest(secondAccess)}});
    await request('PATCH','/v1/admin/routing/material-fields/series-field-2',{idempotencyKey:'series-routing-2',fieldId:'series-field-2',
      expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:'series-routing-2',mode:'sorting',targets:[
        {shelfId:'series-shelf',rank:1,matchExpression:{nodeKind:'predicate',factKind:'release_year',operator:'gte',expectedValue:2020}}]}});
  }
  // The product entry remains Movie-only. Exercise the owning observation command;
  // Host fallback reconciliation supplies the real Work, Planner and Event runtime.
  const deps={schemaManifest,unitOfWork};
  const observation=createFieldObservationAdminService({...deps,materialFieldStore:createMaterialFieldStore(deps),
    executionRuntimeHost:{wake(){}}});
  observation.observe({idempotencyKey:'series-observe',fieldId:'series-field',
    expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  if(concurrent)observation.observe({idempotencyKey:'series-observe-2',fieldId:'series-field-2',expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  if(concurrent){
    const waitFor=async(predicate,label)=>{const until=Date.now()+150000;while(!predicate()&&Date.now()<until){
      assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,25));
    }assert.ok(predicate(),label+': '+JSON.stringify({runs:db.prepare('SELECT libra_run_id,state FROM libra_runs').all(),
      onDeck:db.prepare('SELECT * FROM arca_ondeck_runs').all(),receipts:db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all(),
      events:db.prepare("SELECT capability_ref,state,retry_at_ms FROM fx_workflow_events WHERE owner_domain='arca'").all(),
      failures:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));};
    await waitFor(()=>db.prepare("SELECT count(*) n FROM libra_runs WHERE state='active'").get().n===2,'two disjoint Runs stay active');
    assert.equal(db.prepare('SELECT count(*) n FROM libra_subjects').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM libra_runs').get().n,2);
    const frozen=db.prepare('SELECT libra_run_id,execution_basis_digest,run_material_manifest_id FROM libra_runs').all();
    await waitFor(()=>db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===2,'both Runs commit');
    assert.deepEqual(db.prepare('SELECT libra_run_id,execution_basis_digest,run_material_manifest_id FROM libra_runs').all(),frozen);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM libra_runs WHERE state='completed'").get().n,2);
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get();
    const delivered=db.prepare("SELECT episode_claims_json FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=? AND role='primary_payload'")
      .all(entry.shelf_entry_id,entry.current_inventory_revision).flatMap(row=>JSON.parse(row.episode_claims_json).items.map(item=>item.episodeKey));
    assert.deepEqual(delivered.sort(),['E001','E002','E003']);
    assert.equal(db.prepare('SELECT count(DISTINCT inventory_revision) n FROM arca_ondeck_commit_receipts').get().n,2);
    const scopes=frozen.map(run=>db.prepare('SELECT episode_key FROM libra_run_material_episode_claims WHERE run_material_manifest_id=? ORDER BY episode_key').all(run.run_material_manifest_id).map(row=>row.episode_key).join(','));
    assert.deepEqual(scopes.sort(),['E001,E002','E003']);
    return;
  }
  let state;const deadline=Date.now()+100000;
  do {
    state={subjects:db.prepare('SELECT * FROM libra_subjects').all(),routes:db.prepare('SELECT * FROM libra_routing_decisions').all(),
      specs:db.prepare('SELECT * FROM libra_acceptance_specs').all(),runs:db.prepare('SELECT * FROM libra_runs').all(),
      works:db.prepare('SELECT work_id,work_kind,state FROM fx_supporting_works').all(),
      facts:db.prepare('SELECT fact_kind,fact_json FROM libra_product_fact_revisions').all()};
    // Observe the complete Arca transaction, including authorized source settlement.
    if(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n===1||db.prepare("SELECT count(*) n FROM arca_acceptance_decisions WHERE result='rejected'").get().n>0||
        state.works.some(work=>work.state==='failed'))break;
    assert.ifError(runtimeError);
    await new Promise(resolve=>setTimeout(resolve,25));
  } while(Date.now()<deadline);
  assert.equal(state.runs.length,1,JSON.stringify(state));
  assert.ok(state.facts.some(fact=>fact.fact_kind==='product_metadata'),JSON.stringify({
    works:state.works,attempts:db.prepare('SELECT * FROM fx_work_attempts').all(),
    incidents:db.prepare('SELECT * FROM fx_executor_incidents').all(),events:db.prepare(
      'SELECT event_id,failure_class,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
  const sourceWork=state.works.find(work=>work.work_id.startsWith('libra-workspace-media-source_observation-work-'));
  assert.equal(sourceWork?.state,'succeeded',JSON.stringify(state.works));
  const sourceSnapshot=createMovieProductionReader({schemaManifest,unitOfWork}).readRunSnapshot(state.runs[0].libra_run_id);
  const directWork=state.works.find(work=>work.work_id.startsWith('libra-workspace-media-direct_selection-work-'));
  assert.equal(directWork?.state,'succeeded',JSON.stringify({works:state.works,events:db.prepare(
    'SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
  assert.ok(state.works.some(work=>work.work_kind==='product_conformance'&&work.state==='succeeded'),JSON.stringify({works:state.works,incidents:db.prepare('SELECT * FROM fx_executor_incidents').all(),events:db.prepare('SELECT * FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),attempts:db.prepare("SELECT * FROM fx_work_attempts WHERE failure_code IS NOT NULL").all()}));
  assert.ok(state.works.some(work=>work.work_kind==='deliverable_promotion'&&work.state==='succeeded'),JSON.stringify({eventStates:db.prepare("SELECT event_id,capability_ref,state,retry_at_ms FROM fx_workflow_events WHERE owner_domain='arca'").all(),checks:db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'accept-%'").all(),decisions:db.prepare('SELECT * FROM arca_acceptance_decisions').all(),works:state.works,events:db.prepare('SELECT * FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),attempts:db.prepare("SELECT * FROM fx_work_attempts WHERE failure_code IS NOT NULL").all()}));
  assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,1,JSON.stringify({eventStates:db.prepare("SELECT event_id,capability_ref,state,retry_at_ms FROM fx_workflow_events WHERE owner_domain='arca'").all(),checks:db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'accept-%'").all(),decisions:db.prepare('SELECT * FROM arca_acceptance_decisions').all(),works:state.works,events:db.prepare('SELECT * FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),attempts:db.prepare("SELECT * FROM fx_work_attempts WHERE failure_code IS NOT NULL").all()}));
  if(bounded){
    const checks=db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>JSON.parse(row.result_json))
      .filter(result=>result.schemaRef==='helix://contracts/types/AcceptanceCheck/v1'&&result.checkKind==='space');
    assert.equal(checks.length,1);assert.equal(checks[0].result,'passed');
    assert.deepEqual(checks[0].episodeSpaceEvidence.allocations.map(item=>({key:item.episodeKey,...item.allocatedBytes,withinLimit:item.withinLimit})),
      [{key:'E001',numerator:'24',denominator:'1',withinLimit:true},{key:'E002',numerator:'24',denominator:'1',withinLimit:true}]);
    assert.equal(checks[0].episodeSpaceEvidence.maxSizeBytes,24);
  }
  const packages=db.prepare('SELECT * FROM libra_product_packages').all();
  assert.equal(packages.length,1);
  const provenance=JSON.parse(packages[0].production_provenance_json);
  const readSet=provenance.shelfAcceptancePrimaryReadSet;
  assert.equal(readSet.primaryInputs.length,episodeCount);
  assert.equal(new Set(readSet.primaryInputs.map(item=>item.materialKey)).size,episodeCount);
  const packaged=db.prepare('SELECT * FROM libra_product_package_materials WHERE on_deck_package_id=?').all(packages[0].on_deck_package_id);
  const primary=packaged.filter(item=>item.role==='primary_payload');
  assert.equal(primary.length,episodeCount);
  assert.equal(packaged.filter(item=>item.role==='metadata_sidecar').length,episodeCount+1);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_product_package_material_episode_claims').get().n,episodeCount);
  for(const item of readSet.primaryInputs) {
    const member=primary.find(row=>row.material_key===item.materialKey);
    assert.ok(member);assert.equal(item.productMemberDigest,member.member_digest);
    assert.equal(item.productMediaVerification.result,'passed');assert.equal(item.samePhysicalMaterial,true);
    assert.equal(item.productReadHandleDigest,canonicalDigest(item.productReadHandle));
    assert.equal(item.sourceReadHandleDigest,item.productReadHandleDigest);
  }
  const conformance=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-product-conformance-event-%'").all();
  assert.equal(conformance.length,1);assert.equal(JSON.parse(conformance[0].result_json).result,'passed');
  const directResults=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-direct-media-verify-event-%'").all()
    .map(item=>JSON.parse(item.result_json));
  const selections=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-direct-media-select-event-%'").all()
    .map(item=>JSON.parse(item.result_json));
  assert.equal(directResults.length,episodeCount);assert.equal(selections.length,episodeCount);
  assert.equal(new Set(directResults.map(item=>item.productMaterialHandleDigest)).size,episodeCount);
  for(const result of directResults)assert.equal(result.result,'passed',JSON.stringify(result));
  assert.deepEqual(selections.map(item=>item.selectedVerificationId).sort(),directResults.map(item=>item.verificationId).sort());
  const sourceProbes=db.prepare("SELECT event_id,result_json,result_digest FROM fx_event_result_bindings WHERE event_id LIKE 'libra-source-media-probe-event-%'").all();
  assert.equal(sourceProbes.length,episodeCount);
  for(const item of sourceProbes) {
    const value=JSON.parse(item.result_json);assertProbeEvidence(value);
    assert.equal(item.result_digest,canonicalDigest(value));
  }
  assert.equal(db.prepare("SELECT count(*) n FROM fx_event_attempts WHERE event_id LIKE 'libra-source-media-probe-event-%' AND failure_code IS NOT NULL").get().n,0);
  assert.equal(new Set(sourceProbes.map(item=>JSON.parse(item.result_json).sourceHandleDigest)).size,episodeCount);
  const sourceNodes=db.prepare("SELECT input_bindings_json FROM fx_plan_nodes WHERE node_id LIKE 'source_media_probe_%'").all();
  const probeKeys=sourceNodes.map(node=>JSON.parse(node.input_bindings_json).bindings[0].parameters.materialKey).sort();
  const primaryKeys=db.prepare("SELECT material_key FROM libra_run_material_members WHERE role='primary_payload' ORDER BY material_key").all();
  assert.deepEqual(probeKeys,primaryKeys.map(item=>item.material_key));
  for(const node of sourceNodes) {
    const parameters=JSON.parse(node.input_bindings_json).bindings[0].parameters;
    const member=sourceSnapshot.members.find(item=>item.materialKey===parameters.materialKey);
    assert.equal(parameters.memberDigest,canonicalDigest(member));
  }
  if(anchored){
    assert.ok(state.works.some(work=>work.work_id.startsWith('libra-product-identity-observation_provider_exact-work-')));
    assert.ok(!state.works.some(work=>work.work_id.startsWith('libra-product-identity-observation_provider_search-work-')));
  }
  assert.equal(state.subjects.length,1);assert.equal(state.subjects[0].content_profile,'series');
  assert.equal(state.subjects[0].structure_kind,'season');
  assert.equal(state.routes.at(-1).decision,'resolved');assert.equal(state.routes.at(-1).shelf_id,'series-shelf');
  assert.ok(state.specs.length>=1);
  for(const spec of state.specs) {
    assert.equal(spec.content_profile,'series');
    assert.deepEqual(JSON.parse(spec.spec_json).productScope.episodeKeys,episodeKeys);
  }
  assert.ok(providerCalls.some(call=>call.operationId===undefined&&call.intent.contentProfile==='series'&&call.intent.seasonNumber===1));
  const claims=db.prepare('SELECT episode_key FROM libra_run_material_episode_claims ORDER BY episode_key').all();
  assert.deepEqual(claims.map(claim=>claim.episode_key),episodeKeys);
  const metadata=JSON.parse(state.facts.find(fact=>fact.fact_kind==='product_metadata').fact_json);
  assert.deepEqual(metadata.episodeMetadata.map(item=>item.episodeScope.episodeKey),episodeKeys);
  const artifacts=db.prepare("SELECT artifact_kind FROM fx_artifact_registry WHERE owner_domain='libra' AND state='active'").all();
  assert.equal(artifacts.length,episodeCount+2);
  const workspaceId=db.prepare("SELECT workspace_id FROM fx_workspace_registry WHERE owner_domain='libra'").get().workspace_id;
  const productRoot=path.join(dataDir,'workspaces','libra',workspaceId,'product');
  assert.match(fs.readFileSync(path.join(productRoot,'season.nfo'),'utf8'),/<tvshow>/);
  for(const number of episodeNumbers) {
    const xml=fs.readFileSync(path.join(productRoot,episodeKeys[number-1]+'.nfo'),'utf8');
    assert.match(xml,new RegExp('<episode>'+number+'</episode>'));
    assert.match(xml,new RegExp('<title>Episode '+number+'</title>'));
  }
  const refs=db.prepare('SELECT * FROM libra_product_fact_source_refs WHERE product_fact_id=? ORDER BY ordinal').all(metadata.factId);
  assert.equal(refs.length,episodeCount+1);
  for(const ref of refs) {
    const result=db.prepare('SELECT * FROM fx_event_result_bindings WHERE result_id=?').get(ref.result_id);
    const node=db.prepare('SELECT node.input_bindings_json FROM fx_plan_nodes node JOIN fx_workflow_events event '+
      'ON event.plan_id=node.plan_id AND event.node_id=node.node_id WHERE event.event_id=?').get(ref.event_id);
    assert.equal(ref.result_digest,result.result_digest);
    assert.equal(ref.evidence_digest,JSON.parse(result.result_json).payloadDigest);
    assert.equal(ref.input_binding_digest,canonicalDigest(JSON.parse(node.input_bindings_json)));
  }
  assert.ok(state.works.some(work=>work.work_kind==='routing_provider_facts'&&work.state==='succeeded'));
  assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,1);
  const inventory=db.prepare('SELECT * FROM arca_inventory_materials').all();
  assert.equal(inventory.length,episodeCount*2+2);
  assert.equal(db.prepare('SELECT count(*) n FROM arca_deck_fact_revisions').get().n,1);
  assert.equal(new Set(inventory.map(item=>item.location)).size,inventory.length);
  const inventoryPrimary=inventory.filter(item=>item.role==='primary_payload');
  assert.equal(inventoryPrimary.length,episodeCount);
  for(const item of inventoryPrimary) {
    assert.equal(fs.readFileSync(item.location,'utf8'),'read-only-series-fixture');
    assert.equal(path.basename(path.dirname(item.location)),'Season 01');
    assert.ok(path.relative(target,item.location)&&!path.relative(target,item.location).startsWith('..'));
  }
  assert.deepEqual(inventoryPrimary.flatMap(item=>JSON.parse(item.episode_claims_json).items.map(claim=>claim.episodeKey)).sort(),episodeKeys);
  const finalNfos=inventory.filter(item=>item.role==='metadata_sidecar');
  assert.equal(finalNfos.length,episodeCount+1);
  for(const number of episodeNumbers) {
    const item=finalNfos.find(item=>path.basename(item.location).endsWith('S01E'+String(number).padStart(2,'0')+'.nfo'));
    assert.ok(item);
    assert.match(fs.readFileSync(item.location,'utf8'),new RegExp('<episode>'+number+'</episode>'));
  }
  sources.forEach(file=>assert.equal(fs.existsSync(file),false));
  if(append) {
    const firstRun=state.runs[0],firstEntry=db.prepare('SELECT * FROM arca_shelf_entries').get();
    const immutableInventory=rows=>rows.map(({active_guard,...row})=>row);
    const oldInventory=JSON.stringify(immutableInventory(inventory)),oldFacts=JSON.stringify(db.prepare('SELECT * FROM arca_deck_fact_revisions').all());
    fs.writeFileSync(path.join(source,'Demo Show.S01E03.mkv'),'third-series-fixture');
    const field=createMaterialFieldStore(deps).getMaterialField('series-field');
    observation.observe({idempotencyKey:'series-observe-e03',fieldId:'series-field',expectedAccessRevision:1,
      expectedObservationRevision:field.currentObservationRevision,pageBudget:8});
    const appendDeadline=Date.now()+70000;
    do {
      if(db.prepare('SELECT count(*) n FROM arca_deck_fact_revisions').get().n===2||
          db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE state='failed'").get().n)break;
      assert.ifError(runtimeError);
      await new Promise(resolve=>setTimeout(resolve,50));
    } while(Date.now()<appendDeadline);
    // Ordinary filenames preserve separate Subjects; explicit anchors reuse the Season Subject.
    // Arca independently resolves both Products to the same canonical Season Entry.
    assert.equal(db.prepare('SELECT count(*) n FROM libra_subjects').get().n,anchored?1:2);
    const runs=db.prepare('SELECT * FROM libra_runs').all();
    if(anchored){
      assert.ok(runs.every(run=>run.subject_id===firstRun.subject_id));
      const second=runs.find(run=>run.libra_run_id!==firstRun.libra_run_id);
      assert.deepEqual(db.prepare('SELECT episode_key FROM libra_run_material_episode_claims WHERE run_material_manifest_id=? ORDER BY episode_key').all(second.run_material_manifest_id).map(row=>row.episode_key),['E003']);
      assert.deepEqual(db.prepare('SELECT episode_key FROM libra_run_material_episode_claims WHERE run_material_manifest_id=? ORDER BY episode_key').all(firstRun.run_material_manifest_id).map(row=>row.episode_key),['E001','E002']);
    }
    assert.equal(runs.length,2,JSON.stringify({runs,works:db.prepare('SELECT work_id,work_kind,state FROM fx_supporting_works').all()}));
    assert.deepEqual(runs.find(item=>item.libra_run_id===firstRun.libra_run_id),firstRun);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_deck_fact_revisions').get().n,2,JSON.stringify({
      works:db.prepare('SELECT work_id,work_kind,state FROM fx_supporting_works').all(),
      failures:db.prepare('SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,1);
    assert.equal(db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get().shelf_entry_id,firstEntry.shelf_entry_id);
    assert.equal(JSON.stringify(immutableInventory(db.prepare('SELECT * FROM arca_inventory_materials WHERE inventory_revision=1').all())),oldInventory);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM arca_deck_fact_revisions WHERE revision=1').all()),oldFacts);
    const currentEntry=db.prepare('SELECT * FROM arca_shelf_entries').get();
    assert.ok(currentEntry.current_inventory_revision>firstEntry.current_inventory_revision);
    const latestInventory=db.prepare('SELECT * FROM arca_inventory_materials WHERE inventory_revision=?').all(currentEntry.current_inventory_revision);
    const latestPrimary=latestInventory.filter(row=>row.role==='primary_payload');
    assert.deepEqual(latestPrimary.flatMap(row=>JSON.parse(row.episode_claims_json).items.map(claim=>claim.episodeKey)).sort(),['E001','E002','E003'],JSON.stringify({currentEntry,inventory:db.prepare('SELECT inventory_revision,role,episode_claims_json FROM arca_inventory_materials').all(),receipts:db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()}));
    assert.ok(latestPrimary.every(row=>row.active_guard===1));
    assert.ok(db.prepare('SELECT active_guard FROM arca_inventory_materials WHERE inventory_revision=1').all().every(row=>row.active_guard===0));
    const latestFacts=db.prepare("SELECT * FROM arca_inventory_product_facts WHERE inventory_revision=? AND fact_kind='product_metadata'").all(currentEntry.current_inventory_revision);
    assert.equal(latestFacts.length,2);
    assert.equal(new Set(latestFacts.map(row=>row.source_package_id)).size,2);
    assert.deepEqual(latestFacts.flatMap(row=>JSON.parse(row.fact_json).episodeMetadata.map(item=>item.episodeScope.episodeKey)).sort(),['E001','E002','E003']);
    for(const item of inventoryPrimary)assert.equal(fs.readFileSync(item.location,'utf8'),'read-only-series-fixture');
    const third=latestPrimary.find(row=>JSON.parse(row.episode_claims_json).items.some(claim=>claim.episodeKey==='E003'));
    assert.equal(fs.readFileSync(third.location,'utf8'),'third-series-fixture');
    assert.equal(appendCommitAudits.length,1);
    const onDeck=createOnDeckStore(deps);
    const receipts=db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all();
    assert.equal(receipts.length,2);
    for(const receipt of receipts) {
      const completion=db.prepare('SELECT * FROM arca_offload_completions WHERE on_deck_run_id=?').get(receipt.on_deck_run_id);
      const run=db.prepare('SELECT * FROM arca_ondeck_runs WHERE on_deck_run_id=?').get(receipt.on_deck_run_id);
      const pkg=db.prepare('SELECT * FROM libra_product_packages WHERE on_deck_package_id=?').get(completion.package_id);
      const input={onDeckRunId:run.on_deck_run_id,custodyId:run.custody_id,finalInventoryDecisionDigest:run.final_inventory_decision_digest,
        onDeckPackageId:pkg.on_deck_package_id,packageDigest:pkg.package_digest,shelfId:'series-shelf'};
      const historical=onDeck.readHistoricalCommitted(input),byPackage=onDeck.readCommittedByPackage(input);
      assert.equal(historical.replayed,true);assert.equal(byPackage.replayed,true);
      assert.equal(historical.commitDigest,receipt.commit_digest);assert.equal(byPackage.commitDigest,receipt.commit_digest);
      assert.equal(historical.result.onDeckCommitReceipt.inventoryRevision,receipt.inventory_revision);
      assert.throws(()=>onDeck.readHistoricalCommitted({...input,packageDigest:D('foreign')}));
      assert.throws(()=>onDeck.readCommittedByPackage({...input,custodyId:'foreign'}));
    }
    assert.equal(db.prepare('SELECT count(*) n FROM arca_deck_fact_revisions').get().n,2);

  }
});
