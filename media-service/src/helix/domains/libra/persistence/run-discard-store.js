'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  createMaterialControlParticipant,
  projectMaterialControlRow,
} = require('../../../foundation/persistence/material-control');
const { activeRunScopeSetDigest } = require('../model/run-admission-contracts');
const { runStateDigest } = require('../model/run-lifecycle-contracts');
const {
  CLEANUP_RECORD_SCHEMA,
  COMMAND_RESULT_SCHEMA,
  RECEIPT_SCHEMA,
  buildCleanupRequestedMessage,
  buildControlCommitHandle,
  buildDiscardReceipt,
  buildResult,
  buildRunDiscardDecision,
  cleanupAdmissionRecord,
  cleanupMemberInitialState,
  initialCleanupState,
  nextWorkspaceState,
} = require('../model/run-discard-contracts');
const {
  buildReferenceSnapshot,
  referenceSetDigest,
} = require('../model/workspace-material-reference-contracts');
const { controlItem } = require('../model/workspace-cleanup-contracts');

const TRANSACTION_ID = 'helix.transaction.libra-run-discard-commit';
const DECISION_SCHEMA = 'LibraRunDiscardDecision@1';
const MESSAGE_SCHEMA = 'LibraWorkspaceCleanupRequestedMessage@1';

class LibraRunDiscardStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LibraRunDiscardStoreError';
    this.code = code;
    this.details = details;
  }
}
class Replay extends Error {
  constructor(result) {
    super('Run Discard replay');
    this.result = result;
  }
}
function fail(code, message, details) {
  throw new LibraRunDiscardStoreError(code, message, details);
}
function number(value) { return Number(value); }
function utf8(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }
function parse(value, reasonCode) {
  try { return JSON.parse(value); } catch { fail('P9_DISCARD_INTEGRITY', 'Stored immutable JSON is corrupt.', { reasonCode }); }
}

function libraDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'libra_run_discard', owner: 'libra', schemaManifest,
    statements: {
      find_decision_by_key: { kind:'select-one', tableId:'libra_run_discard_decisions',
        columns:['discard_decision_id','libra_run_id','expected_run_state_revision','expected_run_state_digest',
          'run_scope_digest','input_control_scope_digest','workspace_cleanup_scope_id',
          'workspace_cleanup_member_set_digest','actor_id','idempotency_key','decision_digest','decided_at_ms'],
        keyColumns:['actor_id','idempotency_key'], safeIntegers:true },
      find_decision: { kind:'select-one', tableId:'libra_run_discard_decisions',
        columns:['discard_decision_id','libra_run_id','expected_run_state_revision','expected_run_state_digest',
          'run_scope_digest','input_control_scope_digest','workspace_cleanup_scope_id',
          'workspace_cleanup_member_set_digest','actor_id','idempotency_key','decision_digest','decided_at_ms'],
        keyColumns:['discard_decision_id'], safeIntegers:true },
      find_receipt: { kind:'select-one', tableId:'libra_run_discard_receipts',
        columns:['receipt_id','discard_decision_id','libra_run_id','committed_run_state_revision',
          'released_input_control_set_digest','cleanup_scope_id','cleanup_member_set_digest','commit_digest','committed_at_ms'],
        keyColumns:['discard_decision_id'], safeIntegers:true },
      insert_decision: { kind:'insert', tableId:'libra_run_discard_decisions', columns:[
        'discard_decision_id','libra_run_id','expected_run_state_revision','expected_run_state_digest','run_scope_digest',
        'input_control_scope_digest','workspace_cleanup_scope_id','workspace_cleanup_member_set_digest','actor_id',
        'idempotency_key','decision_digest','decided_at_ms'] },
      insert_receipt: { kind:'insert', tableId:'libra_run_discard_receipts', columns:[
        'receipt_id','discard_decision_id','libra_run_id','committed_run_state_revision',
        'released_input_control_set_digest','cleanup_scope_id','cleanup_member_set_digest','commit_digest','committed_at_ms'] },
      find_run: { kind:'select-one', tableId:'libra_runs', columns:[
        'libra_run_id','subject_id','acceptance_spec_id','run_material_manifest_id','execution_basis_digest',
        'run_scope_digest','state','state_revision','state_digest','priority_class','priority_intent_digest',
        'recovery_policy_ref','recovery_policy_digest','suspension_started_at_ms','recovery_attempt_ordinal',
        'recovery_next_due_at_ms','latest_freshness_assessment_id','latest_freshness_assessment_digest','terminal_at_ms'],
        keyColumns:['libra_run_id'], safeIntegers:true },
      list_packages: { kind:'select-all', tableId:'libra_product_packages',
        columns:['on_deck_package_id','offer_id','state'], keyColumns:['libra_run_id'] },
      find_delivery_receipt: { kind:'select-one', tableId:'libra_delivery_receipts',
        columns:['offer_id','result'], keyColumns:['offer_id'] },
      list_runs: { kind:'select-all', tableId:'libra_runs', columns:[
        'libra_run_id','run_scope_digest','state','state_revision','state_digest'], keyColumns:['subject_id'], safeIntegers:true },
      update_run: { kind:'update', tableId:'libra_runs', setColumns:['state','state_revision','state_digest','terminal_at_ms'],
        keyColumns:['libra_run_id'], compareColumns:[
          {column:'state_revision',parameter:'expected_state_revision'},
          {column:'state_digest',parameter:'expected_state_digest'},
          {column:'state',parameter:'expected_state'}] },
      find_run_revision: { kind:'select-one', tableId:'libra_run_revisions', columns:[
        'libra_run_id','state_revision','state','acceptance_spec_id','execution_basis_digest','run_scope_digest',
        'priority_class','priority_intent_digest','transition_kind','transition_decision_id','transition_decision_digest',
        'transition_evidence_schema_ref','transition_evidence_id','transition_evidence_json','transition_evidence_digest',
        'recovery_policy_ref','recovery_policy_digest','suspension_started_at_ms','recovery_attempt_ordinal',
        'recovery_next_due_at_ms','expected_admission_head_revision','expected_active_scope_set_digest',
        'committed_admission_head_revision','committed_active_scope_set_digest','previous_state_revision','revision_digest','committed_at_ms'],
        keyColumns:['libra_run_id','state_revision'], safeIntegers:true },
      insert_run_revision: { kind:'insert', tableId:'libra_run_revisions', columns:[
        'libra_run_id','state_revision','state','acceptance_spec_id','execution_basis_digest','run_scope_digest',
        'priority_class','priority_intent_digest','transition_kind','transition_decision_id','transition_decision_digest',
        'transition_evidence_schema_ref','transition_evidence_id','transition_evidence_json','transition_evidence_digest',
        'recovery_policy_ref','recovery_policy_digest','suspension_started_at_ms','recovery_attempt_ordinal',
        'recovery_next_due_at_ms','expected_admission_head_revision','expected_active_scope_set_digest',
        'committed_admission_head_revision','committed_active_scope_set_digest','previous_state_revision','revision_digest','committed_at_ms'] },
      find_head: { kind:'select-one', tableId:'libra_run_admission_heads',
        columns:['subject_id','head_revision','active_scope_set_digest'], keyColumns:['subject_id'], safeIntegers:true },
      update_head: { kind:'update', tableId:'libra_run_admission_heads',
        setColumns:['head_revision','active_scope_set_digest','updated_at_ms'], keyColumns:['subject_id'], compareColumns:[
          {column:'head_revision',parameter:'expected_head_revision'},
          {column:'active_scope_set_digest',parameter:'expected_scope_digest'}] },
      find_manifest: { kind:'select-one', tableId:'libra_run_material_manifests', columns:[
        'run_material_manifest_id','libra_run_id','manifest_role','scope_kind','manifest_revision','member_count',
        'member_set_digest','episode_scope_digest','manifest_digest'], keyColumns:['run_material_manifest_id'], safeIntegers:true },
      list_manifest_members: { kind:'select-all', tableId:'libra_run_material_members', columns:[
        'run_material_manifest_id','ordinal','material_key','role','mount_scope_id','inode','fingerprint_algorithm',
        'fingerprint_version','content_fingerprint','size_bytes','location_kind','endpoint_id','location','binding_kind',
        'binding_revision','binding_evidence_digest','origin_intake_decision_id','origin_offer_id',
        'origin_candidate_package_id','origin_package_revision','origin_package_digest',
        'origin_candidate_delivery_snapshot_digest','origin_related_reference_set_digest','admitted_control_revision',
        'admitted_control_projection_digest','output_requirement_digest','episode_claim_set_digest','member_digest'],
        keyColumns:['run_material_manifest_id'], safeIntegers:true },
      list_manifest_claims: { kind:'select-all', tableId:'libra_run_material_episode_claims', columns:[
        'run_material_manifest_id','member_ordinal','episode_key','season_claim_digest','claim_digest'],
        keyColumns:['run_material_manifest_id'], safeIntegers:true },
      list_workspaces: { kind:'select-all', tableId:'libra_workspaces', columns:[
        'workspace_id','libra_run_id','current_revision','state','state_digest'], keyColumns:['libra_run_id'], safeIntegers:true },
      find_workspace_revision: { kind:'select-one', tableId:'libra_workspace_revisions', columns:[
        'workspace_id','workspace_revision','state','material_reference_set_digest','revision_digest'],
        keyColumns:['workspace_id','workspace_revision'], safeIntegers:true },
      list_workspace_references: { kind:'select-all', tableId:'libra_workspace_material_refs', columns:[
        'workspace_id','libra_run_id','reference_id','material_handle_id','material_key','workspace_handle_schema_ref',
        'workspace_handle_json','workspace_handle_digest','reference_revision','reference_state','episode_claims_schema_ref',
        'episode_claims_json','episode_scope_digest','product_verification_schema_ref','product_verification_id',
        'product_verification_json','product_verification_digest','previous_reference_revision','committed_workspace_revision',
        'reference_digest'], keyColumns:['workspace_id'], safeIntegers:true },
      find_cleanup_scope: { kind:'select-one', tableId:'libra_workspace_cleanup_scopes', columns:[
        'cleanup_scope_id','libra_run_id','workspace_id','trigger_kind','trigger_ref','trigger_revision','trigger_digest',
        'admission_record_json','admission_decision_digest','member_set_digest','state','state_revision','state_digest'],
        keyColumns:['cleanup_scope_id'], safeIntegers:true },
      list_cleanup_members: { kind:'select-all', tableId:'libra_workspace_cleanup_members', columns:[
        'cleanup_scope_id','material_handle_id','material_key','workspace_reference_id','expected_reference_revision',
        'expected_reference_digest','control_disposition','expected_control_revision','expected_control_projection_digest',
        'expected_control_owner_domain','expected_control_owner_scope_type','expected_control_owner_scope_id','cleanup_kind',
        'state','state_revision','state_digest'], keyColumns:['cleanup_scope_id'], safeIntegers:true },
      insert_cleanup_scope: { kind:'insert', tableId:'libra_workspace_cleanup_scopes', columns:[
        'cleanup_scope_id','libra_run_id','workspace_id','trigger_kind','trigger_ref','trigger_revision','trigger_digest',
        'admission_record_schema_ref','admission_record_json','admission_decision_digest','eligibility_evidence_digest',
        'member_set_digest','state','state_revision','state_digest','created_at_ms','completed_at_ms'] },
      insert_cleanup_member: { kind:'insert', tableId:'libra_workspace_cleanup_members', columns:[
        'cleanup_scope_id','material_handle_id','material_key','workspace_reference_id','expected_reference_revision',
        'expected_reference_digest','control_disposition','expected_control_revision','expected_control_projection_digest',
        'expected_control_owner_domain','expected_control_owner_scope_type','expected_control_owner_scope_id','cleanup_kind',
        'state','state_revision','state_digest','committed_scope_state_revision','deletion_effect_id',
        'outcome_evidence_schema_ref','outcome_evidence_id','outcome_evidence_json','outcome_evidence_digest',
        'cleanup_receipt_id','updated_at_ms'] },
      insert_workspace_revision: { kind:'insert', tableId:'libra_workspace_revisions', columns:[
        'workspace_id','workspace_revision','state','material_reference_set_digest','transition_kind',
        'transition_evidence_digest','previous_revision','revision_digest','committed_at_ms'] },
      update_workspace: { kind:'update', tableId:'libra_workspaces', setColumns:['current_revision','state','state_digest','completed_at_ms'],
        keyColumns:['workspace_id'], compareColumns:[
          {column:'current_revision',parameter:'expected_revision'},
          {column:'state_digest',parameter:'expected_state_digest'},
          {column:'state',parameter:'expected_state'}] },
    },
  });
}

function controlDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'libra_run_discard_control_read', owner:'material-control-authority',
    readOnly:true, schemaManifest, statements:{ find_current:{kind:'select-one',tableId:'fx_material_controls',columns:[
      'material_key','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version',
      'content_fingerprint','owner_domain','owner_scope_type','owner_scope_id','control_revision','state'],
    keyColumns:['material_key'],safeIntegers:true} } });
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'libra_run_discard_foundation', owner:'execution-foundation',
    schemaManifest, statements:{
      insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind',
        'result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest',
        'effect_receipt_id','committed_at_ms']},
      insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain',
        'scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
      insert_outbox:{kind:'insert',tableId:'fx_outbox',columns:['message_id','producer_domain','message_kind',
        'aggregate_type','aggregate_id','aggregate_revision','dedup_key','consumer_set_digest','intended_consumer_count',
        'payload_schema_ref','payload_json','payload_digest','state','available_at_ms','created_at_ms','all_acked_at_ms']},
      insert_delivery:{kind:'insert',tableId:'fx_outbox_deliveries',columns:['message_id','consumer_domain','state',
        'attempt_count','next_attempt_at_ms','acked_at_ms']},
    } });
}

function currentReferenceRows(rows) {
  const latest = new Map();
  for (const row of rows) {
    const previous = latest.get(row.reference_id);
    if (!previous || number(row.reference_revision) > number(previous.reference_revision)) latest.set(row.reference_id, row);
  }
  return [...latest.values()];
}

function referenceSnapshot(row) {
  return buildReferenceSnapshot({
    workspaceId:row.workspace_id, libraRunId:row.libra_run_id,
    workspaceMaterialHandle:parse(row.workspace_handle_json, 'workspace_reference_incomplete'),
    referenceRevision:number(row.reference_revision), state:row.reference_state,
    episodeClaims:parse(row.episode_claims_json, 'workspace_reference_incomplete'),
    episodeScopeDigest:row.episode_scope_digest,
    productVerificationRef:row.product_verification_json===null?null:parse(row.product_verification_json,'workspace_reference_incomplete'),
    previousReferenceRevision:row.previous_reference_revision===null?null:number(row.previous_reference_revision),
    committedWorkspaceRevision:number(row.committed_workspace_revision),
  });
}

function reconstructManifest(repo, run) {
  const header = repo.invoke('find_manifest', { run_material_manifest_id:run.run_material_manifest_id });
  if (!header || header.libra_run_id !== run.libra_run_id || header.manifest_role !== 'run_input') return null;
  const rows = repo.invoke('list_manifest_members', { run_material_manifest_id:run.run_material_manifest_id })
    .sort((left,right)=>number(left.ordinal)-number(right.ordinal));
  const claims = repo.invoke('list_manifest_claims', { run_material_manifest_id:run.run_material_manifest_id });
  if (rows.length !== number(header.member_count) || rows.length < 1 || rows.length > 1024 ||
      rows.some((row,index)=>number(row.ordinal)!==index)) return null;
  const members = rows.map((row) => {
    const episodeClaims = claims.filter((claim)=>number(claim.member_ordinal)===number(row.ordinal))
      .sort((left,right)=>utf8(left.episode_key,right.episode_key)).map((claim)=>({
        episodeKey:claim.episode_key, seasonClaimDigest:claim.season_claim_digest, claimDigest:claim.claim_digest,
      }));
    if (episodeClaims.some((claim)=>claim.claimDigest!==canonicalDigest({schema:'libra.production-material-episode-claim@1',
      episodeKey:claim.episodeKey,seasonClaimDigest:claim.seasonClaimDigest}))) return null;
    const member = {
      ordinal:number(row.ordinal), materialKey:row.material_key, role:row.role,
      physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
        materialKey:row.material_key,mountScopeId:row.mount_scope_id,inode:String(row.inode),sizeBytes:number(row.size_bytes),
        fingerprintAlgorithm:row.fingerprint_algorithm,fingerprintVersion:number(row.fingerprint_version),
        contentFingerprint:row.content_fingerprint},
      sizeBytes:number(row.size_bytes), location:{locationKind:row.location_kind,endpointId:row.endpoint_id,location:row.location},
      bindingKind:row.binding_kind,bindingRevision:number(row.binding_revision),bindingEvidenceDigest:row.binding_evidence_digest,
      originCandidateDeliveryRef:{intakeDecisionId:row.origin_intake_decision_id,offerId:row.origin_offer_id,
        candidatePackageId:row.origin_candidate_package_id,packageRevision:number(row.origin_package_revision),
        packageDigest:row.origin_package_digest,candidateDeliverySnapshotDigest:row.origin_candidate_delivery_snapshot_digest,
        relatedReferenceSetDigest:row.origin_related_reference_set_digest},
      admittedControlRevision:number(row.admitted_control_revision),
      admittedControlProjectionDigest:row.admitted_control_projection_digest,
      episodeClaims,episodeClaimSetDigest:row.episode_claim_set_digest,
      outputRequirementDigest:row.output_requirement_digest,
    };
    member.memberDigest=canonicalDigest(member);
    return member.memberDigest===row.member_digest?Object.freeze(member):null;
  });
  if (members.some((member)=>member===null)) return null;
  const memberSetDigest=canonicalDigest({schema:'libra.production-material-members@1',items:members});
  const manifest={manifestId:header.run_material_manifest_id,manifestRole:header.manifest_role,
    manifestRevision:number(header.manifest_revision),libraRunId:header.libra_run_id,scopeKind:header.scope_kind,
    members,memberSetDigest,episodeScopeDigest:header.episode_scope_digest};
  manifest.manifestDigest=canonicalDigest(manifest);
  if (memberSetDigest!==header.member_set_digest||manifest.manifestDigest!==header.manifest_digest) return null;
  return Object.freeze({header:Object.freeze({manifestDigest:header.manifest_digest}),members:Object.freeze(members)});
}

