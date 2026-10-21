'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createProcurementFieldStatusQuery}=require('../../src/helix/domains/procurement/application/field-procurement-status-query');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'))),schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');

test('current oversized source scope is visible before any package exists and disappears after policy repair',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-selection-capacity-')),databasePath=path.join(root,'test.db');
 const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl}),unitOfWork=createSqliteUnitOfWork({kernel}),db=new Database(databasePath);
 try{
   db.pragma('foreign_keys=OFF');
   db.prepare("INSERT INTO proc_material_fields (field_id,status,current_access_revision,current_profile_hint_revision,current_observation_revision,extraction_policy_revision) VALUES ('field','active',1,1,1,1)").run();
   db.prepare("INSERT INTO proc_field_access_revisions (field_id,revision,root_location) VALUES ('field',1,'/source')").run();
   db.prepare("INSERT INTO proc_field_profile_hint_revisions (field_id,revision,content_profile_hint) VALUES ('field',1,'movie')").run();
   db.prepare("INSERT INTO proc_field_observations (field_id,revision,observation_id,field_observation_work_id,page_ordinal,completed,observed_at_ms) VALUES ('field',1,'observation','scan',0,1,1)").run();
   const insert=db.prepare("INSERT INTO proc_field_materials (field_id,material_key,current_location,last_observation_id,eligibility_state,eligibility_field_status,eligibility_policy_revision) VALUES ('field',?,?,'observation','eligible','active',1)");
   db.transaction(()=>{for(let i=0;i<1025;i++)insert.run('material-'+i,'/source/Big Disc/BDMV/STREAM/'+i+'.m2ts');})();
   const query=createProcurementFieldStatusQuery({schemaManifest,unitOfWork});
   const failed=query.read('field');assert.equal(failed.generatedPackageCount,0);assert.equal(failed.selectionIssues.total,1);
   assert.equal(failed.selectionIssues.items[0].memberCount,1025);assert.equal(failed.selectionIssues.items[0].location,'Big Disc');
   db.prepare("UPDATE proc_field_materials SET eligibility_state='ineligible' WHERE material_key='material-0'").run();
   assert.deepEqual(query.read('field').selectionIssues,{total:0,items:[]});
   db.prepare("UPDATE proc_field_materials SET eligibility_state='eligible',last_observation_id='old' WHERE material_key='material-0'").run();
   assert.equal(query.read('field').selectionIssues.total,0,'an old observation cannot create a current failure');
   assert.equal(db.prepare('SELECT count(*) n FROM proc_procurement_runs').get().n,0,'GET never starts or fabricates a Run');
 }finally{db.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});
