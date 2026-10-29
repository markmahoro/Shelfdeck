'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {canonicalDigest} = require('../../src/helix/contracts/canonical-json');
const {assertAcceptedIntake,assertRecoveredIntakeFailures,failedAttempts} = require('./helpers/intake-failure-evidence');

// Install a test-process-only scheduling barrier before loading the composition.
// It delays one real Event before input projection; it does not manufacture or
// mutate a continuity Decision, owner fact, Effect, or Result.
const runtimePath = require.resolve('../../src/helix/foundation/execution/event-runtime');
const originalRuntime = require(runtimePath);
let barrier = null;
require.cache[runtimePath].exports = {...originalRuntime,createEventRuntime(options) {
  const runtime = originalRuntime.createEventRuntime(options);
  return Object.freeze({...runtime,async run(request) {
    const eventId=request.schedulerLease.targetId;
    if (barrier && !barrier.eventId && eventId.startsWith('intake-accept-')) {
      barrier.eventId=eventId;
      let renewalError;
      const heartbeat=setInterval(()=>{try {options.scheduler.renew(request.schedulerLease);} catch(error) {renewalError=error;}},10000);
      try {await barrier.released;} finally {clearInterval(heartbeat);}
      if(renewalError)throw renewalError;
    }
    return runtime.run(request);
  }});
}};
const {initializeCleanData} = require('../../scripts/helix-operational-safety');
const {createCleanServiceHost} = require('../../src/clean-service-host');
require.cache[runtimePath].exports = originalRuntime;

function overrideReads(db, needle, method, alter) {
  return {prepare(sql) {
    const statement=db.prepare(sql);
    if (!sql.includes(needle)) return statement;
    return {get(...args) {const value=statement.get(...args);return method==='get' ? alter(value) : value;},
      all(...args) {const value=statement.all(...args);return method==='all' ? alter(value) : value;}};
  }};
}

