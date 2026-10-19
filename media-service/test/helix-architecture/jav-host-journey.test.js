'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),test=require('node:test');
const Database=require('better-sqlite3'),sharp=require('sharp');
const {spawnSync}=require('node:child_process');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const secretRoot='jav-host-fixture-root-0123456789abcdef0123456789';
async function journey(t,{operations=null,manual=false,manualFilenameStem=null,nfoRepair=false,posterRepair=false,fanartRepair=false,posterRepairFailure=false,posterRepairRecovery=false,correctedPosterRepair=false,parts=false,soloPart=null,incompatible=false,inputCodec='hevc',correctionAdmission=false,correctionWork=false,correctionProcessLoss=false,correctionOverlap=false,correctionAtomicCommit=false,correctionPeople=false,correctionPerception=false,correctionAdmin=false,correctionSourceFailure=false,correctionAssetsFailure=false,correctionCancelApi=false,correctionRecoveryCommand=false,correctionRecoveryContinue=false,correctionTerminalRecovery=false,correctionPublicRecovery=false,correctionPhaseFailure=null,correctionRepeatCancel=false,directoryCleanup=false,sourceCase=null}={}) {
  const expectedCode=sourceCase?.javCode||'IPX-177',expectedSite=sourceCase?.selectedSite||'javdb';
  const retirementLoss=['retirement','retirement_conflict'].includes(correctionProcessLoss);
  const cleanupLoss=['cleanup_uncommitted','cleanup_committed'].includes(correctionProcessLoss);
  const workspaceLoss=cleanupLoss||['workspace_reclaim','workspace_reclaim_conflict','workspace_reclaim_commit','workspace_reclaim_rollback'].includes(correctionProcessLoss);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-jav-host-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),source=path.join(root,'source'),target=path.join(root,'shelf');
  for(const directory of [adminDistDir,source,target])fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const videoPath=path.join(source,manual?(manualFilenameStem||'Unrecognized')+'.mkv':sourceCase?(sourceCase.filenameStem||expectedCode)+'.mkv':parts?'IPX-177A.mkv':soloPart?'IPX-177'+soloPart+'.mkv':'IPX-177.mkv'),ffmpeg=process.env.FFMPEG_PATH||require('ffmpeg-static');
  const encoded=spawnSync(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=black:s=320x240:r=24:d=3',
    '-c:v',inputCodec==='h264'?'libx264':'libx265','-preset','ultrafast',
    ...(inputCodec==='h264'?['-threads','1']:['-x265-params','pools=1:frame-threads=1']),'-pix_fmt','yuv420p',
    '-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',videoPath],{encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(encoded.status,0,encoded.stderr);const video=fs.readFileSync(videoPath);
  const secondVideoPath=parts?path.join(source,'IPX-177B.mkv'):null;
  if(parts&&incompatible) {
    const normalized=spawnSync(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=black:s=640x480:r=24:d=3',
      '-c:v','libx265','-preset','ultrafast','-x265-params','pools=1:frame-threads=1','-pix_fmt','yuv420p',
      '-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',secondVideoPath],{encoding:'utf8',windowsHide:true,timeout:60000});
    assert.equal(normalized.status,0,normalized.stderr);
  } else if(parts)fs.copyFileSync(videoPath,secondVideoPath);
  const picture=await sharp({create:{width:100,height:60,channels:3,background:'#376892'}}).jpeg().toBuffer(),requests=[];
  let changeConfirmedTitle=false,changeCorrectionOptional=false,allowPrimaryFailure=false,aftercareCoverUnavailable=false;
  const originalFetch=sourceCase?require('./fixtures/jav-class-transport').createJavClassTransport(picture,requests,sourceCase,()=>allowPrimaryFailure):require('./fixtures/jav-host-transport').createJavHostTransport(picture,requests,correctionOverlap,correctionPeople);
  const fetchImpl=async url=>{const response=await originalFetch(url);
    if(aftercareCoverUnavailable&&new URL(url).hostname==='c0.jdbstatic.com')return new Response(Buffer.from('invalid cover'),{headers:{'content-type':'image/jpeg'}});
    if(changeConfirmedTitle&&new URL(url).pathname==='/v/Correct02')return new Response((await response.text()).replace('Corrected JAV film','Changed film after confirmation'),{headers:response.headers});
    if(changeCorrectionOptional&&new URL(url).pathname==='/v/Correct02')return new Response((await response.text()).replace('<div class="movie-panel-info">','<div class="movie-panel-info"><div class="panel-block"><strong>日期：</strong><span class="value">2026-10-15</span></div>'),{headers:response.headers});
    return response;};
  const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  let clockEpoch=Date.parse('2026-10-25T12:00:00+08:00'),clockStart=Date.now();
  const clock=()=>correctionPeople?clockEpoch+Date.now()-clockStart:Date.now();
  let requestError=null,runtimeError=null,host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;},onRequestError:error=>{requestError=error;}});
  const db=new Database(path.join(dataDir,'shelfdeck.db'));
  const primaryBytes=()=>fs.readFileSync(db.prepare("SELECT m.location FROM arca_inventory_materials m JOIN arca_shelf_entries e ON e.shelf_entry_id=m.shelf_entry_id AND e.current_inventory_revision=m.inventory_revision WHERE m.role='primary_payload'").get().location);
  t.after(async()=>{await host.close();db.close();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-jav-host-'));fs.rmSync(root,{recursive:true,force:true});});
  const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),cookie=login.headers['set-cookie'];
  async function request(method,url,payload){requestError=null;const response=await host.inject({method,url,headers:{cookie},payload});assert.ok(response.statusCode>=200&&response.statusCode<300,response.body+'\n'+(requestError?.stack||''));return response.json();}
  const profiles=require('../../src/helix/contracts/jav-source-profiles').JAV_SOURCE_TRANSPORTS;
  for(const site of sourceCase?.sites||['javdb']){const kind='jav-'+site,proof=await request('POST','/v1/admin/settings/integrations/'+kind+'/actions/test',{kind,idempotencyKey:'jav-test-'+site,endpoint:profiles[site].endpoints[0],credential:{kind:'anonymous'},settings:{networkRoute:{mode:'direct',proxyEndpoint:null}}});
    await request('PATCH','/v1/admin/settings/integrations/'+kind,{kind,idempotencyKey:'jav-configure-'+site,expectedConfigRevision:0,connectionProofId:proof.connectionProofId});}
  const ingestRequestStart=requests.length;
  allowPrimaryFailure=true;
  await request('POST','/v1/admin/shelves',{idempotencyKey:'jav-shelf',shelfId:'jav-shelf',name:'JAV fixture',targetRootLocation:target,ruleTemplateId:'system-jav-recommended',expectedTemplateRevision:1,
    placementPolicy:{folderTemplate:'{title}',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
  const fieldId='jav-field',access={fieldId,revision:1,endpointId:'jav-endpoint',rootLocation:source,mountScopeId:'jav-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/jav-access/v1'};
  const policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'jav-field',fieldId,name:'JAV source',contentProfileHint:'jav',
    policy:{extractionPolicyId:'jav-extraction',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,
      policyDigest:canonicalDigest({extractionPolicyId:'jav-extraction',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
  await request('PATCH','/v1/admin/routing/material-fields/'+fieldId,{idempotencyKey:'jav-route',fieldId,expectedPolicyId:null,expectedRevision:0,
    policy:{routingPolicyId:'jav-route',mode:'sorting',targets:[{shelfId:'jav-shelf',rank:1,matchExpression:{nodeKind:'predicate',factKind:'content_profile',operator:'eq',expectedValue:'jav'}}]}});
  if(manual||sourceCase)await request('POST','/v1/admin/settings/automatic-operation/actions/enable-full',{idempotencyKey:'jav-settlement-authorization',expectedRevision:0,coverExclusiveRelatedInput:true});
  await request('POST','/v1/admin/material-fields/'+fieldId+'/actions/observe',{idempotencyKey:'jav-observe',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  const diagnostics=()=>JSON.stringify({runtimeError:runtimeError?.message,incidents:db.prepare('SELECT * FROM fx_executor_incidents').all(),
    sourceExists:fs.existsSync(videoPath),
    authorizations:db.prepare('SELECT revision,state,authorization_scope_kind FROM arca_input_settlement_authorizations').all(),
    approvals:db.prepare('SELECT state,standing_authorization_revision FROM arca_ondeck_settlement_approvals').all(),
    attempts:db.prepare('SELECT failure_code,failure_class FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),
    plans:db.prepare("SELECT state FROM fx_workflow_plans WHERE state<>'planned'").all(),
    pendingAttempts:db.prepare("SELECT state,failure_code FROM fx_work_attempts WHERE state<>'succeeded'").all(),
    pendingEvents:db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE state NOT IN ('succeeded','failed','skipped')").all(),
    works:db.prepare('SELECT work_id,work_kind,state FROM fx_supporting_works').all()});
  let deadline=Date.now()+20000;
  if(incompatible) {
    const second=fs.readFileSync(secondVideoPath);
    while(Date.now()<deadline&&!runtimeError&&!db.prepare("SELECT libra_run_id FROM libra_run_outcomes WHERE outcome='unable_to_on_deck'").get())await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeError,null,diagnostics());assert.ok(db.prepare("SELECT libra_run_id FROM libra_run_outcomes WHERE outcome='unable_to_on_deck'").get(),diagnostics());
    assert.deepEqual(fs.readFileSync(videoPath),video);assert.deepEqual(fs.readFileSync(secondVideoPath),second);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
    const rejected=db.prepare("SELECT work_id FROM fx_work_attempts WHERE failure_code='jav_part_copy_incompatible'").get();assert.ok(rejected);
    assert.equal(db.prepare('SELECT count(*) n FROM fx_workflow_events WHERE work_id=?').get(rejected.work_id).n,0);
    const evidence=JSON.parse(db.prepare("SELECT transition_evidence_json FROM libra_run_revisions WHERE json_extract(transition_evidence_json,'$.blockedWorks[0].blockerSource')='plan_rejection' ORDER BY state_revision DESC LIMIT 1").get().transition_evidence_json);
    assert.equal(evidence.blockedWorks[0].blockerSource,'plan_rejection');assert.equal(evidence.blockedWorks[0].failureCode,'jav_part_copy_incompatible');
    const outcome=JSON.parse(db.prepare('SELECT outcome_json FROM libra_run_outcomes').get().outcome_json);
    assert.deepEqual(outcome.terminalReasons,[evidence.blockedWorks[0]]);assert.equal(Object.hasOwn(outcome.terminalReasons[0],'capabilityRef'),false);
    return;
  }
  let selection=null,confirmation=null,originalCandidateClaim=null;
  if(manual) {
    while(Date.now()<deadline && !runtimeError && !db.prepare("SELECT libra_run_id FROM libra_runs WHERE state='active'").get())await new Promise(resolve=>setTimeout(resolve,100));
    const run=db.prepare("SELECT libra_run_id,subject_id FROM libra_runs WHERE state='active'").get();assert.ok(run,diagnostics());
    const item=await request('GET','/v1/admin/formation/'+run.subject_id);assert.equal(item.productIdentityIssue?.reasonCode,'jav_code_unrecognized');
    assert.equal(item.classification,'attention_required');assert.equal(item.currentRun.currentIdentityRevision,null);
    assert.equal(db.prepare("SELECT count(*) n FROM libra_product_fact_revisions WHERE fact_kind='resolved_identity'").get().n,0);
    if(manualFilenameStem) {
      originalCandidateClaim=db.prepare('SELECT display_identity,identity_metadata_json,identity_claim_json,package_digest FROM proc_candidate_packages').get();
      assert.ok(originalCandidateClaim);
      const metadata=JSON.parse(originalCandidateClaim.identity_metadata_json),claim=JSON.parse(originalCandidateClaim.identity_claim_json);
      for(const value of [metadata,claim]) {
        assert.equal(Object.hasOwn(value,'javCode'),false);
        assert.ok(value.sourceHints.some(hint=>hint.hintKind==='filename_title'&&hint.hintValue===path.basename(videoPath)));
      }
      assert.equal(requests.length,ingestRequestStart,'An unconfirmed CID filename must not trigger a guessed source query.');
      assert.deepEqual(fs.readFileSync(videoPath),video);
    }
    selection=await request('GET','/v1/admin/formation/runs/'+run.libra_run_id+'/product-identity-preview?javCode='+encodeURIComponent(expectedCode));
    assert.equal(selection.result,'qualified');assert.equal(db.prepare("SELECT count(*) n FROM libra_product_fact_revisions WHERE fact_kind='resolved_identity'").get().n,0);
    assert.equal(selection.javCode,expectedCode);assert.equal(selection.siteRef,expectedSite);
    assert.match(selection.posterUrl,/^data:image\/jpeg;base64,/);
    const previewBytes=Buffer.from(selection.posterUrl.split(',')[1],'base64');assert.ok(previewBytes.length<=32768);
    const previewShape=await sharp(previewBytes).metadata();assert.equal(previewShape.format,'jpeg');assert.ok(previewShape.width<=360&&previewShape.height<=240);
    assert.deepEqual(fs.readFileSync(videoPath),video);
    confirmation={javCode:selection.javCode,previewId:selection.previewId,candidateSetDigest:selection.candidateSetDigest,
      expectedRunStateRevision:selection.expectedRunStateRevision,expectedIdentityRevision:selection.expectedIdentityRevision,
      expectedSelectionIntentRevision:selection.expectedSelectionIntentRevision,idempotencyKey:'jav-manual-confirmation'};
    await request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/choose-product-identity',confirmation);
  }
  if(!manual&&!sourceCase) {
  while(Date.now()<deadline && !runtimeError && !db.prepare("SELECT event_id FROM fx_workflow_events WHERE capability_ref='arca.ondeck.input_settlement.delete@1' AND state='waiting_for_external'").get())await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(runtimeError,null,diagnostics());assert.ok(fs.existsSync(videoPath));
  assert.deepEqual(fs.readFileSync(videoPath),video);assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
  if(parts)assert.deepEqual(fs.readFileSync(secondVideoPath),video);
  assert.ok(db.prepare("SELECT event_id FROM fx_workflow_events WHERE capability_ref='arca.ondeck.input_settlement.delete@1' AND state='waiting_for_external'").get(),diagnostics());
  await request('POST','/v1/admin/settings/automatic-operation/actions/enable-full',{idempotencyKey:'jav-settlement-authorization',expectedRevision:0,coverExclusiveRelatedInput:true});
  }
  deadline=Date.now()+65000;
  while(Date.now()<deadline && !runtimeError && db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===0)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(runtimeError,null,diagnostics());assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1,diagnostics());
  const identities=db.prepare("SELECT fact_json FROM libra_product_fact_revisions WHERE fact_kind='resolved_identity'").all();assert.equal(identities.length,1);
  const identity=JSON.parse(identities[0].fact_json);assert.equal(identity.identityKind,'jav_code');assert.equal(identity.providerIdentities[0].providerKey,expectedCode);
  assert.equal(identity.javSourceQualification.observation.siteRef,expectedSite);
  const derivatives=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE result_schema_ref LIKE '%product_artifact.acquire%'").all();
  assert.equal(derivatives.length,2);
  for(const row of derivatives) {
    const result=JSON.parse(row.result_json);assert.equal(result.javCoverDerivation.javSelectedSource.siteRef,expectedSite);
    assert.equal(result.javCoverDerivation.outputDigest,result.artifactHandle.digestHex);
    assert.equal(result.javCoverDerivation.sourceByteDigest,identity.javSourceQualification.observation.cover.byteDigest);
  }
  const metadata=JSON.parse(db.prepare("SELECT fact_json FROM libra_product_fact_revisions WHERE fact_kind='product_metadata'").get().fact_json);
  assert.equal(metadata.javSelectedSource.siteRef,expectedSite);
  const fields=new Map(metadata.descriptiveFacts.entries.map(entry=>[entry.key,entry.value]));
  assert.equal(fields.has('studio'),!!sourceCase?.credit);if(sourceCase?.credit){assert.equal(fields.get('studio'),sourceCase.credit.name);assert.equal(fields.get('studio_credit_role'),sourceCase.credit.role);}
  const canonical=db.prepare('SELECT identity_kind,provider,provider_key FROM arca_canonical_identity_revisions').get();
  assert.deepEqual(canonical,{identity_kind:'jav_code',provider:'jav',provider_key:expectedCode});
  const materials=db.prepare('SELECT location,role FROM arca_inventory_materials').all();
  const primary=materials.find(material=>material.role==='primary_payload');assert.ok(primary);
  if(parts) {
    assert.equal(materials.filter(material=>material.role==='primary_payload').length,1);
    const pkg=db.prepare('SELECT material_input_form,jav_part_set_json FROM proc_candidate_packages').all();
    assert.equal(pkg.length,1);assert.equal(pkg[0].material_input_form,'jav_named_parts');
    assert.deepEqual(JSON.parse(pkg[0].jav_part_set_json).parts.map(part=>part.partLabel),['A','B']);
    assert.equal(db.prepare('SELECT count(*) n FROM proc_candidate_primary_materials').get().n,2);
    const results=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE result_schema_ref LIKE '%product_media.verify%'").all().map(row=>JSON.parse(row.result_json));
    const selected=results.find(result=>result.result==='passed');assert.ok(selected);
    assert.equal(selected.javPartVerification.expectedDurationMs,6000);
    assert.ok(Math.abs(selected.javPartVerification.actualDurationMs-6000)<=42);
    assert.equal(selected.javPartVerification.sourceProbeDigests.length,2);
    assert.deepEqual(selected.javPartVerification.passedJoinSamplePointsMs,[2750,3250]);
    if(inputCodec==='h264') {
      assert.ok(results.some(result=>result.reasonCodes.includes('video_codec_unmet')));
      assert.ok(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.media.transcode@1' AND state='succeeded'").get().n>=1);
      assert.equal(selected.qualitySummary.videoCodec,'hevc');
    } else assert.equal(results.length,1);
  } else {
    assert.deepEqual(primaryBytes(),video);
    if(soloPart) {
      assert.equal(db.prepare('SELECT material_input_form FROM proc_candidate_packages').get().material_input_form,'stream_file');
      assert.equal(db.prepare('SELECT count(*) n FROM proc_candidate_primary_materials').get().n,1);
    }
  }
  const allowedHosts=new Set((sourceCase?.sites||['javdb']).flatMap(site=>[...profiles[site].endpoints.map(endpoint=>new URL(endpoint).hostname),...profiles[site].assets]));
  assert.ok(requests.every(url=>allowedHosts.has(new URL(url).hostname)));
  if(sourceCase){assert.equal(fields.get('title'),sourceCase.title);assert.equal(fields.has('release_date'),false);
    assert.equal(identity.javSourceQualification.sourceOrdinal,sourceCase.failPrimary||sourceCase.primaryNotFound||sourceCase.primaryDenied?1:0);
    if(sourceCase.failPrimary||sourceCase.primaryNotFound){
      const observations=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result'").all().map(row=>JSON.parse(row.result_json));
      assert.equal(observations.length,2);
      const rejected=observations.find(value=>value.sourceOrdinal===0),selected=observations.find(value=>value.sourceOrdinal===1);
      assert.equal(rejected.result,'not_found');assert.equal(rejected.reasonCode,sourceCase.failPrimary?'cover_undecodable':'not_found');
      assert.equal(rejected.qualificationObservation,null);assert.equal(selected.result,'resolved');
      assert.equal(selected.qualificationObservation.siteRef,expectedSite);
    }
    if(sourceCase.primaryDenied){
      const failed=db.prepare("SELECT w.work_id,a.failure_code FROM fx_supporting_works w JOIN fx_work_attempts a ON a.work_id=w.work_id WHERE w.process_type='libra_run' AND w.work_kind='product_identity' AND w.state='failed'").all();
      assert.equal(failed.length,1);assert.equal(failed[0].failure_code,sourceCase.primaryHttpStatus===503?'JAV_SOURCE_UNAVAILABLE':'JAV_SOURCE_ACCESS_DENIED');
      if(sourceCase.primaryHttpStatus===503){const attempts=db.prepare("SELECT a.event_attempt_id,a.failure_code FROM fx_event_attempts a JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.work_id=?").all(failed[0].work_id);
        assert.equal(attempts.length,3);assert.ok(attempts.every(attempt=>attempt.failure_code==='JAV_SOURCE_UNAVAILABLE'));
      }
      const sourceBinding=db.prepare('SELECT input_bindings_json FROM fx_plan_nodes n JOIN fx_workflow_events e ON e.plan_id=n.plan_id AND e.node_id=n.node_id WHERE e.work_id=?').get(failed[0].work_id);
      assert.ok(sourceBinding);assert.equal(JSON.parse(sourceBinding.input_bindings_json).bindings.find(item=>item.portName==='productIdentityEvidenceIntent').parameters.javIntent.sourceOrdinal,0);
      assert.ok(requests.slice(ingestRequestStart).some(url=>url==='https://adult.contents.fc2.com/article/718323/'));
      assert.ok(requests.slice(ingestRequestStart).some(url=>url==='https://javmenu.com/FC2-718323'));
      assert.equal(db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result'").get().n,1);
    }
    else if(sourceCase.failPrimary){assert.ok(requests.slice(ingestRequestStart).some(url=>url.includes('/rejected.jpg')));assert.equal(fields.has('genre'),false);}
    else if(sourceCase.primaryNotFound)assert.ok(requests.slice(ingestRequestStart).some(url=>url==='https://javmenu.com/'+expectedCode));
    else assert.ok(requests.slice(ingestRequestStart).every(url=>[...profiles[expectedSite].endpoints.map(endpoint=>new URL(endpoint).hostname),...profiles[expectedSite].assets].includes(new URL(url).hostname)));
    const nfo=fs.readFileSync(materials.find(item=>item.role==='metadata_sidecar').location,'utf8');assert.ok(nfo.includes(expectedCode));assert.ok(nfo.includes(sourceCase.title));
    assert.equal(db.prepare('SELECT count(*) n FROM proc_candidate_packages').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);
  }
  if(manual) {
    const run=db.prepare('SELECT libra_run_id,subject_id FROM libra_runs').get();
    if(originalCandidateClaim)assert.deepEqual(db.prepare('SELECT display_identity,identity_metadata_json,identity_claim_json,package_digest FROM proc_candidate_packages').get(),originalCandidateClaim);
    const replay=await request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/choose-product-identity',confirmation);
    assert.equal(replay.replayed,true);assert.equal(db.prepare('SELECT count(*) n FROM libra_product_identity_selection_intents').get().n,1);
    const changed=await host.inject({method:'POST',url:'/v1/admin/formation/runs/'+run.libra_run_id+'/actions/choose-product-identity',headers:{cookie},payload:{...confirmation,javCode:'IPX-178',idempotencyKey:'different-code'}});
    assert.ok(changed.statusCode>=400);assert.equal(db.prepare("SELECT count(*) n FROM libra_product_fact_revisions WHERE fact_kind='resolved_identity'").get().n,1);
  }
  if(nfoRepair)await require('./fixtures/jav-aftercare-nfo-host').assertJavAftercareNfo({request,db,requests,primaryBytes,diagnostics,runtimeFailure:()=>runtimeError});
  if(posterRepair||posterRepairFailure||fanartRepair)await require('./fixtures/jav-aftercare-poster-host').assertJavAftercarePoster({request,db,requests,primaryBytes,diagnostics,runtimeFailure:()=>runtimeError,
    artifactKind:fanartRepair?'fanart':'poster',
    expectedJavCode:expectedCode,expectedSite,
    failure:posterRepairFailure,beforeObserve:()=>{aftercareCoverUnavailable=posterRepairFailure;},recoverSource:posterRepairRecovery?async()=>{
      aftercareCoverUnavailable=false;
      await request('PATCH','/v1/admin/settings/integrations/network',{kind:'network',idempotencyKey:'jav-recovery-network',expectedConfigRevision:0,settings:{proxyServer:'http://127.0.0.1:18999'}});
      const kind='jav-javdb',proof=await request('POST','/v1/admin/settings/integrations/'+kind+'/actions/test',{kind,idempotencyKey:'jav-aftercare-source-recovery-test',
        endpoint:'https://javdb.com',credential:{kind:'anonymous'},settings:{networkRoute:{mode:'http_proxy',proxyEndpoint:'http://127.0.0.1:18999'}}});
      await request('PATCH','/v1/admin/settings/integrations/'+kind,{kind,idempotencyKey:'jav-aftercare-source-recovery-config',expectedConfigRevision:1,connectionProofId:proof.connectionProofId});
    }:undefined});
  if(correctionAdmission)await require('./fixtures/jav-correction-admission-host').assertCorrectionAdmission({host,dataDir,db});
  if(correctionWork||correctionProcessLoss||correctionOverlap) {
    let perceptionBefore=null;
    if(correctionPerception) {
      const entryId=db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get().shelf_entry_id,
        targetType=correctionPerception==='subject'?'subject':'shelf_entry',targetId=targetType==='subject'?db.prepare('SELECT subject_id FROM libra_runs').get().subject_id:entryId,
        created=await host.inject({method:'POST',url:'/v1/admin/perception/records',headers:{cookie},payload:{targetType,targetId,expectedRevision:0,rating:4,idempotencyKey:'jav-before-correction-rating'}});
      assert.equal(created.statusCode,202,created.body);
      const watched=await host.inject({method:'POST',url:'/v1/admin/perception/records',headers:{cookie},payload:{targetType,targetId,expectedRevision:0,watched:true,idempotencyKey:'jav-before-correction-watched'}});
      assert.equal(watched.statusCode,202,watched.body);
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){const response=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType='+targetType+'&targetId='+targetId,headers:{cookie}});
        assert.equal(response.statusCode,200,response.body);if(response.json().currentRating?.state==='ready'&&response.json().currentRating.rating===4&&response.json().currentWatched?.state==='ready'&&response.json().currentWatched.watchedState===true){perceptionBefore=response.json();break;}
        await new Promise(resolve=>setTimeout(resolve,100));}
      assert.ok(perceptionBefore,'The direct rating must resolve before identity correction starts.');
    }
    const controlsBeforeCorrection=db.prepare('SELECT * FROM fx_material_controls ORDER BY material_key').all(),
      controlRevisionCountBefore=db.prepare('SELECT count(*) n FROM fx_material_control_revisions').get().n;
    const oldNfo=materials.find(item=>item.role==='metadata_sidecar'),oldPoster=materials.find(item=>item.role==='poster'),
      oldPosterBytes=fs.readFileSync(oldPoster.location),oldNfoBytes=fs.readFileSync(oldNfo.location);
    const oldDirectory=path.dirname(oldNfo.location),residue=path.join(oldDirectory,'keep.txt');
    if(directoryCleanup==='residue')fs.writeFileSync(residue,'User confirmation is required for this unknown file.');
    let correctionId,adminConfirmation;
    const correctionEntryId=db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get().shelf_entry_id;
    if(correctionAdmin){
      const base='/v1/admin/collection/'+correctionEntryId;
      assert.deepEqual(await request('GET',base+'/jav-correction'),{correction:null});
      const invalid=await host.inject({method:'GET',url:base+'/actions/preview-jav-correction?javCode=IPX-178&actorId=spoofed',headers:{cookie}});
      assert.equal(invalid.statusCode,400,invalid.body);
      const preview=await request('GET',base+'/actions/preview-jav-correction?javCode=IPX-178');
      assert.equal(preview.result,'qualified');assert.equal(preview.oldIdentity.javCode,'IPX-177');assert.equal(preview.newIdentity.javCode,'IPX-178');
      assert.match(preview.newIdentity.posterUrl,/^data:image\/jpeg;base64,/);assert.equal(preview.paths.length,materials.length);
      adminConfirmation=Object.fromEntries(['previewId','basisDigest','proposalDigest','placementPreviewDigest'].map(key=>[key,preview[key]]));
      adminConfirmation.idempotencyKey='jav-correction-public-confirm';
      const spoofed=await host.inject({method:'POST',url:base+'/actions/confirm-jav-correction',headers:{cookie},payload:{...adminConfirmation,actorId:'spoofed'}});
      assert.equal(spoofed.statusCode,400,spoofed.body);assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,0);
      const accepted=await request('POST',base+'/actions/confirm-jav-correction',adminConfirmation);correctionId=accepted.correctionId;
      assert.equal(accepted.state,'admitted');assert.equal(accepted.replayed,false);
      const admittedWork=await request('GET','/v1/admin/collection/jav-corrections?correctionId='+encodeURIComponent(correctionId));
      assert.equal(admittedWork.items.length,1);assert.equal(admittedWork.items[0].correctionId,correctionId);
      assert.equal(admittedWork.items[0].taskType,'jav_identity_correction');assert.equal(admittedWork.items[0].classification,'in_progress');
      assert.equal((await request('POST',base+'/actions/confirm-jav-correction',adminConfirmation)).replayed,true);
      const changed=await host.inject({method:'POST',url:base+'/actions/confirm-jav-correction',headers:{cookie},payload:{...adminConfirmation,proposalDigest:'0'.repeat(64)}});
      assert.equal(changed.statusCode,409,changed.body);assert.equal(changed.json().error.code,'ARCA_JAV_CORRECTION_COMMAND_CONFLICT');
      const foreign=await host.inject({method:'GET',url:'/v1/admin/collection/another-entry/jav-corrections/'+correctionId,headers:{cookie}});
      assert.equal(foreign.statusCode,404,foreign.body);
      await host.close();
    }else correctionId=await require('./fixtures/jav-correction-work-host').admitCorrection({host,dataDir,db,secretRoot,fetchImpl});
    changeConfirmedTitle=correctionSourceFailure;
    let injectedAssetPath=null;
    if(correctionAssetsFailure){injectedAssetPath=path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','nfo','movie.nfo');
      fs.mkdirSync(path.dirname(injectedAssetPath),{recursive:true});fs.writeFileSync(injectedAssetPath,'fixture-known conflicting nfo');}
    if(correctionAtomicCommit||correctionOverlap) {
      const picturePath=path.join(root,'source-cover.jpg');fs.writeFileSync(picturePath,picture);
      const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures','jav-correction-process-loss.js'),dataDir,adminDistDir,picturePath,correctionId,'commit_admitted',correctionOverlap?'overlap':'normal'],
        {encoding:'utf8',windowsHide:true,timeout:45000});assert.equal(child.status,72,child.stderr);
      if(correctionAtomicCommit){await require('./fixtures/jav-correction-work-host').inspectFilePlan({host:{close:async()=>{}},dataDir,db,correctionId,atomicCommit:true});
        assert.deepEqual(primaryBytes(),video);return;}
      const intentFile=path.join(dataDir,'operator-runtime','intent.json'),intent=fs.existsSync(intentFile)?JSON.parse(fs.readFileSync(intentFile,'utf8')):
        {schema:'shelfdeck.runtime-intent@1',desiredMode:'running',revision:0,pendingReset:null};
      fs.writeFileSync(intentFile,JSON.stringify({...intent,desiredMode:'stopped',revision:intent.revision+1}));
      host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;}});
      const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),
        entryId=db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get().shelf_entry_id,
        poster=await host.inject({method:'GET',url:'/v1/admin/collection/'+entryId+'/poster',headers:{cookie:login.headers['set-cookie']}});
      assert.equal(poster.statusCode,200,poster.body);assert.deepEqual(poster.rawPayload,oldPosterBytes);
      assert.equal(db.prepare('SELECT provider_key FROM arca_canonical_identity_revisions WHERE revision=1').get().provider_key,'IPX-177');
      assert.equal(db.prepare('SELECT canonical_identity_revision FROM arca_shelf_entries').get().canonical_identity_revision,1);
      assert.match(fs.readFileSync(oldNfo.location,'utf8'),/IPX-178/);
      await host.close();fs.writeFileSync(intentFile,JSON.stringify({...intent,desiredMode:'running',revision:intent.revision+2}));
    }
    if(correctionPhaseFailure){
      const picturePath=path.join(root,'phase-cover.jpg'),faultPath=path.join(root,'phase-fault.json');fs.writeFileSync(picturePath,picture);
      const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures','jav-correction-terminal-phase.js'),dataDir,adminDistDir,picturePath,correctionId,correctionPhaseFailure,faultPath],
        {encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(child.status,72,child.stderr);
      const fault=JSON.parse(fs.readFileSync(faultPath,'utf8')),assertOwned=location=>{const relative=path.relative(root,path.resolve(location));assert.ok(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative));};
      assertOwned(fault.foreignPath);if(fault.restoreFromPath)assertOwned(fault.restoreFromPath);
      const failedWorks=db.prepare("SELECT * FROM fx_supporting_works WHERE process_id=? AND state='failed' ORDER BY work_id").all(correctionId),
        failedEffects=db.prepare("SELECT j.* FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=? AND j.state='failed' ORDER BY j.effect_id").all(correctionId),
        sourceResults=db.prepare("SELECT e.event_id,r.result_json,r.result_digest FROM fx_workflow_events e JOIN fx_event_result_bindings r ON r.event_id=e.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=? AND e.capability_ref='arca.jav_correction.source.verify@1'").all(correctionId),
        conflictBytes=fs.readFileSync(fault.foreignPath),beforeIdentity=db.prepare('SELECT canonical_identity_revision,current_inventory_revision FROM arca_shelf_entries').get();
      assert.equal(failedWorks.length,1);assert.ok(failedEffects.length);assert.deepEqual(beforeIdentity,{canonical_identity_revision:1,current_inventory_revision:1});assert.deepEqual(primaryBytes(),video);
      runtimeError=null;host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;}});
      const session=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),headers={cookie:session.headers['set-cookie']},
        scope='/v1/admin/collection/'+correctionEntryId+'/jav-corrections/'+correctionId,status=(await host.inject({method:'GET',url:scope,headers})).json(),
        command={expectedStateRevision:status.stateRevision,expectedAdmissionDigest:status.admissionDigest,expectedCleanupState:status.cleanupState,
          expectedRecoveryIntentDigest:status.recovery.previousIntentDigest,idempotencyKey:'recover-terminal-'+correctionPhaseFailure},
        blocked=await host.inject({method:'POST',url:scope+'/actions/recover',headers,payload:command});
      assert.equal(blocked.statusCode,409,blocked.body);assert.ok(['ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN','ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID'].includes(blocked.json().error.code),blocked.body);
      assert.deepEqual(fs.readFileSync(fault.foreignPath),conflictBytes);assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_correction_recovery_intents').get().n,0);await host.close();
      if(fault.restoreAction==='copy')fs.copyFileSync(fault.restoreFromPath,fault.foreignPath);
      else{fs.unlinkSync(fault.foreignPath);if(fault.restoreAction==='link')fs.linkSync(fault.restoreFromPath,fault.foreignPath);}
      const recoveryErrors=[];host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>recoveryErrors.push(error)});
      const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),authorized={cookie:login.headers['set-cookie']},
        accepted=await host.inject({method:'POST',url:scope+'/actions/recover',headers:authorized,payload:command});assert.equal(accepted.statusCode,202,accepted.body);assert.equal(accepted.json().replayed,false);
      const replay=await host.inject({method:'POST',url:scope+'/actions/recover',headers:authorized,payload:command});assert.equal(replay.statusCode,202,replay.body);assert.equal(replay.json().replayed,true);
      const deadline=Date.now()+75000;while(Date.now()<deadline&&db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state!=='completed')await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state,'completed',JSON.stringify({errors:recoveryErrors.map(error=>({code:error.code,message:error.message})),...JSON.parse(diagnostics())}));
      assert.ok(recoveryErrors.every(error=>correctionPhaseFailure==='producer'&&error.code==='ARCA_JAV_CORRECTION_TEMP_RECOVERY_REQUIRED'),JSON.stringify(recoveryErrors));
      assert.deepEqual(db.prepare("SELECT * FROM fx_supporting_works WHERE process_id=? AND state='failed' ORDER BY work_id").all(correctionId),failedWorks);
      assert.deepEqual(db.prepare("SELECT j.* FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=? AND j.state='failed' ORDER BY j.effect_id").all(correctionId),failedEffects);
      assert.deepEqual(db.prepare("SELECT e.event_id,r.result_json,r.result_digest FROM fx_workflow_events e JOIN fx_event_result_bindings r ON r.event_id=e.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=? AND e.capability_ref='arca.jav_correction.source.verify@1'").all(correctionId),sourceResults);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_correction_recovery_intents').get().n,1);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);assert.deepEqual(primaryBytes(),video);
      const task=await host.inject({method:'GET',url:'/v1/admin/collection/jav-corrections?correctionId='+encodeURIComponent(correctionId),headers:authorized});
      assert.equal(task.statusCode,200,task.body);assert.equal(task.json().items.length,1);assert.equal(task.json().items[0].classification,'completed');return;
    }
    let interrupted=null;
    if(correctionProcessLoss) {
      const picturePath=path.join(root,'source-cover.jpg');fs.writeFileSync(picturePath,picture);
      const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures','jav-correction-process-loss.js'),dataDir,adminDistDir,picturePath,correctionId,workspaceLoss?correctionProcessLoss==='workspace_reclaim_conflict'?'workspace_reclaim':correctionProcessLoss:retirementLoss?'retirement':correctionProcessLoss==='rollback'?'commit_uncommitted':correctionProcessLoss==='commit'?'commit_bound':correctionProcessLoss==='partial'?'partial':correctionProcessLoss==='stage'?'stage':'published'],
        {encoding:'utf8',windowsHide:true,timeout:45000});
      assert.equal(child.status,72,child.stderr);
      const nfo=path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','nfo','movie.nfo'),
        effect=db.prepare('SELECT j.* FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref=?')
          .get(workspaceLoss?'arca.jav_correction.workspace.reclaim@1':retirementLoss?'arca.jav_correction.formal_retirement.execute@1':['commit','rollback'].includes(correctionProcessLoss)?'arca.jav_correction.inventory.commit@1':correctionProcessLoss==='stage'?'arca.jav_correction.files.stage@1':'arca.jav_correction.assets.prepare@1');
      assert.ok(effect);assert.equal(effect.state,cleanupLoss?'committed':'intended');assert.equal(db.prepare("SELECT count(*) n FROM fx_workspace_materials WHERE workspace_id=?").get(correctionId+'-assets').n,workspaceLoss||['stage','commit','rollback','retirement','retirement_conflict'].includes(correctionProcessLoss)?4:1);
      const sourceResult=db.prepare("SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref='arca.jav_correction.source.verify@1'").get().result_json,
        recipe=JSON.parse(sourceResult).byteExpectations.find(item=>item.kind==='nfo'),temporary=path.join(path.dirname(nfo),'.shelfdeck-writing-'+recipe.byteDigest+'.part');
      interrupted={effectId:effect.effect_id,nfo:fs.existsSync(nfo)?fs.readFileSync(nfo):null,inode:fs.existsSync(nfo)?fs.statSync(nfo,{bigint:true}).ino:null,
        sourceResult,temporary};
      if(workspaceLoss||['commit','retirement','retirement_conflict'].includes(correctionProcessLoss)) {
        const bound=db.prepare('SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref=?').get('arca.jav_correction.inventory.commit@1');
        assert.ok(bound);interrupted.commitResult=bound.result_json;
        assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'committed');
        assert.equal(db.prepare('SELECT canonical_identity_revision FROM arca_shelf_entries').get().canonical_identity_revision,2);
      }
      if(workspaceLoss){
        const reclaim=db.prepare('SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref=?').get('arca.jav_correction.workspace.reclaim@1');
        if(cleanupLoss||correctionProcessLoss==='workspace_reclaim_commit'){assert.ok(reclaim);interrupted.reclaimResult=reclaim.result_json;}
        else{assert.equal(reclaim,undefined);assert.equal(db.prepare('SELECT state FROM fx_workspace_registry WHERE workspace_id=?').get(correctionId+'-assets').state,'active');
          assert.ok(db.prepare('SELECT state FROM fx_workspace_materials WHERE workspace_id=?').all(correctionId+'-assets').every(row=>row.state==='active'));
          assert.ok(db.prepare('SELECT state,reference_revision FROM fx_artifact_registry WHERE owner_scope_type=? AND owner_scope_id=?').all('jav_identity_correction',correctionId).every(row=>row.state==='active'&&row.reference_revision===1));
          assert.equal(db.prepare('SELECT count(*) n FROM fx_commit_markers WHERE commit_marker LIKE ?').get('arca-jav-reclaim-marker-%').n,0);}
      }
      if(cleanupLoss){const row=db.prepare('SELECT cleanup_state,cleanup_receipt_schema_ref,cleanup_receipt_json,cleanup_receipt_digest FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId);
        if(correctionProcessLoss==='cleanup_uncommitted')assert.deepEqual(row,{cleanup_state:'active',cleanup_receipt_schema_ref:null,cleanup_receipt_json:null,cleanup_receipt_digest:null});
        else{assert.equal(row.cleanup_state,'completed');interrupted.cleanupReceipt=row.cleanup_receipt_json;}
        assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_correction_directory_checks WHERE correction_id=?').get(correctionId).n,correctionProcessLoss==='cleanup_uncommitted'?0:1);
        assert.equal(db.prepare('SELECT state FROM fx_workspace_registry WHERE workspace_id=?').get(correctionId+'-assets').state,'reclaimed');
        assert.equal(db.prepare('SELECT canonical_identity_revision,current_inventory_revision FROM arca_shelf_entries').get().current_inventory_revision,2);
        assert.deepEqual(primaryBytes(),video);
      }
      if(correctionProcessLoss==='rollback') {
        assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'active');
        assert.equal(db.prepare('SELECT canonical_identity_revision,current_inventory_revision FROM arca_shelf_entries').get().canonical_identity_revision,1);
        assert.equal(db.prepare('SELECT count(*) n FROM arca_canonical_identity_revisions').get().n,1);
        assert.equal(db.prepare('SELECT count(*) n FROM arca_inventory_representations').get().n,1);
        assert.deepEqual(db.prepare('SELECT committed_context_schema_ref,committed_context_json,committed_context_digest FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId),
          {committed_context_schema_ref:null,committed_context_json:null,committed_context_digest:null});
        assert.deepEqual(db.prepare('SELECT * FROM fx_material_controls ORDER BY material_key').all(),controlsBeforeCorrection);
        assert.equal(db.prepare('SELECT count(*) n FROM fx_material_control_revisions').get().n,controlRevisionCountBefore);
        assert.equal(db.prepare('SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref=?').get('arca.jav_correction.inventory.commit@1'),undefined);
      }
      if(correctionProcessLoss==='partial'){assert.equal(fs.existsSync(nfo),false);assert.ok(fs.statSync(temporary).size<recipe.sizeBytes);}
      if(correctionProcessLoss==='conflict') {
        const changed=Buffer.from(interrupted.nfo);changed[0]^=1;fs.writeFileSync(nfo,changed);interrupted.conflictingBytes=changed;
      }
    }
    if(correctionProcessLoss==='retirement_conflict'){const context=JSON.parse(db.prepare('SELECT committed_context_json FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).committed_context_json);
      interrupted.foreignLocation=context.filePlan.members[3].retainedLocation;interrupted.originalAliasLocation=context.filePlan.members[3].original.location;
      fs.unlinkSync(interrupted.foreignLocation);fs.writeFileSync(interrupted.foreignLocation,'retirement-foreign');}
    if(correctionProcessLoss==='workspace_reclaim_conflict'){interrupted.foreignLocation=path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','poster','poster.jpg');
      interrupted.originalWorkspaceBytes=fs.readFileSync(interrupted.foreignLocation);interrupted.conflictingBytes=Buffer.from(interrupted.originalWorkspaceBytes);
      interrupted.conflictingBytes[0]^=1;fs.writeFileSync(interrupted.foreignLocation,interrupted.conflictingBytes);}
    runtimeError=null;host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;},onRequestError:error=>{requestError=error;}});
    if(correctionAssetsFailure){const deadline=Date.now()+45000;
      while(Date.now()<deadline&&db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state!=='attention_required')await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(runtimeError?.code,'ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT',diagnostics());assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'attention_required',diagnostics());
      await host.close();const recover=require('./fixtures/jav-correction-recovery-host').recoverCorrection,
        failedBefore=db.prepare('SELECT * FROM fx_supporting_works WHERE process_id=? AND state=?').all(correctionId,'failed');
      assert.equal(failedBefore.length,1);
      await assert.rejects(recover({dataDir,db,correctionId,prepareOnly:true}),{code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN'});
      assert.equal(fs.readFileSync(injectedAssetPath,'utf8'),'fixture-known conflicting nfo');assert.deepEqual(primaryBytes(),video);
      fs.unlinkSync(injectedAssetPath);
      const metadataPath=path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','metadata','metadata.json'),metadataBytes=fs.readFileSync(metadataPath),
        receipt=await recover({dataDir,db,correctionId}),sourceResults=db.prepare('SELECT e.event_id,r.result_json,r.result_digest FROM fx_workflow_events e JOIN fx_event_result_bindings r ON r.event_id=e.event_id WHERE e.work_id=? AND e.capability_ref=?').all(failedBefore[0].work_id,'arca.jav_correction.source.verify@1');
      assert.ok(receipt.sourceResultReference);assert.equal(receipt.failedWorkId,failedBefore[0].work_id);assert.equal(receipt.filePlanDigest,null);
      assert.deepEqual(fs.readFileSync(metadataPath),metadataBytes);assert.equal(sourceResults.length,1);runtimeError=null;changeCorrectionOptional=true;
      host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;},onRequestError:error=>{requestError=error;}});
      const completionDeadline=Date.now()+60000;
      while(Date.now()<completionDeadline&&!runtimeError&&db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state!=='completed')await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(runtimeError,null,diagnostics());assert.equal(db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state,'completed',diagnostics());
      const currentSourceResults=db.prepare('SELECT e.event_id,r.result_json,r.result_digest FROM fx_workflow_events e JOIN fx_event_result_bindings r ON r.event_id=e.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=? AND e.capability_ref=?').all(correctionId,'arca.jav_correction.source.verify@1');
      assert.deepEqual(currentSourceResults,sourceResults);
      const correctedNfo=db.prepare("SELECT m.location FROM arca_inventory_materials m JOIN arca_shelf_entries e ON e.shelf_entry_id=m.shelf_entry_id AND e.current_inventory_revision=m.inventory_revision WHERE m.role='metadata_sidecar'").get();
      assert.doesNotMatch(fs.readFileSync(correctedNfo.location,'utf8'),/2026-10-15/);
      assert.deepEqual(db.prepare('SELECT * FROM fx_supporting_works WHERE process_id=? AND state=?').all(correctionId,'failed'),failedBefore);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_correction_recovery_intents').get().n,1);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);assert.deepEqual(primaryBytes(),video);return;
    }
    if(correctionSourceFailure){const deadline=Date.now()+30000;
      while(Date.now()<deadline&&!runtimeError&&db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state!=='attention_required')await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(runtimeError,null,diagnostics());assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'attention_required',diagnostics());
      await host.close();
      const observed=require('./fixtures/jav-correction-no-effect-host').observeNoEffectFailure({dataDir,correctionId,db});
      assert.equal(observed.correctionId,correctionId);assert.equal(observed.expectedStateRevision,3);assert.ok(observed.failures.length);
      const executionEvidence=require('./fixtures/jav-correction-no-effect-host').observeNoEffectFailure({dataDir,correctionId,db,executionEvidence:true});
      assert.equal(executionEvidence.snapshot.works.length,1);assert.equal(executionEvidence.snapshot.works[0].state,'failed');
      assert.equal(executionEvidence.snapshot.events.length,2);assert.equal(executionEvidence.snapshot.effects.length,0);
      assert.match(executionEvidence.failedWorkEvidenceDigest,/^[a-f0-9]{64}$/);
      const insertArtifact=db.prepare('INSERT INTO fx_artifact_registry (artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,storage_ref,digest_algorithm,digest_hex,size_bytes,media_type,provenance_ref,reference_revision,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
        inspect=()=>require('./fixtures/jav-correction-no-effect-host').observeNoEffectFailure({dataDir,correctionId,db});
      insertArtifact.run('fixture-other-correction-artifact','nfo','arca','jav_identity_correction','another-correction','test-only-unused','sha256','0'.repeat(64),1,'application/xml','fixture:other',1,'active',1);
      assert.equal(inspect().observationDigest,observed.observationDigest);
      insertArtifact.run('fixture-late-correction-artifact','nfo','arca','jav_identity_correction',correctionId,'test-only-unused','sha256','0'.repeat(64),1,'application/xml','fixture:late',1,'active',1);
      assert.throws(inspect,{code:'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN'});
      db.prepare('DELETE FROM fx_artifact_registry WHERE artifact_handle_id IN (?,?)').run('fixture-other-correction-artifact','fixture-late-correction-artifact');
      const workspaceRoot=db.prepare('SELECT root_handle_ref FROM platform_workspace_roots WHERE root_id=?').get('service-arca-aftercare-workspace').root_handle_ref;
      db.prepare('INSERT INTO fx_workspace_registry (workspace_id,owner_domain,process_type,process_id,root_handle_ref,state,created_at_ms,reclaim_after_ms,reclaimed_at_ms) VALUES (?,?,?,?,?,?,?,?,?)')
        .run('fixture-jav-correction-workspace','arca','jav_identity_correction',correctionId,workspaceRoot,'active',1,null,null);
      assert.throws(inspect,{code:'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN'});
      db.prepare('DELETE FROM fx_workspace_registry WHERE workspace_id=?').run('fixture-jav-correction-workspace');
      assert.equal(db.prepare('SELECT provider_key FROM arca_canonical_identity_revisions').get().provider_key,'IPX-177');
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);assert.deepEqual(primaryBytes(),video);
      assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'attention_required');
      if(correctionRepeatCancel){
        runtimeError=null;requestError=null;host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;},onRequestError:error=>{requestError=error;}});
        const session=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),headers={cookie:session.headers['set-cookie']},
          scope='/v1/admin/collection/'+correctionEntryId+'/jav-corrections/'+correctionId;
        for(let attempt=0;attempt<2;attempt++){
          const statusReply=await host.inject({method:'GET',url:scope,headers});assert.equal(statusReply.statusCode,200,requestError?.stack||statusReply.body);
          const status=statusReply.json();assert.equal(status.cancellation.available,true);
          const accepted=await host.inject({method:'POST',url:scope+'/actions/recover',headers,payload:{expectedStateRevision:status.stateRevision,expectedAdmissionDigest:status.admissionDigest,
            expectedCleanupState:status.cleanupState,expectedRecoveryIntentDigest:status.recovery.previousIntentDigest,idempotencyKey:'repeat-source-recovery-'+attempt}});
          assert.equal(accepted.statusCode,202,accepted.body);
          const deadline=Date.now()+60000;while(Date.now()<deadline&&!runtimeError&&db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state!=='attention_required')await new Promise(resolve=>setTimeout(resolve,100));
          assert.equal(runtimeError,null,diagnostics());assert.equal(db.prepare('SELECT state_revision FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state_revision,5+attempt*2,diagnostics());
          assert.equal(db.prepare('SELECT count(*) n FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=?').get(correctionId).n,0);
        }
        const failed=db.prepare('SELECT * FROM fx_supporting_works WHERE process_id=? ORDER BY work_id').all(correctionId),
          history=db.prepare('SELECT * FROM arca_jav_correction_recovery_intents WHERE correction_id=? ORDER BY recovery_id').all(correctionId),
          status=(await host.inject({method:'GET',url:scope,headers})).json(),payload={expectedStateRevision:status.stateRevision,expectedAdmissionDigest:status.admissionDigest,idempotencyKey:'cancel-after-repeated-source-failure'};
        assert.equal(failed.length,3);assert.ok(failed.every(work=>work.state==='failed'));assert.equal(history.length,2);assert.equal(status.cancellation.available,true);
        const accepted=await host.inject({method:'POST',url:scope+'/actions/cancel',headers,payload});assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().state,'cancelled');
        const replay=await host.inject({method:'POST',url:scope+'/actions/cancel',headers,payload});assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().replayed,true);
        assert.deepEqual(db.prepare('SELECT * FROM fx_supporting_works WHERE process_id=? ORDER BY work_id').all(correctionId),failed);
        assert.deepEqual(db.prepare('SELECT * FROM arca_jav_correction_recovery_intents WHERE correction_id=? ORDER BY recovery_id').all(correctionId),history);
        assert.equal(db.prepare('SELECT canonical_identity_revision,current_inventory_revision FROM arca_shelf_entries').get().canonical_identity_revision,1);
        assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);assert.deepEqual(primaryBytes(),video);return;
      }
      if(correctionPublicRecovery){
        const failedBefore=db.prepare("SELECT * FROM fx_supporting_works WHERE process_id=? AND state='failed' ORDER BY work_id").all(correctionId);
        changeConfirmedTitle=false;runtimeError=null;
        host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;}});
        const session=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),headers={cookie:session.headers['set-cookie']},
          scope='/v1/admin/collection/'+correctionEntryId+'/jav-corrections/'+correctionId,
          read=await host.inject({method:'GET',url:scope,headers}),status=read.json(),
          payload={expectedStateRevision:status.stateRevision,expectedAdmissionDigest:status.admissionDigest,expectedCleanupState:status.cleanupState,
            expectedRecoveryIntentDigest:status.recovery.previousIntentDigest,idempotencyKey:'public-source-recovery'};
        assert.equal(read.statusCode,200,read.body);assert.equal(status.recovery.available,true);assert.equal(status.recovery.mode,'continue_correction');
        const spoofed=await host.inject({method:'POST',url:scope+'/actions/recover',headers,payload:{...payload,actorId:'spoofed'}});assert.equal(spoofed.statusCode,400,spoofed.body);
        const stale=await host.inject({method:'POST',url:scope+'/actions/recover',headers,payload:{...payload,expectedStateRevision:payload.expectedStateRevision-1,idempotencyKey:'stale-source-recovery'}});
        assert.equal(stale.statusCode,409,stale.body);assert.equal(stale.json().error.code,'ARCA_JAV_CORRECTION_RECOVERY_STALE');
        assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_correction_recovery_intents').get().n,0);
        const accepted=await host.inject({method:'POST',url:scope+'/actions/recover',headers,payload});assert.equal(accepted.statusCode,202,accepted.body);
        assert.equal(accepted.json().correctionId,correctionId);assert.equal(accepted.json().state,'active');assert.equal(accepted.json().replayed,false);
        const replay=await host.inject({method:'POST',url:scope+'/actions/recover',headers,payload});assert.equal(replay.statusCode,202,replay.body);assert.equal(replay.json().replayed,true);
        const altered=await host.inject({method:'POST',url:scope+'/actions/recover',headers,payload:{...payload,expectedAdmissionDigest:'0'.repeat(64)}});
        assert.equal(altered.statusCode,409,altered.body);assert.equal(altered.json().error.code,'ARCA_JAV_CORRECTION_COMMAND_CONFLICT');
        const deadline=Date.now()+60000;while(Date.now()<deadline&&!runtimeError&&db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state!=='completed')await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(runtimeError,null,diagnostics());assert.equal(db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state,'completed',diagnostics());
        const work=await host.inject({method:'GET',url:'/v1/admin/collection/jav-corrections?correctionId='+encodeURIComponent(correctionId),headers});
        assert.equal(work.statusCode,200,work.body);assert.equal(work.json().items.length,1);assert.equal(work.json().items[0].classification,'completed');assert.equal(work.json().items[0].recovery.available,false);
        assert.deepEqual(db.prepare("SELECT * FROM fx_supporting_works WHERE process_id=? AND state='failed' ORDER BY work_id").all(correctionId),failedBefore);
        assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_correction_recovery_intents').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
        assert.deepEqual(primaryBytes(),video);return;
      }
      if(correctionRecoveryCommand){const failedBefore=db.prepare('SELECT * FROM fx_supporting_works WHERE process_id=? AND state=? ORDER BY work_id').all(correctionId,'failed'),
          receipt=require('./fixtures/jav-correction-no-effect-host').observeNoEffectFailure({dataDir,correctionId,db,recoveryCommand:true});
        assert.equal(receipt.correctionId,correctionId);assert.equal(receipt.mode,'continue_correction');assert.deepEqual(primaryBytes(),video);
        assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
        if(!correctionRecoveryContinue)return;
        changeConfirmedTitle=false;runtimeError=null;
        host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;},onRequestError:error=>{requestError=error;}});
        const recoveryDeadline=Date.now()+60000;
        while(Date.now()<recoveryDeadline&&!runtimeError&&db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state!=='completed')await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(runtimeError,null,diagnostics());assert.equal(db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state,'completed',diagnostics());
        assert.deepEqual(db.prepare('SELECT * FROM fx_supporting_works WHERE process_id=? AND state=? ORDER BY work_id').all(correctionId,'failed'),failedBefore);
        assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
        assert.equal(db.prepare('SELECT recovery_intent_digest FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).recovery_intent_digest,receipt.receiptDigest);
        const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),
          response=await host.inject({method:'GET',url:'/v1/admin/collection/jav-corrections?correctionId='+encodeURIComponent(correctionId),headers:{cookie:login.headers['set-cookie']}});
        assert.equal(response.statusCode,200,response.body);const task=response.json().items[0];assert.equal(task.classification,'completed');assert.equal(task.newJavCode,'IPX-178');
        assert.equal(task.processDetail.stages.length,8);assert.equal(task.processDetail.stages.filter(item=>item.state==='attention').length,1);
        assert.equal(task.processDetail.stages.filter(item=>item.state==='completed').length,7);assert.deepEqual(primaryBytes(),video);return;}
      if(correctionCancelApi){
        host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;}});
        const base='/v1/admin/collection/'+correctionEntryId,status=await request('GET',base+'/jav-corrections/'+correctionId),cancelUrl=base+'/jav-corrections/'+correctionId+'/actions/cancel',
          body={expectedStateRevision:status.stateRevision,expectedAdmissionDigest:status.admissionDigest,idempotencyKey:'public-source-only-cancel'};
        assert.deepEqual(status.cancellation,{available:true,reasonCode:null});
        const forged=await host.inject({method:'POST',url:cancelUrl,headers:{cookie},payload:{...body,actorId:'forged'}});assert.equal(forged.statusCode,400,forged.body);
        const foreign=await host.inject({method:'POST',url:'/v1/admin/collection/another-entry/jav-corrections/'+correctionId+'/actions/cancel',headers:{cookie},payload:body});assert.equal(foreign.statusCode,404,foreign.body);
        const stale=await host.inject({method:'POST',url:cancelUrl,headers:{cookie},payload:{...body,expectedStateRevision:status.stateRevision-1}});assert.equal(stale.statusCode,409,stale.body);
        const accepted=await request('POST',cancelUrl,body);assert.equal(accepted.state,'cancelled');assert.equal(accepted.replayed,false);
        assert.deepEqual(await request('POST',cancelUrl,body),{...accepted,replayed:true});
        const changed=await host.inject({method:'POST',url:cancelUrl,headers:{cookie},payload:{...body,expectedAdmissionDigest:'0'.repeat(64)}});assert.equal(changed.statusCode,409,changed.body);assert.equal(changed.json().error.code,'ARCA_JAV_CORRECTION_COMMAND_CONFLICT');
        const cancelledStatus=await request('GET',base+'/jav-corrections/'+correctionId);assert.equal(cancelledStatus.state,'cancelled');
        assert.deepEqual(cancelledStatus.cancellation,{available:false,reasonCode:'not_attention_required'});
        changeConfirmedTitle=false;
        const preview=await request('GET',base+'/actions/preview-jav-correction?javCode=IPX-178');assert.equal(preview.result,'qualified');
        const confirmation=Object.fromEntries(['previewId','basisDigest','proposalDigest','placementPreviewDigest'].map(key=>[key,preview[key]]));confirmation.idempotencyKey='public-confirm-after-cancellation';
        const replacement=await request('POST',base+'/actions/confirm-jav-correction',confirmation);assert.notEqual(replacement.correctionId,correctionId);
        const until=Date.now()+45000;let final;
        while(Date.now()<until&&!runtimeError){final=await request('GET',base+'/jav-corrections/'+replacement.correctionId);if(final.state==='committed'&&final.cleanupState==='completed')break;await new Promise(resolve=>setTimeout(resolve,100));}
        assert.equal(runtimeError,null,diagnostics());assert.equal(final?.state,'committed',JSON.stringify(final));assert.equal(final.cleanupState,'completed');
        assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'cancelled');
        assert.equal(db.prepare('SELECT i.provider_key FROM arca_canonical_identity_revisions i JOIN arca_shelf_entries e ON e.shelf_entry_id=i.shelf_entry_id AND e.canonical_identity_revision=i.revision').get().provider_key,'IPX-178');
        assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);assert.deepEqual(primaryBytes(),video);return;
      }
      const cancelled=require('./fixtures/jav-correction-no-effect-host').observeNoEffectFailure({dataDir,correctionId,db,cancel:true});
      assert.equal(cancelled.state,'cancelled');assert.deepEqual(primaryBytes(),video);
      assert.equal(db.prepare('SELECT provider_key FROM arca_canonical_identity_revisions').get().provider_key,'IPX-177');
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);return;
    }
    async function recoverTerminalCleanup(){
      await host.close();const recover=require('./fixtures/jav-correction-recovery-host').recoverCorrection,
        failedEffect=db.prepare('SELECT * FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId),
        failedWorks=db.prepare("SELECT * FROM fx_supporting_works WHERE process_id=? AND state='failed' ORDER BY work_id").all(correctionId),
        committed=db.prepare('SELECT committed_context_json,terminal_evidence_digest,state_revision FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId),
        entry=db.prepare('SELECT * FROM arca_shelf_entries').get();
      await assert.rejects(recover({dataDir,db,correctionId,prepareOnly:true}),{code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN'});
      assert.deepEqual(db.prepare('SELECT * FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId),failedEffect);
      if(interrupted.originalAliasLocation){assert.equal(fs.readFileSync(interrupted.foreignLocation,'utf8'),'retirement-foreign');
        fs.unlinkSync(interrupted.foreignLocation);fs.linkSync(interrupted.originalAliasLocation,interrupted.foreignLocation);}
      else fs.writeFileSync(interrupted.foreignLocation,interrupted.originalWorkspaceBytes);
      const receipt=await recover({dataDir,db,correctionId});assert.equal(receipt.mode,'continue_cleanup');
      assert.equal(receipt.acceptedStateRevision,committed.state_revision);const recoveryErrors=[];
      host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>recoveryErrors.push(error)});
      const end=Date.now()+45000;while(Date.now()<end&&db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state!=='completed')await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state,'completed',JSON.stringify(recoveryErrors.map(error=>({code:error.code,message:error.message}))));
      assert.ok(recoveryErrors.every(error=>['ARCA_JAV_CORRECTION_RETIREMENT_INCOMPLETE','ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'].includes(error.code)),JSON.stringify(recoveryErrors));
      assert.deepEqual(db.prepare('SELECT * FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId),failedEffect);
      assert.deepEqual(db.prepare("SELECT * FROM fx_supporting_works WHERE process_id=? AND state='failed' ORDER BY work_id").all(correctionId),failedWorks);
      assert.deepEqual(db.prepare('SELECT committed_context_json,terminal_evidence_digest,state_revision FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId),committed);
      assert.deepEqual(db.prepare('SELECT * FROM arca_shelf_entries').get(),entry);assert.deepEqual(primaryBytes(),video);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,1);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_correction_recovery_intents').get().n,1);
    }
    if(correctionProcessLoss==='workspace_reclaim_conflict'){const deadline=Date.now()+12000;while(Date.now()<deadline&&!runtimeError&&db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state!=='attention_required')await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(runtimeError,null,diagnostics());assert.deepEqual(db.prepare('SELECT state,cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId),{state:'committed',cleanup_state:'attention_required'});
      assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId).state,'failed');assert.deepEqual(fs.readFileSync(interrupted.foreignLocation),interrupted.conflictingBytes);
      assert.equal(db.prepare('SELECT state FROM fx_workspace_registry WHERE workspace_id=?').get(correctionId+'-assets').state,'active');
      assert.deepEqual(primaryBytes(),video);assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);if(correctionTerminalRecovery)await recoverTerminalCleanup();return;}
    if(correctionProcessLoss==='retirement_conflict'){const deadline=Date.now()+12000;while(Date.now()<deadline&&!runtimeError&&db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state!=='attention_required')await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(runtimeError,null,diagnostics());assert.deepEqual(db.prepare('SELECT state,cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId),{state:'committed',cleanup_state:'attention_required'});
      assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId).state,'failed');assert.equal(fs.readFileSync(interrupted.foreignLocation,'utf8'),'retirement-foreign');
      assert.deepEqual(primaryBytes(),video);assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);if(correctionTerminalRecovery)await recoverTerminalCleanup();return;}
    if(correctionProcessLoss==='conflict') {
      const deadline=Date.now()+10000;
      while(Date.now()<deadline&&!runtimeError&&db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state!=='attention_required')await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(runtimeError,null,diagnostics());assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'attention_required',diagnostics());
      assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId).state,'failed');
      assert.ok(db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND state='failed'").get(correctionId));
      assert.deepEqual(fs.readFileSync(path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','nfo','movie.nfo')),interrupted.conflictingBytes);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
      assert.equal(db.prepare('SELECT provider_key FROM arca_canonical_identity_revisions').get().provider_key,'IPX-177');
      const scope='/v1/admin/collection/'+correctionEntryId+'/jav-corrections/'+correctionId,status=await request('GET',scope),
        cancelled=await host.inject({method:'POST',url:scope+'/actions/cancel',headers:{cookie},payload:{expectedStateRevision:status.stateRevision,
          expectedAdmissionDigest:status.admissionDigest,idempotencyKey:'reject-written-correction-cancel'}});
      assert.deepEqual(status.cancellation,{available:false,reasonCode:'no_effect_unproven'});
      assert.equal(cancelled.statusCode,409,cancelled.body);assert.equal(cancelled.json().error.code,'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN');
      assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'attention_required');
      assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId).state,'failed');
      assert.deepEqual(primaryBytes(),video);return;
    }
    const end=Date.now()+30000;
    while(Date.now()<end&&!runtimeError&&!db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND state='succeeded'").get(correctionId))await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeError,null,diagnostics());
    assert.ok(db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND state='succeeded'").get(correctionId),diagnostics());
    assert.equal(db.prepare('SELECT count(*) n FROM fx_workspace_materials WHERE workspace_id=?').get(correctionId+'-assets').n,4);
    assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref IN ('arca.jav_correction.source.verify@1','arca.jav_correction.assets.prepare@1') AND state='succeeded'").get().n,2);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
    assert.equal(db.prepare('SELECT provider_key FROM arca_canonical_identity_revisions').get().provider_key,'IPX-177');
    assert.deepEqual(primaryBytes(),video);
    const nfo=path.join(dataDir,'workspaces','aftercare',correctionId+'-assets','nfo','movie.nfo');
    if(!workspaceLoss&&!retirementLoss)assert.match(fs.readFileSync(nfo,'utf8'),/IPX-178/);
    const event=db.prepare("SELECT event_id FROM fx_workflow_events WHERE capability_ref='arca.jav_correction.assets.prepare@1'").get(),
      binding=db.prepare('SELECT result_json,effect_receipt_id FROM fx_event_result_bindings WHERE event_id=?').get(event.event_id),
      prepared=JSON.parse(binding.result_json),effects=db.prepare('SELECT j.state,j.effect_class FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id WHERE a.event_id=?').all(event.event_id);
    assert.ok(binding.effect_receipt_id);assert.deepEqual(effects,[{state:'committed',effect_class:'workspace_write'}]);
    if(interrupted) {
      if(!workspaceLoss&&!['stage','retirement','retirement_conflict'].includes(correctionProcessLoss))assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId).state,'committed');
      if(interrupted.nfo&&!workspaceLoss&&!retirementLoss){assert.deepEqual(fs.readFileSync(nfo),interrupted.nfo);assert.equal(fs.statSync(nfo,{bigint:true}).ino,interrupted.inode);}
      assert.equal(fs.existsSync(interrupted.temporary),false);
      assert.equal(db.prepare("SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref='arca.jav_correction.source.verify@1'").get().result_json,interrupted.sourceResult);
    }
    assert.equal(db.prepare('SELECT count(*) n FROM fx_artifact_registry WHERE owner_scope_type=? AND owner_scope_id=?').get('jav_identity_correction',correctionId).n,3);
    if(!workspaceLoss&&!retirementLoss)for(const artifact of prepared.artifacts) {
      const actual=fs.readFileSync(artifact.artifactHandle.storageRef);
      assert.equal(require('node:crypto').createHash('sha256').update(actual).digest('hex'),artifact.artifactHandle.digestHex);
      assert.equal(actual.length,artifact.artifactHandle.sizeBytes);
    }
    const publishDeadline=Date.now()+12000;
    while(Date.now()<publishDeadline&&!runtimeError&&!db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_publish' AND state='succeeded'").get(correctionId))await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeError,null,diagnostics());
    assert.ok(db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_publish' AND state='succeeded'").get(correctionId),diagnostics());
    const publication=JSON.parse(db.prepare('SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref=?').get('arca.jav_correction.files.publish@1').result_json);
    assert.equal(publication.scopeId,correctionId);assert.equal(publication.scopeType,'jav_identity_correction');
    const verificationDeadline=Date.now()+12000;
    while(Date.now()<verificationDeadline&&!runtimeError&&!db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_verify' AND state='succeeded'").get(correctionId))await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeError,null,diagnostics());
    assert.ok(db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_verify' AND state='succeeded'").get(correctionId),diagnostics());
    const verificationRow=db.prepare('SELECT * FROM arca_inventory_verification_records WHERE process_type=? AND process_id=?').get('arca_jav_identity_correction',correctionId),
      verification=JSON.parse(verificationRow.verification_json);
    assert.equal(verification.result,'passed');assert.equal(verification.memberEvidence.length,4);
    assert.equal(verification.finalBindingSetDigest,publication.finalBindingSetDigest);
    assert.equal(verification.memberEvidence.filter(item=>item.verificationKind==='readable_nfo').length,1);
    assert.deepEqual(db.prepare('SELECT j.effect_class,j.state FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref=?').all('arca.jav_correction.files.verify@1'),[{effect_class:'domain_fact_commit',state:'committed'}]);
    const commitWork=()=>db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_commit' AND state='succeeded'").get(correctionId),deadline=Date.now()+15000;
    while(Date.now()<deadline&&!runtimeError&&!commitWork())await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeError,null,diagnostics());assert.ok(commitWork(),diagnostics());
    const retirementDone=()=>db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_formal_retirement' AND state='succeeded'").get(correctionId),retirementDeadline=Date.now()+20000;
    while(Date.now()<retirementDeadline&&!runtimeError&&!retirementDone())await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeError,null,diagnostics());assert.ok(retirementDone(),diagnostics());
    const retirementResult=JSON.parse(db.prepare("SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref='arca.jav_correction.formal_retirement.execute@1'").get().result_json);
    assert.equal(retirementResult.correctionId,correctionId);if(retirementLoss)assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId).state,'committed');assert.equal(retirementResult.stageDisposition,'absent');
    const workspaceDone=()=>db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_workspace_reclaim' AND state='succeeded'").get(correctionId),workspaceDeadline=Date.now()+20000;
    while(Date.now()<workspaceDeadline&&!runtimeError&&!workspaceDone())await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeError,null,diagnostics());assert.ok(workspaceDone(),diagnostics());
    const workspaceResult=JSON.parse(db.prepare("SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref='arca.jav_correction.workspace.reclaim@1'").get().result_json);
    assert.equal(workspaceResult.correctionId,correctionId);assert.equal(workspaceResult.reclaimedHandleCount,4);assert.equal(workspaceResult.reclaimedArtifactCount,3);
    if(workspaceLoss){assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId).state,'committed');
      if(interrupted.reclaimResult)assert.equal(canonicalDigest(workspaceResult),canonicalDigest(JSON.parse(interrupted.reclaimResult)));}
    assert.equal(workspaceResult.workspaceDisposition,'absent');assert.equal(db.prepare('SELECT state FROM fx_workspace_registry WHERE workspace_id=?').get(correctionId+'-assets').state,'reclaimed');
    assert.deepEqual(db.prepare('SELECT state FROM fx_workspace_materials WHERE workspace_id=?').all(correctionId+'-assets').map(row=>row.state),['reclaimed','reclaimed','reclaimed','reclaimed']);
    assert.deepEqual(db.prepare('SELECT state,reference_revision FROM fx_artifact_registry WHERE owner_domain=? AND owner_scope_type=? AND owner_scope_id=?').all('arca','jav_identity_correction',correctionId),
      [{state:'deleted',reference_revision:2},{state:'deleted',reference_revision:2},{state:'deleted',reference_revision:2}]);
    assert.equal(fs.existsSync(path.join(dataDir,'workspaces','aftercare',correctionId+'-assets')),false);
    const cleanupDeadline=Date.now()+20000;
    while(Date.now()<cleanupDeadline&&!runtimeError&&db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state!=='completed')await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeError,null,diagnostics());assert.equal(db.prepare('SELECT cleanup_state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_state,'completed',diagnostics());
    const cleanupReceipt=JSON.parse(db.prepare('SELECT cleanup_receipt_json FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).cleanup_receipt_json);
    const directorySeed=db.prepare('SELECT * FROM arca_jav_correction_directory_checks WHERE correction_id=?').get(correctionId);
    assert.ok(directorySeed.check_revision>=1);
    assert.equal(directorySeed.created_at_ms,cleanupReceipt.completedAtMs);assert.equal(directorySeed.cleanup_receipt_digest,cleanupReceipt.receiptDigest);
    if(directoryCleanup){
      const fresh=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),headers={cookie:fresh.headers['set-cookie']},base='/v1/admin/care-recycle',deadline=Date.now()+20000;
      let observation;
      while(Date.now()<deadline){const response=await host.inject({method:'GET',url:base,headers});assert.equal(response.statusCode,200,response.body);observation=response.json();
        const row=observation.correctionChecks.find(row=>row.correctionId===correctionId);
        if(row?.checks.some(check=>check.sourceLocation===oldDirectory&&check.state===(directoryCleanup==='residue'?'awaiting_confirmation':'archived')))break;
        await new Promise(resolve=>setTimeout(resolve,100));}
      const check=observation.correctionChecks.find(row=>row.correctionId===correctionId);assert.ok(check);assert.equal(Object.hasOwn(check,'onDeckRunId'),false);
      assert.ok(observation.cleanupChecks.every(row=>row.checks.every(item=>item.sourceLocation!==oldDirectory)));
      if(directoryCleanup==='residue'){
        assert.equal(check.state,'attention');assert.equal(fs.readFileSync(residue,'utf8'),'User confirmation is required for this unknown file.');
        assert.equal(observation.items.filter(row=>row.sourceLocation===oldDirectory).length,0);
        const response=await host.inject({method:'GET',url:base+'/'+correctionEntryId+'/preview?sourceLocation='+encodeURIComponent(oldDirectory),headers});assert.equal(response.statusCode,200,response.body);
        const preview=response.json();assert.equal(preview.requiresConfirmation,true);assert.deepEqual(preview.manifest.entries.map(row=>row.relativePath),['keep.txt']);
        const accepted=await host.inject({method:'POST',url:base+'/'+correctionEntryId+'/actions/archive',headers,payload:{...preview,confirmManifestDigest:preview.manifestDigest,idempotencyKey:'corrected-directory-confirmed'}});assert.equal(accepted.statusCode,202,accepted.body);
        const archivedDeadline=Date.now()+15000;while(Date.now()<archivedDeadline&&fs.existsSync(oldDirectory))await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.equal(fs.existsSync(oldDirectory),false);assert.deepEqual(primaryBytes(),video);assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
      const restoredRow=await host.inject({method:'GET',url:base,headers});assert.equal(restoredRow.statusCode,200,restoredRow.body);assert.equal(restoredRow.json().correctionChecks.find(row=>row.correctionId===correctionId).state,'completed');
    }
    if(interrupted?.cleanupReceipt)assert.deepEqual(cleanupReceipt,JSON.parse(interrupted.cleanupReceipt));
    assert.equal(cleanupReceipt.correctionId,correctionId);assert.equal(cleanupReceipt.workspaceReclaimResult.resultDigest,canonicalDigest(workspaceResult));
    assert.equal(cleanupReceipt.formalRetirementResult.resultDigest,canonicalDigest(retirementResult));
    const receiptRow=()=>db.prepare('SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref=?').get('arca.jav_correction.inventory.commit@1'),receipt=JSON.parse(receiptRow().result_json),
      entry=db.prepare('SELECT canonical_identity_revision,current_inventory_revision FROM arca_shelf_entries').get();
    assert.equal(receipt.correctionId,correctionId);assert.equal(receipt.newInventoryRevision,2);assert.equal(receipt.newCanonicalIdentityRevision,2);
    if(interrupted?.commitResult){assert.equal(receiptRow().result_json,interrupted.commitResult);assert.equal(db.prepare('SELECT state FROM fx_effect_journal WHERE effect_id=?').get(interrupted.effectId).state,'committed');}
    assert.equal(entry.current_inventory_revision,2);assert.equal(entry.canonical_identity_revision,2);
    assert.equal(db.prepare('SELECT provider_key FROM arca_canonical_identity_revisions WHERE revision=2').get().provider_key,'IPX-178');
    assert.equal(db.prepare('SELECT provider_key FROM arca_canonical_identity_revisions WHERE revision=1').get().provider_key,'IPX-177');
    assert.equal(db.prepare('SELECT state FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).state,'committed');
    assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_inventory_commits').get().n,0);
    assert.deepEqual(primaryBytes(),video);
    assert.deepEqual(db.prepare('SELECT j.effect_class,j.state FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref=?').all('arca.jav_correction.inventory.commit@1'),[{effect_class:'responsibility_control_commit',state:'committed'}]);
    if(correctionPerception) {
      const entryId=db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get().shelf_entry_id,
        login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),newCookie=login.headers['set-cookie'],deadline=Date.now()+35000;
      let after=null;
      while(Date.now()<deadline){const response=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType=shelf_entry&targetId='+entryId,headers:{cookie:newCookie}});
        assert.equal(response.statusCode,200,response.body+'\n'+(requestError?.stack||''));if(response.json().currentRating?.state==='ready'&&response.json().currentWatched?.state==='ready'){after=response.json();break;}
        await new Promise(resolve=>setTimeout(resolve,100));}
      assert.ok(after);assert.equal(after.currentRating.rating,4);assert.equal(after.currentRating.expectedRevision,correctionPerception==='subject'?0:1);
      assert.equal(after.currentWatched.watchedState,true);assert.equal(after.currentWatched.expectedRevision,correctionPerception==='subject'?0:1);
      const records=correctionPerception==='subject'?(await request('GET','/v1/admin/perception/records?targetType=subject&targetId='+db.prepare('SELECT subject_id FROM libra_runs').get().subject_id)).items:after.items;
      assert.deepEqual(records.filter(item=>item.sourceKind==='shelfdeck_direct').map(item=>item.perceptionId),perceptionBefore.items.filter(item=>item.sourceKind==='shelfdeck_direct').map(item=>item.perceptionId));
    }
    if(correctionPeople) {
      const rows=db.prepare("SELECT * FROM arca_inventory_person_relations WHERE inventory_revision=2 ORDER BY display_name").all();assert.equal(rows.length,2);
      assert.equal(rows[1].display_name,'Unresolved Actor');assert.equal(rows[1].person_id,null);
      assert.equal(rows[0].display_name,'New Actor');assert.equal(rows[0].person_id,null);
      assert.equal(db.prepare('SELECT display_name FROM arca_inventory_person_relations WHERE inventory_revision=1').get().display_name,'Old Actor');
      assert.equal(db.prepare('SELECT count(*) n FROM people_persons').get().n,0);
      assert.equal(db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE work_kind='system_person_registration'").get().n,0);
      clockEpoch=Date.parse('2026-10-31T03:00:00+08:00');clockStart=Date.now();
      const registered=()=>db.prepare("SELECT p.person_id FROM people_persons p JOIN people_person_revisions r ON r.person_id=p.person_id AND r.revision=p.current_revision WHERE p.library_kind='jav' AND r.canonical_name='New Actor'").get(),end=Date.now()+35000;
      while(Date.now()<end&&!registered()&&!runtimeError)await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(runtimeError,null,diagnostics());assert.ok(registered(),diagnostics());const personId=registered().person_id;
      const currentCandidate=db.prepare("SELECT * FROM people_registration_candidates WHERE proposed_name='New Actor' AND current_state='accepted'").get();
      assert.ok(currentCandidate,diagnostics());
      assert.equal(db.prepare('SELECT decision_origin FROM people_registration_candidate_revisions WHERE registration_candidate_id=? AND state=?').get(currentCandidate.registration_candidate_id,'accepted').decision_origin,'strong_identity_rule');
      assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='people.registration_evidence.observe@1' AND state='succeeded'").get().n>=1,true);
      const weak=()=>db.prepare("SELECT * FROM people_registration_candidates WHERE proposed_name='Unresolved Actor' AND current_state='open'").get(),weakDeadline=Date.now()+35000;
      while(Date.now()<weakDeadline&&!weak()&&!runtimeError)await new Promise(resolve=>setTimeout(resolve,100));
      assert.ok(weak(),diagnostics());assert.deepEqual(JSON.parse(weak().candidate_json).providerIdentities,[]);
      assert.equal(db.prepare("SELECT count(*) n FROM people_person_revisions WHERE canonical_name='Unresolved Actor'").get().n,0);
      const hidden=await request('GET','/v1/admin/people/registration-candidates');assert.deepEqual(hidden.items,[]);
      const linked=()=>db.prepare('SELECT person_id FROM arca_inventory_person_relations p JOIN arca_shelf_entries e ON e.shelf_entry_id=p.shelf_entry_id AND e.current_inventory_revision=p.inventory_revision WHERE display_name=?').get('New Actor');
      const linkDeadline=Date.now()+35000;while(Date.now()<linkDeadline&&linked()?.person_id!==personId&&!runtimeError)await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(runtimeError,null,diagnostics());assert.equal(linked()?.person_id,personId);
      assert.equal(db.prepare("SELECT count(*) n FROM arca_inventory_person_relations p JOIN arca_shelf_entries e ON e.shelf_entry_id=p.shelf_entry_id AND e.current_inventory_revision=p.inventory_revision WHERE display_name='Old Actor'").get().n,0);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
      assert.equal(canonicalDigest(JSON.parse(receiptRow().result_json)),canonicalDigest(receipt));
    }
    const before={works:db.prepare('SELECT count(*) n FROM fx_supporting_works WHERE process_id=?').get(correctionId).n,receipt:receiptRow().result_json,
      materials:db.prepare('SELECT * FROM fx_workspace_materials WHERE workspace_id=? ORDER BY relative_path').all(correctionId+'-assets'),requests:requests.length};
    await host.close();runtimeError=null;
    host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;}});
    await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(runtimeError,null,diagnostics());
    assert.equal(db.prepare('SELECT count(*) n FROM fx_supporting_works WHERE process_id=?').get(correctionId).n,before.works);assert.equal(receiptRow().result_json,before.receipt);
    assert.deepEqual(db.prepare('SELECT * FROM fx_workspace_materials WHERE workspace_id=? ORDER BY relative_path').all(correctionId+'-assets'),before.materials);
    assert.equal(requests.length,before.requests);assert.deepEqual(primaryBytes(),video);
    if(correctionPerception){const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),
      entryId=db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get().shelf_entry_id,
      rating=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType=shelf_entry&targetId='+entryId,headers:{cookie:login.headers['set-cookie']}});
      assert.equal(rating.statusCode,200,rating.body);assert.equal(rating.json().currentRating.state,'ready');assert.equal(rating.json().currentRating.rating,4);
      assert.equal(rating.json().currentRating.expectedRevision,correctionPerception==='subject'?0:1);
      assert.equal(rating.json().currentWatched.state,'ready');assert.equal(rating.json().currentWatched.watchedState,true);
      assert.equal(rating.json().currentWatched.expectedRevision,correctionPerception==='subject'?0:1);}
    if(correctionPeople){const historical=await require('./fixtures/jav-correction-work-host').inspectCommittedRetirement({host,dataDir,db,correctionId,receiptOnly:true});
      assert.equal(db.prepare('SELECT current_inventory_revision FROM arca_shelf_entries').get().current_inventory_revision,3);
      assert.deepEqual(historical.cleanupReceipt,cleanupReceipt);assert.deepEqual(primaryBytes(),video);}
    if(correctionAdmin){
      const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),headers={cookie:login.headers['set-cookie']},base='/v1/admin/collection/'+correctionEntryId;
      const current=await host.inject({method:'GET',url:base+'/jav-corrections/'+correctionId,headers});
      assert.equal(current.statusCode,200,current.body);assert.equal(current.json().state,'committed');assert.equal(current.json().newJavCode,'IPX-178');
      const workPage=await host.inject({method:'GET',url:'/v1/admin/collection/jav-corrections?correctionId='+encodeURIComponent(correctionId),headers});
      assert.equal(workPage.statusCode,200,workPage.body);assert.equal(workPage.json().items.length,1);
      const workItem=workPage.json().items[0];assert.equal(workItem.correctionId,correctionId);assert.equal(workItem.taskType,'jav_identity_correction');
      assert.equal(workItem.classification,'completed');assert.equal(workItem.cleanupState,'completed');assert.equal(workItem.aftercareCaseId,undefined);
      assert.equal(workItem.processDetail.contract,'jav_correction_process_actual_plans@1');assert.equal(workItem.processDetail.stages.length,7);
      assert.ok(workItem.processDetail.stages.every(stage=>stage.state==='completed'&&stage.plans.length>0));
      const filtered=await host.inject({method:'GET',url:'/v1/admin/collection/jav-corrections?classification=in_progress',headers});
      assert.equal(filtered.statusCode,200,filtered.body);assert.equal(filtered.json().items.length,0);assert.equal(filtered.json().counts.completed,1);
      const latest=await host.inject({method:'GET',url:base+'/jav-correction',headers});assert.equal(latest.statusCode,200,latest.body);assert.deepEqual(latest.json().correction,current.json());
      const replay=await host.inject({method:'POST',url:base+'/actions/confirm-jav-correction',headers,payload:adminConfirmation});
      assert.equal(replay.statusCode,202,replay.body);assert.equal(replay.json().replayed,true);assert.equal(replay.json().correctionId,correctionId);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,1);assert.equal(requests.length,before.requests);
      const retired=await require('./fixtures/jav-correction-work-host').inspectCommittedRetirement({host,dataDir,db,correctionId});
      assert.equal(retired.correctionId,correctionId);assert.equal(retired.commitReceiptDigest,canonicalDigest(receipt));assert.equal(retired.finals.filter(row=>row.role==='primary_payload').length,1);
      assert.deepEqual(retired.cleanupReceipt,cleanupReceipt);
      assert.equal(retired.directoryScope.cleanupReceiptDigest,cleanupReceipt.receiptDigest);
      assert.deepEqual(retired.directoryScope.directories.map(item=>item.sourceLocation),[...new Set(materials.map(item=>path.dirname(item.location)))].sort());
      assert.ok(retired.directoryScope.directories.every(item=>item.eligibility==='eligible'));
      assert.equal(retired.cleanupReceipt.committedContextDigest,JSON.parse(db.prepare('SELECT committed_context_json FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId).committed_context_json).contextDigest);
      assert.equal(requests.length,before.requests);assert.deepEqual(primaryBytes(),video);
      if(correctedPosterRepair) {
        host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>{runtimeError=error;}});
        const currentRequest=async(method,url,payload)=>{const response=await host.inject({method,url,headers,payload});
          assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response.json();};
        await require('./fixtures/jav-aftercare-poster-host').assertJavAftercarePoster({request:currentRequest,db,requests,primaryBytes,diagnostics,
          runtimeFailure:()=>runtimeError,expectedJavCode:'IPX-178',expectedResourceKey:'Correct02',artifactKind:correctedPosterRepair==='fanart'?'fanart':'poster'});
      }
    }
  }
  if(operations)await require('./fixtures/jav-collection-operations-host').assertJavCollectionOperations({request,db,diagnostics,runtimeFailure:()=>runtimeError,mode:operations});
}
test('isolated JAV Host uses real HEVC video and controlled single-site HTTP through Workspace artifacts and one Arca Commit',{timeout:120000},t=>journey(t));
test('shelved JAV missing NFO is repaired by Arca from accepted facts while preserving its code video and unique On-deck receipt',{timeout:180000},t=>journey(t,{nfoRepair:true}));
test('shelved JAV missing poster is repaired from its pinned accepted source with full crop proof and unchanged video NFO identity and receipt',{timeout:180000},t=>journey(t,{posterRepair:true}));
test('shelved JAV required fanart is repaired as an uncropped fanart with its own typed receipt and unchanged collection identity',{timeout:180000},t=>journey(t,{fanartRepair:true}));
test('shelved JAV poster source failure records a no-write failed Effect and keeps the original inventory video and NFO',{timeout:180000},t=>journey(t,{posterRepairFailure:true}));
test('shelved JAV fanart source failure retains its failed Effects and original poster video and inventory without a target write',{timeout:180000},t=>journey(t,{fanartRepair:true,posterRepairFailure:true}));
test('JAV poster maintenance recovers in a new Case after its own source condition changes and preserves every original failed Effect',{timeout:240000},t=>journey(t,{posterRepairFailure:true,posterRepairRecovery:true}));
for(const sourceCase of [
  {javCode:'FC2-718323',sites:['fc2_official'],selectedSite:'fc2_official',credit:{name:'Fixture Seller',role:'seller'}},
  {javCode:'GETCHU-4052694',sites:['dl_getchu'],selectedSite:'dl_getchu',credit:{name:'Fixture Circle',role:'circle'}},
])test('JAV special-source poster maintenance '+sourceCase.javCode+' preserves its own source and optional credited role',{timeout:180000},
  t=>journey(t,{posterRepair:true,sourceCase:{title:'Fixture JAV film',...sourceCase}}));
