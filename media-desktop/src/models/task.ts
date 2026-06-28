/**
 * [models] 任务数据模型 — 纯类型 + 状态展示辅助。
 *
 * 不包含调度逻辑。调度由 service TaskScheduler 负责。
 */

export type TaskActionType = 'ingest' | 'delete' | 'transcode' | 'upgrade' | 'scrape';

export type TaskFlowLogLevel = 'info' | 'warn' | 'error';

export type TaskFlowLogEntry = {
  ts: string;
  level: TaskFlowLogLevel;
  code: string;
  message: string;
};

export type TaskStatus =
  | 'created'
  | 'pending_manual'
  | 'queued'
  | 'precheck'
  | 'executing'
  | 'verify'
  | 'awaiting_user_confirm'
  | 'done'
  | 'failed_hard'
  | 'pausing'
  | 'waiting_media_source'
  | 'interrupted'
  | 'resume_pending'
  | 'paused';

export interface UpgradeCandidate {
  title: string;
  site: string;
  size: number;
  seeders: number;
  resolution: string;
  codec: string;
  edition: string;
  index: number;
}

export interface TaskItemInfo {
  name?: string;
  type?: string;
  seriesName?: string;
  seasonNumber?: number;
  path?: string;
  size?: number;
  resolution?: string;
  bitrate?: number;
  originalSizeBytes?: number;
  originalVideoCodec?: string;
  originalWidth?: number;
  originalHeight?: number;
  originalAudioCodec?: string;
  originalBitrate?: number;
  searchCandidatesSimplified?: UpgradeCandidate[];
  stagingFolder?: string;
  stagingMediaPath?: string;
}

export interface VerifyResult {
  sizeBytes: number;
  videoCodec: string;
  width: number;
  height: number;
  bitrate: number;
  durationSec: number;
  previewPath?: string;
}

export interface UpgradePreview {
  oldFile: { name: string; size: number; resolution: string; bitrate: number };
  newFile: { name: string; size: number };
  tmdbVerified: boolean;
  tmdbId: number | null;
}

export type ApprovalMode = 'auto' | 'confirm' | 'forceConfirm';

export interface TaskApproval {
  gateId: string;
  mode: ApprovalMode;
  title?: string;
  message?: string;
  options?: string[];
  payload?: Record<string, unknown>;
}

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
  resumePoint?: string;
  approval?: TaskApproval | null;
  priority?: number;
  itemInfo?: TaskItemInfo;
  verifyResult?: VerifyResult;
  upgradePreview?: UpgradePreview;
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
  if (task.status === 'pending_manual' || task.status === 'awaiting_user_confirm') return false;
  return true;
}

export function canUserConfirmTask(task: MediaTask): boolean {
  return task.status === 'awaiting_user_confirm';
}

export function canUserResumeTask(task: MediaTask): boolean {
  return task.status === 'paused' || task.status === 'pending_manual';
}

export function canUserDeleteTask(task: MediaTask): boolean {
  return !isTaskTerminal(task) || task.status === 'done' || task.status === 'failed_hard';
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

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1_000_000;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1000).toFixed(0)} KB`;
}

export function taskStatusLabelZh(status: TaskStatus): string {
  const m: Record<TaskStatus, string> = {
    pending_manual: '待启动',
    created: '已创建',
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
    pausing: '暂停中',
  };
  return m[status] ?? status;
}
