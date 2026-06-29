import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { resources } from '../api/client';
import type { ResourceBucket, ResourceTask, RuntimeResourceEvent } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';

const ACTION_LABELS: Record<string, string> = {
  ingest: '入库',
  scrape: '刮削',
  transcode: '转码',
  upgrade: '洗版',
  delete: '删除',
};

const RESOURCE_LABELS: Record<string, string> = {
  local_transcode: '本机转码',
  worker_transcode: '远程转码',
  moviepilot: 'MoviePilot',
  filesystem: '文件系统',
  local_ai: '本机 AI',
  scraper: '元数据抓取',
  unknown: '未知资源',
};

const STATE_LABELS: Record<string, string> = {
  running: '运行中',
  waiting: '等待中',
  blocked: '已阻塞',
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
  done: '已完成',
  failed_hard: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
  deleted: '已移除',
};

const EVENT_LABELS: Record<string, string> = {
  'library.query': '媒体库查询',
  'douban.sync': '豆瓣同步',
  'strategy.run': '策略计算',
  'smartTask.scan': '自动入队扫描',
  'task.dispatch': '任务派发',
};

const EVENT_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const STATE_COLOR: Record<string, string> = {
  running: '#166534',
  waiting: '#1d4ed8',
  blocked: '#b45309',
};

const EVENT_STATE_COLOR: Record<string, string> = {
  running: '#166534',
  recent: '#374151',
  failed: '#b91c1c',
};

function formatTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatPercent(value?: number): string {
  if (typeof value !== 'number') return '-';
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatDuration(value?: number | null): string {
  if (typeof value !== 'number') return '-';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function resourceTitle(bucket: ResourceBucket): string {
  return RESOURCE_LABELS[bucket.resourceType] || bucket.resourceLabel || bucket.resourceType;
}

function taskTitle(task: ResourceTask): string {
  return task.itemName || task.itemId || task.taskId;
}

function eventTitle(event: RuntimeResourceEvent): string {
  return EVENT_LABELS[event.eventType] || event.eventType;
}

function stateBadge(state: string): CSSProperties {
  return {
    color: STATE_COLOR[state] || '#374151',
    background: state === 'blocked' ? '#fff7ed' : state === 'running' ? '#ecfdf5' : '#eff6ff',
    border: `1px solid ${state === 'blocked' ? '#fed7aa' : state === 'running' ? '#bbf7d0' : '#bfdbfe'}`,
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
}

function eventBadge(state: string): CSSProperties {
  const color = EVENT_STATE_COLOR[state] || '#374151';
  return {
    color,
    background: state === 'failed' ? '#fef2f2' : state === 'running' ? '#ecfdf5' : '#f9fafb',
    border: `1px solid ${state === 'failed' ? '#fecaca' : state === 'running' ? '#bbf7d0' : '#e5e7eb'}`,
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
}

export default function ResourceViewPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-resources'],
    queryFn: resources.get,
    refetchInterval: 5000,
  });

  if (isLoading) return <LoadingSpinner text="加载资源视图..." />;

  if (error) {
    return (
      <div>
        <Header isFetching={isFetching} onRefresh={() => void refetch()} generatedAt="" />
        <div style={errorBox}>{error instanceof Error ? error.message : '资源视图加载失败'}</div>
      </div>
    );
  }

  const summary = data?.summary;
  const buckets = data?.resources || [];

  return (
    <div>
      <Header isFetching={isFetching} onRefresh={() => void refetch()} generatedAt={summary?.generatedAt || ''} />

      <div style={summaryGrid}>
        <Metric label="资源相关任务" value={summary?.totalTasks || 0} />
        <Metric label="运行事件" value={summary?.runningEvents || 0} tone="green" />
        <Metric label="最近事件" value={summary?.recentEvents || 0} />
        <Metric label="运行中" value={summary?.byState.running || 0} tone="green" />
        <Metric label="等待中" value={summary?.byState.waiting || 0} tone="blue" />
        <Metric label="已阻塞" value={summary?.byState.blocked || 0} tone="orange" />
      </div>

      <div style={section}>
        <div style={sectionHeader}>
          <h2 style={sectionTitle}>资源队列</h2>
          <div style={mutedText}>{buckets.length} 个资源桶</div>
        </div>

        {buckets.length === 0 ? (
          <div style={emptyBox}>当前没有等待、运行、阻塞中的任务或最近资源事件。</div>
        ) : (
          <div style={bucketList}>
            {buckets.map((bucket) => (
              <ResourceBucketView key={bucket.resourceKey} bucket={bucket} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ isFetching, generatedAt, onRefresh }: { isFetching: boolean; generatedAt: string; onRefresh: () => void }) {
  return (
    <div style={pageHeader}>
      <div>
        <h1 style={pageTitle}>资源视图</h1>
        <div style={mutedText}>更新于 {formatTime(generatedAt)}</div>
      </div>
      <button style={refreshBtn} onClick={onRefresh} disabled={isFetching}>
        {isFetching ? '刷新中...' : '刷新'}
      </button>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'blue' | 'orange' }) {
  const color = tone === 'green' ? '#166534' : tone === 'blue' ? '#1d4ed8' : tone === 'orange' ? '#b45309' : '#111827';
  return (
    <div style={metricBox}>
      <div style={metricLabel}>{label}</div>
      <div style={{ ...metricValue, color }}>{value}</div>
    </div>
  );
}

function ResourceBucketView({ bucket }: { bucket: ResourceBucket }) {
  const total = bucket.running + bucket.waiting + bucket.blocked;
  const events = bucket.events || [];
  const slotText = bucket.configuredSlots > 0 ? `${bucket.running}/${bucket.configuredSlots}` : `${bucket.running}`;

  return (
    <div style={bucketBox}>
      <div style={bucketHeader}>
        <div>
          <div style={bucketTitle}>{resourceTitle(bucket)}</div>
          <div style={mutedText}>{bucket.resourceKey}</div>
        </div>
        <div style={slotBox}>
          <span style={slotLabel}>占用</span>
          <strong>{slotText}</strong>
        </div>
      </div>

      <div style={bucketStats}>
        <span style={statPill}>总计 {total}</span>
        <span style={statPill}>运行 {bucket.running}</span>
        <span style={statPill}>等待 {bucket.waiting}</span>
        <span style={statPill}>阻塞 {bucket.blocked}</span>
        {events.length > 0 ? <span style={statPill}>事件 {events.length}</span> : null}
        {(bucket.eventRunning || 0) > 0 ? <span style={statPill}>运行事件 {bucket.eventRunning}</span> : null}
      </div>

      {bucket.tasks.length > 0 ? (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>媒体</th>
                <th style={thStyle}>业务</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>进度</th>
                <th style={thStyle}>优先级</th>
                <th style={thStyle}>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {bucket.tasks.map((task) => (
                <tr key={task.taskId}>
                  <td style={tdStyle}>
                    <div style={taskName}>{taskTitle(task)}</div>
                    <div style={taskIdText}>{task.taskId}</div>
                  </td>
                  <td style={tdStyle}>{ACTION_LABELS[task.actionType] || task.actionType}</td>
                  <td style={tdStyle}>
                    <div style={statusStack}>
                      <span style={stateBadge(task.resourceState)}>{STATE_LABELS[task.resourceState] || task.resourceState}</span>
                      <span style={mutedText}>{STATUS_LABELS[task.status] || task.status}</span>
                    </div>
                  </td>
                  <td style={tdStyle}>{formatPercent(task.progress)}</td>
                  <td style={tdStyle}>{typeof task.priority === 'number' ? task.priority : '-'}</td>
                  <td style={tdStyle}>{formatTime(task.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div style={eventList}>
          {events.map((event) => (
            <RuntimeEventRow key={event.eventId} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeEventRow({ event }: { event: RuntimeResourceEvent }) {
  const target = event.itemName || event.itemId || event.subLibraryId || event.taskId || event.component;
  return (
    <div style={eventRow}>
      <div style={eventMain}>
        <div style={eventName}>{eventTitle(event)}</div>
        <div style={mutedText}>{event.component}{target ? ` · ${target}` : ''}</div>
      </div>
      <span style={eventBadge(event.eventState)}>
        {EVENT_STATUS_LABELS[event.eventStatus] || event.eventStatus}
      </span>
      <div style={eventMeta}>{formatDuration(event.durationMs)}</div>
      <div style={eventMeta}>{formatTime(event.startedAt)}</div>
    </div>
  );
}

const pageHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 20,
};

const pageTitle: CSSProperties = {
  margin: 0,
  fontSize: 28,
  color: '#111827',
};

const mutedText: CSSProperties = {
  color: '#6b7280',
  fontSize: 12,
};

const refreshBtn: CSSProperties = {
  background: '#111827',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
};

const summaryGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
  marginBottom: 20,
};

const metricBox: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '14px 16px',
};

const metricLabel: CSSProperties = {
  color: '#6b7280',
  fontSize: 12,
  marginBottom: 6,
};

const metricValue: CSSProperties = {
  fontSize: 26,
  fontWeight: 700,
};

const section: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  overflow: 'hidden',
};

const sectionHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 16px',
  borderBottom: '1px solid #e5e7eb',
};

const sectionTitle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  color: '#111827',
};

const emptyBox: CSSProperties = {
  padding: 32,
  textAlign: 'center',
  color: '#6b7280',
  fontSize: 13,
};

const bucketList: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 12,
};

const bucketBox: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  overflow: 'hidden',
};

const bucketHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
};

const bucketTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#111827',
};

const slotBox: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  whiteSpace: 'nowrap',
  color: '#111827',
};

const slotLabel: CSSProperties = {
  color: '#6b7280',
  fontSize: 12,
};

const bucketStats: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  padding: '10px 14px',
  borderBottom: '1px solid #f3f4f6',
};

const statPill: CSSProperties = {
  background: '#f3f4f6',
  color: '#374151',
  borderRadius: 999,
  padding: '3px 8px',
  fontSize: 12,
};

const tableWrap: CSSProperties = {
  overflowX: 'auto',
};

const eventList: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 12,
};

const eventRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 1fr) auto 72px 150px',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  background: '#f9fafb',
};

const eventMain: CSSProperties = {
  minWidth: 0,
};

const eventName: CSSProperties = {
  color: '#111827',
  fontSize: 13,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const eventMeta: CSSProperties = {
  color: '#374151',
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '9px 12px',
  color: '#6b7280',
  background: '#fff',
  borderBottom: '1px solid #e5e7eb',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
  color: '#374151',
  whiteSpace: 'nowrap',
};

const taskName: CSSProperties = {
  color: '#111827',
  fontWeight: 600,
  maxWidth: 340,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const taskIdText: CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
  marginTop: 3,
};

const statusStack: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const errorBox: CSSProperties = {
  background: '#fff5f5',
  border: '1px solid #fecaca',
  color: '#b91c1c',
  borderRadius: 8,
  padding: 16,
  fontSize: 13,
};
