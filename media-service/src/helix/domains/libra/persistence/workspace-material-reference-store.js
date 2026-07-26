'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { buildReferenceDecision, buildReferenceSnapshot, referenceSetDigest, workspaceStateDigest } =
  require('../model/workspace-material-reference-contracts');

const DECISION_SCHEMA = 'helix://contracts/application-types/LibraWorkspaceMaterialReferenceDecision/v1';
const RESULT_SCHEMA = 'helix://contracts/application-types/LibraWorkspaceMaterialReferenceResult/v1';
const HANDLE_SCHEMA = 'helix://contracts/types/WorkspaceMaterialHandle/v1';
const CLAIMS_SCHEMA = 'helix://contracts/application-types/LibraWorkspaceEpisodeClaims/v1';
const VERIFICATION_SCHEMA = 'helix://contracts/application-types/WorkspaceProductVerificationSnapshot/v1';

class WorkspaceMaterialReferenceStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'WorkspaceMaterialReferenceStoreError'; this.code = code; }
}
const fail = (code, message) => { throw new WorkspaceMaterialReferenceStoreError(code, message); };

function libraDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'libra_workspace_material_reference', owner:'libra', schemaManifest, statements:{
    find_run:{ kind:'select-one', tableId:'libra_runs', columns:['libra_run_id','state','state_revision','state_digest'], keyColumns:['libra_run_id'], safeIntegers:true },
    find_run_revision:{ kind:'select-one', tableId:'libra_run_revisions', columns:['libra_run_id','state_revision','state','revision_digest'], keyColumns:['libra_run_id','state_revision'], safeIntegers:true },
    find_workspace:{ kind:'select-one', tableId:'libra_workspaces', columns:['workspace_id','libra_run_id','platform_workspace_endpoint_id','platform_workspace_mount_scope_id','root_handle_ref','current_revision','state','state_digest'], keyColumns:['workspace_id'], safeIntegers:true },
    find_workspace_revision:{ kind:'select-one', tableId:'libra_workspace_revisions', columns:['workspace_id','workspace_revision','state','material_reference_set_digest','transition_kind','transition_evidence_digest','previous_revision','revision_digest'], keyColumns:['workspace_id','workspace_revision'], safeIntegers:true },
    list_references:{ kind:'select-all', tableId:'libra_workspace_material_refs', columns:['workspace_id','libra_run_id','reference_id','material_handle_id','material_key','workspace_handle_schema_ref','workspace_handle_json','workspace_handle_digest','reference_revision','reference_state','episode_claims_schema_ref','episode_claims_json','episode_scope_digest','product_verification_schema_ref','product_verification_id','product_verification_json','product_verification_digest','previous_reference_revision','committed_workspace_revision','reference_digest'], keyColumns:['workspace_id'], safeIntegers:true },
    find_reference_revision:{ kind:'select-one', tableId:'libra_workspace_material_refs', columns:['workspace_id','libra_run_id','reference_id','material_handle_id','material_key','workspace_handle_schema_ref','workspace_handle_json','workspace_handle_digest','reference_revision','reference_state','episode_claims_schema_ref','episode_claims_json','episode_scope_digest','product_verification_schema_ref','product_verification_id','product_verification_json','product_verification_digest','previous_reference_revision','committed_workspace_revision','reference_digest'], keyColumns:['reference_id','reference_revision'], safeIntegers:true },
    insert_reference:{ kind:'insert', tableId:'libra_workspace_material_refs', columns:['workspace_id','libra_run_id','reference_id','material_handle_id','material_key','workspace_handle_schema_ref','workspace_handle_json','workspace_handle_digest','reference_revision','reference_state','episode_claims_schema_ref','episode_claims_json','episode_scope_digest','product_verification_schema_ref','product_verification_id','product_verification_json','product_verification_digest','previous_reference_revision','committed_workspace_revision','reference_digest','committed_at_ms'] },
    insert_workspace_revision:{ kind:'insert', tableId:'libra_workspace_revisions', columns:['workspace_id','workspace_revision','state','material_reference_set_digest','transition_kind','transition_evidence_digest','previous_revision','revision_digest','committed_at_ms'] },
    update_workspace:{ kind:'update', tableId:'libra_workspaces', setColumns:['current_revision','state','state_digest'], keyColumns:['workspace_id'], compareColumns:[{column:'current_revision',parameter:'expected_current_revision'},{column:'state_digest',parameter:'expected_state_digest'}] }
  }});
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'workspace_material_reference_foundation', owner:'execution-foundation', schemaManifest, statements:{
    find_material:{ kind:'select-one', tableId:'fx_workspace_materials', columns:['workspace_id','material_handle_id','material_key','endpoint_id','mount_scope_id','inode','content_hash_algorithm','content_hash','relative_path','digest_algorithm','digest_hex','size_bytes','reference_revision','owner_domain','process_id','root_handle_ref','access_scope','handle_schema_ref','handle_json','handle_digest','fence_digest','state'], keyColumns:['workspace_id','material_handle_id'], safeIntegers:true },
    find_artifact:{ kind:'select-one', tableId:'fx_artifact_registry', columns:['artifact_handle_id','artifact_kind','owner_domain','owner_scope_type','owner_scope_id','storage_ref','digest_algorithm','digest_hex','size_bytes','media_type','provenance_ref','reference_revision','state'], keyColumns:['artifact_handle_id'], safeIntegers:true },
    find_marker:{ kind:'select-one', tableId:'fx_commit_markers', columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest'], keyColumns:['commit_marker'] },
    find_result:{ kind:'select-one', tableId:'fx_event_result_bindings', columns:['result_id','result_json','result_digest'], keyColumns:['result_id'] },
    insert_result:{ kind:'insert', tableId:'fx_event_result_bindings', columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'] },
    insert_marker:{ kind:'insert', tableId:'fx_commit_markers', columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'] }
  }});
}

