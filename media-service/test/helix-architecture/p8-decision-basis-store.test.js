'use strict';

const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');const Database=require('better-sqlite3');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');const {buildDecisionInputSet}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {createDecisionBasisStore,RESULT_SCHEMA}=require('../../src/helix/domains/libra/persistence/decision-basis-store');
const {createRoutingDecisionStore}=require('../../src/helix/domains/libra/persistence/routing-decision-store');
const {createAcceptanceSpecStore}=require('../../src/helix/domains/libra/persistence/acceptance-spec-store');
const {decisionHeadDigest}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {buildRoutingDecision,resolveRoutingAssessment}=require('../../src/helix/domains/libra/model/routing-contracts');
const {buildProductScope}=require('../../src/helix/domains/libra/model/acceptance-spec-contracts');
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
  const authority=signed({authorityKind:'policy',policy},'authorityDigest'),projectionValue={shelfId:'shelf-1',status:'active',routingProjectionRevision:1,currentStandardRevision:1,currentStandardDigest:D('standard')},
    projection={...projectionValue,projectionDigest:canonicalDigest({schema:'arca.shelf-routing-target-projection@1',...projectionValue})};
  const expectedDecisionHead={subjectId:'subject-1',headState:'absent',headRevision:0,headDigest:null,currentRoutingDecisionId:null,currentDecisionBasisId:null,currentAcceptanceSpecId:null};
  expectedDecisionHead.snapshotDigest=canonicalDigest({schema:'libra.subject-decision-head-snapshot@1',...expectedDecisionHead});
  return buildDecisionInputSet({basisKind:'routing',subjectSnapshot:snapshot,expectedDecisionHead,
    readiness:{result:'ready'},routingAuthoritySnapshot:authority,shelfRoutingTargets:[projection],routingDecision:null,shelfStandardProjection:null,productScope:null,decisionFacts:[],queryResults:[]});}
function request(set,marker='basis-marker'){return {decisionInputSet:set,domainFactCommitHandle:{schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:'basis-handle',ownerDomain:'libra',aggregateType:'subject_decision_basis',aggregateId:'subject-1',factType:'decision_basis',factSchemaRef:'libra.decision-basis@1',
  expectedRevision:set.expectedDecisionHead.headRevision,payloadDigest:canonicalDigest(set),resultSchemaRef:RESULT_SCHEMA,commitIdempotencyKey:'basis-key-'+marker,eventFenceDigest:D('fence')},commitMarker:marker,resultId:'result-'+marker};}

function headSnapshot(revision,routingId,basisId,specId=null){const value={subjectId:'subject-1',headState:'present',headRevision:revision,
  headDigest:decisionHeadDigest('subject-1',revision,routingId,basisId,specId),currentRoutingDecisionId:routingId,currentDecisionBasisId:basisId,currentAcceptanceSpecId:specId};
  value.snapshotDigest=canonicalDigest({schema:'libra.subject-decision-head-snapshot@1',...value});return value;}
function requirements(){return {identity:{identityKind:'tmdb_movie',requiredProvider:'tmdb',requireSeasonNumber:false},structure:{structureKind:'single',primaryModel:'single_primary',requireOnePrimaryPerEpisode:false},
  metadata:{requiredFieldCodes:['title'],requiredArtifactKinds:['nfo'],requireRenderableSidecar:true,requireDecodableImages:true},mandatoryMedia:{mediaForm:'stream_file',videoCodec:'any',container:'any',fileExtension:'any',minimumRasterClass:'none',acceptedPrimaryAudioClasses:[],forbidSystemUpscaleFor4k:true},
  space:{unit:'product',maxSizeGiB:null,maxSizeBytes:null},inventory:{requireDomainBinding:true,requireChecksum:true,requiredMaterializedArtifactKinds:['nfo'],layoutModel:'single'}};}
