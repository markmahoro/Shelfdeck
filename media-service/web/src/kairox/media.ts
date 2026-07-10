import type { MediaTask } from '../types';
import type { FactsFreshnessEntry, FactsFreshnessProjection, KairoxMediaProjection, KairoxTargetGate } from './types';
import { normalizeTargetGate, toKairoxTaskProjection } from './projections';

const ACTIVE_TASK_STATUSES = new Set([
  'created',
  'pending_manual',
  'queued',
  'executing',
  'pausing',
  'awaiting_user_confirm',
  'paused',
  'interrupted',
  'waiting_media_source',
]);

const TARGET_GATE_LABEL: Record<KairoxTargetGate, string> = {
  ingest: '创建入库任务',
  metadata: '创建元数据任务',
  optimize: '优化到目标',
  archive: '创建归档任务',
  delete: '查看处置建议',
};

export function isKairoxActiveTask(task: MediaTask): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status);
}

export function taskItemId(task: MediaTask): string | undefined {
  const object = task.taskTarget?.object;
  if (typeof object?.itemId === 'string') return object.itemId;
  return typeof task.itemId === 'string' ? task.itemId : undefined;
}

export function toKairoxMediaProjection(raw: unknown, activeTask?: MediaTask | null): KairoxMediaProjection | null {
  const item = asRecord(raw);
  const id = stringValue(item.id) || stringValue(item.itemId);
  if (!id) return null;

  const title = stringValue(item.name)
    || stringValue(item.title)
    || stringValue(item.originalName)
    || id;
  const subLibraryId = stringValue(item.subLibraryId)
    || stringValue(item.sectionId)
    || stringValue(item.libraryId)
    || '';
  const nextTargetGate = normalizeTargetGate(item.lifecycleNextTask)
    || normalizeTargetGate(asRecord(item.lifecycle).nextTargetGate);
  const objective = buildObjective(item);
  const projectedTask = activeTask ? toKairoxTaskProjection(activeTask) : null;
  const factsFreshness = buildFactsFreshness(item);
  const mediaFreeze = buildMediaFreeze(item);
  const helix = asOptionalRecord(item.helix);
  const nextAction = buildNextAction(projectedTask, nextTargetGate, objective, factsFreshness, mediaFreeze);

  return {
    id,
    title,
    subLibraryId,
    sourceFacts: compactRecord({
      itemId: id,
      source: item.source,
      subLibraryId,
      sectionId: item.sectionId,
      sectionName: item.sectionName,
      path: item.path,
      filePath: item.filePath,
      embyWebUrl: item.embyWebUrl,
      itemType: item.itemType,
      seriesName: item.seriesName,
      seasonNumber: item.seasonNumber,
    }),
    mediaFacts: compactRecord({
      resolution: item.resolution,
      codec: item.codec,
      durationSec: item.durationSec,
      sizeGb: item.sizeGb,
      equivalentBitrate: item.equivalentBitrate,
      bitrate: item.bitrate,
      targetBitrate: item.targetBitrate,
      predictedSizeGb: item.predictedSizeGb,
      isBluRayDisc: item.isBluRayDisc,
    }),
    metadataFacts: compactRecord({
      metadataStatus: item.metadataStatus,
      metadataKind: item.metadataKind,
      metadataComplete: item.metadataComplete,
      metadataMissingReasons: item.metadataMissingReasons,
      scraped: item.scraped,
      adultMetadata: item.adultMetadata,
    }),
    userPerceptionFacts: compactRecord({
      rating: item.rating,
      doubanRating: item.doubanStars ?? item.doubanRating,
      watched: item.watched,
      playCount: item.playCount,
      favorite: item.favorite,
      manualTier: item.manualTier,
      perceptionVersion: item.perceptionVersion,
      perceptionUpdatedAt: item.perceptionUpdatedAt,
    }),
    gateFacts: compactRecord({
      lifecycleStage: item.lifecycleStage,
      lifecycleDone: item.lifecycleDone,
      lifecycleNextTask: item.lifecycleNextTask,
      lifecycleReason: item.lifecycleReason,
      metadataStatus: item.metadataStatus,
      archiveStatus: item.archiveStatus,
      archiveReason: item.archiveReason,
      archiveDoneAt: item.archiveDoneAt,
      optimizationStatus: item.optimizationStatus,
      optimizationDoneAt: item.optimizationDoneAt,
      objectiveHash: item.objectiveHash,
      objectiveVersion: item.objectiveVersion,
    }),
    helix,
    factsFreshness,
    mediaFreeze,
    lifecycle: {
      stage: stringValue(item.lifecycleStage),
      currentGate: currentGate(item, nextTargetGate),
      nextTargetGate,
      reason: stringValue(item.lifecycleReason),
    },
    objective,
    activeTask: projectedTask,
    deleteCandidate: asOptionalRecord(item.deleteCandidate),
    nextAction,
  };
}

