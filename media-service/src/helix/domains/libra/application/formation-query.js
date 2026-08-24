'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
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
function eventState(event) {
  if (!event) return 'pending';
  const value = event.result?.result;
  if (event.result?.outcomeKind === 'failed' || value?.result === 'failed' ||
      value?.resultKind === 'not_available') return 'blocked';
  if (['succeeded'].includes(event.state) || event.result?.outcomeKind === 'succeeded') return 'done';
  if (['failed', 'blocked', 'cancelled'].includes(event.state)) return 'blocked';
  if (['executing', 'ready', 'pending', 'waiting_resource', 'waiting_external', 'waiting_for_resource', 'waiting_for_external'].includes(event.state)) {
    return 'running';
  }
  return 'pending';
}
function latestEvent(works, predicate) {
  return works.flatMap((work) => work.events.map((event) => ({ work, event }))).filter(({ event }) => predicate(event))
    .sort((left, right) => (right.work.createdAtMs || 0) - (left.work.createdAtMs || 0) ||
      (right.event.result?.committedAtMs || 0) - (left.event.result?.committedAtMs || 0) ||
      String(right.event.eventId || '').localeCompare(String(left.event.eventId || '')))[0]?.event || null;
}
function transcodeDeviceClass(event) {
  const planned = String(event?.executionDeviceClass || '');
  if (['nvidia_nvenc', 'intel_qsv', 'amd_vaapi'].includes(planned)) return 'gpu';
  if (planned === 'software_cpu') return 'cpu';
  if (planned === 'remote_worker') return 'remote';
  const result = event?.result?.result || event?.result || {};
  const ref = result.executionDeviceRef || result.deviceSnapshot || {};
  const deviceClass = String(ref.deviceClass || '');
  const deviceId = String(ref.deviceId || '');
  if (['nvidia_nvenc', 'intel_qsv', 'amd_vaapi'].includes(deviceClass)) return 'gpu';
  if (deviceClass === 'software_cpu') return 'cpu';
  if (deviceClass === 'remote_worker') return 'remote';
  return /nvenc|cuda|qsv|vaapi|gpu/i.test(deviceId + ' ' + deviceClass) ? 'gpu' : null;
}
function transcodeLabel(works, spec) {
  const event = latestEvent(works, (item) => item.capabilityRef === 'libra.media.transcode@1');
  const deviceClass = transcodeDeviceClass(event);
  const media = parse(spec?.spec_json)?.requirements?.mandatoryMedia || {};
  const space = parse(spec?.spec_json)?.requirements?.space || {};
  const parts = [deviceClass === 'gpu' ? 'GPU转码' : deviceClass === 'cpu' ? 'CPU转码' :
    deviceClass === 'remote' ? '远程转码' : '转码'];
  if (media.videoCodec && media.videoCodec !== 'any') parts.push(String(media.videoCodec).toUpperCase());
  if (media.minimumRasterClass && media.minimumRasterClass !== 'none') parts.push(media.minimumRasterClass);
  if (space.maxSizeGiB !== null && space.maxSizeGiB !== undefined) parts.push('不超过 ' + space.maxSizeGiB + ' GiB');
  return parts.join(' · ');
}
function organizingSteps(works, spec, options) {
  const step = (key, label, predicate, resultLabel) => {
    const event = latestEvent(works, predicate);
    if (!event) return null;
    return Object.freeze({
      key, label: typeof resultLabel === 'function' ? resultLabel(event) : label, state: eventState(event),
      progress: event.progress || null,
    });
  };
  const refs = (prefix) => (event) => event.capabilityRef === prefix || event.capabilityRef.startsWith(prefix);
  const remux = step('remux', '封装整理', (event) => event.capabilityRef === 'libra.media.remux@1');
  const transcode = (() => {
    const event = latestEvent(works, (item) => item.capabilityRef === 'libra.media.transcode@1');
    return event ? Object.freeze({ key: 'transcode', label: transcodeLabel(works, spec), state: eventState(event), progress: event.progress || null }) : null;
  })();
  const conformance = step('verify', '验证整理结果',
    (event) => event.capabilityRef === 'libra.product.conformance.verify@1');
  const nfo = step('nfo', '生成整理后的 NFO',
    (event) => event.capabilityRef === 'libra.product_sidecar.render@1',
    (event) => ({ related_nfo_update:'更新 NFO', product_metadata_draft_rebuild:'重建 NFO',
      product_metadata_draft_create:'创建 NFO' }[event.result?.result?.provenanceRef?.objectType] ||
      (event.result?.result ? '生成整理后的 NFO（历史记录未区分更新或重建）' : '生成整理后的 NFO')));
  const poster = step('poster', '取得海报',
    (event) => event.capabilityRef === 'libra.product_artifact.acquire@1' &&
      (event.result?.result?.artifactHandle?.artifactKind === 'poster' || !event.result?.result),
    (event) => event.result?.result?.artifactHandle?.provenanceRef?.objectType === 'related_material_reference'
      ? '复用现有海报' : '下载海报');
  const planned = [
    step('identity', '核对影片身份', refs('libra.product_identity.')),
    step('metadata', '读取并补充媒体资料', (event) => event.capabilityRef === 'libra.product_metadata.fetch@1' || event.capabilityRef === 'libra.product_metadata.commit@1'),
    poster,
    nfo,
    step('acquire', '外部寻源', (event) => event.capabilityRef.startsWith('libra.external_material.')),
    remux,
    transcode,
    conformance || (remux || transcode ? Object.freeze({ key:'verify', label:'验证整理结果', state:'pending', progress:null }) : null),
    step('shelf', '提交收藏架验收', (event) => event.capabilityRef === 'libra.product_package.publish@1'),
  ].filter(Boolean);
  if (!planned.length) {
    if (options?.latestRunState === 'discarded') {
      return Object.freeze([Object.freeze({ key: 'reintake', label: '等待重新入库', state: 'pending', progress: null })]);
    }
    return Object.freeze([Object.freeze({ key: 'assessing', label: '正在评估整理方案', state: 'pending', progress: null })]);
  }
  return Object.freeze(planned);
}
function actionLabel(works, spec, options) {
  return organizingSteps(works, spec, options).map((item) => item.label).join(' / ');
}

