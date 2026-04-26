import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasks } from '../api/client';
import type { MediaTask, TaskItemInfo, VerifyResult } from '../types';
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

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-tasks'] });
    qc.invalidateQueries({ queryKey: ['admin-task-detail'] });
  }

  const deleteMut = useMutation({
    mutationFn: tasks.remove,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '任务已删除' }); setDetailOpen(false); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const pauseMut = useMutation({
    mutationFn: tasks.pause,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '任务已暂停' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const executeMut = useMutation({
    mutationFn: tasks.execute,
    onSuccess: (data) => { invalidate(); setAlert({ type: 'success', msg: `任务状态: ${data.status}` }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const confirmMut = useMutation({
    mutationFn: tasks.confirm,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '已确认，任务继续执行' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const taskList: MediaTask[] = taskData?.tasks || [];
  const taskSummary = taskData?.summary;
  const displayTask = detailData || selectedTask;

  function openDetail(task: MediaTask) {
    setSelectedTask(task);
    setDetailOpen(true);
  }

  function renderActions(t: MediaTask) {
    const btns: React.ReactNode[] = [];
    if (t.status === 'executing') {
      btns.push(<button key="pause" onClick={() => pauseMut.mutate(t.id)} style={warnBtn}>暂停</button>);
    }
    if (t.status === 'paused' || t.status === 'pending_manual') {
      btns.push(<button key="exec" onClick={() => executeMut.mutate(t.id)} style={execBtn}>执行</button>);
    }
    if (t.status === 'awaiting_user_confirm') {
      if (t.resumePoint === 'transcode_replace' && t.verifyResult) {
        btns.push(<button key="compare" onClick={() => openDetail(t)} style={execBtn}>查看对比</button>);
      } else {
        btns.push(<button key="confirm" onClick={() => { if (confirm(`确认执行 ${t.actionType} 任务？`)) confirmMut.mutate(t.id); }} style={execBtn}>确认</button>);
      }
    }
    return btns;
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
      ['音频编码', orig.originalAudioCodec || '—', result.videoCodec || '—', ''],
      ['预估节省', '', `${origGb > newGb ? (origGb - newGb).toFixed(2) + ' GB' : '—'}`, ''],
    ];

    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>任务监控</h2>
        <button onClick={() => invalidate()} style={refreshBtn}>
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
                    {renderActions(t)}
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

            {/* Replace confirm comparison card */}
            {displayTask.status === 'awaiting_user_confirm' && displayTask.resumePoint === 'transcode_replace' && displayTask.verifyResult && displayTask.itemInfo && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#1a1a2e' }}>转码结果对比</h4>
                {renderCompareTable(displayTask.itemInfo, displayTask.verifyResult)}
                {displayTask.verifyResult.previewPath && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#555' }}>试看预览（30秒片段）</p>
                    <video controls width="480" style={{ borderRadius: 6, background: '#000', maxWidth: '100%' }}>
                      <source src={`/v1/tasks/${displayTask.id}/preview`} type="video/mp4" />
                    </video>
                  </div>
                )}
                <div style={{ marginTop: 14 }}>
                  <button onClick={() => confirmMut.mutate(displayTask.id)} disabled={confirmMut.isPending} style={{
                    background: '#27ae60', color: '#fff', border: 'none', padding: '10px 28px',
                    borderRadius: 6, cursor: 'pointer', fontSize: 15, fontWeight: 600,
                  }}>
                    {confirmMut.isPending ? '确认中...' : '确认替换'}
                  </button>
                  <span style={{ marginLeft: 12, fontSize: 13, color: '#888' }}>确认后将用新文件替换原文件，操作不可撤销</span>
                </div>
              </div>
            )}

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

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {displayTask.status === 'executing' && (
                  <button onClick={() => pauseMut.mutate(displayTask.id)} disabled={pauseMut.isPending} style={warnBtn}>
                    {pauseMut.isPending ? '暂停中...' : '暂停'}
                  </button>
                )}
                {(displayTask.status === 'paused' || displayTask.status === 'pending_manual') && (
                  <button onClick={() => executeMut.mutate(displayTask.id)} disabled={executeMut.isPending} style={execBtn}>
                    {executeMut.isPending ? '执行中...' : '执行'}
                  </button>
                )}
                {displayTask.status === 'awaiting_user_confirm' && displayTask.resumePoint !== 'transcode_replace' && (
                  <button onClick={() => { if (confirm(`确认执行 ${displayTask.actionType} 任务？`)) confirmMut.mutate(displayTask.id); }} disabled={confirmMut.isPending} style={execBtn}>
                    {confirmMut.isPending ? '确认中...' : '确认'}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setDetailOpen(false); setSelectedTask(null); }} style={secondaryBtn}>关闭</button>
                <button
                  onClick={() => { if (confirm('确认删除此任务？')) deleteMut.mutate(displayTask.id); }}
                  style={dangerBtn}
                >
                  删除任务
                </button>
              </div>
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

const execBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#27ae60', cursor: 'pointer', fontSize: 13, marginRight: 8, fontWeight: 600,
};

const warnBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#f39c12', cursor: 'pointer', fontSize: 13, marginRight: 8, fontWeight: 600,
};

const secondaryBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const dangerBtn: React.CSSProperties = {
  background: '#e74c3c', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const compareTh: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#555', fontWeight: 600,
};

const compareTd: React.CSSProperties = {
  padding: '8px 12px', fontSize: 13,
};
