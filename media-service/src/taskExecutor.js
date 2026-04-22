'use strict';

const embyService = require('./services/embyService');
const configStore = require('./configStore');
const taskStore = require('./taskStore');

/** 调用序号：用于追踪同一 taskId 是否被多次 driveTask 接管 */
let _driveCallSeq = 0;
/** taskId → 当前 driveTask 调用序号（由 driveTask 设置，finally 中清除） */
const _driveCallIds = new Map();

/** Throttle progress 写盘：离上次写盘是否超过 1 秒，或跨越了 5% 门槛 */
const PROGRESS_WRITE_INTERVAL_MS = 1000;
const PROGRESS_WRITE_THRESHOLD_PCT = 5;

/** 防止同一任务被并发执行 */
const runningTasks = new Set();

function log(...args) {
  console.log('[taskExecutor]', new Date().toISOString(), ...args);
}

/** 全局序列号：每次 appendFlowLog 递增，用 seq 取代 ts 做去重比对 */
let _flowSeq = 0;

/** 每个 task 的 appendFlowLog 锁：防止同一 task 的并发写入导致重复 */
const _appendLock = new Set();

/**
 * 追加 flowLog 条目。
 * 使用递增 seq 而非 timestamp 做去重 — seq 绝对唯一，timestamp 只做展示。
 * updateTask 内部合并 flowLog 条目。
 */
function appendFlowLog(taskId, entry, callId) {
  // 如果调用方未传入 callId，尝试从当前 driveTask 上下文获取
  const effectiveCallId = callId !== undefined ? callId : _driveCallIds.get(taskId);
  // 并发保护：如果该 task 已在写入（同一 task 的并发 appendFlowLog），等待并跳过
  if (_appendLock.has(taskId)) {
    // 已有人正在写入，本调用直接跳过（entry 已在写入方的 updateTask merge 中）
    return;
  }
  _appendLock.add(taskId);
  try {
    const newEntry = { seq: ++_flowSeq, ts: new Date().toISOString(), callId: effectiveCallId, ...entry };
    taskStore.updateTask(taskId, {
      flowLog: [newEntry],
    });
  } finally {
    _appendLock.delete(taskId);
  }
}

/**
 * 从 config.transcodeEncodePool 构建 orderedDeviceSlots（priority 升序入池设备）。
 * 防御：格式不对时返回空数组，并触发 failed_hard。
 */
function buildOrderedDeviceSlots(config, forceCpuOnly = false) {
  const pool = config.transcodeEncodePool;
  if (!pool || typeof pool !== 'object') {
    return [];
  }
  const entries = Array.isArray(pool.entries) ? pool.entries : [];

  // CPU 参与策略：优先从 pool.cpuParticipation 读，fallback 到顶层字段
  const cpuStrategy =
    (pool.cpuParticipation || config.transcodeCpuParticipationStrategy || 'normal');

  const filtered = entries.filter((e) => {
    if (!e || !e.inPool) return false;
    const key = String(e.stableKey || '');
    if (!key) return false;
    const isCpu = key.startsWith('cpu:');

    if (forceCpuOnly) {
      // cpu_only 任务：只返回 CPU 设备
      return isCpu;
    }

    // gpu_ok 任务：backup-only 策略下排除 CPU 设备
    if (cpuStrategy === 'backup-only' && isCpu) {
      return false;
    }

    return true;
  });

  const sorted = filtered.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  return sorted.map((e) => ({
    deviceId: String(e.stableKey),
    maxSlots: Math.max(1, Number(e.maxSlots) || 1),
  }));
}

/**
 * Delete Flow：precheck → awaiting_user_confirm → executing → verify → done
 */