function runRevisionIntegrity(repo, run) {
  const row=repo.invoke('find_run_revision',{libra_run_id:run.libra_run_id,state_revision:number(run.state_revision)});
  if(!row||row.state!==run.state||row.revision_digest===null)return false;
  const base={libraRunId:row.libra_run_id,stateRevision:number(row.state_revision),state:row.state,
    acceptanceSpecId:row.acceptance_spec_id,executionBasisDigest:row.execution_basis_digest,runScopeDigest:row.run_scope_digest,
    priorityClass:row.priority_class,priorityIntentDigest:row.priority_intent_digest,transitionKind:row.transition_kind,
    transitionDecisionId:row.transition_decision_id,transitionDecisionDigest:row.transition_decision_digest,
    transitionEvidenceSchemaRef:row.transition_evidence_schema_ref,transitionEvidenceId:row.transition_evidence_id,
    transitionEvidenceDigest:row.transition_evidence_digest,
    expectedAdmissionHeadRevision:number(row.expected_admission_head_revision),expectedActiveScopeSetDigest:row.expected_active_scope_set_digest,
    committedAdmissionHeadRevision:number(row.committed_admission_head_revision),committedActiveScopeSetDigest:row.committed_active_scope_set_digest,
    previousStateRevision:row.previous_state_revision===null?null:number(row.previous_state_revision)};
  const lifecycle={...base,recoveryPolicyRef:row.recovery_policy_ref,recoveryPolicyDigest:row.recovery_policy_digest,
    suspensionStartedAtMs:row.suspension_started_at_ms===null?null:number(row.suspension_started_at_ms),
    recoveryAttemptOrdinal:number(row.recovery_attempt_ordinal),recoveryNextDueAtMs:row.recovery_next_due_at_ms===null?null:number(row.recovery_next_due_at_ms)};
  const stateDigest=runStateDigest({libraRunId:base.libraRunId,stateRevision:base.stateRevision,state:base.state,
    acceptanceSpecId:base.acceptanceSpecId,executionBasisDigest:base.executionBasisDigest,runScopeDigest:base.runScopeDigest,
    priorityClass:base.priorityClass,priorityIntentDigest:base.priorityIntentDigest,transitionKind:base.transitionKind,
    transitionEvidenceDigest:base.transitionEvidenceDigest});
  return [canonicalDigest(base),canonicalDigest(lifecycle)].includes(row.revision_digest)&&stateDigest===run.state_digest&&
    row.execution_basis_digest===run.execution_basis_digest&&row.run_scope_digest===run.run_scope_digest;
}

function readWorkspace(repo, run) {
  const workspaces=repo.invoke('list_workspaces',{libra_run_id:run.libra_run_id})
    .filter((item)=>item.state!=='reclaimed');
  if(workspaces.length>1)return {integrityError:'workspace_reference_incomplete'};
  if(workspaces.length===0)return {workspaceRef:null,references:[]};
  const workspace=workspaces[0];
  if(workspace.state!=='active')return {integrityError:'workspace_reference_incomplete'};
  const revision=repo.invoke('find_workspace_revision',{workspace_id:workspace.workspace_id,
    workspace_revision:number(workspace.current_revision)});
  const references=currentReferenceRows(repo.invoke('list_workspace_references',{workspace_id:workspace.workspace_id}))
    .filter((row)=>row.reference_state!=='released').map(referenceSnapshot)
    .sort((left,right)=>utf8(left.materialHandleId,right.materialHandleId));
  if(!revision||referenceSetDigest(workspace.workspace_id,references)!==revision.material_reference_set_digest) {
    return {integrityError:'workspace_reference_incomplete'};
  }
  return {workspaceRef:Object.freeze({workspaceId:workspace.workspace_id,workspaceRevision:number(workspace.current_revision),
    workspaceStateDigest:workspace.state_digest,materialReferenceSetDigest:revision.material_reference_set_digest}),references};
}

function decisionFromRows(row, scope, members) {
  const originalInputControlScope={items:members.map((member)=>({materialKey:member.materialKey,
    expectedControlRevision:member.admittedControlRevision,expectedControlProjectionDigest:member.admittedControlProjectionDigest,
    fromOwnerDomain:'libra',fromOwnerScopeType:'subject',fromOwnerScopeId:scope.subjectId,operation:'release'}))
    .sort((left,right)=>utf8(left.materialKey,right.materialKey)),scopeDigest:row.input_control_scope_digest};
  const decision={discardDecisionId:row.discard_decision_id,libraRunId:row.libra_run_id,
    expectedRunStateRevision:number(row.expected_run_state_revision),expectedRunStateDigest:row.expected_run_state_digest,
    runScopeDigest:row.run_scope_digest,originalInputControlScope,
    workspaceCleanupMemberSetDigest:row.workspace_cleanup_member_set_digest,actorId:row.actor_id,idempotencyKey:row.idempotency_key};
  if(scope.cleanupDraft)decision.workspaceCleanupScopeDraft=scope.cleanupDraft;
  decision.decisionDigest=canonicalDigest(decision);
  return decision;
}

