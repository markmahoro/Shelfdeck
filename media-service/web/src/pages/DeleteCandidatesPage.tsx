import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteCandidates } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  DELETE_CANDIDATE_TABS,
  canConfirmDelete,
  canReview,
  toKairoxDeleteCandidateView,
} from '../kairox';
import type { DeleteCandidateTab, KairoxDeleteCandidateView } from '../kairox';
import '../deleteCandidates.css';

export default function DeleteCandidatesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<DeleteCandidateTab>('pending_review');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const q = useQuery({
    queryKey: ['delete-candidates'],
    queryFn: () => deleteCandidates.list(true),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['delete-candidates'] });
  const confirmMut = useMutation({
    mutationFn: deleteCandidates.confirmDelete,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '已创建删除执行任务，可在任务中心继续确认和跟踪。' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });
  const keepMut = useMutation({
    mutationFn: deleteCandidates.keepArchived,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '已保持为已归档，不会继续建议删除。' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });
  const snoozeMut = useMutation({
    mutationFn: (itemId: string) => deleteCandidates.snooze(itemId, 30),
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '已延后 30 天提醒。' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });
  const suppressMut = useMutation({
    mutationFn: deleteCandidates.suppress,
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '已设为不再建议。' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const views = useMemo(() => (q.data?.candidates || []).map(toKairoxDeleteCandidateView), [q.data?.candidates]);
  const counts = useMemo(() => views.reduce<Record<string, number>>((acc, view) => {
    acc[view.status] = (acc[view.status] || 0) + 1;
    return acc;
  }, {}), [views]);
  const visible = views.filter((view) => view.status === tab);
  const busy = confirmMut.isPending || keepMut.isPending || snoozeMut.isPending || suppressMut.isPending;

  function confirmDelete(view: KairoxDeleteCandidateView) {
    const ok = confirm(`确认将「${view.title}」送入删除执行任务？\n\n这一步不会绕过 TaskAdmission，也不会把删除作为 optimize；实际文件删除仍由 targetGate=delete 任务执行。`);
    if (ok) confirmMut.mutate(view.itemId);
  }

  return (
    <div className="kairoxDeletePage">
      <div className="kairoxDeleteHeader">
        <div>
          <h1>处置队列</h1>
          <p>这里处理已归档媒体的删除建议。未确认前不会创建 destructive delete 任务。</p>
        </div>
        <button onClick={() => invalidate()}>刷新</button>
      </div>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}
      {q.error && <Alert type="error" message={q.error instanceof Error ? q.error.message : String(q.error)} />}

      <div className="kairoxDeleteTabs">
        {DELETE_CANDIDATE_TABS.map((entry) => (
          <button key={entry.value} className={tab === entry.value ? 'active' : ''} onClick={() => setTab(entry.value)}>
            {entry.label}<span>{counts[entry.value] || 0}</span>
          </button>
        ))}
      </div>

      {q.isLoading ? <LoadingSpinner /> : (
        <div className="kairoxDeleteList">
          {visible.length === 0 && <div className="kairoxDeleteEmpty">当前分组没有处置候选。</div>}
          {visible.map((view) => (
            <article key={view.itemId} className="kairoxDeleteRow">
              <div className="kairoxDeleteMain">
                <div className="kairoxDeleteTitle">{view.title}</div>
                <div className="kairoxDeleteFacts">
                  <span>状态：{view.statusLabel}</span>
                  <span>归档时间：{view.archivedAt}</span>
                  <span>可处置时间：{view.eligibleAt}</span>
                  <span>命中规则：{view.rule}</span>
                  <span>评分：{view.rating}</span>
                  {view.taskId && <span>删除任务：{view.taskId}</span>}
                </div>
                <div className="kairoxDeleteReason">{view.reason}</div>
              </div>
              <div className="kairoxDeleteActions">
                {canConfirmDelete(view) && <button className="danger" disabled={busy} onClick={() => confirmDelete(view)}>确认删除</button>}
                {canReview(view) && <button disabled={busy} onClick={() => keepMut.mutate(view.itemId)}>继续已归档</button>}
                {canReview(view) && <button disabled={busy} onClick={() => snoozeMut.mutate(view.itemId)}>延后 30 天</button>}
                {canReview(view) && <button disabled={busy} onClick={() => suppressMut.mutate(view.itemId)}>不再建议</button>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
