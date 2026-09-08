import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { helixAdminApi } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { isUnauthorized, useSession } from './session';

const ORGANIZING_PREFIX = '正在整理 · ';

export default function OverviewPage() {
  const { expire } = useSession();
  const { data: projection, error, isFetching, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: () => helixAdminApi.getOverview(),
    refetchInterval: 30_000,
  });
  const unauthorized = Boolean(error && isUnauthorized(error));
  useEffect(() => {
    if (unauthorized) expire();
  }, [expire, unauthorized]);
  if (unauthorized) return <LoadingState>正在读取概览…</LoadingState>;
  const load = () => { void refetch(); };
  const loading = isFetching;
  const fieldAccessAttention = projection?.systemState.kind !== 'faulted' && Boolean(projection?.todos.some((item) => item.key === 'field_access'));
  const stateKind = !projection ? 'running' : projection.systemState.kind === 'faulted' ? 'faulted' : fieldAccessAttention ? 'attention' : projection.systemState.kind;
  const compactStatus = stateKind === 'running';
  const stateNote = !projection ? '' : projection.systemState.kind === 'unconfigured' ? '先配置文件来源和收藏架'
    : projection.systemState.kind === 'faulted' ? '服务当前不可用，需要处理故障'
    : fieldAccessAttention ? '有文件来源目录不可用，先到来源配置处理'
    : '';
  const background = projection?.backgroundOperations;
  const backgroundLabels = { waiting_first_check:'等待首次检查', waiting_business_time:'等待业务时间', running:'检查中', normal:'正常', attention:'需要留意', stopped:'已停止' } as const;
  const domainLabels:Record<string,string> = { procurement:'文件来源', libra:'媒体整理', arca:'收藏管理', people:'人物', perception:'信息更新' };
  const checklistLabels:Record<string,string> = { 'active-material-fields':'文件观察', 'periodic-douban-acquisitions':'豆瓣评分',
    'ondeck-person-evidence':'人物信息', 'completed-workspace-reclamation':'整理空间回收',
    'active-workspace-cleanup-scopes':'整理空间清理', 'due-aftercare-shelf-entries':'收藏维护',
    'aftercare-workspace-lifecycle':'维护空间回收' };
  const resultLabels = { failed:'检查失败', not_due:'尚未到期', no_pending:'没有待处理项', processed:'已处理' } as const;
  const checkedAt = background?.lastCompletedAtMs ? new Date(background.lastCompletedAtMs).toLocaleString('zh-CN') : '尚未完成首次检查';
  const firstProblem = background?.registrations.find((item) => item.state === 'attention');
  const organizing = projection?.ledger.filter((item) => item.label.startsWith(ORGANIZING_PREFIX)) || [];
  const recent = projection?.ledger.filter((item) => !item.label.startsWith(ORGANIZING_PREFIX)) || [];
  if (!projection && !error) return <LoadingState>正在读取概览…</LoadingState>;
  return <div className="source-page">
    <PageHeader title="概览" actions={<Button variant="secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>} />
    {error && <p className="form-error" role="alert">{error instanceof Error ? error.message : '概览读取失败。'}</p>}
    {projection && <>
      <div className="overview-status-row" data-kind={stateKind}>
        {compactStatus
          ? <Link className="system-state-word" to={projection.systemState.href}>{projection.systemState.label}</Link>
          : <Link className="system-state" data-kind={stateKind} to={projection.systemState.href}>
              <span>系统状态</span>
              <strong>{fieldAccessAttention ? '需要你处理' : projection.systemState.label}</strong>
              {stateNote ? <small>{stateNote}</small> : null}
            </Link>}
        {background && <details className="background-status" data-kind={background.state}>
          <summary>后台检查 · {backgroundLabels[background.state]}</summary>
          {firstProblem && <p role="status">{domainLabels[firstProblem.ownerDomain] || firstProblem.ownerDomain}检查遇到问题，系统会自动重试。</p>}
          <p className="background-status-checked">最近检查 {checkedAt}</p>
          <div className="background-status-detail">{background.registrations.map((item) => <div key={`${item.ownerDomain}:${item.reconcilerKey}`}>
            <span>{checklistLabels[item.reconcilerKey] || domainLabels[item.ownerDomain] || item.ownerDomain}</span>
            <em>{backgroundLabels[item.state]}</em>
            <small>{item.lastCompletedAtMs ? new Date(item.lastCompletedAtMs).toLocaleString('zh-CN') : '尚未检查'}</small>
            <small>{item.lastResultKind ? `${resultLabels[item.lastResultKind]}${item.lastResultKind === 'processed' ? ` ${item.processed} 项` : ''}` : '等待结果'}</small>
          </div>)}</div>
        </details>}
      </div>
      <section className="metric-strip metric-strip-thin" aria-label="收藏成果">{projection.metrics.map((metric) => <Link key={metric.key} to={metric.href || '/collection'}><article><span>{metric.label}</span><strong>{metric.value.toLocaleString()}</strong></article></Link>)}</section>
      <div className="overview-workbench">
        <section className="ledger-panel" aria-labelledby="overview-todos">
          <div className="ledger-heading"><h2 id="overview-todos">需要你处理</h2></div>
          {projection.todos.length
            ? <div className="todo-list">{projection.todos.map((item) => <Link key={item.key} to={item.href}><span>{item.label}</span><em>{item.count}</em></Link>)}</div>
            : <p className="overview-empty-line">现在没有需要你处理的事项</p>}
          {(projection.pipeline.waitingAcceptanceCount > 0 || projection.pipeline.organizingCount > 0) && <div className="overview-in-progress">
            {projection.pipeline.waitingAcceptanceCount > 0 && <h3><Link to="/material-fields">等待进入整理 {projection.pipeline.waitingAcceptanceCount} 包</Link></h3>}
            {projection.pipeline.organizingCount > 0 && <h3><Link to="/formation">正在整理 {projection.pipeline.organizingCount} 部</Link></h3>}
            {organizing.length ? <ul>{organizing.map((item) => <li key={item.key}>{item.href
              ? <Link to={item.href}>{item.label.slice(ORGANIZING_PREFIX.length)}</Link>
              : item.label.slice(ORGANIZING_PREFIX.length)}</li>)}</ul> : null}
          </div>}
        </section>
        <section className="ledger-panel" aria-labelledby="overview-ledger">
          <div className="ledger-heading"><h2 id="overview-ledger">最近进展</h2></div>
          {recent.length
            ? <ol className="overview-ledger-list">{recent.map((item) => <li key={item.key}>{item.href ? <Link to={item.href}>{item.label}</Link> : <p>{item.label}</p>}</li>)}</ol>
            : <p className="overview-empty-line">还没有可展示的最近进展</p>}
        </section>
      </div>
    </>}
  </div>;
}
