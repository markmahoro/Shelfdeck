import { useQuery } from '@tanstack/react-query';
import { resources } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

export default function ResourceViewPage() {
  const query = useQuery({ queryKey: ['helix-resource-view'], queryFn: () => resources.get({ detail: 'full' }), refetchInterval: 5000 });
  if (query.isLoading) return <LoadingSpinner text="加载 Resource Governor..." />;
  if (query.error) return <Alert type="error" message={(query.error as Error).message} />;
  const data = query.data;
  return <div style={{ padding: 24 }}>
    <h2 style={{ margin: '0 0 8px' }}>资源与背压</h2>
    <p style={{ color: '#64748b' }}>Scheduler 只负责顺序与派发；容量、等待和 permit 统一来自 Helix Resource Governor。</p>
    <section style={metrics}>
      <Metric label="运行任务" value={data?.summary.byState.running || 0} />
      <Metric label="等待资源" value={data?.summary.byState.waiting || 0} />
      <Metric label="业务阻塞" value={data?.summary.byState.blocked || 0} />
      <Metric label="运行事件" value={data?.summary.runningEvents || 0} />
    </section>
    <div style={{ display: 'grid', gap: 10 }}>
      {(data?.governor?.resources || []).map((resource) => <article key={resource.resourceKey} style={card}>
        <div><strong>{resource.resourceKey}</strong></div>
        <div style={facts}><span>容量 {resource.capacity}</span><span>占用 {resource.active}</span><span>等待 {resource.waiting}</span></div>
      </article>)}
    </div>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div style={metric}><span style={{ color: '#64748b', fontSize: 12 }}>{label}</span><strong style={{ fontSize: 24 }}>{value}</strong></div>;
}

const metrics = { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(120px,1fr))', gap: 10, margin: '18px 0' };
const metric = { display: 'grid', gap: 6, padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 };
const card = { display: 'flex', justifyContent: 'space-between', padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 };
const facts = { display: 'flex', gap: 18, color: '#475569', fontSize: 13 };
