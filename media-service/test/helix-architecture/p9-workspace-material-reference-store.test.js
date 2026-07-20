'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {buildReferenceDecision,referenceSetDigest,workspaceStateDigest}=require('../../src/helix/domains/libra/model/workspace-material-reference-contracts');
const {createWorkspaceMaterialReferenceStore}=require('../../src/helix/domains/libra/persistence/workspace-material-reference-store');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
const D=(value)=>canonicalDigest({fixture:value});

function createHandle() {
  const workspaceId=D('workspace'),materialKey=canonicalDigest({schema:'physical-material-identity@1',mountScopeId:'mount-1',inode:'42',contentHashAlgorithm:'sha256',contentHash:D('content')}),
    basis={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:'',workspaceId,ownerDomain:'libra',processId:'run-1',endpointId:'endpoint-1',materialKey,
      physicalIdentity:{mountScopeId:'mount-1',inode:'42',contentHashAlgorithm:'sha256',contentHash:D('content')},rootHandleRef:'root-handle-1',relativePath:'output/movie.mkv',digestAlgorithm:'sha256',digestHex:D('content'),sizeBytes:100,referenceRevision:1,accessScope:'workspace_material_read',fenceDigest:''};
  basis.handleId=canonicalDigest({schema:'foundation.workspace-material-handle-id@1',workspaceId,materialKey,relativePath:basis.relativePath,referenceRevision:1});
  basis.fenceDigest=canonicalDigest({schema:'foundation.workspace-material-handle-fence@1',handleId:basis.handleId,workspaceId,ownerDomain:'libra',processId:'run-1',endpointId:'endpoint-1',materialKey,physicalIdentity:basis.physicalIdentity,rootHandleRef:basis.rootHandleRef,relativePath:basis.relativePath,digestAlgorithm:'sha256',digestHex:basis.digestHex,sizeBytes:100,referenceRevision:1,accessScope:'workspace_material_read'});
  return basis;
}

function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-p9-reference-')),databasePath=path.join(root,'shelfdeck.db'),now=1700000000000,
    kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now}),unitOfWork=createSqliteUnitOfWork({kernel}),handle=createHandle();
  try {
    const emptySet=referenceSetDigest(handle.workspaceId,[]),state={workspaceId:handle.workspaceId,workspaceRevision:1,state:'active',workspaceMaterialReferenceSetDigest:emptySet,transitionKind:'admitted',transitionEvidenceDigest:D('admission')};
    state.stateDigest=workspaceStateDigest(state);
    const db=new Database(databasePath);db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO libra_runs (libra_run_id,state,state_revision,state_digest,package_revision_head) VALUES (?,?,?,?,0)').run('run-1','active',1,D('run-state'));
    db.prepare('INSERT INTO libra_run_revisions (libra_run_id,state_revision,state,expected_admission_head_revision,revision_digest) VALUES (?,?,?,?,?)').run('run-1',1,'active',0,D('run-revision'));
    db.prepare('INSERT INTO libra_workspaces (workspace_id,libra_run_id,platform_workspace_endpoint_id,platform_workspace_mount_scope_id,root_handle_ref,current_revision,state,state_digest) VALUES (?,?,?,?,?,?,?,?)').run(handle.workspaceId,'run-1','endpoint-1','mount-1','root-handle-1',1,'active',state.stateDigest);
    db.prepare('INSERT INTO libra_workspace_revisions (workspace_id,workspace_revision,state,material_reference_set_digest,transition_kind,transition_evidence_digest,previous_revision,revision_digest,committed_at_ms) VALUES (?,?,?,?,?,?,?,?,?)').run(handle.workspaceId,1,'active',emptySet,'admitted',D('admission'),null,D('workspace-revision'),now);
    db.prepare('INSERT INTO fx_workspace_materials (workspace_id,material_handle_id,material_key,endpoint_id,mount_scope_id,inode,content_hash_algorithm,content_hash,relative_path,digest_algorithm,digest_hex,size_bytes,reference_revision,owner_domain,process_id,root_handle_ref,access_scope,handle_schema_ref,handle_json,handle_digest,fence_digest,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(handle.workspaceId,handle.handleId,handle.materialKey,handle.endpointId,handle.physicalIdentity.mountScopeId,handle.physicalIdentity.inode,'sha256',handle.physicalIdentity.contentHash,handle.relativePath,'sha256',handle.digestHex,handle.sizeBytes,1,'libra','run-1',handle.rootHandleRef,handle.accessScope,handle.schemaRef,canonicalJson(handle),canonicalDigest(handle),handle.fenceDigest,'active');
    db.close();
    return run({databasePath,kernel,unitOfWork,handle,state});
  } finally {kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
}

function attachDecision(input) {
  return buildReferenceDecision({operation:'attach_working',libraRunId:'run-1',workspaceId:input.handle.workspaceId,expectedWorkspaceRevision:1,
    expectedWorkspaceStateDigest:input.state.stateDigest,expectedReference:{state:'absent',revision:0,digest:canonicalDigest({schema:'libra.workspace-reference-absent@1',workspaceId:input.handle.workspaceId,materialHandleId:input.handle.handleId})},
    workspaceMaterialHandle:input.handle,episodeClaims:[],episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),productVerificationRef:null});
}

