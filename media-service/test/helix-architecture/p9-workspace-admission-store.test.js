'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {buildSpaceAdmissionRequest,buildWorkspaceAdmissionDecision,workspaceId}=require('../../src/helix/domains/libra/model/workspace-admission-contracts');
const {createWorkspaceAdmissionStore}=require('../../src/helix/domains/libra/persistence/workspace-admission-store');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
const D=(value)=>canonicalDigest({fixture:value});
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p9-workspace-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const now = 1700000000000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now });
  try {
    const libraRunId = 'run-1';
    const executionBasisDigest = D('basis');
    const stateDigest = D('run-state');
    const rootId = 'workspace-root-1';
    const capabilityDigest = D('capability');
    const rootHandleRef = canonicalDigest({ schema:'platform.workspace-root-handle@1', rootId,
      endpointId:'endpoint-1', mountScopeId:'mount-1', mountScopeRevision:1, configRevision:1, capabilityDigest });
    const snapshotBasis = { rootId, ownerScope:'libra', rootKind:'production-workspace', endpointId:'endpoint-1',
      mountScopeId:'mount-1', mountScopeRevision:1, configRevision:1, capabilityDigest, state:'active', rootHandleRef };
    const snapshot = { ...snapshotBasis, snapshotDigest:canonicalDigest(snapshotBasis) };
    const id = workspaceId(libraRunId);
    const request = buildSpaceAdmissionRequest({ workspaceId:id, libraRunId, executionBasisDigest, rootId,
      rootSnapshotDigest:snapshot.snapshotDigest, inputPrimaryTotalBytes:100, requiredFreeBytes:5368709240 });
    const observedAtMs = now - 1000;
    const evidenceBasis = { evidenceId:canonicalDigest({ schema:'platform.workspace-space-admission-evidence-id@1',
      requestDigest:request.requestDigest, rootSnapshotDigest:snapshot.snapshotDigest, observedAtMs }),
      authorityRef:'platform.workspace-space-admission@1', requestDigest:request.requestDigest, workspaceId:id,
      libraRunId, rootId, rootSnapshotDigest:snapshot.snapshotDigest, requiredBytes:request.requiredFreeBytes,
      availableBytes:request.requiredFreeBytes+1, observedAtMs, expiresAtMs:observedAtMs+30000, result:'admitted' };
    const evidence = { ...evidenceBasis, evidenceDigest:canonicalDigest(evidenceBasis) };
    const decision = buildWorkspaceAdmissionDecision({ libraRunRef:{libraRunId,stateRevision:1,stateDigest,executionBasisDigest},
      workspaceId:id, platformWorkspaceRootSnapshot:snapshot, spaceAdmissionEvidence:evidence });
    const memberSetDigest = D('member-set');
    const manifestDigest = D('manifest');
    const executionBasisRecord = { productionMaterialManifestRef:{ manifestId:'manifest-1', memberCount:1,
      memberSetDigest, manifestDigest } };
    const seed = new Database(databasePath);
    seed.pragma('foreign_keys = OFF');
    seed.prepare('INSERT INTO libra_runs (libra_run_id,run_material_manifest_id,execution_basis_record_json,execution_basis_digest,state,state_revision,state_digest,package_revision_head,recovery_attempt_ordinal) VALUES (?,?,?,?,?,?,?,0,0)').run(libraRunId,'manifest-1',JSON.stringify(executionBasisRecord),executionBasisDigest,'active',1,stateDigest);
    seed.prepare('INSERT INTO libra_run_revisions (libra_run_id,state_revision,state,execution_basis_digest,expected_admission_head_revision,revision_digest) VALUES (?,?,?,?,?,?)').run(libraRunId,1,'active',executionBasisDigest,0,D('run-revision'));
    seed.prepare('INSERT INTO libra_run_material_manifests (run_material_manifest_id,libra_run_id,manifest_role,manifest_revision,member_count,member_set_digest,manifest_digest) VALUES (?,?,?,?,?,?,?)').run('manifest-1',libraRunId,'run_input',1,1,memberSetDigest,manifestDigest);
    seed.prepare('INSERT INTO libra_run_material_members (run_material_manifest_id,ordinal,material_key,role,size_bytes,member_digest) VALUES (?,?,?,?,?,?)').run('manifest-1',0,'material-1','primary_payload',100,D('member'));
    seed.prepare('INSERT INTO platform_workspace_roots (root_id,owner_scope,root_kind,endpoint_id,mount_scope_id,mount_scope_revision,resolved_root,config_revision,capability_digest,state,root_handle_ref,snapshot_digest,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(rootId,'libra','production-workspace','endpoint-1','mount-1',1,'C:\\internal-only',1,capabilityDigest,'active',rootHandleRef,snapshot.snapshotDigest,now);
    seed.close();
    return run({ databasePath, kernel, unitOfWork:createSqliteUnitOfWork({kernel}), decision, id });
  } finally {
    kernel.close();
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}
test('admits one pathless Workspace, Registry, revision, Result, and marker atomically with replay',()=>fixture((input)=>{const store=createWorkspaceAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork}),request={decision:input.decision,commitMarker:'workspace-marker',resultId:'workspace-result'},first=store.admit(request),replay=store.admit(request);assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);const db=new Database(input.databasePath,{readonly:true}),workspace=db.prepare('SELECT * FROM libra_workspaces').get();assert.equal(workspace.workspace_id,input.id);assert.equal(workspace.current_revision,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_workspace_revisions').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_workspace_registry').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_event_result_bindings').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_commit_markers').get().n,1);assert.equal(workspace.space_admission_evidence_json.includes('internal-only'),false);db.close();}));
test('rolls every Workspace admission row back when the Foundation participant crashes',()=>fixture((input)=>{const crashing={execute(participants){return input.unitOfWork.execute(participants.map((participant)=>participant.participantId!=='workspace_admission_foundation'?participant:{...participant,execute(context){participant.execute(context);throw new Error('fixture-crash');}}));}},store=createWorkspaceAdmissionStore({schemaManifest,unitOfWork:crashing});assert.throws(()=>store.admit({decision:input.decision,commitMarker:'workspace-crash-marker',resultId:'workspace-crash-result'}),/fixture-crash/);const db=new Database(input.databasePath,{readonly:true});for(const table of ['libra_workspaces','libra_workspace_revisions','fx_workspace_registry','fx_event_result_bindings','fx_commit_markers'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);db.close();}));
test('rejects expired Evidence and stale Platform root without partial writes',()=>fixture((input)=>{const expired={...input.decision,spaceAdmissionEvidence:{...input.decision.spaceAdmissionEvidence,expiresAtMs:1}},store=createWorkspaceAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork});expired.spaceAdmissionEvidence.evidenceDigest=canonicalDigest(Object.fromEntries(Object.entries(expired.spaceAdmissionEvidence).filter(([key])=>key!=='evidenceDigest')));const rebuilt=buildWorkspaceAdmissionDecision({...expired,decisionId:undefined,workspaceScopeDigest:undefined,decisionDigest:undefined});assert.throws(()=>store.admit({decision:rebuilt,commitMarker:'expired-marker',resultId:'expired-result'}),(error)=>error.code==='P9_WORKSPACE_SPACE_NOT_ADMITTED');const db=new Database(input.databasePath);db.prepare("UPDATE platform_workspace_roots SET state='inactive'").run();db.close();assert.throws(()=>store.admit({decision:input.decision,commitMarker:'stale-marker',resultId:'stale-result'}),(error)=>error.code==='P9_WORKSPACE_ROOT_SCOPE'||error.code==='P9_WORKSPACE_ROOT_STALE');}));
