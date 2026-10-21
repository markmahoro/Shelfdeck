'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const {createFormationRunHistoryStore}=require('../../src/helix/domains/libra/persistence/formation-run-history-store');
const {createFormationQuery}=require('../../src/helix/domains/libra/application/formation-query');
const {createPreparationRecoveryAdmin}=require('../../src/helix/domains/libra/application/preparation-recovery-admin');

test('ended history merges immutable Run and no-Run pages across page boundaries',()=>{
  const runs=Array.from({length:205},(_,i)=>({receipt_id:'run-'+i,libra_run_id:'run-'+i,
    committed_run_state_revision:2,commit_digest:'digest',committed_at_ms:1000-i*2}));
  const abandoned=Array.from({length:103},(_,i)=>({receipt_id:'subject-'+i,subject_id:'subject-'+i,
    commit_digest:'digest',committed_at_ms:999-i*2}));
  const unitOfWork={execute(participants){return Object.fromEntries(participants.map(p=>[p.participantId,p.execute({repository:()=>({invoke(name,args){
    if(name==='discarded_page'||name==='abandoned_page')return Object.freeze((name==='discarded_page'?runs:abandoned).slice(args.offset,args.offset+args.limit));
    if(name==='runs')return args.values.map(id=>({libra_run_id:id,subject_id:id,state:'discarded',state_revision:2,state_digest:'state'}));
    if(name==='outcomes')return args.values.map(id=>({libra_run_id:id,outcome:'unable_to_on_deck',reason_code:'user_cancelled'}));
    throw Error(name);
  }})})]));}};
  const store=createFormationRunHistoryStore({schemaManifest,unitOfWork});
  const expected=[...runs,...abandoned].sort((a,b)=>b.committed_at_ms-a.committed_at_ms).map(r=>r.receipt_id);
  const actual=[];for(let offset=0;offset<expected.length;offset+=25)actual.push(...store.listDiscarded(offset,25).map(r=>r.historyId));
  assert.deepEqual(actual,expected);assert.equal(new Set(actual).size,308);
  assert.deepEqual(store.listDiscarded(308,25),[]);
});

test('unreceived tasks share workbench filters, pagination and summary without a fabricated Subject',()=>{
  const intake=Array.from({length:27},(_,i)=>({kind:'intake',formationViewId:'task-'+i,displayIdentity:'Movie '+i,
    classification:i===0?'in_progress':'attention_required',addedAtMs:100-i,targetShelfId:null,
    label:'接收材料失败',retryWorkId:'work-'+i}));
  const query=createFormationQuery({store:{listActiveScan:()=>[],counts:()=>[],listCompleted:()=>[]},
    readPipelineSubjectIds:()=>new Set(),readIntakeTasks:()=>intake});
  const first=query.list(),second=query.list({cursor:first.nextCursor});
  assert.equal(first.items.length,0);assert.equal(first.intakeItems.length,25);assert.equal(second.intakeItems.length,2);
  assert.equal(first.summary.totalCount,27);assert.equal(first.summary.attentionRequiredCount,26);
  assert.equal(first.summary.inProgressCount,1);
  assert.equal(query.list({classification:'in_progress'}).intakeItems[0].formationViewId,'task-0');
  assert.equal(query.list({q:'Movie 26'}).intakeItems[0].formationViewId,'task-26');
  assert.equal(query.list({shelfId:'shelf'}).intakeItems.length,0);
  assert.equal(query.list({expedited:'1'}).intakeItems.length,0);
  assert.equal(query.list({section:'ended'}).items.length,0);
  assert.equal(query.list({section:'completed'}).items.length,0);
  assert.ok(first.intakeItems.every(item=>!Object.hasOwn(item,'subjectId')));
});

test('preparation read uses current occupied scope and keeps retrying Intake visible until receipt',()=>{
  let state='failed',receipt=null,cancelled=false;
  const def={workId:'work',ownerDomain:'libra',processType:'libra_intake',processId:'process',workKind:'evidence',executionBasisDigest:'basis'};
  const reader={
    listWorks(scope){return scope.workKind==='evidence'?Object.freeze([{work_id:'work',created_at_ms:1}]):[];},
    readDefinition:id=>id==='work'?{definition:def}:null,
    status:()=>({state,latestAttempt:{failure_code:'EHOSTUNREACH'}}),
  };
  const admin=createPreparationRecoveryAdmin({schemaManifest,workResultReader:reader,
    unitOfWork:{execute:()=>({libra_preparation_recovery_subject:{subject:{status:'active'},projection:null,runs:[]}})},
    taskCancellations:{get:()=>cancelled?{state:'pending'}:null},
    pipelineAdmission:{listTokens:()=>[{subjectId:'future-subject',processId:'process',acquiredAtMs:10}]},
    intakeStore:{getReceipt:()=>receipt},offerReader:{read:()=>({snapshot:{candidatePackage:{displayIdentity:'Movie'}}})}});
  assert.equal(admin.readIntakeTasks()[0].retryWorkId,'work');
  state='running';const running=admin.readIntakeTasks()[0];
  assert.equal(running.formationViewId,'future-subject');assert.equal(running.classification,'in_progress');assert.equal(running.retryWorkId,null);
  receipt={};assert.deepEqual(admin.readIntakeTasks(),[]);
  def.processType='libra_routing';def.processId='subject';def.workKind='routing_basis';
  reader.listWorks=scope=>scope.workKind==='routing_basis'?Object.freeze([{work_id:'work',created_at_ms:1}]):[];
  state='failed';assert.equal(admin.readSubject('subject').workId,'work');
  cancelled=true;assert.equal(admin.readSubject('subject'),null);
});
