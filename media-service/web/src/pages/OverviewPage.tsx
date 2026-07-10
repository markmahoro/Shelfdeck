import { useQuery } from '@tanstack/react-query';
import { dashboardHealth, spaceStats, subLibraries } from '../api/client';
import { Loading, Metric, Page, PageHeader, Panel, Status } from '../components/ui';

function bytes(value: number) {
  if (!value) return '0 GB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export default function OverviewPage() {
  const health = useQuery({ queryKey: ['overview-health'], queryFn: dashboardHealth.get, refetchInterval: 15_000 });
  const space = useQuery({ queryKey: ['overview-space'], queryFn: spaceStats.get, refetchInterval: 60_000 });
  const libraries = useQuery({ queryKey: ['overview-libraries'], queryFn: subLibraries.list });
  if (health.isLoading || space.isLoading || libraries.isLoading) return <Page><Loading /></Page>;

  const summary = health.data;
  const noConfiguration = (libraries.data?.subLibraries || []).length === 0;
  const fault = summary?.status === 'red';
  const state = noConfiguration ? '尚未配置' : fault ? '系统故障' : '系统运行正常';
  const media = summary?.media;
  const total = Number(media?.openItems ?? media?.totalItems ?? 0);
  const completed = Number(media?.maintenanceCompleteItems || 0);
  const metadataReady = Math.max(0, Number(media?.totalItems || 0) - Number(media?.metadataIncompleteItems || 0));
  const realized = Number(space.data?.realizedReclaimedBytes || 0);
  const reclaimable = Number(space.data?.reclaimableBytes || 0);

  return <Page>
    <PageHeader title="概览" meta={summary?.generatedAt ? `更新于 ${new Date(summary.generatedAt).toLocaleTimeString()}` : undefined} />
    <section className="ledger">
      <div className="ledger-head">
        <div className="ledger-state"><span className={`ledger-state-dot ${noConfiguration ? 'unconfigured' : fault ? 'fault' : ''}`} />{state}</div>
        <div className="ledger-saving"><div className="ledger-saving-label">累计节省空间</div><div className="ledger-saving-value">{bytes(realized)}</div></div>
      </div>
      <div className="ledger-metrics">
        <Metric label="管理媒体" value={total.toLocaleString()} />
        <Metric label="维护完成" value={completed.toLocaleString()} note={total ? `${Math.round(completed / total * 100)}%` : '0%'} />
        <Metric label="元数据就绪" value={metadataReady.toLocaleString()} />
        <Metric label="仍可节省" value={bytes(reclaimable)} />
      </div>
    </section>
    <div className="grid-2 section-gap">
      <Panel title="自动管理">
        <div className="stack">
          <div className="summary-row"><span>媒体库</span><Status tone="success">{(libraries.data?.subLibraries || []).filter((item) => item.libraryAutomationMode === 'auto').length} 个自动管理</Status></div>
          <div className="summary-row"><span>媒体维护</span><Status tone="success">{(libraries.data?.subLibraries || []).filter((item) => item.maintenanceAutomationMode === 'auto').length} 个自动维护</Status></div>
        </div>
      </Panel>
      <Panel title="维护成果">
        <div className="grid-2"><Metric label="已优化媒体" value={Number(space.data?.optimize?.itemCount || 0).toLocaleString()} /><Metric label="媒体库" value={(libraries.data?.subLibraries || []).length} /></div>
      </Panel>
    </div>
  </Page>;
}