function rowSnapshot(row) {
  let handle, claims, verification;
  try {
    handle = JSON.parse(row.workspace_handle_json);
    claims = JSON.parse(row.episode_claims_json);
    verification = row.product_verification_json === null ? null : JSON.parse(row.product_verification_json);
  } catch { fail('P9_REFERENCE_OWNER_CORRUPT', 'Reference JSON is corrupt.'); }
  const snapshot = buildReferenceSnapshot({ workspaceId:row.workspace_id, libraRunId:row.libra_run_id,
    workspaceMaterialHandle:handle, referenceRevision:Number(row.reference_revision), state:row.reference_state,
    episodeClaims:claims, episodeScopeDigest:row.episode_scope_digest, productVerificationRef:verification,
    previousReferenceRevision:row.previous_reference_revision === null ? null : Number(row.previous_reference_revision),
    committedWorkspaceRevision:Number(row.committed_workspace_revision) });
  const verificationColumnsValid = verification === null
    ? row.product_verification_schema_ref === null && row.product_verification_id === null && row.product_verification_digest === null
    : row.product_verification_schema_ref === VERIFICATION_SCHEMA && row.product_verification_id === verification.verificationId &&
      row.product_verification_digest === verification.snapshotDigest;
  if (row.workspace_handle_schema_ref !== HANDLE_SCHEMA || row.episode_claims_schema_ref !== CLAIMS_SCHEMA ||
      row.workspace_handle_digest !== snapshot.workspaceHandleDigest || row.reference_id !== snapshot.referenceId ||
      row.material_handle_id !== snapshot.materialHandleId || row.material_key !== snapshot.materialKey ||
      row.reference_digest !== snapshot.referenceDigest || !verificationColumnsValid)
    fail('P9_REFERENCE_OWNER_CORRUPT', 'Reference owner-row continuity is broken.');
  return snapshot;
}

function currentSnapshots(rows) {
  const current = new Map();
  for (const row of rows) {
    const snapshot = rowSnapshot(row), existing = current.get(snapshot.referenceId);
    if (!existing || snapshot.referenceRevision > existing.referenceRevision) current.set(snapshot.referenceId, snapshot);
  }
  return [...current.values()];
}

