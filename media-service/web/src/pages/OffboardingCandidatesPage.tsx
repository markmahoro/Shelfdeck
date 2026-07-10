import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { helixLibrary, offboardingCandidates } from '../api/client';
import type { HelixCleanupMode, OffboardingCandidate } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

export default function OffboardingCandidatesPage() {
  const qc = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const query = useQuery({ queryKey: ['offboarding-candidates'], queryFn: offboardingCandidates.list });
  const offboard = useMutation({
    mutationFn: ({ candidate, cleanupMode }: { candidate: OffboardingCandidate; cleanupMode: HelixCleanupMode }) => helixLibrary.offboard(candidate.itemId, {
      idempotencyKey: crypto.randomUUID(),
      cleanupMode,
      reason: candidate.recommendation.reason || 'kairox_disposal_recommendation',
      destructiveAuthorization: cleanupMode === 'delete_source',
    }),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ['offboarding-candidates'] });
      setAlert({ type: 'success', msg: input.cleanupMode === 'retain_source' ? '已退出管理并保留 source。' : input.cleanupMode === 'detach_source' ? '已解绑 source 并退出管理。' : '已按明确授权删除 source 并退出管理。' });
    },
    onError: (error: Error) => setAlert({ type: 'error', msg: error.message }),
  });
  function request(candidate: OffboardingCandidate, cleanupMode: HelixCleanupMode) {
    const destructive = cleanupMode === 'delete_source';
    if (!confirm(destructive ? `确认物理删除「${candidate.itemName}」的 source？此操作不可撤销。` : `确认将「${candidate.itemName}」退出 ShelfDeck 管理？`)) return;
    offboard.mutate({ candidate, cleanupMode });
  }
  if (query.isLoading) return <LoadingSpinner text="加载退出管理建议..." />;
  return <main style={{ padding: 24 }}>
    <h1 style={{ margin: '0 0 8px' }}>退出管理建议</h1>
    <p style={{ color: '#64748b' }}>Kairox 只提供中性的处置建议；所有退出与 source cleanup 都由 Libra 协调 Nexora 执行。</p>
    {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}
    {query.error && <Alert type="error" message={(query.error as Error).message} />}
    <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
      {(query.data?.candidates || []).map((candidate) => <article key={candidate.itemId} style={card}>
        <div><strong>{candidate.itemName}</strong><div style={muted}>{candidate.recommendation.reason || 'Kairox 建议复核是否继续管理'}</div></div>
        <div style={actions}>
          <button disabled={offboard.isPending} onClick={() => request(candidate, 'retain_source')}>保留 source 并退出</button>
          <button disabled={offboard.isPending} onClick={() => request(candidate, 'detach_source')}>解绑 source 并退出</button>
          <button disabled={offboard.isPending} style={danger} onClick={() => request(candidate, 'delete_source')}>删除 source 并退出</button>
        </div>
      </article>)}
      {(query.data?.candidates || []).length === 0 && <div style={empty}>当前没有退出管理建议。</div>}
    </div>
  </main>;
}

const card = { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 };
const muted = { color: '#64748b', fontSize: 12, marginTop: 6 };
const actions = { display: 'flex', flexWrap: 'wrap' as const, gap: 8 };
const danger = { color: '#b91c1c', borderColor: '#fecaca' };
const empty = { padding: 28, textAlign: 'center' as const, color: '#64748b', background: '#fff', borderRadius: 8 };