test('corrected JAV missing poster uses the current Arca metadata source and never returns to its original film',{timeout:240000},t=>journey(t,{correctionWork:true,correctionAdmin:true,correctedPosterRepair:true}));
test('corrected JAV missing fanart uses only the current accepted film and preserves its poster and video',{timeout:240000},t=>journey(t,{correctionWork:true,correctionAdmin:true,correctedPosterRepair:'fanart'}));
test('JAV correction confirmed source drift leaves a proven no-write failure and preserves the original collection gate',{timeout:120000},t=>journey(t,{correctionWork:true,correctionSourceFailure:true}));
test('JAV Recovery Intent command preserves terminal execution and atomically admits one new lineage with replay and late-failure rollback',{timeout:120000},t=>journey(t,{correctionWork:true,correctionSourceFailure:true,correctionRecoveryCommand:true}));
test('JAV failed source recovery uses new Foundation Work and Effects to complete the same correction while retaining failed history and video',{timeout:180000},t=>journey(t,{correctionWork:true,correctionSourceFailure:true,correctionRecoveryCommand:true,correctionRecoveryContinue:true}));
test('JAV public cancellation rejects forged or stale requests and permits a fresh confirmed correction through cleanup',{timeout:120000},t=>journey(t,{correctionWork:true,correctionAdmin:true,correctionSourceFailure:true,correctionCancelApi:true}));
test('FC2 official access failure advances to one JavMenu source without mixing fields or producing duplicate media',{timeout:120000},t=>journey(t,{sourceCase:{
  javCode:'FC2-718323',filenameStem:'FC2-PPV-718323',sites:['fc2_official','javmenu'],selectedSite:'javmenu',title:'Fixture FC2 fallback film',primaryDenied:true}}));
