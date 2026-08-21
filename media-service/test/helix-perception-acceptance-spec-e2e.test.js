'use strict';

const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');const Database=require('better-sqlite3');
const {initializeCleanData}=require('../scripts/helix-operational-safety');const {createCleanServiceHost}=require('../src/clean-service-host');const {canonicalDigest}=require('../src/helix/contracts/canonical-json');

const SECRET='perception-acceptance-spec-e2e-20260812';
const pause=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
function probe(){return Object.freeze({async probe(handle){const value={resultKind:'probed',sourceHandleDigest:canonicalDigest(handle),durationMs:1000,videoStreams:[{streamIndex:0,codec:'h264',dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null,payloadDigest:''};value.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='payloadDigest')));return value;}});}
function routingHandle(){return Object.freeze({schemaRef:'helix://contracts/types/IntegrationHandle/v1',schemaVersion:1,
  handleId:'perception-spec-tmdb-handle',integrationId:'perception-spec-tmdb',integrationType:'tmdb',configRevision:1,
  secretRef:'perception-spec-tmdb-secret',allowedOperation:'libra.routing.fact.observe@1',expiresAtMs:Number.MAX_SAFE_INTEGER,
  fenceDigest:canonicalDigest('perception-spec-tmdb-fence')});}
function productHandle(intent,operationId,artifactKind=null){const basis={schemaRef:'helix://contracts/types/IntegrationHandle/v1',schemaVersion:1,
  handleId:canonicalDigest({schema:'perception-spec-product-handle-id@1',operationId,artifactKind}),integrationId:intent.integrationId,
  integrationType:'tmdb',configRevision:intent.configRevision,secretRef:'test-secret:tmdb',allowedOperation:operationId,
  expiresAtMs:4_102_444_800_000};return Object.freeze({...basis,
  fenceDigest:canonicalDigest({schema:'perception-spec-product-handle@1',...basis})});}
async function productMetadataFetch({metadataFetchIntent:intent}){return Object.freeze({providerKind:'tmdb',integrationId:intent.integrationId,
    configRevision:intent.configRevision,descriptiveEntries:Object.freeze([
      {key:'director',value:'Test Director'},{key:'genre',value:'Drama'},{key:'plot',value:'Test plot'},
      {key:'title',value:'Rating Matrix Movie'},{key:'tmdb_movie_id',value:intent.resolvedProviderIdentity.providerKey},
      {key:'year_or_release_date',value:2024},
    ]),providerIdentities:Object.freeze([intent.resolvedProviderIdentity]),peopleHints:Object.freeze([Object.freeze({
      displayName:'Test Actor',role:'actor',providerIdentities:Object.freeze([Object.freeze({
        provider:'tmdb',namespace:'tmdb_person',providerKey:'990101'})])})])});}
async function productArtifactFetch({artifactKind,resolvedProviderIdentity,integrationHandle}){return Object.freeze({resultKind:'acquired',
  bytes:Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9','hex'),artifactKind,
  integrationId:integrationHandle.integrationId,configRevision:integrationHandle.configRevision,mediaType:'image/jpeg',
  resolvedProviderIdentity});}
function productionOptions(){return {routingIntegrationHandleResolver:()=>routingHandle(),
  productIntegrationHandleResolver:({intent,operationId,artifactKind})=>productHandle(intent,operationId,artifactKind||null),
  productProviderMetadataFetch:productMetadataFetch,productProviderArtifactFetch:productArtifactFetch,
  routingProviderObservation:async({intent})=>Object.freeze([Object.freeze({providerKey:'990001',
    title:intent.candidateDisplayTitle,originalTitle:intent.candidateDisplayTitle,releaseYear:2024,
    regionCodes:Object.freeze(['US']),genreCodes:Object.freeze(['18'])})])};}
