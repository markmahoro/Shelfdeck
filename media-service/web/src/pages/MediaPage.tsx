import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { helixLibrary, libraryApi, subLibraries } from '../api/client';
import { Button, Diagnostic, Dialog, Drawer, EmptyState, Field, Loading, Page, PageHeader, Status, Toast } from '../components/ui';

type MediaItem = Record<string, any>;

function sourceState(item: MediaItem) {
  return item.helix?.source?.readiness || item.sourceProjection?.readiness || 'unknown';
}

const directionLabels: Record<string, string> = {
  none: '无需优化',
  transcode: '转码优化',
  upgrade: '洗版升级',
  undetermined: '待判断',
  blocked: '无法规划',
};

function targetSummary(maintenance: MediaItem) {
  const target = maintenance.maintenanceTargetSummary || {};
  const parts = [target.qualityTier, target.targetCodec, target.targetBitrateMbps ? `${target.targetBitrateMbps} Mbps` : '', target.maxSizeGB ? `≤ ${target.maxSizeGB} GB` : ''].filter(Boolean);
  return parts.join(' · ') || '尚未形成维护目标';
}

export default function MediaPage() {
  const pageSize = 50;
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [libraryId, setLibraryId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const libraries = useQuery({ queryKey: ['library-identities'], queryFn: libraryApi.getStatus });
  const media = useQuery({
    queryKey: ['media', libraryId, search, page],
    queryFn: () => libraryApi.getCache({
      subLibraryId: libraryId || undefined,
      search: search || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      projection: 'manage',
    }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['media'] });
  const completed = (message: string) => { setToast(message); setSelected(null); refresh(); };
  const startMaintenance = useMutation({ mutationFn: (itemId: string) => helixLibrary.startMaintenance(itemId), onSuccess: () => completed('维护已开始'), onError: (error) => setToast(error.message) });
  const prioritize = useMutation({ mutationFn: (itemId: string) => helixLibrary.prioritizeMaintenance(itemId), onSuccess: () => completed('已优先维护'), onError: (error) => setToast(error.message) });
  const cancelPriority = useMutation({ mutationFn: (itemId: string) => helixLibrary.cancelMaintenancePriority(itemId), onSuccess: () => completed('已取消优先'), onError: (error) => setToast(error.message) });
  const observe = useMutation({ mutationFn: (subLibraryId: string) => subLibraries.observe(subLibraryId), onSuccess: () => setToast('已开始重新观察'), onError: (error) => setToast(error.message) });
  const stop = useMutation({ mutationFn: (item: MediaItem) => helixLibrary.offboard(item.itemId, { idempotencyKey: `stop-media:${item.itemId}:${Date.now()}`, cleanupMode: 'retain_source', reason: 'admin_stop_management' }), onSuccess: () => { setToast('已停止管理'); setSelected(null); refresh(); }, onError: (error) => setToast(error.message) });
  const updateRating = useMutation({ mutationFn: ({ itemId, rating }: { itemId: string; rating: number | null }) => libraryApi.patchPerception(itemId, rating), onSuccess: (_, variables) => { setSelected((current) => current ? { ...current, userRating: variables.rating, helix: { ...current.helix, maintenance: { ...current.helix?.maintenance, userPerceptionFacts: { ...current.helix?.maintenance?.userPerceptionFacts, userRating: variables.rating } } } } : current); refresh(); setToast('用户评分已保存'); }, onError: (error) => setToast(error.message) });
  if (media.isLoading || libraries.isLoading) return <Page><Loading /></Page>;

  const items = (media.data?.items || []) as MediaItem[];
  const total = Number(media.data?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedMaintenance = selected?.helix?.maintenance || {};
  const selectedComplete = !!(selected?.maintenanceComplete || selectedMaintenance.maintenanceComplete);
  const selectedPriority = selectedMaintenance.priority?.class || 'normal';
  const selectedRun = selectedMaintenance.run;
  const selectedLibrary = (libraries.data?.subLibraries || []).find((entry) => entry.uuid === selected?.subLibraryId);
  const automatic = selectedLibrary?.maintenanceAutomationMode === 'auto';
  const eligible = !!selected
    && selected.helix?.membership?.status !== 'closed'
    && selected.helix?.quarantine?.status === 'none'
    && !selectedComplete
    && selectedRun?.status !== 'blocked';

  return <Page>
    <PageHeader title="媒体" meta={`${total} 个条目`} />
    <div className="toolbar"><input className="input search" placeholder="搜索标题" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><select className="select filter-wide" value={libraryId} onChange={(event) => { setLibraryId(event.target.value); setPage(1); }}><option value="">全部媒体库</option>{(libraries.data?.subLibraries || []).map((library) => <option key={library.uuid} value={library.uuid}>{library.name}</option>)}</select></div>
    {items.length === 0 ? <section className="panel"><EmptyState title="没有匹配的媒体" /></section> : <section className="panel table-wrap"><table className="table responsive"><thead><tr><th>媒体</th><th>媒体库</th><th>来源</th><th>维护方向</th><th>维护状态</th><th></th></tr></thead><tbody>{items.map((item) => {
      const complete = !!(item.maintenanceComplete || item.helix?.maintenance?.maintenanceComplete);
      const source = sourceState(item);
      const expedited = item.helix?.maintenance?.priority?.class === 'expedited';
      const maintenance = item.helix?.maintenance || {};
      return <tr key={item.itemId}>
        <td data-label="媒体"><div className="person-cell">{item.imageUrl ? <img className="poster" src={item.imageUrl} alt="" /> : <div className="poster" />}<div><div className="table-main">{item.name || item.title || item.itemId}</div><div className="table-sub">{item.type || item.mediaType || ''}</div></div></div></td>
        <td data-label="媒体库">{(libraries.data?.subLibraries || []).find((library) => library.uuid === item.subLibraryId)?.name || item.subLibraryId || '-'}</td>
        <td data-label="来源"><Status tone={source === 'ready' ? 'success' : source === 'missing' || source === 'destroyed' ? 'danger' : 'neutral'}>{source === 'ready' ? '可用' : source === 'missing' ? '不可用' : source === 'destroyed' ? '已删除' : '观察中'}</Status></td>
        <td data-label="维护方向"><Status tone={maintenance.optimizationDirection === 'blocked' ? 'danger' : maintenance.optimizationDirection === 'undetermined' ? 'neutral' : 'success'}>{directionLabels[maintenance.optimizationDirection] || '待判断'}</Status></td>
        <td data-label="维护状态"><div className="page-actions"><Status tone={complete ? 'success' : 'attention'}>{complete ? '维护完成' : '维护中'}</Status>{expedited && <Status tone="attention">优先</Status>}</div></td>
        <td><Button variant="quiet" onClick={() => setSelected(item)}>查看</Button></td>
      </tr>;
    })}</tbody></table>{total > pageSize && <div className="page-actions"><Button variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button><span className="muted">{page} / {totalPages}</span><Button variant="quiet" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</Button></div>}</section>}
    <Drawer open={!!selected} title={selected?.name || selected?.title || '媒体详情'} onClose={() => setSelected(null)}>{selected && <div className="stack">
      <div className="grid-2"><div><div className="field-label">管理状态</div><p>{selected.helix?.membership?.status === 'closed' ? '已停止管理' : '正在管理'}</p></div><div><div className="field-label">维护状态</div><p>{selectedComplete ? '维护完成' : '维护中'}</p></div></div>
      <div className="grid-2"><div><div className="field-label">预计维护方向</div><p>{directionLabels[selectedMaintenance.optimizationDirection] || '待判断'}</p></div><div><div className="field-label">维护目标</div><p>{targetSummary(selectedMaintenance)}</p></div></div>
      {selectedMaintenance.plannedWorkflowClassification && <div><div className="field-label">实际执行方式</div><p>{directionLabels[selectedMaintenance.optimizationDirection] || selectedMaintenance.plannedWorkflowClassification}</p></div>}
      <Field label="我的评分"><select className="select" value={selectedMaintenance.userPerceptionFacts?.userRating ?? ''} onChange={(event) => updateRating.mutate({ itemId: selected.itemId, rating: event.target.value ? Number(event.target.value) : null })}><option value="">未评分</option><option value="1">1 星</option><option value="2">2 星</option><option value="3">3 星</option><option value="4">4 星</option><option value="5">5 星</option></select></Field>
      <section><div className="field-label">维护进度</div><div className="page-actions field-actions"><Status tone={selectedMaintenance.basedataPassed ? 'success' : selectedMaintenance.basedataGate?.status === 'blocked' ? 'danger' : 'neutral'}>{selectedMaintenance.basedataGate?.status === 'blocked' ? '基础信息缺失' : '基础信息'}</Status><Status tone={selectedMaintenance.metadataPassed ? 'success' : selectedMaintenance.metadataGate?.status === 'blocked' ? 'danger' : 'neutral'}>{selectedMaintenance.metadataGate?.status === 'blocked' ? '元数据不可用' : '元数据'}</Status><Status tone={selectedMaintenance.optimizePassed ? 'success' : selectedMaintenance.optimizeGate?.status === 'blocked' ? 'danger' : 'neutral'}>{selectedMaintenance.optimizeGate?.status === 'blocked' ? '无法规划优化' : '优化'}</Status>{selectedPriority === 'expedited' && <Status tone="attention">优先维护</Status>}</div></section>
      <section><div className="field-label">操作</div><div className="page-actions field-actions">
        {eligible && !automatic && !selectedRun && <Button onClick={() => startMaintenance.mutate(selected.itemId)}>开始维护</Button>}
        {eligible && (automatic || !!selectedRun) && selectedPriority !== 'expedited' && <Button onClick={() => prioritize.mutate(selected.itemId)}>优先维护</Button>}
        {eligible && selectedPriority === 'expedited' && <Button variant="quiet" onClick={() => cancelPriority.mutate(selected.itemId)}>取消优先</Button>}
        <Button icon="refresh" onClick={() => observe.mutate(selected.subLibraryId)}>重新观察</Button>
        <Button variant="danger" onClick={() => setStopOpen(true)}>停止管理</Button>
      </div></section>
      <Diagnostic value={selected} />
    </div>}</Drawer>
    <Dialog open={stopOpen && !!selected} title="停止管理媒体" onClose={() => setStopOpen(false)} actions={<><Button onClick={() => setStopOpen(false)}>取消</Button><Button variant="primary" onClick={() => { if (selected) stop.mutate(selected); setStopOpen(false); }}>停止管理</Button></>}><p>{selected?.name || selected?.title}</p><Status tone="neutral">媒体文件和来源关联保持不变</Status></Dialog>
    <Toast message={toast} />
  </Page>;
}
