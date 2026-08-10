'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { buildPublication, buildPublicationReceipt, OFFER_MESSAGE_SCHEMA, RECEIPT_SCHEMA } = require('../model/candidate-publication-contracts');

const DRAFT_SCHEMA = 'helix://contracts/domain-types/CandidateDraft/v1';
const SHA256 = /^[0-9a-f]{64}$/;

class CandidatePublicationStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'CandidatePublicationStoreError'; this.code = code; this.details = details; }
}
class Replay extends Error { constructor(result, evidence, marker) { super('Candidate Publication replay'); this.result = result; this.evidence = evidence; this.marker = marker; } }
function fail(code, message, details) { throw new CandidatePublicationStoreError(code, message, details); }

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'candidate_publication_foundation', owner:'execution-foundation', schemaManifest, statements:{
    find_marker:{ kind:'select-one', tableId:'fx_commit_markers', columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest'], keyColumns:['commit_marker'] },
    find_result:{ kind:'select-one', tableId:'fx_event_result_bindings', columns:['result_id','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest'], keyColumns:['result_id'] },
    insert_result:{ kind:'insert', tableId:'fx_event_result_bindings', columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'] },
    insert_marker:{ kind:'insert', tableId:'fx_commit_markers', columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'] },
    insert_outbox:{ kind:'insert', tableId:'fx_outbox', columns:['message_id','producer_domain','message_kind','aggregate_type','aggregate_id','aggregate_revision','dedup_key','consumer_set_digest','intended_consumer_count','payload_schema_ref','payload_json','payload_digest','state','available_at_ms','created_at_ms','all_acked_at_ms'] },
    insert_outbox_delivery:{ kind:'insert', tableId:'fx_outbox_deliveries', columns:['message_id','consumer_domain','state','attempt_count','next_attempt_at_ms','acked_at_ms'] }
  }});
}

function procurementDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'candidate_publication', owner:'procurement', schemaManifest, statements:{
    find_run:{ kind:'select-one', tableId:'proc_procurement_runs', columns:['procurement_run_id','field_id','access_revision','triage_rule_ref','triage_rule_revision','triage_rule_authority_digest','run_basis_digest','state','candidate_package_revision_head'], keyColumns:['procurement_run_id'], safeIntegers:true },
    find_members:{ kind:'select-in', tableId:'proc_run_materials', keyColumn:'material_key', fixedKeyColumns:['procurement_run_id'], maxItems:500,
      columns:['ordinal','material_key','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','binding_revision','admitted_control_revision','admitted_control_projection_digest','selection_state','candidate_package_id'], safeIntegers:true },
    find_candidate:{ kind:'select-one', tableId:'proc_candidate_packages', columns:['candidate_package_id','package_digest'], keyColumns:['candidate_package_id'] },
    cas_run_head:{ kind:'update', tableId:'proc_procurement_runs', setColumns:['candidate_package_revision_head'], keyColumns:['procurement_run_id'], compareColumns:[{ column:'candidate_package_revision_head', parameter:'expected_head' },{ column:'run_basis_digest', parameter:'expected_run_basis_digest' }] },
    reserve_member:{ kind:'update', tableId:'proc_run_materials', setColumns:['selection_state','candidate_package_id','reservation_updated_at_ms'], keyColumns:['procurement_run_id','material_key'], compareColumns:[{ column:'selection_state', parameter:'expected_selection_state' },{ column:'binding_revision', parameter:'expected_binding_revision' },{ column:'admitted_control_revision', parameter:'expected_control_revision' },{ column:'admitted_control_projection_digest', parameter:'expected_control_digest' }] },
    insert_package:{ kind:'insert', tableId:'proc_candidate_packages', columns:['candidate_package_id','procurement_run_id','package_revision','field_id','field_access_revision','field_context_digest','media_type','content_profile','material_input_form','structure_kind','display_identity','identity_metadata_schema_ref','identity_metadata_json','identity_metadata_digest','identity_claim_schema_ref','identity_claim_json','identity_claim_digest','structure_evidence_id','structure_evidence_payload_digest','structure_unit_id','structure_unit_digest','triage_rule_ref','triage_rule_revision','triage_rule_authority_digest','primary_input_manifest_id','manifest_digest','related_reference_set_digest','member_control_evidence_set_digest','package_digest','state','published_at_ms'] },
    insert_continuity:{ kind:'insert', tableId:'proc_candidate_season_continuity_claims', columns:['candidate_package_id','claim_kind','claim_namespace','claim_key','claim_digest','evidence_digest'] },
    insert_primary:{ kind:'insert', tableId:'proc_candidate_primary_materials', columns:['candidate_package_id','ordinal','material_key','role','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','binding_revision','admitted_control_revision','admitted_control_projection_digest','member_digest'] },
    insert_episode:{ kind:'insert', tableId:'proc_candidate_primary_material_episode_claims', columns:['candidate_package_id','primary_ordinal','episode_key','season_claim_digest','claim_digest'] },
    insert_related:{ kind:'insert', tableId:'proc_candidate_related_references', columns:['candidate_package_id','reference_id','primary_ordinal','role',
      'material_key','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','endpoint_id','location',
      'association_evidence_digest','reference_digest'] },
    insert_delivery:{ kind:'insert', tableId:'proc_candidate_deliveries', columns:['offer_id','candidate_package_id','package_revision','package_digest',
      'acceptance_basis_digest','state','handoff_decision_id','handoff_decision_digest','handoff_receipt_id','handoff_receipt_digest',
      'terminal_evidence_digest','offered_at_ms','closed_at_ms'] }
  }});
}

