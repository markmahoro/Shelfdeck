import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasks } from '../api/client';
import type { MediaTask, TaskStatus } from '../types';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending_manual: '待手动执行',
  created: '已创建',
  queued: '排队中',
  precheck: '预检中',
  executing: '执行中',
  verify: '验证中',
  awaiting_user_confirm: '待确认',
  paused: '已暂停',
  done: '已完成',
  failed_hard: '失败',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending_manual: '#888',
  created: '#888',
  queued: '#f39c12',
  precheck: '#4a90d9',
  executing: '#4a90d9',
  verify: '#4a90d9',
  awaiting_user_confirm: '#f39c12',
  paused: '#888',
  done: '#27ae60',
  failed_hard: '#e53',
};

const PAGE_TITLE: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  marginBottom: '24px',
};

const FILTER_BTN: React.CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #ddd',
  borderRadius: '16px',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
};

const FILTER_BTN_ACTIVE: React.CSSProperties = {
  ...FILTER_BTN,
  background: '#4a90d9',
  color: '#fff',
  borderColor: '#4a90d9',
};

const TASK_CARD: React.CSSProperties = {
  background: '#fff',
  borderRadius: '8px',
  padding: '12px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  cursor: 'pointer',
  transition: 'box-shadow 0.15s',
};

const STATUS_BADGE: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: '12px',
  color: '#fff',
  fontSize: '12px',
};

const ACTION_BTN: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  border: 'none',
  background: '#4a90d9',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '12px',
};

const DRAWER_OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const DRAWER: React.CSSProperties = {
  background: '#fff',
  borderRadius: '12px',
  padding: '24px',
  width: '560px',
  maxHeight: '80vh',
  overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
};

export default function TaskCenterPage() {
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const [selected, setSelected] = useState<MediaTask | null>(null);
  const qc = useQueryClient();

  const { data: allTasks = [], isLoading } = useQuery<MediaTask[]>({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
    refetchInterval: 5000,
  });

  const filtered = filter === 'all' ? allTasks : allTasks.filter((t) => t.status === filter);

  const confirmMutation = useMutation({
    mutationFn: (id: string) => tasks.confirm(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => tasks.pause(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const executeMutation = useMutation({
    mutationFn: (id: string) => tasks.execute(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tasks.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setSelected(null);
    },
  });

  const handleAction = (task: MediaTask, action: 'confirm' | 'pause' | 'execute' | 'delete') => {
    if (action === 'delete') {
      if (!window.confirm(`删除任务「${task.itemName}」？`)) return;
      deleteMutation.mutate(task.id);
    } else if (action === 'confirm') {
      confirmMutation.mutate(task.id);
    } else if (action === 'pause') {
      pauseMutation.mutate(task.id);
    } else if (action === 'execute') {
      executeMutation.mutate(task.id);
    }
  };

  return (
    <div>
      <h2 style={PAGE_TITLE}>任务中心</h2>

      {/* Filter */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          style={filter === 'all' ? FILTER_BTN_ACTIVE : FILTER_BTN}
          onClick={() => setFilter('all')}
        >
          全部
        </button>
        {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
          <button
            key={s}
            style={filter === s ? FILTER_BTN_ACTIVE : FILTER_BTN}
            onClick={() => setFilter(s)}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Task List */}
      {isLoading ? (
        <div>加载中...</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#888' }}>暂无任务</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map((t) => (
            <div
              key={t.id}
              style={TASK_CARD}
              onClick={() => setSelected(t)}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {t.itemName || t.itemId}
                  </div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                    {t.actionType} · {t.id.slice(0, 8)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{ ...STATUS_BADGE, background: STATUS_COLORS[t.status] }}
                  >
                    {STATUS_LABELS[t.status]}
                  </span>
                  {t.progress !== undefined && (
                    <span style={{ fontSize: '13px', color: '#666' }}>
                      {t.progress}%
                    </span>
                  )}
                </div>
              </div>

              {/* Inline actions */}
              <div
                style={{ marginTop: '8px', display: 'flex', gap: '6px' }}
                onClick={(e) => e.stopPropagation()}
              >
                {t.status === 'awaiting_user_confirm' && (
                  <button
                    style={ACTION_BTN}
                    onClick={() => handleAction(t, 'confirm')}
                  >
                    确认
                  </button>
                )}
                {['pending_manual', 'created', 'queued'].includes(t.status) && (
                  <button
                    style={ACTION_BTN}
                    onClick={() => handleAction(t, 'execute')}
                  >
                    执行
                  </button>
                )}
                {!['executing', 'verify', 'done', 'failed_hard'].includes(t.status) && (
                  <button
                    style={{ ...ACTION_BTN, background: '#f39c12' }}
                    onClick={() => handleAction(t, 'pause')}
                  >
                    暂停
                  </button>
                )}
                {!['executing', 'verify'].includes(t.status) && (
                  <button
                    style={{ ...ACTION_BTN, background: '#e53' }}
                    onClick={() => handleAction(t, 'delete')}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Drawer */}
      {selected && (
        <div style={DRAWER_OVERLAY} onClick={() => setSelected(null)}>
          <div style={DRAWER} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '8px' }}>{selected.itemName || selected.itemId}</h3>
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
              {selected.actionType} · {selected.status} ·{' '}
              {selected.progress !== undefined ? `${selected.progress}%` : 'N/A'}
            </div>
            <h4 style={{ marginBottom: '8px', fontSize: '13px' }}>执行日志</h4>
            <div
              style={{
                background: '#f5f5f5',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '12px',
                fontFamily: 'monospace',
                maxHeight: '300px',
                overflowY: 'auto',
              }}
            >
              {selected.flowLog?.length ? (
                selected.flowLog.map((entry, i) => (
                  <div key={i} style={{ marginBottom: '4px' }}>
                    <span style={{ color: '#888' }}>
                      [{entry.ts?.split('T')[1]?.slice(0, 8)}]
                    </span>{' '}
                    <span
                      style={{
                        color:
                          entry.level === 'error'
                            ? '#e53'
                            : entry.level === 'warn'
                              ? '#f39c12'
                              : '#333',
                      }}
                    >
                      {entry.message}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ color: '#888' }}>无日志</div>
              )}
            </div>
            <button
              style={{ ...ACTION_BTN, marginTop: '16px' }}
              onClick={() => setSelected(null)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