export function mediaDisplayFacts(projection: KairoxMediaProjection): Array<{ label: string; value: string }> {
  const helix = asRecord(projection.helix);
  const quarantine = asRecord(helix.quarantine);
  return [
    { label: '来源', value: stringValue(projection.sourceFacts.source) || stringValue(projection.sourceFacts.sectionName) || '-' },
    { label: '规格', value: [projection.mediaFacts.resolution, projection.mediaFacts.codec].filter(Boolean).join(' / ') || '-' },
    { label: '大小', value: formatSize(projection.mediaFacts.sizeGb) },
    { label: '感知', value: formatPerception(projection.userPerceptionFacts) },
    { label: '元数据', value: stringValue(projection.metadataFacts.metadataStatus) || (projection.metadataFacts.metadataComplete === true ? 'complete' : '-') },
    { label: '事实', value: freshnessSummary(projection.factsFreshness) },
    {
      label: 'Helix',
      value: [stringValue(helix.phase), stringValue(quarantine.status) && stringValue(quarantine.status) !== 'none' ? stringValue(quarantine.status) : '']
        .filter(Boolean).join(' / ') || '-',
    },
  ];
}

export function targetGateLabel(value?: KairoxTargetGate | null): string {
  if (!value) return '无';
  return {
    ingest: '入库',
    metadata: '元数据',
    optimize: '优化',
    archive: '归档',
    delete: '处置',
  }[value];
}

function buildObjective(item: Record<string, unknown>): Record<string, unknown> | null {
  const existing = asOptionalRecord(item.optimizeObjective) || asOptionalRecord(item.objective);
  if (existing) return existing;
  const target = compactRecord({
    targetBitrate: item.targetBitrate,
    targetCodec: item.targetCodec,
    predictedSizeGb: item.predictedSizeGb,
    reason: item.reason,
  });
  return Object.keys(target).length > 0 ? target : null;
}

function buildFactsFreshness(item: Record<string, unknown>): FactsFreshnessProjection {
  const raw = asRecord(item.factsFreshness);
  return {
    sourceFacts: normalizeFreshnessEntry(asRecord(raw.sourceFacts)),
    mediaFacts: normalizeFreshnessEntry(asRecord(raw.mediaFacts)),
    metadataFacts: normalizeFreshnessEntry(asRecord(raw.metadataFacts)),
    userPerceptionFacts: normalizeFreshnessEntry(asRecord(raw.userPerceptionFacts)),
    gateFacts: normalizeFreshnessEntry(asRecord(raw.gateFacts)),
  };
}

function buildMediaFreeze(item: Record<string, unknown>): KairoxMediaProjection['mediaFreeze'] {
  const raw = asRecord(item.mediaFreeze);
  const frozenUntil = stringValue(raw.frozenUntil) || stringValue(item.mediaFrozenUntil);
  const untilMs = Date.parse(frozenUntil || '');
  return {
    frozen: raw.frozen === true || (Number.isFinite(untilMs) && untilMs > Date.now()),
    frozenUntil: frozenUntil || undefined,
    reason: stringValue(raw.reason) || stringValue(item.mediaFreezeReason) || undefined,
    sourceTaskId: stringValue(raw.sourceTaskId) || stringValue(item.mediaFreezeSourceTaskId) || undefined,
    sourceTargetGate: stringValue(raw.sourceTargetGate) || stringValue(item.mediaFreezeSourceTargetGate) || undefined,
    sourceFlowKind: stringValue(raw.sourceFlowKind) || stringValue(item.mediaFreezeSourceFlowKind) || undefined,
  };
}