function validateHandle(handle, draft) {
  if (!handle || handle.schemaRef !== 'helix://contracts/types/DomainFactCommitHandle/v1' || handle.schemaVersion !== 1 ||
      handle.ownerDomain !== 'procurement' || handle.aggregateType !== 'candidate_package' || handle.aggregateId !== draft.candidatePackageId ||
      handle.factType !== 'CandidateDraft' || handle.factSchemaRef !== DRAFT_SCHEMA || handle.expectedRevision !== 0 ||
      handle.payloadDigest !== canonicalDigest(draft) || handle.resultSchemaRef !== RECEIPT_SCHEMA ||
      typeof handle.commitIdempotencyKey !== 'string' || !handle.commitIdempotencyKey || !SHA256.test(handle.eventFenceDigest || '')) {
    fail('P7_CANDIDATE_HANDLE_MISMATCH', 'Domain Fact Commit Handle does not authorize this exact Candidate Draft and revision.');
  }
}

function parseReplay(repo, marker, draft, commitDigest) {
  if (marker.owner_domain !== 'procurement' || marker.scope_type !== 'candidate_package' || marker.scope_id !== draft.candidatePackageId ||
      marker.commit_digest !== commitDigest || marker.result_schema_ref !== RECEIPT_SCHEMA) fail('P7_CANDIDATE_MARKER_CONFLICT', 'Commit Marker belongs to another Candidate Publication.');
  const row = repo.invoke('find_result', { result_id:marker.result_id });
  if (!row || row.result_digest !== marker.result_digest || row.result_schema_ref !== RECEIPT_SCHEMA) fail('P7_CANDIDATE_REPLAY_CORRUPT', 'Candidate marker points to a missing Result.');
  let result, evidence;
  try { result = JSON.parse(row.result_json); evidence = JSON.parse(row.evidence_json); } catch { fail('P7_CANDIDATE_REPLAY_CORRUPT', 'Stored Candidate Result or Evidence is corrupt.'); }
  if (canonicalDigest(result) !== row.result_digest || canonicalDigest(evidence) !== row.evidence_digest ||
      result.candidatePackageId !== draft.candidatePackageId || result.candidateDraftDigest !== draft.candidateDraftDigest ||
      result.scopeDigest !== draft.candidateDraftDigest) {
    fail('P7_CANDIDATE_REPLAY_CORRUPT', 'Stored Candidate Result does not match the Draft revision.');
  }
  throw new Replay(Object.freeze(result), Object.freeze(evidence), marker.commit_marker);
}

function createCandidatePublicationStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork) fail('P7_CANDIDATE_DEPENDENCIES', 'Candidate Publication dependencies are required.');
  const foundation = foundationDefinition(options.schemaManifest);
  const procurement = procurementDefinition(options.schemaManifest);
  return Object.freeze({
    publish(request) {
      if (!request || !request.candidateDraft || !request.domainFactCommitHandle || !request.commitMarker || !request.resultBinding) {
        fail('P7_CANDIDATE_REQUEST_INVALID', 'Candidate Publication request is incomplete.');
      }
      const draft = request.candidateDraft;
      validateHandle(request.domainFactCommitHandle, draft);
      const markerId = request.commitMarker.commitMarker;
      const commitDigest = request.commitMarker.commitDigest;
      if (typeof markerId !== 'string' || !markerId || !SHA256.test(commitDigest || '') ||
          typeof request.resultBinding.resultId !== 'string' || !request.resultBinding.resultId ||
          typeof request.resultBinding.eventId !== 'string' || !request.resultBinding.eventId ||
          !request.resultBinding.evidence || request.resultBinding.evidence.schemaRef !== request.resultBinding.evidenceSchemaRef ||
          request.resultBinding.evidence.evidenceId !== draft.structureEvidence.evidenceId ||
          request.resultBinding.evidence.payloadDigest !== draft.structureEvidence.payloadDigest) {
        fail('P7_CANDIDATE_REQUEST_INVALID', 'Marker, Result binding, or typed Evidence is invalid.');
      }
      let publication, publicationReceipt;
      const preflight = { participantId:'candidate_publication_preflight', owner:'execution-foundation', boundBusinessOwner:'procurement', repositories:[foundation], execute(context) {
        const repo = context.repository(foundation.repositoryId);
        const marker = repo.invoke('find_marker', { commit_marker:markerId });
        if (marker) parseReplay(repo, marker, draft, commitDigest);
      }};
      const validate = { participantId:'candidate_publication_validate', owner:'procurement', repositories:[procurement], execute(context) {
        const repo = context.repository(procurement.repositoryId);
        if (repo.invoke('find_candidate', { candidate_package_id:draft.candidatePackageId })) fail('P7_CANDIDATE_ID_CONFLICT', 'Candidate Package already exists without this replay marker.');
        const run = repo.invoke('find_run', { procurement_run_id:draft.procurementRunId });
        if (!run || !['active','waiting'].includes(run.state) || run.run_basis_digest !== draft.runBasisDigest ||
            run.field_id !== draft.materialFieldContextRef.fieldId || Number(run.access_revision) !== draft.materialFieldContextRef.accessRevision ||
            run.triage_rule_ref !== draft.triageRule.ruleRef || Number(run.triage_rule_revision) !== draft.triageRule.revision ||
            run.triage_rule_authority_digest !== draft.triageRule.authorityDigest) {
          fail('P7_CANDIDATE_RUN_FENCE_STALE', 'Candidate Draft no longer matches the exact Run fence.');
        }
        const sourceMembers = Array.isArray(draft.structureEvidence.unit.members)
          ? draft.structureEvidence.unit.members
          : (draft.primaryInputManifestDraft && draft.primaryInputManifestDraft.members);
        if (!Array.isArray(sourceMembers)) fail('P7_CANDIDATE_MEMBER_FENCE_STALE', 'Candidate member source is unavailable for the immutable Run Selection.');
        const memberKeys=sourceMembers.map((member)=>member.materialKey);
        const memberRows=[];
        for(let offset=0;offset<memberKeys.length;offset+=500){
          memberRows.push(...repo.invoke('find_members',{procurement_run_id:draft.procurementRunId,
            values:memberKeys.slice(offset,offset+500)}));
        }
        const rows = new Map(memberRows.map((row) => [row.material_key, row]));
        const runBasisMembers = sourceMembers.map((member) => { const row=rows.get(member.materialKey); return row && {
          materialKey:row.material_key, physicalIdentity:{ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
            materialKey:row.material_key, mountScopeId:row.mount_scope_id, inode:String(row.inode), sizeBytes:Number(row.size_bytes),
            fingerprintAlgorithm:row.fingerprint_algorithm, fingerprintVersion:Number(row.fingerprint_version),
            contentFingerprint:row.content_fingerprint }, sizeBytes:Number(row.size_bytes) }; });
        if (runBasisMembers.some((item) => !item)) fail('P7_CANDIDATE_MEMBER_FENCE_STALE', 'Candidate member is absent from the immutable Run Selection.');
        const packageRevision = Number(run.candidate_package_revision_head) + 1;
        publication = buildPublication(draft, context.commitTimeMs, runBasisMembers, packageRevision);
        publicationReceipt = buildPublicationReceipt(publication, draft, context.commitTimeMs);
        for (const member of publication.manifest.members) {
          const row = rows.get(member.materialKey);
          if (!row || row.selection_state !== 'run_selection' || row.candidate_package_id !== null ||
              Number(row.binding_revision) !== member.bindingRevision || Number(row.admitted_control_revision) !== member.admittedControlRevision ||
              row.admitted_control_projection_digest !== member.admittedControlProjectionDigest) {
            fail('P7_CANDIDATE_MEMBER_FENCE_STALE', 'Candidate member is not the exact current Run Selection.');
          }
        }
        return publication.candidatePackage;
      }};
      const result = { participantId:'candidate_publication_result', owner:'execution-foundation', boundBusinessOwner:'procurement', repositories:[foundation], execute(context) {
        const typedResult = publicationReceipt;
        const resultJson = canonicalJson(typedResult);
        const evidenceJson = canonicalJson(request.resultBinding.evidence);
        if (Buffer.byteLength(resultJson) > 16384 || Buffer.byteLength(evidenceJson) > 65536) fail('P7_CANDIDATE_RESULT_TOO_LARGE', 'Candidate Receipt exceeds 16 KiB or Evidence exceeds 64 KiB.');
        context.repository(foundation.repositoryId).invoke('insert_result', { result_id:request.resultBinding.resultId, event_id:request.resultBinding.eventId,
          outcome_kind:'succeeded', result_schema_ref:RECEIPT_SCHEMA, result_json:resultJson, result_digest:canonicalDigest(typedResult),
          evidence_schema_ref:request.resultBinding.evidenceSchemaRef, evidence_json:evidenceJson,
          evidence_digest:canonicalDigest(request.resultBinding.evidence), effect_receipt_id:request.resultBinding.effectReceiptId || null,
          committed_at_ms:context.commitTimeMs });
        return typedResult;
      }};
      const marker = { participantId:'candidate_publication_marker', owner:'execution-foundation', boundBusinessOwner:'procurement', repositories:[foundation], execute(context) {
        context.repository(foundation.repositoryId).invoke('insert_marker', { commit_marker:markerId, effect_id:request.commitMarker.effectId || null,
          owner_domain:'procurement', scope_type:'candidate_package', scope_id:draft.candidatePackageId, commit_digest:commitDigest,
          result_id:request.resultBinding.resultId, result_schema_ref:RECEIPT_SCHEMA, result_digest:canonicalDigest(publicationReceipt),
          committed_at_ms:context.commitTimeMs });
      }};
      const write = { participantId:'candidate_publication_write', owner:'procurement', repositories:[procurement], execute(context) {
        const repo = context.repository(procurement.repositoryId), pkg = publication.candidatePackage, manifest = publication.manifest, unit = draft.structureEvidence.unit;
        const head = repo.invoke('cas_run_head', { candidate_package_revision_head:pkg.packageRevision, procurement_run_id:draft.procurementRunId,
          expected_head:pkg.packageRevision - 1, expected_run_basis_digest:draft.runBasisDigest });
        if (head.changes !== 1) fail('P7_CANDIDATE_RUN_CAS_CONFLICT', 'Run package revision head CAS failed.');
        const metadataJson = canonicalJson(pkg.identityMetadata), claimJson = canonicalJson(pkg.identityClaim);
        if (Buffer.byteLength(metadataJson) > 16384 || Buffer.byteLength(claimJson) > 16384) fail('P7_CANDIDATE_IDENTITY_TOO_LARGE', 'Candidate Identity JSON exceeds 16 KiB.');
        repo.invoke('insert_package', { candidate_package_id:pkg.candidatePackageId, procurement_run_id:pkg.procurementRunId,
          package_revision:pkg.packageRevision, field_id:pkg.materialFieldContextRef.fieldId, field_access_revision:pkg.materialFieldContextRef.accessRevision,
          field_context_digest:pkg.materialFieldContextRef.contextDigest, media_type:pkg.mediaType, content_profile:pkg.contentProfile,
          material_input_form:pkg.materialInputForm, structure_kind:unit.structureKind, display_identity:pkg.displayIdentity,
          identity_metadata_schema_ref:DRAFT_SCHEMA + '#/properties/identityMetadata', identity_metadata_json:metadataJson,
          identity_metadata_digest:pkg.identityMetadata.metadataDigest, identity_claim_schema_ref:pkg.identityClaim.schemaRef,
          identity_claim_json:claimJson, identity_claim_digest:pkg.identityClaim.claimDigest,
          structure_evidence_id:pkg.structureEvidenceRef.evidenceId, structure_evidence_payload_digest:pkg.structureEvidenceRef.payloadDigest,
          structure_unit_id:pkg.structureEvidenceRef.unitId, structure_unit_digest:pkg.structureEvidenceRef.unitDigest,
          triage_rule_ref:pkg.triageRule.ruleRef, triage_rule_revision:pkg.triageRule.revision,
          triage_rule_authority_digest:pkg.triageRule.authorityDigest, primary_input_manifest_id:manifest.manifestId,
          manifest_digest:manifest.manifestDigest, related_reference_set_digest:pkg.relatedReferenceSetDigest,
          member_control_evidence_set_digest:pkg.memberControlEvidenceSetDigest, package_digest:pkg.packageDigest,
          state:'published', published_at_ms:context.commitTimeMs });
        for (const claim of pkg.seasonContinuityClaims) repo.invoke('insert_continuity', { candidate_package_id:pkg.candidatePackageId,
          claim_kind:claim.claimKind, claim_namespace:claim.claimNamespace, claim_key:claim.claimKey,
          claim_digest:claim.claimDigest, evidence_digest:claim.evidenceDigest });
        const ordinals = new Map();
        for (const member of manifest.members) {
          ordinals.set(member.materialKey, member.ordinal);
          repo.invoke('insert_primary', { candidate_package_id:pkg.candidatePackageId, ordinal:member.ordinal, material_key:member.materialKey,
            role:member.role, mount_scope_id:member.physicalIdentity.mountScopeId, inode:member.physicalIdentity.inode,
            size_bytes:member.physicalIdentity.sizeBytes, fingerprint_algorithm:member.physicalIdentity.fingerprintAlgorithm,
            fingerprint_version:member.physicalIdentity.fingerprintVersion, content_fingerprint:member.physicalIdentity.contentFingerprint,
            binding_revision:member.bindingRevision, admitted_control_revision:member.admittedControlRevision,
            admitted_control_projection_digest:member.admittedControlProjectionDigest, member_digest:member.memberDigest });
          for (const episode of member.episodeClaims) repo.invoke('insert_episode', { candidate_package_id:pkg.candidatePackageId,
            primary_ordinal:member.ordinal, episode_key:episode.episodeKey, season_claim_digest:episode.seasonClaimDigest,
            claim_digest:episode.claimDigest });
          const reserved = repo.invoke('reserve_member', { selection_state:'candidate_delivery', candidate_package_id:pkg.candidatePackageId,
            reservation_updated_at_ms:context.commitTimeMs, procurement_run_id:draft.procurementRunId, material_key:member.materialKey,
            expected_selection_state:'run_selection', expected_binding_revision:member.bindingRevision,
            expected_control_revision:member.admittedControlRevision, expected_control_digest:member.admittedControlProjectionDigest });
          if (reserved.changes !== 1) fail('P7_CANDIDATE_MEMBER_CAS_CONFLICT', 'Candidate member Reservation CAS failed.');
        }
        for (const reference of pkg.relatedReferences) {
          const ordinal = ordinals.get(reference.primaryMaterialKey);
          if (ordinal === undefined) fail('P7_CANDIDATE_RELATED_PRIMARY_MISSING', 'Related Reference points outside the final Manifest.');
          repo.invoke('insert_related', { candidate_package_id:pkg.candidatePackageId, reference_id:reference.referenceId,
            primary_ordinal:ordinal, role:reference.role, material_key:reference.identity.materialKey,
            mount_scope_id:reference.identity.mountScopeId, inode:reference.identity.inode, size_bytes:reference.identity.sizeBytes,
            fingerprint_algorithm:reference.identity.fingerprintAlgorithm, fingerprint_version:reference.identity.fingerprintVersion,
            content_fingerprint:reference.identity.contentFingerprint, endpoint_id:reference.endpointId, location:reference.location,
            association_evidence_digest:reference.associationEvidenceDigest, reference_digest:reference.referenceDigest });
        }
        repo.invoke('insert_delivery', { offer_id:publication.offerId, candidate_package_id:pkg.candidatePackageId,
          package_revision:pkg.packageRevision, package_digest:pkg.packageDigest,
          acceptance_basis_digest:publication.acceptanceBasis.acceptanceBasisDigest, state:'open', handoff_decision_id:null,
          handoff_decision_digest:null, handoff_receipt_id:null, handoff_receipt_digest:null, terminal_evidence_digest:null,
          offered_at_ms:context.commitTimeMs, closed_at_ms:null });
        return pkg;
      }};
      const outbox = { participantId:'candidate_publication_outbox', owner:'execution-foundation', boundBusinessOwner:'procurement', repositories:[foundation], execute(context) {
        const payloadJson = canonicalJson(publication.offerMessage);
        if (Buffer.byteLength(payloadJson) > 16384) fail('P7_CANDIDATE_OUTBOX_TOO_LARGE', 'Candidate Offer payload exceeds 16 KiB.');
        context.repository(foundation.repositoryId).invoke('insert_outbox', { message_id:publication.messageId, producer_domain:'procurement',
          message_kind:'procurement_candidate_offer_available', aggregate_type:'candidate_package', aggregate_id:draft.candidatePackageId,
          aggregate_revision:publication.candidatePackage.packageRevision, dedup_key:publication.dedupKey,
          consumer_set_digest:canonicalDigest(['libra']), intended_consumer_count:1,
          payload_schema_ref:OFFER_MESSAGE_SCHEMA, payload_json:payloadJson, payload_digest:canonicalDigest(publication.offerMessage),
          state:'pending', available_at_ms:context.commitTimeMs, created_at_ms:context.commitTimeMs, all_acked_at_ms:null });
        context.repository(foundation.repositoryId).invoke('insert_outbox_delivery', { message_id:publication.messageId,
          consumer_domain:'libra', state:'pending', attempt_count:0, next_attempt_at_ms:context.commitTimeMs, acked_at_ms:null });
        return Object.freeze({ messageId:publication.messageId, offerId:publication.offerId });
      }};
      try {
        const results = options.unitOfWork.execute([preflight, validate, result, marker, write, outbox]);
        return Object.freeze({ replayed:false, typedResult:results.candidate_publication_result,
          typedEvidence:request.resultBinding.evidence, commitMarker:markerId, outboxResult:results.candidate_publication_outbox,
          acceptanceBasis:publication.acceptanceBasis });
      } catch (error) {
        if (error instanceof Replay) return Object.freeze({ replayed:true, typedResult:error.result, typedEvidence:error.evidence,
          commitMarker:error.marker, outboxResult:undefined, acceptanceBasis:undefined });
        throw error;
      }
    }
  });
}

module.exports = Object.freeze({ CandidatePublicationStoreError, DRAFT_SCHEMA, createCandidatePublicationStore });
