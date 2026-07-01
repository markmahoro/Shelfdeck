import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { deleteCandidates } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

function fmtDate(value?: string) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending_review': return '待确认';
    case 'confirmed': return '已确认';
    case 'kept_archived': return '继续归档';
    case 'snoozed': return '已延后';
    case 'suppressed': return '不再建议';
    case 'deleted': return '已删除';
    default: return status || '-';
  }
}

export default function DeleteCandidatesPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['delete-candidates'],
    queryFn: () => deleteCandidates.list(true),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['delete-candidates'] });
  const confirmMut = useMutation({ mutationFn: deleteCandidates.confirmDelete, onSuccess: invalidate });
  const keepMut = useMutation({ mutationFn: deleteCandidates.keepArchived, onSuccess: invalidate });
  const snoozeMut = useMutation({ mutationFn: (itemId: string) => deleteCandidates.snooze(itemId, 30), onSuccess: invalidate });
  const suppressMut = useMutation({ mutationFn: deleteCandidates.suppress, onSuccess: invalidate });

  const busy = confirmMut.isPending || keepMut.isPending || snoozeMut.isPending || suppressMut.isPending;
  const err = q.error || confirmMut.error || keepMut.error || snoozeMut.error || suppressMut.error;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: '0 0 16px', fontSize: 24 }}>处置队列</h1>
      {err && <Alert type="error" message={err instanceof Error ? err.message : String(err)} />}
      {q.isLoading ? <LoadingSpinner /> : (
        <div style={{ display: 'grid', gap: 12 }}>
          {(q.data?.candidates || []).length === 0 && (
            <div style={emptyStyle}>暂无需要处置的已归档媒体。</div>
          )}
          {(q.data?.candidates || []).map((candidate) => (
            <div key={candidate.itemId} style={rowStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{candidate.itemName || candidate.itemId}</div>
                <div style={metaStyle}>
                  <span>状态：{statusLabel(candidate.candidateStatus)}</span>
                  <span>归档时间：{fmtDate(candidate.archivedAt)}</span>
                  <span>命中：{candidate.matchedRule?.ruleName || candidate.eligibilityReason || '-'}</span>
                  {candidate.matchedRule && <span>评分：{candidate.matchedRule.rating ?? '-'}</span>}
                  {candidate.taskId && <span>任务：{candidate.taskId}</span>}
                </div>
              </div>
              <div style={actionsStyle}>
                <button style={dangerBtn} disabled={busy || candidate.candidateStatus === 'deleted'} onClick={() => confirmMut.mutate(candidate.itemId)}>确认删除</button>
                <button style={btn} disabled={busy} onClick={() => keepMut.mutate(candidate.itemId)}>继续归档</button>
                <button style={btn} disabled={busy} onClick={() => snoozeMut.mutate(candidate.itemId)}>延后</button>
                <button style={btn} disabled={busy} onClick={() => suppressMut.mutate(candidate.itemId)}>不再建议</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 16,
  alignItems: 'center',
  padding: 16,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#fff',
};

const metaStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px 14px',
  color: '#5f6b7a',
  fontSize: 13,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const btn: React.CSSProperties = {
  border: '1px solid #d1d5db',
  background: '#fff',
  borderRadius: 6,
  padding: '8px 10px',
  cursor: 'pointer',
};

const dangerBtn: React.CSSProperties = {
  ...btn,
  borderColor: '#dc2626',
  color: '#b91c1c',
};

const emptyStyle: React.CSSProperties = {
  border: '1px dashed #d1d5db',
  borderRadius: 8,
  padding: 20,
  color: '#5f6b7a',
  background: '#fff',
};
