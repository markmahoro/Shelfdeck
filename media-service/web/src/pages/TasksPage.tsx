import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { automation, libraryApi, tasks } from '../api/client';
import { Button, Diagnostic, Drawer, EmptyState, Loading, Page, PageHeader, Status, Tabs, Toast } from '../components/ui';

type Row = Record<string, any>;
const taskStates: Record<string, { label: string; tone: 'success' | 'attention' | 'neutral' }> = {
  done: { label: '已完成', tone: 'success' },
  awaiting_user_confirm: { label: '等待确认', tone: 'attention' },
  awaiting_confirmation: { label: '等待确认', tone: 'attention' },
  waiting_for_resource: { label: '排队中', tone: 'neutral' },
  queued: { label: '排队中', tone: 'neutral' },
  executing: { label: '执行中', tone: 'attention' },
  running: { label: '执行中', tone: 'attention' },
  created: { label: '准备中', tone: 'neutral' },
  pending: { label: '排队中', tone: 'neutral' },
  retrying: { label: '正在恢复', tone: 'neutral' },
};
function gate(value: string) { return value === 'basedata' ? '基础信息' : value === 'metadata' ? '元数据' : value === 'optimize' ? '优化' : value || '媒体库工作'; }
function internalIdentifier(value: unknown) { return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(value || '')); }

export default function TasksPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('running');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Row | null>(null);
  const [toast, setToast] = useState('');
  const statuses = tab === 'running' ? ['created', 'queued', 'executing', 'running', 'waiting_for_resource'] : tab === 'confirmation' ? ['awaiting_user_confirm', 'awaiting_confirmation'] : ['done'];
  const taskQuery = useQuery({ queryKey: ['task-center', tab, page], queryFn: () => tasks.list({ statuses, page, pageSize: 20, includeAttentionSummary: false }), refetchInterval: tab === 'completed' ? 30_000 : 5_000 });
  const workQuery = useQuery({ queryKey: ['library-work-center'], queryFn: automation.get, refetchInterval: 5_000 });
  const libraryQuery = useQuery({ queryKey: ['library-identities'], queryFn: libraryApi.getStatus });
  const confirmTask = useMutation({ mutationFn: (id: string) => tasks.confirm(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['task-center'] }); setToast('任务已继续'); }, onError: (error) => setToast(error.message) });
  if (taskQuery.isLoading || workQuery.isLoading || libraryQuery.isLoading) return <Page><Loading /></Page>;
  const maintenance = ((taskQuery.data as any)?.tasks || []) as Row[];
  const works = ((workQuery.data?.libraryAutomation?.works || []) as Row[]).filter((work) => tab === 'running' ? ['pending', 'running', 'retrying'].includes(String(work.status)) : tab === 'completed' ? work.status === 'done' : false);
  const libraryNames = new Map((libraryQuery.data?.subLibraries || []).map((library) => [library.uuid, library.name]));
  const workTitle = (work: Row) => work.workKind === 'observe_library'
    ? `观察${libraryNames.get(work.subLibraryId) ? `「${libraryNames.get(work.subLibraryId)}」` : '媒体库'}`
    : work.workKind === 'sync_user_perception'
      ? `同步${libraryNames.get(work.subLibraryId) ? `「${libraryNames.get(work.subLibraryId)}」` : ''}用户偏好`
      : '协调媒体状态';
  const rows: Row[] = [...works.map((work) => ({ ...work, rowKind: 'library', title: workTitle(work), subtitle: libraryNames.get(work.subLibraryId) || '' })), ...maintenance.map((task) => {
    const candidate = task.itemName || task.itemInfo?.name || '';
    return { ...task, rowKind: 'maintenance', title: candidate && !internalIdentifier(candidate) ? candidate : '媒体维护', subtitle: libraryNames.get(task.itemInfo?.subLibraryId) || '' };
  })];
  const taskTotal = Number((taskQuery.data as any)?.total || 0);
  const totalPages = Math.max(1, Math.ceil(taskTotal / 20));
  return <Page>
    <PageHeader title="任务中心" meta={`${taskTotal + works.length} 项`} />
    <Tabs value={tab} onChange={(value) => { setTab(value); setPage(1); }} items={[{ key: 'running', label: '运行中' }, { key: 'confirmation', label: '等待确认' }, { key: 'completed', label: '已完成' }]} />
    {rows.length === 0 ? <section className="panel"><EmptyState title={tab === 'confirmation' ? '没有需要确认的任务' : tab === 'completed' ? '暂无完成记录' : '当前没有运行任务'} /></section> : <section className="panel table-wrap"><table className="table responsive"><thead><tr><th>工作</th><th>类型</th><th>状态</th><th>更新时间</th><th></th></tr></thead><tbody>{rows.map((row) => {
      const status = taskStates[String(row.status)] || { label: row.status || '运行中', tone: 'neutral' as const };
      const targetGate = row.taskTarget?.targetGate || row.targetGate || row.flowPlan?.bridgeKind || '';
      return <tr key={row.id || row.workId}>
        <td data-label="工作"><div className="table-main">{row.title}</div>{row.subtitle && <div className="table-sub">{row.subtitle}</div>}</td>
        <td data-label="类型">{row.rowKind === 'library' ? '媒体库管理' : gate(targetGate)}</td>
        <td data-label="状态"><Status tone={status.tone}>{status.label}</Status></td>
        <td data-label="更新时间">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'}</td>
        <td><div className="page-actions">{tab === 'confirmation' && row.rowKind === 'maintenance' && <Button variant="primary" onClick={() => confirmTask.mutate(row.id)}>确认继续</Button>}<Button variant="quiet" onClick={() => setSelected(row)}>查看</Button></div></td>
      </tr>;
    })}</tbody></table>{taskTotal > 20 && <div className="page-actions"><Button variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button><span className="muted">{page} / {totalPages}</span><Button variant="quiet" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</Button></div>}</section>}
    <Drawer open={!!selected} title={selected?.title || '任务详情'} onClose={() => setSelected(null)}>{selected && <div className="stack"><div className="grid-2"><div><div className="field-label">状态</div><p>{taskStates[String(selected.status)]?.label || selected.status}</p></div><div><div className="field-label">类型</div><p>{selected.rowKind === 'library' ? '媒体库管理' : gate(selected.taskTarget?.targetGate || selected.targetGate)}</p></div></div><Diagnostic value={selected} /></div>}</Drawer>
    <Toast message={toast} />
  </Page>;
}