test('concurrent Season intake retains and safely replans a stale Acceptance Attempt', {timeout:180000}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-continuity-replan-'));
  const source=path.join(root,'source'),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin');
  const secretRoot='disposable-continuity-replan-secret-0123456789012345',files=[];
  fs.mkdirSync(adminDistDir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  for(let show=0;show<3;show++) for(let episode=1;episode<=3;episode++) {
    const parent=path.join(source,'4star','Show '+show,'Season 01');
    fs.mkdirSync(parent,{recursive:true});
    const file=path.join(parent,`Show ${show}.S01E0${episode}.mkv`),content=`show-${show}-episode-${episode}`;
    fs.writeFileSync(file,content);files.push({file,content});
  }
  const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  let runtimeError,release;
  barrier={eventId:null,released:new Promise(resolve=>{release=resolve;})};
  const host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,onExecutionRuntimeError:error=>{runtimeError=error;},mediaProbe:{async probe(readHandle){
    const body={resultKind:'probed',sourceHandleDigest:canonicalDigest(readHandle),durationMs:1000,
      videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null};
    return {...body,payloadDigest:canonicalDigest(body)};
  }}});
  const db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  const until=Date.now()+120000;
  async function waitFor(predicate, description) {
    while(Date.now()<until) {
      assert.ifError(runtimeError);
      const value=predicate();
      if(value) return value;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.fail('Timed out waiting for '+description);
  }
  try {
    const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),cookie=login.headers['set-cookie'];
    async function request(method,url,payload) {
      const response=await host.inject({method,url,headers:{cookie},payload});
      assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response;
    }
    const fieldId='continuity-field',policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},
      access={fieldId,revision:1,endpointId:'continuity-endpoint',rootLocation:source,mountScopeId:'continuity-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/category-access/v1'};
    await request('POST','/v1/admin/material-fields',{idempotencyKey:'continuity-register',fieldId,name:'Continuity fixture',contentProfileHint:'series',
      policy:{extractionPolicyId:'continuity-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,
        policyDigest:canonicalDigest({extractionPolicyId:'continuity-policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
    await request('POST','/v1/admin/material-fields/'+fieldId+'/actions/observe',{idempotencyKey:'continuity-observe',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:32});

    const blockedEvent=await waitFor(()=>barrier.eventId,'the first Acceptance Event');
    const blocked=db.prepare(`SELECT e.work_id,w.process_id,n.input_bindings_json FROM fx_workflow_events e
      JOIN fx_supporting_works w ON w.work_id=e.work_id JOIN fx_plan_nodes n ON n.plan_id=e.plan_id AND n.node_id=e.node_id
      WHERE e.event_id=?`).get(blockedEvent);
    const frozenHead=JSON.parse(blocked.input_bindings_json).bindings[0].parameters.continuityBasis.expectedContinuityHead.revision;
    const other=await waitFor(()=>db.prepare(`SELECT * FROM libra_handoff_a_receipts WHERE outcome='accepted' AND intake_decision_id<>? LIMIT 1`)
      .get(blocked.process_id),'another Subject to commit');
    const advancedHead=db.prepare('SELECT current_revision FROM libra_subject_continuity_heads').get().current_revision;
    assert.ok(advancedHead>frozenHead, 'Another Subject must advance the frozen global head');
    assert.equal(db.prepare('SELECT count(*) n FROM libra_intake_decisions WHERE intake_decision_id=?').get(blocked.process_id).n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM fx_event_result_bindings WHERE event_id=?').get(blockedEvent).n,0);
    assert.equal(db.prepare(`SELECT count(*) n FROM fx_effect_journal j JOIN fx_event_attempts a
      ON a.event_attempt_id=j.event_attempt_id WHERE a.event_id=?`).get(blockedEvent).n,0);
    release();

    await waitFor(()=>failedAttempts(db).some(row=>row.event_id===blockedEvent),'the stale Attempt');
    await waitFor(()=>db.prepare("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='accepted'").get().n===3,
      'all three Handoff A receipts to be consumed');
    const failures=await assertRecoveredIntakeFailures(db,{until,checkRuntime:()=>assert.ifError(runtimeError)});
    assert.ok(failures.some(row=>row.event_id===blockedEvent && row.failure_code==='P8_ACCEPTANCE_CONTINUITY_BASIS_STALE'));
    const works=db.prepare("SELECT work_id FROM fx_supporting_works WHERE owner_domain='libra' AND process_type='libra_intake' AND work_kind='acceptance'").all();
    assert.equal(works.length,3);
    const accepted=works.map(row=>assertAcceptedIntake(db,row.work_id));
    assert.equal(new Set(accepted.map(item=>item.decision.subject_id)).size,3);
    const recovered=accepted.find(item=>item.work.work_id===blocked.work_id);
    assert.notEqual(recovered.decision.subject_id,other.subject_id);
    assert.ok(recovered.decision.expected_continuity_head_revision>=advancedHead);
    const stale=failures.find(row=>row.event_id===blockedEvent);
    console.log('Continuity replan evidence: '+JSON.stringify({eventId:blockedEvent,workId:blocked.work_id,
      evidenceDigest:stale.evidence_digest,frozenHead,advancedHead,replannedHead:recovered.decision.expected_continuity_head_revision,
      staleWorkOrdinal:stale.work_ordinal,successfulWorkOrdinal:recovered.event.ordinal,
      subjectId:recovered.decision.subject_id,receiptId:recovered.decision.receipt_id}));
    for(const item of files) assert.equal(fs.readFileSync(item.file,'utf8'),item.content);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');

    // These negative checks ensure the gate does not turn the documented race
    // into a blanket allowance for hidden Effects, Results, or broken ownership.
    const check=database=>assertRecoveredIntakeFailures(database,{until:Date.now()+1000});
    await assert.rejects(check(overrideReads(db,'WHERE a.failure_code IS NOT NULL','all',rows=>
      rows.map((row,i)=>i ? row : {...row,failure_code:'UNEXPLAINED_FAILURE'}))),/Unexpected failed Event Attempt/);
    await assert.rejects(check(overrideReads(db,'SELECT count(*) AS n FROM fx_effect_journal j','get',()=>({n:1}))),/no Effect/);
    await assert.rejects(check(overrideReads(db,'SELECT count(*) AS n FROM fx_event_result_bindings WHERE event_id','get',()=>({n:1}))),/no Result/);
    await assert.rejects(check(overrideReads(db,'WHERE a.failure_code IS NOT NULL','all',rows=>
      rows.map((row,i)=>i ? row : {...row,work_state:'failed'}))),/did not recover/);
    await assert.rejects(check(overrideReads(db,"WHERE e.work_id=? AND e.capability_ref=? AND e.state='succeeded'",'all',rows=>
      rows.map(row=>({...row,ordinal:0})))),/later Work Attempt/);
    await assert.rejects(check(overrideReads(db,'SELECT material_key,subject_id,authority_kind FROM libra_material_bindings','all',rows=>
      rows.map((row,i)=>i ? row : {...row,subject_id:'wrong-subject'}))),/binding must belong/);
    await assert.rejects(check(overrideReads(db,'FROM fx_material_control_revisions WHERE commit_marker','all',rows=>rows.slice(1))),/transfer precisely/);
    await assert.rejects(check(overrideReads(db,'FROM proc_run_materials\n    WHERE candidate_package_id','all',rows=>rows.slice(1))),/complete Candidate selection/);
  } finally {
    release();barrier=null;
    await host.close();db.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
