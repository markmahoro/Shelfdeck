'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCatalogPlanProofReader}=require('../../src/helix/foundation/execution/catalog-plan-proof-reader');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));

test('large catalog proof retains every scoped Effect and marker in bounded transactional reads',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'helix-proof-batch-'));
  const databasePath=path.join(directory,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest});
  t.after(()=>{kernel.close();fs.rmSync(directory,{recursive:true,force:true});});
  const db=new Database(databasePath),expectedEffects=[],expectedMarkers=[];
  try {
    db.pragma('foreign_keys=ON');
    db.transaction(()=>{
      for(const scope of ['target','foreign','empty']) {
        db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain) VALUES (?,?)').run(scope,'libra');
        db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id) VALUES (?,?)').run(scope,scope);
        db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id) VALUES (?,?)').run(scope,scope);
        db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,work_id,attempt_id) VALUES (?,?,?,?)').run(scope,scope,scope,scope);
      }
      const insertAttempt=db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state) VALUES (?,?,?,?)');
      const insertEffect=db.prepare('INSERT INTO fx_effect_journal(effect_id,event_attempt_id,state) VALUES (?,?,?)');
      const insertMarker=db.prepare('INSERT INTO fx_commit_markers(commit_marker,effect_id) VALUES (?,?)');
      for(let ordinal=0;ordinal<1003;ordinal++) {
        const attempt='target-attempt-'+ordinal;insertAttempt.run(attempt,'target',ordinal,'completed');
        // Multiple Effects/markers must remain visible to the unchanged proof
        // validator; batching cannot quietly collapse invalid evidence.
        for(let variant=0;variant<(ordinal%100===0?2:1);variant++) {
          const effect=attempt+'-effect-'+variant;insertEffect.run(effect,attempt,'failed');expectedEffects.push(effect);
          for(let markerOrdinal=0;markerOrdinal<2;markerOrdinal++) {
            const marker=effect+'-marker-'+markerOrdinal;insertMarker.run(marker,effect);expectedMarkers.push(marker);
          }
        }
      }
      insertAttempt.run('foreign-attempt','foreign',0,'completed');
      insertEffect.run('foreign-effect','foreign-attempt','failed');insertMarker.run('foreign-marker','foreign-effect');
    })();
  }finally{db.close();}
  const base=createSqliteUnitOfWork({kernel}),reads=[];
  const unitOfWork={execute(participants){return base.execute(participants.map(participant=>({...participant,
    execute(context){return participant.execute({...context,repository(id){const repo=context.repository(id);return {
      invoke(statement,parameters){reads.push({statement,parameters});return repo.invoke(statement,parameters);},
    };}});},
  })));}};
  const reader=createCatalogPlanProofReader({schemaManifest,unitOfWork});
  const result=reader.verify(proof=>proof.read('target'));
  assert.equal(result.attempts.length,1003);
  assert.deepEqual(result.effects.map(row=>row.effect_id).sort(),expectedEffects.sort());
  assert.deepEqual(result.markers.map(row=>row.commit_marker).sort(),expectedMarkers.sort());
  const effects=reads.filter(read=>read.statement==='effects'),markers=reads.filter(read=>read.statement==='markers');
  assert.equal(effects.length,3);assert.equal(markers.length,3);
  assert.ok([...effects,...markers].every(read=>read.parameters.values.length<=500));
  reads.length=0;
  const empty=reader.verify(proof=>proof.read('empty'));
  assert.deepEqual(empty.effects,[]);assert.deepEqual(empty.markers,[]);
  assert.ok(!reads.some(read=>['effects','markers'].includes(read.statement)));
});