async function runDeleteFlow(task, callId) {
  const taskId = task.id;
  log(`DeleteFlow start`, taskId);

  const config = configStore.loadConfig();
  const embyConfig = config.embyClient || config;

  // confirm 后恢复：跳过 precheck，直接进入 executing
  if (task.resumePoint === 'delete_executing') {
    appendFlowLog(taskId, { level: 'info', code: 'delete.executing', message: '恢复删除执行' });
    await doDeleteExecute(taskId, embyConfig);
    return;
  }

  // precheck：校验 Emby 连接、条目仍存在、拉取 DeleteInfo
  taskStore.updateTask(taskId, { status: 'precheck' });
  appendFlowLog(taskId, { level: 'info', code: 'delete.precheck', message: '开始删除预检' });

  try {
    await embyService.getItemDeleteInfo({ config: embyConfig, itemId: task.itemId });
  } catch (e) {
    appendFlowLog(taskId, { level: 'error', code: 'delete.precheck.failed', message: e.message });
    taskStore.updateTask(taskId, { status: 'failed_hard' });
    return;
  }

  // 校验条目仍存在
  try {
    const exists = await embyService.libraryItemExists({ config: embyConfig, itemId: task.itemId });
    if (!exists) {
      appendFlowLog(taskId, { level: 'info', code: 'delete.done', message: '条目已在 Emby 中不存在，视为已删除' });
      taskStore.updateTask(taskId, { status: 'done', progress: 100 });
      return;
    }
  } catch (e) {
    appendFlowLog(taskId, { level: 'error', code: 'delete.precheck.error', message: e.message });
    taskStore.updateTask(taskId, { status: 'failed_hard' });
    return;
  }

  appendFlowLog(taskId, { level: 'info', code: 'delete.awaiting_confirm', message: '等待用户确认删除' });
  taskStore.updateTask(taskId, { status: 'awaiting_user_confirm' });
  // 停泊，等 confirm API
}

async function doDeleteExecute(taskId, embyConfig) {
  taskStore.updateTask(taskId, { status: 'executing' });
  appendFlowLog(taskId, { level: 'info', code: 'delete.executing', message: '正在从 Emby 删除条目' });

  try {
    await embyService.deleteLibraryItem({ config: embyConfig, itemId: taskStore.getTask(taskId).itemId });
  } catch (e) {
    appendFlowLog(taskId, { level: 'error', code: 'delete.executing.failed', message: e.message });
    taskStore.updateTask(taskId, { status: 'failed_hard' });
    return;
  }

  // verify：确认条目已不存在（404）
  taskStore.updateTask(taskId, { status: 'verify' });
  appendFlowLog(taskId, { level: 'info', code: 'delete.verify', message: '校验条目已删除' });

  try {
    const exists = await embyService.libraryItemExists({ config: embyConfig, itemId: taskStore.getTask(taskId).itemId });
    if (exists) {
      appendFlowLog(taskId, { level: 'error', code: 'delete.verify.failed', message: '条目仍然存在，删除可能未成功' });
      taskStore.updateTask(taskId, { status: 'failed_hard' });
      return;
    }
  } catch (e) {
    // 404 或类似错误说明已删除
  }

  appendFlowLog(taskId, { level: 'info', code: 'delete.done', message: '删除成功' });
  taskStore.updateTask(taskId, { status: 'done', progress: 100 });
}

/**
 * Transcode Flow：precheck → executing → verify → (awaiting_user_confirm) → replace → done
 */