function standardProjection(){const profile=signed({contentProfile:'movie',decisionInputKinds:[],baseRequirements:requirements(),decisionBranches:[]},'profileRuleSetDigest'),
  standard=signed({shelfId:'shelf-1',standardRevision:1,ruleTemplateId:'template-1',ruleTemplateRevision:1,profileRuleSets:[profile]},'standardDigest'),routeValue={shelfId:'shelf-1',status:'active',routingProjectionRevision:1,currentStandardRevision:1,currentStandardDigest:standard.standardDigest},
  route={...routeValue,projectionDigest:canonicalDigest({schema:'arca.shelf-routing-target-projection@1',...routeValue})};return signed({shelfId:'shelf-1',status:'active',routingProjectionRevision:1,projectionDigest:route.projectionDigest,standard},'projectionResultDigest');}

test('atomically commits complete Basis inputs, head, Result and marker and replays after Head advances',()=>fixture(({databasePath,unitOfWork,policy})=>{const set=input(policy),store=createDecisionBasisStore({schemaManifest,unitOfWork});
  const first=store.commit(request(set)),second=store.commit(request(set,'basis-marker-2')),third=store.commit(request(set));assert.equal(first.replayed,false);assert.equal(second.replayed,true);assert.equal(third.replayed,true);assert.equal(first.result.decisionBasisId,second.result.decisionBasisId);
  const db=new Database(databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_decision_basis_revisions').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_decision_basis_inputs').get().n,4);
  const basis=db.prepare('SELECT * FROM libra_decision_basis_revisions').get(),snapshot=db.prepare("SELECT * FROM libra_decision_basis_inputs WHERE input_kind='decision_head_snapshot'").get();
  assert.equal(basis.expected_head_revision,0);assert.equal(basis.expected_head_snapshot_digest,snapshot.input_digest);assert.equal(snapshot.input_ordinal,1);
  const head=db.prepare('SELECT * FROM libra_subject_decision_heads').get();assert.equal(head.head_revision,1);assert.equal(head.current_decision_basis_id,first.result.decisionBasisId);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_commit_markers').get().n,2);db.close();}));

test('semantic replay fails closed when frozen Head Snapshot relation is corrupt',()=>fixture(({databasePath,unitOfWork,policy})=>{const set=input(policy),store=createDecisionBasisStore({schemaManifest,unitOfWork});store.commit(request(set));
  const db=new Database(databasePath);db.prepare("UPDATE libra_decision_basis_inputs SET input_digest=? WHERE input_kind='decision_head_snapshot'").run(D('corrupt-head'));db.close();
  assert.throws(()=>store.commit(request(set,'basis-marker-corrupt')),(error)=>error.code==='P8_DECISION_BASIS_INPUT_INTEGRITY');
  const check=new Database(databasePath,{readonly:true});assert.equal(check.prepare("SELECT COUNT(*) n FROM fx_commit_markers WHERE commit_marker='basis-marker-corrupt'").get().n,0);check.close();}));

test('stale Subject snapshot or Policy head rolls back every participant',()=>fixture(({databasePath,unitOfWork,policy})=>{const set=input(policy),db=new Database(databasePath);db.prepare('UPDATE libra_routing_policy_revisions SET policy_digest=? WHERE routing_policy_id=?').run(D('stale'),'policy-1');db.close();
  assert.throws(()=>createDecisionBasisStore({schemaManifest,unitOfWork}).commit(request(set)),/Routing Policy snapshot/);const check=new Database(databasePath,{readonly:true});for(const table of ['libra_decision_basis_revisions','libra_decision_basis_inputs','libra_subject_decision_heads','fx_event_result_bindings','fx_commit_markers'])assert.equal(check.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);check.close();}));

test('atomically commits Routing Assessment, Decision, Head, Result and marker',()=>fixture(({databasePath,unitOfWork,policy})=>{const set=input(policy),basis=createDecisionBasisStore({schemaManifest,unitOfWork}).commit(request(set)).result;
  const store=createRoutingDecisionStore({schemaManifest,unitOfWork}),first=store.commit({decisionInputSet:set,decisionBasis:basis,commitMarker:'routing-marker-1',resultId:'routing-result-1'}),
    second=store.commit({decisionInputSet:set,decisionBasis:basis,commitMarker:'routing-marker-2',resultId:'routing-result-2'});
  assert.equal(first.replayed,false);assert.equal(second.replayed,true);assert.equal(first.result.routingDecisionId,second.result.routingDecisionId);assert.equal(first.result.committedHeadRevision,2);
  const db=new Database(databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_routing_assessments').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_routing_decisions').get().n,1);
  const head=db.prepare('SELECT * FROM libra_subject_decision_heads').get();assert.equal(head.head_revision,2);assert.equal(head.current_routing_decision_id,first.result.routingDecisionId);assert.equal(db.prepare("SELECT COUNT(*) n FROM fx_commit_markers WHERE scope_type='routing_decision'").get().n,2);db.close();}));

test('stale Routing Basis post-state rolls back the entire Routing transaction',()=>fixture(({databasePath,unitOfWork,policy})=>{const set=input(policy),basis=createDecisionBasisStore({schemaManifest,unitOfWork}).commit(request(set)).result;
  const db=new Database(databasePath);db.prepare('UPDATE libra_subject_decision_heads SET head_revision=9').run();db.close();
  assert.throws(()=>createRoutingDecisionStore({schemaManifest,unitOfWork}).commit({decisionInputSet:set,decisionBasis:basis,commitMarker:'routing-stale',resultId:'routing-stale-result'}),(error)=>error.code==='P8_ROUTING_HEAD_CAS');
  const check=new Database(databasePath,{readonly:true});for(const table of ['libra_routing_assessments','libra_routing_decisions'])assert.equal(check.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);assert.equal(check.prepare("SELECT COUNT(*) n FROM fx_commit_markers WHERE commit_marker='routing-stale'").get().n,0);check.close();}));

test('publishes Acceptance Spec atomically from the exact H2 to H4 chain',()=>fixture(({databasePath,unitOfWork,policy})=>{const routingSet=input(policy),basisStore=createDecisionBasisStore({schemaManifest,unitOfWork}),routingBasis=basisStore.commit(request(routingSet)).result,
  assessment=resolveRoutingAssessment({...routingSet,decisionBasisId:routingBasis.decisionBasisId}),routingDecision=buildRoutingDecision(assessment,1);
  createRoutingDecisionStore({schemaManifest,unitOfWork}).commit({decisionInputSet:routingSet,decisionBasis:routingBasis,expectedDecisionDigest:routingDecision.decisionDigest,commitMarker:'routing-for-spec',resultId:'routing-for-spec-result'});
  const specSet=buildDecisionInputSet({basisKind:'acceptance_spec',subjectSnapshot:routingSet.subjectSnapshot,expectedDecisionHead:headSnapshot(2,routingDecision.routingDecisionId,routingBasis.decisionBasisId),readiness:{result:'ready'},
    routingAuthoritySnapshot:null,shelfRoutingTargets:[],routingDecision,shelfStandardProjection:standardProjection(),productScope:buildProductScope(routingSet.subjectSnapshot,[]),decisionFacts:[],queryResults:[]}),
    specBasis=basisStore.commit(request(specSet,'spec-basis-marker')).result,store=createAcceptanceSpecStore({schemaManifest,unitOfWork}),
    first=store.publish({decisionInputSet:specSet,decisionBasis:specBasis,producedAtMs:500,commitMarker:'spec-marker-1',resultId:'spec-result-1'}),
    second=store.publish({decisionInputSet:specSet,decisionBasis:specBasis,producedAtMs:500,commitMarker:'spec-marker-2',resultId:'spec-result-2'});
  assert.equal(first.replayed,false);assert.equal(second.replayed,true);assert.equal(first.result.acceptanceSpecId,second.result.acceptanceSpecId);assert.equal(first.result.committedHeadRevision,4);
  const db=new Database(databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_acceptance_specs').get().n,1);const head=db.prepare('SELECT * FROM libra_subject_decision_heads').get();assert.equal(head.head_revision,4);assert.equal(head.current_acceptance_spec_id,first.result.acceptanceSpecId);assert.equal(db.prepare("SELECT COUNT(*) n FROM fx_commit_markers WHERE scope_type='acceptance_spec'").get().n,2);db.close();}));
