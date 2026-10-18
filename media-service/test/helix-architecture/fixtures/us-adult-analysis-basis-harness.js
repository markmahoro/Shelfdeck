'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {buildSpaceAdmissionRequest,buildWorkspaceAdmissionDecision,workspaceId}=require('../../../src/helix/domains/libra/model/workspace-admission-contracts');
const {createWorkspaceAdmissionStore}=require('../../../src/helix/domains/libra/persistence/workspace-admission-store');
const generated=path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
const D=(value)=>canonicalDigest({fixture:value});
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-us-analysis-basis-'));
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

module.exports={fixture,schemaManifest,D,Database,createWorkspaceAdmissionStore};
