import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adult, tasks, systemConfig } from '../api/client';
import type { TaskReport } from '../api/client';
import type { MediaTask, TaskControlAction, TaskControlState, TaskItemInfo, VerifyResult, UpgradeCandidate } from '../types';
import Modal from '../components/Modal';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const STATUS_COLORS: Record<string, string> = {
  queued: '#3498db',
  executing: '#f39c12',
  pausing: '#f39c12',
  awaiting_user_confirm: '#e67e22',
  done: '#27ae60',
  failed_hard: '#e74c3c',
  paused: '#888',
  interrupted: '#888',
  waiting_media_source: '#888',
  cancelled: '#888',
  skipped: '#888',
  deleted: '#888',
  created: '#999',
  pending_manual: '#999',
};

const STATUS_LABELS: Record<string, string> = {
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

const OPERATION_LABELS: Record<string, string> = {
  ingest: '入库',
  transcode: '转码压缩',
  delete: '删除',
  upgrade: '洗版',
  scrape: '刮削',
};

const REPORT_LABELS: Record<string, string> = {
  ingest: '入库报告',
  transcode: '转码报告',
  delete: '删除报告',
  upgrade: '洗版报告',
  scrape: '刮削报告',
};

const BRIDGE_LABELS: Record<string, string> = {
  metadata: '补元数据',
  optimize: '优化',
  archive: '归档',
};

const RESOURCE_LABELS: Record<string, string> = {
  local_transcode: '本机转码',
  worker_transcode: '远程转码',
  moviepilot: 'MoviePilot',
  scraper: '元数据抓取',
  local_ai: '本机 AI',
  filesystem: '文件系统',
  service_api: 'Service API',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  'task.created': '任务创建',
  'flow.planned': 'Flow 规划',
  'flow.dispatched': 'Flow 派发',
  'task.status_changed': '状态变化',
  'task.runtime_changed': '运行点变化',
  'approval.requested': '等待确认',
  'task.paused': '暂停',
  'task.resumed': '恢复',
  'task.interrupted': '中断',
  'task.restart_interrupted': '重启后中断恢复',
  'task.restart_recovery_queued': '重启后重新排队',
  'task.restart_recovery_failed': '重启恢复失败',
  'task.retry_recorded': '重试记录',
  'task.retry_requested': '请求重试',
  'task.failed': '失败',
  'task.manual_execute_requested': '手动启动',
};

const PHASE_LABELS: Record<string, string> = {
  precheck: '预检',
  planning: '搜索候选',
  ingest_precheck: '入库预检',
  ingest_probe: '媒体探测',
  ingest_commit: '写入媒体项',
  waiting_media_source: '等待媒体源',
  upgrade_executing: '下载/刮削',
  pre_replace_verify: '替换前验证',
  upgrade_replace: '替换中',
  scrape_precheck: '刮削预检',
  scrape_executing: '刮削中',
  scrape_write_metadata: '写入刮削结果',
  scrape_review: '刮削结果复核',
  scrape_paused: '刮削已暂停',
  transcode_precheck: '转码预检',
  transcode_executing: '编码中',
  transcode_verify: '转码验证',
  transcode_replace: '转码替换',
  verify: '验证',
  done: '已完成',
  failed_hard: '失败',
};

const APPROVAL_GATE_LABELS: Record<string, string> = {
  'delete.beforeExecute': '删除前确认',
  'transcode.dolbyVisionTonemap': '杜比视界转码确认',
  'transcode.beforeReplace': '转码替换确认',
  'upgrade.candidateSelect': '洗版候选选择',
  'upgrade.identityMismatch': '洗版身份异常确认',
  'upgrade.beforeReplace': '洗版替换确认',
  'scrape.beforeWriteMetadata': '刮削写入确认',
  'scrape.beforeOrganize': '刮削整理目录确认',
  'scrape.reviewResult': '刮削结果复核',
};

const RESUME_POINT_APPROVAL_LABELS: Record<string, string> = {
  delete_executing: '删除前确认',
  transcode_executing: '杜比视界转码确认',
  transcode_replace: '转码替换确认',
  upgrade_executing: '洗版候选选择',
  upgrade_replace: '洗版替换确认',
};

const CONTROL_STATE_LABELS: Record<string, string> = {
  ready_to_start: '可启动',
  queued: '排队中',
  running: '执行中',
  pausing: '暂停中',
  paused: '已暂停',
  interrupted: '可恢复',
  awaiting_confirmation: '等待确认',
  terminal: '已结束',
  unknown: '未知',
};

const CONTROL_REASON_LABELS: Record<string, string> = {
  available: '可执行',
  already_active: '任务正在推进',
  already_paused: '任务已暂停',
  confirmation_required: '等待确认后才能继续',
  failed_task_retry_available: '可从失败点重试',
  retry_limit_reached: '已达到重试上限',
  unknown_resume_point: '恢复点不在当前 flow 合约内',
  unsupported_flow: '当前 flow 未定义恢复合约',
  terminal_task: '任务已结束',
  not_awaiting_confirmation: '当前不需要确认',
  retry_not_required: '当前不需要重试',
  not_failed_or_interrupted: '当前不需要恢复',
  status_not_cancellable: '当前状态不能取消',
  status_not_executable: '当前状态不能启动',
  status_not_pausable: '当前状态不能暂停',
};

const CONTROL_EFFECT_LABELS: Record<string, string> = {
  queue_for_scheduler_dispatch: '提交给调度器排队执行',
  resume_from_pause: '从暂停状态恢复执行',
  resume_after_interruption: '从中断点继续执行',
  clear_pause_request: '撤销暂停请求',
  request_runtime_pause_and_cleanup_partial_work: '请求运行中的 flow 暂停并清理临时产物',
  move_waiting_task_to_paused: '把等待中的任务移入暂停状态',
  store_confirmation_and_queue_task: '保存确认结果并回到队列',
  cancel_runtime_then_remove_task: '取消运行态并移除任务记录',
  remove_waiting_task: '移除等待中的任务',
  remove_task_history_record: '只移除任务中心里的历史记录',
  queue_failed_task_from_resume_point: '按恢复点重新排队同一个任务',
  queue_failed_task_from_flow_start: '从当前 flow 起点重新排队同一个任务',
  scheduler_or_executor_already_owns_task: '调度器或执行器已经接管任务',
  blocked_until_user_confirms: '用户确认前不会继续推进',
  cannot_execute_terminal_task: '终态任务不能再启动',
  cannot_pause_terminal_task: '终态任务不能暂停',
  retry_only_applies_to_interrupted_or_failed_tasks: '只有中断或失败任务需要重试',
  recovery_not_required: '当前不需要恢复',
  flow_has_no_recovery_contract: '该 flow 没有可执行恢复合约',
  resume_point_not_in_flow_recovery_contract: '当前恢复点不在 flow 恢复合约内',
  manual_recovery_retry_limit_reached: '已达到手动恢复重试上限',
};

const RECOVERY_STATE_LABELS: Record<string, string> = {
  retry_available: '可重试',
  resume_available: '可恢复',
  waiting_for_user_confirmation: '等待用户确认',
  flow_specific_recovery_required: '需要查看事件后处理',
  terminal: '已结束',
  not_needed: '无需恢复',
};

const INTENT_MODE_LABELS: Record<string, string> = {
  bridge_intent: '按桥梁意图创建',
  action_type_compatibility: '兼容旧操作创建',
  adult_rescrape: '成人条目重刮入口',
};

const TERMINAL_TASK_STATUSES = new Set(['done', 'failed_hard', 'cancelled', 'skipped', 'deleted']);
const ATTENTION_QUEUE_ORDER = ['needs_action', 'confirmation', 'recovery', 'manual_start'];
const ATTENTION_QUEUE_FALLBACKS: Record<string, { label: string; hint: string }> = {
  needs_action: {
    label: '需要处理',
    hint: '等待确认、可恢复、可重试和待手动启动',
  },
  confirmation: {
    label: '等待确认',
    hint: '需要用户确认后继续',
  },
  recovery: {
    label: '可恢复/重试',
    hint: '暂停、中断或失败后可继续处理',
  },
  manual_start: {
    label: '待手动启动',
    hint: '需要用户手动开始后进入调度队列',
  },
};

function reportButtonLabel(task: MediaTask) {
  if (task.actionType === 'scrape' && task.status === 'failed_hard') return '识别报告';
  return REPORT_LABELS[task.actionType] || '任务报告';
}

function reportModalTitle(report: TaskReport | null) {
  if (!report) return '任务报告';
  if (report.actionType === 'scrape') return '刮削识别报告';
  return REPORT_LABELS[report.actionType] || '任务报告';
}

function formatItemName(itemInfo?: TaskItemInfo): string {
  if (!itemInfo) return '';
  if (itemInfo.type === 'season' && itemInfo.seriesName && itemInfo.seasonNumber != null) {
    return `${itemInfo.seriesName} 第${itemInfo.seasonNumber}季`;
  }
  return itemInfo.name || itemInfo.title || '';
}

function approvalLabel(task: MediaTask): string {
  const gateId = task.controlState?.confirmation.gateId || task.approval?.gateId;
  if (gateId && APPROVAL_GATE_LABELS[gateId]) return APPROVAL_GATE_LABELS[gateId];
  const resumePoint = task.controlState?.confirmation.resumePoint || task.resumePoint;
  if (resumePoint && RESUME_POINT_APPROVAL_LABELS[resumePoint]) return RESUME_POINT_APPROVAL_LABELS[resumePoint];
  return task.approval?.title || '等待用户确认';
}

function approvalMatches(task: MediaTask, gateId: string, legacyResumePoint: string): boolean {
  return task.controlState?.confirmation.gateId === gateId
    || task.approval?.gateId === gateId
    || task.controlState?.confirmation.resumePoint === legacyResumePoint
    || task.resumePoint === legacyResumePoint;
}

function isAwaitingConfirmation(task: MediaTask): boolean {
  return !!(task.controlState?.confirmation.required || task.status === 'awaiting_user_confirm');
}

function hasSpecialApprovalCard(task: MediaTask): boolean {
  return approvalMatches(task, 'transcode.beforeReplace', 'transcode_replace')
    || approvalMatches(task, 'upgrade.candidateSelect', 'upgrade_executing')
    || approvalMatches(task, 'upgrade.beforeReplace', 'upgrade_replace');
}

function isTerminalTask(task: MediaTask): boolean {
  return TERMINAL_TASK_STATUSES.has(task.status);
}

function taskSourceLabel(task: MediaTask): string {
  if (task.source === 'manual' || task.itemInfo?.taskSource === 'manual') return '手动操作';
  if (task.source === 'auto' || task.itemInfo?.taskSource === 'auto') return '后台自动入队';
  return '历史记录';
}

function bridgeLabel(value?: string): string {
  if (!value) return '—';
  return BRIDGE_LABELS[value] || value;
}

function resourceLabel(value?: string | null): string {
  if (!value) return '—';
  return RESOURCE_LABELS[value] || value;
}

function eventTypeLabel(value?: string): string {
  if (!value) return '—';
  return EVENT_TYPE_LABELS[value] || value;
}

function formatEventTime(value?: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString();
}

export default function TaskMonitorPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [attentionPreset, setAttentionPreset] = useState('');
  const [bridgeFilter, setBridgeFilter] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedTask, setSelectedTask] = useState<MediaTask | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
  const [reportTask, setReportTask] = useState<string | null>(null);
  const [reportData, setReportData] = useState<TaskReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [scrapeFixTask, setScrapeFixTask] = useState<MediaTask | null>(null);
  const [scrapeFixAdultId, setScrapeFixAdultId] = useState('');

  const PAGE_SIZE = 20;

  const { data: taskData, isLoading, isFetching } = useQuery({
    queryKey: ['admin-tasks', statusFilter, attentionPreset, bridgeFilter, operationFilter, searchQuery, page],
    queryFn: () => tasks.list({
      ...(attentionPreset ? { attention: attentionPreset } : statusFilter ? { status: statusFilter } : {}),
      ...(bridgeFilter ? { bridgeKind: bridgeFilter } : {}),
      ...(operationFilter ? { operationKind: operationFilter } : {}),
      ...(searchQuery ? { q: searchQuery } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
  });

  // 全量摘要（不受筛选影响）
  const { data: fullTaskData } = useQuery({
    queryKey: ['admin-tasks-summary'],
    queryFn: () => tasks.list({ page: 1, pageSize: 1 }),
    refetchInterval: 5000,
  });

  const { data: sysCfg } = useQuery({
    queryKey: ['system-config-task-monitor'],
    queryFn: systemConfig.get,
    refetchInterval: 30000,
  });

  const { data: detailData } = useQuery({
    queryKey: ['admin-task-detail', selectedTask?.id],
    queryFn: () => selectedTask ? tasks.get(selectedTask.id) : null,
    enabled: detailOpen && !!selectedTask,
    refetchInterval: detailOpen ? 2000 : false,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-tasks'] });
    qc.invalidateQueries({ queryKey: ['admin-task-detail'] });
  }

  const deleteMut = useMutation({
    mutationFn: (params: { id: string; terminal: boolean }) => tasks.remove(params.id),
    onSuccess: (_data, params) => {
      invalidate();
      setAlert({ type: 'success', msg: params.terminal ? '任务记录已移除' : '任务已取消' });
      setDetailOpen(false);
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const pauseMut = useMutation({
    mutationFn: tasks.pause,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '任务已暂停' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const executeMut = useMutation({
    mutationFn: tasks.execute,
    onSuccess: (data) => { invalidate(); setAlert({ type: 'success', msg: `任务状态：${STATUS_LABELS[data.status] || data.status}` }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const retryMut = useMutation({
    mutationFn: tasks.retry,
    onSuccess: (data) => { invalidate(); setAlert({ type: 'success', msg: `任务状态：${STATUS_LABELS[data.status] || data.status}` }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const confirmMut = useMutation({
    mutationFn: (params: { id: string; confirmData?: Record<string, unknown> }) =>
      tasks.confirm(params.id, params.confirmData),
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '已确认，任务继续执行' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const rescrapeMut = useMutation({
    mutationFn: (params: { itemId: string; adultId: string }) =>
      adult.rescrapeItem(params.itemId, params.adultId),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['admin-tasks-summary'] });
      setAlert({ type: 'success', msg: '已按修正番号重新创建刮削任务' });
      setScrapeFixTask(null);
      setScrapeFixAdultId('');
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const taskList: MediaTask[] = taskData?.tasks || [];
  const displayTask = detailData || selectedTask;
  const attentionQueues = ATTENTION_QUEUE_ORDER.map((key) => ({
    key,
    ...ATTENTION_QUEUE_FALLBACKS[key],
    ...(fullTaskData?.summary?.attention?.[key] || {}),
    count: Number(fullTaskData?.summary?.attention?.[key]?.count || 0),
  }));

  function emptyTaskText(): string {
    if (attentionPreset) {
      const preset = attentionQueues.find((queue) => queue.key === attentionPreset)
        || { label: attentionPreset, hint: '符合后端处理队列定义' };
      return `当前没有「${preset.label}」任务。${preset.hint} 的任务会出现在这里。`;
    }
    if (!bridgeFilter && !operationFilter) return '当前没有符合筛选条件的任务桥。';
    const bridge = bridgeFilter ? (BRIDGE_LABELS[bridgeFilter] || bridgeFilter) : '';
    const operation = operationFilter ? (OPERATION_LABELS[operationFilter] || operationFilter) : '';
    const label = [bridge, operation].filter(Boolean).join(' / ');
    const enabledActions = sysCfg?.smartTaskEnabledActions || [];
    if (operationFilter && !enabledActions.includes(operationFilter)) {
      if (operationFilter === 'scrape') {
        return `当前没有${label}桥梁。「任务调度 > 后台自动入队」未允许后台自动创建${operation}操作；具体影片仍可手动重新刮削。`;
      }
      if (operationFilter === 'ingest') {
        return `当前没有${label}桥梁。「任务调度 > 后台自动入队」未允许后台自动创建${operation}操作，后台来源不会自动进入任务中心。`;
      }
      return `当前没有${label}桥梁。「任务调度 > 后台自动入队」未允许后台自动创建${operation}操作，媒体库里的对应建议不会自动进入任务中心。`;
    }
    if (operationFilter === 'scrape') {
      return `当前没有${label}桥梁。可能没有待刮削条目，或已被冷却时间、去重规则、队列上限拦截。`;
    }
    if (operationFilter === 'ingest') {
      return `当前没有${label}桥梁。可能没有新文件，或已被冷却时间、去重规则、队列上限拦截。`;
    }
    return `当前没有${label}桥梁。若媒体库仍有对应推荐，可能被冷却时间、去重规则、队列上限或已完成闭环状态拦截。`;
  }

  function openDetail(task: MediaTask) {
    setSelectedTask(task);
    setSelectedCandidateIndex(0);
    setDetailOpen(true);
  }

  function formatPriorityDimension(dim: { key: string; label?: string; value: number; [key: string]: unknown }) {
    const label = dim.label || dim.key;
    const value = Number(dim.value) || 0;
    const signed = value > 0 ? `+${value}` : `${value}`;
    if (dim.key === 'actionType') return `${label}（${OPERATION_LABELS[String(dim.actionType || '')] || dim.actionType || '未知'}） ${signed}`;
    if (dim.key === 'retry') return `${label}（${dim.retryCount || 0} 次） ${signed}`;
    return `${label} ${signed}`;
  }

  function openScrapeFix(task: MediaTask) {
    const adultId = typeof task.itemInfo?.adultMetadata?.adultId === 'string'
      ? task.itemInfo.adultMetadata.adultId
      : '';
    setScrapeFixTask(task);
    setScrapeFixAdultId(adultId);
  }

  function removeTask(task: MediaTask) {
    const terminal = isTerminalTask(task);
    const message = terminal
      ? '只会从任务中心移除这条历史记录，不会删除媒体文件。确认移除？'
      : '将取消这个未完成任务，不会删除媒体文件。确认取消？';
    if (confirm(message)) deleteMut.mutate({ id: task.id, terminal });
  }

  function formatSize(bytes: number): string {
    if (!bytes || bytes === 0) return '—';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  function controlStateLabel(value?: string): string {
    if (!value) return '—';
    return CONTROL_STATE_LABELS[value] || value;
  }

  function reasonLabel(value?: string): string {
    if (!value) return '—';
    return CONTROL_REASON_LABELS[value] || value;
  }

  function effectLabel(value?: string): string {
    if (!value) return '—';
    return CONTROL_EFFECT_LABELS[value] || value;
  }

  function recoveryStateLabel(value?: string): string {
    if (!value) return '—';
    return RECOVERY_STATE_LABELS[value] || value;
  }

  function operationLabel(value?: string): string {
    if (!value) return '—';
    return OPERATION_LABELS[value] || value;
  }

  function intentModeLabel(value?: string): string {
    if (!value) return '历史任务';
    return INTENT_MODE_LABELS[value] || value;
  }

  function actionPending(key: string): boolean {
    if (key === 'execute') return executeMut.isPending;
    if (key === 'pause') return pauseMut.isPending;
    if (key === 'retry') return retryMut.isPending;
    if (key === 'confirm') return confirmMut.isPending;
    if (key === 'cancel') return deleteMut.isPending;
    return false;
  }

  function hasSpecialConfirmation(task: MediaTask): boolean {
    return isAwaitingConfirmation(task) && hasSpecialApprovalCard(task);
  }

  function performControlAction(task: MediaTask, key: 'execute' | 'pause' | 'retry' | 'confirm' | 'cancel') {
    if (key === 'execute') executeMut.mutate(task.id);
    if (key === 'pause') pauseMut.mutate(task.id);
    if (key === 'retry') retryMut.mutate(task.id);
    if (key === 'confirm') {
      if (hasSpecialConfirmation(task)) {
        openDetail(task);
        return;
      }
      if (confirm(`确认：${approvalLabel(task)}？`)) confirmMut.mutate({ id: task.id });
    }
    if (key === 'cancel') removeTask(task);
  }

  function actionButtonStyle(action: TaskControlAction, key: string): React.CSSProperties {
    if (key === 'cancel') {
      return action.destructive ? { ...dangerInlineBtn } : deleteBtn;
    }
    if (key === 'pause') return warnBtn;
    if (key === 'confirm' || key === 'execute' || key === 'retry') return execBtn;
    return actionBtn;
  }

  function renderControlButton(task: MediaTask, key: 'execute' | 'pause' | 'retry' | 'confirm' | 'cancel', action: TaskControlAction) {
    if (!action.enabled) return null;
    if (key === 'confirm' && hasSpecialConfirmation(task)) {
      const label = approvalMatches(task, 'upgrade.candidateSelect', 'upgrade_executing')
        ? '选择版本'
        : '查看确认';
      return (
        <button
          key={key}
          onClick={() => openDetail(task)}
          style={execBtn}
          title={effectLabel(action.effect)}
        >
          {label}
        </button>
      );
    }
    const pending = actionPending(key);
    return (
      <button
        key={key}
        onClick={() => performControlAction(task, key)}
        disabled={pending}
        style={{ ...actionButtonStyle(action, key), opacity: pending ? 0.6 : 1, cursor: pending ? 'not-allowed' : 'pointer' }}
        title={effectLabel(action.effect)}
      >
        {pending ? '提交中...' : action.label || key}
      </button>
    );
  }

  function renderControlActions(task: MediaTask, opts: { includeCancel?: boolean; detail?: boolean } = {}) {
    const control = task.controlState;
    if (!control) return null;
    const order: Array<'confirm' | 'execute' | 'retry' | 'pause' | 'cancel'> = ['confirm', 'execute', 'retry', 'pause'];
    if (opts.includeCancel) order.push('cancel');
    return order
      .map((key) => renderControlButton(task, key, control.actions[key]))
      .filter(Boolean);
  }

  function controlHint(task: MediaTask): string {
    const control = task.controlState;
    if (!control) return '';
    const primary = control.primaryAction ? control.actions[control.primaryAction as keyof TaskControlState['actions']] : null;
    if (primary && primary.enabled) return effectLabel(primary.effect);
    if (control.recovery?.state && control.recovery.state !== 'not_needed') {
      return `${recoveryStateLabel(control.recovery.state)}：${reasonLabel(control.recovery.reason)}`;
    }
    if (control.confirmation?.required) return control.confirmation.message || '等待用户确认后继续。';
    return controlStateLabel(control.state);
  }

  function reportButton(task: MediaTask) {
    return (
      <button key="report" onClick={() => {
        setReportTask(task.id);
        setReportLoading(true);
        import('../api/client').then(({ tasks: tk }) => {
          tk.report(task.id).then(data => { setReportData(data); setReportLoading(false); });
        });
      }} style={execBtn}>{reportButtonLabel(task)}</button>
    );
  }

  function renderActions(t: MediaTask) {
    const btns: React.ReactNode[] = [];
    btns.push(...(renderControlActions(t, { includeCancel: true }) || []));
    if (t.status === 'done') {
      btns.push(reportButton(t));
      if (t.actionType === 'scrape') {
        btns.push(<button key="fix-scrape-done" onClick={() => openScrapeFix(t)} style={execBtn}>修正番号</button>);
      }
    }
    if (t.status === 'failed_hard' && t.actionType === 'scrape') {
      btns.push(reportButton(t));
      btns.push(<button key="fix-scrape" onClick={() => openScrapeFix(t)} style={execBtn}>修正番号</button>);
    }
    return btns;
  }

  function renderControlStateCard(task: MediaTask) {
    const control = task.controlState;
    if (!control) return null;
    const actions = Object.entries(control.actions) as Array<[keyof TaskControlState['actions'], TaskControlAction]>;
    const latest = control.latestEvent;
    return (
      <div style={{ background: '#f8fafc', border: '1px solid #dbe7f3', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#16324f', marginBottom: 4 }}>控制状态</div>
            <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
              {controlStateLabel(control.state)}
              {control.resumePoint ? ` · 恢复点 ${control.resumePoint}` : ''}
              {control.retryCount ? ` · 已重试 ${control.retryCount} 次` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {renderControlActions(task, { includeCancel: false, detail: true })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div style={controlMiniPanel}>
            <div style={controlMiniLabel}>恢复建议</div>
            <div style={controlMiniValue}>{recoveryStateLabel(control.recovery.state)}</div>
            <div style={controlMiniText}>
              {reasonLabel(control.recovery.reason)}
              {control.recovery.resumePoint ? `；从 ${control.recovery.resumePoint} 继续` : ''}
            </div>
          </div>
          <div style={controlMiniPanel}>
            <div style={controlMiniLabel}>确认点</div>
            <div style={controlMiniValue}>{control.confirmation.required ? (APPROVAL_GATE_LABELS[control.confirmation.gateId] || approvalLabel(task)) : '无需确认'}</div>
            <div style={controlMiniText}>{control.confirmation.message || effectLabel(control.confirmation.effect)}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
          {actions.map(([key, action]) => (
            <div key={key} style={{ background: '#fff', border: '1px solid #e5edf5', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{action.label || key}</span>
                <span style={{ fontSize: 12, color: action.enabled ? '#167a3f' : '#8a5b1f', fontWeight: 700 }}>
                  {action.enabled ? '可用' : reasonLabel(action.reason)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{effectLabel(action.effect)}</div>
            </div>
          ))}
        </div>

        {latest && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
            最近事件：{eventTypeLabel(latest.eventType)} · {latest.createdAt ? new Date(latest.createdAt).toLocaleString() : '—'}
          </div>
        )}
      </div>
    );
  }

  function renderConfirmationConsole(task: MediaTask) {
    const confirmation = task.controlState?.confirmation;
    if (!confirmation?.required) return null;
    const special = hasSpecialApprovalCard(task);
    const options = Array.isArray(confirmation.options) ? confirmation.options : [];
    return (
      <div style={{ background: '#fff7ed', borderRadius: 8, padding: 12, marginBottom: 16, border: '1px solid #fed7aa' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9a3412', marginBottom: 4 }}>
              确认台 · {approvalLabel(task)}
              {task.approval?.mode === 'forceConfirm' ? '（强制确认）' : ''}
            </div>
            <div style={{ fontSize: 12, color: '#7c2d12', lineHeight: 1.6 }}>
              {confirmation.message || task.approval?.message || '任务正在等待用户确认后继续。'}
            </div>
          </div>
          {!special && (
            <button
              onClick={() => { if (confirm(`确认：${approvalLabel(task)}？`)) confirmMut.mutate({ id: task.id }); }}
              disabled={confirmMut.isPending}
              style={{ ...execBtn, marginRight: 0 }}
            >
              {confirmMut.isPending ? '确认中...' : (task.controlState?.actions.confirm.label || '确认并继续')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {confirmation.gateId && <span style={confirmChip}>Gate: {APPROVAL_GATE_LABELS[confirmation.gateId] || confirmation.gateId}</span>}
          {confirmation.resumePoint && <span style={confirmChip}>恢复点: {confirmation.resumePoint}</span>}
          <span style={confirmChip}>{effectLabel(confirmation.effect)}</span>
          {special && <span style={confirmChip}>在下方确认卡里完成选择或对比</span>}
        </div>
        {options.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#7c2d12' }}>
            选项：{options.map((option) => {
              if (typeof option === 'string') return option;
              if (option && typeof option === 'object' && 'label' in option) return String((option as { label?: unknown }).label || '');
              return JSON.stringify(option);
            }).filter(Boolean).join('、')}
          </div>
        )}
      </div>
    );
  }

  function renderIntentCard(task: MediaTask) {
    const intent = task.requestedIntent;
    const bridgeKind = intent?.bridgeKind || task.taskBridge?.kind || task.flowPlan?.bridgeKind || '';
    const preferredOperation = intent?.preferredOperation || '';
    const legacyAction = intent?.actionType || '';
    const resolvedOperation = task.flowPlan?.operationKind || task.actionType;
    const intentMode = intent?.intentMode || (intent ? 'bridge_intent' : '');
    if (!intent && !task.taskBridge && !task.flowPlan) return null;

    return (
      <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>用户意图与解析结果</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={intentPanel}>
            <div style={controlMiniLabel}>用户提交</div>
            <div style={intentRow}><strong>创建方式</strong><span>{intentModeLabel(intentMode)}</span></div>
            <div style={intentRow}><strong>目标桥梁</strong><span>{bridgeLabel(bridgeKind)}</span></div>
            <div style={intentRow}><strong>偏好操作</strong><span>{preferredOperation ? operationLabel(preferredOperation) : legacyAction ? operationLabel(legacyAction) : '按当前推荐'}</span></div>
          </div>
          <div style={intentPanel}>
            <div style={controlMiniLabel}>后端解析</div>
            <div style={intentRow}><strong>实际桥梁</strong><span>{bridgeLabel(task.taskBridge?.kind || task.flowPlan?.bridgeKind)}</span></div>
            <div style={intentRow}><strong>实际操作</strong><span>{operationLabel(resolvedOperation)}</span></div>
            <div style={intentRow}><strong>Flow direction</strong><span>{task.flowPlan?.direction || '—'}</span></div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
          任务执行、确认和恢复都以右侧解析结果为准；左侧保留用户最初想推进的业务桥。
        </div>
      </div>
    );
  }

  function renderCompareTable(orig: TaskItemInfo, result: VerifyResult) {
    const origGb = (orig.originalSizeBytes || 0) / (1024 * 1024 * 1024);
    const newGb = result.sizeBytes / (1024 * 1024 * 1024);
    const sizeDelta = origGb > 0 ? ((newGb - origGb) / origGb * 100) : 0;
    const bitrateDelta = (orig.originalBitrate || 0) > 0
      ? ((result.bitrate - (orig.originalBitrate || 0)) / (orig.originalBitrate || 1) * 100) : 0;

    const rows = [
      ['文件大小', `${origGb.toFixed(2)} GB`, `${newGb.toFixed(2)} GB`, `${sizeDelta >= 0 ? '+' : ''}${sizeDelta.toFixed(1)}%`],
      ['视频编码', orig.originalVideoCodec || '—', result.videoCodec || '—', ''],
      ['分辨率', `${orig.originalWidth || '?'} × ${orig.originalHeight || '?'}`, `${result.width} × ${result.height}`, ''],
      ['视频码率', orig.originalBitrate ? `${orig.originalBitrate} kbps` : '—', `${result.bitrate} kbps`, `${bitrateDelta >= 0 ? '+' : ''}${bitrateDelta.toFixed(1)}%`],
      ['音频编码', orig.originalAudioCodec || '—', result.audioCodec || '—', ''],
      ['预估节省', '', `${origGb > newGb ? (origGb - newGb).toFixed(2) + ' GB' : '—'}`, ''],
    ];

    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#eef2f7' }}>
            <th style={compareTh}>指标</th>
            <th style={compareTh}>原文件</th>
            <th style={compareTh}>新文件</th>
            <th style={compareTh}>变化</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
              {r.map((cell, j) => (
                <td key={j} style={{ ...compareTd, fontWeight: j === 0 ? 600 : 400, color: j === 3 && cell ? (cell.startsWith('+') || cell.startsWith('0') ? '#e67e22' : '#27ae60') : '#333' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderUpgradeCompareTable(task: MediaTask) {
    const oldInfo = task.upgradePreview?.oldFile;
    const vr = task.verifyResult!;
    const itemInfo = task.itemInfo;

    const oldSizeGb = (oldInfo?.size || itemInfo?.originalSizeBytes || 0) / (1024 * 1024 * 1024);
    const newSizeGb = vr.sizeBytes / (1024 * 1024 * 1024);
    const sizeDelta = oldSizeGb > 0 ? ((newSizeGb - oldSizeGb) / oldSizeGb * 100) : 0;

    const oldBitrate = oldInfo?.bitrate || itemInfo?.originalBitrate || 0;
    const bitrateDelta = oldBitrate > 0 ? ((vr.bitrate - oldBitrate) / oldBitrate * 100) : 0;

    const rows = [
      ['文件大小', oldSizeGb > 0 ? `${oldSizeGb.toFixed(2)} GB` : '—', `${newSizeGb.toFixed(2)} GB`, `${sizeDelta >= 0 ? '+' : ''}${sizeDelta.toFixed(1)}%`],
      ['视频编码', itemInfo?.originalVideoCodec || oldInfo?.resolution || '—', vr.videoCodec || '—', ''],
      ['分辨率', `${itemInfo?.originalWidth || '?'} × ${itemInfo?.originalHeight || '?'}`, `${vr.width} × ${vr.height}`, ''],
      ['视频码率', oldBitrate > 0 ? `${oldBitrate} kbps` : '—', `${vr.bitrate} kbps`, `${bitrateDelta >= 0 ? '+' : ''}${bitrateDelta.toFixed(1)}%`],
      ['TMDB 校验', '—', task.upgradePreview?.tmdbVerified ? '✓ 通过' : '⚠ 未校验', ''],
    ];

    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#eef2f7' }}>
            <th style={compareTh}>指标</th>
            <th style={compareTh}>原文件</th>
            <th style={compareTh}>新文件</th>
            <th style={compareTh}>变化</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
              {r.map((cell, j) => (
                <td key={j} style={{ ...compareTd, fontWeight: j === 0 ? 600 : 400, color: j === 3 && cell ? (cell.startsWith('+') || cell.startsWith('0') ? '#e67e22' : '#27ae60') : '#333' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>任务中心</h2>
        <button onClick={() => invalidate()} style={refreshBtn}>
          {isFetching ? '刷新中...' : '刷新'}
        </button>
      </div>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      {/* Summary — always from full dataset */}
      {fullTaskData?.summary && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ ...summaryBadge, background: '#f0f2f5' }}>总计: {fullTaskData.summary.total}</span>
          {Object.entries(fullTaskData.summary.byStatus || {}).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { setStatusFilter(k); setAttentionPreset(''); setPage(1); }}
              style={{
                ...summaryBadge,
                background: (STATUS_COLORS[k] || '#999') + '20',
                color: STATUS_COLORS[k],
                border: statusFilter === k ? `2px solid ${STATUS_COLORS[k] || '#999'}` : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {STATUS_LABELS[k] || k}: {v}
            </button>
          ))}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #eef0f4', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>处理队列</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>把需要人工推进的任务先捞出来</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {attentionQueues.map((queue) => {
              const active = attentionPreset === queue.key;
              return (
                <button
                  key={queue.key}
                  type="button"
                  onClick={() => {
                    setAttentionPreset(active ? '' : queue.key);
                    setStatusFilter('');
                    setPage(1);
                  }}
                  title={queue.hint}
                  style={{
                    ...attentionBtn,
                    background: active ? '#1a1a2e' : '#fff',
                    color: active ? '#fff' : '#1a1a2e',
                    borderColor: active ? '#1a1a2e' : '#d7dbe3',
                  }}
                >
                  {queue.label}
                  <span style={{ fontVariantNumeric: 'tabular-nums', opacity: active ? 0.9 : 0.65 }}> {queue.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          placeholder="搜索影片名称..."
          style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, width: 220 }}
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setAttentionPreset(''); setPage(1); }} style={selectStyle}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={bridgeFilter} onChange={(e) => { setBridgeFilter(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">全部桥梁</option>
          <option value="metadata">补元数据</option>
          <option value="optimize">优化</option>
          <option value="archive">归档</option>
        </select>
        <select value={operationFilter} onChange={(e) => { setOperationFilter(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">全部 flow 操作</option>
          <option value="ingest">入库</option>
          <option value="scrape">刮削</option>
          <option value="transcode">转码压缩</option>
          <option value="upgrade">洗版</option>
          <option value="delete">删除</option>
        </select>
      </div>

      {/* Task Table */}
      {isLoading ? (
        <LoadingSpinner />
      ) : taskList.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 10, padding: 40, textAlign: 'center', color: '#888' }}>
          {emptyTaskText()}
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>影片</th>
                <th style={thStyle}>桥梁</th>
                <th style={thStyle}>Flow 操作</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>阶段</th>
                <th style={thStyle}>来源/审批/优先级</th>
                <th style={thStyle}>进度</th>
                <th style={thStyle}>创建时间</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {taskList.map((t) => (
                <tr key={t.id}>
                  <td style={tdStyle}>
                    <span>{formatItemName(t.itemInfo) || t.itemName || t.itemId}</span>
                  </td>
                  <td style={tdStyle}>{bridgeLabel(t.taskBridge?.kind || t.flowPlan?.bridgeKind)}</td>
                  <td style={tdStyle}>{OPERATION_LABELS[t.flowPlan?.operationKind || t.actionType] || t.flowPlan?.operationKind || t.actionType}</td>
                  <td style={tdStyle}>
                    <span style={{ color: STATUS_COLORS[t.status] || '#999' }}>{STATUS_LABELS[t.status] || t.status}</span>
                  </td>
                  <td style={tdStyle}>{PHASE_LABELS[t.phase || ''] || t.phase || '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ color: t.source || t.itemInfo?.taskSource ? '#555' : '#999' }}>
                        {taskSourceLabel(t)}
                      </span>
                      <span style={{ color: t.controlState?.requiresUserAction ? '#e67e22' : '#64748b' }}>
                        {controlHint(t) || '—'}
                      </span>
                      <span style={{ fontSize: 11, color: '#999' }}>P{typeof t.priority === 'number' ? t.priority : 100}</span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 4, background: '#eee', borderRadius: 2, maxWidth: 80 }}>
                        <div style={{ width: `${Math.round(t.progress || 0)}%`, height: '100%', background: '#27ae60', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 12, color: '#888' }}>{Math.round(t.progress || 0)}%</span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, color: '#888' }}>
                      {t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {renderActions(t)}
                    <button onClick={() => openDetail(t)} style={actionBtn}>详情</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {taskData && (taskData.total || taskData.summary?.total || 0) > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 16 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...paginationBtn, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'default' : 'pointer' }}
          >
            上一页
          </button>
          <span style={{ fontSize: 12, color: '#666' }}>
            第 {page} 页 / 共 {Math.ceil((taskData.total || taskData.summary?.total || 0) / PAGE_SIZE)} 页（{taskData.total || taskData.summary?.total || 0} 条）
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil((taskData.total || taskData.summary?.total || 0) / PAGE_SIZE)}
            style={{ ...paginationBtn, opacity: page >= Math.ceil((taskData.total || taskData.summary?.total || 0) / PAGE_SIZE) ? 0.4 : 1, cursor: page >= Math.ceil((taskData.total || taskData.summary?.total || 0) / PAGE_SIZE) ? 'default' : 'pointer' }}
          >
            下一页
          </button>
        </div>
      )}

      {/* Task Detail Modal */}
      <Modal open={detailOpen} title="任务桥详情" onClose={() => { setDetailOpen(false); setSelectedTask(null); }} width={680}>
        {displayTask ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 12, marginBottom: 20 }}>
              <div><strong>任务 ID:</strong> {displayTask.id}</div>
              <div><strong>媒体项:</strong> {formatItemName(displayTask.itemInfo) || displayTask.itemId}</div>
              <div><strong>桥梁:</strong> {bridgeLabel(displayTask.taskBridge?.kind || displayTask.flowPlan?.bridgeKind)}</div>
              <div><strong>Flow 操作:</strong> {OPERATION_LABELS[displayTask.flowPlan?.operationKind || displayTask.actionType] || displayTask.flowPlan?.operationKind || displayTask.actionType}</div>
              <div><strong>状态:</strong> <span style={{ color: STATUS_COLORS[displayTask.status] }}>{STATUS_LABELS[displayTask.status] || displayTask.status}</span></div>
              <div><strong>阶段:</strong> {PHASE_LABELS[displayTask.phase || ''] || displayTask.phase || '—'}</div>
              <div><strong>进度:</strong> {Math.round(displayTask.progress || 0)}%</div>
              <div><strong>来源:</strong> {taskSourceLabel(displayTask)}</div>
              <div><strong>优先级:</strong> {typeof displayTask.priority === 'number' ? displayTask.priority : 100}</div>
              <div><strong>审批节点:</strong> {isAwaitingConfirmation(displayTask) ? approvalLabel(displayTask) : '—'}</div>
              <div><strong>创建时间:</strong> {displayTask.createdAt ? new Date(displayTask.createdAt).toLocaleString() : '—'}</div>
              <div><strong>更新时间:</strong> {displayTask.updatedAt ? new Date(displayTask.updatedAt).toLocaleString() : '—'}</div>
            </div>

            {renderControlStateCard(displayTask)}

            {renderIntentCard(displayTask)}

            {(displayTask.taskBridge || displayTask.flowPlan) && (
              <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>Flow 编排</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px', fontSize: 12, color: '#374151', marginBottom: 10 }}>
                  <div><strong>跨阶段桥梁:</strong> {bridgeLabel(displayTask.taskBridge?.kind || displayTask.flowPlan?.bridgeKind)}</div>
                  <div><strong>Flow direction:</strong> {displayTask.flowPlan?.direction || '—'}</div>
                  <div><strong>操作类型:</strong> {OPERATION_LABELS[displayTask.flowPlan?.operationKind || displayTask.actionType] || displayTask.flowPlan?.operationKind || displayTask.actionType}</div>
                  <div><strong>执行器:</strong> {displayTask.flowPlan?.executor || '—'}</div>
                  <div><strong>主要资源:</strong> {resourceLabel(displayTask.flowPlan?.primaryResourceType)}</div>
                  <div><strong>资源集合:</strong> {displayTask.flowPlan?.resourceTypes?.map(resourceLabel).join(', ') || '—'}</div>
                </div>
                {(displayTask.flowPlan?.steps?.length || 0) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {displayTask.flowPlan!.steps!.map((step, idx) => (
                      <span key={`${step.phase || step.eventType || 'step'}-${idx}`} style={{ fontSize: 12, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px' }}>
                        {PHASE_LABELS[step.phase || ''] || step.phase || step.eventType || `step-${idx + 1}`} · {resourceLabel(step.resourceType)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(displayTask.events?.length || 0) > 0 && (
              <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>Event 历史</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={eventTh}>时间</th>
                      <th style={eventTh}>事件</th>
                      <th style={eventTh}>状态</th>
                      <th style={eventTh}>资源</th>
                      <th style={eventTh}>阶段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayTask.events!.slice(-8).map((event) => (
                      <tr key={event.id}>
                        <td style={eventTd}>{formatEventTime(event.createdAt)}</td>
                        <td style={eventTd}>{eventTypeLabel(event.eventType)}</td>
                        <td style={eventTd}>{STATUS_LABELS[event.eventStatus] || event.eventStatus || '—'}</td>
                        <td style={eventTd}>{resourceLabel(event.resourceType)}</td>
                        <td style={eventTd}>{PHASE_LABELS[event.phase || ''] || event.phase || event.resumePoint || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {displayTask.priorityBreakdown?.dimensions?.length ? (
              <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>优先级构成</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {displayTask.priorityBreakdown.dimensions.map((dim, idx) => (
                    <span key={`${dim.key}-${idx}`} style={{ fontSize: 12, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px' }}>
                      {formatPriorityDimension(dim)}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  最终优先级 {displayTask.priorityBreakdown.priority ?? displayTask.priority ?? 100}；数值越小越先执行。
                </div>
              </div>
            ) : null}

            {renderConfirmationConsole(displayTask)}

            {/* Scrape completion/failure remediation card */}
            {(displayTask.status === 'failed_hard' || displayTask.status === 'done') && displayTask.actionType === 'scrape' && (
              <div style={{ background: displayTask.status === 'done' ? '#f0fdf4' : '#fff7ed', borderRadius: 8, padding: 12, marginBottom: 16, border: displayTask.status === 'done' ? '1px solid #bbf7d0' : '1px solid #fed7aa' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: displayTask.status === 'done' ? '#166534' : '#9a3412', marginBottom: 4 }}>
                  {displayTask.status === 'done' ? '刮削已完成' : '刮削失败'}
                </div>
                <div style={{ fontSize: 12, color: displayTask.status === 'done' ? '#166534' : '#7c2d12', lineHeight: 1.6 }}>
                  {displayTask.status === 'done'
                    ? '如果刮削结果张冠李戴，可以修正番号后重新刮削。'
                    : '如果日志提示番号无法识别，可以修正番号后重新刮削。'}
                </div>
                <button onClick={() => openScrapeFix(displayTask)} style={{ ...execBtn, marginTop: 10 }}>修正番号</button>
              </div>
            )}

            {/* Replace confirm comparison card */}
            {isAwaitingConfirmation(displayTask) && approvalMatches(displayTask, 'transcode.beforeReplace', 'transcode_replace') && displayTask.verifyResult && displayTask.itemInfo && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#1a1a2e' }}>转码结果对比</h4>
                {renderCompareTable(displayTask.itemInfo, displayTask.verifyResult)}
                {displayTask.verifyResult.previewPath && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#555' }}>试看预览（30秒片段）</p>
                    <video controls width="480" style={{ borderRadius: 6, background: '#000', maxWidth: '100%' }}>
                      <source src={`/v1/tasks/${displayTask.id}/preview`} type="video/mp4" />
                    </video>
                  </div>
                )}
                <div style={{ marginTop: 14 }}>
                  <button onClick={() => confirmMut.mutate({ id: displayTask.id })} disabled={confirmMut.isPending} style={{
                    background: '#27ae60', color: '#fff', border: 'none', padding: '10px 28px',
                    borderRadius: 6, cursor: 'pointer', fontSize: 15, fontWeight: 600,
                  }}>
                    {confirmMut.isPending ? '确认中...' : '确认替换'}
                  </button>
                  <span style={{ marginLeft: 12, fontSize: 12, color: '#888' }}>确认后将用新文件替换原文件，操作不可撤销</span>
                </div>
              </div>
            )}

            {/* Upgrade candidate selection card */}
            {isAwaitingConfirmation(displayTask) && approvalMatches(displayTask, 'upgrade.candidateSelect', 'upgrade_executing') && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: '#1a1a2e' }}>选择洗版版本</h4>
                <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                  找到 {displayTask.itemInfo?.searchCandidatesSimplified?.length || 0} 个候选种子，请选择一个下载。
                </p>
                {(displayTask.itemInfo?.searchCandidatesSimplified?.length || 0) > 0 ? (
                  <>
                    <div style={{ maxHeight: 260, overflow: 'auto', marginBottom: 14 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#eef2f7', position: 'sticky', top: 0 }}>
                            <th style={{ ...candidateTh, width: 36 }}></th>
                            <th style={candidateTh}>标题</th>
                            <th style={candidateTh}>站点</th>
                            <th style={candidateTh}>大小</th>
                            <th style={candidateTh}>做种</th>
                            <th style={candidateTh}>分辨率</th>
                            <th style={candidateTh}>编码</th>
                            <th style={candidateTh}>版本</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(displayTask.itemInfo!.searchCandidatesSimplified as UpgradeCandidate[]).map((c) => (
                            <tr
                              key={c.index}
                              onClick={() => setSelectedCandidateIndex(c.index)}
                              style={{
                                cursor: 'pointer',
                                background: selectedCandidateIndex === c.index ? '#e8f4fd' : 'transparent',
                                borderBottom: '1px solid #eee',
                              }}
                            >
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                <input
                                  type="radio"
                                  name="candidate"
                                  checked={selectedCandidateIndex === c.index}
                                  onChange={() => setSelectedCandidateIndex(c.index)}
                                />
                              </td>
                              <td style={{ padding: '8px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }} title={c.title}>{c.title}</td>
                              <td style={{ padding: '8px 10px', fontSize: 12, color: '#888' }}>{c.site || '—'}</td>
                              <td style={{ padding: '8px 10px', fontSize: 12 }}>{formatSize(c.size)}</td>
                              <td style={{ padding: '8px 10px', fontSize: 12, color: c.seeders > 0 ? '#27ae60' : '#e74c3c' }}>{c.seeders}</td>
                              <td style={{ padding: '8px 10px', fontSize: 12 }}>{c.resolution || '—'}</td>
                              <td style={{ padding: '8px 10px', fontSize: 12 }}>{c.codec || '—'}</td>
                              <td style={{ padding: '8px 10px', fontSize: 12, color: '#888' }}>{c.edition || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      onClick={() => confirmMut.mutate({ id: displayTask.id, confirmData: { selectedIndex: selectedCandidateIndex } })}
                      disabled={confirmMut.isPending}
                      style={{
                        background: '#27ae60', color: '#fff', border: 'none', padding: '10px 28px',
                        borderRadius: 6, cursor: 'pointer', fontSize: 15, fontWeight: 600,
                      }}
                    >
                      {confirmMut.isPending ? '确认中...' : '确认下载选中版本'}
                    </button>
                    <span style={{ marginLeft: 12, fontSize: 12, color: '#888' }}>将选中种子提交到 MoviePilot 下载</span>
                  </>
                ) : (
                  <p style={{ color: '#888', fontSize: 12 }}>正在加载候选列表...</p>
                )}
              </div>
            )}

            {/* Upgrade replace confirm card */}
            {isAwaitingConfirmation(displayTask) && approvalMatches(displayTask, 'upgrade.beforeReplace', 'upgrade_replace') && displayTask.verifyResult && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#1a1a2e' }}>洗版结果对比</h4>
                {renderUpgradeCompareTable(displayTask)}
                {displayTask.verifyResult.previewPath && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#555' }}>试看预览（30秒片段）</p>
                    <video controls width="480" style={{ borderRadius: 6, background: '#000', maxWidth: '100%' }}>
                      <source src={`/v1/tasks/${displayTask.id}/preview`} type="video/mp4" />
                    </video>
                  </div>
                )}
                <div style={{ marginTop: 14 }}>
                  <button onClick={() => confirmMut.mutate({ id: displayTask.id })} disabled={confirmMut.isPending} style={{
                    background: '#27ae60', color: '#fff', border: 'none', padding: '10px 28px',
                    borderRadius: 6, cursor: 'pointer', fontSize: 15, fontWeight: 600,
                  }}>
                    {confirmMut.isPending ? '确认中...' : '确认替换'}
                  </button>
                  <span style={{ marginLeft: 12, fontSize: 12, color: '#888' }}>确认后将用新文件替换原文件，操作不可撤销</span>
                </div>
              </div>
            )}

            <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>执行日志</h4>
            <div style={{ background: '#1a1a2e', color: '#e0e0e0', borderRadius: 8, padding: 12, maxHeight: 200, overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.6 }}>
              {(displayTask.logs || []).length === 0 ? (
                <span style={{ color: '#888' }}>暂无日志</span>
              ) : (
                (displayTask.logs || []).map((entry, i) => (
                  <div key={i}>
                    <span style={{ color: '#888' }}>[{entry.ts ? new Date(entry.ts).toLocaleTimeString() : '—'}]</span>{' '}
                    <span style={{ color: entry.level === 'error' ? '#e74c3c' : entry.level === 'warn' ? '#f39c12' : '#e0e0e0' }}>
                      {entry.msg}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {renderControlActions(displayTask, { includeCancel: false, detail: true })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setDetailOpen(false); setSelectedTask(null); }} style={secondaryBtn}>关闭</button>
                {displayTask.controlState?.actions.cancel.enabled && (
                  <button
                    onClick={() => removeTask(displayTask)}
                    style={displayTask.controlState.actions.cancel.destructive ? dangerBtn : secondaryBtn}
                  >
                    {displayTask.controlState.actions.cancel.label || (isTerminalTask(displayTask) ? '移除记录' : '取消任务')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <LoadingSpinner />
        )}
      </Modal>

      {/* Completion Report Modal */}
      <Modal open={!!reportTask && !reportLoading} title={reportModalTitle(reportData)} onClose={() => { setReportTask(null); setReportData(null); }} width={640}>
        {reportLoading ? (
          <LoadingSpinner text="加载报告中..." />
        ) : reportData ? (
          <ReportContent report={reportData} />
        ) : null}
      </Modal>

      <Modal open={!!scrapeFixTask} title="修正番号" onClose={() => { setScrapeFixTask(null); setScrapeFixAdultId(''); }} width={420}>
        {scrapeFixTask && (
          <div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 12, lineHeight: 1.6 }}>
              {formatItemName(scrapeFixTask.itemInfo) || scrapeFixTask.itemName || scrapeFixTask.itemId}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#555', marginBottom: 16 }}>
              <span>番号</span>
              <input
                value={scrapeFixAdultId}
                onChange={(e) => setScrapeFixAdultId(e.target.value.toUpperCase())}
                placeholder="例如 SORA-107"
                autoFocus
                style={{ padding: '8px 10px', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 14 }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setScrapeFixTask(null); setScrapeFixAdultId(''); }} style={secondaryBtn}>取消</button>
              <button
                onClick={() => rescrapeMut.mutate({ itemId: scrapeFixTask.itemId, adultId: scrapeFixAdultId.trim() })}
                disabled={!scrapeFixAdultId.trim() || rescrapeMut.isPending}
                style={{ ...execBtn, opacity: !scrapeFixAdultId.trim() || rescrapeMut.isPending ? 0.6 : 1 }}
              >
                {rescrapeMut.isPending ? '提交中...' : '重新刮削'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ReportContent({ report }: { report: import('../api/client').TaskReport }) {
  const qc = useQueryClient();
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const createFromFaceMut = useMutation({
    mutationFn: (params: { clusterId: string; name: string }) =>
      adult.createPersonFromFace({ itemId: report.itemId || '', clusterId: params.clusterId, name: params.name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adult-people'] });
      alert('演员已创建。现在可以重新刮削这部影片。');
    },
    onError: (e: Error) => alert(e.message),
  });

  function fmtSize(bytes: number | undefined): string {
    if (!bytes || bytes === 0) return '—';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
  function fmtBitrate(kbps: number | undefined): string {
    if (!kbps || kbps === 0) return '—';
    return (kbps / 1000).toFixed(1) + ' Mbps';
  }
  function fmtDuration(sec: number | null): string {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  }
  function fmtBool(value: boolean | undefined): string {
    if (value === true) return '是';
    if (value === false) return '否';
    return '—';
  }
  function fmtPath(value: string | undefined): string {
    return value && value.trim() ? value : '—';
  }

  const isTranscode = report.actionType === 'transcode';
  const isDelete = report.actionType === 'delete';
  const isUpgrade = report.actionType === 'upgrade';
  const isScrape = report.actionType === 'scrape';
  const faceRows = [
    ...((report.scrape?.faceClusters || []) as Array<Record<string, unknown>>),
    ...((report.scrape?.unknownFaces || []) as Array<Record<string, unknown>>),
  ].filter((f) => String(f.status || '') !== 'named');
  const visibleFaceRows = faceRows.slice(0, 12);

  return (
    <div>
      <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>📊 {report.itemName}</p>
      <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
        {isTranscode ? '转码压缩' : isDelete ? '删除' : isScrape ? '刮削' : '洗版'}  ·  耗时 {fmtDuration(report.elapsedSec)}
        {report.encoder ? '  ·  ' + report.encoder : ''}
      </p>

      {(isTranscode || isUpgrade) && report.original && report.output && (
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                <th style={rptThStyle}></th>
                <th style={rptThStyle}>原始</th>
                <th style={rptThStyle}>{isTranscode ? '转码后' : '新版'}</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={tdStyle}>大小</td>
                <td style={rptTdStyle}>{fmtSize(report.original.sizeBytes)}</td>
                <td style={rptTdStyle}>{fmtSize(report.output.sizeBytes)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={rptTdStyle}>编码</td>
                <td style={rptTdStyle}>{report.original.videoCodec || '?'}</td>
                <td style={{ ...rptTdStyle, color: report.original.videoCodec !== report.output.videoCodec ? '#27ae60' : undefined }}>
                  {report.output.videoCodec || '?'}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={rptTdStyle}>码率</td>
                <td style={rptTdStyle}>{fmtBitrate(report.original.bitrate)}</td>
                <td style={{ ...rptTdStyle, color: (report.original.bitrate || 0) > (report.output.bitrate || 0) ? '#27ae60' : undefined }}>
                  {fmtBitrate(report.output.bitrate)}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={rptTdStyle}>分辨率</td>
                <td style={rptTdStyle}>{(report.original.width || '?') + ' × ' + (report.original.height || '?')}</td>
                <td style={rptTdStyle}>{(report.output.width || '?') + ' × ' + (report.output.height || '?')}</td>
              </tr>
            </tbody>
          </table>

          {typeof report.bytesSaved === 'number' && report.bytesSaved !== 0 && (
            <div style={{ background: report.bytesSaved > 0 ? '#e8f5e9' : '#fff3e0', borderRadius: 8, padding: '12px 16px', marginBottom: 8, fontSize: 12 }}>
              <strong>{report.bytesSaved > 0 ? '✅ 节省空间' : '📦 空间变化'}</strong>：{fmtSize(report.bytesSaved > 0 ? report.bytesSaved : -report.bytesSaved)}
              {report.bytesSaved > 0 ? '' : ' (增大了)'}
            </div>
          )}

          {report.original.audioCodec && (
            <div style={{ fontSize: 12, color: '#888' }}>
              原始音频：{report.original.audioCodec}
            </div>
          )}

          {isUpgrade && report.tmdbVerified !== undefined && (
            <div style={{ fontSize: 12, color: report.tmdbVerified ? '#27ae60' : '#e67e22', marginTop: 4 }}>
              {report.tmdbVerified ? '✅ TMDB 匹配已验证' : '⚠️ TMDB 匹配未确认'}
            </div>
          )}
        </div>
      )}

      {isDelete && (
        <div style={{ background: '#fef3e2', borderRadius: 8, padding: '12px 16px', fontSize: 12 }}>
          已完成媒体删除<br />
          {report.delete?.targetKind && (
            <>
              <strong>删除类型</strong>：{report.delete.targetKind === 'directory' ? '文件夹' : report.delete.targetKind === 'file' ? '文件' : 'Emby 媒体项'}<br />
            </>
          )}
          {report.delete?.targetPath && (
            <>
              <strong>删除目标</strong>：{report.delete.targetPath}<br />
            </>
          )}
          <strong>释放空间</strong>：{fmtSize(report.bytesFreed)}
        </div>
      )}

      {isScrape && report.scrape && (
        <div style={{ fontSize: 12 }}>
          <div style={{ background: '#f7f8fa', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
            <div><strong>番号</strong>：{report.scrape.adultId || '—'}</div>
            <div><strong>标题</strong>：{report.scrape.title || '—'}</div>
            <div><strong>来源</strong>：{report.scrape.source || '—'}{report.scrape.sourceUrl ? ` · ${report.scrape.sourceUrl}` : ''}</div>
            <div><strong>演员</strong>：{report.scrape.actors?.join(', ') || '未识别'}</div>
            <div><strong>主角</strong>：{report.scrape.protagonist?.name || '未识别'}</div>
            <div><strong>状态</strong>：{report.scrape.scrapeStatus || '—'}</div>
            <div><strong>已归拢到 scraped/</strong>：{fmtBool(report.scrape.organized)}</div>
          </div>
          <div style={{ background: '#f7f8fa', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
            <ReportPathRow label="原目录" value={fmtPath(report.scrape.originalFolder)} />
            <ReportPathRow label="媒体文件" value={fmtPath(report.scrape.mediaPath)} />
            <ReportPathRow label="电影 NFO" value={fmtPath(report.scrape.nfoPath)} />
            <ReportPathRow label="文件同名 NFO" value={fmtPath(report.scrape.fileNfoPath)} />
            <ReportPathRow label="封面" value={fmtPath(report.scrape.posterPath)} />
            <ReportPathRow label="标记文件" value={fmtPath(report.scrape.markerPath)} />
          </div>
          {report.scrapeVerification && (
            <ScrapeVerificationSummary verification={report.scrapeVerification} />
          )}
          {report.currentScrapeVerification && (
            <ScrapeVerificationSummary verification={report.currentScrapeVerification} current />
          )}
          {visibleFaceRows.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>陌生脸</div>
              <div style={{ color: '#777', marginBottom: 8 }}>
                共 {faceRows.length} 张，当前显示前 {visibleFaceRows.length} 张。填写演员名后可以从对应人脸创建演员。
              </div>
              {visibleFaceRows.map((face, idx) => {
                const id = String(face.clusterId || face.faceId || `face-${idx}`);
                const img = String(face.sampleImageBase64 || '');
                return (
                  <div key={id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid #eee', padding: '8px 0' }}>
                    {img ? <img src={`data:image/jpeg;base64,${img}`} style={{ width: 58, height: 58, objectFit: 'cover', borderRadius: 6 }} /> : <div style={{ width: 58, height: 58, background: '#eee', borderRadius: 6 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#666' }}>
                        {id} · 出现 {String(face.frameCount || 1)} 帧 · 匹配分 {String(face.matchConfidence || face.confidence || 0)}
                      </div>
                      <input
                        value={actorNames[id] || ''}
                        onChange={(e) => setActorNames((prev) => ({ ...prev, [id]: e.target.value }))}
                        placeholder="填写演员名"
                        style={{ marginTop: 6, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, width: 180 }}
                      />
                    </div>
                    <button
                      style={{ ...execBtn, opacity: !actorNames[id] || createFromFaceMut.isPending ? 0.6 : 1 }}
                      disabled={!actorNames[id] || createFromFaceMut.isPending || !report.itemId}
                      onClick={() => createFromFaceMut.mutate({ clusterId: id, name: actorNames[id] })}
                    >
                      创建演员
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {report.elapsedSec == null && (
        <p style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>此任务在报告功能上线前完成，部分细节缺失。</p>
      )}
    </div>
  );
}

function ReportPathRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr', gap: 8, marginBottom: 4 }}>
      <strong>{label}</strong>
      <span style={{ wordBreak: 'break-all', color: value === '—' ? '#999' : '#333' }}>{value}</span>
    </div>
  );
}

function ScrapeVerificationSummary({ verification, current }: { verification: NonNullable<import('../api/client').TaskReport['scrapeVerification']>; current?: boolean }) {
  const checks = Object.entries(verification.checks || {});
  const failures = verification.failures || [];
  const warnings = verification.warnings || [];
  const isSnapshot = verification.source === 'completion_snapshot' && !current;
  const title = current || verification.source === 'current_filesystem' ? '当前文件复核' : '完成时验收';
  return (
    <div style={{ border: `1px solid ${verification.ok ? '#c8e6c9' : '#ffd6d6'}`, background: verification.ok ? '#f1f8f2' : '#fff5f5', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <strong>{title}</strong>
        <span style={{ color: verification.ok ? '#1f7a3a' : '#c0392b', fontWeight: 700 }}>
          {verification.ok ? '通过' : '未通过'}
        </span>
      </div>
      {isSnapshot && (
        <div style={{ color: '#4b5563', marginBottom: 8 }}>
          这是任务完成时保存的验收快照；后续删除媒体不会改变这条历史结果。
        </div>
      )}
      {checks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6, marginBottom: failures.length || warnings.length ? 10 : 0 }}>
          {checks.map(([code, passed]) => (
            <div key={code} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: '#fff', borderRadius: 6, padding: '6px 8px' }}>
              <span>{formatScrapeCheckLabel(code)}</span>
              <span style={{ color: passed ? '#1f7a3a' : '#c0392b', fontWeight: 700 }}>{passed ? '通过' : '失败'}</span>
            </div>
          ))}
        </div>
      )}
      {failures.length > 0 && (
        <ReportIssueList title="失败原因" issues={failures} color="#c0392b" />
      )}
      {warnings.length > 0 && (
        <ReportIssueList title="警告" issues={warnings} color="#b36b00" />
      )}
    </div>
  );
}

function ReportIssueList({ title, issues, color }: { title: string; issues: Array<{ code?: string; message?: string } | string>; color: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ color, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {issues.map((issue, idx) => {
        const text = typeof issue === 'string'
          ? issue
          : [issue.code, issue.message].filter(Boolean).join('：');
        return <div key={`${title}-${idx}`} style={{ color, wordBreak: 'break-word' }}>{text || '—'}</div>;
      })}
    </div>
  );
}

function formatScrapeCheckLabel(code: string): string {
  const labels: Record<string, string> = {
    'task.done': '任务已完成',
    'library.scraped': '媒体项已标记刮削',
    'metadata.scrapeStatus': '刮削状态',
    'metadata.adultId': '番号',
    'metadata.title': '标题',
    'media.exists': '媒体文件存在',
    'asset.movieNfo': '电影 NFO',
    'asset.fileNfo': '文件同名 NFO',
    'metadata.protagonist': '主角',
    'asset.poster': '封面',
    'marker.exists': '标记文件',
    'marker.itemId': '标记文件 itemId',
    'marker.subLibraryId': '标记文件子库',
    'marker.mediaPath': '标记文件媒体路径',
    'marker.scrapeTaskId': '标记文件任务',
    'marker.scrapedAt': '标记文件时间',
  };
  return labels[code] || code;
}

const rptThStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#888' };
const rptTdStyle: React.CSSProperties = { padding: '6px 8px', fontSize: 12 };

const summaryBadge: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 500,
};

const selectStyle: React.CSSProperties = {
  padding: '6px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12,
};

const refreshBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 16px',
  borderRadius: 6, cursor: 'pointer', fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '12px 16px', borderBottom: '2px solid #eee', color: '#666', fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid #f0f0f0',
};

const actionBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#1a1a2e', cursor: 'pointer', fontSize: 12, marginRight: 8,
};

const deleteBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 12,
};

const execBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#27ae60', cursor: 'pointer', fontSize: 12, marginRight: 8, fontWeight: 600,
};

const warnBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#f39c12', cursor: 'pointer', fontSize: 12, marginRight: 8, fontWeight: 600,
};

const dangerInlineBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 12, marginRight: 8, fontWeight: 700,
};

const attentionBtn: React.CSSProperties = {
  border: '1px solid #d7dbe3',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 12,
};

const dangerBtn: React.CSSProperties = {
  background: '#e74c3c', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 12,
};

const compareTh: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#555', fontWeight: 600,
};

const candidateTh: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 12, color: '#555', fontWeight: 600,
};

const compareTd: React.CSSProperties = {
  padding: '8px 12px', fontSize: 12,
};

const controlMiniPanel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5edf5',
  borderRadius: 6,
  padding: '8px 10px',
};

const controlMiniLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#64748b',
  marginBottom: 4,
};

const controlMiniValue: React.CSSProperties = {
  fontSize: 13,
  color: '#16324f',
  fontWeight: 700,
  marginBottom: 4,
};

const controlMiniText: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  lineHeight: 1.5,
};

const confirmChip: React.CSSProperties = {
  fontSize: 12,
  color: '#7c2d12',
  background: '#ffedd5',
  border: '1px solid #fed7aa',
  borderRadius: 6,
  padding: '4px 8px',
};

const intentPanel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5edf5',
  borderRadius: 6,
  padding: '8px 10px',
};

const intentRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 12,
  color: '#374151',
  padding: '3px 0',
};

const eventTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '1px solid #e5e7eb',
  color: '#6b7280',
  fontWeight: 600,
};

const eventTd: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #eef2f7',
  color: '#374151',
};

const paginationBtn: React.CSSProperties = {
  background: '#f0f0f0',
  color: '#333',
  border: 'none',
  padding: '6px 16px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
};