const RELATED_ROLE_LABELS = Object.freeze({ fanart:'背景图', nfo:'NFO', poster:'海报', sidecar:'附属资料', subtitle:'字幕' });
function relatedMaterialsSummary(primaryCount, relatedRoles) {
  if (!relatedRoles.length) return `已接收 ${primaryCount} 个主媒体`;
  const counts = new Map();
  for (const role of relatedRoles) counts.set(role, (counts.get(role) || 0) + 1);
  const breakdown = [...counts.entries()].sort(([left],[right])=>Buffer.from(left).compare(Buffer.from(right)))
    .map(([role,count])=>`${RELATED_ROLE_LABELS[role] || role} ${count}`).join('、');
  return `已接收 ${primaryCount} 个主媒体，以及 ${relatedRoles.length} 个相关材料（${breakdown}）`;
}
function organizingWorks(run, latestRun, progressByRun) {
  if (run) return progressByRun.get(run.libra_run_id) || [];
  if (latestRun && latestRun.state === 'completed') return progressByRun.get(latestRun.libra_run_id) || [];
  return [];
}
function extractProductIdentityIssue(works) {
  const result = works.flatMap((work) => work.events)
    .filter((event) => event.capabilityRef === 'libra.product_identity.evidence.observe@1'
      && event.result?.result?.schemaRef === 'helix://contracts/types/ProductIdentityEvidenceObservation/v1')
    .sort((a, b) => (b.result?.committedAtMs || 0) - (a.result?.committedAtMs || 0))[0]?.result?.result;
  if (!result || result.result === 'resolved') return null;
  return Object.freeze({ result: result.result, reasonCode: result.reasonCode, candidateSetDigest: result.evidenceDigest, candidates: Object.freeze(result.candidates || []) });
}
function hasOpenExecution(works) {
  return works.some((work) => !['succeeded', 'failed', 'cancelled'].includes(work.state));
}
function hasBlockingExecution(works) {
  return works.some((work) => ['failed', 'blocked'].includes(work.state));
}
function hasBusinessFailure(works) {
  return works.some((work) => work.events.some((event) => {
    const value = event.result?.result;
    return value?.result === 'failed' || value?.resultKind === 'not_available';
  }));
}
function waitsForExternalIntegration(works, integrationReady) {
  if (integrationReady !== false) return false;
  const verification = latestEvent(works, (event) =>
    event.capabilityRef === 'libra.product_media.verify@1')?.result?.result;
  const selection = latestEvent(works, (event) =>
    event.capabilityRef === 'libra.product_output.select@1')?.result?.result;
  const reasons = new Set(verification?.reasonCodes || []);
  const needsExternalSource = reasons.has('minimum_raster_unmet') ||
    reasons.has('system_upscale_forbidden') || reasons.has('primary_audio_unmet');
  const externalWorkExists = works.some((work) => work.events.some((event) =>
    event.capabilityRef.startsWith('libra.external_material.')));
  return verification?.result === 'failed' && needsExternalSource &&
    selection?.result === 'not_selected' && selection.selectionReasonCode === 'no_passed_candidate' &&
    !externalWorkExists;
}
function classifyFormation({ run, works, issue, recovery, arcaStatus, productPackage,
  waitingExternalIntegration = false }) {
  if (arcaStatus?.stage === 'completed') return 'completed';
  if ((run && ['frozen', 'suspended'].includes(run.state)) || issue ||
      recovery?.recoveryState === 'attention_required' ||
      arcaStatus?.stage === 'attention_required') {
    return 'attention_required';
  }
  if (productPackage || arcaStatus?.stage === 'in_progress' || hasOpenExecution(works)) return 'in_progress';
  if (waitingExternalIntegration) return 'pending';
  if (hasBlockingExecution(works) || hasBusinessFailure(works)) return 'attention_required';
  return 'pending';
}
function extractAcquisitionSelection(works) {
  const selected = works.flatMap((work) => work.events)
    .filter((event) => event.capabilityRef === 'libra.external_material.candidate.select@1'
      && event.result?.result?.schemaRef === 'helix://contracts/types/SelectedCandidate/v1')
    .sort((a, b) => (b.result?.committedAtMs || 0) - (a.result?.committedAtMs || 0))[0]?.result?.result;
  if (!selected || selected.result !== 'selected') return null;
  return Object.freeze({
    requirementAssessment: selected.selectedCandidate?.requirementAssessment || 'unknown',
    selectionReasonCode: selected.selectionReasonCode,
  });
}
function extractAcquisitionTerminal(works) {
  const selected = works.flatMap((work) => work.events)
    .filter((event) => event.capabilityRef === 'libra.external_material.candidate.select@1'
      && event.result?.result?.schemaRef === 'helix://contracts/types/SelectedCandidate/v1')
    .sort((a, b) => (b.result?.committedAtMs || 0) - (a.result?.committedAtMs || 0))[0]?.result?.result;
  return selected || null;
}
function terminalFailureCode(terminalEvidence) {
  const blockers = terminalEvidence?.blockedWorks;
  return Array.isArray(blockers) && blockers.length === 1
    ? blockers[0]?.failureCode || null
    : null;
}
function frozenRunLabel(works, terminalEvidence = null) {
  if (terminalFailureCode(terminalEvidence) === 'product_metadata_required_cast_missing') {
    return '媒体资料中缺少验收要求的演员信息，本次整理已冻结';
  }
  const terminal = extractAcquisitionTerminal(works);
  if (terminal?.result === 'not_selected' && terminal.selectionReasonCode === 'no_requirement_eligible_candidate') {
    return '没有符合整理要求的外部候选，本次整理已冻结';
  }
  if (terminal?.result === 'not_selected' && terminal.selectionReasonCode === 'no_available_candidate') {
    return '没有找到可获取的外部候选，本次整理已冻结';
  }
  return '本次整理已冻结，需要放弃后重新采购';
}
function nextAction(works, classification, issue, runState, recovery, arcaStatus, productPackage, latestRunState,
  waitingExternalIntegration = false, terminalEvidence = null) {
  if (classification === 'completed') return Object.freeze({ label: '已进入收藏架', state: 'completed', progress: null });
  if (!runState && latestRunState === 'discarded') {
    return Object.freeze({ label: '等待重新入库', state: 'pending', progress: null });
  }
  if (runState === 'frozen') return Object.freeze({ label: frozenRunLabel(works, terminalEvidence), state: 'frozen', progress: null });
  if (runState === 'suspended') return Object.freeze({ label: '整理已暂停，等待恢复评估', state: 'suspended', progress: null });
  if (recovery?.recoveryState === 'attention_required') return Object.freeze({ label: '接纳执行异常，需要处理', state: 'attention_required', progress: null });
  if (arcaStatus?.stage === 'attention_required') return Object.freeze({ label: '收藏架接纳或上架需要处理', state: 'attention_required', progress: null });
  if (issue) return Object.freeze({ label: issue.result === 'ambiguous' ? '需要确认媒体身份' : issue.result === 'conflicting' ? '媒体身份信息冲突' : '暂未找到匹配的媒体身份', state: 'attention_required', progress: null });
  const open = works.filter((work) => !['succeeded', 'failed', 'cancelled'].includes(work.state)).sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
  if (open) {
    const event = open.events.find((item) => ['executing', 'ready', 'waiting_resource', 'waiting_external'].includes(item.state)) || open.events[0];
    const acquisitionSelection = extractAcquisitionSelection(works);
    const labels = { product_identity: '确认媒体身份', product_metadata_observation: '补齐媒体资料', artifact_production: '生成或获取海报与 NFO', workspace_media_production: '处理视频文件', product_conformance: '验证整理结果', deliverable_promotion: '发布整理结果' };
    const label = open.workKind.startsWith('external_')
      ? acquisitionSelection?.requirementAssessment === 'unknown'
        ? '候选发布信息不完整，下载后验证真实媒体'
        : acquisitionSelection?.requirementAssessment === 'compliant'
          ? '正在获取预筛符合要求的候选'
          : '正在按整理要求筛选外部候选'
      : labels[open.workKind] || '继续整理媒体';
    return Object.freeze({ label, state: event?.state || open.state, progress: event?.progress || null });
  }
  if (waitingExternalIntegration) return Object.freeze({
    label: '等待配置外部获取服务后继续整理', state: 'waiting_external', progress: null,
  });
  const businessFailure = latestEvent(works, (event) => eventState(event) === 'blocked');
  if (businessFailure?.capabilityRef === 'libra.product.conformance.verify@1') {
    const codes = businessFailure.result?.result?.unmetRequirementCodes || [];
    return Object.freeze({ label: codes.includes('metadata_field_unmet')
      ? '媒体产品验收未通过：缺少要求的资料' : '媒体产品验收未通过', state:'blocked', progress:null });
  }
  if (businessFailure?.capabilityRef === 'libra.product_artifact.acquire@1') {
    return Object.freeze({ label:'没有取得要求的海报', state:'blocked', progress:null });
  }
  if (hasBlockingExecution(works) || businessFailure) return Object.freeze({ label: '媒体整理执行失败，需要处理', state: 'blocked', progress: null });
  if (!open && productPackage) return Object.freeze({ label: arcaStatus ? '正在完成收藏架上架' : '等待收藏架验收', state: 'running', progress: null });
  if (!open) return Object.freeze({ label: classification === 'pending' ? '正在确认目标、评分、要求或身份' : '准备下一项整理工作', state: 'pending', progress: null });
  throw new Error('Formation next action reached an impossible open-work branch.');
}

