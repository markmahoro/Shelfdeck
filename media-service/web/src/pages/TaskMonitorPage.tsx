import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import { tasks } from '../api/client';
import type { TaskControlAction, TaskControlState } from '../types';
import type { KairoxTaskView } from '../kairox';
import {
  STATUS_LABELS,
  TARGET_GATE_OPTIONS,
  TERMINAL_TASK_STATUSES,
  actionLabel,
  flowKindLabel,
  taskTargetGateLabel,
  taskPrimaryAction,
  toKairoxTaskView,
} from '../kairox';
import '../taskMonitor.css';

const PAGE_SIZE = 20;

const ATTENTION_TABS = [
  { key: '', label: '全部' },
  { key: 'needs_action', label: '需要我处理' },
  { key: 'confirmation', label: '等待确认' },
  { key: 'recovery', label: '失败/可恢复' },
  { key: 'manual_start', label: '待手动启动' },
];

const STATUS_COLORS: Record<string, string> = {
  queued: '#2563eb',
  executing: '#b45309',
  pausing: '#b45309',
  awaiting_user_confirm: '#c2410c',
  done: '#15803d',
  failed_hard: '#b91c1c',
  paused: '#64748b',
  interrupted: '#64748b',
  waiting_media_source: '#64748b',
  cancelled: '#64748b',
  skipped: '#64748b',
  deleted: '#64748b',
  created: '#64748b',
  pending_manual: '#64748b',
};

