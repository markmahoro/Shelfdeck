/**
 * [models] 任务数据模型 — 纯类型 + 状态展示辅助。
 *
 * 不包含调度逻辑。调度由 service TaskScheduler 负责。
 */

export type TaskActionType = 'delete' | 'transcode' | 'upgrade';

export type TaskFlowLogLevel = 'info' | 'warn' | 'error';

export type TaskFlowLogEntry = {
  ts: string;
  level: TaskFlowLogLevel;
  code: string;
  message: string;
};

export type TaskStatus =
  | 'pending_manual'
  | 'queued'
  | 'precheck'
  | 'executing'
  | 'verify'
  | 'awaiting_user_confirm'
  | 'done'
  | 'failed_hard'
  | 'waiting_media_source'
  | 'interrupted'
  | 'resume_pending'
  | 'paused';

export interface MediaTask {
  id: string;
  itemId: string;
  itemName: string;
  actionType: TaskActionType;
  status: TaskStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  lastSearchAt?: string;
  nextSearchAt?: string;
  pauseRequested?: boolean;
  deleteConfirmLines?: string[];
  flowLog?: TaskFlowLogEntry[];
  transcodeOriginalSizeGb?: number;
  transcodeResultSizeGb?: number;
  preReplaceHash?: string;
  transcodeReplaceAttempt?: number;
  transcodeTempDir?: string;
  transcodePartialPath?: string;
  transcodeTargetPath?: string;
  transcodeSubstage?: 'encode' | 'replace';
  transcodeIsDolbyVision?: boolean;
  transcodeDvAcknowledged?: boolean;
  transcodeConfirmKind?: 'dolby_vision' | 'replace';
  transcodeDurationSec?: number;
}

const FLOW_LOG_MAX = 400;

export function appendFlowLog(task: MediaTask, code: string, message: string, level: TaskFlowLogLevel = 'info'): MediaTask {
  const ts = new Date().toISOString();
  const entry: TaskFlowLogEntry = { ts, level, code, message };
  const flowLog = [...(task.flowLog ?? []), entry].slice(-FLOW_LOG_MAX);
  return { ...task, flowLog };
}

export function formatFlowLogLineForUser(e: TaskFlowLogEntry): string {
  const t = new Date(e.ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${String(t.getMilliseconds()).padStart(3, '0')}`;
  return `[${stamp}] [${e.level}] ${e.message}`;
}

export function formatFlowLogLine(e: TaskFlowLogEntry): string {
  const t = new Date(e.ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${String(t.getMilliseconds()).padStart(3, '0')}`;
  return `[${stamp}] [${e.level}] ${e.code} | ${e.message}`;
}

export function isTaskTerminal(task: MediaTask): boolean {
  return task.status === 'done' || task.status === 'failed_hard';
}

export function hasActiveTaskForItem(tasks: MediaTask[], itemId: string): boolean {
  return tasks.some((t) => t.itemId === itemId && !isTaskTerminal(t));
}

export function taskOccupiesActiveSlot(task: MediaTask): boolean {
  return task.status === 'precheck' || task.status === 'executing' || task.status === 'verify';
}

export function canUserExecuteTask(task: MediaTask): boolean {
  return task.status === 'pending_manual' || task.status === 'paused';
}

export function canUserPauseTask(task: MediaTask): boolean {
  if (isTaskTerminal(task) || task.status === 'paused') return false;
  if (task.status === 'pending_manual') return false;
  return true;
}

export function transcodeVolumeSummaryLine(task: MediaTask): string | null {
  if (task.actionType !== 'transcode') return null;
  const o = task.transcodeOriginalSizeGb;
  const r = task.transcodeResultSizeGb;
  if (o == null && r == null) return null;
  if (o != null && r != null) {
    const saved = o - r;
    if (saved > 0) return `压制体积：${o.toFixed(2)} GB → ${r.toFixed(2)} GB · 节省 ${saved.toFixed(2)} GB`;
    return `压制体积：${o.toFixed(2)} GB → ${r.toFixed(2)} GB（体积未减小，未替换原文件）`;
  }
  if (o != null) return `源文件体积（已记账）：${o.toFixed(2)} GB`;
  if (r != null) return `转码后体积（已记账）：${r.toFixed(2)} GB`;
  return null;
}

export function taskStatusLabelZh(status: TaskStatus): string {
  const m: Record<TaskStatus, string> = {
    pending_manual: '待启动',
    queued: '排队中',
    precheck: '预检中',
    executing: '执行中',
    verify: '校验中',
    awaiting_user_confirm: '待信息确认',
    waiting_media_source: '等待媒体片源',
    paused: '已暂停',
    interrupted: '已中断',
    resume_pending: '待恢复',
    done: '已完成',
    failed_hard: '已失败',
  };
  return m[status] ?? status;
}