function createFormationProjectionSource(options) {
  const repository = createRepositoryDefinition({ repositoryId: 'libra_formation_query', owner: 'libra', schemaManifest: options.schemaManifest, statements: {
    page_subjects: { kind: 'select-page-after', tableId: 'libra_subjects', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['subject_id', 'structure_kind', 'content_profile', 'routing_anchor_intake_decision_id', 'status', 'intake_revision', 'current_identity_revision', 'created_at_ms', 'updated_at_ms'], safeIntegers: true },
    find_subject: { kind: 'select-one', tableId: 'libra_subjects', keyColumns: ['subject_id'], columns: ['subject_id', 'structure_kind', 'content_profile', 'routing_anchor_intake_decision_id', 'status', 'intake_revision', 'current_identity_revision', 'created_at_ms', 'updated_at_ms'], safeIntegers: true },
    find_decisions: { kind: 'select-in', tableId: 'libra_intake_decisions', keyColumn: 'target_subject_id', maxItems: PAGE_SIZE, columns: ['intake_decision_id', 'candidate_delivery_snapshot_json', 'target_subject_id', 'decided_at_ms'], safeIntegers: true },
    find_bindings: { kind: 'select-in', tableId: 'libra_material_bindings', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['subject_id', 'authority_kind', 'current'], safeIntegers: true },
    find_routing_decisions: { kind: 'select-in', tableId: 'libra_routing_decisions', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['routing_decision_id', 'subject_id', 'decision_revision', 'decision', 'shelf_id', 'unresolved_reason_code', 'routing_policy_id', 'routing_policy_revision', 'decision_digest'], safeIntegers: true },
    find_routing_policies: { kind: 'select-in', tableId: 'libra_routing_policy_revisions', keyColumn: 'routing_policy_id', maxItems: PAGE_SIZE, columns: ['routing_policy_id', 'revision', 'mode'], safeIntegers: true },
    find_decision_heads: { kind: 'select-in', tableId: 'libra_subject_decision_heads', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['subject_id', 'head_revision', 'head_digest', 'current_acceptance_spec_id'], safeIntegers: true },
    find_acceptance_specs: { kind: 'select-in', tableId: 'libra_acceptance_specs', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['acceptance_spec_id', 'subject_id', 'spec_revision', 'spec_json', 'spec_digest', 'shelf_id', 'published_at_ms'], safeIntegers: true },
    find_runs: { kind: 'select-in', tableId: 'libra_runs', keyColumn: 'subject_id', maxItems: PAGE_SIZE, columns: ['libra_run_id', 'subject_id', 'state', 'state_revision', 'state_digest', 'priority_class', 'package_revision_head', 'created_at_ms'], safeIntegers: true },
    find_run_revisions: { kind: 'select-in', tableId: 'libra_run_revisions', keyColumn: 'libra_run_id', maxItems: PAGE_SIZE, columns: ['libra_run_id', 'state_revision', 'transition_evidence_json'], safeIntegers: true },
    find_run_subject: { kind: 'select-one', tableId: 'libra_runs', keyColumns: ['libra_run_id'], columns: ['subject_id'] },
    find_packages: { kind: 'select-in', tableId: 'libra_product_packages', keyColumn: 'libra_run_id', maxItems: 500, columns: ['on_deck_package_id', 'offer_id', 'libra_run_id', 'package_revision', 'package_digest', 'state', 'published_at_ms'], safeIntegers: true },
  } });

  function readPage(cursor, limit = PAGE_SIZE) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE) {
      throw new TypeError('Formation projection page limit is invalid.');
    }
    return options.unitOfWork.execute([{ participantId: 'libra_formation_subject_page', owner: 'libra', repositories: [repository], execute(context) {
      return context.repository(repository.repositoryId).invoke('page_subjects', { cursor, limit });
    } }]).libra_formation_subject_page;
  }
  function readSubject(subjectId) {
    return options.unitOfWork.execute([{ participantId: 'libra_formation_subject', owner: 'libra', repositories: [repository], execute(context) {
      return context.repository(repository.repositoryId).invoke('find_subject', { subject_id: subjectId }) || null;
    } }]).libra_formation_subject;
  }
  function findSubjectByRun(libraRunId) {
    return options.unitOfWork.execute([{ participantId: 'libra_formation_run_subject', owner: 'libra', repositories: [repository], execute(context) {
      return context.repository(repository.repositoryId).invoke('find_run_subject', { libra_run_id: libraRunId })?.subject_id || null;
    } }]).libra_formation_run_subject;
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
      const runRevisions = runIds.length ? chunks(runIds).flatMap((values) => repo.invoke('find_run_revisions', { values })) : [];
      const packages = runIds.length ? chunks(runIds).flatMap((values) => repo.invoke('find_packages', { values })) : [];
      return { decisions, bindings, routingDecisions, routingPolicies, decisionHeads, acceptanceSpecs, runs, runRevisions, packages };
    } }]).libra_formation_batch;
  }
  function buildBatch(subjects) {
    const value = readBatch(subjects), runIds = unique(value.runs.map((row) => row.libra_run_id));
    const progress = runIds.length ? chunks(runIds).flatMap((ids) => options.progressProjectionReader?.read(ids) || []) : [];
    const progressByRun = new Map(runIds.map((id) => [id, progress.filter((item) => item.processId === id)]));
    const offerIds = unique(value.packages.map((row) => row.offer_id));
    const arcaStatuses = new Map(offerIds.length ? chunks(offerIds, 100).flatMap((ids) =>
      [...(options.readArcaFormationStatuses?.(ids) || new Map()).entries()]) : []);
    const recoveries = new Map(offerIds.length ? chunks(offerIds, 100).flatMap((ids) =>
      [...(options.readAcceptanceRecoveries?.(ids) || new Map()).entries()]) : []);
    const prepared = subjects.map((subject) => {
      const decisions = value.decisions.filter((item) => item.target_subject_id === subject.subject_id).sort((a, b) => Number(a.decided_at_ms) - Number(b.decided_at_ms));
      const anchor = decisions.find((item) => item.intake_decision_id === subject.routing_anchor_intake_decision_id) || decisions[0];
      const snapshot = parse(anchor?.candidate_delivery_snapshot_json), claim = snapshot?.candidatePackage?.identityClaim || {};
      const displayIdentity = snapshot?.candidatePackage?.displayIdentity || claim.claimedDisplayIdentity || subject.subject_id;
      return { subject, decisions, displayIdentity, snapshot };
    });
    const ratings = options.readPerceptionRatings?.(subjects.map((item) => item.subject_id)) || new Map();
    const shelfNames = new Map((options.readShelfTargets?.() || []).map((item) => [item.shelfId, item.name]));
    const externalIntegrationReady = typeof options.isExternalMaterialIntegrationReady === 'function'
      ? options.isExternalMaterialIntegrationReady() === true : null;
    return prepared.map(({ subject, decisions, displayIdentity, snapshot }) => {
      const bindings = value.bindings.filter((item) => item.subject_id === subject.subject_id && Number(item.current) === 1);
      const routing = latest(value.routingDecisions.filter((item) => item.subject_id === subject.subject_id), 'decision_revision');
      const policy = routing ? value.routingPolicies.find((item) => item.routing_policy_id === routing.routing_policy_id && Number(item.revision) === Number(routing.routing_policy_revision)) : null;
      const head = value.decisionHeads.find((item) => item.subject_id === subject.subject_id) || null;
      const spec = head?.current_acceptance_spec_id ? value.acceptanceSpecs.find((item) => item.acceptance_spec_id === head.current_acceptance_spec_id) : null;
      const runs = value.runs.filter((item) => item.subject_id === subject.subject_id).sort((a, b) => Number(b.created_at_ms) - Number(a.created_at_ms));
      const run = runs.find((item) => ['active', 'suspended', 'frozen'].includes(item.state)) || null;
      const runRevision = run ? value.runRevisions.find((item) => item.libra_run_id === run.libra_run_id &&
        Number(item.state_revision) === Number(run.state_revision)) : null;
      const terminalEvidence = runRevision ? parse(runRevision.transition_evidence_json) : null;
      const latestRun = runs[0] || null;
      const packageRun = run || (latestRun?.state === 'completed' ? latestRun : null);
      const pkg = packageRun ? latest(value.packages.filter((item) => item.libra_run_id === packageRun.libra_run_id), 'package_revision') : null;
      const works = run ? progressByRun.get(run.libra_run_id) || [] : [];
      const actionWorks = organizingWorks(run, latestRun, progressByRun);
      const issue = extractProductIdentityIssue(works);
      const waitingExternalIntegration = waitsForExternalIntegration(works, externalIntegrationReady);
      const recovery = pkg ? recoveries.get(pkg.offer_id) || null : null;
      const arcaStatus = pkg ? arcaStatuses.get(pkg.offer_id) || null : null;
      const classification = classifyFormation({ run, works, issue, recovery, arcaStatus, productPackage: pkg,
        waitingExternalIntegration });
      const rating = ratings.get(subject.subject_id) || null;
      const stepOptions = Object.freeze({ latestRunState: latestRun?.state || null, waitingExternalIntegration });
      const steps = organizingSteps(actionWorks, spec, stepOptions);
      const primaryCount = snapshot?.primaryInputManifest?.members?.length ||
        bindings.filter((item) => item.authority_kind === 'primary_control').length;
      const relatedRoles = Object.freeze((snapshot?.candidatePackage?.relatedReferences || [])
        .map((item) => item.role).sort());
      const detail = Object.freeze({
        receivedMaterials:Object.freeze({ primaryCount, relatedCount:relatedRoles.length, relatedRoles,
          state:'completed', summary:relatedMaterialsSummary(primaryCount,relatedRoles) }),
        mediaOrganization:Object.freeze({ state:classification === 'attention_required' && !arcaStatus ? 'attention' :
          pkg ? 'completed' : 'pending', steps, summary:steps.map((item)=>item.label).join(' → ') || '等待形成媒体整理方案' }),
        acceptanceAndShelving:Object.freeze({ state:arcaStatus?.stage === 'completed' ? 'completed' :
          arcaStatus?.stage === 'attention_required' || recovery?.recoveryState === 'attention_required' ? 'attention' : 'pending',
          reasonCode:arcaStatus?.reasonCode || recovery?.errorCode || null,
          summary:arcaStatus?.stage === 'completed' ? '收藏架验收通过，已正式上架' :
            arcaStatus?.stage === 'attention_required' ? '收藏架验收或上架失败，需要处理' :
              pkg ? '媒体产品已提交，等待收藏架验收与上架' : '媒体产品尚未提交收藏架' }),
      });
      return Object.freeze({ formationViewId: subject.subject_id, subjectId: subject.subject_id, displayIdentity, contentProfile: subject.content_profile, structureKind: subject.structure_kind, status: subject.status, classification, myRating: rating?.rating ?? null, myRatingSource: rating?.sourceKind || null, myRatingRevision: (rating?.expectedRevision || 0) > 0 ? rating.expectedRevision : null, ratingState:rating?.state || 'pending', ratingResolutionStatus:rating?.resolutionStatus || null, ratingReasonCode:rating?.reasonCode || null, productIdentityIssue: issue, acceptanceRecovery: recovery, arcaStatus, processDetail:detail, targetShelfId: routing?.shelf_id || null, targetShelfName: shelfNames.get(routing?.shelf_id) || null, routingState: routing?.decision || 'preparing', unresolvedReasonCode: routing?.unresolved_reason_code || null, routingPolicyMode: policy?.mode || null, routingPolicyRevision: routing?.routing_policy_revision == null ? null : Number(routing.routing_policy_revision), routingDecisionRevision: routing ? Number(routing.decision_revision) : null, routingDecisionDigest: routing?.decision_digest || null, routingDecisionHeadRevision: head ? Number(head.head_revision) : null, routingDecisionHeadDigest: head?.head_digest || null, acceptanceSpecId: spec?.acceptance_spec_id || null, acceptanceSpecRevision: spec ? Number(spec.spec_revision) : null, acceptanceSpecDigest: spec?.spec_digest || null, acceptanceSpecPublishedAtMs: spec ? Number(spec.published_at_ms) : null, primaryMaterialCount: primaryCount, addedAtMs: decisions.length ? Number(decisions.at(-1).decided_at_ms) : Number(subject.updated_at_ms), organizingRequirement: requirementLabel(spec), organizingAction: actionLabel(actionWorks, spec, stepOptions), organizingSteps: steps, nextAction: nextAction(works, classification, issue, run?.state, recovery, arcaStatus, pkg, latestRun?.state || null, waitingExternalIntegration, terminalEvidence), currentRun: run ? Object.freeze({ libraRunId: run.libra_run_id, state: run.state, stateRevision: Number(run.state_revision), stateDigest: run.state_digest, priorityClass: run.priority_class, packageRevisionHead: Number(run.package_revision_head), currentIdentityRevision: subject.current_identity_revision === null ? null : Number(subject.current_identity_revision) }) : null, handoffB: pkg ? Object.freeze({ onDeckPackageId: pkg.on_deck_package_id, offerId: pkg.offer_id, packageRevision: Number(pkg.package_revision), packageDigest: pkg.package_digest, state: pkg.state, publishedAtMs: Number(pkg.published_at_ms) }) : null, completedAtMs: arcaStatus?.stage === 'completed' ? arcaStatus.completedAtMs : null });
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
  function get(subjectId) {
    const subject = readSubject(subjectId), found = subject ? buildBatch([subject])[0] : null;
    if (!found) { const error = new Error('Media organization item was not found.'); error.code = 'FORMATION_SUBJECT_NOT_FOUND'; throw error; }
    return found;
  }
  function getMany(subjectIds) { return buildBatch(subjectIds.map(readSubject).filter(Boolean)); }
  return Object.freeze({ readPage, readSubject, findSubjectByRun, buildBatch, scan, get, getMany });
}

function attentionFor(item) {
  if (item.classification === 'attention_required') {
    if (['frozen', 'suspended', 'blocked'].includes(item.nextAction?.state)) return item.nextAction.state;
    return 'attention_required';
  }
  if (item.currentRun?.state === 'frozen') return 'frozen';
  if (item.currentRun?.state === 'suspended') return 'suspended';
  if (item.productIdentityIssue) return 'attention_required';
  if (item.nextAction?.state === 'blocked') return 'blocked';
  return 'none';
}

function buildFormationProjectionRow(item, nowMs) {
  const attentionState = attentionFor(item), progress = item.nextAction?.progress || null;
  const identityJson = item.productIdentityIssue ? canonicalJson(item.productIdentityIssue) : null;
  const identityDigest = item.productIdentityIssue ? canonicalDigest(item.productIdentityIssue) : null;
  const attentionPriority = item.classification === 'attention_required' ? 0 : item.classification === 'in_progress' ? 1 : item.classification === 'pending' ? 2 : 3;
  const basis = {
    projectionContractRevision: 3,
    subjectId: item.subjectId, displayIdentity: item.displayIdentity, contentProfile: item.contentProfile,
    structureKind: item.structureKind, subjectStatus: item.status, classification: item.classification,
    rating: [item.myRating, item.myRatingSource, item.myRatingRevision], targetShelf: [item.targetShelfId, item.targetShelfName],
    routing: [item.routingState, item.unresolvedReasonCode, item.routingPolicyMode, item.routingPolicyRevision,
      item.routingDecisionRevision, item.routingDecisionDigest, item.routingDecisionHeadRevision, item.routingDecisionHeadDigest],
    primaryMaterialCount: item.primaryMaterialCount, requirement: item.organizingRequirement,
    action: item.organizingSteps || item.organizingAction,
    addedAtMs: item.addedAtMs, nextAction: item.nextAction, identityIssueDigest: identityDigest,
    acceptanceSpec: [item.acceptanceSpecId, item.acceptanceSpecRevision, item.acceptanceSpecDigest],
    run: item.currentRun, package: item.handoffB, acceptanceRecovery:item.acceptanceRecovery,
    arcaStatus:item.arcaStatus, completedAtMs:item.completedAtMs,
  };
  const row = {
    subject_id: item.subjectId, projection_revision: 3, classification: item.classification,
    attention_state: attentionState, attention_priority: attentionPriority, display_identity: item.displayIdentity,
    content_profile: item.contentProfile, structure_kind: item.structureKind, subject_status: item.status,
    my_rating: item.myRating, my_rating_source: item.myRatingSource, my_rating_revision: item.myRatingRevision,
    target_shelf_id: item.targetShelfId, target_shelf_name: item.targetShelfName, routing_state: item.routingState,
    unresolved_reason_code: item.unresolvedReasonCode, routing_policy_mode: item.routingPolicyMode,
    routing_policy_revision: item.routingPolicyRevision, routing_decision_revision: item.routingDecisionRevision,
    routing_decision_digest: item.routingDecisionDigest, routing_decision_head_revision: item.routingDecisionHeadRevision,
    routing_decision_head_digest: item.routingDecisionHeadDigest, primary_material_count: item.primaryMaterialCount,
    organizing_requirement: item.organizingRequirement,
    organizing_action: canonicalJson(item.organizingSteps || [{ key: 'assessing', label: item.organizingAction || '正在评估整理方案', state: 'pending', progress: null }]),
    added_at_ms: item.addedAtMs,
    next_action_label: item.nextAction.label, next_action_state: ['waiting_resource','waiting_external'].includes(item.nextAction.state)
      ? item.nextAction.state.replace('waiting_', 'waiting_for_') : item.nextAction.state,
    progress_mode: progress?.mode || null, progress_current_value: progress?.currentValue ?? null,
    progress_total_value: progress?.totalValue ?? null, progress_unit: progress?.unit || null, progress_rate: progress?.rate ?? null,
    progress_eta_ms: progress?.etaMs ?? null, progress_bucket: progress?.bucket || null,
    identity_issue_schema_ref: identityJson ? 'helix://libra/admin/formation/ProductIdentityIssue/v1' : null,
    identity_issue_json: identityJson, identity_issue_digest: identityDigest,
    current_acceptance_spec_id: item.acceptanceSpecId, current_acceptance_spec_revision: item.acceptanceSpecRevision,
    current_acceptance_spec_digest: item.acceptanceSpecDigest, current_libra_run_id: item.currentRun?.libraRunId || null,
    current_libra_run_state: item.currentRun?.state || null, current_libra_run_state_revision: item.currentRun?.stateRevision ?? null,
    current_libra_run_state_digest: item.currentRun?.stateDigest || null, current_priority_class: item.currentRun?.priorityClass || null,
    current_identity_revision: item.currentRun?.currentIdentityRevision ?? null, current_package_id: item.handoffB?.onDeckPackageId || null,
    current_package_revision: item.handoffB?.packageRevision ?? null, current_package_digest: item.handoffB?.packageDigest || null,
    current_offer_id: item.handoffB?.offerId || null, completed_at_ms: item.classification === 'completed' ? item.completedAtMs : null,
    basis_digest: canonicalDigest(basis), projection_digest: '', updated_at_ms: nowMs
  };
  row.projection_digest = canonicalDigest(Object.fromEntries(Object.entries(row).filter(([key]) => !['projection_revision','projection_digest'].includes(key))));
  return Object.freeze(row);
}

function parseCursor(cursor) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value?.version === 1 && Number.isSafeInteger(value.offset) && value.offset >= 0) return value.offset;
  } catch {}
  throw Object.assign(new Error('Formation cursor is invalid.'), { code: 'FORMATION_CURSOR_INVALID' });
}
function cursorFor(offset) { return Buffer.from(JSON.stringify({ version: 1, offset }), 'utf8').toString('base64url'); }
function projectionItem(row) {
  const issue = row.identity_issue_json ? parse(row.identity_issue_json) : null;
  return Object.freeze({
    formationViewId: row.subject_id, subjectId: row.subject_id, displayIdentity: row.display_identity,
    contentProfile: row.content_profile, structureKind: row.structure_kind, status: row.subject_status,
    classification: row.classification, myRating: row.my_rating === null ? null : Number(row.my_rating),
    myRatingSource: row.my_rating_source, myRatingRevision: row.my_rating_revision === null ? null : Number(row.my_rating_revision),
    productIdentityIssue: issue, targetShelfId: row.target_shelf_id, targetShelfName: row.target_shelf_name,
    routingState: row.routing_state, unresolvedReasonCode: row.unresolved_reason_code, routingPolicyMode: row.routing_policy_mode,
    routingPolicyRevision: row.routing_policy_revision === null ? null : Number(row.routing_policy_revision),
    routingDecisionRevision: row.routing_decision_revision === null ? null : Number(row.routing_decision_revision),
    routingDecisionDigest: row.routing_decision_digest,
    routingDecisionHeadRevision: row.routing_decision_head_revision === null ? null : Number(row.routing_decision_head_revision),
    routingDecisionHeadDigest: row.routing_decision_head_digest, acceptanceSpecId: row.current_acceptance_spec_id,
    acceptanceSpecRevision: row.current_acceptance_spec_revision === null ? null : Number(row.current_acceptance_spec_revision),
    acceptanceSpecDigest: row.current_acceptance_spec_digest, primaryMaterialCount: Number(row.primary_material_count),
    addedAtMs: Number(row.added_at_ms), organizingRequirement: row.organizing_requirement,
    organizingAction: (function () {
      const steps = parse(row.organizing_action);
      return Array.isArray(steps) ? steps.map((item) => item.label).join(' / ') : row.organizing_action;
    }()),
    organizingSteps: (function () {
      const steps = parse(row.organizing_action);
      return Array.isArray(steps) ? Object.freeze(steps.map((item) => Object.freeze(item))) : Object.freeze([{
        key: 'legacy', label: row.organizing_action || '正在评估整理方案', state: 'pending', progress: null,
      }]);
    }()),
    nextAction: Object.freeze({ label: row.next_action_label, state: row.next_action_state, progress: row.progress_mode ? Object.freeze({
      mode: row.progress_mode, currentValue: row.progress_current_value === null ? null : Number(row.progress_current_value),
      totalValue: row.progress_total_value === null ? null : Number(row.progress_total_value), unit: row.progress_unit,
      rate: row.progress_rate === null ? null : Number(row.progress_rate), etaMs: row.progress_eta_ms === null ? null : Number(row.progress_eta_ms),
      bucket: row.progress_bucket
    }) : null }),
    currentRun: row.current_libra_run_id ? Object.freeze({ libraRunId: row.current_libra_run_id, state: row.current_libra_run_state,
      stateRevision: Number(row.current_libra_run_state_revision), stateDigest: row.current_libra_run_state_digest,
      priorityClass: row.current_priority_class, packageRevisionHead: row.current_package_revision === null ? 0 : Number(row.current_package_revision),
      currentIdentityRevision: row.current_identity_revision === null ? null : Number(row.current_identity_revision) }) : null,
    handoffB: row.current_package_id ? Object.freeze({ onDeckPackageId: row.current_package_id, offerId: row.current_offer_id,
      packageRevision: Number(row.current_package_revision), packageDigest: row.current_package_digest, state: 'published' }) : null,
    completedAtMs: row.completed_at_ms === null ? null : Number(row.completed_at_ms),
    projectionRevision: Number(row.projection_revision), projectionDigest: row.projection_digest, projectionUpdatedAtMs: Number(row.updated_at_ms)
  });
}

