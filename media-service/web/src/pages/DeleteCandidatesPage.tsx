import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteCandidates, helixLibrary } from '../api/client';
import type { HelixCleanupMode } from '../api/client';
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
    onSuccess: () => { invalidate(); setAlert({ type: 'success', msg: '已由 Libra 完成退出管理与显式 source 删除。' }); },
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
  const offboardMut = useMutation({
    mutationFn: async ({ itemId, cleanupMode }: { itemId: string; cleanupMode: Exclude<HelixCleanupMode, 'delete_source'> }) => {
      await helixLibrary.offboard(itemId, {
        idempotencyKey: crypto.randomUUID(),
        cleanupMode,
        reason: 'delete_candidate_library_offboarding',
      });
      await deleteCandidates.suppress(itemId);
    },
    onSuccess: (_, input) => {
      invalidate();
      setAlert({ type: 'success', msg: input.cleanupMode === 'retain_source' ? '已退出 ShelfDeck 管理，source 保持不变。' : '已解绑 source 并退出 ShelfDeck 管理。' });
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const views = useMemo(() => (q.data?.candidates || []).map(toKairoxDeleteCandidateView), [q.data?.candidates]);
  const counts = useMemo(() => views.reduce<Record<string, number>>((acc, view) => {
    acc[view.status] = (acc[view.status] || 0) + 1;
    return acc;
  }, {}), [views]);
  const visible = views.filter((view) => view.status === tab);
  const busy = confirmMut.isPending || keepMut.isPending || snoozeMut.isPending || suppressMut.isPending || offboardMut.isPending;

  function confirmDelete(view: KairoxDeleteCandidateView) {
    const ok = confirm(`确认将「${view.title}」退出 ShelfDeck 管理并删除 source？\n\nLibra 会先撤销 Kairox admission、等待维护停止，再由 Nexora 执行显式 source 删除。`);
    if (ok) confirmMut.mutate(view.itemId);
  }

  return (
    <div className="kairoxDeletePage">
      <div className="kairoxDeleteHeader">
        <div>
          <h1>处置队列</h1>
          <p>这里处理已归档媒体的处置建议。删除确认会进入 Libra offboarding，不再创建 Kairox delete task。</p>
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
                  {view.taskId && <span>历史删除任务：{view.taskId}</span>}
                </div>
                <div className="kairoxDeleteReason">{view.reason}</div>
              </div>
              <div className="kairoxDeleteActions">
                {canReview(view) && <button disabled={busy} onClick={() => offboardMut.mutate({ itemId: view.itemId, cleanupMode: 'retain_source' })}>仅退出管理</button>}
                {canReview(view) && <button disabled={busy} onClick={() => offboardMut.mutate({ itemId: view.itemId, cleanupMode: 'detach_source' })}>解绑并退出</button>}
                {canConfirmDelete(view) && <button className="danger" disabled={busy} onClick={() => confirmDelete(view)}>退出并删除 source</button>}
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
