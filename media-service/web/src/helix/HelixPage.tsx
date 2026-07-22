import type { SurfacePage } from './surface-model';

export default function HelixPage({page}:{page:SurfacePage}) {
  return <div className="surface-page">
    <header className="surface-header"><div><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1><p className="lede">{page.description}</p></div>{page.primaryAction && <button className="surface-action" type="button">{page.primaryAction}</button>}</header>
    <section className="metric-strip" aria-label={`${page.label}摘要`}>{page.metrics.map((metric)=><article key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></article>)}</section>
    <section className="ledger-panel" aria-labelledby={`${page.slug}-ledger`}><div className="ledger-heading"><div><p className="eyebrow">业务履历</p><h2 id={`${page.slug}-ledger`}>当前可证明的进展</h2></div><span className="freshness">Fresh · 刚刚更新</span></div><ol>{page.ledger.map((item,index)=><li key={item}><span>{String(index+1).padStart(2,'0')}</span><p>{item}</p><em>{index===page.ledger.length-1?'当前':'已记录'}</em></li>)}</ol></section>
    <aside className="attention-note"><strong>需要处理</strong><p>危险操作只会在 fresh Projection 提供精确 Scope 后出现；页面不会自行推断可执行动作。</p></aside>
  </div>;
}

