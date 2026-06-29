import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { resources } from '../api/client';
import type { BackgroundIoState, DiagnosticLogEntry, ResourceBucket, ResourceTask, RuntimeResourceEvent, StorageMetric } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';

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
  'metadata.ingest.precheck': '入库预检',
  'metadata.ingest.commit': '入库写入',
  'metadata.scrape.fetch': '元数据抓取',
  'optimize.transcode.execute': '转码执行',
  'optimize.upgrade.download': '洗版下载',
  'archive.delete.execute': '归档删除',
};

const BRIDGE_LABELS: Record<string, string> = {
  metadata: 'metadata',
  optimize: 'optimization',
  archive: 'archive',
};

const EVENT_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const DIAGNOSTIC_STATUS_LABELS: Record<string, string> = {
  done: '完成',
  slow: '慢',
  failed: '失败',
  skipped: '跳过',
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

function formatBytes(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[idx]}`;
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

function taskBusinessLabel(task: ResourceTask): string {
  const bridge = task.bridgeKind ? (BRIDGE_LABELS[task.bridgeKind] || task.bridgeKind) : 'bridge';
  const op = task.operationKind || task.actionType;
  return `${bridge} / ${op}`;
}

function payloadSummary(payload?: Record<string, unknown>): string {
  if (!payload) return '-';
  const parts: string[] = [];
  const keys = ['reason', 'rowCount', 'total', 'inputRows', 'writtenRows', 'changedRows', 'resourceBuckets', 'runningTasks', 'error'];
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null && value !== '') parts.push(`${key}=${String(value)}`);
  }
  const after = payload.after as { walSizeBytes?: number } | undefined;
  if (after && typeof after.walSizeBytes === 'number') parts.push(`wal=${formatBytes(after.walSizeBytes)}`);
  return parts.length > 0 ? parts.join(' · ') : '-';
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
  const diagnostics = data?.diagnostics;
  const diagnosticLogs = diagnostics?.logs || [];
  const dependencies = diagnostics?.dependencies || [];
  const failedEvents = diagnostics?.failedEvents || [];
  const bottlenecks = diagnostics?.bottlenecks || [];
  const storageMetrics = diagnostics?.metrics?.storage || [];
  const backgroundIo = diagnostics?.backgroundIo;

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
        <Metric label="诊断日志" value={diagnostics?.summary.totalLogs || 0} />
        <Metric label="慢诊断" value={diagnostics?.summary.slowLogs || 0} tone="orange" />
        <Metric label="后台 I/O" value={backgroundIo?.summary.activeCount || 0} tone={backgroundIo?.summary.runningHeavyIo ? 'orange' : undefined} />
        <Metric label="I/O 跳过" value={backgroundIo?.summary.skippedCount || 0} tone="orange" />
      </div>

      <StorageMetricsSection metrics={storageMetrics} />

      <BackgroundIoSection state={backgroundIo} />

      <DependencyDiagnosticsSection dependencies={dependencies} failedEvents={failedEvents} bottlenecks={bottlenecks} />

      <DiagnosticLogSection logs={diagnosticLogs} />

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
        {events.length > 0 ? <span style={statPill}>event {events.length}</span> : null}
        {(bucket.eventRunning || 0) > 0 ? <span style={statPill}>运行 event {bucket.eventRunning}</span> : null}
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
                  <td style={tdStyle}>
                    <div>{taskBusinessLabel(task)}</div>
                    <div style={mutedText}>{EVENT_LABELS[task.currentEventType || ''] || task.currentEventType || task.currentEventPhase || '-'}</div>
                  </td>
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

function DependencyDiagnosticsSection({
  dependencies,
  failedEvents,
  bottlenecks,
}: {
  dependencies: Array<Record<string, unknown>>;
  failedEvents: Array<{ id: string; eventType: string; eventStatus: string; itemId?: string; resourceType?: string | null; resourceKey?: string; createdAt: string }>;
  bottlenecks: Array<{ resourceKey: string; resourceLabel: string; configuredSlots: number; running: number; waiting: number; blocked: number }>;
}) {
  return (
    <div style={sectionSpaced}>
      <div style={sectionHeader}>
        <h2 style={sectionTitle}>诊断</h2>
        <div style={mutedText}>依赖、失败 event、资源瓶颈</div>
      </div>
      <div style={diagnosticGrid}>
        <DiagnosticList
          title="外部依赖"
          empty="暂无 health check 结果。"
          rows={dependencies.map((dep) => ({
            key: String(dep.key || dep.name || dep.component || 'dependency'),
            main: String(dep.message || dep.status || '-'),
            meta: String(dep.status || '-'),
          }))}
        />
        <DiagnosticList
          title="失败 event"
          empty="最近没有失败 event。"
          rows={failedEvents.map((event) => ({
            key: event.id,
            main: EVENT_LABELS[event.eventType] || event.eventType,
            meta: `${event.eventStatus || '-'} · ${event.resourceKey || event.resourceType || '-'} · ${formatTime(event.createdAt)}`,
          }))}
        />
        <DiagnosticList
          title="资源瓶颈"
          empty="当前没有达到容量上限的等待队列。"
          rows={bottlenecks.map((bucket) => ({
            key: bucket.resourceKey,
            main: bucket.resourceLabel || bucket.resourceKey,
            meta: `slots ${bucket.running}/${bucket.configuredSlots} · waiting ${bucket.waiting} · blocked ${bucket.blocked}`,
          }))}
        />
      </div>
    </div>
  );
}

function DiagnosticList({ title, empty, rows }: { title: string; empty: string; rows: Array<{ key: string; main: string; meta: string }> }) {
  return (
    <div style={storageBox}>
      <div style={bucketTitle}>{title}</div>
      {rows.length === 0 ? (
        <div style={mutedText}>{empty}</div>
      ) : (
        <div style={fileList}>
          {rows.slice(0, 6).map((row) => (
            <div key={row.key} style={fileRow}>
              <span>{row.main}</span>
              <strong>{row.meta}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StorageMetricsSection({ metrics }: { metrics: StorageMetric[] }) {
  return (
    <div style={sectionSpaced}>
      <div style={sectionHeader}>
        <h2 style={sectionTitle}>Storage metrics</h2>
        <div style={mutedText}>{metrics.length} 个 SQLite store</div>
      </div>
      {metrics.length === 0 ? (
        <div style={emptyBox}>暂无 storage metric。</div>
      ) : (
        <div style={storageGrid}>
          {metrics.map((metric) => (
            <div key={metric.resourceKey} style={storageBox}>
              <div style={bucketTitle}>{metric.store}</div>
              <div style={storageStats}>
                <span style={statPill}>DB {formatBytes(metric.dbSizeBytes)}</span>
                <span style={statPill}>WAL {formatBytes(metric.walSizeBytes)}</span>
                <span style={statPill}>总计 {formatBytes(metric.totalSizeBytes)}</span>
              </div>
              <div style={fileList}>
                {metric.files.map((file) => (
                  <div key={file.name} style={fileRow}>
                    <span>{file.name}</span>
                    <strong>{file.exists ? formatBytes(file.sizeBytes) : '不存在'}</strong>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackgroundIoSection({ state }: { state?: BackgroundIoState }) {
  const active = state?.active || [];
  const recent = state?.recent || [];
  const rows = active.length > 0 ? active : recent.slice(0, 8);
  return (
    <div style={sectionSpaced}>
      <div style={sectionHeader}>
        <h2 style={sectionTitle}>Background I/O Guard</h2>
        <div style={mutedText}>
          {active.length > 0 ? `${active.length} 个后台重 I/O 运行中` : '当前空闲'}
        </div>
      </div>
      {!state || rows.length === 0 ? (
        <div style={emptyBox}>暂无 background I/O operation。</div>
      ) : (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>操作</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>耗时</th>
                <th style={thStyle}>锁</th>
                <th style={thStyle}>资源</th>
                <th style={thStyle}>摘要</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((op) => (
                <tr key={op.operationId}>
                  <td style={tdStyle}>
                    <div style={taskName}>{op.operation}</div>
                    <div style={taskIdText}>{op.component} · {formatTime(op.startedAt)}</div>
                  </td>
                  <td style={tdStyle}>
                    <span style={diagnosticBadge(op.status)}>{DIAGNOSTIC_STATUS_LABELS[op.status] || op.status}</span>
                  </td>
                  <td style={tdStyle}>{formatDuration(op.durationMs)}</td>
                  <td style={tdStyle}>{op.lockKey}</td>
                  <td style={tdStyle}>{op.resourceKey}</td>
                  <td style={tdStyle}>{payloadSummary(op.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DiagnosticLogSection({ logs }: { logs: DiagnosticLogEntry[] }) {
  return (
    <div style={sectionSpaced}>
      <div style={sectionHeader}>
        <h2 style={sectionTitle}>Diagnostic log</h2>
        <div style={mutedText}>{logs.length} 条记录</div>
      </div>
      {logs.length === 0 ? (
        <div style={emptyBox}>暂无 diagnostic log。</div>
      ) : (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>范围</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>耗时</th>
                <th style={thStyle}>资源</th>
                <th style={thStyle}>时间</th>
                <th style={thStyle}>摘要</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 40).map((log) => (
                <tr key={log.logId || log.id}>
                  <td style={tdStyle}>
                    <div style={taskName}>{log.scope}</div>
                    <div style={taskIdText}>{log.category} · {log.operation}</div>
                  </td>
                  <td style={tdStyle}>
                    <span style={diagnosticBadge(log.status)}>{DIAGNOSTIC_STATUS_LABELS[log.status] || log.status}</span>
                  </td>
                  <td style={tdStyle}>{formatDuration(log.durationMs)}</td>
                  <td style={tdStyle}>{log.resourceKey}</td>
                  <td style={tdStyle}>{formatTime(log.endedAt || log.startedAt)}</td>
                  <td style={tdStyle}>{payloadSummary(log.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

const sectionSpaced: CSSProperties = {
  ...section,
  marginBottom: 20,
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

function diagnosticBadge(status: string): CSSProperties {
  const color = status === 'failed' ? '#b91c1c' : (status === 'slow' || status === 'skipped') ? '#b45309' : '#166534';
  return {
    color,
    background: status === 'failed' ? '#fef2f2' : (status === 'slow' || status === 'skipped') ? '#fff7ed' : '#ecfdf5',
    border: `1px solid ${status === 'failed' ? '#fecaca' : (status === 'slow' || status === 'skipped') ? '#fed7aa' : '#bbf7d0'}`,
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
}

const storageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 12,
  padding: 12,
};

const diagnosticGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
};

const storageBox: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
};

const storageStats: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 10,
};

const fileList: CSSProperties = {
  display: 'grid',
  gap: 6,
  marginTop: 10,
};

const fileRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  color: '#374151',
  fontSize: 12,
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
