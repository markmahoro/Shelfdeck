'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const PAGE_SIZE = 100;
function parse(value) { try { return value ? JSON.parse(value) : null; } catch { return null; } }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function chunks(values, size = 500) { const result = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size)); return result; }
function latest(rows, revisionKey) { return rows.slice().sort((a, b) => Number(b[revisionKey]) - Number(a[revisionKey]))[0] || null; }

function requirementLabel(spec) {
  const requirements = parse(spec?.spec_json)?.requirements;
  if (!requirements) return '正在确认整理要求';
  const media = requirements.mandatoryMedia || {}, space = requirements.space || {};
  const artifacts = requirements.metadata?.requiredArtifactKinds || [], parts = [];
  if (media.videoCodec && media.videoCodec !== 'any') parts.push(String(media.videoCodec).toUpperCase());
  if (media.minimumRasterClass && media.minimumRasterClass !== 'none') parts.push(media.minimumRasterClass);
  if (space.maxSizeGiB !== null && space.maxSizeGiB !== undefined) parts.push('不超过 ' + space.maxSizeGiB + ' GiB');
  if (artifacts.length) parts.push('补齐 ' + artifacts.join('、'));
  return parts.length ? parts.join(' · ') : '保持原媒体并完成资料';
}
function actionLabel(works) {
  const refs = works.flatMap((work) => work.events.map((event) => event.capabilityRef));
  if (refs.some((ref) => ref.startsWith('libra.external_material.'))) return '外部获取';
  if (refs.includes('libra.media.transcode@1')) return '视频转码';
  if (refs.includes('libra.media.remux@1')) return '封装整理（Remux）';
  if (refs.some((ref) => ref === 'libra.product_artifact.acquire@1' || ref === 'libra.product_sidecar.render@1')) return '资料补齐';
  if (refs.some((ref) => ['libra.product.conformance.verify@1', 'libra.product_package.publish@1'].includes(ref))) return '直接采用并验证';
  return '尚未形成整理动作';
}
function identityIssue(works) {
  const result = works.flatMap((work) => work.events)
    .filter((event) => event.result?.resultSchemaRef === 'helix://contracts/types/ProductIdentityEvidenceObservation/v1')
    .sort((a, b) => (b.result?.committedAtMs || 0) - (a.result?.committedAtMs || 0))[0]?.result?.result;
  if (!result || result.result === 'resolved') return null;
  return Object.freeze({ result: result.result, reasonCode: result.reasonCode, candidateSetDigest: result.evidenceDigest, candidates: Object.freeze(result.candidates || []) });
}
function productionStarted(works) {
  const kinds = new Set(['product_metadata_observation', 'product_fact_assembly', 'workspace_media_production', 'artifact_production', 'product_conformance', 'deliverable_promotion']);
  return works.some((work) => kinds.has(work.workKind) && (work.state === 'succeeded' || work.events.some((event) => ['executing', 'succeeded'].includes(event.state))));
}
function nextAction(works, classification, issue) {
  if (classification === 'completed') return Object.freeze({ label: '等待收藏架接收', state: 'completed', progress: null });
  if (issue) return Object.freeze({ label: issue.result === 'ambiguous' ? '需要确认媒体身份' : issue.result === 'conflicting' ? '媒体身份信息冲突' : '暂未找到匹配的媒体身份', state: 'attention_required', progress: null });
  const open = works.filter((work) => !['succeeded', 'failed', 'cancelled'].includes(work.state)).sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
  if (!open) return Object.freeze({ label: classification === 'waiting' ? '正在确认目标、评分、要求或身份' : '准备下一项整理工作', state: 'pending', progress: null });
  const event = open.events.find((item) => ['executing', 'ready', 'waiting_resource', 'waiting_external'].includes(item.state)) || open.events[0];
  const labels = { product_identity: '确认媒体身份', product_metadata_observation: '补齐媒体资料', artifact_production: '生成或获取海报与 NFO', workspace_media_production: '处理视频文件', product_conformance: '验证整理结果', deliverable_promotion: '发布整理结果' };
  return Object.freeze({ label: labels[open.workKind] || '继续整理媒体', state: event?.state || open.state, progress: event?.progress || null });
}

