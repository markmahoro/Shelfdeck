import { useEffect, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { systemConfig } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const DEFAULTS: Record<string, number> = {
  'control:libra': 1,
  'control:kairox': 1,
  'db:library:write': 1,
  'db:tasks:write': 1,
  'emby:*:api': 1,
  'filesystem:*': 1,
  'local:ffmpeg': 1,
  'worker:*': 1,
  'service:task': 1,
};

const ROWS = [
  ['control:libra', 'Libra 控制容量', '为入库协调和恢复保留，不与媒体优化竞争。'],
  ['control:kairox', 'Kairox 控制容量', '维护自动化扫描与 next-gate 决策容量。'],
  ['emby:*:api', '每个 Emby Server', '观察、Basedata 与 Metadata 读取共享的 API 容量。'],
  ['filesystem:*', '每个媒体卷', 'stat、probe 与文件变更共享的卷容量。'],
  ['local:ffmpeg', '本机 FFmpeg', '本机转码并发数。'],
  ['worker:*', '每个远端 Worker', '单个远端计算节点的默认容量。'],
  ['db:library:write', 'Library DB 写入', 'Libra 与 Nexora 持久化写容量。'],
  ['db:tasks:write', 'Tasks DB 写入', 'Kairox task/fact 写容量。'],
  ['service:task', '服务轻任务', '不占用媒体计算资源的执行容量。'],
] as const;

export default function ResourceCapacityPage() {
  const qc = useQueryClient();
  const [capacities, setCapacities] = useState(DEFAULTS);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const query = useQuery({ queryKey: ['resource-governor-config'], queryFn: systemConfig.get });
  useEffect(() => {
    if (query.data) setCapacities({ ...DEFAULTS, ...(query.data.resourceGovernor?.capacities || {}) });
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => systemConfig.patch({ resourceGovernor: { ...(query.data?.resourceGovernor || {}), capacities } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-governor-config'] }); setAlert({ type: 'success', msg: '全局资源容量已保存。' }); },
    onError: (error: Error) => setAlert({ type: 'error', msg: error.message }),
  });
  if (query.isLoading) return <LoadingSpinner text="加载资源容量..." />;
  return <div style={{ padding: 24 }}>
    <h1 style={title}>Helix Resource Governor</h1>
    <p style={hint}>这里只配置跨域 permit 和背压。Libra、Kairox 的业务状态仍由各自 Automation 持久化。</p>
    {alert && <Alert type={alert.type} message={alert.msg} />}
    {query.error && <Alert type="error" message={(query.error as Error).message} />}
    <section style={grid}>{ROWS.map(([key, label, description]) => <label key={key} style={card}>
      <strong>{label}</strong><span style={desc}>{description}</span>
      <input type="number" min={1} max={100} value={capacities[key] || 1}
        onChange={(event) => setCapacities((current) => ({ ...current, [key]: Math.max(1, Number(event.target.value) || 1) }))} />
    </label>)}</section>
    <button style={button} disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? '保存中...' : '保存容量'}</button>
  </div>;
}

const title: CSSProperties = { margin: '0 0 8px', fontSize: 26 };
const hint: CSSProperties = { color: '#64748b', lineHeight: 1.6 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12, margin: '18px 0' };
const card: CSSProperties = { display: 'grid', gap: 8, padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 };
const desc: CSSProperties = { minHeight: 40, color: '#64748b', fontSize: 12, lineHeight: 1.5 };
const button: CSSProperties = { border: 0, borderRadius: 7, background: '#2563eb', color: '#fff', padding: '10px 18px', fontWeight: 700 };