test('FC2 temporary unavailability exhausts its bounded retries before choosing one complete JavMenu source',{timeout:120000},t=>journey(t,{sourceCase:{
  javCode:'FC2-718323',filenameStem:'FC2-PPV-718323',sites:['fc2_official','javmenu'],selectedSite:'javmenu',title:'Fixture FC2 fallback film',primaryDenied:true,primaryHttpStatus:503}}));
for(const sourceCase of [
  {javCode:'FC2-718323',filenameStem:'FC2-PPV-718323',sites:['fc2_official'],selectedSite:'fc2_official',credit:{name:'Fixture Seller',role:'seller'}},
  {javCode:'HEYDOUGA-4030-2113',filenameStem:'HEY-4030-2113',sites:['heydouga_official'],selectedSite:'heydouga_official'},
  {javCode:'082713-417',sites:['caribbeancom_official'],selectedSite:'caribbeancom_official'},
  {javCode:'259LUXU-1022',sites:['avwiki'],selectedSite:'avwiki',credit:{name:'Fixture Maker',role:'maker'}},
  {javCode:'GETCHU-4052694',sites:['dl_getchu'],selectedSite:'dl_getchu',credit:{name:'Fixture Circle',role:'circle'}},
  {javCode:'GYUTTO-242158',sites:['gyutto'],selectedSite:'gyutto',credit:{name:'Fixture Circle',role:'circle'}},
  ...['MKBD-S112','IBW-112Z','T38-071','N1234'].map(javCode=>({javCode,sites:['javmenu'],selectedSite:'javmenu'})),
  {javCode:'ABP-001',sites:['javdb','javmenu'],selectedSite:'javmenu',failPrimary:true},
  {javCode:'ABP-002',sites:['javdb','javmenu'],selectedSite:'javdb'},
  {javCode:'T28-557',sites:['javmenu','javdb'],selectedSite:'javdb',primaryNotFound:true},
])test('JAV class source journey '+sourceCase.javCode+' keeps exact single-site provenance through one Commit',{timeout:120000},t=>journey(t,{sourceCase:{title:'Fixture JAV film',...sourceCase}}));
test('unrecognized JAV input waits in the workbench; exact manual preview and confirmation resume to Commit and preserve receipt replay',{timeout:120000},t=>journey(t,{manual:true}));
test('explicit CID filename preserves its original Claim and waits for a real manually confirmed JAV identity before one Commit',{timeout:120000},t=>journey(t,{manual:true,manualFilenameStem:'CID=ipx00177'}));
test('unrecognized JAV input accepts an exact FC2 official manual preview and keeps its first identity locked through Commit',{timeout:120000},t=>journey(t,{manual:true,sourceCase:{javCode:'FC2-718323',sites:['fc2_official'],selectedSite:'fc2_official',title:'Fixture JAV film',credit:{name:'Fixture Seller',role:'seller'}}}));
test('JAV A/B actual inputs form one Package, remux in order and establish exactly one Arca Commit',{timeout:120000},t=>journey(t,{parts:true}));
test('one actual JAV B input remains a single-file journey and reaches Commit without an A requirement',{timeout:120000},t=>journey(t,{soloPart:'B'}));
test('one actual JAV A input remains a single-file journey and reaches Commit without a B requirement',{timeout:120000},t=>journey(t,{soloPart:'A'}));
test('incompatible JAV actual parts freeze with genuine rejected-Plan evidence and retain both sources without a fake Event',{timeout:60000},t=>journey(t,{parts:true,incompatible:true}));
test('JAV H.264 A/B inputs merge before a real HEVC Transcode and one final Arca Commit',{timeout:120000},t=>journey(t,{parts:true,inputCodec:'h264'}));
test('owned real JAV Entry admits an independent correction atomically, rolls stale Control back and replays without preview cache',{timeout:120000},t=>journey(t,{correctionAdmission:true}));
test('admitted JAV correction resumes through formal source verification and Workspace asset Work while preserving the original collection',{timeout:120000},t=>journey(t,{correctionWork:true}));
test('Correction Owner transaction atomically commits identity Inventory Control and Receipt and rolls back late participant failures',{timeout:120000},t=>journey(t,{correctionWork:true,correctionAtomicCommit:true}));
test('actual JAV correction process loss after NFO bytes recovers the original Effect and frozen source without rewriting the video',{timeout:150000},t=>journey(t,{correctionProcessLoss:true}));
test('conflicting correction bytes after actual process loss require attention and preserve both the conflict and original collection',{timeout:150000},t=>journey(t,{correctionProcessLoss:'conflict'}));
test('actual loss inside a producer write rebuilds its declared short temporary under the original Effect and never publishes truncated NFO',{timeout:150000},t=>journey(t,{correctionProcessLoss:'partial'}));
test('actual loss after the last staged file resumes formal staging under its original material Effect and preserves current collection',{timeout:150000},t=>journey(t,{correctionProcessLoss:'stage'}));
test('overlapping correction publication keeps the current original poster and identity visible before the final commit',{timeout:150000},t=>journey(t,{correctionOverlap:true}));
test('actual loss after atomic correction Receipt resumes the same bound Effect without a second identity Inventory or collection Commit',{timeout:150000},t=>journey(t,{correctionProcessLoss:'commit'}));
test('actual process exit inside Correction Owner transaction rolls back all heads Control and Receipt then recovers the same Effect',{timeout:150000},t=>journey(t,{correctionProcessLoss:'rollback'}));
test('corrected JAV cast is registered and linked by formal system Evidence only in the maintenance window',{timeout:150000},t=>journey(t,{correctionWork:true,correctionPeople:true}));
test('direct rating on the same JAV Entry remains resolved after identity correction through public Perception APIs',{timeout:150000},t=>journey(t,{correctionWork:true,correctionPerception:true}));
test('direct rating on the exact accepted Subject remains available on its corrected JAV Entry without rewriting the Record',{timeout:150000},t=>journey(t,{correctionWork:true,correctionPerception:'subject'}));
test('public JAV correction preview confirm and owned status reach Commit and exact confirmation replays after cache loss',{timeout:150000},t=>journey(t,{correctionWork:true,correctionAdmin:true}));
test('corrected JAV old empty Inventory directory is automatically archived through public recycle facts without a second On-deck Commit',{timeout:150000},t=>journey(t,{correctionWork:true,correctionAdmin:true,directoryCleanup:'empty'}));
test('corrected JAV old directory with an unknown file waits for exact public confirmation before archive',{timeout:150000},t=>journey(t,{correctionWork:true,correctionAdmin:true,directoryCleanup:'residue'}));

