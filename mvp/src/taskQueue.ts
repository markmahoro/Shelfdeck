const TASK_STORAGE_KEY = 'embyDesktopPlayerTaskQueueV1';

export type TaskActionType = 'delete' | 'transcode' | 'upgrade';
export type TaskRunMode = 'manual' | 'scheduled';

export type TaskFlowLogLevel = 'info' | 'warn' | 'error';

export type TaskFlowLogEntry = {
  ts: string;
  level: TaskFlowLogLevel;
  /** 机器可读片段，如 delete.precheck.start */
  code: string;
  message: string;
};

const FLOW_LOG_MAX = 400;

export function appendFlowLog(task: MediaTask, code: string, message: string, level: TaskFlowLogLevel = 'info'): MediaTask {
  const ts = new Date().toISOString();
  const entry: TaskFlowLogEntry = { ts, level, code, message };
  const flowLog = [...(task.flowLog ?? []), entry].slice(-FLOW_LOG_MAX);
  return { ...task, flowLog };
}

export function formatFlowLogLine(e: TaskFlowLogEntry): string {
  const t = new Date(e.ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${String(t.getMilliseconds()).padStart(3, '0')}`;
  return `[${stamp}] [${e.level}] ${e.code} | ${e.message}`;
}

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
  /** 占槽阶段软停（§9）：本步结束后进入 paused */
  pauseRequested?: boolean;
  /** delete Flow：预检后写入，供确认弹窗展示 */
  deleteConfirmLines?: string[];
  /** 任务级执行日志（持久化，用于高危 Flow 排查） */
  flowLog?: TaskFlowLogEntry[];
  /**
   * transcode Flow：压制前源文件总大小（GB，整文件，含未重编码的音轨/字幕）。
   * 由执行层在预检或开压前写入本地队列；与 Emby 刷新无关。
   */
  transcodeOriginalSizeGb?: number;
  /**
   * transcode Flow：压制完成且验收通过、原子替换后的文件总大小（GB）。
   * verify 通过且输出体积小于原体积时写入；用于任务卡展示节省容量。
   */
  transcodeResultSizeGb?: number;
  /** replace 前旧版目标成片摘要（§2.4.4）；首版可用 sha256 十六进制 */
  preReplaceHash?: string;
  /** replace 子流程累计失败次数（用于 UI；整段重试在 main 内最多 3 次） */
  transcodeReplaceAttempt?: number;
  /** 任务级临时工作目录（临时根下子目录） */
  transcodeTempDir?: string;
  /**  growing partial 绝对路径 */
  transcodePartialPath?: string;
  /** 最终成片绝对路径（与源同路径，替换目标） */
  transcodeTargetPath?: string;
  /** executing 阶段：encode=压制；replace=原子替换链 */
  transcodeSubstage?: 'encode' | 'replace';
  /** 预检识别为杜比视界片源 */
  transcodeIsDolbyVision?: boolean;
  /** 用户已在任务中心确认 DV 受控转码风险 */
  transcodeDvAcknowledged?: boolean;
  /** awaiting_user_confirm：dolby_vision | replace */
  transcodeConfirmKind?: 'dolby_vision' | 'replace';
  /** ffprobe 片长（秒），用于压制进度估算 */
  transcodeDurationSec?: number;
}

/** 任务卡「压制体积」展示文案；无记账数据时返回 null */
export function transcodeVolumeSummaryLine(task: MediaTask): string | null {
  if (task.actionType !== 'transcode') return null;
  const o = task.transcodeOriginalSizeGb;
  const r = task.transcodeResultSizeGb;
  if (o == null && r == null) return null;
  if (o != null && r != null) {
    const saved = o - r;
    if (saved > 0) {
      return `压制体积：${o.toFixed(2)} GB → ${r.toFixed(2)} GB · 节省 ${saved.toFixed(2)} GB`;
    }
    return `压制体积：${o.toFixed(2)} GB → ${r.toFixed(2)} GB（未缩小，按规则不采纳）`;
  }
  if (o != null) return `源文件体积（已记账）：${o.toFixed(2)} GB`;
  if (r != null) return `转码后体积（已记账）：${r.toFixed(2)} GB`;
  return null;
}

export function isTaskTerminal(task: MediaTask): boolean {
  return task.status === 'done' || task.status === 'failed_hard';
}

/** 同一 itemId 是否已有未结案任务（§5.2 互斥） */
export function hasActiveTaskForItem(tasks: MediaTask[], itemId: string): boolean {
  return tasks.some((t) => t.itemId === itemId && !isTaskTerminal(t));
}

/** 占槽：precheck / executing / verify */
export function taskOccupiesActiveSlot(task: MediaTask): boolean {
  return task.status === 'precheck' || task.status === 'executing' || task.status === 'verify';
}

/** §8：仅待启动 / 已暂停可点「执行」 */
export function canUserExecuteTask(task: MediaTask): boolean {
  return task.status === 'pending_manual' || task.status === 'paused';
}

/** §9：pending_manual 不可暂停；结案/已暂停不可 */
export function canUserPauseTask(task: MediaTask): boolean {
  if (isTaskTerminal(task) || task.status === 'paused') return false;
  if (task.status === 'pending_manual') return false;
  return true;
}

function normalizeImportedTasks(parsed: unknown[]): MediaTask[] {
  return parsed
    .filter((x): x is MediaTask => {
      if (!x || typeof x !== 'object') return false;
      const t = x as MediaTask;
      return typeof t.id === 'string' && typeof t.itemId === 'string' && typeof t.actionType === 'string';
    })
    .map((t) => {
      const statusRaw = (t as { status: unknown }).status;
      if (statusRaw === 'waiting_source') return { ...t, status: 'waiting_media_source' as TaskStatus };
      return t;
    });
}

function loadTaskQueueFromLocalStorage(): MediaTask[] {
  try {
    const raw = localStorage.getItem(TASK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeImportedTasks(parsed);
  } catch {
    return [];
  }
}

/**
 * 配置 `VITE_CONTROL_PLANE_URL`（桌面 dev/prod 默认已配）时任务队列 **仅** 走控制面，与 `TASK_STORAGE_KEY` 脱钩。
 * 纯浏览器调试（未配置 base）仍用 localStorage。
 */
export async function loadTaskQueue(): Promise<MediaTask[]> {
  const base = import.meta.env.VITE_CONTROL_PLANE_URL as string | undefined;
  if (base) {
    const url = `${String(base).replace(/\/$/, '')}/v1/sync/task-queue`;
    const headers: Record<string, string> = {};
    const k = import.meta.env.VITE_CONTROL_PLANE_API_KEY as string | undefined;
    if (k) headers['X-API-Key'] = k;
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) {
        console.error('[taskQueue] control plane GET /v1/sync/task-queue failed', r.status);
        throw new Error(`任务队列从控制面加载失败（HTTP ${r.status}），请确认控制面已启动。`);
      }
      const parsed = await r.json();
      if (Array.isArray(parsed)) return normalizeImportedTasks(parsed);
      throw new Error('任务队列从控制面加载失败：响应格式无效。');
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('任务队列从控制面加载失败')) throw e;
      console.error('[taskQueue] control plane GET /v1/sync/task-queue unreachable', e);
      throw new Error('任务队列从控制面加载失败：网络不可达或控制面未启动。');
    }
  }
  return loadTaskQueueFromLocalStorage();
}

export async function saveTaskQueue(tasks: MediaTask[]): Promise<void> {
  const base = import.meta.env.VITE_CONTROL_PLANE_URL as string | undefined;
  if (base) {
    const url = `${String(base).replace(/\/$/, '')}/v1/sync/task-queue`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const k = import.meta.env.VITE_CONTROL_PLANE_API_KEY as string | undefined;
    if (k) headers['X-API-Key'] = k;
    const r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(tasks) });
    if (!r.ok) {
      console.error('[taskQueue] control plane PUT /v1/sync/task-queue failed', r.status);
      throw new Error('任务队列同步到控制面失败，请确认控制面已启动。');
    }
    return;
  }
  localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
}

export function enqueueTask(
  input: { itemId: string; itemName: string; actionType: TaskActionType },
  runMode: TaskRunMode,
): MediaTask {
  const now = new Date().toISOString();
  const status: TaskStatus = runMode === 'scheduled' ? 'queued' : 'pending_manual';
  return {
    id: `${input.actionType}:${input.itemId}:${Date.now()}`,
    itemId: input.itemId,
    itemName: input.itemName,
    actionType: input.actionType,
    status,
    progress: 0,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
  };
}

export function nextStatusFor(task: MediaTask): TaskStatus {
  if (task.status === 'pending_manual') return 'pending_manual';
  if (task.status === 'paused') return 'paused';
  if (task.status === 'awaiting_user_confirm') return 'awaiting_user_confirm';
  if (task.status === 'queued') return 'precheck';
  if (task.status === 'precheck') return 'executing';
  if (task.status === 'executing') {
    if (task.actionType === 'transcode') return 'executing';
    return 'verify';
  }
  if (task.status === 'verify') {
    if (task.actionType === 'transcode') return 'verify';
    if (task.actionType === 'upgrade' && task.retryCount === 0) return 'awaiting_user_confirm';
    return 'done';
  }
  if (task.status === 'waiting_media_source') return 'precheck';
  if (task.status === 'interrupted') return 'resume_pending';
  if (task.status === 'resume_pending') return 'precheck';
  return task.status;
}

export function shouldRefreshWaitingMediaSource(task: MediaTask, nowMs: number): boolean {
  if (task.status !== 'waiting_media_source') return false;
  if (!task.nextSearchAt) return true;
  const dueMs = new Date(task.nextSearchAt).getTime();
  return Number.isFinite(dueMs) && dueMs <= nowMs;
}

export function markWaitingMediaSourceRetry(task: MediaTask): MediaTask {
  return markWaitingMediaSourceRetryWithDelay(task, 24 * 60 * 60 * 1000);
}

/** 任务中心列表展示用（内部 status → 用户可见） */
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

export function markWaitingMediaSourceRetryWithDelay(task: MediaTask, delayMs: number): MediaTask {
  const now = new Date();
  const next = new Date(now.getTime() + Math.max(60 * 1000, delayMs));
  return {
    ...task,
    status: 'waiting_media_source',
    progress: 0,
    pauseRequested: false,
    retryCount: task.retryCount + 1,
    lastSearchAt: now.toISOString(),
    nextSearchAt: next.toISOString(),
    updatedAt: now.toISOString(),
  };
}
