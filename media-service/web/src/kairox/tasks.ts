import type { MediaTask, TaskControlAction, TaskControlState } from '../types';
import type { KairoxTargetGate, KairoxTaskProjection } from './types';
import { normalizeTargetGate, toKairoxTaskProjection } from './projections';

export interface KairoxTaskView extends KairoxTaskProjection {
  title: string;
  source: string;
  statusLabel: string;
  progress: number;
  phase?: string;
  createdAt?: string;
  updatedAt?: string;
  objectiveSummary: string;
  controlHint: string;
  attentionKind?: string;
  raw: MediaTask;
}

export const TARGET_GATE_LABELS: Record<KairoxTargetGate, string> = {
  ingest: '入库',
  metadata: '元数据',
  optimize: '优化',
  archive: '归档',
  delete: '删除执行',
};

export const STATUS_LABELS: Record<string, string> = {
  created: '已创建',
  pending_manual: '待手动启动',
  queued: '排队中',
  executing: '执行中',
  pausing: '暂停中',
  awaiting_user_confirm: '等待确认',
  paused: '已暂停',
  interrupted: '已中断',
  waiting_media_source: '等待媒体文件',
  done: '已完成',
  failed_hard: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
  deleted: '已移除',
};

export const TARGET_GATE_OPTIONS: Array<{ value: KairoxTargetGate; label: string }> = [
  { value: 'ingest', label: TARGET_GATE_LABELS.ingest },
  { value: 'metadata', label: TARGET_GATE_LABELS.metadata },
  { value: 'optimize', label: TARGET_GATE_LABELS.optimize },
  { value: 'archive', label: TARGET_GATE_LABELS.archive },
  { value: 'delete', label: TARGET_GATE_LABELS.delete },
];

export const TERMINAL_TASK_STATUSES = new Set(['done', 'failed_hard', 'cancelled', 'skipped', 'deleted']);

export function toKairoxTaskView(task: MediaTask): KairoxTaskView {
  const base = toKairoxTaskProjection(task);
  const targetGate = normalizeTargetGate(task.taskTarget?.targetGate)
    || normalizeTargetGate(task.requestedIntent?.targetGate)
    || base.targetGate;
  return {
    ...base,
    targetGate,
    gateObjective: task.taskTarget?.gateObjective || base.gateObjective,
    title: task.itemInfo?.name || task.itemInfo?.title || task.itemName || task.itemId || task.id,
    source: sourceLabel(task),
    statusLabel: STATUS_LABELS[task.status] || task.status,
    progress: Math.max(0, Math.min(100, Math.round(task.progress || 0))),
    phase: task.phase || task.controlState?.phase || undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    objectiveSummary: objectiveSummary(task.taskTarget?.gateObjective || base.gateObjective),
    controlHint: controlHint(task.controlState),
    attentionKind: attentionKind(task),
    raw: task,
  };
}

export function taskTargetGateLabel(value?: KairoxTargetGate | string | null): string {
  const gate = normalizeTargetGate(value);
  return gate ? TARGET_GATE_LABELS[gate] : '目标 Gate 待补齐';
}

export function flowKindLabel(task: MediaTask): string {
  const flowPlan = task.flowPlan as Record<string, unknown> | undefined;
  const flowKind = stringValue(flowPlan?.flowKind)
    || stringValue(flowPlan?.direction);
  return flowKind || '由 Flow Planner 规划';
}

export function taskPrimaryAction(control?: TaskControlState): keyof TaskControlState['actions'] | null {
  if (!control) return null;
  const primary = control.primaryAction as keyof TaskControlState['actions'];
  if (primary && control.actions[primary]?.enabled) return primary;
  for (const key of ['confirm', 'execute', 'retry', 'pause'] as Array<keyof TaskControlState['actions']>) {
    if (control.actions[key]?.enabled) return key;
  }
  return null;
}

export function actionLabel(key: keyof TaskControlState['actions'], action: TaskControlAction): string {
  return action.label || {
    confirm: '确认继续',
    execute: '启动',
    retry: '重试',
    pause: '暂停',
    cancel: '取消',
  }[key];
}

function objectiveSummary(objective?: Record<string, unknown> | null): string {
  if (!objective || Object.keys(objective).length === 0) return '目标合同待补齐';
  const kind = stringValue(objective.kind);
  const description = stringValue(objective.description) || stringValue(objective.reason);
  const targetFacts = [
    valuePart('codec', objective.targetCodec),
    valuePart('bitrate', objective.targetBitrate),
    valuePart('maxSizeGB', objective.maxSizeGB),
    valuePart('metadataKind', objective.metadataKind),
  ].filter(Boolean);
  if (description && targetFacts.length > 0) return `${description}；${targetFacts.join('，')}`;
  if (description) return description;
  if (targetFacts.length > 0) return targetFacts.join('，');
  return kind || '目标事实已记录';
}

function valuePart(label: string, value: unknown): string {
  return value === undefined || value === null || value === '' ? '' : `${label}=${String(value)}`;
}

function sourceLabel(task: MediaTask): string {
  if (task.source === 'auto') return '自动';
  if (task.source === 'manual') return '手动';
  if (typeof task.source === 'string' && task.source) return task.source;
  const taskSource = task.itemInfo?.taskSource;
  return typeof taskSource === 'string' && taskSource ? taskSource : '未知来源';
}

function controlHint(control?: TaskControlState): string {
  if (!control) return '控制状态待补齐';
  if (control.confirmation?.required) return control.confirmation.message || '等待用户确认后继续';
  if (control.recovery?.state && control.recovery.state !== 'not_needed') {
    return control.recovery.reason || control.recovery.state;
  }
  const primary = taskPrimaryAction(control);
  if (primary) return actionLabel(primary, control.actions[primary]);
  return control.state || '无可执行操作';
}

function attentionKind(task: MediaTask): string | undefined {
  const control = task.controlState;
  if (control?.confirmation?.required || task.status === 'awaiting_user_confirm') return 'confirmation';
  if (task.status === 'failed_hard' || task.status === 'interrupted' || control?.recovery?.state === 'retry_available' || control?.recovery?.state === 'resume_available') return 'recovery';
  if (task.status === 'pending_manual' || task.status === 'created') return 'manual_start';
  if (control?.requiresUserAction) return 'needs_action';
  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