function normalizeFreshnessEntry(raw: Record<string, unknown>): FactsFreshnessEntry {
  return {
    status: stringValue(raw.status) || 'unknown',
    ownerGate: stringValue(raw.ownerGate) || undefined,
    updatedAt: stringValue(raw.updatedAt) || undefined,
    observedAt: stringValue(raw.observedAt) || undefined,
    staleReason: stringValue(raw.staleReason) || undefined,
    staleSource: stringValue(raw.staleSource) || undefined,
    refreshTargetGate: stringValue(raw.refreshTargetGate) || undefined,
    refreshTaskId: stringValue(raw.refreshTaskId) || undefined,
    evidence: asOptionalRecord(raw.evidence) || undefined,
  };
}

function buildNextAction(
  projectedTask: ReturnType<typeof toKairoxTaskProjection> | null,
  nextTargetGate: KairoxTargetGate | null,
  objective: Record<string, unknown> | null,
  factsFreshness: FactsFreshnessProjection,
  mediaFreeze: KairoxMediaProjection['mediaFreeze'],
): KairoxMediaProjection['nextAction'] {
  if (projectedTask) return { kind: 'view_task', label: '查看进行中的任务', targetGate: projectedTask.targetGate };
  if (mediaFreeze.frozen) return { kind: 'wait_media_freeze', label: '媒体冻结中' };
  if (!nextTargetGate) return { kind: 'none', label: '无需处理' };
  if (nextTargetGate === 'delete') return { kind: 'review_delete_candidate', targetGate: nextTargetGate, label: TARGET_GATE_LABEL[nextTargetGate] };
  if (nextTargetGate === 'metadata' && hasBlockingMetadataFreshness(factsFreshness)) {
    return {
      kind: 'create_task',
      targetGate: nextTargetGate,
      label: '刷新媒体事实',
      gateObjective: {
        kind: 'metadata_refresh',
        refreshFacts: ['mediaFacts', 'metadataFacts'],
        reason: 'user_requested_refresh',
      },
    };
  }
  return {
    kind: 'create_task',
    targetGate: nextTargetGate,
    label: TARGET_GATE_LABEL[nextTargetGate],
    gateObjective: nextTargetGate === 'optimize' && objective ? objective : undefined,
  };
}

function hasBlockingMetadataFreshness(factsFreshness: FactsFreshnessProjection): boolean {
  return [factsFreshness.mediaFacts, factsFreshness.metadataFacts].some((entry) => (
    entry && ['stale', 'invalidated', 'blocked', 'refreshing'].includes(String(entry.status || '').toLowerCase())
  ));
}

function freshnessSummary(factsFreshness: FactsFreshnessProjection): string {
  const media = freshnessLabel(factsFreshness.mediaFacts);
  const metadata = freshnessLabel(factsFreshness.metadataFacts);
  if (media === metadata) return media;
  return `媒体${media} / 元数据${metadata}`;
}

export function freshnessLabel(entry?: FactsFreshnessEntry): string {
  const status = String(entry?.status || 'unknown').toLowerCase();
  if (status === 'fresh') return '已更新';
  if (status === 'needs_check') return '待巡检';
  if (status === 'stale' || status === 'invalidated') return '需刷新';
  if (status === 'refreshing') return '刷新中';
  if (status === 'blocked') return '刷新受阻';
  return '未知';
}

function currentGate(item: Record<string, unknown>, nextTargetGate: KairoxTargetGate | null): string | undefined {
  if (nextTargetGate) return nextTargetGate;
  if (item.archiveStatus === 'archived' || item.lifecycleStage === 'archived') return 'archive';
  if (item.optimizationStatus && item.optimizationStatus !== 'none') return 'optimize';
  if (item.metadataComplete === true || item.metadataStatus === 'complete') return 'metadata';
  return stringValue(item.lifecycleStage);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatSize(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} GB` : '-';
}

function formatPerception(facts: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof facts.rating === 'number') parts.push(`${facts.rating}★`);
  if (typeof facts.doubanRating === 'number') parts.push(`豆瓣 ${facts.doubanRating}★`);
  if (typeof facts.watched === 'boolean') parts.push(facts.watched ? '已看' : '未看');
  return parts.length > 0 ? parts.join(' / ') : '未设置';
}