test('actual process loss after two formal retirement unlinks resumes the original material Effect and retains the current video',{timeout:150000},t=>journey(t,{correctionProcessLoss:'retirement'}));

test('foreign retained alias after retirement process loss fails the original cleanup Effect and keeps committed identity and video',{timeout:150000},t=>journey(t,{correctionProcessLoss:'retirement_conflict'}));

test('actual process loss after two Workspace reclaim unlinks resumes the original workspace Effect and preserves committed video',{timeout:150000},t=>journey(t,{correctionProcessLoss:'workspace_reclaim'}));
test('Workspace reclaim lifecycle COMMIT before journal recovery replays the same bound Receipt',{timeout:150000},t=>journey(t,{correctionProcessLoss:'workspace_reclaim_commit'}));
test('process loss inside Workspace lifecycle transaction rolls back Registry Artifact Result and marker together',{timeout:150000},t=>journey(t,{correctionProcessLoss:'workspace_reclaim_rollback'}));
test('foreign Workspace bytes after partial reclaim fail the original Effect and retain cleanup gate and video',{timeout:150000},t=>journey(t,{correctionProcessLoss:'workspace_reclaim_conflict'}));
test('actual process loss inside cleanup completion leaves no Receipt and preserves the gate until owner replay',{timeout:150000},t=>journey(t,{correctionProcessLoss:'cleanup_uncommitted'}));
test('actual process loss after cleanup COMMIT preserves one Receipt and released gate across restart',{timeout:150000},t=>journey(t,{correctionProcessLoss:'cleanup_committed'}));