async function runTranscodeFlow(task, transcodeService) {
  const taskId = task.id;
  log(`TranscodeFlow start`, taskId);

  const config = configStore.loadConfig();
  const embyConfig = config.embyClient || config;

  // 判断是否需要从 resumePoint 恢复（confirm 后带着 resumePoint 回来）
  const resumePoint = task.resumePoint;

  // precheck：临时根、源可读、DV 检测
  taskStore.updateTask(taskId, { status: 'precheck' });
  appendFlowLog(taskId, { level: 'info', code: 'transcode.precheck', message: '开始转码预检' });

  let precheckResult;
  try {
    precheckResult = await transcodeService.precheck({
      config: { ...config, ...embyConfig },
      task: {
        id: taskId,
        itemId: task.itemId,
        transcodeDvAcknowledged: task.transcodeDvAcknowledged,
      },
    });
  } catch (e) {
    appendFlowLog(taskId, { level: 'error', code: 'transcode.precheck.failed', message: e.message });
    taskStore.updateTask(taskId, { status: 'failed_hard' });
    return;
  }

  if (precheckResult.needsDvConfirm && !resumePoint) {
    appendFlowLog(taskId, { level: 'warn', code: 'transcode.dv.confirm', message: '杜比视界片源需用户知情确认' });
    taskStore.updateTask(taskId, { status: 'awaiting_user_confirm' });
    return;
  }

  // 构建 orderedDeviceSlots 并校验非空
  const slots = buildOrderedDeviceSlots(config);
  if (slots.length === 0) {
    appendFlowLog(taskId, { level: 'error', code: 'transcode.no_encode_device', message: '未配置转码编码资源池，请在配置页完成设置' });
    taskStore.updateTask(taskId, { status: 'failed_hard' });
    return;
  }

  // executing：压制（resumePoint === 'transcode_executing' 时跳过 precheckDV）
  taskStore.updateTask(taskId, { status: 'executing', progress: 0 });
  appendFlowLog(taskId, { level: 'info', code: 'transcode.executing', message: '开始压制' });

  const progressTracker = {
    lastPct: 0,
    lastWriteMs: 0,
    onProgress: (p) => {
      const pct = Math.min(99, Math.max(0, p.progress || 0));
      const now = Date.now();
      const crossedThreshold = pct - progressTracker.lastPct >= PROGRESS_WRITE_THRESHOLD_PCT;
      const overInterval = now - progressTracker.lastWriteMs >= PROGRESS_WRITE_INTERVAL_MS;
      if (crossedThreshold || overInterval) {
        taskStore.updateTask(taskId, { progress: pct });
        progressTracker.lastPct = pct;
        progressTracker.lastWriteMs = now;
      }
    },
  };

  let encodeResult;
  try {
    encodeResult = await transcodeService.startEncode(progressTracker, {
      config,
      taskId,
      sourcePath: precheckResult.sourcePath,
      partialPath: precheckResult.partialPath,
      orderedDeviceSlots: slots,
      isDolbyVision: precheckResult.isDolbyVision,
      dvAcknowledged: task.transcodeDvAcknowledged,
      durationSec: precheckResult.durationSec,
    });
  } catch (e) {
    appendFlowLog(taskId, { level: 'error', code: 'transcode.executing.failed', message: e.message });
    taskStore.updateTask(taskId, { status: 'failed_hard' });
    return;
  }

  // verify：压制后校验
  taskStore.updateTask(taskId, { status: 'verify', progress: 90 });
  appendFlowLog(taskId, { level: 'info', code: 'transcode.verify', message: '压制完成，开始校验' });

  try {
    await transcodeService.probeSummary(config, precheckResult.partialPath);
  } catch (e) {
    appendFlowLog(taskId, { level: 'error', code: 'transcode.verify.failed', message: e.message });
    taskStore.updateTask(taskId, { status: 'failed_hard' });
    return;
  }

  // 替换前确认：若需要确认且尚未确认，则停泊
  if (config.transcodeReplaceConfirmRequired && task.resumePoint !== 'transcode_replace') {
    appendFlowLog(taskId, { level: 'info', code: 'transcode.replace.confirm', message: '替换前需用户确认' });
    taskStore.updateTask(taskId, { status: 'awaiting_user_confirm' });
    return;
  }

  // 直接进入 replace（resumePoint === 'transcode_replace' 时已通过 confirm，跳过本检查）
  await doReplace(taskId, precheckResult, transcodeService, config);
}

/**
 * replace 子流程：从 staging 文件替换正式文件，处理 .etp.bak 备份链。
 */
async function doReplace(taskId, precheckResult, transcodeService, config) {
  appendFlowLog(taskId, { level: 'info', code: 'transcode.replace', message: '开始替换' });
  try {
    const result = await transcodeService.replaceWithRetries({
      config,
      targetPath: precheckResult.targetPath,
      partialPath: precheckResult.partialPath,
    });
    appendFlowLog(taskId, {
      level: 'info',
      code: 'transcode.done',
      message: `转码完成，节省${result.resultSizeBytes ? '' : '（体积计算中）'}`,
    });
    taskStore.updateTask(taskId, { status: 'done', progress: 100 });
  } catch (e) {
    appendFlowLog(taskId, { level: 'error', code: 'transcode.replace.failed', message: e.message });
    taskStore.updateTask(taskId, { status: 'failed_hard' });
  }
}

/**
 * Upgrade Flow：空壳，直接 failed_hard
 */
async function runUpgradeFlow(task) {
  log(`UpgradeFlow: ${task.id} — 洗版功能待实现`);
  appendFlowLog(task.id, {
    level: 'error',
    code: 'upgrade.not_implemented',
    message: '洗版功能待实现（MoviePilot 集成尚未接入）',
  });
  taskStore.updateTask(task.id, { status: 'failed_hard' });
}

