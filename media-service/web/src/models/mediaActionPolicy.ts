import type { BusinessFlowOperation, ManagedMediaItem, MediaAction } from './media';

export const TASK_CREATION_ACTIONS = new Set<MediaAction>(['delete', 'transcode', 'upgrade']);

export const BLOCKED_REASON_LABELS: Record<string, string> = {
  active_task_exists: '已有未结案任务',
  metadata_missing: '元数据不完整',
  scrape_not_supported_for_standard_media: '普通媒体元数据来自 Emby refresh / Douban sync',
  upgrade_not_supported_for_disc_like_source: '原盘暂不支持洗版',
  action_not_enabled: '后台自动入队未启用该 flow 操作',
  recent_task_cooldown: '最近已处理，仍在冷却期',
  queue_limit: '同类任务队列已达上限',
  already_transcoded: '已完成转码',
  scrape_state_not_auto_eligible: '当前刮削状态不适合自动入队',
};

export function allowedOperationForItem(item: ManagedMediaItem, operation: MediaAction): BusinessFlowOperation | null {
  const allowed = item.businessFlowDecision?.allowedOperations || [];
  return allowed.find((op) =>
    op.operation === operation
    && TASK_CREATION_ACTIONS.has(op.operation as MediaAction)
    && op.bridgeKind
  ) || null;
}

export function preferredTaskAction(item: ManagedMediaItem): MediaAction | null {
  const allowed = item.businessFlowDecision?.allowedOperations || [];
  const preferred = item.businessFlowDecision?.recommendedOperation || item.recommendedAction;
  if (preferred === 'keep') return null;
  if (typeof preferred === 'string' && TASK_CREATION_ACTIONS.has(preferred as MediaAction)) {
    if (allowedOperationForItem(item, preferred as MediaAction)) return preferred as MediaAction;
  }
  if (preferred) return null;
  const fallback = allowed.find((op) =>
    TASK_CREATION_ACTIONS.has(op.operation as MediaAction)
    && op.bridgeKind
  );
  return fallback ? (fallback.operation as MediaAction) : null;
}

export function blockedReasonText(item: ManagedMediaItem, operation?: string, fallback = ''): string {
  if (!item.businessFlowDecision) return '缺少后端业务决策，已禁止直接创建任务';
  const reason = operation
    ? item.businessFlowDecision.blockedReasons?.[operation]
    : item.businessFlowDecision.diagnosticSummary?.primaryBlockedReason;
  const label = typeof reason === 'string' ? (BLOCKED_REASON_LABELS[reason] || reason) : '';
  const blocked = operation
    ? item.businessFlowDecision.blockedOperations?.find((op) => op.operation === operation)
    : undefined;
  const missing = blocked?.metadataMissingReasons?.length
    ? `：${blocked.metadataMissingReasons.join('、')}`
    : '';
  return label ? `${label}${missing}` : fallback;
}