function verifyFoundationMaterial(row, decision, workspace) {
  const handle = decision.workspaceMaterialHandle;
  if (!row) fail('P9_REFERENCE_MATERIAL_MISSING', 'Foundation Workspace Material is absent.');
  let stored;
  try { stored = JSON.parse(row.handle_json); } catch { fail('P9_REFERENCE_MATERIAL_CORRUPT', 'Foundation Handle JSON is corrupt.'); }
  const exact = row.workspace_id === handle.workspaceId && row.material_handle_id === handle.handleId &&
    row.material_key === handle.materialKey && row.endpoint_id === handle.endpointId && row.mount_scope_id === handle.physicalIdentity.mountScopeId &&
    row.inode === handle.physicalIdentity.inode && row.content_hash_algorithm === handle.physicalIdentity.contentHashAlgorithm &&
    row.content_hash === handle.physicalIdentity.contentHash && row.relative_path === handle.relativePath &&
    row.digest_algorithm === handle.digestAlgorithm && row.digest_hex === handle.digestHex && Number(row.size_bytes) === handle.sizeBytes &&
    Number(row.reference_revision) === handle.referenceRevision && row.owner_domain === handle.ownerDomain && row.process_id === handle.processId &&
    row.root_handle_ref === handle.rootHandleRef && row.access_scope === handle.accessScope && row.handle_schema_ref === HANDLE_SCHEMA &&
    canonicalJson(stored) === canonicalJson(handle) && row.handle_digest === canonicalDigest(handle) && row.fence_digest === handle.fenceDigest &&
    row.state === 'active' && workspace.platform_workspace_endpoint_id === handle.endpointId &&
    workspace.platform_workspace_mount_scope_id === handle.physicalIdentity.mountScopeId && workspace.root_handle_ref === handle.rootHandleRef;
  if (!exact) fail('P9_REFERENCE_MATERIAL_CORRUPT', 'Foundation Handle and hot columns do not match the Decision.');
}

function verifyFoundationArtifact(row, decision) {
  if (decision.productVerificationRef?.verificationKind !== 'artifact') {
    if (row !== null && row !== undefined) fail('P9_REFERENCE_ARTIFACT_SCOPE', 'Artifact Registry was read for a non-artifact branch.');
    return;
  }
  if (!row) fail('P9_REFERENCE_ARTIFACT_MISSING', 'Artifact Registry Handle is absent.');
  let provenanceRef;
  try { provenanceRef=JSON.parse(row.provenance_ref); } catch {
    fail('P9_REFERENCE_ARTIFACT_CORRUPT', 'Artifact Registry provenance is corrupt.');
  }
  const stored={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,
    artifactHandleId:row.artifact_handle_id,artifactKind:row.artifact_kind,ownerDomain:row.owner_domain,
    ownerScope:{scopeType:row.owner_scope_type,scopeId:row.owner_scope_id},storageRef:row.storage_ref,
    digestAlgorithm:row.digest_algorithm,digestHex:row.digest_hex,sizeBytes:Number(row.size_bytes),mediaType:row.media_type,
    provenanceRef,referenceRevision:Number(row.reference_revision)};
  if (row.state !== 'active' || canonicalJson(stored) !== canonicalJson(decision.productVerificationRef.artifactHandle) ||
      stored.digestAlgorithm !== decision.workspaceMaterialHandle.digestAlgorithm ||
      stored.digestHex !== decision.workspaceMaterialHandle.digestHex ||
      stored.sizeBytes !== decision.workspaceMaterialHandle.sizeBytes)
    fail('P9_REFERENCE_ARTIFACT_CORRUPT', 'Artifact Registry Handle does not match the immutable Snapshot and Workspace bytes.');
}

function createWorkspaceMaterialReferenceStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) fail('P9_REFERENCE_STORE_DEPENDENCIES', 'Schema manifest and Unit of Work are required.');
  const libra = libraDefinition(options.schemaManifest), foundation = foundationDefinition(options.schemaManifest);
  return Object.freeze({ repositoryManifest:Object.freeze({ libraTableIds:libra.tableIds, foundationTableIds:foundation.tableIds }),
    commit(request) {
      const decision = buildReferenceDecision(request?.decision), marker = request?.commitMarker, resultId = request?.resultId;
      if (typeof marker !== 'string' || !marker || typeof resultId !== 'string' || !resultId)
        fail('P9_REFERENCE_COMMIT_INPUT', 'Commit marker and Result identity are required.');
      let replay = null, result = null;
      const preflight = { participantId:'workspace_reference_preflight', owner:'execution-foundation', boundBusinessOwner:'libra', repositories:[foundation], execute(context) {
        const repo=context.repository(foundation.repositoryId), found=repo.invoke('find_marker',{commit_marker:marker});
        if (!found) return;
        if (found.owner_domain !== 'libra' || found.scope_type !== 'libra_workspace_reference' ||
            found.scope_id !== decision.workspaceId || found.commit_digest !== decision.decisionDigest || found.result_schema_ref !== RESULT_SCHEMA)
          fail('P9_REFERENCE_MARKER_CONFLICT', 'Commit marker belongs to another Reference Decision.');
        const stored=repo.invoke('find_result',{result_id:found.result_id});
        if (!stored || stored.result_digest !== found.result_digest) fail('P9_REFERENCE_REPLAY_CORRUPT', 'Stored Result is absent.');
        try { replay=JSON.parse(stored.result_json); } catch { fail('P9_REFERENCE_REPLAY_CORRUPT', 'Stored Result JSON is corrupt.'); }
        if (canonicalDigest(replay) !== stored.result_digest) fail('P9_REFERENCE_REPLAY_CORRUPT', 'Stored Result digest is corrupt.');
      }};
      const foundationRead = { participantId:'workspace_reference_material_read', owner:'execution-foundation', boundBusinessOwner:'libra', repositories:[foundation], execute(context) {
        if (replay) return;
        const repo=context.repository(foundation.repositoryId),
          row=repo.invoke('find_material',{workspace_id:decision.workspaceId,material_handle_id:decision.workspaceMaterialHandle.handleId});
        foundationRead.row=row;
        foundationRead.artifactRow=decision.productVerificationRef?.verificationKind==='artifact'
          ?repo.invoke('find_artifact',{artifact_handle_id:decision.productVerificationRef.artifactHandle.artifactHandleId}):null;
      }};
      const apply = { participantId:'workspace_reference_domain', owner:'libra', repositories:[libra], execute(context) {
        const repo=context.repository(libra.repositoryId);
        if (replay) {
          const reference=replay.referenceSnapshot, ownerRow=repo.invoke('find_reference_revision',{reference_id:reference.referenceId,reference_revision:reference.referenceRevision}),
            workspaceRevision=repo.invoke('find_workspace_revision',{workspace_id:replay.workspaceId,workspace_revision:replay.workspaceRevision});
          if (!ownerRow || rowSnapshot(ownerRow).referenceDigest !== reference.referenceDigest || !workspaceRevision ||
              workspaceRevision.material_reference_set_digest !== replay.workspaceMaterialReferenceSetDigest ||
              workspaceRevision.transition_evidence_digest !== decision.decisionDigest || replay.resultDigest !== canonicalDigest(Object.fromEntries(Object.entries(replay).filter(([key])=>key!=='resultDigest'))))
            fail('P9_REFERENCE_REPLAY_CORRUPT', 'Owner rows cannot rebuild the stored Result.');
          return;
        }
        const run=repo.invoke('find_run',{libra_run_id:decision.libraRunId}), workspace=repo.invoke('find_workspace',{workspace_id:decision.workspaceId});
        if (!run || run.state !== 'active' || !workspace || workspace.libra_run_id !== run.libra_run_id || workspace.state !== 'active' ||
            Number(workspace.current_revision) !== decision.expectedWorkspaceRevision || workspace.state_digest !== decision.expectedWorkspaceStateDigest)
          fail('P9_REFERENCE_STALE', 'Run or Workspace current fence is stale.');
        const runRevision=repo.invoke('find_run_revision',{libra_run_id:run.libra_run_id,state_revision:Number(run.state_revision)}),
          workspaceRevision=repo.invoke('find_workspace_revision',{workspace_id:workspace.workspace_id,workspace_revision:Number(workspace.current_revision)});
        if (!runRevision || runRevision.state !== 'active' || !workspaceRevision || workspaceRevision.state !== 'active')
          fail('P9_REFERENCE_OWNER_CORRUPT', 'Run or Workspace revision continuity is broken.');
        verifyFoundationMaterial(foundationRead.row,decision,workspace);
        verifyFoundationArtifact(foundationRead.artifactRow,decision);
        const snapshots=currentSnapshots(repo.invoke('list_references',{workspace_id:workspace.workspace_id})),
          current=snapshots.find((item)=>item.referenceId===canonicalDigest({schema:'libra.workspace-reference-id@1',workspaceId:workspace.workspace_id,materialHandleId:decision.workspaceMaterialHandle.handleId}));
        if (referenceSetDigest(workspace.workspace_id,snapshots)!==workspaceRevision.material_reference_set_digest ||
            workspaceStateDigest({workspaceId:workspace.workspace_id,workspaceRevision:Number(workspaceRevision.workspace_revision),state:workspaceRevision.state,
              workspaceMaterialReferenceSetDigest:workspaceRevision.material_reference_set_digest,transitionKind:workspaceRevision.transition_kind,
              transitionEvidenceDigest:workspaceRevision.transition_evidence_digest})!==workspace.state_digest)
          fail('P9_REFERENCE_OWNER_CORRUPT','Workspace current Reference set is corrupt.');
        if (decision.operation==='attach_working' && current) fail('P9_REFERENCE_STALE','Expected absent Reference is present.');
        if (decision.operation==='promote_to_product_staging' && (!current || current.state!=='working' ||
            current.referenceRevision!==decision.expectedReference.revision || current.referenceDigest!==decision.expectedReference.digest ||
            canonicalJson(current.workspaceMaterialHandle)!==canonicalJson(decision.workspaceMaterialHandle) ||
            canonicalJson(current.episodeClaims)!==canonicalJson(decision.episodeClaims) || current.episodeScopeDigest!==decision.episodeScopeDigest))
          fail('P9_REFERENCE_STALE','Expected working Reference is stale.');
        if (decision.operation==='attach_working' && (snapshots.filter((item)=>item.state!=='released').length>=1024 ||
            snapshots.some((item)=>item.state!=='released' && item.materialKey===decision.workspaceMaterialHandle.materialKey)))
          fail('P9_REFERENCE_LIMIT','Workspace Reference limit or materialKey uniqueness would be violated.');
        const newWorkspaceRevision=Number(workspace.current_revision)+1, snapshot=buildReferenceSnapshot({workspaceId:workspace.workspace_id,
          libraRunId:run.libra_run_id,workspaceMaterialHandle:decision.workspaceMaterialHandle,
          referenceRevision:current?current.referenceRevision+1:1,state:decision.operation==='attach_working'?'working':'product_staging',
          episodeClaims:decision.episodeClaims,episodeScopeDigest:decision.episodeScopeDigest,
          productVerificationRef:decision.productVerificationRef,previousReferenceRevision:current?current.referenceRevision:null,
          committedWorkspaceRevision:newWorkspaceRevision}), nextSnapshots=snapshots.filter((item)=>item.referenceId!==snapshot.referenceId).concat(snapshot),
          setDigest=referenceSetDigest(workspace.workspace_id,nextSnapshots), transitionKind=decision.operation==='attach_working'?'reference_attached':'product_staged',
          state={workspaceId:workspace.workspace_id,workspaceRevision:newWorkspaceRevision,state:'active',workspaceMaterialReferenceSetDigest:setDigest,
            transitionKind,transitionEvidenceDigest:decision.decisionDigest};
        state.stateDigest=workspaceStateDigest(state);
        repo.invoke('insert_reference',{workspace_id:snapshot.workspaceId,libra_run_id:snapshot.libraRunId,reference_id:snapshot.referenceId,
          material_handle_id:snapshot.materialHandleId,material_key:snapshot.materialKey,workspace_handle_schema_ref:HANDLE_SCHEMA,
          workspace_handle_json:canonicalJson(snapshot.workspaceMaterialHandle),workspace_handle_digest:snapshot.workspaceHandleDigest,
          reference_revision:snapshot.referenceRevision,reference_state:snapshot.state,episode_claims_schema_ref:CLAIMS_SCHEMA,
          episode_claims_json:canonicalJson(snapshot.episodeClaims),episode_scope_digest:snapshot.episodeScopeDigest,
          product_verification_schema_ref:snapshot.productVerificationRef?VERIFICATION_SCHEMA:null,
          product_verification_id:snapshot.productVerificationRef?.verificationId||null,
          product_verification_json:snapshot.productVerificationRef?canonicalJson(snapshot.productVerificationRef):null,
          product_verification_digest:snapshot.productVerificationRef?.snapshotDigest||null,
          previous_reference_revision:snapshot.previousReferenceRevision,committed_workspace_revision:newWorkspaceRevision,
          reference_digest:snapshot.referenceDigest,committed_at_ms:context.commitTimeMs});
        const revisionDigest=canonicalDigest({...state,previousRevision:Number(workspace.current_revision)});
        repo.invoke('insert_workspace_revision',{workspace_id:workspace.workspace_id,workspace_revision:newWorkspaceRevision,state:'active',
          material_reference_set_digest:setDigest,transition_kind:transitionKind,transition_evidence_digest:decision.decisionDigest,
          previous_revision:Number(workspace.current_revision),revision_digest:revisionDigest,committed_at_ms:context.commitTimeMs});
        const changed=repo.invoke('update_workspace',{current_revision:newWorkspaceRevision,state:'active',state_digest:state.stateDigest,
          workspace_id:workspace.workspace_id,expected_current_revision:Number(workspace.current_revision),expected_state_digest:workspace.state_digest});
        if (changed.changes!==1) fail('P9_REFERENCE_STALE','Workspace CAS lost its race.');
        result={decisionId:decision.decisionId,workspaceId:workspace.workspace_id,workspaceRevision:newWorkspaceRevision,
          workspaceStateDigest:state.stateDigest,referenceSnapshot:snapshot,workspaceMaterialReferenceSetDigest:setDigest};
        result.resultDigest=canonicalDigest(result);
      }};
      const finish = { participantId:'workspace_reference_finish', owner:'execution-foundation', boundBusinessOwner:'libra', repositories:[foundation], execute(context) {
        if (replay) return;
        const repo=context.repository(foundation.repositoryId);
        repo.invoke('insert_result',{result_id:resultId,event_id:null,outcome_kind:'succeeded',result_schema_ref:RESULT_SCHEMA,
          result_json:canonicalJson(result),result_digest:canonicalDigest(result),evidence_schema_ref:DECISION_SCHEMA,
          evidence_json:canonicalJson(decision),evidence_digest:decision.decisionDigest,effect_receipt_id:null,committed_at_ms:context.commitTimeMs});
        repo.invoke('insert_marker',{commit_marker:marker,effect_id:null,owner_domain:'libra',scope_type:'libra_workspace_reference',
          scope_id:decision.workspaceId,commit_digest:decision.decisionDigest,result_id:resultId,result_schema_ref:RESULT_SCHEMA,
          result_digest:canonicalDigest(result),committed_at_ms:context.commitTimeMs});
      }};
      options.unitOfWork.execute([preflight,foundationRead,apply,finish]);
      return Object.freeze({result:replay||result,replayed:Boolean(replay)});
    }
  });
}

module.exports=Object.freeze({CLAIMS_SCHEMA,DECISION_SCHEMA,HANDLE_SCHEMA,RESULT_SCHEMA,VERIFICATION_SCHEMA,
  WorkspaceMaterialReferenceStoreError,createWorkspaceMaterialReferenceStore});
