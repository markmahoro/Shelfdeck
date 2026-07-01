import { useEffect, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { systemConfig } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const RESOURCE_CAPACITY_DEFAULTS: Record<string, number> = {
  'filesystem:ingest': 1,
  'filesystem:mutation': 1,
  'scraper:metadata': 1,
  'emby:metadata': 1,
  'local:western-ai': 1,
  'local:ffmpeg': 1,
  'worker:*': 1,
  moviepilot: 1,
  'service:task': 1,
};

const RESOURCE_ROWS = [
  { key: 'filesystem:ingest', label: '入库文件写入', desc: '外部候选进入 ShelfDeck 管理时的文件系统写入容量。' },
  { key: 'filesystem:mutation', label: '文件变更', desc: '替换、删除、整理等会改变文件状态的执行容量。' },
  { key: 'scraper:metadata', label: '元数据抓取', desc: '豆瓣、JAV、成人库等外部元数据抓取容量。' },
  { key: 'emby:metadata', label: 'Emby 元数据修复', desc: '从 Emby 拉取或修复现有媒体事实的容量。' },
  { key: 'local:western-ai', label: '本地 AI 识别', desc: '欧美成人库本地人脸/视觉分析容量。' },
  { key: 'local:ffmpeg', label: '本机转码', desc: '服务容器内 FFmpeg 转码容量。' },
  { key: 'worker:*', label: '远端转码节点', desc: '每个远端 worker 的默认转码容量。' },
  { key: 'moviepilot', label: 'MoviePilot', desc: '洗版下载和替换流程访问 MoviePilot 的容量。' },
  { key: 'service:task', label: '服务轻任务', desc: '归档、状态写入等轻量服务内任务容量。' },
];

function legacyCapacity(cfg: Record<string, any>): Record<string, number> {
  return {
    'filesystem:ingest': cfg.ingestConcurrency ?? RESOURCE_CAPACITY_DEFAULTS['filesystem:ingest'],
    'filesystem:mutation': cfg.deleteConcurrency ?? RESOURCE_CAPACITY_DEFAULTS['filesystem:mutation'],
    'scraper:metadata': cfg.scrapeConcurrency ?? RESOURCE_CAPACITY_DEFAULTS['scraper:metadata'],
    'emby:metadata': cfg.embyMetadataRepairConcurrency ?? RESOURCE_CAPACITY_DEFAULTS['emby:metadata'],
    'local:ffmpeg': cfg.transcodeConcurrency ?? RESOURCE_CAPACITY_DEFAULTS['local:ffmpeg'],
    'worker:*': cfg.transcodeConcurrency ?? RESOURCE_CAPACITY_DEFAULTS['worker:*'],
    moviepilot: cfg.upgradeConcurrency ?? RESOURCE_CAPACITY_DEFAULTS.moviepilot,
  };
}

export default function ResourceCapacityPage() {
  const qc = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [capacity, setCapacity] = useState<Record<string, number>>(RESOURCE_CAPACITY_DEFAULTS);
  const { data, isLoading, error } = useQuery({
    queryKey: ['resource-capacity-config'],
    queryFn: systemConfig.get,
  });

  useEffect(() => {
    if (!data) return;
    setCapacity({
      ...RESOURCE_CAPACITY_DEFAULTS,
      ...legacyCapacity(data as unknown as Record<string, any>),
      ...(data.resourceCapacity || {}),
    });
  }, [data]);

  function update(key: string, value: number) {
    setCapacity((prev) => ({ ...prev, [key]: Math.max(1, Math.floor(value || 1)) }));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      await systemConfig.patch({
        resourceCapacity: capacity,
        ingestConcurrency: capacity['filesystem:ingest'],
        deleteConcurrency: capacity['filesystem:mutation'],
        scrapeConcurrency: capacity['scraper:metadata'],
        transcodeConcurrency: capacity['local:ffmpeg'],
        upgradeConcurrency: capacity.moviepilot,
      });
      qc.invalidateQueries({ queryKey: ['resource-capacity-config'] });
      qc.invalidateQueries({ queryKey: ['system-config-full'] });
    },
    onSuccess: () => setAlert({ type: 'success', msg: '资源容量已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (isLoading) return <LoadingSpinner text="加载资源容量..." />;

  return (
    <div>
      <h1 style={pageTitle}>资源容量</h1>
      <p style={hintStyle}>这里配置执行容量。任务是否创建、优先级和生命周期目标仍由任务调度与生命周期规则决定。</p>
      {alert && <Alert type={alert.type} message={alert.msg} />}
      {error && <Alert type="error" message={error instanceof Error ? error.message : '加载失败'} />}
      <section style={cardStyle}>
        <div style={gridStyle}>
          {RESOURCE_ROWS.map((row) => (
            <label key={row.key} style={fieldStyle}>
              <span style={labelStyle}>{row.label}</span>
              <span style={descStyle}>{row.desc}</span>
              <input
                type="number"
                min={1}
                max={100}
                value={capacity[row.key] ?? 1}
                onChange={(e) => update(row.key, parseInt(e.target.value, 10) || 1)}
                style={inputStyle}
              />
            </label>
          ))}
        </div>
      </section>
      <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={primaryBtn}>
        {saveMutation.isPending ? '保存中...' : '保存'}
      </button>
    </div>
  );
}

const pageTitle: React.CSSProperties = { fontSize: 28, margin: '0 0 8px', color: '#1a1a2e' };
const hintStyle: React.CSSProperties = { color: '#666', fontSize: 13, marginBottom: 16, lineHeight: 1.6 };
const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 18,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  marginBottom: 16,
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
};
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  border: '1px solid #eee',
  borderRadius: 8,
  padding: 12,
};
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#1a1a2e' };
const descStyle: React.CSSProperties = { minHeight: 36, fontSize: 12, color: '#777', lineHeight: 1.5 };
const inputStyle: React.CSSProperties = { padding: '9px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 };
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px',
  background: '#2563eb',
  color: '#fff',
  border: 0,
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 700,
};