async function session(host,key){const response=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':key}});assert.equal(response.statusCode,204,response.body);return response.headers['set-cookie'];}
async function waitFormation(host,cookie,predicate){const deadline=Date.now()+30_000;let item;while(Date.now()<deadline){for(const url of ['/v1/admin/formation?section=active','/v1/admin/formation?section=completed&limit=100']){const response=await host.inject({method:'GET',url,headers:{cookie}});assert.equal(response.statusCode,200,response.body);item=response.json().items[0];if(item&&predicate(item))return item;}await pause(25);}assert.fail('Formation did not reach the expected state: '+JSON.stringify(item));}
async function waitRating(host,cookie,targetType,targetId,predicate){const deadline=Date.now()+30_000;let current;while(Date.now()<deadline){const response=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType='+targetType+'&targetId='+encodeURIComponent(targetId),headers:{cookie}});assert.equal(response.statusCode,200,response.body);current=response.json().currentRating;if(current&&predicate(current))return current;await pause(25);}assert.fail('Rating did not reach the expected state: '+JSON.stringify(current));}
async function waitShelfEntry(dataDir,runtimeError){const deadline=Date.now()+30_000;let current=null;while(Date.now()<deadline){if(runtimeError())throw runtimeError();const database=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});try{current=database.prepare('SELECT shelf_entry_id FROM arca_shelf_entries ORDER BY created_at_ms LIMIT 1').get();if(current)return current;}finally{database.close();}await pause(25);}assert.fail('Arca did not establish the accepted Shelf Entry: '+JSON.stringify(current));}

test('ratings after On-deck append immutable Perception records without reopening the completed Libra Run',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-perception-spec-'));t.after(()=>{if(process.env.HELIX_KEEP_TEST_ASSETS!=='1')fs.rmSync(root,{recursive:true,force:true});});const dataDir=path.join(root,'data'),admin=path.join(root,'admin'),field=path.join(root,'field'),shelf=path.join(root,'shelf');
  [admin,field,shelf].forEach((dir)=>fs.mkdirSync(dir,{recursive:true}));fs.writeFileSync(path.join(admin,'index.html'),'<div id="root"></div>');fs.writeFileSync(path.join(field,'Rating Matrix Movie.mkv'),'movie');
  const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:SECRET});let runtimeError=null;const host=await createCleanServiceHost({dataDir,adminDistDir:admin,secretRoot:SECRET,mediaProbe:probe(),...productionOptions(),onExecutionRuntimeError(error){runtimeError=error;if(process.env.HELIX_TEST_LOG_RUNTIME_ERROR==='1')console.error(error);}});
  try{const cookie=await session(host,initialized.adminApiKey),headers={cookie};
    let response=await host.inject({method:'POST',url:'/v1/admin/shelves',headers,payload:{idempotencyKey:'shelf-create',shelfId:'rating-shelf',name:'评分测试收藏架',targetRootLocation:shelf,ruleTemplateId:'system-beta-recommended',expectedTemplateRevision:1,placementPolicy:{folderTemplate:'{title} ({year})',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}}});assert.equal(response.statusCode,201,response.body);
    const policyValue={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},access={fieldId:'rating-field',revision:1,endpointId:'rating-endpoint',rootLocation:field,mountScopeId:'rating-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/rating-field-access/v1'};
    response=await host.inject({method:'POST',url:'/v1/admin/material-fields',headers,payload:{idempotencyKey:'field-create',fieldId:'rating-field',name:'rating field',contentProfileHint:'movie',policy:{extractionPolicyId:'rating-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy:policyValue,policyDigest:canonicalDigest({extractionPolicyId:'rating-policy',revision:1,...policyValue})},access:{...access,accessDigest:canonicalDigest(access)}}});assert.equal(response.statusCode,201,response.body);
    response=await host.inject({method:'PATCH',url:'/v1/admin/routing/material-fields/rating-field',headers,payload:{idempotencyKey:'routing-publish',fieldId:'rating-field',expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:'rating-routing',mode:'direct',targets:[{shelfId:'rating-shelf',rank:1,matchExpression:{nodeKind:'always'}}]}}});assert.equal(response.statusCode,200,response.body);
    response=await host.inject({method:'POST',url:'/v1/admin/material-fields/rating-field/actions/observe',headers,payload:{idempotencyKey:'observe',fieldId:'rating-field',expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8}});assert.equal(response.statusCode,202,response.body);
    const noRating=await waitFormation(host,cookie,(item)=>item.acceptanceSpecRevision===1);assert.equal(noRating.displayIdentity,'Rating Matrix Movie');assert.ifError(runtimeError);
    const shelfEntry=await waitShelfEntry(dataDir,()=>runtimeError);assert.ok(shelfEntry.shelf_entry_id);
    const ratingSpecs=[];let previousDigest=noRating.acceptanceSpecDigest;
    for(const rating of [1,2,3,4,5]){response=await host.inject({method:'POST',url:'/v1/admin/perception/records',headers,payload:{targetType:'subject',targetId:noRating.subjectId,expectedRevision:rating-1,rating,idempotencyKey:'rating-'+rating}});assert.equal(response.statusCode,202,response.body);
      const formation=await waitFormation(host,cookie,(item)=>item.acceptanceSpecRevision===rating+1&&item.myRating===rating);assert.equal(formation.myRatingSource,'shelfdeck_direct');assert.equal(formation.myRatingRevision,rating);assert.notEqual(formation.acceptanceSpecDigest,previousDigest);assert.ifError(runtimeError);ratingSpecs.push(formation);previousDigest=formation.acceptanceSpecDigest;}
    const log=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType=subject&targetId='+encodeURIComponent(noRating.subjectId),headers});assert.equal(log.statusCode,200,log.body);assert.equal(log.json().currentRating.rating,5);assert.equal(log.json().currentRating.sourceKind,'shelfdeck_direct');
    await pause(1000);assert.ifError(runtimeError);
    let stableSpecCount;const database=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});try{const specs=database.prepare('SELECT spec_revision,spec_json FROM libra_acceptance_specs ORDER BY spec_revision').all().map((row)=>JSON.parse(row.spec_json));stableSpecCount=specs.length;assert.ok(stableSpecCount===6||stableSpecCount===7);
      assert.equal(new Set(specs.map((item)=>canonicalDigest(item.requirements))).size,6);if(stableSpecCount===7)assert.equal(specs[6].specDigest,specs[5].specDigest);assert.notDeepEqual(specs[2].requirements,specs[5].requirements);assert.equal(database.prepare("SELECT count(1) count FROM perception_records WHERE source_kind='shelfdeck_direct'").get().count,5);assert.equal(database.prepare("SELECT count(1) count FROM perception_record_relations WHERE relation_kind='supersedes'").get().count,4);assert.equal(database.prepare('SELECT count(1) count FROM libra_runs').get().count,1);assert.equal(database.prepare("SELECT count(1) count FROM libra_runs WHERE state='completed'").get().count,1);assert.equal(database.prepare("SELECT count(1) count FROM libra_runs WHERE state='superseded'").get().count,0);assert.ok(database.prepare('SELECT count(1) count FROM libra_workspaces').get().count>=1);assert.equal(database.prepare("SELECT count(1) count FROM libra_product_fact_revisions WHERE fact_kind IN ('resolved_identity','media_cast','product_metadata')").get().count,3);assert.equal(database.prepare('SELECT count(1) count FROM arca_shelf_entries').get().count,1);}finally{database.close();}
    await host.close();const restarted=await createCleanServiceHost({dataDir,adminDistDir:admin,secretRoot:SECRET,mediaProbe:probe(),...productionOptions(),onExecutionRuntimeError(error){runtimeError=error;}});try{await pause(500);const db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});try{const restartedSpecCount=db.prepare('SELECT count(1) count FROM libra_acceptance_specs').get().count;assert.ok(restartedSpecCount===stableSpecCount||restartedSpecCount===stableSpecCount+1);assert.ok(restartedSpecCount<=7);assert.equal(db.prepare('SELECT count(1) count FROM libra_runs').get().count,1);assert.equal(db.prepare('SELECT count(1) count FROM perception_records').get().count,5);assert.equal(db.prepare('SELECT count(1) count FROM arca_shelf_entries').get().count,1);}finally{db.close();}assert.ifError(runtimeError);}finally{await restarted.close();}
  }finally{if(!host.server?.listening){}else await host.close();}
});