for(const operation of ['offdeck','deregister'])test('JAV collection operation '+operation+' uses Arca scope and preserves unrelated files and original identity receipts',{timeout:180000},t=>journey(t,{operations:operation}));

test('JAV terminal asset failure recovers through a fresh server scene and retains its old Source Result despite changed optional site metadata',{timeout:180000},t=>journey(t,{correctionWork:true,correctionAssetsFailure:true}));
test('JAV terminal formal retirement failure admits a new cleanup Intent and finishes partial aliases with immutable failed history',{timeout:180000},t=>journey(t,{correctionProcessLoss:'retirement_conflict',correctionTerminalRecovery:true}));
test('JAV terminal Workspace reclaim failure admits a new cleanup Intent and finishes partial reclamation with immutable failed history',{timeout:180000},t=>journey(t,{correctionProcessLoss:'workspace_reclaim_conflict',correctionTerminalRecovery:true}));

test('JAV public recovery validates current scope, rejects spoofed and stale commands, replays receipt and completes the same visible task',{timeout:180000},t=>journey(t,{correctionWork:true,correctionSourceFailure:true,correctionPublicRecovery:true}));

for(const phase of ['stage','publish','verify','commit','producer'])test('JAV terminal phase recovery: '+phase+' retains failed effects and completes the same task through the public API',{timeout:240000},t=>journey(t,{correctionWork:true,correctionPhaseFailure:phase}));

test('JAV repeated source-only recovery failures remain safely cancellable through their complete immutable lineage',{timeout:180000},t=>journey(t,{correctionWork:true,correctionSourceFailure:true,correctionRepeatCancel:true}));
