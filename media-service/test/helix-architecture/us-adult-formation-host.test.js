'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),Database=require('better-sqlite3'),sharp=require('sharp');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const skip=!process.env.SHELFDECK_FACE_MODEL_ROOT||!process.env.SHELFDECK_FACE_TEST_IMAGE?'Explicit pinned models and benign reference image required.':false;
async function fixture(t,{visibleFace,registerActor=visibleFace,loseRecommendationAck=false,twoFilms=false,failInventoryParticipantOnce=false}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-formation-host-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),
    source=path.join(root,'source'),target=path.join(root,'shelf');
  for(const dir of [adminDistDir,source,target])fs.mkdirSync(dir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const video=path.join(source,'Original source.mkv'),input=visibleFace?['-loop','1','-i',process.env.SHELFDECK_FACE_TEST_IMAGE,'-t','3','-vf','scale=640:-2']:
    ['-f','lavfi','-i','color=c=gray:s=320x240:r=24:d=3'],
    encoded=spawnSync(process.env.FFMPEG_PATH||require('ffmpeg-static'),['-hide_banner','-nostdin','-y',...input,'-c:v','libx265','-preset','ultrafast',
      '-x265-params','pools=1:frame-threads=1','-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',video],
      {encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(encoded.status,0,encoded.stderr);
  if(twoFilms)fs.copyFileSync(video,path.join(source,'Other source.mkv'));
  const secretRoot='us-formation-host-isolated-secret-0123456789abcdef',errors=[],
    initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  const epoch=Date.parse('2026-10-25T12:00:00+08:00'),clockStarted=Date.now();let clockOffset=0;
  let host,db,lastRequestError,unitOfWork,recommendationAckLost=false,inventoryFailureInjected=false,rollbackProof=null;
  t.after(async()=>{await host?.close();db?.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const start=()=>createCleanServiceHost({dataDir,adminDistDir,secretRoot,faceModelRoot:process.env.SHELFDECK_FACE_MODEL_ROOT,
    unitOfWorkDecorator:value=>{unitOfWork={...value,execute(participants){
      if(failInventoryParticipantOnce&&!inventoryFailureInjected&&participants.some(participant=>participant.participantId==='arca_aftercare_inventory_foundation')){
        inventoryFailureInjected=true;
        try{return value.execute([...participants,{...participants[participants.length-1],participantId:'isolated_actor_inventory_failure',execute(){
          throw Object.assign(new Error('Isolated failure after Inventory and Result writes'),{code:'FIXTURE_ACTOR_INVENTORY_ROLLBACK'});
        }}]);}catch(error){
          const entry=db.prepare('SELECT current_inventory_revision FROM arca_shelf_entries').get(),
            commits=db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get(),
            event=db.prepare("SELECT result_id FROM fx_workflow_events WHERE capability_ref='arca.us_adult.inventory.commit@1'").get();
          rollbackProof={inventoryRevision:entry.current_inventory_revision,commits:commits.n,eventResultId:event.result_id};throw error;
        }
      }
      return value.execute(participants);
    }};return unitOfWork;},
    afterRecommendationSourceConfirmation(){if(loseRecommendationAck&&!recommendationAckLost){recommendationAckLost=true;
      throw Object.assign(new Error('Isolated Source confirmation ACK interruption'),{code:'FIXTURE_ACK_LOST'});}},
    now:()=>epoch+Date.now()-clockStarted+clockOffset,onRequestError:error=>{lastRequestError=error;},
    onExecutionRuntimeError:error=>errors.push({code:error.code,message:error.message,stack:error.stack})});
  host=await start();db=new Database(path.join(dataDir,'shelfdeck.db'));
  const request=async(method,url,payload)=>{
    lastRequestError=null;
    const response=await host.inject({method,url,payload,headers:{'x-api-key':initialized.adminApiKey}});
    assert.ok(response.statusCode>=200&&response.statusCode<300,response.body+'\n'+(lastRequestError?.stack||''));return response.json();
  };
  const diagnostics=()=>JSON.stringify({errors,runs:db.prepare('SELECT libra_run_id,state FROM libra_runs').all(),
    works:db.prepare('SELECT work_kind,state FROM fx_supporting_works').all(),events:db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE state NOT IN ('succeeded','skipped')").all(),
    failures:db.prepare('SELECT failure_class,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),
    claims:db.prepare('SELECT state,last_failure_code FROM people_us_recommendation_claims').all(),
    imageOperations:db.prepare('SELECT state,failure_code FROM people_image_operations').all()});
  async function wait(predicate,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){assert.equal(errors.filter(error=>error.code!=='FIXTURE_ACTOR_INVENTORY_ROLLBACK').length,0,diagnostics());if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail(diagnostics());}
  async function actor(){
    const started=await request('POST','/v1/admin/people',{idempotencyKey:'actor',libraryKind:'us_adult',canonicalName:'Test Actor',aliases:[],
      image:{kind:'upload',bytesBase64:fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE).toString('base64')}});
    let operation;
    const end=Date.now()+20000;while(Date.now()<end){operation=await request('GET','/v1/admin/people/operations/'+started.operationRef);if(operation.state!=='preparing')break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(operation?.state,'completed',JSON.stringify({operation,errors}));
    return (await request('GET','/v1/admin/people?libraryKind=us_adult')).items[0];
  }
  let person=registerActor?await actor():null;
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
  function readFrameEvidence(){
    const material=db.prepare("SELECT workspace_id,relative_path FROM fx_workspace_materials WHERE relative_path LIKE 'analysis/embeddings/%'").get(),
      workspaceRoot=db.prepare("SELECT resolved_root FROM platform_workspace_roots WHERE owner_scope='libra'").get();
    return require('../../src/helix/contracts/us-adult-frame-geometry').restoreFrameAnalysis(JSON.parse(fs.readFileSync(
      path.join(workspaceRoot.resolved_root,material.workspace_id,...material.relative_path.split('/')),'utf8')));
  }
  function recommendations(){
    const contractsRoot=path.resolve(__dirname,'../../src/helix/contracts'),pending=[contractsRoot],schemas=[];
    while(pending.length){const folder=pending.pop();for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      const location=path.join(folder,entry.name);if(entry.isDirectory())pending.push(location);
      else if(entry.isFile()&&entry.name.endsWith('schema.json')){const value=JSON.parse(fs.readFileSync(location,'utf8'));if(value.$id)schemas.push(value);}
    }}
    const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
      contractValidator=require('../../src/helix/foundation/capability/contract-validator').createCapabilityContractValidator({schemas}),
      workResultReader=require('../../src/helix/foundation/execution/work-result-reader').createWorkResultReader({schemaManifest,unitOfWork}),
      query=require('../../src/helix/domains/libra/public').UsAdultRecommendationQueryFacade(
        require('../../src/helix/domains/libra/application/us-adult-recommendation-query').createUsAdultRecommendationQuery({schemaManifest,unitOfWork,contractValidator,workResultReader})),
      rootPath=db.prepare("SELECT resolved_root FROM platform_workspace_roots WHERE owner_scope='libra'").get().resolved_root,
      workspaceProductPort=require('../../src/clean-workspace-product-port').createCleanWorkspaceProductPort({schemaManifest,unitOfWork,rootPath}),
      images=require('../../src/clean-us-adult-recommendation-image-port').createCleanUsAdultRecommendationImagePort({sourceQuery:query,workspaceProductPort});
    return {query,images};
  }
  return {db,target,request,wait,actor,readFrameEvidence,recommendations,rollbackProof:()=>rollbackProof,expectedRollbackErrors:()=>errors.filter(error=>error.code==='FIXTURE_ACTOR_INVENTORY_ROLLBACK'),getPerson:()=>person,diagnostics,
    inventoryContext(){const shelfEntryId=db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries WHERE status=?').get('active').shelf_entry_id;
      const store=require('../../src/helix/domains/arca/persistence/aftercare-store').createAftercareStore({
        schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),unitOfWork});
      return {shelfEntryId,raw:store.currentContext(shelfEntryId)};},
    refreshActor:(shelfEntryId,body)=>request('POST','/v1/admin/collection/'+shelfEntryId+'/actions/refresh-us-adult-actor',body),
    async requestImage(url){const response=await host.inject({method:'GET',url,headers:{'x-api-key':initialized.adminApiKey}});
      assert.equal(response.statusCode,200,response.body);return {bytes:response.rawPayload,headers:response.headers};},
    async crashRefresh(entryId,command,boundary){
      await host.close();host=null;
      const child=require('node:child_process').fork(path.join(__dirname,'fixtures/us-adult-host-crash-worker.js'),[],{
        silent:true,windowsHide:true}),messages=[],errors=[];
      child.on('message',message=>messages.push(message));child.stderr.on('data',chunk=>errors.push(String(chunk)));
      const timer=setTimeout(()=>child.kill(),120000);
      try{
        const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
        child.send({dataDir,adminDistDir,secretRoot,apiKey:initialized.adminApiKey,now:epoch+Date.now()-clockStarted+clockOffset,
          entryId,command,boundary});
        const result=await exited;assert.equal(result.code,boundary==='before_commit'?73:74,errors.join(''));
        assert.equal(messages.length,1,errors.join(''));return messages[0].admitted;
      }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
    },
    resume:async()=>{clockOffset+=120000;host=await start();},
    setTime:value=>{clockOffset=Date.parse(value)-epoch-(Date.now()-clockStarted);},restart:async()=>{await host.close();host=await start();}};
}
test('real Host retains an unmatched film in secondary across restart and confirms its original Run before actor-bound on-deck',{timeout:180000,skip},async t=>{
  const h=await fixture(t,{visibleFace:false});
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM libra_us_adult_match_completions').get().n===1&&h.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n===1);
  const run=h.db.prepare('SELECT libra_run_id,subject_id FROM libra_runs').get(),completion=JSON.parse(h.db.prepare('SELECT completion_json FROM libra_us_adult_match_completions').get().completion_json);
  assert.equal(completion.winner,null);assert.equal(completion.detectedFaceCount,0);assert.equal(h.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
  const geometry=h.readFrameEvidence();assert.equal(geometry.frameMembers.length,20);assert.equal(geometry.detectedFaceCount,0);
  const waitingView=await h.request('GET','/v1/admin/formation/'+run.subject_id);
  assert.equal(waitingView.classification,'attention_required');assert.equal(waitingView.productIdentityIssue.contentProfile,'western_adult');
  assert.equal(waitingView.nextAction.label,'需要确认演员');
  await h.restart();const actor=await h.actor(),current=await h.request('GET','/v1/admin/formation/runs/'+run.libra_run_id+'/actor-selection'),
    body={idempotencyKey:'choose-actor',expectedRunStateRevision:current.expectedRunStateRevision,expectedChoiceRevision:current.expectedChoiceRevision,personId:actor.personId,
      expectedPersonRevision:actor.currentRevision,expectedReferenceRevision:actor.currentReferenceRevision};
  assert.equal(current.selectedActor,null);assert.equal(current.canChoose,true);
  const chosen=await h.request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/choose-us-adult-actor',body);assert.equal(chosen.replayed,false);
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);assert.equal(h.db.prepare('SELECT state FROM libra_runs').get().state,'completed');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n,0);
  const folder=path.join(h.target,'Test Actor Original source');assert.ok(fs.existsSync(path.join(folder,'Test Actor Original source.mkv')),h.diagnostics());
  const nfo=fs.readFileSync(path.join(folder,'Test Actor Original source.nfo'),'utf8');assert.match(nfo,/<name>Test Actor<\/name>/);assert.match(nfo,/<title>Test Actor Original source<\/title>/);
  const poster=await sharp(path.join(folder,'poster.jpg')).metadata();assert.equal(poster.width,1000);assert.equal(poster.height,1500);
  const replay=await h.request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/choose-us-adult-actor',body);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,chosen.receipt);
  const delivered=await h.request('GET','/v1/admin/formation/runs/'+run.libra_run_id+'/actor-selection');assert.equal(delivered.canChoose,false);
  assert.equal(delivered.selectedActor.personId,actor.personId);
  const entry=h.inventoryContext(),view=await h.request('GET','/v1/admin/collection/'+entry.shelfEntryId+'/actor-refresh'),
    refreshed=await h.refreshActor(entry.shelfEntryId,{mode:'automatic',idempotencyKey:'no-face-refresh',expectedInventoryRevision:view.expectedInventoryRevision,
      expectedRepresentationDigest:view.expectedRepresentationDigest});
  await h.wait(()=>h.db.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(refreshed.aftercareCaseId)?.state==='resolved');
  const unchanged=await h.request('GET','/v1/admin/collection/'+entry.shelfEntryId+'/actor-refresh');
  assert.equal(unchanged.progress.reasonCode,'actor_match_unchanged');assert.equal(unchanged.currentActor.personId,actor.personId);
  assert.equal(unchanged.expectedInventoryRevision,view.expectedInventoryRevision);
  assert.equal(h.db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n,0);
  assert.equal(h.db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE work_kind='us_adult_actor_stage'").get().n,0);
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
  const context=h.inventoryContext(),presentation=require('../../src/helix/domains/arca/model/us-adult-inventory-presentation'),
    value=presentation.readUsAdultInventoryPresentation(context);
  assert.equal(value.title,'Test Actor Original source');assert.equal(value.actor.personId,h.getPerson().personId);
  const port=require('../../src/clean-arca-inventory-port').createCleanArcaInventoryPort({
    schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(){throw new Error('Readonly Inventory planning must not write.');}},workspaceRoot:path.join(h.target,'unused-workspace')}),
    request=require('../../src/helix/domains/arca/model/aftercare-placement').buildAftercareInventoryRequest(context,port,1,'case-inventory-naming');
  assert.ok(request.finalInventoryDecision.members.some(member=>member.finalName==='Test Actor Original source.mkv'));
  assert.equal(request.onDeckProductPackage.mediaCastSnapshot,undefined);
  assert.equal(request.inventoryUsAdultPresentation.personId,h.getPerson().personId);
  assert.throws(()=>port.prepare({...request,aftercareCaseId:null}),{code:'CLEAN_ARCA_INVENTORY_INPUT'});
  const view=await h.request('GET','/v1/admin/collection/'+context.shelfEntryId+'/actor-refresh'),
    refreshed=await h.refreshActor(context.shelfEntryId,{mode:'automatic',idempotencyKey:'match-refresh',expectedInventoryRevision:view.expectedInventoryRevision,
      expectedRepresentationDigest:view.expectedRepresentationDigest});
  await h.wait(()=>h.db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE work_kind='us_adult_actor_source' AND state='succeeded'").get().n===1);
  await h.restart();
  await h.wait(()=>h.db.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(refreshed.aftercareCaseId)?.state==='resolved');
  const after=h.inventoryContext(),updated=await h.request('GET','/v1/admin/collection/'+context.shelfEntryId+'/actor-refresh');
  assert.equal(updated.currentActor.personId,h.getPerson().personId);assert.equal(updated.expectedInventoryRevision,view.expectedInventoryRevision+1);
  assert.equal(after.raw.entry.canonical_identity_key,context.raw.entry.canonical_identity_key);
  assert.equal(after.raw.entry.current_deck_fact_revision,context.raw.entry.current_deck_fact_revision);
  assert.ok(fs.existsSync(path.join(h.target,'Test Actor Original source','Test Actor Original source.mkv')));
  assert.equal(updated.progress.works.find(work=>work.phase==='match').state,'succeeded');
});
test('real empty-library Host groups two films, creates one recommended actor and recovers only source A confirmation across restart',{timeout:300000,skip},async t=>{
  const h=await fixture(t,{visibleFace:true,registerActor:false,loseRecommendationAck:true,twoFilms:true});
  assert.deepEqual((await h.request('GET','/v1/admin/people/recommendations')).items,[]);
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM libra_us_adult_match_completions').get().n===2&&h.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n===2);
  let ports=h.recommendations();
  const pageQuery={schemaRef:'helix://contracts/domain-types/UsAdultRecommendationPageQuery/v1',schemaVersion:1,cursor:null,limit:32},
    page=ports.query.listSources(pageQuery);
  let source=page.items[0],candidate=ports.images.readCandidate(source);
  assert.equal(page.items.length,2);
  const image=await ports.images.readImage({source,expectedEvidenceDigest:candidate.evidenceDigest}),
    metadata=await sharp(image.bytes).metadata();
  assert.equal(candidate.vector.length,128);assert.ok(candidate.clusterFaceCount>=20);assert.equal(metadata.format,'jpeg');
  assert.ok(metadata.width>40&&metadata.height>40);assert.equal(h.db.prepare('SELECT count(*) n FROM people_persons').get().n,0);
  h.setTime('2026-10-31T03:00:01+08:00');
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM people_us_recommendation_publications').get().n===1);
  const publication=JSON.parse(h.db.prepare('SELECT snapshot_json FROM people_us_recommendation_publications').get().snapshot_json);
  assert.equal(publication.items.length,1);assert.equal(publication.items[0].coverageCount,2);
  source=publication.items[0].representative.source;candidate=ports.images.readCandidate(source);
  const otherSource=page.items.find(item=>item.sourceId!==source.sourceId);
  assert.deepEqual((await h.request('GET','/v1/admin/people/recommendations')).items,[]);
  await h.restart();ports=h.recommendations();assert.deepEqual(ports.query.readSource(source),source);
  assert.equal(ports.images.readCandidate(source).evidenceDigest,candidate.evidenceDigest);
  h.setTime('2026-10-31T09:00:01+08:00');
  let runtime;const deadline=Date.now()+10000;
  do{await new Promise(resolve=>setTimeout(resolve,100));runtime=await h.request('GET','/v1/admin/runtime');}while(!runtime.normalSupplyAllowed&&Date.now()<deadline);
  assert.equal(runtime.normalSupplyAllowed,true);
  const cards=await h.request('GET','/v1/admin/people/recommendations');assert.equal(cards.items.length,1);
  const photograph=await h.requestImage(cards.items[0].imageUrl);assert.equal((await sharp(photograph.bytes).metadata()).format,'jpeg');
  assert.match(photograph.headers['cache-control'],/no-store/);
  const claimBody={idempotencyKey:'recommendation-create',expectedPublicationRevision:cards.publication.revision,expectedSnapshotDigest:cards.publication.snapshotDigest,
    target:{kind:'create',canonicalName:'Recommended Actor',aliases:[],image:{kind:'recommendation'}}},
    claimUrl='/v1/admin/people/recommendations/'+cards.items[0].recommendationId+'/actions/claim',started=await h.request('POST',claimUrl,claimBody);
  await h.wait(()=>h.db.prepare("SELECT count(*) n FROM people_us_recommendation_claims WHERE state='confirming_source' AND last_failure_code='FIXTURE_ACK_LOST'").get().n===1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM people_persons').get().n,1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,1);
  await h.restart();ports=h.recommendations();
  const replay=await h.request('POST',claimUrl,claimBody);assert.equal(replay.replayed,true);assert.equal(replay.state,'completed');assert.equal(replay.claimRef,started.claimRef);
  const claim=await h.request('GET','/v1/admin/people/recommendation-claims/'+started.claimRef);assert.equal(claim.sourceConfirmed,true);
  assert.equal(h.db.prepare('SELECT count(*) n FROM people_persons').get().n,1);assert.equal(h.db.prepare('SELECT count(*) n FROM people_image_operations').get().n,1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,1);
  assert.deepEqual(ports.query.readSource(otherSource),otherSource);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_heads WHERE subject_id=?').get(otherSource.subjectId).n,0);
  assert.throws(()=>ports.images.readCandidate(source),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
  assert.deepEqual(ports.query.listSources(pageQuery).items,[otherSource]);
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,2);
  const stem=path.parse(source.originalName.originalFileName).name,name='Recommended Actor '+stem;
  assert.ok(fs.existsSync(path.join(h.target,name,name+'.mkv')));
  assert.equal(h.db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(otherSource.libraRunId).state,'active');
});


test('real Host refreshes one owned US actor through verified files and atomic Inventory without changing collection identity',{timeout:240000,skip},async t=>{
  const h=await fixture(t,{visibleFace:true,failInventoryParticipantOnce:true});
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===1);
  const before=h.inventoryContext(),entry={...before.raw.entry},person=h.getPerson();
  await h.request('PATCH','/v1/admin/people/'+person.personId,{idempotencyKey:'rename-actor',expectedPersonRevision:person.currentRevision,
    canonicalName:'Updated Actor',aliases:[]});
  assert.equal(h.db.prepare('SELECT count(*) n FROM arca_us_actor_refresh_intents').get().n,0);
  const updated=(await h.request('GET','/v1/admin/people?libraryKind=us_adult')).items[0],body={mode:'specified',idempotencyKey:'single-actor-refresh',
    expectedInventoryRevision:entry.current_inventory_revision,expectedRepresentationDigest:before.raw.inventory.representation_digest,
    personId:updated.personId,expectedPersonRevision:updated.currentRevision,expectedReferenceRevision:updated.currentReferenceRevision},
    started=await h.refreshActor(before.shelfEntryId,body);
  const frozen=JSON.parse(h.db.prepare('SELECT care_basis_json FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(started.aftercareCaseId).care_basis_json);
  h.db.prepare('INSERT INTO arca_aftercare_assessments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('unrelated-assessment',before.shelfEntryId,entry.current_inventory_revision,1,1,
    frozen.decisionFactSetDigest,frozen.digest,'presentation','unhealthy',null,canonicalDigest('unrelated health'),10000);
  h.db.prepare('INSERT INTO arca_aftercare_findings VALUES(?,?,?,?,?,?,?,?)').run('unrelated-finding','unrelated-assessment','presentation:nfo_missing','warning','auto_repair',canonicalDigest('unrelated missing'),'open',10000);
  await h.wait(()=>h.db.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(started.aftercareCaseId)?.state==='resolved',120000);
  const after=h.inventoryContext(),folder=path.join(h.target,'Updated Actor Original source'),
    nfo=fs.readFileSync(path.join(folder,'Updated Actor Original source.nfo'),'utf8');
  assert.equal(after.raw.entry.current_inventory_revision,entry.current_inventory_revision+1);
  for(const name of ['shelf_entry_id','canonical_identity_key','canonical_identity_revision','current_deck_fact_revision'])assert.equal(after.raw.entry[name],entry[name]);
  assert.equal(after.raw.people.length,1);assert.equal(after.raw.people[0].person_id,updated.personId);
  assert.match(nfo,/<title>Updated Actor Original source<\/title>/);assert.match(nfo,/<name>Updated Actor<\/name>/);
  assert.ok(fs.existsSync(path.join(folder,'Updated Actor Original source.mkv')));
  assert.equal(fs.existsSync(path.join(h.target,'Test Actor Original source','Test Actor Original source.mkv')),false);
  assert.equal((await sharp(path.join(folder,'poster.jpg')).metadata()).width,1000);
  assert.equal(h.db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n,1);
  assert.equal((await h.refreshActor(before.shelfEntryId,body)).replayed,true);
  assert.deepEqual(h.rollbackProof(),{inventoryRevision:entry.current_inventory_revision,commits:0,eventResultId:null});
  assert.equal(h.expectedRollbackErrors().length,1);
  assert.equal(h.db.prepare('SELECT state FROM arca_aftercare_findings WHERE finding_id=?').get('unrelated-finding').state,'open');
  const displayed=await h.request('GET','/v1/admin/collection/'+before.shelfEntryId);
  assert.equal(displayed.displayIdentity,'Updated Actor Original source');assert.equal(displayed.people[0].displayName,'Updated Actor');
  const works=await h.request('GET','/v1/admin/people/'+updated.personId+'/collection');
  assert.equal(works.libraryKind,'us_adult');assert.deepEqual(works.items.map(item=>item.shelfEntryId),[before.shelfEntryId]);
  assert.equal(works.items[0].displayIdentity,'Updated Actor Original source');
});

test('actual Host exits around Inventory commit recover the original actor Case and a later target conflict never overwrites files',{timeout:360000,skip},async t=>{
  const h=await fixture(t,{visibleFace:true});
  await h.wait(()=>h.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===1);
  const identity={...h.inventoryContext().raw.entry};
  for(const boundary of ['before_commit','after_commit']){
    const person=(await h.request('GET','/v1/admin/people?libraryKind=us_adult')).items[0],name=boundary==='before_commit'?'First Actor':'Second Actor';
    await h.request('PATCH','/v1/admin/people/'+person.personId,{idempotencyKey:'name-'+boundary,expectedPersonRevision:person.currentRevision,
      canonicalName:name,aliases:[]});
    const updated=(await h.request('GET','/v1/admin/people?libraryKind=us_adult')).items[0],before=h.inventoryContext(),
      command={mode:'specified',idempotencyKey:'crash-'+boundary,expectedInventoryRevision:before.raw.entry.current_inventory_revision,
        expectedRepresentationDigest:before.raw.inventory.representation_digest,personId:updated.personId,
        expectedPersonRevision:updated.currentRevision,expectedReferenceRevision:updated.currentReferenceRevision},
      admitted=await h.crashRefresh(before.shelfEntryId,command,boundary),interrupted=h.db.prepare('SELECT current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?').get(before.shelfEntryId),
      folder=path.join(h.target,name+' Original source');
    assert.ok(fs.existsSync(path.join(folder,name+' Original source.mkv')));
    assert.ok(fs.existsSync(path.join(folder,'poster.jpg')));
    assert.equal(interrupted.current_inventory_revision,before.raw.entry.current_inventory_revision+(boundary==='after_commit'?1:0));
    assert.equal(h.db.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(admitted.aftercareCaseId).state,'active');
    await h.resume();
    await h.wait(()=>h.db.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(admitted.aftercareCaseId).state==='resolved',120000);
    const after=h.inventoryContext();assert.equal(after.raw.entry.current_inventory_revision,before.raw.entry.current_inventory_revision+1);
    for(const key of ['shelf_entry_id','canonical_identity_key','canonical_identity_revision','current_deck_fact_revision'])assert.equal(after.raw.entry[key],identity[key]);
    assert.equal(h.db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits WHERE aftercare_case_id=?').get(admitted.aftercareCaseId).n,1);
    assert.equal((await h.refreshActor(before.shelfEntryId,command)).replayed,true);
    assert.equal(after.raw.people[0].display_name,name);
    assert.match(fs.readFileSync(path.join(folder,name+' Original source.nfo'),'utf8'),new RegExp('<name>'+name+'</name>'));
    assert.equal(fs.readdirSync(h.target).some(file=>file.startsWith('.shelfdeck-us-')),false);
  }
  const person=(await h.request('GET','/v1/admin/people?libraryKind=us_adult')).items[0];
  await h.request('PATCH','/v1/admin/people/'+person.personId,{idempotencyKey:'name-conflict',expectedPersonRevision:person.currentRevision,
    canonicalName:'Conflicting Actor',aliases:[]});
  const updated=(await h.request('GET','/v1/admin/people?libraryKind=us_adult')).items[0],before=h.inventoryContext(),
    conflictFolder=path.join(h.target,'Conflicting Actor Original source'),foreign=path.join(conflictFolder,'foreign.txt');
  fs.mkdirSync(conflictFolder);fs.writeFileSync(foreign,'unrelated bytes');
  const admitted=await h.refreshActor(before.shelfEntryId,{mode:'specified',idempotencyKey:'target-conflict',
    expectedInventoryRevision:before.raw.entry.current_inventory_revision,expectedRepresentationDigest:before.raw.inventory.representation_digest,
    personId:updated.personId,expectedPersonRevision:updated.currentRevision,expectedReferenceRevision:updated.currentReferenceRevision});
  await h.wait(()=>Boolean(h.db.prepare("SELECT 1 FROM fx_supporting_works WHERE process_id=? AND work_kind='us_adult_actor_publish' AND state='failed'").get(before.shelfEntryId)),90000);
  const after=h.inventoryContext(),view=await h.request('GET','/v1/admin/collection/'+before.shelfEntryId+'/actor-refresh');
  assert.equal(after.raw.entry.current_inventory_revision,before.raw.entry.current_inventory_revision);
  assert.equal(after.raw.people[0].display_name,'Second Actor');assert.equal(fs.readFileSync(foreign,'utf8'),'unrelated bytes');
  assert.deepEqual(fs.readdirSync(conflictFolder),['foreign.txt']);
  assert.equal(view.progress.aftercareCaseId,admitted.aftercareCaseId);assert.equal(view.progress.state,'active');
  assert.equal(view.progress.works.find(work=>work.phase==='publish').failureCode,'ARCA_US_ADULT_TARGET_CONFLICT');
  assert.equal(view.canRefresh,false);
});
