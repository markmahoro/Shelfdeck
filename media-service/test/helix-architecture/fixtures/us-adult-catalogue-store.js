'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {fixture:inputFixture,contractValidator,D}=require('./us-adult-catalogue-basis');
const {canonicalJson,canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {buildResolvedProductIdentity}=require('../../../src/helix/domains/libra/model/product-fact-contracts');
const {buildCatalogueAnalysisBasis}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-analysis-basis');
const {originalNameProvenance}=require('../../../src/helix/contracts/us-adult-presentation');
const generated=path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated'),
  schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json')));
function fixture(t){
  const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'us-catalogue-store-')),databasePath=path.join(root,'shelfdeck.db'),
    kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>1700000000000}),db=new Database(databasePath),args=inputFixture(),
    identity=buildResolvedProductIdentity({subjectId:'subject',contentProfile:'western_adult',structureKind:'single',identityKind:'internal_identity',
      producerRef:'libra.product_identity.resolve@1',basisDigest:D('identity-basis'),observedAtMs:1,
      providerIdentities:[{provider:'internal',namespace:'internal_identity',providerKey:'us-adult:'+canonicalDigest({schema:'libra.us-adult-subject-identity@1',subjectId:'subject'})}],
      displayEntries:[{key:'title',value:'Source'},{key:'original_file_name',value:'Source.mp4'},
        {key:'original_file_name_digest',value:originalNameProvenance('Source.mp4').provenanceDigest}]});
  t.after(()=>{db.close();kernel.close();assert.equal(path.dirname(root),parent);fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
  db.pragma('foreign_keys = ON');db.exec('BEGIN');
  db.prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision) VALUES(?,?,?,?,?)').run('subject','single','western_adult','active',1);
  db.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,run_material_manifest_id,execution_basis_record_json,execution_basis_digest,state,state_revision,state_digest,package_revision_head,recovery_attempt_ordinal) VALUES(?,?,?,?,?,?,?,?,0,0)')
    .run('run','subject','manifest',canonicalJson({}),args.snapshot.run.executionBasisDigest,'active',2,D('state'));
  db.prepare('INSERT INTO libra_run_material_manifests(run_material_manifest_id,libra_run_id,manifest_role,manifest_revision,member_count,member_set_digest,manifest_digest) VALUES(?,?,?,?,?,?,?)')
    .run('manifest','run','run_input',1,1,D('members'),D('manifest'));
  db.prepare('INSERT INTO libra_workspaces(workspace_id,libra_run_id,state,current_revision,state_digest) VALUES(?,?,?,?,?)').run('workspace','run','active',1,D('workspace'));
  db.prepare('INSERT INTO libra_workspace_revisions(workspace_id,workspace_revision,state,material_reference_set_digest,transition_kind,transition_evidence_digest,previous_revision,revision_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('workspace',1,'active',D('workspace-members'),'admitted',D('workspace-admission'),null,D('workspace-revision'),1);
  db.prepare('INSERT INTO libra_product_fact_revisions(product_fact_id,libra_run_id,fact_kind,fact_revision,schema_ref,fact_json,fact_digest,result_digest) VALUES(?,?,?,?,?,?,?,?)')
    .run('identity-fact','run','resolved_identity',1,identity.schemaRef,canonicalJson(identity),identity.identityDigest,canonicalDigest(identity));
  db.exec('COMMIT');args.snapshot.resolvedIdentityDigest=identity.identityDigest;
  return {root,databasePath,db,args,identity,basis:buildCatalogueAnalysisBasis(args),options:{schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),contractValidator}};
}
module.exports=Object.freeze({fixture,schemaManifest,schemaDdl,contractValidator,Database});
