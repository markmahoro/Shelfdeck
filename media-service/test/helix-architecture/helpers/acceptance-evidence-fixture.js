'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const {canonicalDigest:D}=require('../../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {createAcceptanceCheckEvidenceStore}=require('../../../src/helix/domains/arca/persistence/acceptance-check-evidence-store');
const schemaManifest=require('../../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl=fs.readFileSync(path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
function fixture(capabilityRef,processId='offer',processType='arca_acceptance'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arca-check-evidence-')),databasePath=path.join(root,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  const db=new Database(databasePath);
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('work','arca',processType,processId,'acceptance_assessment',D('basis'),'normal','running','work-key',1,1);
  db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES(?,?,?,?,?,?)')
    .run('work-attempt','work',1,D('basis'),'running',1);
  db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('plan','work-attempt','fixture',1,D('catalog'),D('basis'),D('graph'),'planned',1);
  db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('event','plan','node','work','work-attempt','arca',capabilityRef,1,'executing','normal',1);
  db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,started_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('event-attempt','event',1,capabilityRef,1,'helix://test/input/v1',D('input'),D('fence'),'executing',1);
  const options={schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),contractValidator:createCapabilityContractValidator({schemas:[
    require('../../../src/helix/contracts/types/AcceptanceCheck/v1/schema.json'),
    require('../../../src/helix/contracts/types/AcceptanceCheckRecord/v1/schema.json'),
    require('../../../src/helix/contracts/types/StagedInventoryManifest/v1/schema.json'),
    require('../../../src/helix/contracts/types/StagedInventoryManifestRecord/v1/schema.json'),
    require('../../../src/helix/contracts/types/PhysicalMaterialIdentity/v2/schema.json'),
    require('../../../src/helix/contracts/application-types/ArcaMaterialEpisodeClaims/v1/schema.json')]})};
  const store=createAcceptanceCheckEvidenceStore(options);
  return {options,store,db,execution:{ownerScope:{processType,processId},workId:'work',eventId:'event',
    eventAttemptId:'event-attempt',capabilityRef,idempotencyKey:'check-key'},close(){db.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}};
}
module.exports={fixture};