function createFormationQuery(options) {
  const repository = createRepositoryDefinition({ repositoryId: 'libra_formation_query', owner: 'libra', schemaManifest: options.schemaManifest, statements: {
    page_subjects: { kind: 'select-page-after', tableId: 'libra_subjects', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['subject_id', 'structure_kind', 'content_profile', 'routing_anchor_intake_decision_id', 'status', 'intake_revision', 'current_identity_revision', 'created_at_ms', 'updated_at_ms'], safeIntegers: true },
    find_decisions: { kind: 'select-in', tableId: 'libra_intake_decisions', keyColumn: 'target_subject_id', maxItems: PAGE_SIZE, columns: ['intake_decision_id', 'candidate_delivery_snapshot_json', 'target_subject_id', 'decided_at_ms'], safeIntegers: true },
    find_bindings: { kind: 'select-in', tableId: 'libra_material_bindings', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['subject_id', 'authority_kind', 'current'], safeIntegers: true },
    find_routing_decisions: { kind: 'select-in', tableId: 'libra_routing_decisions', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['routing_decision_id', 'subject_id', 'decision_revision', 'decision', 'shelf_id', 'unresolved_reason_code', 'routing_policy_id', 'routing_policy_revision', 'decision_digest'], safeIntegers: true },
    find_routing_policies: { kind: 'select-in', tableId: 'libra_routing_policy_revisions', keyColumn: 'routing_policy_id', maxItems: PAGE_SIZE, columns: ['routing_policy_id', 'revision', 'mode'], safeIntegers: true },
    find_decision_heads: { kind: 'select-in', tableId: 'libra_subject_decision_heads', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['subject_id', 'head_revision', 'head_digest', 'current_acceptance_spec_id'], safeIntegers: true },
    find_acceptance_specs: { kind: 'select-in', tableId: 'libra_acceptance_specs', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['acceptance_spec_id', 'subject_id', 'spec_revision', 'spec_json', 'spec_digest', 'shelf_id', 'published_at_ms'], safeIntegers: true },
    find_runs: { kind: 'select-in', tableId: 'libra_runs', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['libra_run_id', 'subject_id', 'state', 'state_revision', 'state_digest', 'priority_class', 'package_revision_head', 'created_at_ms'], safeIntegers: true },
    find_packages: { kind: 'select-in', tableId: 'libra_product_packages', keyColumn: 'libra_run_id', maxItems: 500, columns: ['on_deck_package_id', 'offer_id', 'libra_run_id', 'package_revision', 'package_digest', 'state', 'published_at_ms'], safeIntegers: true },
  } });

  function readPage(cursor) {
    return options.unitOfWork.execute([{ participantId: 'libra_formation_subject_page', owner: 'libra', repositories: [repository], execute(context) {
      return context.repository(repository.repositoryId).invoke('page_subjects', { cursor, limit: PAGE_SIZE });
    } }]).libra_formation_subject_page;
  }
  function readBatch(subjects) {
    const subjectIds = subjects.map((row) => row.subject_id);
    return options.unitOfWork.execute([{ participantId: 'libra_formation_batch', owner: 'libra', repositories: [repository], execute(context) {
      const repo = context.repository(repository.repositoryId);
      const decisions = repo.invoke('find_decisions', { values: subjectIds });
      const bindings = repo.invoke('find_bindings', { values: subjectIds });
      const routingDecisions = repo.invoke('find_routing_decisions', { values: subjectIds });
      const policyIds = unique(routingDecisions.map((row) => row.routing_policy_id));
      const routingPolicies = policyIds.length ? repo.invoke('find_routing_policies', { values: policyIds }) : [];
      const decisionHeads = repo.invoke('find_decision_heads', { values: subjectIds });
      const acceptanceSpecs = repo.invoke('find_acceptance_specs', { values: subjectIds });
      const runs = repo.invoke('find_runs', { values: subjectIds });
      const runIds = unique(runs.map((row) => row.libra_run_id));
      const packages = runIds.length ? chunks(runIds).flatMap((values) => repo.invoke('find_packages', { values })) : [];
      return { decisions, bindings, routingDecisions, routingPolicies, decisionHeads, acceptanceSpecs, runs, packages };
    } }]).libra_formation_batch;
  }
  function buildBatch(subjects) {
    const value = readBatch(subjects), runIds = unique(value.runs.map((row) => row.libra_run_id));
    const progress = runIds.length ? chunks(runIds).flatMap((ids) => options.progressProjectionReader?.read(ids) || []) : [];
    const progressByRun = new Map(runIds.map((id) => [id, progress.filter((item) => item.processId === id)]));
    const prepared = subjects.map((subject) => {
      const decisions = value.decisions.filter((item) => item.target_subject_id === subject.subject_id).sort((a, b) => Number(a.decided_at_ms) - Number(b.decided_at_ms));
      const anchor = decisions.find((item) => item.intake_decision_id === subject.routing_anchor_intake_decision_id) || decisions[0];
      const snapshot = parse(anchor?.candidate_delivery_snapshot_json), claim = snapshot?.candidatePackage?.identityClaim || {};
      const displayIdentity = snapshot?.candidatePackage?.displayIdentity || claim.claimedDisplayIdentity || subject.subject_id;
      return { subject, decisions, displayIdentity, ratingTarget: { targetType: 'subject', targetId: subject.subject_id, targetRevision: Number(subject.intake_revision), title: claim.claimedTitle || claim.displayTitle || displayIdentity, year: Number.isSafeInteger(claim.claimedYear) ? claim.claimedYear : null, providerIdentity: null, subjectSnapshotDigest: snapshot?.snapshotDigest || snapshot?.candidateDeliverySnapshotDigest || null } };
    });
    const ratings = options.readPerceptionRatings?.(prepared.map((item) => item.ratingTarget)) || new Map();
    return prepared.map(({ subject, decisions, displayIdentity }) => {
      const bindings = value.bindings.filter((item) => item.subject_id === subject.subject_id && Number(item.current) === 1);
      const routing = latest(value.routingDecisions.filter((item) => item.subject_id === subject.subject_id), 'decision_revision');
      const policy = routing ? value.routingPolicies.find((item) => item.routing_policy_id === routing.routing_policy_id && Number(item.revision) === Number(routing.routing_policy_revision)) : null;
      const head = value.decisionHeads.find((item) => item.subject_id === subject.subject_id) || null;
      const spec = head?.current_acceptance_spec_id ? value.acceptanceSpecs.find((item) => item.acceptance_spec_id === head.current_acceptance_spec_id) : null;
      const runs = value.runs.filter((item) => item.subject_id === subject.subject_id).sort((a, b) => Number(b.created_at_ms) - Number(a.created_at_ms));
      const run = runs.find((item) => ['active', 'suspended', 'frozen'].includes(item.state)) || runs[0] || null;
      const pkg = run ? latest(value.packages.filter((item) => item.libra_run_id === run.libra_run_id), 'package_revision') : null;
      const works = run ? progressByRun.get(run.libra_run_id) || [] : [], issue = identityIssue(works);
      const classification = pkg && pkg.state === 'published' ? 'completed' : productionStarted(works) ? 'in_progress' : 'waiting';
      const rating = ratings.get(subject.subject_id) || null;
      return Object.freeze({ formationViewId: subject.subject_id, subjectId: subject.subject_id, displayIdentity, contentProfile: subject.content_profile, structureKind: subject.structure_kind, status: subject.status, classification, myRating: rating?.rating ?? null, myRatingSource: rating?.sourceKind || null, productIdentityIssue: issue, targetShelfId: routing?.shelf_id || null, routingState: routing?.decision || 'preparing', unresolvedReasonCode: routing?.unresolved_reason_code || null, routingPolicyMode: policy?.mode || null, routingPolicyRevision: routing?.routing_policy_revision === null ? null : Number(routing?.routing_policy_revision), routingDecisionRevision: routing ? Number(routing.decision_revision) : null, routingDecisionDigest: routing?.decision_digest || null, routingDecisionHeadRevision: head ? Number(head.head_revision) : null, routingDecisionHeadDigest: head?.head_digest || null, acceptanceSpecId: spec?.acceptance_spec_id || null, acceptanceSpecRevision: spec ? Number(spec.spec_revision) : null, acceptanceSpecDigest: spec?.spec_digest || null, acceptanceSpecPublishedAtMs: spec ? Number(spec.published_at_ms) : null, primaryMaterialCount: bindings.filter((item) => item.authority_kind === 'primary_control').length, addedAtMs: decisions.length ? Number(decisions.at(-1).decided_at_ms) : Number(subject.updated_at_ms), organizingRequirement: requirementLabel(spec), organizingAction: actionLabel(works), nextAction: nextAction(works, classification, issue), currentRun: run ? Object.freeze({ libraRunId: run.libra_run_id, state: run.state, stateRevision: Number(run.state_revision), stateDigest: run.state_digest, priorityClass: run.priority_class, packageRevisionHead: Number(run.package_revision_head), currentIdentityRevision: subject.current_identity_revision === null ? null : Number(subject.current_identity_revision) }) : null, handoffB: pkg ? Object.freeze({ onDeckPackageId: pkg.on_deck_package_id, offerId: pkg.offer_id, packageRevision: Number(pkg.package_revision), packageDigest: pkg.package_digest, state: pkg.state }) : null });
    });
  }
  function scan(visitor) {
    let cursor = null;
    for (;;) {
      const subjects = readPage(cursor);
      if (!subjects.length) break;
      visitor(buildBatch(subjects));
      cursor = subjects.at(-1).subject_id;
      if (subjects.length < PAGE_SIZE) break;
    }
  }
  function list(query = {}) {
    const section = query.section === 'completed' ? 'completed' : 'active';
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const items = [], summary = { totalCount: 0, waitingCount: 0, inProgressCount: 0, completedCount: 0 };
    scan((batch) => {
      for (const item of batch) {
        summary.totalCount += 1;
        if (item.classification === 'waiting') summary.waitingCount += 1;
        else if (item.classification === 'in_progress') summary.inProgressCount += 1;
        else summary.completedCount += 1;
        if (section === 'active' && item.classification !== 'completed') items.push(item);
        if (section === 'completed' && item.classification === 'completed' && (!query.cursor || item.subjectId > query.cursor) && items.length <= limit) items.push(item);
      }
    });
    if (section === 'active') items.sort((a, b) => a.displayIdentity.localeCompare(b.displayIdentity, 'zh-CN'));
    const hasMore = section === 'completed' && items.length > limit;
    if (hasMore) items.length = limit;
    return Object.freeze({ items: Object.freeze(items), summary: Object.freeze(summary), nextCursor: hasMore ? items.at(-1)?.subjectId || null : null });
  }
  function get(subjectId) {
    let found = null;
    scan((batch) => { if (!found) found = batch.find((row) => row.subjectId === subjectId) || null; });
    if (!found) { const error = new Error('Media organization item was not found.'); error.code = 'FORMATION_SUBJECT_NOT_FOUND'; throw error; }
    return found;
  }
  return Object.freeze({ list, get });
}

module.exports = Object.freeze({ createFormationQuery });
