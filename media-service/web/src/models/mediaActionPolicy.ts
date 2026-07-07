import type { BusinessFlowOperation, ManagedMediaItem, MediaSelectedFlow } from './media';

export const TASK_CREATION_SELECTED_FLOWS = new Set<MediaSelectedFlow>(['delete', 'transcode', 'upgrade']);

export const BLOCKED_REASON_LABELS: Record<string, string> = {
  active_task_exists: '已有未结案任务',
  metadata_missing: '元数据不完整',
  scrape_not_supported_for_standard_media: '普通媒体元数据来自 Emby ingest / Douban sync',
  upgrade_not_supported_for_disc_like_source: '原盘暂不支持洗版',
  target_or_flow_not_enabled: '后台自动入队未启用该目标或实现路径',
  recent_task_cooldown: '最近已处理，仍在冷却期',
  queue_limit: '同类任务队列已达上限',
  already_transcoded: '已完成转码',
  scrape_state_not_auto_eligible: '当前刮削状态不适合自动入队',
};

export function allowedTargetFlowForItem(item: ManagedMediaItem, flow: MediaSelectedFlow): BusinessFlowOperation | null {
  const allowed = item.businessFlowDecision?.allowedTargets || [];
  return allowed.find((op) =>
    (op.selectedFlow || op.operation) === flow
    && TASK_CREATION_SELECTED_FLOWS.has((op.selectedFlow || op.operation) as MediaSelectedFlow)
    && op.targetGate
  ) || null;
}

export function preferredTaskFlow(item: ManagedMediaItem): MediaSelectedFlow | null {
  const allowed = item.businessFlowDecision?.allowedTargets || [];
  const preferredTarget = item.businessFlowDecision?.recommendedTargetGate || item.businessFlowDecision?.nextTargetGate || '';
  const preferredFlow = allowed.find((op) => op.targetGate === preferredTarget && op.selectedFlow)?.selectedFlow;
  const preferred = preferredFlow;
  if (typeof preferred === 'string' && TASK_CREATION_SELECTED_FLOWS.has(preferred as MediaSelectedFlow)) {
    if (allowedTargetFlowForItem(item, preferred as MediaSelectedFlow)) return preferred as MediaSelectedFlow;
  }
  if (preferred) return null;
  const fallback = allowed.find((op) =>
    TASK_CREATION_SELECTED_FLOWS.has((op.selectedFlow || op.operation) as MediaSelectedFlow)
    && op.targetGate
  );
  return fallback ? ((fallback.selectedFlow || fallback.operation) as MediaSelectedFlow) : null;
}

export function blockedReasonText(item: ManagedMediaItem, operation?: string, fallback = ''): string {
  if (!item.businessFlowDecision) return '缺少后端业务决策，已禁止直接创建任务';
  const reason = operation
    ? item.businessFlowDecision.blockedTargets?.find((op) => (op.selectedFlow || op.operation) === operation)?.reason
    : item.businessFlowDecision.diagnosticSummary?.primaryBlockedReason;
  const label = typeof reason === 'string' ? (BLOCKED_REASON_LABELS[reason] || reason) : '';
  const blocked = operation
    ? item.businessFlowDecision.blockedTargets?.find((op) => (op.selectedFlow || op.operation) === operation)
    : undefined;
  const missing = blocked?.metadataMissingReasons?.length
    ? `：${blocked.metadataMissingReasons.join('、')}`
    : '';
  return label ? `${label}${missing}` : fallback;
}
