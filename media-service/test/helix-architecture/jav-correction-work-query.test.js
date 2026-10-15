'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createJavCorrectionWorkStore}=require('../../src/helix/domains/arca/persistence/jav-correction-work-store');
const {projectArcaProcess}=require('../../src/helix/domains/arca/application/aftercare-process-projection');

test('independent correction pages conserve every phase, bounded pagination and filter-bound cursors',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-correction-work-query-')),generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated'),
    schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),
    kernel=openSqliteKernel({Database,databasePath:path.join(root,'test.db'),schemaManifest,schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')}),seed=new Database(path.join(root,'test.db'));
  try{
    seed.pragma('foreign_keys = OFF');
    const entry=seed.prepare('INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,current_inventory_revision) VALUES (?,?,1)'),
      metadata=seed.prepare('INSERT INTO arca_inventory_product_facts(shelf_entry_id,inventory_revision,fact_kind,fact_json) VALUES (?,1,?,?)'),
      insert=seed.prepare('INSERT INTO arca_jav_identity_corrections(correction_id,shelf_entry_id,preview_proof_json,state,state_revision,created_at_ms,updated_at_ms,terminal_at_ms,terminal_evidence_digest,committed_context_schema_ref,committed_context_json,committed_context_digest,cleanup_state,cleanup_receipt_schema_ref,cleanup_receipt_json,cleanup_receipt_digest) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?)'),
      phases=[['admitted',null],['active',null],['attention_required',null],['committed','pending'],['committed','active'],['committed','attention_required'],['committed','completed'],['cancelled',null]],digest='a'.repeat(64);
    for(let i=0;i<80;i++){
      const [state,cleanup]=phases[i%phases.length],committed=state==='committed',terminal=committed||state==='cancelled',complete=cleanup==='completed',id='correction-'+String(i).padStart(3,'0');
      entry.run('entry-'+i,i%2?'shelf-b':'shelf-a');metadata.run('entry-'+i,'product_metadata',JSON.stringify({descriptiveFacts:{entries:[{key:'title',value:'Film '+i}]}}));
      insert.run(id,'entry-'+i,'{}',state,1+i,100+i,terminal?100+i:null,terminal?digest:null,
        committed?'helix://contracts/application-types/ArcaJavCorrectionCommittedContext/v1':null,committed?'{}':null,committed?digest:null,cleanup,
        complete?'helix://contracts/application-types/ArcaJavCorrectionCleanupReceipt/v1':null,complete?'{}':null,complete?digest:null);
    }
    const store=createJavCorrectionWorkStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})}),seen=[];let cursor;
    do{const page=store.list({limit:7,cursor});assert.ok(page.items.length<=7);assert.deepEqual(page.counts,{in_progress:40,attention_required:20,completed:10,ended:10});
      seen.push(...page.items);cursor=page.nextCursor;}while(cursor);
    assert.equal(seen.length,80);assert.equal(new Set(seen.map(r=>r.correctionId)).size,80);
    assert.ok(seen.slice(0,60).every(row=>['in_progress','attention_required'].includes(row.classification)));
    assert.ok(seen.slice(60).every(row=>['completed','ended'].includes(row.classification)));
    assert.equal(store.list({q:'Film 79',shelfId:'shelf-b'}).items[0].correctionId,'correction-079');
    assert.equal(store.list({q:'Film 79',shelfId:'shelf-a'}).items.length,0);
    assert.equal(store.list({correctionId:'correction-006'}).items[0].classification,'completed');
    assert.equal(store.list({classification:'attention_required',limit:50}).items.length,20);
    assert.equal(store.list({classification:'terminal',limit:50}).items.length,20);
    const first=store.list({limit:3});assert.throws(()=>store.list({cursor:first.nextCursor,q:'changed'}),{code:'ARCA_JAV_CORRECTION_PAGE_INVALID'});
    assert.throws(()=>store.list({cursor:'not-json'}),{code:'ARCA_JAV_CORRECTION_PAGE_INVALID'});
    assert.throws(()=>store.list({limit:1000}),{code:'ARCA_JAV_CORRECTION_PAGE_INVALID'});
    assert.equal(seed.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,0);
  }finally{seed.close();kernel.close();const resolved=path.resolve(root);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('jav-correction-work-query-'));fs.rmSync(resolved,{recursive:true,force:true});}
});

test('correction process details retain real Foundation event identities and execution order',()=>{
  const work={workId:'correction-work',workKind:'jav_correction_assets',state:'failed',createdAtMs:1,
    plans:[{planId:'actual-plan',createdAtMs:2,edges:[{fromNodeId:'source',toNodeId:'assets'}]}],
    events:[{eventId:'actual-assets',planId:'actual-plan',nodeId:'assets',capabilityRef:'assets',state:'cancelled'},
      {eventId:'actual-source',planId:'actual-plan',nodeId:'source',capabilityRef:'source',state:'failed',failure:{failureCode:'SOURCE_CHANGED'}}]};
  const detail=projectArcaProcess([work],100,{contract:'jav_correction_process_actual_plans@1',workLabels:{jav_correction_assets:['assets','准备纠正资料','准备纠正资料']},capabilityLabels:{source:'核验来源',assets:'准备资料'}});
  assert.equal(detail.stages[0].state,'attention');const plan=detail.stages[0].plans[0];assert.equal(plan.planId,'actual-plan');
  assert.deepEqual(plan.nodes.map(node=>node.nodeId),['source','assets']);assert.equal(plan.nodes[0].technicalDetail.fields[0].value,'actual-source');
  assert.equal(plan.nodes[0].state,'failed');assert.equal(plan.nodes[1].state,'cancelled');
});
