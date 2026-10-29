'use strict';

const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');const Database=require('better-sqlite3');
const {canonicalDigest}=require('../src/helix/contracts/canonical-json');
const projectionPath=require.resolve('../src/helix/domains/perception/planning/perception-planners'),original=require(projectionPath);
let duringCommit=false,injectDrift=true;
require.cache[projectionPath].exports={...original,createPerceptionProjections(options){return original.createPerceptionProjections(options).map(entry=>{
  if(!entry.projectionRef.endsWith('/ResolutionCommitHandle/v1'))return entry;
  return {...entry,projection:{...entry.projection,project(args){
    if(!injectDrift||!args.parameters.processId.startsWith('subject:'))return entry.projection.project(args);
    duringCommit=true;try{return entry.projection.project(args);}finally{duringCommit=false;}
  }}};
});}};
const {initializeCleanData}=require('../scripts/helix-operational-safety');const {createCleanServiceHost}=require('../src/clean-service-host');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));const secret='perception-terminal-fixture-secret-20261029';
function probe(){return {async probe(handle){const value={resultKind:'probed',sourceHandleDigest:canonicalDigest(handle),container:'matroska',durationMs:1000,videoStreams:[{streamIndex:0,codec:'h264',codecProfile:'high',dispositionDefault:true,width:1920,height:1080,pixelFormat:'yuv420p',bitDepth:8,chroma:'4:2:0',colorRange:'limited',colorPrimaries:'bt709',colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr'}],audioStreams:[],subtitleStreams:[],discTopology:null,payloadDigest:''};value.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='payloadDigest')));return value;}};}
function routingHandle(){return {schemaRef:'helix://contracts/types/IntegrationHandle/v1',schemaVersion:1,handleId:'terminal-tmdb-handle',integrationId:'terminal-tmdb',integrationType:'tmdb',configRevision:1,secretRef:'test-secret',allowedOperation:'libra.routing.fact.observe@1',expiresAtMs:Number.MAX_SAFE_INTEGER,fenceDigest:canonicalDigest('terminal-tmdb-fence')};}

test('real Host exposes exhausted Resolution retries and recovers on a new Record Set',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-terminal-state-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dataDir=path.join(root,'data'),admin=path.join(root,'admin'),field=path.join(root,'field'),shelf=path.join(root,'shelf');
  [admin,field,shelf].forEach(dir=>fs.mkdirSync(dir,{recursive:true}));fs.writeFileSync(path.join(admin,'index.html'),'<div id="root"></div>');fs.writeFileSync(path.join(field,'Terminal State Movie.mkv'),'movie');
  const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:secret});const errors=[];let capturedUnitOfWork;
  function target(type,id){if(type!=='subject')return null;const revision=duringCommit?2:1,body={targetType:type,targetId:id,targetRevision:revision,title:'Terminal State Movie',year:2024,providerIdentity:null};return {...body,targetDigest:canonicalDigest(body)};}
  const host=await createCleanServiceHost({dataDir,adminDistDir:admin,secretRoot:secret,mediaProbe:probe(),perceptionTargetProjectionReader:target,unitOfWorkDecorator:value=>{capturedUnitOfWork=value;return value;},
    routingIntegrationHandleResolver:routingHandle,routingProviderObservation:async({intent})=>[{providerKey:'990001',title:intent.candidateDisplayTitle,originalTitle:intent.candidateDisplayTitle,releaseYear:2024,regionCodes:['US'],genreCodes:['18']}],
    onExecutionRuntimeError:error=>errors.push(error)});const database=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  try{
    let response=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(response.statusCode,204,response.body);const headers={cookie:response.headers['set-cookie']};
    response=await host.inject({method:'POST',url:'/v1/admin/shelves',headers,payload:{idempotencyKey:'shelf-create',shelfId:'terminal-shelf',name:'测试收藏架',targetRootLocation:shelf,ruleTemplateId:'system-beta-recommended',expectedTemplateRevision:1,placementPolicy:{folderTemplate:'{title} ({year})',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}}});assert.equal(response.statusCode,201,response.body);
    const policyValue={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},access={fieldId:'terminal-field',revision:1,endpointId:'terminal-endpoint',rootLocation:field,mountScopeId:'terminal-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/terminal-access/v1'};
    response=await host.inject({method:'POST',url:'/v1/admin/material-fields',headers,payload:{idempotencyKey:'field-create',fieldId:'terminal-field',name:'terminal field',contentProfileHint:'movie',policy:{extractionPolicyId:'terminal-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy:policyValue,policyDigest:canonicalDigest({extractionPolicyId:'terminal-policy',revision:1,...policyValue})},access:{...access,accessDigest:canonicalDigest(access)}}});assert.equal(response.statusCode,201,response.body);
    response=await host.inject({method:'PATCH',url:'/v1/admin/routing/material-fields/terminal-field',headers,payload:{idempotencyKey:'routing-publish',fieldId:'terminal-field',expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:'terminal-routing',mode:'direct',targets:[{shelfId:'terminal-shelf',rank:1,matchExpression:{nodeKind:'always'}}]}}});assert.equal(response.statusCode,200,response.body);
    response=await host.inject({method:'POST',url:'/v1/admin/material-fields/terminal-field/actions/observe',headers,payload:{idempotencyKey:'observe',fieldId:'terminal-field',expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8}});assert.equal(response.statusCode,202,response.body);
    const deadline=Date.now()+60000;let formation,failed,subjectId;
    while(Date.now()<deadline){
      response=await host.inject({method:'GET',url:'/v1/admin/formation?section=active',headers});assert.equal(response.statusCode,200,response.body);
      formation=response.json().items[0];subjectId=formation?.subjectId;
      if(subjectId)failed=database.prepare("SELECT work_id,state,basis_digest FROM fx_supporting_works WHERE process_id=? AND work_kind='resolution' AND state='failed'").get('subject:'+subjectId);
      if(failed&&formation.ratingState==='failed')break;
      await pause(100);
    }
    assert.ok(failed,JSON.stringify({formation,errors:errors.map(error=>error.message)}));assert.equal(formation.ratingState,'failed');assert.equal(formation.myRating,null);assert.equal(formation.ratingResolutionStatus,null);
    response=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType=subject&targetId='+encodeURIComponent(subjectId),headers});assert.equal(response.statusCode,200,response.body);
    assert.equal(response.json().currentRating.state,'failed');assert.equal(response.json().currentRating.reasonCode,'P4_EXECUTION_INPUT_BASIS_SUPERSEDED');
    response=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType=shelf_entry&targetId=missing',headers});assert.equal(response.statusCode,404,response.body);
    assert.equal(response.json().error.code,'PERCEPTION_TARGET_NOT_FOUND');assert.equal(typeof response.json().error.message,'string');assert.equal(typeof response.json().error.correlationId,'string');
    const attempts=database.prepare('SELECT ordinal,state,failure_code FROM fx_work_attempts WHERE work_id=? ORDER BY ordinal').all(failed.work_id);
    assert.deepEqual(attempts.map(item=>item.ordinal),[1,2,3]);assert.ok(attempts.every(item=>item.state==='failed'&&item.failure_code==='P4_EXECUTION_INPUT_BASIS_SUPERSEDED'));
    const {createWorkResultReader}=require('../src/helix/foundation/execution/work-result-reader'),schemaManifest=require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),reader=createWorkResultReader({schemaManifest,unitOfWork:capturedUnitOfWork});
    assert.deepEqual(reader.statusMany([failed.work_id,'missing',failed.work_id]).get(failed.work_id),reader.status(failed.work_id));
    assert.equal(reader.statusMany(['missing']).size,0);assert.throws(()=>reader.statusMany(Array(101).fill(failed.work_id)),/at most 100/);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.work_id=? AND e.capability_ref='perception.resolution.commit@1'").get(failed.work_id).n,0);
    assert.equal(database.prepare('SELECT count(*) n FROM perception_resolution_revisions').get().n,0);assert.equal(database.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,0);assert.deepEqual(errors,[]);
    injectDrift=false;
    response=await host.inject({method:'POST',url:'/v1/admin/perception/records',headers,payload:{targetType:'subject',targetId:subjectId,expectedRevision:0,rating:4,idempotencyKey:'terminal-recovery'}});assert.equal(response.statusCode,202,response.body);
    let ready;const recoveryDeadline=Date.now()+60000;while(Date.now()<recoveryDeadline){
      response=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType=subject&targetId='+encodeURIComponent(subjectId),headers});assert.equal(response.statusCode,200,response.body);ready=response.json().currentRating;
      if(ready?.state==='ready'&&ready.rating===4)break;await pause(100);
    }
    assert.equal(ready?.state,'ready');assert.equal(ready.rating,4);assert.equal(ready.expectedRevision,1);
    const formationDeadline=Date.now()+30000;while(Date.now()<formationDeadline){response=await host.inject({method:'GET',url:'/v1/admin/formation?section=active',headers});assert.equal(response.statusCode,200,response.body);
      formation=response.json().items.find(item=>item.subjectId===subjectId);if(formation?.ratingState==='ready'&&formation.myRating===4)break;await pause(100);}
    assert.equal(formation?.ratingState,'ready');assert.equal(formation.myRating,4);
    const successor=database.prepare("SELECT work_id,state,basis_digest FROM fx_supporting_works WHERE process_id=? AND work_kind='resolution' AND state='succeeded'").all('subject:'+subjectId).find(item=>item.basis_digest!==failed.basis_digest);
    assert.ok(successor);assert.equal(database.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(failed.work_id).state,'failed');assert.deepEqual(errors,[]);
  }finally{database.close();await host.close();}
});
