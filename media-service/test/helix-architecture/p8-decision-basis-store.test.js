'use strict';

const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');const Database=require('better-sqlite3');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');const {buildDecisionInputSet}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {createDecisionBasisStore,RESULT_SCHEMA}=require('../../src/helix/domains/libra/persistence/decision-basis-store');
const root=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated'),schemaDdl=fs.readFileSync(path.join(root,'clean-schema.sql'),'utf8'),schemaManifest=JSON.parse(fs.readFileSync(path.join(root,'clean-schema.manifest.json'),'utf8'));
const D=(value)=>canonicalDigest({value});function signed(value,field){const result={...value};result[field]=canonicalDigest(result);return result;}
function fixture(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'helix-p8-basis-')),databasePath=path.join(dir,'db.sqlite');let now=100;
  openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++}).close();const seed=new Database(databasePath);
  seed.prepare('INSERT INTO libra_intake_decisions (intake_decision_id,candidate_package_id,source_field_id,source_field_access_revision,source_field_context_digest,candidate_identity_claim_digest) VALUES (?,?,?,?,?,?)').run('intake-1','candidate-1','field-1',1,D('field'),D('claim'));
  seed.prepare('INSERT INTO libra_subjects (subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest,current_identity_revision) VALUES (?,?,?,?,?,?,?,?,?)').run('subject-1','single','movie','intake-1','active',1,D('continuity'),D('episodes'),null);
  const expression={nodeKind:'always'},policy={routingPolicyId:'policy-1',revision:1,fieldId:'field-1',mode:'direct',targets:[{shelfId:'shelf-1',rank:1,matchExpression:expression,matchRuleDigest:canonicalDigest(expression)}]};policy.policyDigest=canonicalDigest(policy);
  seed.prepare('INSERT INTO libra_routing_policy_revisions VALUES (?,?,?,?,?,?,?,?)').run('policy-1',1,'field-1','direct','FieldRoutingPolicySnapshot@1',canonicalJson(policy),policy.policyDigest,1);
  seed.prepare('INSERT INTO libra_routing_policy_targets VALUES (?,?,?,?,?,?,?)').run('policy-1',1,'shelf-1',1,'RoutingMatchExpression@1',canonicalJson(expression),canonicalDigest(expression));
  seed.prepare('INSERT INTO libra_field_routing_heads VALUES (?,?,?,?)').run('field-1','policy-1',1,1);seed.close();
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++}),unitOfWork=createSqliteUnitOfWork({kernel});try{return run({databasePath,unitOfWork,policy});}finally{kernel.close();fs.rmSync(dir,{recursive:true,force:true});}}
function input(policy){const snapshot=signed({subjectId:'subject-1',status:'active',intakeRevision:1,structureKind:'single',contentProfile:'movie',routingAnchorIntakeDecisionId:'intake-1',
  routingProvenance:{candidatePackageId:'candidate-1',sourceFieldId:'field-1',sourceFieldAccessRevision:1,sourceFieldContextDigest:D('field'),candidateIdentityClaimDigest:D('claim')},
  currentIdentityRevision:null,currentIdentityDigest:null,continuitySetDigest:D('continuity'),episodeScopeDigest:D('episodes')},'snapshotDigest');
  const authority=signed({authorityKind:'policy',policy},'authorityDigest'),projection=signed({shelfId:'shelf-1',status:'active',routingProjectionRevision:1,currentStandardRevision:1,currentStandardDigest:D('standard')},'projectionDigest');
  return buildDecisionInputSet({basisKind:'routing',subjectSnapshot:snapshot,expectedDecisionHead:{revision:0,digest:null,currentRoutingDecisionId:null,currentDecisionBasisId:null,currentAcceptanceSpecId:null},
    readiness:{result:'ready'},routingAuthoritySnapshot:authority,shelfRoutingTargets:[projection],routingDecision:null,shelfStandardProjection:null,productScope:null,decisionFacts:[],queryResults:[]});}
function request(set,marker='basis-marker'){return {decisionInputSet:set,domainFactCommitHandle:{schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:'basis-handle',ownerDomain:'libra',aggregateType:'subject_decision_basis',aggregateId:'subject-1',factType:'decision_basis',factSchemaRef:'libra.decision-basis@1',
  expectedRevision:0,payloadDigest:canonicalDigest(set),resultSchemaRef:RESULT_SCHEMA,commitIdempotencyKey:'basis-key',eventFenceDigest:D('fence')},commitMarker:marker,resultId:'result-'+marker};}

test('atomically commits complete Basis inputs, head, Result and marker and replays',()=>fixture(({databasePath,unitOfWork,policy})=>{const set=input(policy),store=createDecisionBasisStore({schemaManifest,unitOfWork});
  const first=store.commit(request(set)),second=store.commit(request(set));assert.equal(first.replayed,false);assert.equal(second.replayed,true);assert.equal(first.result.decisionBasisId,second.result.decisionBasisId);
  const db=new Database(databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_decision_basis_revisions').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_decision_basis_inputs').get().n,3);
  const head=db.prepare('SELECT * FROM libra_subject_decision_heads').get();assert.equal(head.head_revision,1);assert.equal(head.current_decision_basis_id,first.result.decisionBasisId);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_commit_markers').get().n,1);db.close();}));

test('stale Subject snapshot or Policy head rolls back every participant',()=>fixture(({databasePath,unitOfWork,policy})=>{const set=input(policy),db=new Database(databasePath);db.prepare('UPDATE libra_routing_policy_revisions SET policy_digest=? WHERE routing_policy_id=?').run(D('stale'),'policy-1');db.close();
  assert.throws(()=>createDecisionBasisStore({schemaManifest,unitOfWork}).commit(request(set)),/Routing Policy snapshot/);const check=new Database(databasePath,{readonly:true});for(const table of ['libra_decision_basis_revisions','libra_decision_basis_inputs','libra_subject_decision_heads','fx_event_result_bindings','fx_commit_markers'])assert.equal(check.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);check.close();}));