test('Shelf Entry direct rating freezes an Arca public target projection without exposing Candidate identity',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-shelf-entry-rating-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dataDir=path.join(root,'data'),admin=path.join(root,'admin');fs.mkdirSync(admin,{recursive:true});fs.writeFileSync(path.join(admin,'index.html'),'<div id="root"></div>');
  const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:SECRET});const shelfEntryId='shelf-entry-fixture-1',projectionBody={targetType:'shelf_entry',targetId:shelfEntryId,targetRevision:7,title:'Arca Projection Movie',year:2022,providerIdentity:'tmdb_movie:777',shelfEntrySnapshotDigest:canonicalDigest({shelfEntryId,revision:7})};
  const targetProjection=Object.freeze({...projectionBody,targetDigest:canonicalDigest(projectionBody)});let runtimeError=null;const host=await createCleanServiceHost({dataDir,adminDistDir:admin,secretRoot:SECRET,perceptionTargetProjectionReader:(targetType,targetId)=>targetType==='shelf_entry'&&targetId===shelfEntryId?targetProjection:null,onExecutionRuntimeError(error){runtimeError=error;}});
  try{const cookie=await session(host,initialized.adminApiKey),response=await host.inject({method:'POST',url:'/v1/admin/perception/records',headers:{cookie},payload:{targetType:'shelf_entry',targetId:shelfEntryId,expectedRevision:0,rating:4,idempotencyKey:'shelf-entry-rating'}});assert.equal(response.statusCode,202,response.body);
    const current=await waitRating(host,cookie,'shelf_entry',shelfEntryId,(value)=>value.state==='ready'&&value.rating===4);assert.equal(current.sourceKind,'shelfdeck_direct');assert.equal(current.expectedRevision,1);assert.ifError(runtimeError);
    const log=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType=shelf_entry&targetId='+shelfEntryId,headers:{cookie}});assert.equal(log.statusCode,200,log.body);assert.equal(log.json().items.length,1);assert.equal(log.json().items[0].targetId,shelfEntryId);assert.equal(log.body.includes('candidate'),false);
    const database=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});try{assert.equal(database.prepare('SELECT count(1) count FROM perception_records').get().count,1);assert.equal(database.prepare("SELECT count(1) count FROM perception_identity_anchors WHERE anchor_kind='shelf_entry_id' AND anchor_value=?").get(shelfEntryId).count,1);assert.equal(database.prepare('SELECT count(1) count FROM libra_acceptance_specs').get().count,0);}finally{database.close();}
  }finally{await host.close();}
});