function verification(handle) {
  const value={schemaRef:'helix://contracts/types/ProductMediaVerification/v1',schemaVersion:1,verificationId:'',verificationKind:'libra_product_media',basisDigest:D('verification-basis'),result:'passed',reasonCodes:[],evidenceRefs:['probe-1'],verifiedAtMs:1700000000000,
    libraRunId:'run-1',producingEventId:'event-1',workspaceMediaHandleId:'workspace-media-1',workspaceMaterialHandleId:handle.handleId,
    workspaceMaterialHandleDigest:canonicalDigest(handle),workspaceMaterialFenceDigest:handle.fenceDigest,mediaRequirementDigest:D('requirement'),probeEvidenceDigest:D('probe'),
    qualitySummary:{schemaRef:'quality@1',schemaVersion:1,recordKind:'quality-summary',recordDigest:D('quality'),entries:[]},spaceSummary:{schemaRef:'space@1',schemaVersion:1,recordKind:'space-summary',recordDigest:D('space'),entries:[]}};
  value.verificationId=canonicalDigest({schema:'libra.product-media-verification-id@1',libraRunId:'run-1',workspaceMaterialHandleId:handle.handleId,workspaceMaterialFenceDigest:handle.fenceDigest,mediaRequirementDigest:value.mediaRequirementDigest,probeEvidenceDigest:value.probeEvidenceDigest});
  return {schemaRef:'ProductMediaVerification@1',verificationId:value.verificationId,verificationValue:value,verificationDigest:canonicalDigest(value)};
}

test('attaches, replays, and promotes one immutable Workspace Reference without moving bytes',()=>fixture((input)=>{
  const store=createWorkspaceMaterialReferenceStore({schemaManifest,unitOfWork:input.unitOfWork}),attach=attachDecision(input),first=store.commit({decision:attach,commitMarker:'attach-marker',resultId:'attach-result'}),replay=store.commit({decision:attach,commitMarker:'attach-marker',resultId:'attach-result'});
  assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);assert.equal(first.result.referenceSnapshot.state,'working');
  const promote=buildReferenceDecision({operation:'promote_to_product_staging',libraRunId:'run-1',workspaceId:input.handle.workspaceId,expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:first.result.workspaceStateDigest,
    expectedReference:{state:'present',revision:1,digest:first.result.referenceSnapshot.referenceDigest},workspaceMaterialHandle:input.handle,episodeClaims:[],episodeScopeDigest:first.result.referenceSnapshot.episodeScopeDigest,productVerificationRef:verification(input.handle)}),second=store.commit({decision:promote,commitMarker:'promote-marker',resultId:'promote-result'});
  assert.equal(second.result.referenceSnapshot.state,'product_staging');assert.equal(second.result.referenceSnapshot.referenceRevision,2);assert.equal(second.result.workspaceRevision,3);
  const db=new Database(input.databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_workspace_material_refs').get().n,2);assert.equal(db.prepare('SELECT current_revision FROM libra_workspaces').get().current_revision,3);assert.equal(db.prepare('SELECT state FROM fx_workspace_materials').get().state,'active');db.close();
}));

test('rolls Reference, Workspace revision, CAS, Result, and marker back on a crash',()=>fixture((input)=>{
  const crashing={execute(participants){return input.unitOfWork.execute(participants.map((participant)=>participant.participantId!=='workspace_reference_finish'?participant:{...participant,execute(){throw new Error('fixture-crash');}}));}},store=createWorkspaceMaterialReferenceStore({schemaManifest,unitOfWork:crashing});
  assert.throws(()=>store.commit({decision:attachDecision(input),commitMarker:'crash-marker',resultId:'crash-result'}),/fixture-crash/);
  const db=new Database(input.databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_workspace_material_refs').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_workspace_revisions').get().n,1);assert.equal(db.prepare('SELECT current_revision FROM libra_workspaces').get().current_revision,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_event_result_bindings').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_commit_markers').get().n,0);db.close();
}));

test('rejects forged Handle and cross-Handle Product Verification',()=>fixture((input)=>{
  const forged={...input.handle,fenceDigest:D('forged')};assert.throws(()=>buildReferenceDecision({...attachDecision(input),workspaceMaterialHandle:forged,decisionId:undefined,decisionDigest:undefined}),(error)=>error.code==='P9_REFERENCE_HANDLE');
  const other={...verification(input.handle),verificationValue:{...verification(input.handle).verificationValue,workspaceMaterialHandleId:D('other')}};other.verificationDigest=canonicalDigest(other.verificationValue);
  assert.throws(()=>buildReferenceDecision({operation:'promote_to_product_staging',libraRunId:'run-1',workspaceId:input.handle.workspaceId,expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('state'),expectedReference:{state:'present',revision:1,digest:D('reference')},workspaceMaterialHandle:input.handle,episodeClaims:[],episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),productVerificationRef:other}),(error)=>error.code==='P9_REFERENCE_VERIFICATION');
}));