/**
 * 驱动一个任务的 Flow 到下一个步骤。
 * 由 scheduler 每轮调用。
 * 返回 true 表示任务被接管并推进了，false 表示未处理（不符合调度条件）。
 */
async function driveTask(taskId) {
  const callId = ++_driveCallSeq;
  log(`driveTask[${callId}] start`, taskId);
  // 双重并发保护：
  // 1. runningTasks Set — 防止同一 scheduler 轮次内的重入（函数级保护）
  // 2. task.driving 标记 — 防止跨 scheduler 轮次的重入（即使 driveTask 已返回，
  //    只要 Flow 的 async 链尚未彻底结束，driving 标记就仍在，防止后续 tick 提前接管）
  if (runningTasks.has(taskId)) return false;
  runningTasks.add(taskId);

  try {
    const task = taskStore.getTask(taskId);
    if (!task) return false;

    // 如果另一个 driveTask 已在 driving（Flow 的 async 链尚未结束），跳过
    if (task.driving) return false;

    // 不处理已结案任务
    if (task.status === 'done' || task.status === 'failed_hard') return false;

    // 处于 awaiting_user_confirm 的任务，等待 confirm API，不在此驱动
    if (task.status === 'awaiting_user_confirm') return false;

    // 处于 paused 的任务，不推进
    if (task.status === 'paused') return false;

    // 处于 waiting_media_source 的 upgrade 任务，不在此驱动（由定时器或外部事件触发）
    if (task.status === 'waiting_media_source') return false;

    // 只有 queued 或 created 状态才推进
    if (task.status !== 'queued' && task.status !== 'created') {
      return false;
    }

    // 标记为 driving（Flow 的 async 链正式开始）
    taskStore.updateTask(taskId, { driving: true });
    _driveCallIds.set(taskId, callId);

    // 此时状态应为 queued 或 created，进入对应 Flow
    switch (task.actionType) {
      case 'delete':
        await runDeleteFlow(task);
        break;
      case 'transcode':
        // transcodeService 由调用方注入，避免循环依赖
        if (!driveTask._transcodeService) {
          driveTask._transcodeService = require('./services/transcodeService');
        }
        await runTranscodeFlow(task, driveTask._transcodeService);
        break;
      case 'upgrade':
        await runUpgradeFlow(task);
        break;
      default:
        log(`Unknown actionType: ${task.actionType}`);
        taskStore.updateTask(taskId, { status: 'failed_hard' });
    }

    return true;
  } finally {
    runningTasks.delete(taskId);
    _driveCallIds.delete(taskId);
    // 只有任务达到终态才清除 driving 标记；中间态（awaiting_user_confirm 等）保留标记，
    // 防止 scheduler 下一轮在 Flow 的 async 链尚未结束时提前接管。
    try {
      const finalTask = taskStore.getTask(taskId);
      if (finalTask && ['done', 'failed_hard', 'interrupted', 'paused'].includes(finalTask.status)) {
        taskStore.updateTask(taskId, { driving: false });
      }
    } catch (e) {
      // ignore: tasks 文件损坏等情况下不阻塞 scheduler
    }
  }
}

/**
 * 启动恢复：扫描 executing/precheck/verify 任务，降级为 interrupted。
 */
function recoverInterruptedTasks() {
  const tasks = taskStore.loadTasks();
  let count = 0;
  for (const t of tasks) {
    if (['precheck', 'executing', 'verify'].includes(t.status)) {
      log(`Recovering interrupted task: ${t.id} (${t.actionType}) from ${t.status}`);
      appendFlowLog(t.id, {
        level: 'warn',
        code: 'task.interrupted',
        message: `应用重启，任务从 ${t.status} 中断恢复`,
      });
      taskStore.updateTask(t.id, { status: 'interrupted', driving: false });
      count++;
    }
  }
  if (count > 0) {
    log(`Recovered ${count} interrupted tasks`);
  }
}

module.exports = {
  driveTask,
  appendFlowLog,
  buildOrderedDeviceSlots,
  recoverInterruptedTasks,
  runUpgradeFlow,
};