test('direct ratings for different Subjects can be acquired concurrently without sharing an active Source',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-concurrent-subject-ratings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dataDir=path.join(root,'data'),admin=path.join(root,'admin');fs.mkdirSync(admin,{recursive:true});fs.writeFileSync(path.join(admin,'index.html'),'<div id="root"></div>');
  const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:SECRET});
  const targets=new Map(['subject-rating-a','subject-rating-b'].map((targetId,index)=>{const body={targetType:'subject',targetId,targetRevision:1,title:'Concurrent Rating '+(index+1),year:2020+index,providerIdentity:'tmdb_movie:'+(880001+index)};return [targetId,Object.freeze({...body,targetDigest:canonicalDigest(body)})];}));
  let runtimeError=null;const host=await createCleanServiceHost({dataDir,adminDistDir:admin,secretRoot:SECRET,perceptionTargetProjectionReader:(targetType,targetId)=>targetType==='subject'?targets.get(targetId)||null:null,onExecutionRuntimeError(error){runtimeError=error;}});
  try{const cookie=await session(host,initialized.adminApiKey),headers={cookie};
    const responses=await Promise.all([...targets.keys()].map((targetId,index)=>host.inject({method:'POST',url:'/v1/admin/perception/records',headers,payload:{targetType:'subject',targetId,expectedRevision:0,rating:index+2,idempotencyKey:'concurrent-rating-'+index}})));
    responses.forEach((response)=>assert.equal(response.statusCode,202,response.body));
    await Promise.all([...targets.keys()].map((targetId,index)=>waitRating(host,cookie,'subject',targetId,(value)=>value.state==='ready'&&value.rating===index+2)));
    assert.ifError(runtimeError);
    const database=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});try{
      assert.equal(database.prepare("SELECT count(1) count FROM perception_sources WHERE source_kind='shelfdeck_direct'").get().count,2);
      assert.equal(database.prepare("SELECT count(DISTINCT perception_source_id) count FROM perception_records WHERE source_kind='shelfdeck_direct'").get().count,2);
      assert.equal(database.prepare("SELECT count(1) count FROM perception_acquisitions WHERE state='completed'").get().count,2);
    }finally{database.close();}
  }finally{await host.close();}
});
