'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { buildDecisionInputSet, decisionHeadDigest } = require('../model/decision-front-half-contracts');
const { createFieldRoutingPolicyStore } = require('../persistence/field-routing-policy-store');

function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function number(value) { return Number(value); }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function normalize(value) { return String(value || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' '); }

function createRoutingContextReader(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.readArcaRoutingTargets !== 'function') {
    throw new TypeError('Routing Context Reader requires Libra persistence and the Arca public projection.');
  }
  const policies = createFieldRoutingPolicyStore(options);
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_routing_context_reader', owner: 'libra', schemaManifest: options.schemaManifest, statements: {
      find_subject: { kind: 'select-one', tableId: 'libra_subjects', columns: [
        'subject_id', 'structure_kind', 'content_profile', 'routing_anchor_intake_decision_id', 'status', 'intake_revision',
        'current_continuity_set_digest', 'current_episode_scope_digest', 'current_identity_revision'
      ], keyColumns: ['subject_id'] },
      find_intake: { kind: 'select-one', tableId: 'libra_intake_decisions', columns: [
        'intake_decision_id', 'candidate_package_id', 'package_revision', 'package_digest', 'candidate_delivery_snapshot_digest',
        'candidate_delivery_snapshot_json', 'source_field_id', 'source_field_access_revision', 'source_field_context_digest',
        'candidate_identity_claim_digest', 'accepted_result', 'target_subject_id', 'decision_identity_evidence_schema_ref',
        'decision_identity_evidence_digest'
      ], keyColumns: ['intake_decision_id'] },
      find_identity: { kind: 'select-one', tableId: 'libra_product_identity_revisions', columns: [
        'subject_id', 'revision', 'identity_digest'
      ], keyColumns: ['subject_id', 'revision'] },
      find_head: { kind: 'select-one', tableId: 'libra_subject_decision_heads', columns: [
        'subject_id', 'head_revision', 'head_digest', 'current_routing_decision_id', 'current_decision_basis_id',
        'current_acceptance_spec_id', 'updated_at_ms'
      ], keyColumns: ['subject_id'] },
      find_current_decision: { kind: 'select-one', tableId: 'libra_routing_decisions', columns: [
        'routing_decision_id', 'subject_id', 'decision_revision', 'decision', 'shelf_id', 'unresolved_reason_code',
        'routing_authority_kind', 'routing_policy_id', 'routing_policy_revision', 'manual_selection_digest', 'decision_digest'
      ], keyColumns: ['subject_id', 'decision_revision'] },
      list_decisions: { kind: 'select-all', tableId: 'libra_routing_decisions', columns: [
        'routing_decision_id', 'subject_id', 'decision_revision', 'decision', 'shelf_id', 'unresolved_reason_code',
        'assessment_id', 'routing_authority_kind', 'routing_policy_id', 'routing_policy_revision', 'manual_selection_digest',
        'routing_input_digest', 'shelf_priority_set_digest', 'decision_digest', 'decided_at_ms'
      ], keyColumns: ['subject_id'] },
      find_assessment: { kind: 'select-one', tableId: 'libra_routing_assessments', columns: [
        'routing_assessment_id', 'decision_basis_id'
      ], keyColumns: ['routing_assessment_id'] },
      list_active_subjects: { kind: 'select-all', tableId: 'libra_subjects', columns: [
        'subject_id', 'routing_anchor_intake_decision_id'
      ], keyColumns: ['status'] },
    },
  });

  function readRows(subjectId) {
    return options.unitOfWork.execute([{ participantId: 'libra_routing_context_read', owner: 'libra', repositories: [repository], execute(context) {
      const repo = context.repository(repository.repositoryId);
      const subject = repo.invoke('find_subject', { subject_id: subjectId });
      if (!subject) return null;
      const decisions = Object.freeze(repo.invoke('list_decisions', { subject_id: subjectId }));
      return Object.freeze({
        subject,
        intake: repo.invoke('find_intake', { intake_decision_id: subject.routing_anchor_intake_decision_id }),
        identity: subject.current_identity_revision === null ? null : repo.invoke('find_identity', {
          subject_id: subjectId, revision: number(subject.current_identity_revision),
        }),
        head: repo.invoke('find_head', { subject_id: subjectId }),
        decisions,
        assessmentBasisById: Object.freeze(Object.fromEntries(decisions.map((decision) => {
          const assessment = repo.invoke('find_assessment', { routing_assessment_id: decision.assessment_id });
          return [decision.assessment_id, assessment?.decision_basis_id || null];
        }))),
      });
    } }]).libra_routing_context_read;
  }

  function headSnapshot(subjectId, row) {
    if (!row) {
      const value = { subjectId, headState: 'absent', headRevision: 0, headDigest: null, currentRoutingDecisionId: null,
        currentDecisionBasisId: null, currentAcceptanceSpecId: null };
      return Object.freeze({ ...value, snapshotDigest: canonicalDigest({ schema: 'libra.subject-decision-head-snapshot@1', ...value }) });
    }
    const value = { subjectId, headState: 'present', headRevision: number(row.head_revision), headDigest: row.head_digest,
      currentRoutingDecisionId: row.current_routing_decision_id, currentDecisionBasisId: row.current_decision_basis_id,
      currentAcceptanceSpecId: row.current_acceptance_spec_id };
    const expected = decisionHeadDigest(subjectId, value.headRevision, value.currentRoutingDecisionId,
      value.currentDecisionBasisId, value.currentAcceptanceSpecId);
    if (expected !== value.headDigest) throw new Error('Routing Decision Head is corrupt.');
    return Object.freeze({ ...value, snapshotDigest: canonicalDigest({ schema: 'libra.subject-decision-head-snapshot@1', ...value }) });
  }

  function subjectSnapshot(rows) {
    const subject = rows.subject, intake = rows.intake;
    if (subject.status !== 'active' || !intake || !['new_subject', 'season_extension'].includes(intake.accepted_result) ||
        intake.target_subject_id !== subject.subject_id) throw new Error('Routing requires an active accepted Subject.');
    const provenance = {
      candidatePackageId: intake.candidate_package_id, sourceFieldId: intake.source_field_id,
      sourceFieldAccessRevision: number(intake.source_field_access_revision), sourceFieldContextDigest: intake.source_field_context_digest,
      candidateIdentityClaimDigest: intake.candidate_identity_claim_digest,
      ...(intake.decision_identity_evidence_digest ? {
        decisionIdentityEvidenceSchemaRef: intake.decision_identity_evidence_schema_ref,
        decisionIdentityEvidenceSourceId: intake.intake_decision_id,
        decisionIdentityEvidenceRevision: 1,
        decisionIdentityEvidenceDigest: intake.decision_identity_evidence_digest,
      } : {}),
    };
    const value = { subjectId: subject.subject_id, status: 'active', intakeRevision: number(subject.intake_revision),
      structureKind: subject.structure_kind, contentProfile: subject.content_profile,
      routingAnchorIntakeDecisionId: subject.routing_anchor_intake_decision_id, routingProvenance: provenance,
      currentIdentityRevision: rows.identity ? number(rows.identity.revision) : null,
      currentIdentityDigest: rows.identity ? rows.identity.identity_digest : null,
      continuitySetDigest: subject.current_continuity_set_digest, episodeScopeDigest: subject.current_episode_scope_digest };
    return Object.freeze({ ...value, snapshotDigest: canonicalDigest(value) });
  }

  function localFact(subject, factKind, value) {
    const body = { factKind, sourceObjectId: subject.subjectId, sourceRevision: subject.intakeRevision,
      schemaRef: 'RoutingDecisionFact@1', ...(factKind === 'material_field' ? { fieldId: value } : { value }) };
    return Object.freeze({ ...body, factDigest: canonicalDigest(body) });
  }

  function authority(policy) {
    const body = { authorityKind: 'policy', policy };
    return Object.freeze({ ...body, authorityDigest: canonicalDigest(body) });
  }

  function parseSnapshot(intake) {
    try {
      const value = JSON.parse(intake.candidate_delivery_snapshot_json);
      if (value.deliverySnapshotDigest !== intake.candidate_delivery_snapshot_digest) throw new Error('digest');
      return value;
    } catch (_error) {
      throw new Error('Accepted Candidate Delivery Snapshot is corrupt.');
    }
  }

  function read(subjectId) {
    const rows = readRows(subjectId);
    if (!rows) return null;
    const subject = subjectSnapshot(rows), deliverySnapshot = parseSnapshot(rows.intake);
    const policy = policies.current(subject.routingProvenance.sourceFieldId);
    const projections = Object.freeze(options.readArcaRoutingTargets());
    const byShelf = new Map(projections.map((item) => [item.shelfId, item]));
    const currentDecision = [...rows.decisions].sort((a, b) => number(b.decision_revision) - number(a.decision_revision))[0] || null;
    return Object.freeze({ rows, subject, deliverySnapshot, policy, projections, byShelf,
      expectedHead: headSnapshot(subjectId, rows.head), currentDecision });
  }

  function collectFactKinds(expression, target = new Set()) {
    if (!expression) return target;
    if (expression.nodeKind === 'predicate') target.add(expression.factKind);
    if (Array.isArray(expression.children)) expression.children.forEach((child) => collectFactKinds(child, target));
    if (expression.child) collectFactKinds(expression.child, target);
    return target;
  }

  function requiredExternalFactKinds(context) {
    if (!context?.policy) return Object.freeze([]);
    const kinds = new Set();
    context.policy.targets.forEach((target) => collectFactKinds(target.matchExpression, kinds));
    return Object.freeze([...kinds].filter((kind) => ['release_year', 'region', 'genre', 'resolved_provider_identity'].includes(kind)).sort());
  }

  function nfoReference(context) {
    const values = (context.deliverySnapshot.candidatePackage.relatedReferences || []).filter((item) => item.role === 'nfo');
    return values.length === 1 ? values[0] : null;
  }

  function factObservationIntent(context, sourceKind, requestedFactKinds, observations = []) {
    const identityClaim = context.deliverySnapshot.candidatePackage.identityClaim;
    const common = { subjectId: context.subject.subjectId,
      routingAnchorIntakeDecisionId: context.subject.routingAnchorIntakeDecisionId,
      routingAnchorDigest: context.subject.routingProvenance.decisionIdentityEvidenceDigest || context.deliverySnapshot.deliverySnapshotDigest,
      contentProfile: 'movie', identityClaim, requestedFactKinds: Object.freeze([...requestedFactKinds]), sourceKind };
    let source;
    if (sourceKind === 'related_nfo') {
      const reference = nfoReference(context);
      if (!reference) return null;
      source = { relatedReferenceId: reference.referenceId, relatedReferenceDigest: reference.referenceDigest,
        expectedPhysicalIdentityDigest: canonicalDigest(reference.identity) };
    } else {
      const observedYear = observations.flatMap((item) => item.facts || []).find((item) => item.factKind === 'release_year')?.year ?? null;
      source = { integrationId: options.routingProvider?.integrationId || 'tmdb-main', configRevision: options.routingProvider?.configRevision || 1,
        providerKind: 'tmdb', candidateDisplayTitle: identityClaim.claimedTitle, yearHint: observedYear,
        strongProviderAnchor: null };
    }
    const intentBody = { ...common, ...source };
    const intentDigest = canonicalDigest(intentBody);
    const intentId = canonicalDigest({ schema: 'libra.routing-fact-observation-intent-id@1',
      subjectId: intentBody.subjectId, sourceKind: intentBody.sourceKind, intentDigest });
    return Object.freeze({ intentId, ...intentBody, intentDigest });
  }

  function nfoReadHandle(context) {
    const reference = nfoReference(context);
    if (!reference) return null;
    const body = { identity: reference.identity, ownerDomain: 'libra', ownerScope: { scopeType: 'subject', scopeId: context.subject.subjectId },
      bindingRevision: 1, endpointId: reference.endpointId, location: reference.location, mountScopeRevision: 1,
      expectedSizeBytes: reference.identity.sizeBytes, expectedMtimeNs: 0, expectedCtimeNs: 0, fingerprintVerifiedAtMs: 0,
      readScope: 'routing_related_nfo_bounded_read', expiresAtMs: Number.MAX_SAFE_INTEGER };
    return Object.freeze({ schemaRef: 'helix://contracts/types/PhysicalMaterialReadHandle/v1', schemaVersion: 1,
      handleId: stable('libra-routing-nfo-handle-', { subjectId: context.subject.subjectId, referenceDigest: reference.referenceDigest }),
      ...body, fenceDigest: canonicalDigest({ schema: 'libra.routing-nfo-read-fence@1', ...body }) });
  }

  function buildInputSet(subjectId, observations, manualIntent = null) {
    const context = read(subjectId);
    if (!context) throw new Error('Routing Subject was not found.');
    const routingAuthority = manualIntent ? Object.freeze({ authorityKind: 'manual_selection', manualIntent,
      authorityDigest: canonicalDigest({ authorityKind: 'manual_selection', manualIntent }) }) : authority(context.policy);
    const targetIds = manualIntent ? [manualIntent.targetShelfId] : context.policy.targets.map((target) => target.shelfId);
    const targets = targetIds.map((shelfId) => context.byShelf.get(shelfId)).filter(Boolean);
    if (targets.length !== targetIds.length) throw new Error('Routing Shelf projection is unavailable.');
    const facts = [
      localFact(context.subject, 'content_profile', context.subject.contentProfile),
      localFact(context.subject, 'material_field', context.subject.routingProvenance.sourceFieldId),
      localFact(context.subject, 'structure_kind', context.subject.structureKind),
      ...observations.flatMap((item) => item.result === 'observed' ? item.facts : []),
    ];
    const unique = new Map(), conflicts = new Set();
    for (const fact of facts) {
      if (unique.has(fact.factKind) && unique.get(fact.factKind).factDigest !== fact.factDigest) {
        unique.delete(fact.factKind); conflicts.add(fact.factKind); continue;
      }
      if (conflicts.has(fact.factKind)) continue;
      unique.set(fact.factKind, fact);
    }
    return buildDecisionInputSet({ basisKind: 'routing', subjectSnapshot: context.subject, expectedDecisionHead: context.expectedHead,
      readiness: { result: 'ready' }, routingAuthoritySnapshot: routingAuthority, shelfRoutingTargets: Object.freeze(targets),
      routingDecision: null, shelfStandardProjection: null, productScope: null,
      decisionFacts: Object.freeze([...unique.values()]), queryResults: Object.freeze([]) });
  }

  function currentState(subjectId) {
    const context = read(subjectId);
    if (!context) return null;
    const row = context.currentDecision;
    const policyRow = [...context.rows.decisions].filter((item) => item.routing_authority_kind === 'policy')
      .sort((a, b) => number(b.decision_revision) - number(a.decision_revision))[0] || null;
    return Object.freeze({ context, decision: row ? Object.freeze({ routingDecisionId: row.routing_decision_id,
      decisionRevision: number(row.decision_revision), result: row.decision, targetShelfId: row.shelf_id,
      unresolvedReasonCode: row.unresolved_reason_code, routingPolicyId: row.routing_policy_id,
      routingPolicyRevision: row.routing_policy_revision === null ? null : number(row.routing_policy_revision),
      routingAuthorityKind: row.routing_authority_kind, manualSelectionDigest: row.manual_selection_digest,
      decisionDigest: row.decision_digest }) : null,
    latestPolicyDecision: policyRow ? Object.freeze({ routingPolicyId: policyRow.routing_policy_id,
      routingPolicyRevision: number(policyRow.routing_policy_revision) }) : null });
  }

  function currentRoutingDecision(subjectId) {
    const context=read(subjectId),row=context?.currentDecision;
    if(!row)return null;
    const value={routingDecisionId:row.routing_decision_id,subjectId:row.subject_id,decisionRevision:number(row.decision_revision),assessmentId:row.assessment_id,
      decisionBasisId:context.rows.assessmentBasisById[row.assessment_id],routingAuthorityKind:row.routing_authority_kind,routingPolicyId:row.routing_policy_id,
      routingPolicyRevision:row.routing_policy_revision===null?null:number(row.routing_policy_revision),manualSelectionDigest:row.manual_selection_digest,
      routingInputDigest:row.routing_input_digest,shelfPrioritySetDigest:row.shelf_priority_set_digest,result:row.decision,targetShelfId:row.shelf_id,
      unresolvedReasonCode:row.unresolved_reason_code,decisionDigest:row.decision_digest};
    if(canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='decisionDigest')))!==value.decisionDigest)throw new Error('Routing Decision digest is corrupt.');
    return Object.freeze(value);
  }

  function listActiveSubjectPage(cursor = null, limit = 100, fieldId = null) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Routing Subject page limit must be 1..100.');
    const values = options.unitOfWork.execute([{ participantId: 'libra_routing_subject_page', owner: 'libra', repositories: [repository], execute(context) {
      const repo = context.repository(repository.repositoryId);
      return repo.invoke('list_active_subjects', { status: 'active' }).map((subject) => {
        const intake = repo.invoke('find_intake', { intake_decision_id: subject.routing_anchor_intake_decision_id });
        return intake ? { subjectId: subject.subject_id, fieldId: intake.source_field_id } : null;
      }).filter(Boolean).filter((item) => fieldId === null || item.fieldId === fieldId).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
    } }]).libra_routing_subject_page;
    const start = cursor === null ? 0 : values.findIndex((item) => item.subjectId > cursor);
    if (start < 0) return Object.freeze({ items: Object.freeze([]), nextCursor: null });
    const items = Object.freeze(values.slice(start, start + limit).map(Object.freeze));
    return Object.freeze({ items, nextCursor: start + limit < values.length ? items.at(-1).subjectId : null });
  }

  return Object.freeze({ read, currentState, currentRoutingDecision, requiredExternalFactKinds, factObservationIntent, nfoReadHandle, buildInputSet,
    listActiveSubjectPage, normalizeTitle: normalize, policies });
}

module.exports = Object.freeze({ createRoutingContextReader });