export default function TaskMonitorPage() {
  const qc = useQueryClient();
  const [attention, setAttention] = useState('');
  const [targetGate, setTargetGate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [detailTask, setDetailTask] = useState<KairoxTaskView | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [selectedConfirmationOption, setSelectedConfirmationOption] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-tasks', attention, targetGate, statusFilter, searchQuery, page],
    queryFn: () => tasks.list({
      ...(attention ? { attention } : statusFilter ? { status: statusFilter } : {}),
      ...(targetGate ? { targetGate } : {}),
      ...(searchQuery ? { q: searchQuery } : {}),
      page,
      pageSize: PAGE_SIZE,
      includeAttentionSummary: false,
    }),
    refetchInterval: 5000,
  });

  const { data: summaryData } = useQuery({
    queryKey: ['admin-tasks-summary'],
    queryFn: () => tasks.list({ page: 1, pageSize: 1 }),
    refetchInterval: 5000,
  });

  const { data: detailData } = useQuery({
    queryKey: ['admin-task-detail', detailTask?.id],
    queryFn: () => detailTask ? tasks.get(detailTask.id) : null,
    enabled: !!detailTask,
    refetchInterval: detailTask ? 2000 : false,
  });

  const taskViews = useMemo(() => (data?.tasks || []).map(toKairoxTaskView), [data?.tasks]);
  const displayDetail = detailData ? toKairoxTaskView(detailData) : detailTask;
  const total = data?.total || data?.summary?.total || 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-tasks'] });
    qc.invalidateQueries({ queryKey: ['admin-task-detail'] });
    qc.invalidateQueries({ queryKey: ['admin-tasks-summary'] });
  }

  const removeMut = useMutation({
    mutationFn: tasks.remove,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '任务已取消或移除' }); setDetailTask(null); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });
  const executeMut = useMutation({
    mutationFn: tasks.execute,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '任务已提交执行' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });
  const pauseMut = useMutation({
    mutationFn: tasks.pause,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '任务已请求暂停' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });
  const retryMut = useMutation({
    mutationFn: tasks.retry,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '任务已提交重试' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });
  const confirmMut = useMutation({
    mutationFn: (params: { id: string; confirmData?: Record<string, unknown> }) => tasks.confirm(params.id, params.confirmData),
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '确认已提交，任务继续推进' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  function openDetail(view: KairoxTaskView) {
    setSelectedConfirmationOption(0);
    setDetailTask(view);
  }

  function performAction(view: KairoxTaskView, key: keyof TaskControlState['actions']) {
    const task = view.raw;
    if (key === 'execute') executeMut.mutate(task.id);
    if (key === 'pause') pauseMut.mutate(task.id);
    if (key === 'retry') retryMut.mutate(task.id);
    if (key === 'confirm') {
      const confirmation = task.controlState?.confirmation;
      const options = Array.isArray(confirmation?.options) ? confirmation.options : [];
      const confirmData = options.length > 0 ? { selectedCandidateIndex: selectedConfirmationOption } : undefined;
      confirmMut.mutate({ id: task.id, confirmData });
    }
    if (key === 'cancel') {
      const terminal = TERMINAL_TASK_STATUSES.has(task.status);
      const message = terminal
        ? '只会移除任务中心里的历史记录，不会删除媒体文件。确认移除？'
        : '将取消这个未完成任务，不会删除媒体文件。确认取消？';
      if (confirm(message)) removeMut.mutate(task.id);
    }
  }

  function clearFilters() {
    setAttention('');
    setTargetGate('');
    setStatusFilter('');
    setSearchQuery('');
    setPage(1);
  }

  return (
    <div className="kairoxTaskPage">
      <div className="kairoxTaskHeader">
        <div>
          <h1>任务中心</h1>
          <p>查看系统正在推进的目标 Gate、需要介入的位置，以及失败后的恢复路径。</p>
        </div>
        <button onClick={() => invalidate()}>刷新</button>
      </div>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}
      {error && <Alert type="error" message={error instanceof Error ? error.message : String(error)} onClose={() => {}} />}

      <div className="kairoxAttentionBar">
        {ATTENTION_TABS.map((tab) => {
          const count = tab.key ? Number(summaryData?.summary?.attention?.[tab.key]?.count || 0) : Number(summaryData?.summary?.total || 0);
          const active = attention === tab.key;
          return (
            <button key={tab.key || 'all'} className={active ? 'active' : ''} onClick={() => { setAttention(tab.key); setStatusFilter(''); setPage(1); }}>
              {tab.label}<span>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="kairoxTaskFilters">
        <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }} placeholder="搜索媒体名或任务 ID" />
        <select value={targetGate} onChange={(e) => { setTargetGate(e.target.value); setPage(1); }}>
          <option value="">全部目标 Gate</option>
          {TARGET_GATE_OPTIONS.map((gate) => <option key={gate.value} value={gate.value}>{gate.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setAttention(''); setPage(1); }}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button onClick={clearFilters}>重置</button>
      </div>

      {isLoading ? (
        <LoadingSpinner text="加载任务列表..." />
      ) : taskViews.length === 0 ? (
        <div className="kairoxTaskEmpty">当前没有符合筛选条件的任务。</div>
      ) : (
        <div className="kairoxTaskTableWrap">
          <table className="kairoxTaskTable">
            <thead>
              <tr>
                <th>媒体</th>
                <th>目标 Gate</th>
                <th>目标合同</th>
                <th>状态</th>
                <th>进度</th>
                <th>需要介入</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {taskViews.map((view) => (
                <tr key={view.id}>
                  <td>
                    <button className="kairoxTaskTitle" onClick={() => openDetail(view)}>{view.title}</button>
                    <div className="kairoxTaskMuted">{view.object.itemId || view.id}</div>
                  </td>
                  <td><span className="kairoxTaskGate">{taskTargetGateLabel(view.targetGate)}</span></td>
                  <td>{view.objectiveSummary}</td>
                  <td><span style={{ color: STATUS_COLORS[view.status] || '#475569', fontWeight: 700 }}>{view.statusLabel}</span></td>
                  <td>
                    <div className="kairoxTaskProgress"><i style={{ width: `${view.progress}%` }} /></div>
                    <span className="kairoxTaskMuted">{view.progress}%</span>
                  </td>
                  <td>{view.controlHint}</td>
                  <td>
                    <div className="kairoxTaskActions">
                      <PrimaryActionButton view={view} onAction={performAction} />
                      <button onClick={() => openDetail(view)}>详情</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="kairoxTaskPager">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
          <span>第 {page} / {maxPage} 页，共 {total} 条</span>
          <button disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))}>下一页</button>
        </div>
      )}

      <Modal open={!!displayDetail} title="任务详情" onClose={() => setDetailTask(null)} width={760}>
        {displayDetail && (
          <TaskDetail
            view={displayDetail}
            selectedOption={selectedConfirmationOption}
            onSelectedOption={setSelectedConfirmationOption}
            onAction={performAction}
          />
        )}
      </Modal>
    </div>
  );
}

function PrimaryActionButton({
  view,
  onAction,
}: {
  view: KairoxTaskView;
  onAction: (view: KairoxTaskView, key: keyof TaskControlState['actions']) => void;
}) {
  const key = taskPrimaryAction(view.raw.controlState);
  if (!key) return null;
  const action = view.raw.controlState?.actions[key];
  if (!action?.enabled) return null;
  return <button onClick={() => onAction(view, key)}>{actionLabel(key, action)}</button>;
}

function TaskDetail({
  view,
  selectedOption,
  onSelectedOption,
  onAction,
}: {
  view: KairoxTaskView;
  selectedOption: number;
  onSelectedOption: (value: number) => void;
  onAction: (view: KairoxTaskView, key: keyof TaskControlState['actions']) => void;
}) {
  const task = view.raw;
  const control = task.controlState;
  const confirmation = control?.confirmation;
  const options = Array.isArray(confirmation?.options) ? confirmation.options : [];
  const flowPlan = task.flowPlan as Record<string, unknown> | undefined;
  return (
    <div className="kairoxTaskDetail">
      <section>
        <h3>任务目标</h3>
        <div className="kairoxDetailGrid">
          <Fact label="任务 ID" value={task.id} />
          <Fact label="媒体" value={view.title} />
          <Fact label="目标 Gate" value={taskTargetGateLabel(view.targetGate)} />
          <Fact label="目标合同" value={view.objectiveSummary} />
          <Fact label="来源" value={view.source} />
          <Fact label="状态" value={view.statusLabel} />
          <Fact label="阶段" value={view.phase || '-'} />
          <Fact label="进度" value={`${view.progress}%`} />
        </div>
      </section>

      <section>
        <h3>Flow Planner 结果</h3>
        <div className="kairoxDetailGrid">
          <Fact label="实现路径" value={flowKindLabel(task)} />
          <Fact label="资源" value={formatUnknown(flowPlan?.primaryResourceType || flowPlan?.resourceTypes)} />
          <Fact label="说明" value={formatUnknown(flowPlan?.explanation || flowPlan?.reason || flowPlan?.blockedReason)} />
          <Fact label="步骤" value={formatUnknown(flowPlan?.steps)} />
        </div>
      </section>

      {control && (
        <section>
          <h3>用户介入与恢复</h3>
          <div className="kairoxDetailGrid">
            <Fact label="控制状态" value={control.state || '-'} />
            <Fact label="恢复点" value={control.resumePoint || '-'} />
            <Fact label="恢复建议" value={formatUnknown(control.recovery)} />
            <Fact label="确认点" value={confirmation?.required ? confirmation.gateId || 'required' : '无需确认'} />
          </div>
          {confirmation?.required && (
            <div className="kairoxConfirmationBox">
              <strong>{confirmation.message || '任务等待确认后继续。'}</strong>
              {options.length > 0 && (
                <label>
                  选择项
                  <select value={selectedOption} onChange={(e) => onSelectedOption(Number(e.target.value))}>
                    {options.map((option, index) => (
                      <option key={index} value={index}>{confirmationOptionLabel(option, index)}</option>
                    ))}
                  </select>
                </label>
              )}
              <button onClick={() => onAction(view, 'confirm')}>确认继续</button>
            </div>
          )}
          <div className="kairoxTaskActions detail">
            {Object.entries(control.actions).map(([key, action]) => action.enabled ? (
              <button key={key} className={key === 'cancel' && action.destructive ? 'danger' : ''} onClick={() => onAction(view, key as keyof TaskControlState['actions'])}>
                {actionLabel(key as keyof TaskControlState['actions'], action as TaskControlAction)}
              </button>
            ) : null)}
          </div>
        </section>
      )}

      <section>
        <h3>事件</h3>
        {(task.events?.length || 0) === 0 ? (
          <p className="kairoxTaskMuted">暂无事件。</p>
        ) : (
          <div className="kairoxEventList">
            {task.events!.slice(-10).reverse().map((event) => (
              <div key={event.id}>
                <span>{event.createdAt ? new Date(event.createdAt).toLocaleString() : '-'}</span>
                <strong>{event.eventType}</strong>
                <em>{event.eventStatus || event.phase || event.resumePoint || '-'}</em>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatUnknown(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function confirmationOptionLabel(option: unknown, index: number): string {
  if (!option || typeof option !== 'object') return `选项 ${index + 1}`;
  const record = option as Record<string, unknown>;
  return String(record.title || record.name || record.label || `选项 ${index + 1}`);
}
