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
      const seasonNumber=Number(url.pathname.match(/\/season\/(\d+)/)?.[1]??1);
      const result=search?(overrides.search??{results:[{id:1399,name:'Demo Show'}]}):episode?
        {id:63055+seasonNumber*100+episodeNumber,season_number:seasonNumber,episode_number:episodeNumber,name:'Episode '+episodeNumber,
          overview:overrides.episodePlot??('Episode '+episodeNumber+' plot'),air_date:'2020-01-01'}:season?
        (overrides.season??{id:3623+seasonNumber,season_number:seasonNumber,
          episodes:Array.from({length:77},(_,index)=>({id:63055+seasonNumber*100+index+1,show_id:1399,
            season_number:seasonNumber,episode_number:index+1,name:'Episode '+(index+1),
            overview:overrides.episodePlot??('Episode '+(index+1)+' plot'),air_date:'2020-01-01'}))}):(overrides.show??{
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
  return {calls,observe,fetchMetadata,fetchSeriesMetadata:basis=>adapter.observationPort.execute({operationId:'arca.series_presentation.source.observe@1',integrationHandle:handle('arca.series_presentation.source.observe@1'),timeoutMs:1000,input:{metadataRequest:basis}})};
}
function restoreArcaResult(db,value){
  let row,full,expected;
  if(value.schemaRef==='helix://contracts/types/AcceptanceCheckRecord/v1'){
    row=db.prepare('SELECT evidence_json AS full_json FROM arca_acceptance_check_evidence WHERE acceptance_attempt_id=? AND check_kind=? AND check_revision=?')
      .get(value.acceptanceAttemptId,value.checkKind,value.checkRevision);expected=value.checkDigest;
  }else if(value.schemaRef==='helix://contracts/types/StagedInventoryManifestRecord/v1'){
    row=db.prepare('SELECT manifest_json AS full_json FROM arca_staged_manifest_records WHERE record_id=?').get(value.recordId);expected=value.completeValueDigest;
  }else if(['helix://contracts/types/FinalProductVerificationRecord/v1','helix://contracts/types/FulfillmentVerificationRecord/v1'].includes(value.schemaRef)){
    row=db.prepare('SELECT verification_json AS full_json FROM arca_inventory_verification_records WHERE record_id=?').get(value.recordId);expected=value.verificationDigest;
  }else return value;
  assert.ok(row,'Owner must retain the complete referenced result');full=JSON.parse(row.full_json);assert.equal(canonicalDigest(full),expected);return full;
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

function mediaProbe(external=false) {
  return {async probe(readHandle) {
    const upgraded=external&&String(readHandle.relativePath||readHandle.location||'').replaceAll('\\','/').includes('external/');
    const body={resultKind:'probed',sourceHandleDigest:canonicalDigest(readHandle),durationMs:1000,
      videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:upgraded?3840:1920,height:upgraded?2160:1080}],
      audioStreams:[],subtitleStreams:[],discTopology:null};
    if(['exhausted','technical'].includes(external))Object.assign(body.videoStreams[0],{codec:'h264',codecProfile:external==='technical'?'high 10':'high 4:2:2',
      pixelFormat:external==='technical'?'yuv420p10le':'yuv422p10le',bitDepth:10,chroma:external==='technical'?'4:2:0':'4:2:2',colorRange:'limited',colorPrimaries:'bt709',
      colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr'});
    return {...body,payloadDigest:canonicalDigest(body)};
  }};
}
for(const {episodeCount,procurementOnly,append,anchored,concurrent,bounded,shared,parts,mixed,real,nm,repair,posterRepair,migrate,mediaRepair,mediaBound,offdeck,external,manualIdentity,multiSeason} of [...(process.env.HELIX_SERIES_PROCUREMENT_ONLY==='1'?[{episodeCount:95,procurementOnly:true}]:[]),...(process.env.HELIX_SERIES_MANUAL_IDENTITY==='1'?[{episodeCount:2,mixed:process.env.HELIX_SERIES_BROWSER_COLD!=='1',manualIdentity:true,append:process.env.HELIX_SERIES_BROWSER_APPEND==='1',repair:process.env.HELIX_SERIES_BROWSER_CARE==='1',offdeck:process.env.HELIX_SERIES_BROWSER_OFFDECK==='1'}]:[]),...(process.env.HELIX_SERIES_EXTERNAL==='1'?[{episodeCount:2,shared:true,external:true,real:process.env.HELIX_SERIES_EXTERNAL_REAL==='1'},{episodeCount:2,shared:true,external:'rejected'},{episodeCount:2,shared:true,external:'exhausted'},{episodeCount:2,shared:true,external:'technical'}]:[]),...(process.env.HELIX_SERIES_OFFDECK==='1'?[{episodeCount:2,real:true,nm:true,mixed:true,offdeck:true}]:[]),...(process.env.HELIX_SERIES_MEDIA_REPAIR==='1'?[{episodeCount:3,real:true,mediaRepair:true},{episodeCount:2,real:true,mediaRepair:true,nm:true},{episodeCount:3,real:true,mediaRepair:true,mediaBound:true},{episodeCount:2,real:true,mediaRepair:true,mediaBound:true,nm:true}]:[]),...(process.env.HELIX_SERIES_REAL_MEDIA==='1'?[{episodeCount:3,mixed:true,real:true},{episodeCount:2,mixed:true,real:true,nm:true}]:[]),{episodeCount:2,multiSeason:true},{episodeCount:2,migrate:true},{episodeCount:2,migrate:'rename'},{episodeCount:2,repair:true},{episodeCount:2,repair:true,posterRepair:true},{episodeCount:2,mixed:true},{episodeCount:1,bounded:true,parts:true},{episodeCount:2,bounded:true,shared:true},{episodeCount:2,bounded:true},{episodeCount:2},{episodeCount:24},...(process.env.HELIX_SERIES_LARGE_SCOPE==='1'?[{episodeCount:47},{episodeCount:77}]:[]),...(process.env.HELIX_SERIES_NFO_GAP==='1'?[{episodeCount:17}]:[]),{episodeCount:2,append:true},{episodeCount:2,append:true,anchored:true},{episodeCount:2,anchored:true,concurrent:true}]) test((procurementOnly?'Isolated Host publishes '+episodeCount+' Episode members as one Season Candidate':'Isolated Host schedules '+episodeCount+' Episodes through metadata and Direct On-deck Commit')+(multiSeason?' with separate same-title Seasons':manualIdentity?' with manual Series identity':external?(external==='technical'?' with technical failure before external search':external==='exhausted'?' with exhausted local strategies then external search':external==='rejected'?' with rejected external shared-file search':' with external shared-file replacement'):offdeck?' with real N:M Off-deck':mediaRepair?(mediaBound?(nm?' with bounded real N:M media Aftercare':' with bounded real media Aftercare'):nm?' with real N:M media Aftercare':' with real media Aftercare'):migrate?(migrate==='rename'?' with same-directory placement rename':' with complete placement migration'):repair?(posterRepair?' with scoped NFO and poster repair':' with scoped NFO repair'):real?(nm?' with real N:M Remux Transcode':' with real Direct Remux Transcode'):mixed?' with mixed Direct and Remux':parts?' with bounded Episode parts':shared?' with a bounded shared Primary':bounded?' with an exact per-Episode cap':concurrent?' with concurrent non-overlapping E03':append?' and appends E03 from '+(anchored?'an explicit Series anchor':'an unanchored Candidate'):''), {timeout:episodeCount===77&&process.env.HELIX_SERIES_SETTLEMENT_DIAGNOSTICS==='1'?4800000:episodeCount>=17&&process.env.HELIX_SERIES_RELATED==='1'?2400000:real&&process.env.HELIX_SERIES_LONG_MEDIA==='1'?900000:episodeCount>47?1200000:real||repair||migrate||episodeCount>32?300000:180000},async t=>{
  const browserJourney=(manualIdentity||multiSeason)&&process.env.HELIX_SERIES_BROWSER==='1';
  const externalBrowser=external&&process.env.HELIX_SERIES_EXTERNAL_BROWSER==='1';
  const coldBrowser=browserJourney&&process.env.HELIX_SERIES_BROWSER_COLD==='1';
  let systemTemplateBefore;
  let browserFlow,sharedBrowserFlow,sharedRetryCommand,sharedRetryOffer;
  let externalBrowserFlow;
  const observedProviderStages=new Set();
  if(browserJourney)assert.ok([append,repair,offdeck].filter(Boolean).length<=1,'Browser append, repair, and exit journeys use separate frozen inventories.');
  const shutdownRoot=real?process.env.HELIX_SERIES_SHUTDOWN_ROOT:null;
  const crashRoot=process.env.HELIX_SERIES_SHARED_CRASH_ROOT||shutdownRoot|| (external?process.env.HELIX_SERIES_EXTERNAL_CRASH_ROOT:offdeck?process.env.HELIX_SERIES_OFFDECK_CRASH_ROOT:mediaRepair?process.env.HELIX_SERIES_AFTERCARE_CRASH_ROOT:null);
  const root=crashRoot?fs.realpathSync(crashRoot):
    fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-routing-'));
  const externalMultipart=external&&process.env.HELIX_SERIES_EXTERNAL_MULTIPART==='1',externalEpisodeCap=4*1024*1024;
  const externalProvider=external?require('../fixtures/series-external-host-provider').fixture(root,{rejectSearch:typeof external==='string',real,remux:process.env.HELIX_SERIES_EXTERNAL_REMUX==='1',transcode:process.env.HELIX_SERIES_EXTERNAL_TRANSCODE==='1',multipart:externalMultipart}):null;
  const initialSeason=process.env.HELIX_SERIES_FIRST_S03==='1'?3:1,seasonToken='S'+String(initialSeason).padStart(2,'0'),seasonDirectory='Season '+String(initialSeason).padStart(2,'0');
  const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),source=path.join(root,'source',anchored?'Demo Show (2020) {tmdb-series-1399}':'Demo Show (2020)',process.env.HELIX_SERIES_RELATED==='1'?'Season '+initialSeason:seasonDirectory);
  fs.mkdirSync(adminDistDir,{recursive:true});fs.mkdirSync(source,{recursive:true});
  if(browserJourney||externalBrowser||process.env.HELIX_SERIES_SHARED_BROWSER==='1') {
    const builtAdmin=path.resolve(__dirname,'../../dist/admin');
    assert.ok(fs.existsSync(path.join(builtAdmin,'index.html')),'Build Admin Web before the browser Host journey.');
    fs.cpSync(builtAdmin,adminDistDir,{recursive:true});
  } else fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const episodeNumbers=Array.from({length:episodeCount},(_,index)=>index+1);
  const episodeKeys=episodeNumbers.map(number=>'E'+String(number).padStart(3,'0'));
  const sources=nm?[path.join(source,'Demo Show.S01E01-02.part1.mp4'),path.join(source,'Demo Show.S01E01.part2.mkv')]:parts?[1,2].map(part=>path.join(source,'Demo Show.S01E01.part'+part+'.mkv')):shared?[path.join(source,'Demo Show.S01E01-02.mkv')]:episodeNumbers.map(number=>path.join(source,(procurementOnly?'Demo Show 完整来源名称完整来源名称完整来源名称':'Demo Show')+'.S01E'+String(number).padStart(2,'0')+((mixed||mediaRepair)&&number===2?'.mp4':'.mkv'))).map(file=>file.replace('.S01E','.'+seasonToken+'E'));
  const physicalCount=sources.length,perEpisodeCap=parts?48:shared?12:24;
  const relatedFixture=process.env.HELIX_SERIES_RELATED==='1';
  const thumbnailSources=relatedFixture?sources.map(file=>file.replace(/\.[^.]+$/,'-thumb.jpg')):[];
  const hdr=real&&process.env.HELIX_SERIES_HDR_MEDIA==='1';
  const longMedia=real&&process.env.HELIX_SERIES_LONG_MEDIA==='1';
  if(longMedia)assert.ok(!mediaBound&&!mediaRepair,'Long production fixture must not replace bounded Aftercare timing.');
  if(real) {
    const {spawnSync}=require('node:child_process'),ffmpeg=process.env.FFMPEG_PATH||require('ffmpeg-static');
    for(const [index,file] of sources.entries()) {
      const codec=(mediaBound&&nm|| (nm?index===1:index===2))?['-c:v','libx264']:['-c:v','libx265','-x265-params','pools=1:frame-threads=1'];
      const boundedSource=mediaBound&&(nm||index===2);
      const result=spawnSync(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i',
        boundedSource?'testsrc2=s=1920x1080:r=24:d=20':'color=c=black:s=1920x1080:r=24:d=3',
        ...(boundedSource||longMedia?['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration='+(boundedSource?20:3)]:[]),
        ...codec,'-preset','ultrafast',...(boundedSource?['-crf','0']:[]),...(boundedSource||longMedia?['-c:a','aac','-b:a','128k']:[]),
        '-pix_fmt',hdr?'yuv420p10le':'yuv420p',
        ...(hdr?['-vf','setparams=range=limited:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc']:[]),file],{encoding:'utf8',windowsHide:true,timeout:60000});
      assert.equal(result.status,0,result.stderr);
      if(longMedia) {
        const extended=file+'.extended'+path.extname(file);
        const copied=spawnSync(ffmpeg,['-v','error','-nostdin','-y','-stream_loop','399','-i',file,'-t','1200','-map','0','-c','copy',extended],
          {encoding:'utf8',windowsHide:true,timeout:60000});
        assert.equal(copied.status,0,copied.stderr);
        fs.renameSync(extended,file);
      }
      if(hdr) {
        const inspected=spawnSync(process.env.FFPROBE_PATH||require('@ffprobe-installer/ffprobe').path,
          ['-v','error','-select_streams','v:0','-show_streams','-of','json',file],{encoding:'utf8',windowsHide:true});
        assert.equal(inspected.status,0,inspected.stderr);
        const stream=JSON.parse(inspected.stdout).streams[0];
        assert.equal(stream.pix_fmt,'yuv420p10le');
        assert.equal(stream.color_primaries,'bt2020');
        assert.equal(stream.color_transfer,'smpte2084');
      }
      if(boundedSource)assert.ok(fs.statSync(file).size>32*1024*1024,'Bounded repair source must exceed the actual Episode cap.');
    }
  } else sources.forEach(file=>fs.writeFileSync(file,'read-only-series-fixture'));
  if(relatedFixture){
    const duplicateCast=process.env.HELIX_SERIES_DUPLICATE_CAST==='1'
      ?'<actor><name>Unlinked Fixture Actor</name><role>actor</role></actor>'.repeat(2):'';
    sources.forEach((file,index)=>{
      fs.writeFileSync(thumbnailSources[index],Buffer.from('unique-episode-thumbnail-'+index));
      fs.writeFileSync(file.replace(/\.[^.]+$/,'.nfo'),'<episodedetails><title>Episode '+(index+1)+'</title><season>1</season><episode>'+(index+1)+'</episode>'+ (process.env.HELIX_SERIES_NFO_GAP==='1'?'':'<plot>Source episode plot.</plot>')+duplicateCast+'</episodedetails>');
    });
  }
  if(concurrent){
    const batch=path.join(root,'source2','Batch B {tmdb-series-1399}','Season 01');
    fs.mkdirSync(batch,{recursive:true});fs.writeFileSync(path.join(batch,'Demo Show.S01E03.mkv'),'concurrent-third-series-fixture');
  }
  const secretRoot='disposable-series-routing-secret',initialized=initializeCleanData({
    dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot});
  const largePlot=episodeCount===24?'Complete episode narrative. '.repeat(200):undefined;
  const adapter=harness({episodePlot:largePlot}),providerCalls=[],artifactCalls=[],sharedArtifactCalls=[],appendCommitAudits=[],repairCommitAudits=[],offdeckCommitAudits=[];let unitOfWork,runtimeError,db,sharedRetryAttempted=false,sharedMaintenanceUnavailable=false,sharedRetirementFailure=false;
  const poster=await sharp({create:{width:4,height:6,channels:3,background:'#224466'}}).jpeg().toBuffer();
  let injectedDeleteFailures=0;
  let browserMediaPort;
  const nativeBrowserMedia=()=>{
    if(!browserMediaPort){
      const workspaceProductPort=require('../../src/clean-workspace-product-port').createCleanWorkspaceProductPort({
        schemaManifest,unitOfWork,rootPath:path.join(dataDir,'workspaces','libra')});
      const probe=require('../../src/clean-media-probe').createCleanMediaProbe({workspaceMaterialLocationResolver:workspaceProductPort.resolveMaterialLocation});
      browserMediaPort=require('../../src/clean-media-production-effect-port').createCleanMediaProductionEffectPort({
        workspaceProductPort,mediaProbe:probe,acceptanceScratchRoot:path.join(dataDir,'runtime','arca-acceptance-observation')});
    }
    return browserMediaPort;
  };
  const browserMedia=externalBrowser&&real?Object.fromEntries(['executeRemux','executeTranscode','verifyTranscodeInput','verifyPlayback','observeDiscPlayback'].map(method=>[method,async request=>{
    if(method==='executeRemux'||method==='executeTranscode')await new Promise(resolve=>setTimeout(resolve,12000));
    return nativeBrowserMedia()[method](request);
  }])):null;
  if(browserMedia)browserMedia.close=async()=>{await browserMediaPort?.close();};
  const deletionPort=require('../../src/clean-offdeck-deletion-port').createCleanOffdeckDeletionPort();
  let shutdownTriggered=false;
  const shutdownRegistry=require('../../src/clean-ffmpeg-process-registry').createFfmpegProcessRegistry();
  const shutdownOptions=shutdownRoot?{shutdownTimeoutMs:1,ffmpegProcessRegistry:{...shutdownRegistry,register(child){
    const result=shutdownRegistry.register(child);
    if(!shutdownTriggered&&child.spawnargs.some(arg=>['libx265','hevc_nvenc','hevc_qsv','hevc_vaapi'].includes(arg))&&child.spawnargs.includes('-progress')){
      shutdownTriggered=true;
      setImmediate(async()=>{
        try{await host.close();throw new Error('Active encode unexpectedly drained before checkpoint deadline');}
        catch(error){
          if(error.code!=='P4_SHUTDOWN_CHECKPOINT_TIMEOUT'){console.error(error);process.exit(75);}
          await new Promise(resolve=>setImmediate(resolve));
          const events=db.prepare("SELECT e.event_id,e.state,a.failure_code,a.outcome_kind,j.state effect_state FROM fx_workflow_events e JOIN fx_event_attempts a ON a.event_id=e.event_id LEFT JOIN fx_effect_journal j ON j.event_attempt_id=a.event_attempt_id WHERE e.capability_ref='libra.media.transcode@1'").all();
          fs.writeFileSync(path.join(root,'shutdown-boundary.json'),JSON.stringify({events,children:shutdownRegistry.size(),commits:db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n}));
          process.exit(74);
        }
      });
    }
    return result;
  }}}:{};
  let maintenanceClock=null,maintenanceClockStart=Date.now();
  const now=()=>maintenanceClock===null?Date.now():maintenanceClock+Date.now()-maintenanceClockStart;
  const hostOptions={dataDir,adminDistDir,secretRoot,now,afterSeriesPhysicalEffect:value=>{if(sharedRetirementFailure&&!value.reclaimed&&!value.location.replaceAll('\\','/').includes('/workspaces/aftercare/'))throw Object.assign(new Error('Injected maintenance publication failure'),{code:'EPERM'});if(process.env.HELIX_SERIES_SHARED_WRITE_FAILURE&&!sharedRetryAttempted){const workspace=value.location.replaceAll('\\','/').includes('/workspaces/aftercare/');if((process.env.HELIX_SERIES_SHARED_WRITE_FAILURE==='workspace-source-loss'?workspace&&value.location.replaceAll('\\','/').includes('/poster/'):((process.env.HELIX_SERIES_SHARED_WRITE_FAILURE==='workspace')===workspace)))throw Object.assign(new Error('Injected publication permission failure'),{code:'EPERM'});}
    if(!process.env.HELIX_SERIES_SHARED_CRASH_ROOT)return;
    const isWorkspace=value.location.replaceAll('\\','/').includes('/workspaces/aftercare/'),phase=process.env.HELIX_SERIES_SHARED_CRASH_PHASE||'publish';
    if((phase==='workspace'&&isWorkspace)||(phase==='publish'&&!isWorkspace)){
      fs.writeFileSync(path.join(root,'shared-crash-boundary.json'),JSON.stringify({phase,location:value.location,events:db.prepare("SELECT event_id,capability_ref,state FROM fx_workflow_events WHERE capability_ref LIKE 'arca.series_presentation.%'").all()}));process.exit(78);
    }
  },...shutdownOptions,...(external?{integrationFetch:async(input,init)=>{
    const pathname=new URL(input).pathname;
    if(externalBrowserFlow&&['/api/v1/search/title','/api/v1/download/add'].includes(pathname)&&!observedProviderStages.has(pathname)){
      observedProviderStages.add(pathname);await new Promise(resolve=>setTimeout(resolve,15000));
    }
    return externalProvider.fetch(input,init);
  },...(['exhausted','technical'].includes(external)?{platformComputeRuntime:require('../fixtures/series-external-host-provider').exhaustedComputeRuntime()}: {})}:{}),...(offdeck&&process.env.HELIX_SERIES_OFFDECK_DELETE_FAILURE==='1'?{
    offdeckDeletionPort:{inspect:deletionPort.inspect,execute(request){
      if(injectedDeleteFailures===0&&request.materialHandle.location.endsWith('.mkv')){
        injectedDeleteFailures++;throw Object.assign(new Error('Injected temporary Series deletion permission failure'),{code:'EPERM'});
      }
      return deletionPort.execute(request);
    }},
  }:{}),...((repair||migrate)?{aftercarePlaybackRunner:async()=>{}}:{}),...(browserMedia?{mediaProductionEffectPort:browserMedia}:{}),...(real?{}:{mediaProbe:mediaProbe(external),
    mediaProductionEffectPort:{
      async verifyPlayback(){return {samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('fixture-decode')};},
      async executeRemux(request){
        assert.ok(mixed,'Direct fixture must not Remux.');
        assert.equal(request.source.primaryMembers.length,1);
        assert.ok(request.source.primaryReadHandle.location.endsWith('S01E02.mp4'));
        const port=require('../../src/clean-workspace-product-port').createCleanWorkspaceProductPort({schemaManifest,unitOfWork,
          rootPath:path.join(dataDir,'workspaces','libra')});
        const target=request.outputTarget;
        return port.materializeMedia({libraRunId:target.libraRunId,workspaceId:target.workspaceId,relativePath:target.targetRelativePath,
          intentDigest:request.productionIntent.intentDigest,idempotencyKey:request.idempotencyKey,effectScopeDigest:target.effectScopeDigest,
          outputTargetId:target.targetId,outputTargetDigest:target.targetDigest,runtimeEffectAuthority:request.runtimeEffectAuthority,
          async produce(temporaryTarget){fs.copyFileSync(request.source.primaryReadHandle.location,temporaryTarget);}});
      },
      async executeTranscode(){throw new Error('Direct fixture must not Transcode.');},
      async verifyTranscodeInput(){if(external==='technical')throw Object.assign(new Error('Injected preflight process failure'),{code:'LIBRA_MEDIA_FFMPEG_FAILED'});throw new Error('Direct fixture must not assess Transcode.');},
    }}),
    unitOfWorkDecorator(value){
      unitOfWork=Object.freeze({...value,execute(participants,...args){
        if(participants.some(item=>item.participantId==='arca_series_retained_retirement')){const tables=['arca_series_presentation_scopes','fx_material_controls','fx_material_control_revisions','fx_command_receipts'],snapshot=()=>canonicalDigest(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])),before=snapshot(),domain=participants.find(item=>item.participantId==='arca_series_retained_retirement'),crash={participantId:'fixture_after_retained_retirement',owner:'arca',repositories:domain.repositories,execute(){throw new Error('Injected retained retirement commit interruption');}};assert.throws(()=>value.execute([...participants,crash],...args),/Injected retained retirement commit interruption/);assert.equal(snapshot(),before);return value.execute(participants,...args);}
        if(process.env.HELIX_SERIES_SHARED_CRASH_PHASE==='reclaim-commit'&&participants.some(item=>item.participantId==='arca_series_reclaimed_commit')){const result=value.execute(participants,...args);fs.writeFileSync(path.join(root,'shared-crash-boundary.json'),JSON.stringify({phase:'reclaim-commit',events:db.prepare("SELECT event_id,capability_ref,state FROM fx_workflow_events WHERE capability_ref='arca.series_presentation.workspace.reclaim@1'").all(),registries:db.prepare("SELECT state FROM fx_workspace_registry WHERE process_type='series_presentation'").all(),results:db.prepare("SELECT count(*) n FROM fx_event_result_bindings r JOIN fx_workflow_events e ON e.event_id=r.event_id WHERE e.capability_ref='arca.series_presentation.workspace.reclaim@1'").get().n}));process.exit(78);return result;}
        if(process.env.HELIX_SERIES_SHARED_CRASH_PHASE==='command'&&participants.some(item=>item.participantId==='arca_series_retry_receipt')){const result=value.execute(participants,...args);fs.writeFileSync(path.join(root,'shared-crash-boundary.json'),JSON.stringify({phase:'command',receipts:db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE command_contract='arca.series-presentation.retry@1'").get().n,builds:db.prepare('SELECT count(*) n FROM arca_series_presentation_builds').get().n,works:db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE work_kind='series_presentation'").get().n}));process.exit(78);return result;}
        if(external&&crashRoot&&participants.some(item=>item.participantId==='arca_ondeck_domain')) {
          const decision=JSON.parse(db.prepare('SELECT decision_json FROM arca_final_inventory_decisions').get().decision_json);
          const files=decision.members.map(member=>({member,sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(member.targetLocation)).digest('hex')}));
          assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
          assert.ok(sources.every(file=>!fs.existsSync(file)));
          fs.writeFileSync(path.join(root,'external-crash-boundary.json'),JSON.stringify({files,sources,
            providerFiles:externalProvider.files.map((file,index)=>({...file,sha256:externalProvider.fingerprints[index]})),
            downloadCalls:externalProvider.calls.filter(item=>item.method==='POST'&&item.path==='/api/v1/download/add').length,
            offload:db.prepare('SELECT * FROM libra_offload_context_materials').all(),
            produced:db.prepare("SELECT r.result_json FROM fx_event_result_bindings r JOIN fx_workflow_events e ON e.event_id=r.event_id WHERE e.capability_ref='libra.media.transcode@1' ORDER BY e.event_id").all()}));
          process.exit(73);
        }
        if(offdeck&&participants.some(item=>item.participantId==='arca_offdeck_terminal')) {
          if(process.env.HELIX_SERIES_OFFDECK_CRASH_ROOT&&path.resolve(process.env.HELIX_SERIES_OFFDECK_CRASH_ROOT)===root) {
            const entry=db.prepare('SELECT * FROM arca_shelf_entries').get(),materials=db.prepare('SELECT material_key,location,episode_claims_json FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=?').all(entry.shelf_entry_id,entry.current_inventory_revision);
            assert.equal(entry.status,'offdeck_in_progress');assert.ok(materials.every(item=>!fs.existsSync(item.location)));
            fs.writeFileSync(path.join(root,'crash-boundary.json'),JSON.stringify({entry,materials,
              deletionEvidence:db.prepare('SELECT * FROM arca_offdeck_deletion_evidence').all(),
              terminalReceipts:db.prepare('SELECT count(*) n FROM arca_offdeck_terminal_receipts').get().n,
              injectedDeleteFailures,caseCount:db.prepare('SELECT count(*) n FROM arca_offdeck_cases').get().n,
              authorizationCount:db.prepare('SELECT count(*) n FROM arca_offdeck_authorizations').get().n,
              unavailableAttempts:db.prepare("SELECT event_id,failure_class,failure_code FROM fx_event_attempts WHERE failure_code='ARCA_OFFDECK_ENDPOINT_UNAVAILABLE'").all()}));
            process.exit(73);
          }
          const tables=['arca_shelf_entries','arca_inventory_materials','arca_deck_fact_revisions','arca_offdeck_scopes',
            'arca_offdeck_authorizations','arca_offdeck_cases','arca_offdeck_terminal_receipts','fx_material_controls',
            'fx_material_control_revisions','fx_commit_markers','fx_event_result_bindings'];
          const snapshot=()=>JSON.stringify(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
          const before=snapshot(),domain=participants.find(item=>item.participantId==='arca_offdeck_terminal'),
            crash={participantId:'fixture_series_offdeck_crash',owner:'arca',repositories:domain.repositories,
              execute(){throw new Error('Injected offdeck terminal interruption');}};
          assert.throws(()=>value.execute([...participants,crash],...args),/Injected offdeck terminal interruption/);
          assert.equal(snapshot(),before);
          const result=value.execute(participants,...args);offdeckCommitAudits.push({rollbackVerified:true});return result;
        }
        if((repair||migrate||mediaRepair)&&participants.some(item=>item.participantId==='arca_aftercare_inventory_domain')) {
          if(mediaRepair&&process.env.HELIX_SERIES_AFTERCARE_CRASH_ROOT&&path.resolve(process.env.HELIX_SERIES_AFTERCARE_CRASH_ROOT)===root) {
            const entry=db.prepare('SELECT * FROM arca_shelf_entries').get();
            const materials=db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=?').all(entry.shelf_entry_id,entry.current_inventory_revision);
            const receipts=db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>restoreArcaResult(db,JSON.parse(row.result_json)))
              .filter(result=>result.receiptKind==='aftercare_output_materialized'&&result.materialEffectKind==='primary_replace');
            assert.equal(receipts.length,2);
            assert.ok(receipts.every(receipt=>fs.existsSync(receipt.targetLocation)));
            fs.writeFileSync(path.join(root,'aftercare-crash-boundary.json'),JSON.stringify({entry,materials,receipts,
              care:db.prepare('SELECT * FROM arca_aftercare_cases ORDER BY created_at_ms DESC').get(),
              commits:db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n}));
            process.exit(73);
          }
          const tables=['arca_shelf_entries','arca_inventory_materials','arca_inventory_product_facts','arca_inventory_representations',
            'arca_inventory_person_relations','arca_inventory_related_references','arca_aftercare_inventory_commits',
            'arca_aftercare_settlement_approvals','fx_material_controls','fx_material_control_revisions','fx_commit_markers','fx_event_result_bindings'];
          const snapshot=()=>JSON.stringify(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
          const before=snapshot(),domain=participants.find(item=>item.participantId==='arca_aftercare_inventory_domain'),
            crash={participantId:'fixture_series_care_crash',owner:'arca',repositories:domain.repositories,
              execute(){throw new Error('Injected aftercare transaction interruption');}};
          assert.throws(()=>value.execute([...participants,crash],...args),/Injected aftercare transaction interruption/);
          assert.equal(snapshot(),before);
          const result=value.execute(participants,...args);repairCommitAudits.push({rollbackVerified:true});return result;
        }
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
    routingProviderObservation:request=>{providerCalls.push(request);if(manualIdentity&&request.operationId==='libra.product_identity.evidence.observe@1'&&!request.intent.strongProviderAnchor)return [];return adapter.observe(request);},
    productIntegrationHandleResolver:request=>handle(request.operationId),
    currentProductIntegrationHandleResolver:request=>handle(request.operationId),
    seriesImageSourceResolver:source=>require('../../src/helix/contracts/series-image-source').buildImageSource({...source,integrationId:'tmdb-main',configRevision:sharedMaintenanceUnavailable==='assets'&&sharedRetryAttempted?2:1,language:'zh-CN'}),
    fetchSeriesPresentationMetadata:adapter.fetchSeriesMetadata,
    productProviderMetadataFetch:adapter.fetchMetadata,
    fetchSeriesPresentationArtifact:async request=>{if((process.env.HELIX_SERIES_SHARED_WRITE_FAILURE==='workspace-source-loss'&&sharedRetryAttempted)||(sharedMaintenanceUnavailable&&sharedMaintenanceUnavailable!=='assets')||(sharedMaintenanceUnavailable==='assets'&&!sharedRetryAttempted&&request.operationId==='arca.series_presentation.assets.prepare@1')||(process.env.HELIX_SERIES_SHARED_RETRY==='1'&&!sharedRetryAttempted)||process.env.HELIX_SERIES_SHARED_SUPPLEMENT==='1')return {resultKind:'not_available'};sharedArtifactCalls.push({operationId:request.operationId,kind:request.artifactKind,path:request.imagePath||null});
      return {resultKind:'acquired',imagePath:'/'+request.artifactKind+'.jpg',
      bytes:request.artifactKind==='poster'?poster:await sharp({create:{width:120,height:80,channels:3,background:'#334455'}}).jpeg().toBuffer()};},
    productProviderArtifactFetch:async request=>{artifactCalls.push(request);return {resultKind:'acquired',bytes:poster,artifactKind:request.artifactKind,
      integrationId:request.integrationHandle.integrationId,configRevision:request.integrationHandle.configRevision,
      mediaType:'image/jpeg',resolvedProviderIdentity:request.resolvedProviderIdentity};},
    onExecutionRuntimeError(error){runtimeError=error;}};
  const localShowFiles=[];if(process.env.HELIX_SERIES_LOCAL_SOURCE){const parent=path.dirname(source),providerKey=process.env.HELIX_SERIES_LOCAL_SOURCE==='foreign'?'999':'1399';
    for(const [name,bytes] of [['tvshow.nfo',Buffer.from('<tvshow><title>Local Demo Show</title><uniqueid type="tmdb">'+providerKey+'</uniqueid><plot>Original whole-show notes</plot></tvshow>')],['poster.jpg',poster],['fanart.jpg',await sharp({create:{width:160,height:90,channels:3,background:'#667733'}}).jpeg().toBuffer()]]){const location=path.join(parent,name);fs.writeFileSync(location,bytes);localShowFiles.push({location,bytes});}}
  let host=await createCleanServiceHost(hostOptions);
  t.after(async()=>{
    await sharedBrowserFlow?.close();
    await externalBrowserFlow?.close();
    await browserFlow?.close();
    await host.close();db?.close();
    assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('helix-series-routing-'));
    if(process.env.HELIX_SERIES_RETAIN_FIXTURE==='1')t.diagnostic(JSON.stringify({retainedFixtureRoot:root}));
    else fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});
  assert.equal(login.statusCode,204,login.body);let cookie=login.headers['set-cookie'];
  async function request(method,url,payload) {
    const response=await host.inject({method,url,headers:{cookie},payload});
    assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response;
  }
  if(coldBrowser) {
    const initial=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
    try {
      assert.equal(initial.prepare("SELECT count(*) n FROM arca_rule_templates WHERE owner_kind='user'").get().n,0);
      assert.equal(initial.prepare('SELECT count(*) n FROM arca_shelves').get().n,0);
      systemTemplateBefore=initial.prepare("SELECT * FROM arca_rule_template_revisions WHERE rule_template_id='system-beta-recommended' ORDER BY revision").all();
      assert.equal(systemTemplateBefore.length,1);
    }finally{initial.close();}
  }
  if(external){await externalProvider.configure(request);externalProvider.calls.length=0;}
  if(externalBrowser)externalBrowserFlow=await require('../fixtures/series-external-browser-observer').open({host,apiKey:initialized.adminApiKey,scenario:typeof external==='string'?external:undefined});
  if(!browserJourney)await request('POST','/v1/admin/settings/automatic-operation/actions/enable-full', {
    idempotencyKey:'series-settlement',expectedRevision:0,coverExclusiveRelatedInput:true});
  const policyValue={includedDirectories:[],excludedDirectories:[],allowedExtensions:(mixed||mediaRepair)?['.mkv','.mp4']:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
  const access={fieldId:'series-field',revision:1,endpointId:'series-endpoint',rootLocation:path.join(root,'source'),
    mountScopeId:'series-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/series-field-access/v1'};
  let sourceFieldId='series-field';
  if(browserJourney) {
    browserFlow=await require('../fixtures/series-browser-host-journey').open({host,apiKey:initialized.adminApiKey});
    sourceFieldId=await browserFlow.registerSource(path.join(root,'source'));
  } else await request('POST','/v1/admin/material-fields',{idempotencyKey:'series-register',fieldId:'series-field',name:'Series fixture',
    contentProfileHint:'series',policy:{extractionPolicyId:'series-policy',revision:1,
      policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy:policyValue,
      policyDigest:canonicalDigest({extractionPolicyId:'series-policy',revision:1,...policyValue})},
    access:{...access,accessDigest:canonicalDigest(access)}});
  let ruleTemplateId='system-beta-recommended',expectedTemplateRevision=1;
  if(bounded||mixed||mediaRepair||external){
    ruleTemplateId='series-bounded-template';expectedTemplateRevision=2;
    await request('POST','/v1/admin/rule-templates/system-beta-recommended/actions/copy',{
      idempotencyKey:'bounded-copy',sourceTemplateId:'system-beta-recommended',newTemplateId:ruleTemplateId,
      name:'Bounded Series fixture',expectedSourceRevision:1});
    const draft=(await request('GET','/v1/admin/rule-templates/'+ruleTemplateId+'/draft')).json().draft;
    const rules=structuredClone(draft.rules),profile=rules.profileRuleSets.find(item=>item.contentProfile==='series');
    for(const requirements of [profile.baseRequirements,...profile.decisionBranches.map(item=>item.requirements)]){
      if(externalMultipart)requirements.space={unit:'episode',maxSizeGiB:externalEpisodeCap/1073741824,maxSizeBytes:externalEpisodeCap};
      if(bounded)requirements.space={unit:'episode',maxSizeGiB:perEpisodeCap/1073741824,maxSizeBytes:perEpisodeCap};
      if(external&&!['exhausted','technical'].includes(external))Object.assign(requirements.mandatoryMedia,{minimumRasterClass:'4k',forbidSystemUpscaleFor4k:true});
      if(mixed||(external&&process.env.HELIX_SERIES_EXTERNAL_REMUX==='1'))requirements.mandatoryMedia.fileExtension='mkv';
      if(mediaRepair)Object.assign(requirements.mandatoryMedia,{videoCodec:'any',container:'any',fileExtension:'any'});
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
  const crossDevice=process.env.HELIX_SERIES_CROSS_DEVICE==='1';
  if(crossDevice)assert.equal(process.platform,'linux','Cross-device Host fixture requires Linux tmpfs.');
  const target=crossDevice?fs.mkdtempSync('/dev/shm/helix-series-target-'):path.join(root,'shelf');
  if(crossDevice){
    t.after(()=>{
      assert.equal(path.dirname(fs.realpathSync(target)),'/dev/shm');
      assert.ok(path.basename(target).startsWith('helix-series-target-'));
      fs.rmSync(target,{recursive:true,force:true});
    });
    assert.notEqual(fs.statSync(root).dev,fs.statSync(target).dev,'Source/Workspace and Shelf must be on different filesystems.');
    t.diagnostic(JSON.stringify({crossDevice:true,sourceDevice:fs.statSync(root).dev,targetDevice:fs.statSync(target).dev}));
  }else fs.mkdirSync(target);
  const sourceShelfId=browserJourney?await browserFlow.createShelf(target,ruleTemplateId):'series-shelf';
  if(!browserJourney)await request('POST','/v1/admin/shelves',{idempotencyKey:'series-shelf',shelfId:'series-shelf',name:'Series fixture',
    targetRootLocation:target,ruleTemplateId,expectedTemplateRevision,
    placementPolicy:{folderTemplate:'{title}',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',
      subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
  if(!browserJourney)await request('PATCH','/v1/admin/routing/material-fields/series-field',{idempotencyKey:'series-routing',fieldId:'series-field',
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
  const deps={schemaManifest,unitOfWork};
  if(browserJourney) {
    await browserFlow.routeAndScan();
    assert.equal((await request('GET','/v1/admin/material-fields')).json().items.find(item=>item.fieldId===sourceFieldId).currentProfileHintSnapshot.contentProfileHint,'series');
  } else if(!procurementOnly) await request('POST','/v1/admin/material-fields/series-field/actions/observe',{
    idempotencyKey:'series-observe',fieldId:'series-field',expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  if(concurrent)await request('POST','/v1/admin/material-fields/series-field-2/actions/observe',{
    idempotencyKey:'series-observe-2',fieldId:'series-field-2',expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  if(procurementOnly) {
    const until=Date.now()+180000;
    while(!db.prepare("SELECT count(*) n FROM proc_procurement_runs WHERE state='sealed'").get().n&&Date.now()<until)
      await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(db.prepare("SELECT count(*) n FROM proc_procurement_runs WHERE state='sealed' AND seal_outcome='completed'").get().n,1,
      JSON.stringify({runs:db.prepare('SELECT state,seal_outcome FROM proc_procurement_runs').all(),
        failures:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),
        incidents:db.prepare('SELECT error_code FROM fx_executor_incidents').all()}));
    const packages=db.prepare('SELECT * FROM proc_candidate_packages').all();
    assert.equal(packages.length,1);assert.equal(packages[0].content_profile,'series');
    assert.equal(packages[0].structure_kind,'season');
    assert.equal(db.prepare('SELECT count(*) n FROM proc_candidate_primary_materials').get().n,episodeCount);
    const metadata=JSON.parse(packages[0].identity_metadata_json);
    assert.ok(Buffer.byteLength(packages[0].identity_claim_json)>16384);
    assert.ok(Buffer.byteLength(packages[0].identity_claim_json)<=65536);
    assert.equal(JSON.parse(packages[0].identity_claim_json).sourceHints.length,metadata.sourceHints.length);
    assert.equal(metadata.sourceHints.filter(h=>h.hintKind==='filename_title').length,episodeCount);
    const pages=db.prepare("SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e USING(event_id) WHERE e.capability_ref='procurement.triage.structure.inspect@1'").all().map(row=>JSON.parse(row.result_json));
    const records=pages.flatMap(page=>page.units);
    assert.equal(records.length,1);assert.equal(records[0].memberCount,episodeCount);
    assert.equal(records[0].recordKind,'series_unit');assert.ok(records[0].unitCanonicalBytes>65536);
    assert.ok(pages.every(page=>Buffer.byteLength(JSON.stringify(page))<=65536));
    assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE owner_domain='procurement' AND state='failed'").get().n,0);
    const triageReader=require('../../src/helix/domains/procurement/persistence/procurement-run-triage-reader')
      .createProcurementRunTriageReader({...deps,now:Date.now});
    const workResultReader=require('../../src/helix/foundation/execution/work-result-reader').createWorkResultReader(deps);
    const {createStructureInputProjection}=require('../../src/helix/domains/procurement/planning/evidence-assessment-planner');
    const projection=createStructureInputProjection({triageReader});
    const options={workResultReader,structureInputProjection:projection,
      triageRuleRegistry:require('../../src/helix/domains/procurement/model/procurement-run-contracts').createDefaultTriageRuleRegistry()};
    const work=db.prepare("SELECT work_id FROM fx_supporting_works WHERE owner_domain='procurement' AND work_kind='evidence_assessment'").get();
    const rebuilt=require('../../src/helix/domains/procurement/persistence/triage-evidence-index').createTriageEvidenceIndex(options).read(work.work_id);
    assert.equal(rebuilt.units.length,1);assert.equal(rebuilt.units[0].unit.members.length,episodeCount);
    assert.equal(rebuilt.units[0].unit.unitDigest,packages[0].structure_unit_digest);
    assert.deepEqual(rebuilt.units[0].unit.identityMetadata,metadata);
    const sourceResults=workResultReader.read(work.work_id).filter(row=>row.outcomeKind==='succeeded');
    const parameters={runId:packages[0].procurement_run_id,pageOrdinal:pages[0].pageOrdinal,cursorIn:pages[0].cursorIn,maxUnits:records[0].pageMaxUnits};
    const changedCurrent=createStructureInputProjection({triageReader:{read(runId){
      const snapshot=structuredClone(triageReader.read(runId));
      for(const material of snapshot.materials){material.current.last_snapshot_digest=D('later-observation');
        material.readHandle.location='unrelated/current/path';material.readHandle.endpointId='unrelated-endpoint';}
      return snapshot;
    }}});
    assert.deepEqual(changedCurrent.project({sourceResults,parameters}),projection.project({sourceResults,parameters}));
    t.diagnostic(JSON.stringify({procurementPublished:true,episodes:episodeCount,unitBytes:records[0].unitCanonicalBytes,
      structureBytes:pages.map(page=>Buffer.byteLength(JSON.stringify(page)))}));
    return;
  }
  if(coldBrowser) {
    assert.equal(db.prepare("SELECT count(*) n FROM arca_rule_templates WHERE owner_kind='user'").get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_shelves').get().n,1);
    assert.deepEqual(db.prepare("SELECT * FROM arca_rule_template_revisions WHERE rule_template_id='system-beta-recommended' ORDER BY revision").all(),systemTemplateBefore);
  }

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
  if(manualIdentity){
    let pending;const until=Date.now()+90000;
    do {
      const response=await request('GET','/v1/admin/formation?section=active');
      pending=JSON.parse(response.body).items.find(item=>item.productIdentityIssue);
      if(pending)break;
      assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<until);
    assert.ok(pending,'Series no-match must remain available for manual selection');
    const run=pending.currentRun;
    const before=db.prepare('SELECT execution_basis_digest,run_material_manifest_id FROM libra_runs WHERE libra_run_id=?').get(run.libraRunId);
    if(browserJourney) {
      await browserFlow.chooseIdentity();
    } else {
    const preview=JSON.parse((await request('GET','/v1/admin/formation/runs/'+run.libraRunId+'/product-identity-preview?tmdbSeriesId=1399')).body);
    assert.equal(preview.tmdbSeriesId,'1399');assert.equal(preview.seasonNumber,1);
    const receipt=JSON.parse((await request('POST','/v1/admin/formation/runs/'+run.libraRunId+'/actions/choose-product-identity',{
      tmdbSeriesId:'1399',expectedRunStateRevision:run.stateRevision,expectedIdentityRevision:run.currentIdentityRevision,
      candidateSetDigest:pending.productIdentityIssue.candidateSetDigest,idempotencyKey:'manual-series-host'})).body);
    assert.equal(receipt.namespace,'tmdb_series');assert.equal(receipt.seasonNumber,1);
    }
    assert.deepEqual(db.prepare('SELECT execution_basis_digest,run_material_manifest_id FROM libra_runs WHERE libra_run_id=?').get(run.libraRunId),before);
  }
  let state;let lastDiagnostic=0;const diagnosticStart=Date.now();
  const deadline=Date.now()+(episodeCount===77&&process.env.HELIX_SERIES_SETTLEMENT_DIAGNOSTICS==='1'?4700000:episodeCount>=17&&relatedFixture?2300000:longMedia?800000:episodeCount>47?1100000:real||episodeCount>32?220000:100000);
  do {
    state={subjects:db.prepare('SELECT * FROM libra_subjects').all(),routes:db.prepare('SELECT * FROM libra_routing_decisions').all(),
      specs:db.prepare('SELECT * FROM libra_acceptance_specs').all(),runs:db.prepare('SELECT * FROM libra_runs').all(),
      works:db.prepare('SELECT work_id,work_kind,state FROM fx_supporting_works').all(),
      facts:db.prepare('SELECT * FROM libra_product_fact_revisions').all()};
    if(process.env.HELIX_SERIES_SETTLEMENT_DIAGNOSTICS==='1'&&Date.now()-lastDiagnostic>=30000){
      lastDiagnostic=Date.now();
      const events=db.prepare("SELECT capability_ref,state,count(*) n FROM fx_workflow_events GROUP BY capability_ref,state").all();
      const attempts=db.prepare("SELECT e.capability_ref,count(*) n,sum(a.finished_at_ms-a.started_at_ms) totalMs,max(a.finished_at_ms) lastFinishedAtMs FROM fx_event_attempts a JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE a.finished_at_ms IS NOT NULL GROUP BY e.capability_ref").all();
      console.error(JSON.stringify({seriesHostProgress:{elapsedMs:Date.now()-diagnosticStart,events,attempts}}));
    }
    if((process.env.HELIX_SERIES_SHARED_RETRY==='1'||process.env.HELIX_SERIES_SHARED_SUPPLEMENT==='1'||process.env.HELIX_SERIES_SHARED_WRITE_FAILURE)&&!sharedRetryAttempted&&state.works.some(row=>row.work_kind==='series_presentation'&&row.state==='failed')){
      const subject=db.prepare('SELECT subject_id FROM libra_runs').get().subject_id,detail=(await request('GET','/v1/admin/formation/'+subject)).json();
      assert.equal(detail.classification,'attention_required');assert.equal(detail.executorIssue.canRetry,true);if(process.env.HELIX_SERIES_SHARED_WRITE_FAILURE)assert.equal(detail.executorIssue.canSupplyImages,process.env.HELIX_SERIES_SHARED_WRITE_FAILURE!=='publish');
      assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,0);
      sharedRetryAttempted=true;const supplementalImages=process.env.HELIX_SERIES_SHARED_WRITE_FAILURE==='workspace-source-loss'?[{artifactKind:'fanart',bytesBase64:(await sharp({create:{width:120,height:80,channels:3,background:'#443322'}}).jpeg().toBuffer()).toString('base64')}]:process.env.HELIX_SERIES_SHARED_SUPPLEMENT==='1'?[{artifactKind:'poster',bytesBase64:poster.toString('base64')},
        {artifactKind:'fanart',bytesBase64:(await sharp({create:{width:120,height:80,channels:3,background:'#443322'}}).jpeg().toBuffer()).toString('base64')}]:null;
      if(process.env.HELIX_SERIES_SHARED_BROWSER==='1')sharedBrowserFlow=await require('../fixtures/series-shared-retry-browser').retry({host,apiKey:initialized.adminApiKey,poster,
        fanart:Buffer.from(supplementalImages[1].bytesBase64,'base64'),output:process.env.HELIX_SERIES_BROWSER_OUTPUT});
      else {sharedRetryOffer=detail.handoffB.offerId;sharedRetryCommand={idempotencyKey:'shared-task-retry',...(supplementalImages?{supplementalImages}:{})};await request('POST','/v1/admin/formation/acceptance/'+sharedRetryOffer+'/actions/retry',sharedRetryCommand);}
    }
    // Observe the complete Arca transaction, including authorized source settlement.
    if(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n===1||db.prepare("SELECT count(*) n FROM arca_acceptance_decisions WHERE result='rejected'").get().n>0||
        (!['exhausted','technical'].includes(external)&&state.works.some(work=>work.state==='failed'&&!(sharedRetryAttempted&&work.work_kind==='series_presentation')))||(typeof external==='string'&&state.runs.some(run=>run.state==='frozen')))break;
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
  if (episodeCount === 2 && !append && !anchored && !mixed && !bounded && !migrate && !repair && !multiSeason && !external && !real && !manualIdentity) {
    let intakeReads = 0, mutation = null, firstIntake = null;
    const observedUnitOfWork = { execute(participants) {
      return unitOfWork.execute(participants.map(participant => ({ ...participant, execute(context) {
        return participant.execute({ ...context, repository(id) {
          const repository = context.repository(id);
          return { invoke(statement, values) {
            let result = statement === 'find_intake' && values.intake_decision_id === 'second-intake'
              ? { ...firstIntake } : repository.invoke(statement, values);
            if (statement === 'find_intake') {
              intakeReads += 1;
              firstIntake = result;
              if (mutation === 'delivery') result = { ...result, candidate_delivery_snapshot_json:'{}' };
              if (mutation === 'different-package' && values.intake_decision_id === 'second-intake') {
                const delivery = JSON.parse(result.candidate_delivery_snapshot_json);
                delivery.candidatePackage.displayIdentity = 'Different package';
                result = { ...result, candidate_delivery_snapshot_json:JSON.stringify(delivery) };
              }
            }
            if (statement === 'list_members' && ['different-intake', 'different-package'].includes(mutation)) result = result.map((row, index) =>
              index === 1 ? { ...row, origin_intake_decision_id:'second-intake' } : row);
            if (statement === 'list_members' && mutation === 'origin') result = result.map((row, index) =>
              index === 1 ? { ...row, origin_offer_id:'foreign-offer' } : row);
            if (statement === 'list_members' && mutation === 'primary') result = result.map((row, index) =>
              index === 1 ? { ...row, location:'foreign-location' } : row);
            return result;
          } };
        } });
      } })));
    } };
    const reader = createMovieProductionReader({ schemaManifest, unitOfWork:observedUnitOfWork });
    assert.deepEqual(reader.readRunSnapshot(state.runs[0].libra_run_id), sourceSnapshot);
    assert.equal(intakeReads, 1, 'A shared accepted Handoff A is read once within one snapshot.');
    reader.readRunSnapshot(state.runs[0].libra_run_id);
    assert.equal(intakeReads, 2, 'A later snapshot must read current persisted facts again.');
    mutation = 'origin';
    assert.throws(() => reader.readRunSnapshot(state.runs[0].libra_run_id), { code:'P14_MOVIE_PRODUCTION_HANDOFF_DRIFT' });
    mutation = 'primary';
    assert.throws(() => reader.readRunSnapshot(state.runs[0].libra_run_id), { code:'P14_MOVIE_PRODUCTION_PRIMARY_DRIFT' });
    mutation = 'delivery';
    assert.throws(() => reader.readRunSnapshot(state.runs[0].libra_run_id), { code:'P14_MOVIE_PRODUCTION_HANDOFF_DRIFT' });
    mutation = 'different-intake';
    intakeReads = 0;
    reader.readRunSnapshot(state.runs[0].libra_run_id);
    assert.equal(intakeReads, 2, 'Distinct Intake decisions must be read and compared independently.');
    mutation = 'different-package';
    assert.throws(() => reader.readRunSnapshot(state.runs[0].libra_run_id), { code:'P14_MOVIE_PRODUCTION_HANDOFF_DRIFT' });
  }
  const directWork=state.works.find(work=>work.work_id.startsWith('libra-workspace-media-direct_selection-work-'));
  assert.equal(directWork?.state,'succeeded',JSON.stringify({works:state.works,events:db.prepare(
    'SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
  if(typeof external==='string'){
    if(externalBrowserFlow)await externalBrowserFlow.finish({failed:true});
    const sourceBefore=sources.map(file=>({bytes:fs.readFileSync(file),stat:fs.statSync(file,{bigint:true})}));
    const discardFromBrowser=async()=>{
      if(!externalBrowserFlow)return;
      await externalBrowserFlow.discard(discarded=>{
        assert.equal(db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(state.runs[0].libra_run_id).state,discarded?'discarded':'frozen');
        assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,0);
        sources.forEach((file,index)=>{const after=fs.statSync(file,{bigint:true});assert.deepEqual(fs.readFileSync(file),sourceBefore[index].bytes);
          for(const key of ['ino','mtimeNs','ctimeNs'])assert.equal(after[key],sourceBefore[index].stat[key]);});
      });
    };
    assert.equal(state.runs[0].state,'frozen',JSON.stringify(state.works));
    if(external==='technical'){
      assert.equal(externalProvider.calls.filter(item=>item.path==='/api/v1/search/title'||item.method==='POST').length,0);
      assert.ok(sources.every(file=>fs.readFileSync(file,'utf8')==='read-only-series-fixture'));
      const failed=db.prepare("SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL").all();
      assert.ok(failed.length>0);assert.ok(failed.every(row=>row.failure_code==='LIBRA_MEDIA_FFMPEG_FAILED'));
      assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,0);
      await discardFromBrowser();
      return;
    }
    const selection=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-external-select-event-%'").all();
    assert.equal(selection.length,1);assert.equal(JSON.parse(selection[0].result_json).result,'not_selected');
    if(external==='exhausted'){
      const verificationRows=db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>restoreArcaResult(db,JSON.parse(row.result_json)))
        .filter(row=>row.schemaRef==='helix://contracts/types/TranscodeInputVerification/v1');
      assert.equal(verificationRows.length,1);assert.equal(verificationRows[0].disposition,'strategy_rejected');
      assert.ok(verificationRows[0].reasonCodes.includes('source_pixel_format_unsupported'));
      assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.media.transcode@1'").get().n,0);
      const failed=db.prepare("SELECT a.failure_code FROM fx_supporting_works w JOIN fx_work_attempts a ON a.work_id=w.work_id WHERE w.state='failed'").all();
      assert.deepEqual(failed.map(row=>row.failure_code),['media_device_strategies_exhausted']);
      const terminal=JSON.parse(db.prepare("SELECT transition_evidence_json FROM libra_run_revisions WHERE state='frozen' ORDER BY state_revision DESC LIMIT 1").get().transition_evidence_json);
      assert.equal(terminal.blockerKind,'product_unachievable');assert.equal(terminal.blockedWorks[0].failureCode,'no_available_candidate');
    }
    assert.equal(externalProvider.calls.filter(item=>item.method==='POST').length,0);
    assert.ok(sources.every(file=>fs.existsSync(file)));assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,0);
    assert.ok(state.works.some(work=>work.work_id.startsWith('libra-external-material-search_selection-work-')&&work.state==='succeeded'));
    await discardFromBrowser();
    return;
  }
  assert.ok(state.works.some(work=>work.work_kind==='product_conformance'&&work.state==='succeeded'),JSON.stringify({works:state.works,incidents:db.prepare('SELECT * FROM fx_executor_incidents').all(),events:db.prepare('SELECT * FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),attempts:db.prepare("SELECT * FROM fx_work_attempts WHERE failure_code IS NOT NULL").all()}));
  assert.ok(state.works.some(work=>work.work_kind==='deliverable_promotion'&&work.state==='succeeded'),JSON.stringify({eventStates:db.prepare("SELECT event_id,capability_ref,state,retry_at_ms FROM fx_workflow_events WHERE owner_domain='arca'").all(),checks:db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'accept-%'").all(),decisions:db.prepare('SELECT * FROM arca_acceptance_decisions').all(),works:state.works,events:db.prepare('SELECT * FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),attempts:db.prepare("SELECT * FROM fx_work_attempts WHERE failure_code IS NOT NULL").all()}));
  assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,1,JSON.stringify({eventStates:db.prepare("SELECT event_id,capability_ref,state,retry_at_ms FROM fx_workflow_events WHERE owner_domain='arca'").all(),checks:db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'accept-%'").all(),decisions:db.prepare('SELECT * FROM arca_acceptance_decisions').all(),works:state.works,events:db.prepare('SELECT * FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),attempts:db.prepare("SELECT * FROM fx_work_attempts WHERE failure_code IS NOT NULL").all()}));
  if(episodeCount===77) {
    if(relatedFixture && process.env.HELIX_SERIES_NFO_GAP==='1') {
      const observations=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/capabilities/libra.product_metadata.fetch/v1/result' AND outcome_kind='succeeded'").all().map(row=>JSON.parse(row.result_json));
      assert.equal(observations.length,232);
      assert.equal(observations.filter(item=>item.sourceKind==='related_nfo').length,154);
      assert.equal(observations.filter(item=>item.sourceKind==='provider').length,78);
      t.diagnostic(JSON.stringify({mixedMetadataObservations:observations.length}));
    }

    assert.equal(adapter.calls.filter(url=>url.pathname.includes('/episode/')).length,0,
      'Complete Season metadata must serve every frozen Episode without per-Episode HTTP.');
    t.diagnostic(JSON.stringify({metadataShowRequests:adapter.calls.filter(url=>
      url.searchParams.get('append_to_response')==='credits,alternative_titles,translations').length}));
  }
  if(episodeCount>32){
    const ownerStage=db.prepare('SELECT manifest_json,record_json FROM arca_staged_manifest_records').all();
    const ownerFinal=db.prepare('SELECT verification_json,record_json FROM arca_inventory_verification_records').all();
    assert.equal(ownerStage.length,1);assert.equal(ownerFinal.length,2);
    assert.ok(Buffer.byteLength(ownerStage[0].manifest_json)>65536);
    assert.ok(ownerFinal.every(row=>Buffer.byteLength(row.verification_json)>65536));
    assert.ok([...ownerStage,...ownerFinal].every(row=>Buffer.byteLength(row.record_json)<65536));
    assert.equal(db.prepare('SELECT max(length(CAST(result_json AS BLOB))) n FROM fx_event_result_bindings').get().n<=65536,true);
    assert.equal(db.prepare('SELECT max(length(CAST(evidence_json AS BLOB))) n FROM fx_event_result_bindings').get().n<=65536,true);
    const commitEvidence=db.prepare("SELECT evidence_json,evidence_digest FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/types/OnDeckCommitResult/v1'").get();
    const fulfillmentRecord=JSON.parse(ownerFinal.find(row=>JSON.parse(row.verification_json).verificationKind==='on_deck_fulfillment').record_json);
    assert.deepEqual(JSON.parse(commitEvidence.evidence_json),fulfillmentRecord);
    assert.equal(commitEvidence.evidence_digest,canonicalDigest(fulfillmentRecord));
    t.diagnostic(JSON.stringify({episodes:episodeCount,stageBytes:Buffer.byteLength(ownerStage[0].manifest_json),
      finalEvidenceBytes:ownerFinal.map(row=>Buffer.byteLength(row.verification_json)),boundedFoundationResults:true}));
  }
  if(external){
    const offload=db.prepare('SELECT * FROM libra_offload_context_materials').all();
    const expectedFinalCount=externalMultipart?3:2;
    assert.equal(offload.length,1);assert.equal(JSON.parse(offload[0].final_product_material_keys_json).length,expectedFinalCount);
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get();
    const final=db.prepare("SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=? AND role='primary_payload'").all(entry.shelf_entry_id,entry.current_inventory_revision);
    assert.equal(final.length,expectedFinalCount);assert.ok(final.every(item=>fs.existsSync(item.location)));
    const packageKeys=db.prepare("SELECT material_key FROM libra_product_package_materials WHERE role='primary_payload'").all().map(item=>item.material_key).sort();
    assert.deepEqual(JSON.parse(offload[0].final_product_material_keys_json).sort(),packageKeys);
    const results=db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>restoreArcaResult(db,JSON.parse(row.result_json)));
    const staged=results.filter(result=>Array.isArray(result.stagedMembers));
    assert.equal(staged.length,1);
    const stagedPrimary=staged[0].stagedMembers.filter(item=>item.role==='primary_payload');
    assert.deepEqual(stagedPrimary.map(item=>item.sourceMaterialKey).sort(),packageKeys);
    assert.deepEqual(stagedPrimary.map(item=>item.physicalIdentity.materialKey).sort(),final.map(item=>item.material_key).sort());
    if(process.env.HELIX_SERIES_EXTERNAL_REMUX==='1'||process.env.HELIX_SERIES_EXTERNAL_TRANSCODE==='1') {
      const capability=process.env.HELIX_SERIES_EXTERNAL_TRANSCODE==='1'?'libra.media.transcode@1':'libra.media.remux@1';
      const processed=db.prepare('SELECT r.result_json FROM fx_event_result_bindings r JOIN fx_workflow_events e ON e.event_id=r.event_id WHERE e.capability_ref=?').all(capability);
      assert.equal(processed.length,expectedFinalCount);
      assert.deepEqual(processed.map(row=>JSON.parse(row.result_json).workspaceMaterialHandle.materialKey).sort(),packageKeys);
    }
    assert.deepEqual(final.flatMap(item=>JSON.parse(item.episode_claims_json).items.map(claim=>claim.episodeKey)).sort(),externalMultipart?['E001','E001','E002']:['E001','E002']);
    assert.equal(externalProvider.calls.filter(item=>item.method==='POST'&&item.path==='/api/v1/download/add').length,1);
    assert.ok(sources.every(file=>!fs.existsSync(file)));assert.ok(externalProvider.files.every(file=>fs.existsSync(file.location)));
    assert.deepEqual(externalProvider.files.map(item=>require('node:crypto').createHash('sha256').update(fs.readFileSync(item.location)).digest('hex')),
      externalProvider.fingerprints,'Import and settlement must leave Provider files byte-identical.');
    if(real) {
      for(const member of final) {
        const probe=require('node:child_process').spawnSync(process.env.FFPROBE_PATH||require('@ffprobe-installer/ffprobe').path,
          ['-v','error','-show_streams','-show_format','-of','json',member.location],{encoding:'utf8',windowsHide:true,timeout:30000});
        assert.equal(probe.status,0,probe.stderr);
        const result=JSON.parse(probe.stdout),video=result.streams.find(item=>item.codec_type==='video');
        assert.equal(video.codec_name,'hevc');assert.equal(video.width,3840);assert.equal(video.height,2160);
        assert.ok(result.streams.some(item=>item.codec_type==='audio'&&item.codec_name==='aac'));
        assert.ok(Number(result.format.duration)>=3);
      }
      assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.media.remux@1'").get().n,process.env.HELIX_SERIES_EXTERNAL_REMUX==='1'?2:0);
      assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.media.transcode@1'").get().n,process.env.HELIX_SERIES_EXTERNAL_TRANSCODE==='1'?expectedFinalCount:0);
      if(externalMultipart) {
        const allocate=require('../../src/helix/contracts/episode-byte-allocation').evaluateSeriesEpisodeSpace;
        const allocations=allocate({episodeKeys:['E001','E002'],maxSizeBytes:externalEpisodeCap,members:final.map(item=>({
          materialKey:item.material_key,role:item.role,sizeBytes:fs.statSync(item.location).size,episodeClaims:JSON.parse(item.episode_claims_json).items}))});
        assert.ok(allocations.every(item=>item.withinLimit));
        const originalVerify=results.filter(item=>item.schemaRef==='helix://contracts/types/ProductMediaVerification/v1'&&item.result==='failed');
        assert.ok(originalVerify.some(item=>item.reasonCodes.includes('max_size_exceeded')));
        const waitingParts=originalVerify.filter(item=>item.candidateNodeId.startsWith('transcode_output_')&&
          item.reasonCodes.length===1&&item.reasonCodes[0]==='max_size_exceeded');
        assert.equal(waitingParts.length,2,'Both Episode 1 parts must retain their failed single-output aggregate Verification.');
        const checks=results.filter(item=>item.schemaRef==='helix://contracts/types/AcceptanceCheck/v1'&&item.checkKind==='space');
        assert.equal(checks.length,1);assert.equal(checks[0].result,'passed');
        assert.equal(checks[0].episodeSpaceEvidence.maxSizeBytes,externalEpisodeCap);
        assert.deepEqual(checks[0].episodeSpaceEvidence.allocations.map(item=>({key:item.episodeKey,bytes:item.allocatedBytes})),
          allocations.map(item=>({key:item.episodeKey,bytes:item.allocatedBytes})));
      }
      if(process.env.HELIX_SERIES_EXTERNAL_REMUX==='1')assert.ok(final.every(item=>path.extname(item.location)==='.mkv'));
      t.diagnostic(JSON.stringify({externalMultipart,externalTranscode:process.env.HELIX_SERIES_EXTERNAL_TRANSCODE==='1',externalRemux:process.env.HELIX_SERIES_EXTERNAL_REMUX==='1',realExternal:true,finalPrimaries:final.length,episodeKeys:['E001','E002'],codec:'hevc',raster:'3840x2160',audio:'aac',singleAcquisition:true}));
    }
    if(externalBrowserFlow){
      const collection=(await request('GET','/v1/admin/collection?status=current')).json().items;
      assert.equal(collection.length,1);
      await externalBrowserFlow.finish({failed:false,entry:collection[0]});
    }
    return;
  }
  if(bounded){
    const checks=db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>restoreArcaResult(db,JSON.parse(row.result_json)))
      .filter(result=>result.schemaRef==='helix://contracts/types/AcceptanceCheck/v1'&&result.checkKind==='space');
    assert.equal(checks.length,1);assert.equal(checks[0].result,'passed');
    assert.deepEqual(checks[0].episodeSpaceEvidence.allocations.map(item=>({key:item.episodeKey,...item.allocatedBytes,withinLimit:item.withinLimit})),
      episodeKeys.map(key=>({key,numerator:String(perEpisodeCap),denominator:'1',withinLimit:true})));
    assert.equal(checks[0].episodeSpaceEvidence.maxSizeBytes,perEpisodeCap);
  }
  const packages=db.prepare('SELECT * FROM libra_product_packages').all();
  assert.equal(packages.length,1);
  const provenance=JSON.parse(packages[0].production_provenance_json);
  const readSet=provenance.shelfAcceptancePrimaryReadSet;
  assert.equal(readSet.primaryInputs.length,physicalCount);
  assert.equal(new Set(readSet.primaryInputs.map(item=>item.materialKey)).size,physicalCount);
  const packaged=db.prepare('SELECT * FROM libra_product_package_materials WHERE on_deck_package_id=?').all(packages[0].on_deck_package_id);
  const primary=packaged.filter(item=>item.role==='primary_payload');
  assert.equal(primary.length,physicalCount);
  assert.equal(packaged.filter(item=>item.role==='metadata_sidecar').length,episodeCount+1);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_product_package_material_episode_claims').get().n,nm?3:parts?2:episodeCount);
  for(const item of readSet.primaryInputs) {
    const member=primary.find(row=>row.material_key===item.materialKey);
    assert.ok(member);assert.equal(item.productMemberDigest,member.member_digest);
    assert.equal(item.productMediaVerification.result,'passed');assert.equal(item.samePhysicalMaterial,mediaRepair||!(nm||item.sourceReadHandle.location.endsWith('.mp4')||(real&&item.sourceReadHandle.location.endsWith('S01E03.mkv'))));
    assert.equal(item.productReadHandleDigest,canonicalDigest(item.productReadHandle));
    if(item.samePhysicalMaterial)assert.equal(item.sourceReadHandleDigest,item.productReadHandleDigest);
    else assert.notEqual(item.sourceReadHandleDigest,item.productReadHandleDigest);
  }
  const conformance=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-product-conformance-event-%'").all();
  assert.equal(conformance.length,1);assert.equal(JSON.parse(conformance[0].result_json).result,'passed');
  const directResults=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-direct-media-verify-event-%'").all()
    .map(item=>restoreArcaResult(db,JSON.parse(item.result_json)));
  const selections=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-direct-media-select-event-%'").all()
    .map(item=>restoreArcaResult(db,JSON.parse(item.result_json)));
  assert.equal(directResults.length,physicalCount);assert.equal(selections.length,physicalCount);
  assert.equal(new Set(directResults.map(item=>item.productMaterialHandleDigest)).size,physicalCount);
  if(mixed) {
    assert.equal(directResults.filter(item=>item.result==='failed').length,real?2:1);
    assert.equal(selections.filter(item=>item.result==='selected').length,nm?0:1);
    const final=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-series-final-verify-event-%'").all();
    assert.equal(final.length,physicalCount);assert.ok(final.every(item=>JSON.parse(item.result_json).result==='passed'));
    assert.equal(readSet.primaryInputs.filter(item=>!item.samePhysicalMaterial).length,real?2:1);
    const offload=db.prepare("SELECT * FROM libra_offload_context_materials WHERE context_role='original_input'").all();
    assert.equal(offload.length,physicalCount+(relatedFixture?physicalCount*2:0));
    for(const item of offload) {
      const processed=nm||item.location.endsWith('.mp4')||(real&&item.location.endsWith('S01E03.mkv'));
      assert.equal(item.disposition_kind,processed?'replaced_and_settled':'carried_forward');
      assert.equal(item.settlement_expectation,processed?'remove_after_place':'replace_or_move');
      assert.ok(primary.some(member=>member.material_key===item.final_product_material_key));
      if(processed)assert.notEqual(item.final_product_material_key,item.material_key);
      else assert.equal(item.final_product_material_key,item.material_key);
    }
  } else {
    for(const result of directResults)assert.equal(result.result,'passed',JSON.stringify(result));
    assert.deepEqual(selections.map(item=>item.selectedVerificationId).sort(),directResults.map(item=>item.verificationId).sort());
  }
  if(real&&!mediaRepair) {
    const produced=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-remux-media-event-%' OR event_id LIKE 'libra-transcode-media-event-%'").all().map(item=>restoreArcaResult(db,JSON.parse(item.result_json)));
    assert.deepEqual(produced.map(item=>item.productionIntentKind).sort(),['encode','remux']);
    assert.equal(new Set(produced.map(item=>item.sourceMaterialHandleDigest)).size,2);
    const encoded=produced.find(item=>item.productionIntentKind==='encode');
    assert.ok(encoded.executionDeviceRef?.deviceSnapshotDigest);
    const assessment=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-transcode-input-verify-event-%'").all().map(item=>restoreArcaResult(db,JSON.parse(item.result_json)));
    assert.ok(assessment.some(item=>item.disposition==='compatible'&&item.passedSampleCount===24));
    t.diagnostic(JSON.stringify({realMedia:true,nm:Boolean(nm),episodes:episodeCount,processed:produced.map(item=>({kind:item.productionIntentKind,
      device:item.executionDeviceRef?.deviceClass||null})),assessmentResults:assessment.length}));
  }
  const sourceProbes=db.prepare("SELECT event_id,result_json,result_digest FROM fx_event_result_bindings WHERE event_id LIKE 'libra-source-media-probe-event-%'").all();
  assert.equal(sourceProbes.length,physicalCount);
  for(const item of sourceProbes) {
    const value=JSON.parse(item.result_json);assertProbeEvidence(value);
    if(hdr) {
      assert.equal(value.videoStreams[0].dynamicRangeKind,'hdr10_compatible');
      assert.equal(value.videoStreams[0].bitDepth,10);
      assert.equal(value.videoStreams[0].colorTransfer,'pq');
    }
    if(longMedia) {
      assert.ok(Math.abs(value.durationMs-1200000)<500,JSON.stringify(value));
      assert.equal(value.audioStreams.length,1);
      assert.equal(value.audioStreams[0].codec,'aac');
    }
    assert.equal(item.result_digest,canonicalDigest(value));
  }
  assert.equal(db.prepare("SELECT count(*) n FROM fx_event_attempts WHERE event_id LIKE 'libra-source-media-probe-event-%' AND failure_code IS NOT NULL").get().n,0);
  assert.equal(new Set(sourceProbes.map(item=>JSON.parse(item.result_json).sourceHandleDigest)).size,physicalCount);
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
  assert.equal(state.routes.at(-1).decision,'resolved');assert.equal(state.routes.at(-1).shelf_id,sourceShelfId);
  assert.ok(state.specs.length>=1);
  for(const spec of state.specs) {
    assert.equal(spec.content_profile,'series');
    assert.deepEqual(JSON.parse(spec.spec_json).productScope.episodeKeys,episodeKeys);
    if(browserJourney)assert.deepEqual(JSON.parse(spec.spec_json).requirements.space,{unit:'episode',maxSizeGiB:0.5,maxSizeBytes:536870912});
  }
  assert.ok(providerCalls.some(call=>call.operationId===undefined&&call.intent.contentProfile==='series'&&call.intent.seasonNumber===initialSeason));
  const claims=db.prepare('SELECT episode_key FROM libra_run_material_episode_claims ORDER BY episode_key').all();
  assert.deepEqual([...new Set(claims.map(claim=>claim.episode_key))],episodeKeys);
  const metadata=require('../../src/helix/contracts/episode-metadata-records').readStoredMetadataValue(state.facts.find(fact=>fact.fact_kind==='product_metadata'));
  if(largePlot) {
    assert.ok(Buffer.byteLength(JSON.stringify(metadata))>65536);
    assert.ok(metadata.episodeMetadata.every(item=>item.descriptiveFacts.entries.find(entry=>entry.key==='episode_plot').value===largePlot));
    const inventoryFact=db.prepare("SELECT * FROM arca_inventory_product_facts WHERE fact_kind='product_metadata'").get();
    assert.deepEqual(require('../../src/helix/contracts/episode-metadata-records').readStoredMetadataValue(inventoryFact),metadata);
    assert.ok(Buffer.byteLength(inventoryFact.fact_json)<65536);
  }
  assert.deepEqual(metadata.episodeMetadata.map(item=>item.episodeScope.episodeKey),episodeKeys);
  if(process.env.HELIX_SERIES_DUPLICATE_CAST==='1') {
    const observations=db.prepare("SELECT r.result_json FROM fx_event_result_bindings r JOIN fx_workflow_events e ON e.event_id=r.event_id WHERE e.capability_ref='libra.product_metadata.fetch@1'")
      .all().map(row=>JSON.parse(row.result_json));
    const repeated=observations.filter(item=>(item.peopleHints||[]).filter(hint=>hint.displayName==='Unlinked Fixture Actor').length===2);
    assert.ok(repeated.length>=physicalCount,'The real NFO parser must preserve the repeated assertions for the regression.');
    const cast=db.prepare("SELECT fact_json FROM libra_product_fact_revisions WHERE fact_kind='media_cast'").all().map(row=>JSON.parse(row.fact_json));
    assert.ok(cast.length>0);
    for(const fact of cast){
      assert.equal(new Set(fact.relations.map(item=>item.relationId)).size,fact.relations.length);
      assert.equal(fact.relations.filter(item=>item.displayName==='Unlinked Fixture Actor').length,1);
      const selected=observations.filter(item=>item.episodeScope&&item.peopleHints?.length)
        .sort((a,b)=>a.episodeScope.episodeNumber-b.episodeScope.episodeNumber||a.sourcePriority-b.sourcePriority||
          Buffer.compare(Buffer.from(a.evidenceId),Buffer.from(b.evidenceId)))[0];
      assert.ok(fact.relations.every(item=>item.originEvidenceDigest===selected.payloadDigest));
      const accepted=db.prepare("SELECT fact_json FROM arca_inventory_product_facts WHERE fact_kind='media_cast' AND fact_digest=?").all(fact.factDigest);
      assert.ok(accepted.length>0);
      for(const row of accepted)assert.deepEqual(JSON.parse(row.fact_json),fact);
    }
    assert.equal(db.prepare("SELECT count(*) n FROM fx_event_attempts WHERE failure_code='P9_MEDIA_CAST_RELATIONS'").get().n,0);
  }
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
  assert.equal(refs.length,episodeCount+1+(relatedFixture?physicalCount:0)+(relatedFixture&&process.env.HELIX_SERIES_NFO_GAP==='1'?episodeCount:0));
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
  const collection=JSON.parse((await request('GET','/v1/admin/collection?status=current')).body).items;
  const formationSubject=db.prepare('SELECT subject_id FROM libra_runs WHERE libra_run_id=?').get(state.runs[0].libra_run_id).subject_id;
  const formationDetail=JSON.parse((await request('GET','/v1/admin/formation/'+formationSubject)).body);
  assert.deepEqual(formationDetail.seriesDelivery,{libraRunId:state.runs[0].libra_run_id,seasonNumber:initialSeason,episodeKeys,physicalFileCount:physicalCount});
  assert.equal(collection.length,1);
  if(browserFlow)await browserFlow.verifyCollection(collection[0]);
  assert.equal(collection[0].series.seasonNumber,initialSeason);
  assert.equal(collection[0].series.episodeCount,episodeCount);
  assert.equal(collection[0].series.physicalFileCount,physicalCount);
  assert.deepEqual(collection[0].series.episodes.map(item=>item.episodeKey),episodeKeys);
  assert.equal(collection[0].series.episodes.reduce((sum,item)=>sum+item.files.length,0),nm?3:parts?2:episodeCount);

  assert.equal(inventory.length,episodeCount+physicalCount+2+thumbnailSources.length);
  if(relatedFixture){
    const thumbs=inventory.filter(item=>item.role==='sidecar');assert.equal(thumbs.length,physicalCount);
    const mappings=db.prepare("SELECT fact_json FROM arca_inventory_product_facts WHERE fact_kind='related_primary_mapping'").all();assert.equal(mappings.length,physicalCount);
    for(const {fact_json} of mappings){const mapping=JSON.parse(fact_json),thumb=thumbs.find(item=>item.material_key===mapping.relatedMaterialKey),primary=inventory.find(item=>item.material_key===mapping.finalPrimaryMaterialKey);
      assert.ok(thumb&&primary);assert.equal(thumb.location,primary.location.replace(/\.[^.]+$/,'-thumb.jpg'));
      const ordinal=JSON.parse(primary.episode_claims_json).items[0].episodeKey;const index=episodeKeys.indexOf(ordinal);
      assert.equal(fs.readFileSync(thumb.location,'utf8'),'unique-episode-thumbnail-'+index);
    }
    assert.ok(thumbnailSources.every(file=>!fs.existsSync(file)));
    assert.ok(sources.every(file=>!fs.existsSync(file.replace(/\.[^.]+$/,'.nfo'))));
  }
  assert.equal(db.prepare('SELECT count(*) n FROM arca_deck_fact_revisions').get().n,1);
  assert.equal(new Set(inventory.map(item=>item.location)).size,inventory.length);
  const inventoryPrimary=inventory.filter(item=>item.role==='primary_payload');
  assert.equal(inventoryPrimary.length,physicalCount);
  for(const item of inventoryPrimary) {
    if(real) {
      const inspected=require('node:child_process').spawnSync(process.env.FFPROBE_PATH||require('@ffprobe-installer/ffprobe').path,
        ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,pix_fmt,color_range,color_primaries,color_transfer,color_space','-of','json',item.location],{encoding:'utf8',windowsHide:true});
      assert.equal(inspected.status,0,inspected.stderr);assert.equal(JSON.parse(inspected.stdout).streams[0].codec_name,mediaRepair&&(nm?(mediaBound||JSON.parse(item.episode_claims_json).items.length===1):item.location.endsWith('S01E03.mkv'))?'h264':'hevc');
      if(longMedia) {
        const timed=require('node:child_process').spawnSync(process.env.FFPROBE_PATH||require('@ffprobe-installer/ffprobe').path,
          ['-v','error','-show_streams','-show_format','-of','json',item.location],{encoding:'utf8',windowsHide:true});
        assert.equal(timed.status,0,timed.stderr);
        const probe=JSON.parse(timed.stdout),audio=probe.streams.filter(stream=>stream.codec_type==='audio');
        assert.ok(Math.abs(Number(probe.format.duration)-1200)<0.5);
        assert.equal(audio.length,1);assert.equal(audio[0].codec_name,'aac');assert.equal(Number(audio[0].sample_rate),48000);
        t.diagnostic(JSON.stringify({longMedia:true,durationSeconds:Number(probe.format.duration),audioCodec:audio[0].codec_name,
          episodes:JSON.parse(item.episode_claims_json).items.map(claim=>claim.episodeKey)}));
      }
      if(hdr) {
        const stream=JSON.parse(inspected.stdout).streams[0];
        assert.equal(stream.pix_fmt,'yuv420p10le');
        assert.equal(stream.color_range,'tv');
        assert.equal(stream.color_primaries,'bt2020');
        assert.equal(stream.color_transfer,'smpte2084');
        assert.equal(stream.color_space,'bt2020nc');
        t.diagnostic(JSON.stringify({hdrMedia:true,episodes:JSON.parse(item.episode_claims_json).items.map(claim=>claim.episodeKey),stream}));
      }
    } else assert.equal(fs.readFileSync(item.location,'utf8'),'read-only-series-fixture');
    assert.equal(path.basename(path.dirname(item.location)),seasonDirectory);
    assert.ok(path.relative(target,item.location)&&!path.relative(target,item.location).startsWith('..'));
  }
  assert.deepEqual([...new Set(inventoryPrimary.flatMap(item=>JSON.parse(item.episode_claims_json).items.map(claim=>claim.episodeKey)))].sort(),episodeKeys);
  const careSpaceContext=require('../../src/helix/domains/arca/application/aftercare-context-reader')
    .createAftercareContextReader({schemaManifest,unitOfWork,workResultReader:
      require('../../src/helix/foundation/execution/work-result-reader').createWorkResultReader({schemaManifest,unitOfWork})})
    .read(inventoryPrimary[0].shelf_entry_id);
  const careSpace=require('../../src/helix/domains/arca/model/series-care-media-space')
    .evaluateSeriesCareMediaSpace(careSpaceContext,24);
  assert.equal(careSpace.inventoryRevision,careSpaceContext.basis.inventoryRevision);
  assert.equal(careSpace.careBasisDigest,careSpaceContext.basis.digest);
  assert.equal(careSpace.memberBudgets.length,physicalCount);
  assert.deepEqual(careSpace.episodeKeys,episodeKeys);
  const plannedSpace=require('../../src/helix/contracts/episode-byte-allocation').evaluateSeriesEpisodeSpace({
    members:careSpace.members.map(member=>({...member,sizeBytes:careSpace.memberBudgets.find(item=>item.materialKey===member.materialKey).maxOutputBytes})),
    episodeKeys,maxSizeBytes:24});
  assert.ok(plannedSpace.every(item=>item.withinLimit));
  if(nm) {
    const sharedProduct=inventoryPrimary.find(item=>JSON.parse(item.episode_claims_json).items.length===2),
      part=inventoryPrimary.find(item=>JSON.parse(item.episode_claims_json).items.length===1);
    assert.ok(sharedProduct&&part);
    const fraction=numerator=>numerator%2n===0n?{numerator:String(numerator/2n),denominator:'1'}:{numerator:String(numerator),denominator:'2'};
    const expected=[{episodeKey:'E001',allocatedBytes:fraction(BigInt(sharedProduct.size_bytes)+2n*BigInt(part.size_bytes))},
      {episodeKey:'E002',allocatedBytes:fraction(BigInt(sharedProduct.size_bytes))}];
    const space=db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(item=>restoreArcaResult(db,JSON.parse(item.result_json)))
      .find(item=>item.schemaRef==='helix://contracts/types/AcceptanceCheck/v1'&&item.checkKind==='space');
    assert.equal(space.result,'passed');
    assert.deepEqual(space.episodeSpaceEvidence.allocations.map(({episodeKey,allocatedBytes})=>({episodeKey,allocatedBytes})),expected);
    const final=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'libra-series-final-verify-event-%'").all();
    for(const row of final) {
      const verification=JSON.parse(row.result_json),read=readSet.primaryInputs.find(item=>item.productMediaVerification.verificationId===verification.verificationId),
        member=primary.find(item=>item.material_key===read?.materialKey);
      assert.ok(member);
      const covered=db.prepare('SELECT episode_key FROM libra_product_package_material_episode_claims WHERE on_deck_package_id=? AND member_ordinal=?')
        .all(packages[0].on_deck_package_id,member.ordinal).map(item=>item.episode_key);
      assert.deepEqual(verification.spaceSummary.episodeAllocation.allocations.map(({episodeKey,allocatedBytes})=>({episodeKey,allocatedBytes})),
        expected.filter(item=>covered.includes(item.episodeKey)));
    }
  }
  const finalNfos=inventory.filter(item=>item.role==='metadata_sidecar');
  assert.equal(finalNfos.length,episodeCount+1);
  const {readInventoryArtifactScope}=require('../../src/helix/domains/arca/model/inventory-artifact-scope');
  const nfoScopes=finalNfos.map(readInventoryArtifactScope);
  assert.ok(nfoScopes.every(scope=>scope&&scope.seasonNumber===initialSeason));
  assert.equal(nfoScopes.filter(scope=>scope.episodeScope===null).length,1);
  assert.deepEqual(nfoScopes.filter(scope=>scope.episodeScope).map(scope=>scope.episodeScope.episodeNumber).sort((a,b)=>a-b),episodeNumbers);
  assert.ok(inventory.filter(item=>item.role!=='metadata_sidecar').every(item=>item.artifact_scope_json===null));
  for(const number of episodeNumbers) {
    const item=finalNfos.find(item=>path.basename(item.location).endsWith(seasonToken+'E'+String(number).padStart(2,'0')+'.nfo'));
    assert.ok(item);
    assert.match(fs.readFileSync(item.location,'utf8'),new RegExp('<episode>'+number+'</episode>'));
  }
  sources.forEach(file=>assert.equal(fs.existsSync(file),false));
  const sharedScope=db.prepare('SELECT * FROM arca_series_presentation_scopes').get(),sharedVersion=db.prepare('SELECT * FROM arca_series_presentation_versions WHERE scope_id=? ORDER BY revision DESC').get(sharedScope.scope_id);
  assert.equal(Number(sharedScope.current_version),1);assert.equal(sharedScope.active_build_id,null);
  const sharedManifest=JSON.parse(sharedVersion.manifest_json);assert.deepEqual(sharedManifest.members.map(row=>row.artifactKind),['nfo','poster','fanart']);
  for(const member of sharedManifest.members){assert.ok(fs.existsSync(member.location));assert.equal(path.dirname(member.location),sharedScope.root_location);
    const control=db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(member.physicalIdentity.materialKey);
    assert.equal(control.owner_scope_type,'series_presentation');assert.equal(control.owner_scope_id,sharedScope.scope_id);}
  assert.equal(require('../../src/helix/integrations/series-presentation-io').nfoIdentity(fs.readFileSync(path.join(sharedScope.root_location,'tvshow.nfo'))),'1399');
  assert.equal(sharedArtifactCalls.length,process.env.HELIX_SERIES_SHARED_SUPPLEMENT==='1'||process.env.HELIX_SERIES_LOCAL_SOURCE==='1'?0:process.env.HELIX_SERIES_SHARED_WRITE_FAILURE==='workspace'?8:4,process.env.HELIX_SERIES_LOCAL_SOURCE?JSON.stringify({basis:JSON.parse(db.prepare('SELECT basis_json FROM arca_series_presentation_builds LIMIT 1').get().basis_json),source:db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'series-source-%'").all().map(row=>JSON.parse(row.result_json))}):undefined);
  if(process.env.HELIX_SERIES_LOCAL_SOURCE){for(const file of localShowFiles)assert.deepEqual(fs.readFileSync(file.location),file.bytes);
    const published=db.prepare('SELECT series_source_refs_json FROM proc_candidate_packages').get();assert.equal(JSON.parse(published.series_source_refs_json).references.length,3);
    const basis=JSON.parse(db.prepare('SELECT basis_json FROM arca_series_presentation_builds ORDER BY created_at_ms LIMIT 1').get().basis_json);assert.equal(Boolean(basis.localSource),process.env.HELIX_SERIES_LOCAL_SOURCE==='1');
    if(basis.localSource){assert.equal(basis.localSource.providerKey,'1399');for(const member of sharedManifest.members){const original=localShowFiles.find(file=>path.basename(file.location)===path.basename(member.location)).bytes,expected=member.artifactKind==='nfo'?original:(await require('../../src/helix/integrations/series-presentation-io').imageBytes(original,member.artifactKind)).bytes;assert.deepEqual(fs.readFileSync(member.location),expected);}}}
  if(sharedRetryCommand){const before=canonicalDigest({builds:db.prepare('SELECT count(*) n FROM arca_series_presentation_builds').get().n,versions:db.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n,works:db.prepare("SELECT work_id FROM fx_supporting_works WHERE work_kind='series_presentation' ORDER BY work_id").all(),commits:db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n});
    const replay=(await request('POST','/v1/admin/formation/acceptance/'+sharedRetryOffer+'/actions/retry',sharedRetryCommand)).json();assert.equal(replay.replayed,true);
    assert.equal(canonicalDigest({builds:db.prepare('SELECT count(*) n FROM arca_series_presentation_builds').get().n,versions:db.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n,works:db.prepare("SELECT work_id FROM fx_supporting_works WHERE work_kind='series_presentation' ORDER BY work_id").all(),commits:db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n}),before);
    assert.equal(db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE command_contract='arca.series-presentation.retry@1'").get().n,1);
    const conflict=await host.inject({method:'POST',url:'/v1/admin/formation/acceptance/'+sharedRetryOffer+'/actions/retry',headers:{cookie},payload:{...sharedRetryCommand,supplementalImages:[{artifactKind:'poster',bytesBase64:Buffer.from('different-command-bytes').toString('base64')}]}});assert.equal(conflict.statusCode,409,conflict.body);
  }
  if(process.env.HELIX_SERIES_SHARED_WRITE_FAILURE==='workspace-source-loss'){
    const reclaimUntil=Date.now()+30000;while(Date.now()<reclaimUntil&&db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE process_type='arca_series_presentation' AND work_kind='series_presentation_reclaim' AND state='succeeded'").get().n<2){assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,50));}
    const builds=db.prepare('SELECT scope_json FROM arca_series_presentation_builds ORDER BY created_at_ms').all().map(row=>JSON.parse(row.scope_json));assert.equal(builds.length,2);assert.equal(builds[1].supersedesBuildId,builds[0].objectId);assert.deepEqual(builds[1].sourceWorkspaceFiles.map(row=>row.artifactKind),['nfo','poster']);
    assert.equal(db.prepare("SELECT count(*) n FROM fx_workspace_registry WHERE process_type='series_presentation' AND state='active'").get().n,0,JSON.stringify(db.prepare("SELECT work_id,work_kind,state FROM fx_supporting_works WHERE process_type='arca_series_presentation'").all()));
    assert.equal(db.prepare("SELECT count(*) n FROM fx_workspace_materials WHERE process_id IN (SELECT build_id FROM arca_series_presentation_builds) AND state='active'").get().n,0);
    assert.equal(db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE owner_scope_type='series_presentation' AND state='active'").get().n,0);
    for(const build of builds)for(const kind of ['nfo','poster','fanart']){const name=kind==='nfo'?'tvshow.nfo':kind+'.jpg';assert.equal(fs.existsSync(path.join(dataDir,'workspaces','aftercare',build.objectId+'-assets',kind,name)),false);}
    assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);t.diagnostic(JSON.stringify({partialSourceRecovery:true,builds:2,registeredOldMaterialCount:1,recoveredFiles:2,reclaimedWorkspaces:2}));
  }
  await sharedBrowserFlow?.complete();
  if(process.env.HELIX_SERIES_LEGACY_SHARED==='1'){
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get(),protectedTables=['arca_shelf_entries','arca_canonical_identity_revisions','arca_inventory_representations','arca_inventory_materials','arca_inventory_product_facts','arca_ondeck_commit_receipts','arca_deck_fact_revisions'],
      protectedSnapshot=()=>canonicalDigest(protectedTables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
    const before=protectedSnapshot(),until=Date.now()+30000;
    while(Date.now()<until&&db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE process_type='arca_series_presentation' AND state NOT IN ('succeeded','failed','cancelled')").get().n)await new Promise(resolve=>setTimeout(resolve,50));
    await host.close();db.close();db=new Database(path.join(dataDir,'shelfdeck.db'));db.pragma('foreign_keys=ON');
    // Reconstruct an isolated legacy collection shape: original Season facts remain byte-identical;
    // only the new shared subsystem facts and its files are absent. This is not a production repair.
    db.transaction(()=>{for(const member of sharedManifest.members){db.prepare('DELETE FROM fx_material_control_revisions WHERE material_key=?').run(member.physicalIdentity.materialKey);db.prepare('DELETE FROM fx_material_controls WHERE material_key=?').run(member.physicalIdentity.materialKey);}
      for(const table of ['arca_series_presentation_commit_links','arca_series_presentation_references','arca_series_presentation_reservations','arca_series_presentation_versions','arca_series_presentation_builds','arca_series_presentation_scopes'])db.prepare('DELETE FROM '+table).run();})();
    for(const member of sharedManifest.members)fs.unlinkSync(member.location);
    let legacyVideoProbeCalls=0;
    hostOptions.mediaProbe={async probe(){if(db.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n===0)legacyVideoProbeCalls++;throw Object.assign(new Error('Unrelated Season video probing must not block show metadata maintenance'),{code:'FIXTURE_LEGACY_VIDEO_PROBE_UNAVAILABLE'});}};
    assert.equal(protectedSnapshot(),before);db.close();db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});host=await createCleanServiceHost(hostOptions);
    const relogin=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(relogin.statusCode,204);cookie=relogin.headers['set-cookie'];
    const beforeQueries=adapter.calls.length;
    await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'legacy-shared-repair'});
    const repairUntil=Date.now()+90000;while(Date.now()<repairUntil){assert.ifError(runtimeError);
      if(db.prepare('SELECT count(*) n FROM arca_series_presentation_references WHERE shelf_entry_id=? AND state=?').get(entry.shelf_entry_id,'active').n)break;
      await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(db.prepare('SELECT count(*) n FROM arca_series_presentation_references WHERE shelf_entry_id=? AND state=?').get(entry.shelf_entry_id,'active').n,1,
      JSON.stringify(db.prepare("SELECT work_kind,state FROM fx_supporting_works WHERE owner_domain='arca'").all()));
    assert.equal(protectedSnapshot(),before);assert.equal(db.prepare('SELECT count(*) n FROM arca_series_presentation_commit_links').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,0);
    const beforeReplay=canonicalDigest({builds:db.prepare('SELECT count(*) n FROM arca_series_presentation_builds').get().n,versions:db.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n,
      receipts:db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE command_contract='arca.series-presentation.retry@1'").get().n});
    const replay=(await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'legacy-shared-repair'})).json();assert.equal(replay.replayed,true);
    assert.equal(canonicalDigest({builds:db.prepare('SELECT count(*) n FROM arca_series_presentation_builds').get().n,versions:db.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n,
      receipts:db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE command_contract='arca.series-presentation.retry@1'").get().n}),beforeReplay);
    const requests=adapter.calls.slice(beforeQueries);assert.ok(requests.some(url=>url.pathname==='/3/tv/1399'));
    assert.ok(requests.every(url=>!url.pathname.includes('/search/')&&!url.pathname.includes('/season/')));
    const source=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE event_id LIKE 'series-source-%' ORDER BY committed_at_ms DESC").get();
    assert.equal(JSON.parse(source.result_json).observedBasis.schema,'shelfdeck.series-presentation-observed@1');
    for(const role of ['tvshow.nfo','poster.jpg','fanart.jpg'])assert.ok(fs.existsSync(path.join(sharedScope.root_location,role)));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(legacyVideoProbeCalls,0);t.diagnostic(JSON.stringify({legacySharedRepair:true,protectedSeasonFacts:protectedTables.length,historyLinksInvented:0,unrelatedVideoProbeCalls:legacyVideoProbeCalls}));
  }
  if(['1','supplement','assets'].includes(process.env.HELIX_SERIES_SHARED_MAINTENANCE)){
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get(),beforeFiles=sharedManifest.members.filter(row=>row.artifactKind!=='fanart').map(row=>({row,bytes:fs.readFileSync(row.location),inode:fs.statSync(row.location).ino})),
      historical=db.prepare('SELECT * FROM arca_series_presentation_commit_links').all(),inventoryBefore=db.prepare('SELECT * FROM arca_inventory_representations').all();
    fs.unlinkSync(path.join(sharedScope.root_location,'fanart.jpg'));
    sharedMaintenanceUnavailable=process.env.HELIX_SERIES_SHARED_MAINTENANCE==='assets'?'assets':process.env.HELIX_SERIES_SHARED_MAINTENANCE==='supplement';
    await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'shared-fanart-repair'});
    let maintenanceCommand=null;if(sharedMaintenanceUnavailable){const failedUntil=Date.now()+60000;let issue;
      do{assert.ifError(runtimeError);issue=(await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).json().sharedPresentation;
        if(issue?.canRetry)break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<failedUntil);
      assert.equal(issue?.canSupplyImages,true);
      if(sharedMaintenanceUnavailable==='assets'){sharedRetryAttempted=true;await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'empty-assets-source-retry'});}
      else {const fanart=await sharp({create:{width:160,height:90,channels:3,background:'#332266'}}).jpeg().toBuffer();
      if(sharedBrowserFlow)await sharedBrowserFlow.maintain({entry:collection[0],fanart});
      else {maintenanceCommand={idempotencyKey:'shared-maintenance-supplement',supplementalImages:[{artifactKind:'fanart',bytesBase64:fanart.toString('base64')}]};await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',maintenanceCommand);}}
    }
    const until=Date.now()+90000;while(Date.now()<until){assert.ifError(runtimeError);
      if(Number(db.prepare('SELECT current_version FROM arca_series_presentation_scopes WHERE scope_id=?').get(sharedScope.scope_id).current_version)===2)break;
      await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(Number(db.prepare('SELECT current_version FROM arca_series_presentation_scopes WHERE scope_id=?').get(sharedScope.scope_id).current_version),2,
      JSON.stringify(db.prepare("SELECT work_kind,state FROM fx_supporting_works WHERE owner_domain='arca'").all()));
    for(const item of beforeFiles){assert.deepEqual(fs.readFileSync(item.row.location),item.bytes);assert.equal(fs.statSync(item.row.location).ino,item.inode);}
    assert.deepEqual(db.prepare('SELECT * FROM arca_series_presentation_commit_links').all(),historical);
    assert.deepEqual(db.prepare('SELECT * FROM arca_inventory_representations').all(),inventoryBefore);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,0);assert.equal(sharedArtifactCalls.length,process.env.HELIX_SERIES_SHARED_SUPPLEMENT==='1'?0:sharedMaintenanceUnavailable==='assets'?7:sharedMaintenanceUnavailable?4:6);
    if(sharedMaintenanceUnavailable==='assets'){const last=db.prepare('SELECT scope_json FROM arca_series_presentation_builds ORDER BY created_at_ms DESC LIMIT 1').get(),scope=JSON.parse(last.scope_json);assert.ok(scope.reassessmentProofDigest);assert.equal(scope.imageSourceQualification.configRevision,2);assert.equal(scope.basis.sourceObservation.configRevision,1);const reclaimUntil=Date.now()+15000;while(Date.now()<reclaimUntil&&db.prepare("SELECT count(*) n FROM fx_workspace_registry WHERE process_type='series_presentation' AND state='active'").get().n)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(db.prepare("SELECT count(*) n FROM fx_workspace_registry WHERE process_type='series_presentation' AND state='active'").get().n,0);}
    if(maintenanceCommand){const deadline=Date.now()+30000;while(Date.now()<deadline&&db.prepare("SELECT count(*) n FROM fx_workspace_registry WHERE process_type='series_presentation' AND state='active'").get().n){assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,50));}const snapshot=()=>canonicalDigest({builds:db.prepare('SELECT count(*) n FROM arca_series_presentation_builds').get().n,versions:db.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n,works:db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_type='arca_series_presentation' ORDER BY work_id").all()});const before=snapshot();assert.equal((await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',maintenanceCommand)).json().replayed,true);assert.equal(snapshot(),before);}
    if(sharedBrowserFlow){const healthyUntil=Date.now()+60000;while(Date.now()<healthyUntil){const care=(await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).json();if(care.health.state==='healthy'&&!care.sharedPresentation)break;await new Promise(resolve=>setTimeout(resolve,100));}const finalCare=(await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).json();if(finalCare.health.state!=='healthy')t.diagnostic(JSON.stringify({finalCare,works:db.prepare("SELECT work_id,work_kind,state FROM fx_supporting_works WHERE owner_domain='arca'").all(),failed:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));await sharedBrowserFlow.healthy(collection[0]);}
  }

  if(offdeck&&process.env.HELIX_SERIES_SHARED_EXIT_DURING_MAINTENANCE==='1'){
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get();sharedRetirementFailure=true;fs.unlinkSync(path.join(sharedScope.root_location,'fanart.jpg'));
    await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'maintenance-before-exit'});
    const deadline=Date.now()+60000;let issue;do{assert.ifError(runtimeError);issue=(await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).json().sharedPresentation;if(issue?.canRetry)break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
    assert.equal(issue?.canRetry,true);assert.equal(issue.canSupplyImages,false);assert.ok(db.prepare('SELECT active_build_id FROM arca_series_presentation_scopes').get().active_build_id);
  }
  if(offdeck) {
    const retainedShared=process.env.HELIX_SERIES_SHARED_EXIT_DURING_MAINTENANCE==='1',sharedExtra=retainedShared?0:3;
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get(),sentinel=path.join(target,'outside-offdeck.keep');
    fs.writeFileSync(sentinel,'outside the authorized Series scope');
    const beforeExit=inventory.map(item=>({item,bytes:fs.readFileSync(item.location)}));
    const review=browserFlow?await browserFlow.prepareOffdeck(collection[0],inventory,async(cancelledReviewId)=>{
      assert.equal(db.prepare('SELECT state FROM arca_offdeck_reviews WHERE review_id=?').get(cancelledReviewId).state,'cancelled');
      assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_authorizations').get().n,0);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_cases').get().n,0);
      for(const {item,bytes} of beforeExit)assert.deepEqual(fs.readFileSync(item.location),bytes);
      assert.equal(db.prepare('SELECT status FROM arca_shelf_entries WHERE shelf_entry_id=?').get(entry.shelf_entry_id).status,'active');
    }):(await request('POST','/v1/admin/offdeck/reviews',{shelfEntryId:entry.shelf_entry_id,
      originKind:'direct_intent',actorId:'series-fixture',idempotencyKey:'series-offdeck-review'})).json();
    assert.equal(review.state,'open');assert.equal(review.scopes.length,1);
    const scopeId=review.scopes[0].destructionScopeId,
      scope=db.prepare('SELECT * FROM arca_offdeck_scope_materials WHERE destruction_scope_id=? ORDER BY ordinal').all(scopeId);
    assert.equal(scope.length,inventory.length+sharedExtra);assert.equal(new Set(scope.map(item=>item.material_key)).size,scope.length);
    assert.deepEqual(scope.filter(item=>!item.shared_scope_id).map(item=>item.material_key).sort(),inventory.map(item=>item.material_key).sort());
    assert.equal(scope.filter(item=>item.material_role==='primary_payload').length,2);
    const confirmation=browserFlow?await browserFlow.confirmOffdeck(review.reviewId):(await request('POST','/v1/admin/offdeck/reviews/'+review.reviewId+'/actions/confirm-selection',
      {actorId:'series-fixture',idempotencyKey:'series-offdeck-confirm'})).json();
    assert.equal(confirmation.state,'selection_confirmed');assert.equal(confirmation.selection.highVolume,false);
    const authorized=browserFlow?await browserFlow.authorizeOffdeck():(await request('POST','/v1/admin/offdeck/authorizations',
      {reviewId:review.reviewId,actorId:'series-fixture',idempotencyKey:'series-offdeck-authorize'})).json();
    assert.equal(authorized.cases.length,1);
    const until=Date.now()+120000;let currentCase;
    do {
      assert.ifError(runtimeError);
      currentCase=db.prepare('SELECT * FROM arca_offdeck_cases WHERE offdeck_case_id=?').get(authorized.cases[0]);
      if(currentCase&&(currentCase.state==='completed'||currentCase.state==='awaiting_reauthorization'||
          (currentCase.state==='blocked'&&!process.env.HELIX_SERIES_OFFDECK_CRASH_ROOT)))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<until);
    assert.equal(currentCase?.state,'completed',JSON.stringify(currentCase));
    if(retainedShared){const deadline=Date.now()+30000;while(Date.now()<deadline&&(db.prepare('SELECT active_build_id FROM arca_series_presentation_scopes').get().active_build_id||db.prepare("SELECT count(*) n FROM fx_material_controls WHERE owner_scope_type='series_presentation' AND state='controlled'").get().n||db.prepare("SELECT count(*) n FROM fx_workspace_registry WHERE process_type='series_presentation' AND state='active'").get().n)){assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(db.prepare('SELECT active_build_id FROM arca_series_presentation_scopes').get().active_build_id,null);assert.equal(db.prepare("SELECT count(*) n FROM fx_workspace_registry WHERE process_type='series_presentation' AND state='active'").get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE command_contract='arca.series-presentation.retained-retirement@1'").get().n,1);}
    for(const member of sharedManifest.members)assert.equal(fs.existsSync(member.location),retainedShared);
    assert.equal(db.prepare('SELECT state FROM arca_series_presentation_references').get().state,'released');
    assert.equal(db.prepare('SELECT retirement_scope_id FROM arca_series_presentation_scopes').get().retirement_scope_id,null);
    assert.ok(db.prepare("SELECT state FROM fx_material_controls WHERE owner_scope_type='series_presentation'").all().every(row=>row.state==='released'));
    const current=db.prepare('SELECT * FROM arca_shelf_entries WHERE shelf_entry_id=?').get(entry.shelf_entry_id);
    assert.equal(current.status,'offdecked');assert.equal(current.current_deck_fact_revision,entry.current_deck_fact_revision+1);
    const evidence=db.prepare('SELECT * FROM arca_offdeck_deletion_evidence WHERE destruction_scope_id=?').all(scopeId);
    assert.equal(evidence.length,inventory.length+sharedExtra);assert.equal(new Set(evidence.map(item=>item.material_key)).size,inventory.length+sharedExtra);
    for(const item of inventory)assert.equal(fs.existsSync(item.location),false);
    assert.equal(fs.readFileSync(sentinel,'utf8'),'outside the authorized Series scope');
    assert.equal(db.prepare("SELECT count(*) n FROM fx_material_controls WHERE owner_scope_id=? AND state='controlled'").get(entry.shelf_entry_id).n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_inventory_materials WHERE shelf_entry_id=? AND active_guard=1').get(entry.shelf_entry_id).n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_terminal_receipts').get().n,1);
    assert.equal(offdeckCommitAudits.length,1);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');
    if(browserFlow)await browserFlow.verifyOffdeck(collection[0]);
    t.diagnostic(JSON.stringify({offdeck:true,physicalPrimaries:2,episodeClaimCount:nm?3:episodeCount,deletedMaterials:evidence.length,rollbackVerified:offdeckCommitAudits.length}));
  }
  if(mediaRepair) {
    assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref IN ('libra.media.remux@1','libra.media.transcode@1')").get().n,0);
    const repairTemplateId='series-media-care-template';
    await request('POST','/v1/admin/rule-templates/system-beta-recommended/actions/copy',{
      idempotencyKey:'care-copy',sourceTemplateId:'system-beta-recommended',newTemplateId:repairTemplateId,
      name:'Bounded Series fixture',expectedSourceRevision:1});
    const draft=(await request('GET','/v1/admin/rule-templates/'+repairTemplateId+'/draft')).json().draft;
    const rules=structuredClone(draft.rules),profile=rules.profileRuleSets.find(item=>item.contentProfile==='series');
    const allocationCheckCap=1048576,repairEpisodeCap=(nm?64:32)*1024*1024;
    for(const requirements of [profile.baseRequirements,...profile.decisionBranches.map(item=>item.requirements)]) {
      Object.assign(requirements.mandatoryMedia,{videoCodec:'hevc',container:'matroska',fileExtension:'mkv'});
      if(nm)requirements.space={unit:'episode',maxSizeGiB:null,maxSizeBytes:null};
      if(mediaBound)requirements.space={unit:'episode',maxSizeGiB:repairEpisodeCap/1073741824,maxSizeBytes:repairEpisodeCap};
    }
    profile.profileRuleSetDigest=canonicalDigest(Object.fromEntries(Object.entries(profile).filter(([key])=>key!=='profileRuleSetDigest')));
    const rulesDigest=canonicalDigest(rules);
    await request('PATCH','/v1/admin/rule-templates/'+repairTemplateId+'/draft',{
      idempotencyKey:'care-draft',templateId:repairTemplateId,expectedDraftRevision:1,basePublishedRevision:1,
      rulesSchemaRef:draft.rulesSchemaRef,rules,rulesDigest});
    const basis={templateId:repairTemplateId,expectedCurrentRevision:1,expectedDraftRevision:2,expectedDraftDigest:rulesDigest};
    const preview=(await request('POST','/v1/admin/rule-templates/'+repairTemplateId+'/actions/preview',{
      idempotencyKey:'care-preview',...basis})).json();
    await request('POST','/v1/admin/rule-templates/'+repairTemplateId+'/actions/publish',{
      idempotencyKey:'care-publish',...basis,previewId:preview.previewId,previewDigest:preview.previewDigest});
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get(),original=inventory.map(item=>({item,bytes:fs.readFileSync(item.location)}));
    const audioPacketHashes=location=>{
      const result=require('node:child_process').spawnSync(process.env.FFPROBE_PATH||require('@ffprobe-installer/ffprobe').path,
        ['-v','error','-select_streams','a:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','json',location],
        {encoding:'utf8',windowsHide:true,timeout:30000});
      assert.equal(result.status,0,result.stderr);
      const hashes=JSON.parse(result.stdout).packets.map(item=>item.data_hash);
      assert.ok(hashes.length>0&&hashes.every(value=>/^SHA256:[a-f0-9]{64}$/.test(value)));
      return hashes;
    };
    const sourceAudioHashes=mediaBound?audioPacketHashes(inventoryPrimary.find(item=>(nm?JSON.parse(item.episode_claims_json).items.length===1:item.location.endsWith('S01E03.mkv'))).location):null;
    await request('POST','/v1/admin/shelves/series-shelf/actions/bind-template',{
      idempotencyKey:'series-media-care-bind',shelfId:'series-shelf',expectedStandardRevision:1,expectedRoutingProjectionRevision:1,
      ruleTemplateId:repairTemplateId,expectedTemplateRevision:2});
    await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'series-media-care-check'});
    const until=Date.now()+150000;let care;
    do {
      assert.ifError(runtimeError);
      care=db.prepare('SELECT * FROM arca_aftercare_cases ORDER BY created_at_ms DESC').get();
      if(care&&['resolved','unresolved','invalidated'].includes(care.state))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<until);
    const detail=(await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).json();
    assert.equal(care?.state,'resolved',JSON.stringify({detail,verifications:db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>restoreArcaResult(db,JSON.parse(row.result_json))).filter(item=>item.verificationKind==='aftercare_media'),failures:db.prepare('SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    assert.equal(detail.health.state,'healthy');assert.equal(repairCommitAudits.length,1);
    const current=db.prepare('SELECT * FROM arca_shelf_entries').get(),materials=db.prepare('SELECT * FROM arca_inventory_materials WHERE inventory_revision=?').all(current.current_inventory_revision);
    assert.equal(materials.length,inventory.length);
    for(const {item,bytes} of original) {
      if(item.role!=='primary_payload'||(!nm&&item.location.endsWith('S01E01.mkv'))) {
        assert.deepEqual(fs.readFileSync(item.location),bytes);assert.ok(materials.some(row=>row.material_key===item.material_key));continue;
      }
      const expected=path.join(path.dirname(item.location),path.parse(item.location).name+'.mkv'),replacement=materials.find(row=>path.resolve(row.location)===path.resolve(expected));
      assert.ok(replacement);assert.notEqual(replacement.material_key,item.material_key);
      assert.equal(replacement.episode_claims_json,item.episode_claims_json);
      assert.equal(fs.existsSync(item.location+'.superseded-'+care.aftercare_case_id),false);
      const probe=require('node:child_process').spawnSync(process.env.FFPROBE_PATH||require('@ffprobe-installer/ffprobe').path,
        ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','json',replacement.location],{encoding:'utf8',windowsHide:true});
      assert.equal(probe.status,0,probe.stderr);assert.equal(JSON.parse(probe.stdout).streams[0].codec_name,'hevc');
    }
    if(mediaBound) {
      const source=original.find(({item})=>item.role==='primary_payload'&&(nm?JSON.parse(item.episode_claims_json).items.length===1:item.location.endsWith('S01E03.mkv'))).item,
        final=materials.find(item=>item.role==='primary_payload'&&(nm?JSON.parse(item.episode_claims_json).items.length===1:item.location.endsWith('S01E03.mkv')));
      assert.ok(Number(source.size_bytes)>repairEpisodeCap);
      assert.ok(Number(final.size_bytes)<=repairEpisodeCap);
      assert.equal(fs.statSync(final.location).size,Number(final.size_bytes));
      const inspect=location=>require('node:child_process').spawnSync(process.env.FFPROBE_PATH||require('@ffprobe-installer/ffprobe').path,
        ['-v','error','-show_streams','-show_format','-of','json',location],{encoding:'utf8',windowsHide:true});
      const inspected=inspect(final.location);assert.equal(inspected.status,0,inspected.stderr);
      const probe=JSON.parse(inspected.stdout),audio=probe.streams.filter(item=>item.codec_type==='audio');
      assert.equal(audio.length,1);assert.equal(audio[0].codec_name,'aac');assert.equal(Number(audio[0].sample_rate),48000);
      assert.ok(Math.abs(Number(probe.format.duration)-20)<0.25);
      assert.deepEqual(audioPacketHashes(final.location),sourceAudioHashes);
      const strategy=db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>restoreArcaResult(db,JSON.parse(row.result_json)))
        .find(result=>result.memberScope?.materialKey===source.material_key&&result.mediaRepairStrategy)?.mediaRepairStrategy;
      assert.ok(strategy);assert.notEqual(strategy.video.rateControlMode,'quality_bound');
      assert.ok(strategy.video.targetVideoBitrateBps>0);
      t.diagnostic(JSON.stringify({boundedRepair:true,sourceBytes:Number(source.size_bytes),finalBytes:Number(final.size_bytes),
        maxSizeBytes:repairEpisodeCap,audioCodec:audio[0].codec_name,audioPacketsPreserved:sourceAudioHashes.length,
        rateControlMode:strategy.video.rateControlMode,durationSeconds:Number(probe.format.duration)}));
    }
    if(nm) {
      const finalContext=require('../../src/helix/domains/arca/application/aftercare-context-reader')
        .createAftercareContextReader({schemaManifest,unitOfWork,workResultReader:
          require('../../src/helix/foundation/execution/work-result-reader').createWorkResultReader({schemaManifest,unitOfWork})})
        .read(entry.shelf_entry_id);
      const finalSpace=require('../../src/helix/domains/arca/model/series-care-media-space')
        .evaluateSeriesCareMediaSpace(finalContext,mediaBound?repairEpisodeCap:allocationCheckCap);
      const primaries=materials.filter(item=>item.role==='primary_payload'),
        shared=primaries.find(item=>JSON.parse(item.episode_claims_json).items.length===2),
        part=primaries.find(item=>JSON.parse(item.episode_claims_json).items.length===1);
      assert.ok(shared&&part);
      for(const material of primaries)assert.equal(fs.statSync(material.location).size,Number(material.size_bytes));
      const fraction=n=>n%2n===0n?{numerator:String(n/2n),denominator:'1'}:{numerator:String(n),denominator:'2'};
      const expected=[{episodeKey:'E001',allocatedBytes:fraction(BigInt(shared.size_bytes)+2n*BigInt(part.size_bytes))},
        {episodeKey:'E002',allocatedBytes:fraction(BigInt(shared.size_bytes))}];
      assert.deepEqual(finalSpace.episodeAllocations.map(({episodeKey,allocatedBytes})=>({episodeKey,allocatedBytes})),expected);
      assert.ok(finalSpace.episodeAllocations.every(item=>item.withinLimit));
      t.diagnostic(JSON.stringify({finalEpisodeAllocations:expected,allocationCheckCap:mediaBound?repairEpisodeCap:allocationCheckCap,repairSpaceLimit:mediaBound?repairEpisodeCap:null}));
    }
    const controlPort=require('../../src/helix/foundation/persistence/material-control').createMaterialControlProjectionPort({schemaManifest,unitOfWork}),
      controls=controlPort.getMaterialControlProjections([...new Set([...materials,...inventory].map(item=>item.material_key))].sort());
    for(const original of inventory.filter(item=>!materials.some(row=>row.material_key===item.material_key)))
      assert.equal(controls.find(item=>item.materialKey===original.material_key).controlState,'uncontrolled');
    for(const material of materials) {
      const control=controls.find(item=>item.materialKey===material.material_key);
      assert.equal(control.controlState,'controlled');assert.equal(control.ownerDomain,'arca');assert.equal(control.ownerScopeId,entry.shelf_entry_id);
    }
    const resultReader=require('../../src/helix/foundation/execution/work-result-reader').createWorkResultReader({schemaManifest,unitOfWork}),
      works=resultReader.listWorks({ownerDomain:'arca',processType:'arca_shelf_entry',processId:entry.shelf_entry_id,workKind:'care_repair_prepare'}),
      produced=works.flatMap(work=>resultReader.read(work.work_id)).filter(row=>['arca.aftercare.media.remux@1','arca.aftercare.media.transcode@1'].includes(row.capabilityRef));
    assert.deepEqual(produced.map(row=>row.result.productionIntentKind).sort(),mediaBound&&nm?['encode','encode']:['encode','remux']);
    assert.equal(new Set(produced.map(row=>row.result.sourceMaterialHandleDigest)).size,2);
    assert.equal(new Set(produced.map(row=>row.result.workspaceMaterialHandle.relativePath)).size,2);
    t.diagnostic(JSON.stringify({realAftercare:true,processed:produced.map(row=>({kind:row.result.productionIntentKind,
      device:row.result.executionDeviceRef?.deviceClass||null})),rollbackVerified:repairCommitAudits.length}));
    assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM arca_aftercare_settlement_approvals WHERE state='consumed'").get().n,1);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');
  }
  if(migrate) {
    if(relatedFixture&&process.env.HELIX_SERIES_CLEANUP_BEFORE_MIGRATE==='1'){
      const until=Date.now()+90000;
      while(fs.existsSync(source)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(fs.existsSync(source),false);
    }
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get(),original=inventory.map(item=>({item,bytes:fs.readFileSync(item.location)})),
      shelf=(await request('GET','/v1/admin/shelves/series-shelf')).json().shelf,
      policy={...shelf.placement.value,...(migrate==='rename'?{primaryTemplate:'renamed-{stem}{ext}'}:{folderTemplate:'Relocated {title}'})},
      draft={shelfId:shelf.shelfId,expectedPlacementRevision:shelf.currentPlacementRevision,target:shelf.target,
        placement:{schemaRef:shelf.placement.schemaRef,value:policy,digest:canonicalDigest(policy)}},
      preview=(await request('POST','/v1/admin/shelves/series-shelf/placement/actions/preview',{
        idempotencyKey:'series-migration-preview',...draft})).json();
    assert.equal(preview.physicalEffect,'none');assert.equal(preview.affectedActiveEntryCount,1);
    await request('PATCH','/v1/admin/shelves/series-shelf/placement',{idempotencyKey:'series-migration-publish',...draft,
      expectedCurrentTargetDigest:preview.currentTargetDigest,previewId:preview.previewId,previewDigest:preview.previewDigest});
    await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'series-migration-check'});
    const until=Date.now()+120000;let care;
    do {
      assert.ifError(runtimeError);
      care=db.prepare('SELECT * FROM arca_aftercare_cases ORDER BY created_at_ms DESC').get();
      if(care&&['resolved','unresolved','invalidated'].includes(care.state))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<until);
    const detail=(await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).json();
    assert.equal(care?.state,'resolved',JSON.stringify({detail,verifications:db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>restoreArcaResult(db,JSON.parse(row.result_json))).filter(item=>item.verificationKind==='aftercare_media'),failures:db.prepare('SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));assert.equal(detail.health.state,'healthy');assert.equal(detail.basis.placementRevision,2);
    assert.equal(repairCommitAudits.length,1);
    const current=db.prepare('SELECT * FROM arca_shelf_entries').get(),materials=db.prepare('SELECT * FROM arca_inventory_materials WHERE inventory_revision=?').all(current.current_inventory_revision);
    assert.equal(materials.length,original.length);
    for(const {item,bytes} of original) {
      const expectedName=(migrate==='rename'&&(item.role==='primary_payload'||relatedFixture&&item.role==='sidecar')?'renamed-':'')+path.basename(item.location),
        moved=materials.find(row=>path.basename(row.location)===expectedName);assert.ok(moved);
      if(migrate==='rename')assert.equal(path.dirname(moved.location),path.dirname(item.location));
      else assert.ok(moved.location.includes('Relocated Demo Show'));assert.deepEqual(fs.readFileSync(moved.location),bytes);
      assert.equal(moved.artifact_scope_json,item.artifact_scope_json);assert.equal(moved.episode_claims_json,item.episode_claims_json);
      if(path.resolve(moved.location)!==path.resolve(item.location))assert.equal(fs.existsSync(item.location),false);
    }
    assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n,1);
    if(relatedFixture){
      const mappings=db.prepare("SELECT * FROM arca_inventory_product_facts WHERE inventory_revision=? AND fact_kind='related_primary_mapping'").all(current.current_inventory_revision);
      assert.equal(mappings.length,physicalCount);
      const {readInventoryMapping}=require('../../src/helix/contracts/related-primary-mappings');
      for(const row of mappings){const mapping=readInventoryMapping(row),thumb=materials.find(item=>item.material_key===mapping.relatedMaterialKey),primary=materials.find(item=>item.material_key===mapping.finalPrimaryMaterialKey);
        assert.ok(thumb&&primary);assert.equal(thumb.location,primary.location.replace(/\.[^.]+$/,'-thumb.jpg'));}
    }
    assert.equal(db.prepare("SELECT count(*) n FROM arca_aftercare_settlement_approvals WHERE state='consumed'").get().n,1);
    const controls=require('../../src/helix/foundation/persistence/material-control').createMaterialControlProjectionPort({schemaManifest,unitOfWork})
      .getMaterialControlProjections([...new Set([...inventory,...materials].map(item=>item.material_key))].sort());
    for(const material of materials){const control=controls.find(item=>item.materialKey===material.material_key);assert.equal(control.controlState,'controlled');assert.equal(control.ownerScopeId,entry.shelf_entry_id);}
    for(const old of inventory.filter(old=>!materials.some(item=>item.material_key===old.material_key)))assert.equal(controls.find(item=>item.materialKey===old.material_key).controlState,'uncontrolled');
    assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');
  }
  if(repair) {
    const entry=db.prepare('SELECT * FROM arca_shelf_entries').get(),damaged=finalNfos.find(item=>readInventoryArtifactScope(item).episodeScope?.episodeNumber===2),
      missing=finalNfos.find(item=>readInventoryArtifactScope(item).episodeScope?.episodeNumber===1),
      missingPoster=posterRepair?inventory.find(item=>item.role==='poster'):null,
      repaired=[missing,damaged,...(missingPoster?[missingPoster]:[])],protectedFiles=inventory.filter(item=>!repaired.includes(item)).map(item=>({item,bytes:fs.readFileSync(item.location)}));
    fs.writeFileSync(damaged.location,'');fs.unlinkSync(missing.location);if(missingPoster)fs.unlinkSync(missingPoster.location);
    if(browserFlow)await browserFlow.checkHealth(collection[0]);
    else await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'series-nfo-repair'});
    const until=Date.now()+120000;let care;
    do {
      assert.ifError(runtimeError);
      care=db.prepare('SELECT * FROM arca_aftercare_cases WHERE shelf_entry_id=? ORDER BY created_at_ms DESC').get(entry.shelf_entry_id);
      if(care&&['resolved','unresolved','invalidated'].includes(care.state))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<until);
    const detail=await request('GET','/v1/admin/care/'+entry.shelf_entry_id);
    assert.equal(care?.state,'resolved',detail.body);assert.equal(repairCommitAudits.length,1);
    assert.equal(JSON.parse(detail.body).health.state,'healthy');
    const memberReader=require('../../src/helix/foundation/execution/work-result-reader').createWorkResultReader({schemaManifest,unitOfWork}),
      assessmentWorks=memberReader.listWorks({ownerDomain:'arca',processType:'arca_shelf_entry',processId:entry.shelf_entry_id,workKind:'health_assessment'});
    let aggregateCount=0;
    for(const work of assessmentWorks) {
      const rows=memberReader.read(work.work_id);
      for(const row of rows.filter(item=>item.result?.memberAssessmentSet)) {
        const members=rows.filter(item=>item.result?.memberScope&&item.attemptId===row.attemptId&&item.planId===row.planId)
          .sort((a,b)=>Buffer.from(a.result.memberScope.materialKey).compare(Buffer.from(b.result.memberScope.materialKey))),
          refs=members.map(item=>({materialKey:item.result.memberScope.materialKey,eventId:item.eventId,resultId:item.resultId,
            resultDigest:item.resultDigest,inputBindingDigest:item.inputBindingDigest}));
        assert.equal(members.length,physicalCount);assert.equal(row.result.memberAssessmentSet.memberCount,physicalCount);
        assert.equal(row.result.memberAssessmentSet.digest,canonicalDigest({schema:'arca.series-member-assessment-set@1',
          workId:work.work_id,workAttemptId:row.attemptId,planId:row.planId,spaceBasisDigest:members[0].result.memberScope.spaceBasisDigest,members:refs}));
        assert.ok(members.every(item=>item.outcomeKind==='succeeded'&&Buffer.byteLength(JSON.stringify(item.result))<=65536));
        aggregateCount++;
      }
    }
    assert.ok(aggregateCount>0,'The actual Runtime must persist complete member observations and their aggregate.');
    const current=db.prepare('SELECT * FROM arca_shelf_entries').get();assert.equal(current.current_inventory_revision,2);
    const materials=db.prepare('SELECT * FROM arca_inventory_materials WHERE inventory_revision=2').all();
    assert.equal(materials.length,inventory.length);
    for(const original of repaired) {
      const replacement=materials.find(item=>path.resolve(item.location)===path.resolve(original.location)),number=readInventoryArtifactScope(original)?.episodeScope?.episodeNumber;
      assert.ok(replacement,JSON.stringify(materials));
      assert.equal(replacement.artifact_scope_json,original.artifact_scope_json);
      assert.notEqual(replacement.material_key,original.material_key);
      if(number)assert.ok(fs.readFileSync(replacement.location,'utf8').includes('<episode>'+number+'</episode>'));
      else {assert.equal(replacement.role,'poster');assert.deepEqual(fs.readFileSync(replacement.location),poster);}
      assert.equal(fs.existsSync(original.location+'.superseded-'+care.aftercare_case_id),false);
    }
    const posterRequests=artifactCalls.filter(item=>item.operationId==='arca.aftercare.binary_artifact.acquire@1');
    if(posterRepair){assert.equal(posterRequests.length,1);assert.equal(posterRequests[0].resolvedProviderIdentity.namespace,'tmdb_series');assert.equal(posterRequests[0].resolvedProviderIdentity.providerKey,'1399');assert.equal(posterRequests[0].resolvedProviderIdentity.seasonNumber,1);}
    assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM arca_aftercare_settlement_approvals WHERE state='consumed'").get().n,1);
    const controlPort=require('../../src/helix/foundation/persistence/material-control').createMaterialControlProjectionPort({schemaManifest,unitOfWork}),
      controls=controlPort.getMaterialControlProjections([...materials,...repaired].map(item=>item.material_key).sort());
    for(const original of repaired)assert.equal(controls.find(item=>item.materialKey===original.material_key).controlState,'uncontrolled');
    for(const material of materials) {
      const control=controls.find(item=>item.materialKey===material.material_key);
      assert.equal(control.controlState,'controlled');assert.equal(control.ownerDomain,'arca');assert.equal(control.ownerScopeId,entry.shelf_entry_id);
    }
    const historical=db.prepare('SELECT * FROM arca_inventory_materials WHERE inventory_revision=1 ORDER BY ordinal').all(),
      withoutGuard=({active_guard,...row})=>row;
    assert.deepEqual(historical.map(withoutGuard),[...inventory].sort((a,b)=>a.ordinal-b.ordinal).map(withoutGuard));
    assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');
    for(const {item,bytes} of protectedFiles) {
      assert.deepEqual(fs.readFileSync(item.location),bytes);
      const retained=materials.find(row=>row.material_key===item.material_key);assert.ok(retained);
      assert.equal(retained.artifact_scope_json,item.artifact_scope_json);
    }
    // People registration is asynchronous; allow its legitimate relation revision to settle first.
    if(browserFlow)await browserFlow.checkHealth(collection[0],'care-recheck-');
    else await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'series-nfo-post-repair-check'});
    maintenanceClock=Date.parse('2026-10-31T03:00:00+08:00');maintenanceClockStart=Date.now();
    const settleUntil=Date.now()+120000;let settled,pendingPeople;
    do {
      assert.ifError(runtimeError);
      settled=JSON.parse((await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).body);
      pendingPeople=db.prepare('SELECT count(*) n FROM arca_inventory_person_relations p JOIN arca_shelf_entries e ON e.shelf_entry_id=p.shelf_entry_id AND e.current_inventory_revision=p.inventory_revision WHERE p.person_id IS NULL').get().n;
      if(!pendingPeople&&settled.health.state==='healthy')break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<settleUntil);
    assert.equal(settled.health.state,'healthy');assert.equal(pendingPeople,0);
    maintenanceClock=Date.parse('2026-10-31T09:00:00+08:00');maintenanceClockStart=Date.now();
    const normalUntil=Date.now()+10000;while(Date.now()<normalUntil&&!JSON.parse((await request('GET','/v1/admin/runtime')).body).normalSupplyAllowed)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(JSON.parse((await request('GET','/v1/admin/runtime')).body).normalSupplyAllowed,true);
    const healthyCollection=JSON.parse((await request('GET','/v1/admin/collection')).body).items.find(item=>item.shelfEntryId===entry.shelf_entry_id);
    assert.deepEqual(healthyCollection.health,settled.health,'Collection and Care must project the same current health.');
    if(browserFlow)await browserFlow.verifyHealthy(collection[0]);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n,1);
    const settledTables=['arca_shelf_entries','arca_inventory_materials','arca_inventory_product_facts','arca_aftercare_cases',
      'arca_aftercare_inventory_commits','arca_aftercare_settlement_approvals','fx_material_controls'],
      settledSnapshot=()=>JSON.stringify(settledTables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])),
      beforeRestart=settledSnapshot();
    await host.close();host=await createCleanServiceHost(hostOptions);
    const restartedLogin=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});
    assert.equal(restartedLogin.statusCode,204,restartedLogin.body);cookie=restartedLogin.headers['set-cookie'];
    const restarted=JSON.parse((await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).body);
    assert.equal(settledSnapshot(),beforeRestart);
    assert.equal(restarted.health.state,'healthy');assert.equal(restarted.history.cases.length,1);
    assert.equal(restarted.history.cases[0].state,'resolved');assert.equal(settledSnapshot(),beforeRestart);
  }
  if(append) {
    const firstRun=state.runs[0],firstEntry=db.prepare('SELECT * FROM arca_shelf_entries').get();
    const immutableInventory=rows=>rows.map(({active_guard,...row})=>row);
    const oldInventory=JSON.stringify(immutableInventory(inventory)),oldFacts=JSON.stringify(db.prepare('SELECT * FROM arca_deck_fact_revisions').all());
    fs.writeFileSync(path.join(source,'Demo Show.S01E03.mkv'),'third-series-fixture');
    const field=createMaterialFieldStore(deps).getMaterialField(sourceFieldId);
    if(browserFlow) {
      await browserFlow.scanNextBatch();
      const until=Date.now()+60000;
      let pending;
      do {
        pending=(await request('GET','/v1/admin/formation?section=active')).json().items.find(item=>item.productIdentityIssue);
        if(pending)break;
        assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,100));
      } while(Date.now()<until);
      assert.ok(pending,'Appended batch identity must be available to the user.');
      assert.deepEqual(pending.seriesDelivery.episodeKeys,['E003']);
      await browserFlow.chooseIdentity('append-');
    } else await request('POST','/v1/admin/material-fields/series-field/actions/observe',{idempotencyKey:'series-observe-e03',fieldId:'series-field',expectedAccessRevision:1,
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
    const latestNfoScopes=latestInventory.filter(item=>item.role==='metadata_sidecar').map(readInventoryArtifactScope);
    assert.deepEqual(latestNfoScopes.filter(scope=>scope.episodeScope).map(scope=>scope.episodeScope.episodeNumber).sort((a,b)=>a-b),[1,2,3]);
    for(const old of finalNfos)assert.equal(latestInventory.find(item=>item.material_key===old.material_key).artifact_scope_json,old.artifact_scope_json);
    const latestPrimary=latestInventory.filter(row=>row.role==='primary_payload');
    assert.deepEqual(latestPrimary.flatMap(row=>JSON.parse(row.episode_claims_json).items.map(claim=>claim.episodeKey)).sort(),['E001','E002','E003'],JSON.stringify({currentEntry,inventory:db.prepare('SELECT inventory_revision,role,episode_claims_json FROM arca_inventory_materials').all(),receipts:db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()}));
    assert.ok(latestPrimary.every(row=>row.active_guard===1));
    assert.ok(db.prepare('SELECT active_guard FROM arca_inventory_materials WHERE inventory_revision=1').all().every(row=>row.active_guard===0));
    const latestFacts=db.prepare("SELECT * FROM arca_inventory_product_facts WHERE inventory_revision=? AND fact_kind='product_metadata'").all(currentEntry.current_inventory_revision);
    assert.equal(latestFacts.length,2);
    assert.equal(new Set(latestFacts.map(row=>row.source_package_id)).size,2);
    const rawCare=require('../../src/helix/domains/arca/persistence/aftercare-store').createAftercareStore({schemaManifest,unitOfWork})
      .currentContext(currentEntry.shelf_entry_id);
    const carePlacement=require('../../src/helix/domains/arca/model/aftercare-placement'),
      careInventoryPort=require('../../src/clean-arca-inventory-port').createCleanArcaInventoryPort({schemaManifest,unitOfWork,
        workspaceRoot:path.join(dataDir,'workspaces','libra')}),careContext={shelfEntryId:currentEntry.shelf_entry_id,raw:rawCare},
      currentPlacement=carePlacement.buildAftercareInventoryRequest(careContext,careInventoryPort,Date.now(),'fixture-care-current');
    assert.equal(carePlacement.placementMatchesInventory(careContext,currentPlacement),true);
    const movedContext=structuredClone(careContext);
    movedContext.raw.placement.value.folderTemplate='Relocated {title}';
    const movedPlacement=carePlacement.buildAftercareInventoryRequest(movedContext,careInventoryPort,Date.now(),'fixture-care-move');
    assert.equal(carePlacement.placementMatchesInventory(movedContext,movedPlacement),false);
    for(const member of movedPlacement.finalInventoryDecision.members) {
      const original=rawCare.materials.find(item=>item.material_key===member.sourceMaterialKey);
      assert.equal(member.finalName,path.basename(original.location));
      assert.ok(member.targetLocation.includes('Relocated Demo Show'));
      assert.equal(fs.existsSync(member.targetLocation),false);
    }
    const renderCareNfo=require('../../src/helix/domains/arca/model/aftercare-series-nfo').renderSeriesAftercareNfo;
    for(const material of rawCare.materials.filter(item=>item.role==='metadata_sidecar')) {
      const rendered=renderCareNfo({raw:rawCare},material.material_key),xml=rendered.bytes.toString('utf8');
      if(rendered.scope.episodeScope) {
        const number=rendered.scope.episodeScope.episodeNumber;
        assert.match(xml,/^<episodedetails>/);assert.ok(xml.includes('<episode>'+number+'</episode>'));
        const record=rawCare.facts.find(item=>item.fact_kind==='product_metadata'&&item.source_package_id===rendered.scope.sourcePackageId)
          .value.episodeMetadata.find(item=>item.episodeScope.episodeNumber===number);
        const title=record.descriptiveFacts.entries.find(item=>item.key==='episode_title').value;
        assert.ok(xml.includes('<title>'+title+'</title>'));
      } else {assert.match(xml,/^<tvshow>/);assert.doesNotMatch(xml,/<episode>/);}
    }
    const metadataCheck=require('../../src/helix/domains/arca/model/series-metadata').seriesInventoryMetadataFieldMissing;
    assert.equal(metadataCheck(rawCare,'episode_title'),false);
    assert.equal(metadataCheck(rawCare,'episode_plot'),false);
    const alteredCare=structuredClone(rawCare),thirdMetadata=alteredCare.facts.filter(item=>item.fact_kind==='product_metadata')
      .flatMap(item=>item.value.episodeMetadata).find(item=>item.episodeScope.episodeKey==='E003');
    thirdMetadata.descriptiveFacts.entries=thirdMetadata.descriptiveFacts.entries.filter(item=>item.key!=='episode_title');
    assert.equal(metadataCheck(alteredCare,'episode_title'),true);
    assert.equal(metadataCheck(rawCare,'episode_title'),false);
    assert.deepEqual(latestFacts.flatMap(row=>require('../../src/helix/contracts/episode-metadata-records').readStoredMetadataValue(row).episodeMetadata.map(item=>item.episodeScope.episodeKey)).sort(),['E001','E002','E003']);
    const appendedCollection=JSON.parse((await request('GET','/v1/admin/collection?status=current')).body).items;
    if(anchored){
      const appendedFormation=JSON.parse((await request('GET','/v1/admin/formation/'+firstRun.subject_id)).body);
      assert.deepEqual(appendedFormation.seriesDelivery.episodeKeys,['E003']);
      assert.equal(appendedFormation.seriesDelivery.physicalFileCount,1);
      const completedFormation=JSON.parse((await request('GET','/v1/admin/formation?section=completed')).body);
      assert.deepEqual(completedFormation.items.find(item=>item.subjectId===firstRun.subject_id).seriesDelivery,appendedFormation.seriesDelivery);
    }
    assert.equal(appendedCollection.length,1);assert.equal(appendedCollection[0].series.episodeCount,3);
    if(browserFlow)await browserFlow.verifyCollection(appendedCollection[0],'append-');
    assert.deepEqual(appendedCollection[0].series.episodes.map(item=>item.episodeKey),['E001','E002','E003']);
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
        onDeckPackageId:pkg.on_deck_package_id,packageDigest:pkg.package_digest,shelfId:sourceShelfId};
      const historical=onDeck.readHistoricalCommitted(input),byPackage=onDeck.readCommittedByPackage(input);
      assert.equal(historical.replayed,true);assert.equal(byPackage.replayed,true);
      assert.equal(historical.commitDigest,receipt.commit_digest);assert.equal(byPackage.commitDigest,receipt.commit_digest);
      assert.equal(historical.result.onDeckCommitReceipt.inventoryRevision,receipt.inventory_revision);
      assert.throws(()=>onDeck.readHistoricalCommitted({...input,packageDigest:D('foreign')}));
      assert.throws(()=>onDeck.readCommittedByPackage({...input,custodyId:'foreign'}));
    }
    assert.equal(db.prepare('SELECT count(*) n FROM arca_deck_fact_revisions').get().n,2);

  }
  if(multiSeason) {
    if(process.env.HELIX_SERIES_SHARED_MISSING_BEFORE_NEW_SEASON==='1')fs.unlinkSync(path.join(sharedScope.root_location,'fanart.jpg'));
    maintenanceClock=Date.parse('2026-10-31T03:00:00+08:00');maintenanceClockStart=Date.now();
    const peopleDeadline=Date.now()+30000;
    while(db.prepare('SELECT count(*) n FROM arca_inventory_person_relations p JOIN arca_shelf_entries e ON e.shelf_entry_id=p.shelf_entry_id AND e.current_inventory_revision=p.inventory_revision WHERE p.person_id IS NULL').get().n&&Date.now()<peopleDeadline) {
      assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(db.prepare('SELECT count(*) n FROM arca_inventory_person_relations p JOIN arca_shelf_entries e ON e.shelf_entry_id=p.shelf_entry_id AND e.current_inventory_revision=p.inventory_revision WHERE p.person_id IS NULL').get().n,0,JSON.stringify({works:db.prepare("SELECT work_id,work_kind,state,process_id FROM fx_supporting_works WHERE state<>'succeeded'").all(),events:db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE state NOT IN ('succeeded','skipped')").all(),failures:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    maintenanceClock=Date.parse('2026-10-31T09:00:00+08:00');maintenanceClockStart=Date.now();
    const normalUntil=Date.now()+10000;while(Date.now()<normalUntil&&!JSON.parse((await request('GET','/v1/admin/runtime')).body).normalSupplyAllowed)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(JSON.parse((await request('GET','/v1/admin/runtime')).body).normalSupplyAllowed,true);
    const firstEntry=db.prepare('SELECT * FROM arca_shelf_entries').get();
    const firstTables=['arca_inventory_materials','arca_inventory_product_facts','arca_deck_fact_revisions','arca_ondeck_commit_receipts'];
    const snapshot=()=>firstTables.map(table=>[table,db.prepare('SELECT * FROM '+table+' WHERE shelf_entry_id=? ORDER BY rowid').all(firstEntry.shelf_entry_id)]);
    const before=snapshot(),files=inventory.map(item=>({location:item.location,bytes:fs.readFileSync(item.location)}));
    const secondSource=path.join(path.dirname(source),'Season 02');
    fs.mkdirSync(secondSource);fs.writeFileSync(path.join(secondSource,'Demo Show.S02E01.mkv'),'second-season-first-episode');
    const field=createMaterialFieldStore(deps).getMaterialField(sourceFieldId);
    if(browserFlow)await browserFlow.scanNextBatch();
    else await request('POST','/v1/admin/material-fields/'+sourceFieldId+'/actions/observe',{
      idempotencyKey:'series-observe-s02',fieldId:sourceFieldId,expectedAccessRevision:1,
      expectedObservationRevision:field.currentObservationRevision,pageBudget:8});
    const deadline=Date.now()+90000;
    while(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n<2&&Date.now()<deadline) {
      assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,2,JSON.stringify({
      runs:db.prepare('SELECT state FROM libra_runs').all(),failures:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    const entries=(await request('GET','/v1/admin/collection?status=current')).json().items;
    assert.equal(entries.length,2);
    assert.deepEqual(entries.map(entry=>entry.series.seasonNumber).sort(),[1,2]);
    const second=entries.find(entry=>entry.series.seasonNumber===2);
    assert.notEqual(second.shelfEntryId,firstEntry.shelf_entry_id);
    assert.deepEqual(second.series.episodes.map(episode=>episode.episodeKey),['E001']);
    assert.equal(second.series.physicalFileCount,1);
    assert.deepEqual(entries.find(entry=>entry.series.seasonNumber===1).series,collection[0].series);
    assert.equal(db.prepare('SELECT count(*) n FROM libra_subjects').get().n,2);
    assert.deepEqual(snapshot(),before);
    for(const file of files)assert.deepEqual(fs.readFileSync(file.location),file.bytes);
    const secondEntry=db.prepare('SELECT * FROM arca_shelf_entries WHERE shelf_entry_id=?').get(second.shelfEntryId);
    const secondMembers=db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=?')
      .all(second.shelfEntryId,secondEntry.current_inventory_revision);
    assert.ok(secondMembers.every(member=>!files.some(file=>file.location===member.location)));
    for(const member of secondMembers.filter(item=>item.role==='metadata_sidecar')) {
      const scope=readInventoryArtifactScope(member);assert.equal(scope.seasonNumber,2);
      if(scope.episodeScope)assert.equal(scope.episodeScope.episodeNumber,1);
    }
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    if(browserFlow)for(const entry of entries)await browserFlow.verifyCollection(entry,'season-'+entry.series.seasonNumber+'-');
    if(process.env.HELIX_SERIES_MULTI_SEASON_BATCH_EXIT==='1'){
      const beforeRoot=sharedManifest.members.map(member=>({location:member.location,bytes:fs.readFileSync(member.location),inode:fs.statSync(member.location).ino}));
      const review=(await request('POST','/v1/admin/offdeck/reviews',{shelfEntryIds:entries.map(row=>row.shelfEntryId),originKind:'batch',actorId:'series-fixture',idempotencyKey:'all-seasons-review'})).json();assert.equal(review.scopes.length,2);assert.ok(review.scopes.every(scope=>scope.materials.every(row=>!row.sharedScopeId)));
      await request('POST','/v1/admin/offdeck/reviews/'+review.reviewId+'/actions/confirm-selection',{actorId:'series-fixture',idempotencyKey:'all-seasons-confirm'});
      const authorization=(await request('POST','/v1/admin/offdeck/authorizations',{reviewId:review.reviewId,actorId:'series-fixture',idempotencyKey:'all-seasons-authorize'})).json();assert.equal(authorization.cases.length,2);
      const deadline=Date.now()+60000;while(Date.now()<deadline&&(db.prepare("SELECT count(*) n FROM arca_shelf_entries WHERE status<>'offdecked'").get().n||db.prepare("SELECT count(*) n FROM fx_material_controls WHERE owner_scope_type='series_presentation' AND state='controlled'").get().n)){assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,50));}
      assert.equal(db.prepare("SELECT count(*) n FROM arca_shelf_entries WHERE status='offdecked'").get().n,2);assert.equal(db.prepare("SELECT count(*) n FROM arca_series_presentation_references WHERE state='active'").get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM fx_material_controls WHERE owner_scope_type='series_presentation' AND state='controlled'").get().n,0);
      for(const row of beforeRoot){assert.deepEqual(fs.readFileSync(row.location),row.bytes);assert.equal(fs.statSync(row.location).ino,row.inode);}assert.equal(db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE command_contract='arca.series-presentation.retained-retirement@1'").get().n,1);assert.deepEqual(db.pragma('foreign_key_check'),[]);t.diagnostic(JSON.stringify({batchExit:2,retainedSharedFiles:3,activeSharedControls:0,activeReferences:0}));
    }
    if(process.env.HELIX_SERIES_MULTI_SEASON_OFFDECK==='1') {
      const untilPeople=Date.now()+30000;
      const pendingPeople=()=>db.prepare('SELECT count(*) n FROM arca_inventory_person_relations p JOIN arca_shelf_entries e ON e.shelf_entry_id=p.shelf_entry_id AND e.current_inventory_revision=p.inventory_revision WHERE p.person_id IS NULL').get().n;
      while(pendingPeople()&&Date.now()<untilPeople)await new Promise(resolve=>setTimeout(resolve,50));
      assert.equal(pendingPeople(),0);
      const exitEntry=db.prepare('SELECT * FROM arca_shelf_entries WHERE shelf_entry_id=?').get(second.shelfEntryId);
      const exitMaterials=db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=?').all(second.shelfEntryId,exitEntry.current_inventory_revision);
      const protectedControls=()=>db.prepare('SELECT * FROM fx_material_controls WHERE owner_scope_id=? ORDER BY material_key').all(firstEntry.shelf_entry_id);
      const controlsBefore=protectedControls(),exitBytes=exitMaterials.map(item=>fs.readFileSync(item.location));
      const review=browserFlow?await browserFlow.prepareOffdeck(second,exitMaterials,async()=>{
        assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_authorizations').get().n,0);
        for(const file of files)assert.deepEqual(fs.readFileSync(file.location),file.bytes);
        exitMaterials.forEach((item,index)=>assert.deepEqual(fs.readFileSync(item.location),exitBytes[index]));
      },entries.find(entry=>entry.series.seasonNumber===1)):(await request('POST','/v1/admin/offdeck/reviews',{
        shelfEntryId:second.shelfEntryId,originKind:'direct_intent',actorId:'series-fixture',idempotencyKey:'season-exit-review'})).json();
      assert.equal(review.scopes.length,1);assert.equal(review.scopes[0].shelfEntryId,second.shelfEntryId);
      assert.deepEqual(review.scopes[0].materials.map(item=>item.materialKey).sort(),exitMaterials.map(item=>item.material_key).sort());
      if(browserFlow)await browserFlow.confirmOffdeck(review.reviewId);
      else await request('POST','/v1/admin/offdeck/reviews/'+review.reviewId+'/actions/confirm-selection',{actorId:'series-fixture',idempotencyKey:'season-exit-confirm'});
      const authorization=browserFlow?await browserFlow.authorizeOffdeck():(await request('POST','/v1/admin/offdeck/authorizations',{
        reviewId:review.reviewId,actorId:'series-fixture',idempotencyKey:'season-exit-authorize'})).json();
      assert.equal(authorization.cases.length,1);
      const deadline=Date.now()+60000;let exitCase;
      do {assert.ifError(runtimeError);exitCase=db.prepare('SELECT state FROM arca_offdeck_cases WHERE offdeck_case_id=?').get(authorization.cases[0]);
        if(exitCase?.state==='completed')break;await new Promise(resolve=>setTimeout(resolve,50));
      }while(Date.now()<deadline);
      assert.equal(exitCase?.state,'completed');
      assert.equal(db.prepare('SELECT status FROM arca_shelf_entries WHERE shelf_entry_id=?').get(second.shelfEntryId).status,'offdecked');
      assert.equal(db.prepare('SELECT status FROM arca_shelf_entries WHERE shelf_entry_id=?').get(firstEntry.shelf_entry_id).status,'active');
      for(const item of exitMaterials)assert.equal(fs.existsSync(item.location),false);
      for(const file of files)assert.deepEqual(fs.readFileSync(file.location),file.bytes);
      assert.deepEqual(snapshot(),before);assert.deepEqual(protectedControls(),controlsBefore);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_terminal_receipts').get().n,1);
      assert.deepEqual(db.pragma('foreign_key_check'),[]);
      if(browserFlow){await browserFlow.verifyOffdeck(second,entries.find(entry=>entry.series.seasonNumber===1));await browserFlow.verifyCollection(entries.find(entry=>entry.series.seasonNumber===1),'protected-season-');}
      t.diagnostic(JSON.stringify({offdeckSeason:2,deletedMaterials:exitMaterials.length,protectedSeason:1,protectedFiles:files.length}));
    }
    const rootVersions=db.prepare('SELECT revision FROM arca_series_presentation_versions ORDER BY revision').all();assert.equal(rootVersions.length,process.env.HELIX_SERIES_SHARED_MISSING_BEFORE_NEW_SEASON==='1'?2:1);
    if(process.env.HELIX_SERIES_SHARED_MISSING_BEFORE_NEW_SEASON==='1'){assert.ok(fs.existsSync(path.join(sharedScope.root_location,'fanart.jpg')));assert.deepEqual(db.prepare('SELECT shared_version FROM arca_series_presentation_commit_links ORDER BY committed_at_ms').all().map(row=>Number(row.shared_version)),[1,2]);assert.equal(sharedArtifactCalls.length,6);}
    t.diagnostic(JSON.stringify({seasons:entries.map(entry=>({season:entry.series.seasonNumber,episodes:entry.series.episodeCount})),protectedFirstSeasonFiles:files.length}));
  }

  if(relatedFixture){
    // Cleanup inspection and the recorded recycle effect use separate 30s sweeps.
    const cleanupDeadline=Date.now()+90000;
    while(fs.existsSync(source)&&Date.now()<cleanupDeadline)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(fs.existsSync(source),false,'An empty old Season directory must finish the existing Arca cleanup flow. '+JSON.stringify({files:fs.existsSync(source)?fs.readdirSync(source):[],checks:db.prepare('SELECT * FROM arca_source_cleanup_checks').all()}));
    assert.ok(fs.existsSync(path.dirname(source)),'Source show parent must remain.');
  }
});
