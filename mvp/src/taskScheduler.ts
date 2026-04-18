import { nextStatusFor, shouldRefreshWaitingMediaSource, type MediaTask, type TaskActionType } from './taskQueue';

const DEFAULT_SETTINGS: TaskSchedulerSettings = {
  deleteConcurrency: 1,
  transcodeConcurrency: 1,
  upgradeConcurrency: 1,
  runMode: 'manual',
  waitingFastRetryCount: 3,
  waitingFastIntervalHours: 24,
  waitingMidRetryCount: 10,
  waitingMidIntervalDays: 3,
  waitingSlowIntervalDays: 7,
  wallRatingAutoEnqueue: false,
  transcodeAutoReplace: false,
  transcodeEncodePool: { cpuParticipation: 1, entries: [] },
};

type TaskBuckets = {
  delete: number;
  transcode: number;
  upgrade: number;
};

/** 占活跃执行槽（§3.5） */
function activeBuckets(tasks: MediaTask[]): TaskBuckets {
  const buckets: TaskBuckets = { delete: 0, transcode: 0, upgrade: 0 };
  for (const task of tasks) {
    if (task.status === 'precheck' || task.status === 'executing' || task.status === 'verify') {
      buckets[task.actionType] += 1;
    }
  }
  return buckets;
}

function runnableTask(task: MediaTask): boolean {
  return (
    task.status === 'queued' ||
    task.status === 'resume_pending' ||
    task.status === 'precheck' ||
    task.status === 'executing' ||
    task.status === 'verify'
  );
}

export type AdvanceTaskQueueOptions = {
  /** 仅对这些任务应用调度推进（用于手动批量）；`paused` 与 `pending_manual` 等始终不推进。 */
  onlyTaskIds: Set<string>;
};

function canStart(taskType: TaskActionType, buckets: TaskBuckets, settings: TaskSchedulerSettings): boolean {
  if (taskType === 'delete') return buckets.delete < Math.max(1, settings.deleteConcurrency);
  if (taskType === 'transcode') return buckets.transcode < Math.max(1, settings.transcodeConcurrency);
  return buckets.upgrade < Math.max(1, settings.upgradeConcurrency);
}

export function defaultSchedulerSettings(): TaskSchedulerSettings {
  return { ...DEFAULT_SETTINGS };
}

export function waitingMediaDelayMs(retryCount: number, settings: TaskSchedulerSettings): number {
  if (retryCount < settings.waitingFastRetryCount) return Math.max(1, settings.waitingFastIntervalHours) * 60 * 60 * 1000;
  if (retryCount < settings.waitingMidRetryCount) return Math.max(1, settings.waitingMidIntervalDays) * 24 * 60 * 60 * 1000;
  return Math.max(1, settings.waitingSlowIntervalDays) * 24 * 60 * 60 * 1000;
}

export function advanceTaskQueue(
  tasks: MediaTask[],
  settings: TaskSchedulerSettings,
  opts?: AdvanceTaskQueueOptions,
): MediaTask[] {
  const restrict = opts != null;
  const onlyIds = opts?.onlyTaskIds ?? new Set<string>();

  const inManualScope = (t: MediaTask) => {
    if (!restrict) return true;
    if (!onlyIds.has(t.id)) return false;
    if (t.status === 'paused') return false;
    return true;
  };

  const scopedForBuckets = tasks.filter((t) => inManualScope(t));
  const nowIso = new Date().toISOString();
  let buckets = activeBuckets(scopedForBuckets);
  return tasks.map((task) => {
    if (!inManualScope(task)) return task;
    if (task.status === 'paused' || task.status === 'pending_manual' || task.status === 'awaiting_user_confirm') return task;
    if (!runnableTask(task)) return task;
    if (
      (task.actionType === 'delete' || task.actionType === 'transcode') &&
      (task.status === 'precheck' || task.status === 'executing' || task.status === 'verify')
    ) {
      return task;
    }
    if (
      (task.status === 'queued' || task.status === 'resume_pending') &&
      !canStart(task.actionType, buckets, settings)
    ) {
      return task;
    }
    const next = nextStatusFor(task);
    if (task.status === 'queued' || task.status === 'resume_pending') {
      if (next === 'precheck') buckets[task.actionType] += 1;
    }
    if (task.status === 'executing') {
      return { ...task, status: next, progress: Math.min(95, task.progress + 35), updatedAt: nowIso };
    }
    if (task.status === 'verify') {
      if (task.pauseRequested) {
        return { ...task, status: 'paused', pauseRequested: false, progress: 100, updatedAt: nowIso };
      }
      if (next === 'awaiting_user_confirm') {
        return { ...task, status: 'awaiting_user_confirm', progress: 100, updatedAt: nowIso };
      }
      return { ...task, status: next, progress: 100, updatedAt: nowIso };
    }
    return { ...task, status: next, updatedAt: nowIso };
  });
}

export function refreshWaitingTasks(tasks: MediaTask[], nowMs = Date.now(), settings?: TaskSchedulerSettings): MediaTask[] {
  return tasks.map((task) => {
    if (!shouldRefreshWaitingMediaSource(task, nowMs)) return task;
    const nextTask = {
      ...task,
      status: 'queued' as const,
      pauseRequested: false,
      updatedAt: new Date(nowMs).toISOString(),
    };
    if (!settings) return nextTask;
    return nextTask;
  });
}

export function applyControl(tasks: MediaTask[], action: TaskControlAction): MediaTask[] {
  const nowIso = new Date().toISOString();
  if (action === 'simulateExit') {
    return tasks.map((task) => {
      if (task.status === 'precheck' || task.status === 'executing' || task.status === 'verify') {
        return { ...task, status: 'interrupted', pauseRequested: false, updatedAt: nowIso };
      }
      return task;
    });
  }
  if (action === 'resumeInterrupted') {
    return tasks.map((task) => (task.status === 'interrupted' ? { ...task, status: 'resume_pending', updatedAt: nowIso } : task));
  }
  return tasks;
}
