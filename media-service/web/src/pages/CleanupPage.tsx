import { useState } from 'react';
/** Not a Helix product entry. Official Admin Web routes live in src/helix via App.tsx. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cleanupRecommendations, helixLibrary, type CleanupRecommendation, type HelixCleanupMode } from '../api/client';
import { Button, Dialog, EmptyState, Field, Loading, Page, PageHeader, Status, Toast } from '../components/ui';

const actionLabel: Record<HelixCleanupMode, string> = {
  retain_source: '不再由 ShelfDeck 管理',
  detach_source: '解除来源关联',
  delete_source: '删除媒体文件',
};

function formatBytes(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

export default function CleanupPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['cleanup-recommendations'], queryFn: cleanupRecommendations.list });
  const [selection, setSelection] = useState<{ item: CleanupRecommendation; mode: HelixCleanupMode } | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState('');
  const submit = useMutation({
    mutationFn: ({ item, mode }: { item: CleanupRecommendation; mode: HelixCleanupMode }) => helixLibrary.offboard(item.subjectId, {
      idempotencyKey: `cleanup:${item.subjectId}:${mode}:${Date.now()}`,
      cleanupMode: mode,
      reason: reason.trim() || 'cleanup_recommendation_accepted',
      destructiveAuthorization: mode === 'delete_source' ? authorized : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cleanup-recommendations'] });
      setSelection(null);
      setAuthorized(false);
      setReason('');
      setToast('操作已提交');
    },
    onError: (error) => setToast(error.message),
  });
  if (query.isLoading) return <Page><Loading /></Page>;
  const rows = query.data?.candidates || [];
  return <Page>
    <PageHeader title="清理建议" meta={`${rows.length} 条建议`} />
    {rows.length === 0 ? <section className="panel"><EmptyState title="目前没有需要处理的媒体" /></section> : <section className="panel table-wrap">
      <table className="table responsive"><thead><tr><th>媒体</th><th>建议原因</th><th>预计释放</th><th>操作</th></tr></thead><tbody>{rows.map((item) => <tr key={item.subjectId}>
        <td data-label="媒体"><div className="table-main">{item.subjectName}</div><div className="table-sub">{item.subLibraryId}</div></td>
        <td data-label="建议原因"><Status tone="attention">{String(item.recommendation.reason || '符合清理策略')}</Status></td>
        <td data-label="预计释放" className="numeric">{formatBytes(item.recommendation.estimatedBytes || item.recommendation.bytesFreed || item.recommendation.sizeBytes)}</td>
        <td data-label="操作"><div className="page-actions">{(['retain_source', 'detach_source', 'delete_source'] as HelixCleanupMode[]).map((mode) => <Button key={mode} variant={mode === 'delete_source' ? 'danger' : 'quiet'} onClick={() => { setSelection({ item, mode }); setAuthorized(false); setReason(''); }}>{actionLabel[mode]}</Button>)}</div></td>
      </tr>)}</tbody></table>
    </section>}
    <Dialog open={!!selection} title={selection ? actionLabel[selection.mode] : ''} onClose={() => setSelection(null)} actions={<><Button onClick={() => setSelection(null)}>取消</Button><Button variant={selection?.mode === 'delete_source' ? 'danger' : 'primary'} disabled={!selection || submit.isPending || (selection.mode === 'delete_source' && !authorized)} onClick={() => selection && submit.mutate(selection)}>{submit.isPending ? '提交中' : '确认操作'}</Button></>}>
      {selection && <div className="stack">
        <div><strong>{selection.item.subjectName}</strong></div>
        <Field label="操作原因"><input className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="可选" /></Field>
        {selection.mode === 'retain_source' && <Status tone="neutral">媒体文件和来源关联保持不变</Status>}
        {selection.mode === 'detach_source' && <Status tone="attention">媒体文件保留，ShelfDeck 将解除来源关联</Status>}
        {selection.mode === 'delete_source' && <label className="destructive-check"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span>我确认永久删除该媒体文件。此操作不可撤销。</span></label>}
      </div>}
    </Dialog>
    <Toast message={toast} />
  </Page>;
}