function createFormationQuery(options) {
  if (!options?.store) throw new TypeError('Formation query requires the durable projection store.');
  const now = options.now || Date.now;
  function acceptanceIssueLabel(value) {
    if (value.errorCode === 'CLEAN_ARCA_TARGET_ROOT_UNAVAILABLE') {
      return '媒体整理完成，目标收藏架目录不可用，上架失败';
    }
    return '媒体整理完成，收藏架验收或上架失败';
  }
  function technicalIssue(item) {
    const value = item.handoffB?.offerId ? options.readAcceptanceRecovery?.(item.handoffB.offerId) : null;
    if (!value || value.recoveryState !== 'attention_required') return Object.freeze({ ...item, executorIssue:null });
    return Object.freeze({ ...item, classification:'attention_required',
      nextAction:Object.freeze({ label:acceptanceIssueLabel(value), state:'attention_required', progress:null }),
      executorIssue:Object.freeze({ phase:value.failurePhase, errorCode:value.errorCode,
        attemptCount:value.terminalAttemptCount, owner:value.ownerDomain,
        recoveryState:value.recoveryState, recoveryGeneration:value.recoveryGeneration,
        automaticRecoveryUsed:value.automaticRecoveryUsed, canRetry:true, offerId:value.offerId }) });
  }
  function currentRatingFacts(items) {
    if (!options.detailSource?.getMany || !items.length) return items;
    const fresh = new Map(options.detailSource.getMany(items.map((item)=>item.subjectId)).map((item)=>[item.subjectId,item]));
    return items.map((item)=>{const value=fresh.get(item.subjectId);return value ? Object.freeze({ ...item,
      myRating:value.myRating,myRatingSource:value.myRatingSource,myRatingRevision:value.myRatingRevision,
      ratingState:value.ratingState,ratingResolutionStatus:value.ratingResolutionStatus,ratingReasonCode:value.ratingReasonCode }) : item;});
  }
  function summary(attentionRows = []) {
    const result = { totalCount: 0, pendingCount: 0, inProgressCount: 0, attentionRequiredCount: 0, completedCount: 0 };
    for (const row of options.store.counts()) {
      const count = Number(row.row_count); result.totalCount += count;
      if (row.group_value === 'pending') result.pendingCount = count;
      else if (row.group_value === 'in_progress') result.inProgressCount = count;
      else if (row.group_value === 'attention_required') result.attentionRequiredCount = count;
      else if (row.group_value === 'completed') result.completedCount = count;
    }
    for (const row of attentionRows) {
      if (row.classification === 'attention_required') continue;
      if (row.classification === 'pending') result.pendingCount -= 1;
      else if (row.classification === 'in_progress') result.inProgressCount -= 1;
      else if (row.classification === 'completed') result.completedCount -= 1;
      result.attentionRequiredCount += 1;
    }
    return Object.freeze(result);
  }
  function truthy(value) { return value === true || value === 1 || value === '1' || value === 'true'; }
  function activeFilters(query) {
    const classification = ['pending', 'in_progress', 'attention_required'].includes(query.classification) ? query.classification : null;
    const shelfId = typeof query.shelfId === 'string' ? query.shelfId : null;
    const title = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
    return Object.freeze({
      classification, shelfId,
      needsUserAction: truthy(query.needsUserAction),
      expedited: truthy(query.expedited),
      title,
    });
  }
  function hasActiveFilters(filters) {
    return Boolean(filters.classification || filters.shelfId || filters.needsUserAction || filters.expedited || filters.title);
  }
  function itemNeedsUserAction(item) {
    return item.classification === 'attention_required'
      || item.routingState === 'unresolved'
      || Boolean(item.productIdentityIssue)
      || Boolean(item.executorIssue)
      || ['frozen', 'suspended'].includes(item.currentRun?.state)
      || ['attention_required', 'frozen', 'suspended', 'blocked'].includes(item.nextAction?.state);
  }
  function matchesActiveItem(item, filters) {
    if (filters.classification && item.classification !== filters.classification) return false;
    if (filters.shelfId === 'unset' || filters.shelfId === '') {
      if (item.targetShelfId) return false;
    } else if (filters.shelfId && item.targetShelfId !== filters.shelfId) return false;
    if (filters.needsUserAction && !itemNeedsUserAction(item)) return false;
    if (filters.expedited && item.currentRun?.priorityClass !== 'expedited') return false;
    if (filters.title && !String(item.displayIdentity || '').toLowerCase().includes(filters.title)) return false;
    return true;
  }
  function scanActiveRows() {
    const all = [];
    let offset = 0;
    const reader = typeof options.store.listActiveScan === 'function' ? options.store.listActiveScan.bind(options.store) : options.store.listActive.bind(options.store);
    const chunk = typeof options.store.listActiveScan === 'function' ? 500 : 26;
    for (;;) {
      const page = reader(offset, chunk);
      if (!page.length) break;
      all.push(...page);
      if (page.length < chunk) break;
      offset += page.length;
    }
    return all;
  }
  function mergeAttention(rows, attention) {
    const attentionOffers = new Set(attention.map((item) => item.current_offer_id));
    return [...attention, ...rows.filter((item) => !attentionOffers.has(item.current_offer_id))];
  }
  function list(query = {}) {
    const section = ['completed', 'ended'].includes(query.section) ? query.section : 'active', offset = parseCursor(query.cursor);
    const limit = Math.min(section === 'active' ? 25 : 100, Math.max(1, Number(query.limit) || 25));
    const state = options.state?.() || Object.freeze({ status: 'ready', asOfMs: now() });
    if (section === 'ended') {
      const history = options.historyStore?.listDiscarded(offset, limit + 1) || [];
      const hasMore = history.length > limit, selected = hasMore ? history.slice(0, limit) : history;
      return Object.freeze({ items:Object.freeze(selected.map((item) => {
        const subject = options.store.find(item.subjectId);
        return Object.freeze({ ...item, displayIdentity:subject?.display_identity || item.subjectId });
      })), summary:summary(), nextCursor:hasMore ? cursorFor(offset + limit) : null,
      projection:Object.freeze({ status:state.status, asOfMs:state.asOfMs }) });
    }
    const attention = (options.listAcceptanceAttention?.(100) || []).map((item)=>options.store.findByOffer?.(item.offerId)).filter(Boolean);
    const attentionOffers = new Set(attention.map((item)=>item.current_offer_id));
    if (section === 'completed') {
      let rows = options.store.listCompleted(offset, limit + 1).filter((item)=>!attentionOffers.has(item.current_offer_id));
      const hasMore = rows.length > limit, selected = hasMore ? rows.slice(0, limit) : rows;
      return Object.freeze({ items: Object.freeze(currentRatingFacts(selected.map(projectionItem).map(technicalIssue))), summary: summary(attention),
        nextCursor: hasMore ? cursorFor(offset + limit) : null, projection: Object.freeze({ status: state.status, asOfMs: state.asOfMs }) });
    }
    const filters = activeFilters(query);
    let items;
    if (hasActiveFilters(filters)) {
      items = mergeAttention(scanActiveRows(), attention).map(projectionItem).map(technicalIssue).filter((item) => matchesActiveItem(item, filters));
    } else {
      let rows = options.store.listActive(offset, limit + 1);
      if (offset === 0) rows = mergeAttention(rows, attention);
      items = rows.map(projectionItem).map(technicalIssue);
    }
    const windowed = hasActiveFilters(filters) ? items.slice(offset) : items;
    const hasMore = windowed.length > limit, selected = hasMore ? windowed.slice(0, limit) : windowed;
    return Object.freeze({ items: Object.freeze(currentRatingFacts(selected)), summary: summary(attention),
      nextCursor: hasMore ? cursorFor(offset + limit) : null, projection: Object.freeze({ status: state.status, asOfMs: state.asOfMs }) });
  }
  function get(subjectId) {
    if (options.detailSource?.get) return technicalIssue(options.detailSource.get(subjectId));
    const row = options.store.find(subjectId);
    if (!row) throw Object.assign(new Error('Media organization item was not found.'), { code: 'FORMATION_SUBJECT_NOT_FOUND' });
    return technicalIssue(projectionItem(row));
  }
  return Object.freeze({ list, get });
}

module.exports = Object.freeze({
  actionLabel,
  buildFormationProjectionRow,
  classifyFormation,
  createFormationProjectionSource,
  createFormationQuery,
  extractAcquisitionSelection,
  extractProductIdentityIssue,
  frozenRunLabel,
  hasBlockingExecution,
  hasBusinessFailure,
  hasOpenExecution,
  nextAction,
  organizingSteps,
  organizingWorks,
  projectionItem,
  relatedMaterialsSummary,
  waitsForExternalIntegration,
});
