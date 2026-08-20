'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { buildFormationProjectionRow, createFormationQuery } = require('../src/helix/domains/libra/application/formation-query');
const { createFormationProjectionStore } = require('../src/helix/domains/libra/persistence/formation-projection-store');
const { createFormationProjectionHost } = require('../src/helix/domains/libra/application/formation-projection-host');

const generatedRoot=path.resolve(__dirname,'../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generatedRoot,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generatedRoot,'clean-schema.manifest.json'),'utf8'));
const hex=(value)=>String(value).padStart(64,'0').slice(-64);
function item(index,classification='waiting',attention=false){return Object.freeze({
  formationViewId:`subject-${String(index).padStart(3,'0')}`,subjectId:`subject-${String(index).padStart(3,'0')}`,
  displayIdentity:`影片 ${index}`,contentProfile:'movie',structureKind:'single',status:'active',classification,
  myRating:index%5+1,myRatingSource:'douban',myRatingRevision:null,productIdentityIssue:attention?Object.freeze({result:'ambiguous',reasonCode:'multiple_matches',candidateSetDigest:hex(700+index),candidates:[]}):null,
  targetShelfId:'shelf-1',targetShelfName:'movie test',routingState:'resolved',unresolvedReasonCode:null,routingPolicyMode:'direct',routingPolicyRevision:1,
  routingDecisionRevision:1,routingDecisionDigest:hex(100+index),routingDecisionHeadRevision:1,routingDecisionHeadDigest:hex(200+index),
  acceptanceSpecId:`spec-${index}`,acceptanceSpecRevision:1,acceptanceSpecDigest:hex(300+index),acceptanceSpecPublishedAtMs:1000+index,
  primaryMaterialCount:1,addedAtMs:1000+index,organizingRequirement:'保持原媒体并完成资料',organizingAction:'直接采用并验证',
  nextAction:Object.freeze({label:classification==='completed'?'等待收藏架接收':'继续整理媒体',state:classification==='completed'?'completed':'pending',progress:null}),
  currentRun:Object.freeze({libraRunId:`run-${index}`,state:'active',stateRevision:1,stateDigest:hex(400+index),priorityClass:'normal',packageRevisionHead:classification==='completed'?1:0,currentIdentityRevision:1}),
  handoffB:classification==='completed'?Object.freeze({onDeckPackageId:`package-${index}`,offerId:`offer-${index}`,packageRevision:1,packageDigest:hex(500+index),state:'published',publishedAtMs:2000+index}):null,
});}

test('durable Formation projection pages 25 active rows, sorts attention first, and no-ops unchanged basis',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-projection-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>{
      prepare('CREATE TEMP TABLE formation_projection_update_probe(update_count INTEGER NOT NULL)').run();
      prepare('INSERT INTO formation_projection_update_probe(update_count) VALUES(0)').run();
      prepare('CREATE TEMP TRIGGER formation_projection_update_probe_trigger AFTER UPDATE ON main.libra_formation_projections BEGIN UPDATE formation_projection_update_probe SET update_count=update_count+1; END').run();
    });
    kernel.runPrimitive(({prepare})=>{const insert=prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`);
      for(let index=0;index<31;index+=1)insert.run(`subject-${String(index).padStart(3,'0')}`,'single','movie',null,'active',1,null,1000+index,1000+index);});
    const unitOfWork=createSqliteUnitOfWork({kernel}),store=createFormationProjectionStore({schemaManifest,unitOfWork});
    for(let index=0;index<31;index+=1)store.upsert(buildFormationProjectionRow(item(index,index===30?'completed':'waiting',index===29),3000+index));
    const unchanged=store.upsert(buildFormationProjectionRow(item(0),3000));assert.equal(unchanged.kind,'no_op');assert.equal(unchanged.revision,1);
    assert.equal(kernel.runPrimitive(({prepare})=>prepare('SELECT update_count FROM formation_projection_update_probe').get().update_count),0);
    const query=createFormationQuery({store,now:()=>4000,state:()=>({status:'ready',asOfMs:3999})}),active=query.list({section:'active',limit:25});
    assert.equal(active.items.length,25);assert.equal(active.items[0].subjectId,'subject-029');assert.ok(active.nextCursor);
    assert.deepEqual(active.summary,{totalCount:31,waitingCount:30,inProgressCount:0,completedCount:1});assert.deepEqual(active.projection,{status:'ready',asOfMs:3999});
    const remainder=query.list({section:'active',limit:25,cursor:active.nextCursor});assert.equal(remainder.items.length,5);
    const completed=query.list({section:'completed',limit:25});assert.equal(completed.items.length,1);assert.equal(completed.items[0].subjectId,'subject-030');
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('exact Formation wake drains more than one bounded batch without waiting for fallback',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-projection-host-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  const unitOfWork=createSqliteUnitOfWork({kernel}),ids=Array.from({length:101},(_,index)=>`subject-${String(index).padStart(3,'0')}`),processed=[],batchSizes=[];
  const source={
    readPage:()=>[],
    readSubject:(subjectId)=>ids.includes(subjectId)?{subject_id:subjectId}:null,
    buildBatch:(subjects)=>{batchSizes.push(subjects.length);return subjects.map(({subject_id:subjectId})=>({
      formationViewId:subjectId,subjectId,displayIdentity:subjectId,contentProfile:'movie',structureKind:'single',status:'active',classification:'waiting',
      myRating:null,myRatingSource:null,myRatingRevision:null,productIdentityIssue:null,targetShelfId:null,targetShelfName:null,
      routingState:'preparing',unresolvedReasonCode:null,routingPolicyMode:null,routingPolicyRevision:null,routingDecisionRevision:null,
      routingDecisionDigest:null,routingDecisionHeadRevision:null,routingDecisionHeadDigest:null,acceptanceSpecId:null,
      acceptanceSpecRevision:null,acceptanceSpecDigest:null,primaryMaterialCount:0,
      addedAtMs:0,organizingRequirement:'保持原媒体并完成资料',organizingAction:'尚未形成整理动作',
      nextAction:{label:'等待处理',state:'pending',progress:null},currentRun:null,handoffB:null,
    }));},
  };
  const store={upsert:(row)=>{processed.push(row.subject_id);return {kind:'inserted',revision:1};}},errors=[];
  const host=createFormationProjectionHost({schemaManifest,unitOfWork,source,store,now:()=>100,onError:(error)=>errors.push(error)});
  try{
    await host.start();
    ids.forEach((subjectId)=>host.enqueue(subjectId));
    const deadline=Date.now()+2000;
    while(processed.length<ids.length&&Date.now()<deadline)await new Promise((resolve)=>setTimeout(resolve,5));
    assert.equal(processed.length,ids.length,errors.map((error)=>`${error.code||error.name}: ${error.message} ${JSON.stringify(error.details||{})}`).join('\n'));
    assert.equal(new Set(processed).size,ids.length);
    assert.deepEqual(batchSizes.sort((left,right)=>left-right),[1,100]);
    assert.equal(host.state().queued,0);
  }finally{await host.stop();kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});