function createRunDiscardStore(options) {
  if(!options?.schemaManifest||!options.unitOfWork)fail('P9_DISCARD_DEPENDENCIES','Run Discard requires clean persistence.');
  const libra=libraDefinition(options.schemaManifest),controlRead=controlDefinition(options.schemaManifest),
    foundation=foundationDefinition(options.schemaManifest);

  function snapshot(command) {
    let owner;
    let controls;
    options.unitOfWork.execute([{participantId:'discard_snapshot_libra',owner:'libra',repositories:[libra],execute(context){
      const repo=context.repository(libra.repositoryId),existing=repo.invoke('find_decision_by_key',{
        actor_id:command.actorId,idempotency_key:command.idempotencyKey});
      if(existing){owner={existing};return;}
      const run=repo.invoke('find_run',{libra_run_id:command.libraRunId});
      if(!run){owner={run:null};return;}
      const manifest=reconstructManifest(repo,run),head=repo.invoke('find_head',{subject_id:run.subject_id});
      const workspace=readWorkspace(repo,run);
      const rejectedHandoffB=(repo.invoke('list_packages',{libra_run_id:run.libra_run_id})||[])
        .some((pkg)=>pkg.state==='published' && repo.invoke('find_delivery_receipt',{offer_id:pkg.offer_id})?.result==='rejected');
      owner={run,manifest,head,workspace,runHistoryValid:runRevisionIntegrity(repo,run),rejectedHandoffB};
    }},{participantId:'discard_snapshot_control',owner:'material-control-authority',boundBusinessOwner:'libra',repositories:[controlRead],execute(context){
      if(!owner?.run||owner.existing)return;
      const materialKeys=[...(owner.manifest?.members||[]).map((item)=>item.materialKey),
        ...(owner.workspace?.references||[]).map((item)=>item.materialKey)];
      const repo=context.repository(controlRead.repositoryId);controls=new Map([...new Set(materialKeys)].map((materialKey)=>{
        const row=repo.invoke('find_current',{material_key:materialKey});
        return [materialKey,{row,projection:projectMaterialControlRow(materialKey,row)}];
      }));
    }}]);
    return {owner,controls:controls||new Map()};
  }

  function failure(command,resultKind,fields={}){
    return buildResult({resultKind,commandId:command.commandId,commandDigest:command.commandDigest,
      libraRunId:command.libraRunId,...fields});
  }

  function reconstructReplayWithRepo(command, existing, repo) {
    if(existing.libra_run_id!==command.libraRunId)return failure(command,'conflict',{
      reasonCode:'idempotency_key_reused',existingCommandDigest:canonicalDigest({schema:'libra.run-discard-existing-command@1',
        discardDecisionId:existing.discard_decision_id,libraRunId:existing.libra_run_id,
        expectedRunStateRevision:number(existing.expected_run_state_revision),expectedRunStateDigest:existing.expected_run_state_digest,
        actorId:existing.actor_id,idempotencyKey:existing.idempotency_key})});
    const existingCommand={commandContract:'libra.run-discard@1',commandId:existing.discard_decision_id,
      libraRunId:existing.libra_run_id,expectedRunStateRevision:number(existing.expected_run_state_revision),
      expectedRunStateDigest:existing.expected_run_state_digest,actorId:existing.actor_id,idempotencyKey:existing.idempotency_key};
    existingCommand.commandDigest=canonicalDigest(existingCommand);
    if(existingCommand.commandDigest!==command.commandDigest)return failure(command,'conflict',{
      reasonCode:'idempotency_key_reused',existingCommandDigest:existingCommand.commandDigest});
    const receipt=repo.invoke('find_receipt',{discard_decision_id:existing.discard_decision_id}),
      run=repo.invoke('find_run',{libra_run_id:existing.libra_run_id}),manifest=run&&reconstructManifest(repo,run);
    if(!receipt||!run||!manifest)return failure(command,'integrity_error',{reasonCode:'discard_receipt_mismatch'});
    let cleanupMemberCount=0;
    if(receipt.cleanup_scope_id!==null){const scope=repo.invoke('find_cleanup_scope',{cleanup_scope_id:receipt.cleanup_scope_id}),
      members=repo.invoke('list_cleanup_members',{cleanup_scope_id:receipt.cleanup_scope_id});
      if(!scope||scope.member_set_digest!==receipt.cleanup_member_set_digest)
        return failure(command,'integrity_error',{reasonCode:'discard_receipt_mismatch'});
      cleanupMemberCount=members.length;
    }
    const value={schemaRef:RECEIPT_SCHEMA,schemaVersion:1,receiptId:receipt.receipt_id,receiptKind:'libra_run_discarded',
      ownerDomain:'libra',scopeType:'libra_run',scopeId:receipt.libra_run_id,scopeDigest:existing.decision_digest,
      effectReceiptRef:null,committedAtMs:number(receipt.committed_at_ms),discardDecisionId:receipt.discard_decision_id,
      libraRunId:receipt.libra_run_id,committedRunStateRevision:number(receipt.committed_run_state_revision),
      releasedInputControlSetDigest:receipt.released_input_control_set_digest,cleanupScopeId:receipt.cleanup_scope_id,
      cleanupMemberSetDigest:receipt.cleanup_member_set_digest};
    value.commitDigest=canonicalDigest(value);
    if(value.commitDigest!==receipt.commit_digest||run.state!=='discarded'||number(run.state_revision)!==value.committedRunStateRevision)
      return failure(command,'integrity_error',{reasonCode:'discard_receipt_mismatch'});
    return failure(command,'discarded',{discardReceipt:Object.freeze(value),cleanupMemberCount});
  }

  function reconstructReplay(command, existing) {
    let replay;
    options.unitOfWork.execute([{participantId:'discard_replay',owner:'libra',repositories:[libra],execute(context){
      replay=reconstructReplayWithRepo(command,existing,context.repository(libra.repositoryId));
    }}]);
    return replay;
  }

  function inspect(command) {
    const snap=snapshot(command);
    if(snap.owner.existing)return reconstructReplay(command,snap.owner.existing);
    const run=snap.owner.run;
    if(!run)return failure(command,'not_found',{reasonCode:'run_missing'});
    if(!snap.owner.runHistoryValid||!snap.owner.head)return failure(command,'integrity_error',{reasonCode:'run_history_incomplete'});
    if(!snap.owner.manifest)return failure(command,'integrity_error',{reasonCode:'material_manifest_incomplete'});
    if(snap.owner.workspace?.integrityError)return failure(command,'integrity_error',{reasonCode:snap.owner.workspace.integrityError});
    for(const member of snap.owner.manifest.members){const current=snap.controls.get(member.materialKey);
      if(!current||current.projection.controlState!=='controlled'||current.projection.ownerDomain!=='libra'||
        current.projection.ownerScopeType!=='subject'||current.projection.ownerScopeId!==run.subject_id||
        current.projection.controlRevision!==member.admittedControlRevision||
        current.projection.projectionDigest!==member.admittedControlProjectionDigest){
        return failure(command,'integrity_error',{reasonCode:'control_fence_mismatch'});
      }}
    if(number(run.state_revision)!==command.expectedRunStateRevision||run.state_digest!==command.expectedRunStateDigest)
      return failure(command,'stale',{expectedRunStateRevision:command.expectedRunStateRevision,
        expectedRunStateDigest:command.expectedRunStateDigest,actualRunStateRevision:number(run.state_revision),actualRunStateDigest:run.state_digest});
    if(run.state!=='frozen' && !(run.state==='active' && snap.owner.rejectedHandoffB))
      return failure(command,'invalid_state',{reasonCode:'run_not_frozen',
      actualRunStateRevision:number(run.state_revision),actualRunStateDigest:run.state_digest});
    const workspaceControls=(snap.owner.workspace.references||[]).map((reference)=>{
      const current=snap.controls.get(reference.materialKey);return controlItem(reference.materialKey,current.projection);});
    const built=buildRunDiscardDecision({command,run:{subjectId:run.subject_id,stateRevision:number(run.state_revision),
      stateDigest:run.state_digest,executionBasisDigest:run.execution_basis_digest,runScopeDigest:run.run_scope_digest},
      manifestMembers:snap.owner.manifest.members,workspaceRef:snap.owner.workspace.workspaceRef,
      workspaceReferences:snap.owner.workspace.references,workspaceControls});
    return {kind:'ready',command,run,head:snap.owner.head,manifest:snap.owner.manifest,
      workspace:snap.owner.workspace,built,controls:snap.controls};
  }

  function commit(ready) {
    if(ready?.kind!=='ready')fail('P9_DISCARD_COMMIT_INPUT','A fully inspected Discard decision is required.');
    const {command,run,head,manifest,workspace,built}=ready,decision=built.decision;
    const controlChanges=manifest.members.map((member)=>({identity:member.physicalIdentity,action:'release',
      expectedRevision:member.admittedControlRevision,expectedProjectionDigest:member.admittedControlProjectionDigest,
      fromScope:{ownerDomain:'libra',scopeType:'subject',scopeId:run.subject_id},toScope:null}));
    const controlHandle=buildControlCommitHandle(decision,manifest.header.manifestDigest,command.commandDigest);
    const rawControl=createMaterialControlParticipant({schemaManifest:options.schemaManifest,
      participantId:'libra_run_discard_control',handle:controlHandle,changes:controlChanges,
      authorizedScopeDigest:decision.originalInputControlScope.scopeDigest,
      commitMarker:canonicalDigest({schema:'libra.run-discard-commit-marker@1',discardDecisionId:decision.discardDecisionId})});
    let controlResults,receipt,result,message;
    const participants=[{participantId:'libra_run_discard_prepare',owner:'libra',repositories:[libra],execute(context){
      const repo=context.repository(libra.repositoryId),existing=repo.invoke('find_decision_by_key',{actor_id:command.actorId,
        idempotency_key:command.idempotencyKey});if(existing)throw new Replay(reconstructReplayWithRepo(command,existing,repo));
      const current=repo.invoke('find_run',{libra_run_id:command.libraRunId});
      const rejectedHandoffB=(repo.invoke('list_packages',{libra_run_id:command.libraRunId})||[])
        .some((pkg)=>pkg.state==='published' && repo.invoke('find_delivery_receipt',{offer_id:pkg.offer_id})?.result==='rejected');
      if(!current||(current.state!=='frozen' && !(current.state==='active' && rejectedHandoffB))||
        number(current.state_revision)!==decision.expectedRunStateRevision||
        current.state_digest!==decision.expectedRunStateDigest)fail('P9_DISCARD_STALE','Discard snapshot changed before commit.');
    }},{...rawControl,execute(context){controlResults=rawControl.execute(context);return controlResults;}},
    {participantId:'libra_run_discard_write',owner:'libra',repositories:[libra],execute(context){
      const repo=context.repository(libra.repositoryId),cleanupDraft=built.cleanup.draft;
      let cleanupScopeId=null,nextWorkspace=null;
      if(cleanupDraft){cleanupScopeId=cleanupDraft.cleanupScopeId;const initial=initialCleanupState(cleanupDraft),
        record=cleanupAdmissionRecord(cleanupDraft);repo.invoke('insert_cleanup_scope',{
          cleanup_scope_id:cleanupDraft.cleanupScopeId,libra_run_id:decision.libraRunId,
          workspace_id:cleanupDraft.workspaceRef.workspaceId,trigger_kind:'run_discarded',trigger_ref:decision.discardDecisionId,
          trigger_revision:1,trigger_digest:decision.decisionDigest,admission_record_schema_ref:CLEANUP_RECORD_SCHEMA,
          admission_record_json:canonicalJson(record),admission_decision_digest:cleanupDraft.decisionDigest,
          eligibility_evidence_digest:cleanupDraft.eligibilityEvidenceDigest,member_set_digest:cleanupDraft.memberSetDigest,
          state:'active',state_revision:1,state_digest:initial.stateDigest,created_at_ms:context.commitTimeMs,completed_at_ms:null});
        for(const member of cleanupDraft.members)repo.invoke('insert_cleanup_member',{
          cleanup_scope_id:cleanupDraft.cleanupScopeId,material_handle_id:member.materialHandleId,material_key:member.materialKey,
          workspace_reference_id:member.workspaceReferenceId,expected_reference_revision:member.expectedReferenceRevision,
          expected_reference_digest:member.expectedReferenceDigest,control_disposition:member.controlDisposition,
          expected_control_revision:member.expectedControlRevision,expected_control_projection_digest:member.expectedControlProjectionDigest,
          expected_control_owner_domain:member.expectedControlOwnerDomain,expected_control_owner_scope_type:member.expectedControlOwnerScopeType,
          expected_control_owner_scope_id:member.expectedControlOwnerScopeId,cleanup_kind:member.cleanupKind,state:'pending',state_revision:1,
          state_digest:cleanupMemberInitialState(cleanupDraft.cleanupScopeId,member),committed_scope_state_revision:null,
          deletion_effect_id:null,outcome_evidence_schema_ref:null,outcome_evidence_id:null,outcome_evidence_json:null,
          outcome_evidence_digest:null,cleanup_receipt_id:null,updated_at_ms:context.commitTimeMs});
        nextWorkspace=nextWorkspaceState(cleanupDraft.workspaceRef,decision.decisionDigest);
        const revision={workspaceId:nextWorkspace.workspaceId,workspaceRevision:nextWorkspace.workspaceRevision,state:'reclaiming',
          materialReferenceSetDigest:nextWorkspace.workspaceMaterialReferenceSetDigest,transitionKind:'reclaiming',
          transitionEvidenceDigest:decision.decisionDigest,previousRevision:cleanupDraft.workspaceRef.workspaceRevision};
        revision.revisionDigest=canonicalDigest(revision);repo.invoke('insert_workspace_revision',{
          workspace_id:revision.workspaceId,workspace_revision:revision.workspaceRevision,state:revision.state,
          material_reference_set_digest:revision.materialReferenceSetDigest,transition_kind:revision.transitionKind,
          transition_evidence_digest:revision.transitionEvidenceDigest,previous_revision:revision.previousRevision,
          revision_digest:revision.revisionDigest,committed_at_ms:context.commitTimeMs});
        if(repo.invoke('update_workspace',{current_revision:nextWorkspace.workspaceRevision,state:'reclaiming',
          state_digest:nextWorkspace.stateDigest,completed_at_ms:null,workspace_id:nextWorkspace.workspaceId,
          expected_revision:cleanupDraft.workspaceRef.workspaceRevision,
          expected_state_digest:cleanupDraft.workspaceRef.workspaceStateDigest,expected_state:'active'}).changes!==1)
          fail('P9_DISCARD_WORKSPACE_CAS','Discard Workspace CAS failed.');
      }
      const nextStateRevision=number(run.state_revision)+1,nextState={libraRunId:run.libra_run_id,stateRevision:nextStateRevision,
        state:'discarded',acceptanceSpecId:run.acceptance_spec_id,executionBasisDigest:run.execution_basis_digest,
        runScopeDigest:run.run_scope_digest,priorityClass:run.priority_class,priorityIntentDigest:run.priority_intent_digest,
        transitionKind:'discarded',transitionEvidenceDigest:decision.decisionDigest};
      nextState.stateDigest=runStateDigest(nextState);
      const otherRuns=repo.invoke('list_runs',{subject_id:run.subject_id}).filter((item)=>item.libra_run_id!==run.libra_run_id&&
        ['active','suspended','frozen'].includes(item.state)).map((item)=>({libraRunId:item.libra_run_id,
        runScopeDigest:item.run_scope_digest,stateRevision:number(item.state_revision),stateDigest:item.state_digest}))
        .sort((left,right)=>utf8(left.libraRunId,right.libraRunId));
      const nextHeadRevision=number(head.head_revision)+1,nextScopeDigest=activeRunScopeSetDigest(run.subject_id,otherRuns);
      if(repo.invoke('update_run',{state:'discarded',state_revision:nextStateRevision,state_digest:nextState.stateDigest,
        terminal_at_ms:context.commitTimeMs,libra_run_id:run.libra_run_id,expected_state_revision:number(run.state_revision),
        expected_state_digest:run.state_digest,expected_state:run.state}).changes!==1)fail('P9_DISCARD_RUN_CAS','Discard Run CAS failed.');
      if(repo.invoke('update_head',{head_revision:nextHeadRevision,active_scope_set_digest:nextScopeDigest,
        updated_at_ms:context.commitTimeMs,subject_id:run.subject_id,expected_head_revision:number(head.head_revision),
        expected_scope_digest:head.active_scope_set_digest}).changes!==1)fail('P9_DISCARD_HEAD_CAS','Discard admission head CAS failed.');
      const revision={libraRunId:run.libra_run_id,stateRevision:nextStateRevision,state:'discarded',acceptanceSpecId:run.acceptance_spec_id,
        executionBasisDigest:run.execution_basis_digest,runScopeDigest:run.run_scope_digest,priorityClass:run.priority_class,
        priorityIntentDigest:run.priority_intent_digest,transitionKind:'discarded',transitionDecisionId:decision.discardDecisionId,
        transitionDecisionDigest:decision.decisionDigest,transitionEvidenceSchemaRef:DECISION_SCHEMA,
        transitionEvidenceId:decision.discardDecisionId,transitionEvidenceDigest:decision.decisionDigest,
        recoveryPolicyRef:run.recovery_policy_ref,recoveryPolicyDigest:run.recovery_policy_digest,
        suspensionStartedAtMs:run.suspension_started_at_ms,recoveryAttemptOrdinal:number(run.recovery_attempt_ordinal),
        recoveryNextDueAtMs:null,expectedAdmissionHeadRevision:number(head.head_revision),
        expectedActiveScopeSetDigest:head.active_scope_set_digest,committedAdmissionHeadRevision:nextHeadRevision,
        committedActiveScopeSetDigest:nextScopeDigest,previousStateRevision:number(run.state_revision)};
      revision.revisionDigest=canonicalDigest(revision);repo.invoke('insert_run_revision',{
        libra_run_id:revision.libraRunId,state_revision:revision.stateRevision,state:revision.state,
        acceptance_spec_id:revision.acceptanceSpecId,execution_basis_digest:revision.executionBasisDigest,
        run_scope_digest:revision.runScopeDigest,priority_class:revision.priorityClass,priority_intent_digest:revision.priorityIntentDigest,
        transition_kind:revision.transitionKind,transition_decision_id:revision.transitionDecisionId,
        transition_decision_digest:revision.transitionDecisionDigest,transition_evidence_schema_ref:revision.transitionEvidenceSchemaRef,
        transition_evidence_id:revision.transitionEvidenceId,transition_evidence_json:canonicalJson(decision),
        transition_evidence_digest:revision.transitionEvidenceDigest,recovery_policy_ref:revision.recoveryPolicyRef,
        recovery_policy_digest:revision.recoveryPolicyDigest,suspension_started_at_ms:revision.suspensionStartedAtMs,
        recovery_attempt_ordinal:revision.recoveryAttemptOrdinal,recovery_next_due_at_ms:revision.recoveryNextDueAtMs,
        expected_admission_head_revision:revision.expectedAdmissionHeadRevision,
        expected_active_scope_set_digest:revision.expectedActiveScopeSetDigest,
        committed_admission_head_revision:revision.committedAdmissionHeadRevision,
        committed_active_scope_set_digest:revision.committedActiveScopeSetDigest,previous_state_revision:revision.previousStateRevision,
        revision_digest:revision.revisionDigest,committed_at_ms:context.commitTimeMs});
      const releasedInputControlSetDigest=canonicalDigest({schema:'libra.run-discard-released-control-set@1',
        items:controlResults.map((item)=>({materialKey:item.materialKey,committedControlRevision:item.revision,
          committedControlProjectionDigest:item.projection.projectionDigest})).sort((left,right)=>utf8(left.materialKey,right.materialKey))});
      receipt=buildDiscardReceipt({decision,committedAtMs:context.commitTimeMs,committedRunStateRevision:nextStateRevision,
        releasedInputControlSetDigest,cleanupScopeId});
      repo.invoke('insert_decision',{discard_decision_id:decision.discardDecisionId,libra_run_id:decision.libraRunId,
        expected_run_state_revision:decision.expectedRunStateRevision,expected_run_state_digest:decision.expectedRunStateDigest,
        run_scope_digest:decision.runScopeDigest,input_control_scope_digest:decision.originalInputControlScope.scopeDigest,
        workspace_cleanup_scope_id:cleanupScopeId,workspace_cleanup_member_set_digest:decision.workspaceCleanupMemberSetDigest,
        actor_id:decision.actorId,idempotency_key:decision.idempotencyKey,decision_digest:decision.decisionDigest,
        decided_at_ms:context.commitTimeMs});
      repo.invoke('insert_receipt',{receipt_id:receipt.receiptId,discard_decision_id:receipt.discardDecisionId,
        libra_run_id:receipt.libraRunId,committed_run_state_revision:receipt.committedRunStateRevision,
        released_input_control_set_digest:receipt.releasedInputControlSetDigest,cleanup_scope_id:receipt.cleanupScopeId,
        cleanup_member_set_digest:receipt.cleanupMemberSetDigest,commit_digest:receipt.commitDigest,
        committed_at_ms:receipt.committedAtMs});
      result=buildResult({resultKind:'discarded',commandId:command.commandId,commandDigest:command.commandDigest,
        libraRunId:command.libraRunId,discardReceipt:receipt,cleanupMemberCount:built.cleanup.members.length});
      message=buildCleanupRequestedMessage(decision,cleanupScopeId);
    }},{participantId:'libra_run_discard_foundation',owner:'execution-foundation',boundBusinessOwner:'libra',
      repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId),
        resultId=canonicalDigest({schema:'libra.run-discard-command-result-id@1',commandId:command.commandId}),
        marker=canonicalDigest({schema:'libra.run-discard-commit-marker@1',discardDecisionId:decision.discardDecisionId});
      repo.invoke('insert_result',{result_id:resultId,event_id:null,outcome_kind:'succeeded',result_schema_ref:COMMAND_RESULT_SCHEMA,
        result_json:canonicalJson(result),result_digest:result.resultDigest,evidence_schema_ref:DECISION_SCHEMA,
        evidence_json:canonicalJson(decision),evidence_digest:decision.decisionDigest,effect_receipt_id:null,
        committed_at_ms:context.commitTimeMs});
      repo.invoke('insert_marker',{commit_marker:marker,effect_id:null,owner_domain:'libra',scope_type:'libra_run',
        scope_id:decision.libraRunId,commit_digest:decision.decisionDigest,result_id:resultId,
        result_schema_ref:COMMAND_RESULT_SCHEMA,result_digest:result.resultDigest,committed_at_ms:context.commitTimeMs});
      repo.invoke('insert_outbox',{message_id:message.messageId,producer_domain:'libra',message_kind:message.messageKind,
        aggregate_type:'libra_run',aggregate_id:decision.libraRunId,aggregate_revision:receipt.committedRunStateRevision,
        dedup_key:message.dedupKey,consumer_set_digest:canonicalDigest(['libra']),intended_consumer_count:1,
        payload_schema_ref:MESSAGE_SCHEMA,payload_json:canonicalJson(message),payload_digest:canonicalDigest(message),state:'pending',
        available_at_ms:context.commitTimeMs,created_at_ms:context.commitTimeMs,all_acked_at_ms:null});
      repo.invoke('insert_delivery',{message_id:message.messageId,consumer_domain:'libra',state:'pending',
        attempt_count:0,next_attempt_at_ms:context.commitTimeMs,acked_at_ms:null});return result;
    }}];
    try{options.unitOfWork.execute(participants);return result;}catch(error){if(error instanceof Replay)return error.result;throw error;}
  }

  return Object.freeze({inspect,commit,transactionId:TRANSACTION_ID});
}

module.exports=Object.freeze({LibraRunDiscardStoreError,createRunDiscardStore});
