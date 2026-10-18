'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),Database=require('better-sqlite3'),sharp=require('sharp');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const skip=!process.env.SHELFDECK_FACE_MODEL_ROOT||!process.env.SHELFDECK_FACE_TEST_IMAGE?'Explicit pinned models and benign reference image required.':false;
async function fixture(t,{visibleFace}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-formation-host-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),
    source=path.join(root,'source'),target=path.join(root,'shelf');
  for(const dir of [adminDistDir,source,target])fs.mkdirSync(dir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const video=path.join(source,'Original source.mkv'),input=visibleFace?['-loop','1','-i',process.env.SHELFDECK_FACE_TEST_IMAGE,'-t','3','-vf','scale=640:-2']:
    ['-f','lavfi','-i','color=c=gray:s=320x240:r=24:d=3'],
    encoded=spawnSync(process.env.FFMPEG_PATH||require('ffmpeg-static'),['-hide_banner','-nostdin','-y',...input,'-c:v','libx265','-preset','ultrafast',
      '-x265-params','pools=1:frame-threads=1','-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',video],
      {encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(encoded.status,0,encoded.stderr);
  const secretRoot='us-formation-host-isolated-secret-0123456789abcdef',errors=[],
    initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  const epoch=Date.parse('2026-10-25T12:00:00+08:00'),clockStarted=Date.now();
  let host,db,lastRequestError;
  t.after(async()=>{await host?.close();db?.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const start=()=>createCleanServiceHost({dataDir,adminDistDir,secretRoot,faceModelRoot:process.env.SHELFDECK_FACE_MODEL_ROOT,
    now:()=>epoch+Date.now()-clockStarted,onRequestError:error=>{lastRequestError=error;},
    onExecutionRuntimeError:error=>errors.push({code:error.code,message:error.message})});
  host=await start();db=new Database(path.join(dataDir,'shelfdeck.db'));
  const request=async(method,url,payload)=>{
    lastRequestError=null;
    const response=await host.inject({method,url,payload,headers:{'x-api-key':initialized.adminApiKey}});
    assert.ok(response.statusCode>=200&&response.statusCode<300,response.body+'\n'+(lastRequestError?.stack||''));return response.json();
  };
  const diagnostics=()=>JSON.stringify({errors,runs:db.prepare('SELECT libra_run_id,state FROM libra_runs').all(),
    works:db.prepare('SELECT work_kind,state FROM fx_supporting_works').all(),events:db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE state NOT IN ('succeeded','skipped')").all(),
    failures:db.prepare('SELECT failure_class,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()});
  async function wait(predicate,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){assert.equal(errors.length,0,diagnostics());if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail(diagnostics());}
  async function actor(){
    const started=await request('POST','/v1/admin/people',{idempotencyKey:'actor',libraryKind:'us_adult',canonicalName:'Test Actor',aliases:[],
      image:{kind:'upload',bytesBase64:fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE).toString('base64')}});
    let operation;
    const end=Date.now()+20000;while(Date.now()<end){operation=await request('GET','/v1/admin/people/operations/'+started.operationRef);if(operation.state!=='preparing')break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(operation?.state,'completed',JSON.stringify({operation,errors}));
    return (await request('GET','/v1/admin/people?libraryKind=us_adult')).items[0];
  }
  let person=visibleFace?await actor():null;
  await request('POST','/v1/admin/shelves',{idempotencyKey:'shelf',shelfId:'us-shelf',name:'US fixture',targetRootLocation:target,
    ruleTemplateId:'system-beta-recommended',expectedTemplateRevision:1,placementPolicy:{folderTemplate:'{title}',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',
      subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
  await request('POST','/v1/admin/settings/automatic-operation/actions/enable-full',{idempotencyKey:'settlement',expectedRevision:0,coverExclusiveRelatedInput:true});
  const access={fieldId:'us-field',revision:1,endpointId:'us-endpoint',rootLocation:source,mountScopeId:'us-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/us-field/v1'},
    policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'field',fieldId:'us-field',name:'US field',contentProfileHint:'western_adult',
    access:{...access,accessDigest:canonicalDigest(access)},policy:{extractionPolicyId:'us-extract',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy,policyDigest:canonicalDigest({extractionPolicyId:'us-extract',revision:1,...policy})}});
  await request('PATCH','/v1/admin/routing/material-fields/us-field',{idempotencyKey:'route',fieldId:'us-field',expectedPolicyId:null,expectedRevision:0,
    policy:{routingPolicyId:'us-route',mode:'direct',targets:[{shelfId:'us-shelf',rank:1,matchExpression:{nodeKind:'always'}}]}});
  await request('POST','/v1/admin/material-fields/us-field/actions/observe',{idempotencyKey:'observe',fieldId:'us-field',expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  return {db,target,request,wait,actor,getPerson:()=>person,diagnostics,restart:async()=>{await host.close();host=await start();}};
}
test('real Host retains an unmatched film in secondary across restart and confirms its original Run before actor-bound on-deck',{timeout:180000,skip},async t=>{
  const h=await fixture(t,{visibleFace:false});
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM libra_us_adult_match_completions').get().n===1&&h.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n===1);
  const run=h.db.prepare('SELECT libra_run_id,subject_id FROM libra_runs').get(),completion=JSON.parse(h.db.prepare('SELECT completion_json FROM libra_us_adult_match_completions').get().completion_json);
  assert.equal(completion.winner,null);assert.equal(completion.detectedFaceCount,0);assert.equal(h.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
  await h.restart();const actor=await h.actor(),current=h.db.prepare('SELECT state_revision FROM libra_runs WHERE libra_run_id=?').get(run.libra_run_id),
    body={idempotencyKey:'choose-actor',expectedRunStateRevision:current.state_revision,expectedChoiceRevision:0,personId:actor.personId,
      expectedPersonRevision:actor.currentRevision,expectedReferenceRevision:actor.currentReferenceRevision};
  const chosen=await h.request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/choose-us-adult-actor',body);assert.equal(chosen.replayed,false);
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);assert.equal(h.db.prepare('SELECT state FROM libra_runs').get().state,'completed');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n,0);
  const folder=path.join(h.target,'Test Actor Original source');assert.ok(fs.existsSync(path.join(folder,'Test Actor Original source.mkv')),h.diagnostics());
  const nfo=fs.readFileSync(path.join(folder,'Test Actor Original source.nfo'),'utf8');assert.match(nfo,/<name>Test Actor<\/name>/);assert.match(nfo,/<title>Test Actor Original source<\/title>/);
  const poster=await sharp(path.join(folder,'poster.jpg')).metadata();assert.equal(poster.width,1000);assert.equal(poster.height,1500);
  const replay=await h.request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/choose-us-adult-actor',body);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,chosen.receipt);
});
test('real Host selects the highest CPU match and produces one actor without manual confirmation',{timeout:180000,skip},async t=>{
  const h=await fixture(t,{visibleFace:true});
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===1);
  const completion=JSON.parse(h.db.prepare('SELECT completion_json FROM libra_us_adult_match_completions').get().completion_json),
    cast=JSON.parse(h.db.prepare("SELECT fact_json FROM libra_product_fact_revisions WHERE fact_kind='media_cast'").get().fact_json);
  assert.equal(completion.winner.personSnapshot.personId,h.getPerson().personId);assert.ok(completion.winner.personMatchEvidence.matches[0].score>0.9);
  assert.equal(cast.relations.length,1);assert.equal(cast.relations[0].personId,h.getPerson().personId);assert.equal(cast.relations[0].source,'face_reference_match');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,0);
  assert.ok(fs.existsSync(path.join(h.target,'Test Actor Original source','Test Actor Original source.mkv')));
});
