import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasks } from '../api/client';
import type { MediaTask } from '../types';
import Modal from '../components/Modal';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const STATUS_COLORS: Record<string, string> = {
  queued: '#3498db',
  executing: '#f39c12',
  awaiting_user_confirm: '#e67e22',
  done: '#27ae60',
  failed_hard: '#e74c3c',
  paused: '#888',
  interrupted: '#888',
  created: '#999',
  pending_manual: '#999',
};

export default function TaskMonitorPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedTask, setSelectedTask] = useState<MediaTask | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const { data: taskData, isLoading, isFetching } = useQuery({
    queryKey: ['admin-tasks', statusFilter, typeFilter],
    queryFn: () => tasks.list({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(typeFilter ? { actionType: typeFilter } : {}),
    }),
  });

  const { data: detailData } = useQuery({
    queryKey: ['admin-task-detail', selectedTask?.id],
    queryFn: () => selectedTask ? tasks.get(selectedTask.id) : null,
    enabled: detailOpen && !!selectedTask,
    refetchInterval: detailOpen ? 2000 : false,
  });

  const deleteMut = useMutation({
    mutationFn: tasks.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tasks'] });
      setAlert({ type: 'success', msg: '任务已删除' });
      setDetailOpen(false);
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const taskList: MediaTask[] = taskData?.tasks || [];
  const taskSummary = taskData?.summary;
  const displayTask = detailData || selectedTask;

  function openDetail(task: MediaTask) {
    setSelectedTask(task);
    setDetailOpen(true);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>任务监控</h2>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['admin-tasks'] })} style={refreshBtn}>
          {isFetching ? '刷新中...' : '刷新'}
        </button>
      </div>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      {/* Summary */}
      {taskSummary && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ ...summaryBadge, background: '#f0f2f5' }}>总计: {taskSummary.total}</span>
          {Object.entries(taskSummary.byStatus || {}).map(([k, v]) => (
            <span key={k} style={{ ...summaryBadge, background: (STATUS_COLORS[k] || '#999') + '20', color: STATUS_COLORS[k] }}>
              {k}: {v}
            </span>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">全部状态</option>
          <option value="queued">queued</option>
          <option value="executing">executing</option>
          <option value="awaiting_user_confirm">awaiting_user_confirm</option>
          <option value="done">done</option>
          <option value="failed_hard">failed_hard</option>
          <option value="paused">paused</option>
          <option value="interrupted">interrupted</option>
          <option value="created">created</option>
          <option value="pending_manual">pending_manual</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
          <option value="">全部类型</option>
          <option value="transcode">transcode</option>
          <option value="delete">delete</option>
          <option value="upgrade">upgrade</option>
        </select>
      </div>

      {/* Task Table */}
      {isLoading ? (
        <LoadingSpinner />
      ) : taskList.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 10, padding: 40, textAlign: 'center', color: '#888' }}>
          暂无任务
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>任务ID</th>
                <th style={thStyle}>类型</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>阶段</th>
                <th style={thStyle}>进度</th>
                <th style={thStyle}>创建时间</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {taskList.map((t) => (
                <tr key={t.id}>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.id.slice(0, 12)}...</span>
                  </td>
                  <td style={tdStyle}>{t.actionType}</td>
                  <td style={tdStyle}>
                    <span style={{ color: STATUS_COLORS[t.status] || '#999' }}>{t.status}</span>
                  </td>
                  <td style={tdStyle}>{t.phase || '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 4, background: '#eee', borderRadius: 2, maxWidth: 80 }}>
                        <div style={{ width: `${t.progress || 0}%`, height: '100%', background: '#27ae60', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 12, color: '#888' }}>{t.progress || 0}%</span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, color: '#888' }}>
                      {t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button onClick={() => openDetail(t)} style={actionBtn}>详情</button>
                    <button onClick={() => { if (confirm('确认删除此任务？')) deleteMut.mutate(t.id); }} style={deleteBtn}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Detail Modal */}
      <Modal open={detailOpen} title="任务详情" onClose={() => { setDetailOpen(false); setSelectedTask(null); }} width={600}>
        {displayTask ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 14, marginBottom: 20 }}>
              <div><strong>任务ID:</strong> {displayTask.id}</div>
              <div><strong>媒体项:</strong> {displayTask.itemInfo?.name || displayTask.itemId}</div>
              <div><strong>类型:</strong> {displayTask.actionType}</div>
              <div><strong>状态:</strong> <span style={{ color: STATUS_COLORS[displayTask.status] }}>{displayTask.status}</span></div>
              <div><strong>阶段:</strong> {displayTask.phase || '—'}</div>
              <div><strong>进度:</strong> {displayTask.progress || 0}%</div>
              <div><strong>创建时间:</strong> {displayTask.createdAt ? new Date(displayTask.createdAt).toLocaleString() : '—'}</div>
              <div><strong>更新时间:</strong> {displayTask.updatedAt ? new Date(displayTask.updatedAt).toLocaleString() : '—'}</div>
            </div>

            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>执行日志</h4>
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => { setDetailOpen(false); setSelectedTask(null); }} style={secondaryBtn}>关闭</button>
              <button
                onClick={() => { if (confirm('确认删除此任务？')) deleteMut.mutate(displayTask.id); }}
                style={dangerBtn}
              >
                删除任务
              </button>
            </div>
          </div>
        ) : (
          <LoadingSpinner />
        )}
      </Modal>
    </div>
  );
}

const summaryBadge: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 12, fontSize: 13, fontWeight: 500,
};

const selectStyle: React.CSSProperties = {
  padding: '6px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13,
};

const refreshBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 16px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '12px 16px', borderBottom: '2px solid #eee', color: '#666', fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid #f0f0f0',
};

const actionBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#1a1a2e', cursor: 'pointer', fontSize: 13, marginRight: 8,
};

const deleteBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 13,
};

const secondaryBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const dangerBtn: React.CSSProperties = {
  background: '#e74c3c', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};
