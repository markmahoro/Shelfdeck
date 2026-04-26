import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { systemConfig } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

export default function SystemConfigPage() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [execMode, setExecMode] = useState<'auto' | 'manual'>('auto');
  const [deleteConc, setDeleteConc] = useState(3);
  const [transcodeConc, setTranscodeConc] = useState(1);
  const [upgradeConc, setUpgradeConc] = useState(1);
  const [wallRating, setWallRating] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { isLoading } = useQuery({
    queryKey: ['system-config'],
    queryFn: async () => {
      const cfg = await systemConfig.get();
      if (!initialized) {
        setExecMode(cfg.executionMode || 'auto');
        setDeleteConc(cfg.deleteConcurrency ?? 3);
        setTranscodeConc(cfg.transcodeConcurrency ?? 1);
        setUpgradeConc(cfg.upgradeConcurrency ?? 1);
        setWallRating(cfg.wallRatingAutoEnqueue || false);
        setInitialized(true);
      }
      return cfg;
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      systemConfig.patch({
        executionMode: execMode,
        deleteConcurrency: deleteConc,
        transcodeConcurrency: transcodeConc,
        upgradeConcurrency: upgradeConc,
        wallRatingAutoEnqueue: wallRating,
      }),
    onSuccess: () => setAlert({ type: 'success', msg: '调度设置已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: '#1a1a2e' }}>系统设置</h2>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      <section style={cardStyle}>
        <h3 style={sectionTitle}>任务调度</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>执行模式</label>
          <select
            value={execMode}
            onChange={(e) => setExecMode(e.target.value as 'auto' | 'manual')}
            style={{ ...inputStyle, width: 200 }}
          >
            <option value="auto">auto — 创建后自动开始</option>
            <option value="manual">manual — 需手动触发执行</option>
          </select>
          <p style={hintStyle}>manual 模式：任务创建后状态为 pending_manual，需在任务监控页手动点击执行。</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>删除并发数</label>
            <input
              type="number"
              value={deleteConc}
              min={1} max={10}
              onChange={(e) => setDeleteConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }}
            />
            <p style={hintStyle}>同时执行的删除任务数上限</p>
          </div>
          <div>
            <label style={labelStyle}>转码并发数</label>
            <input
              type="number"
              value={transcodeConc}
              min={1} max={10}
              onChange={(e) => setTranscodeConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }}
            />
            <p style={hintStyle}>同时 executing 的转码任务数上限<br />(设备池槽位独立控制)</p>
          </div>
          <div>
            <label style={labelStyle}>洗版并发数</label>
            <input
              type="number"
              value={upgradeConc}
              min={1} max={10}
              onChange={(e) => setUpgradeConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }}
            />
            <p style={hintStyle}>同时执行的洗版任务数上限</p>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={wallRating} onChange={(e) => setWallRating(e.target.checked)} />
          豆瓣评分自动入队 — 刷新后自动为符合条件的媒体创建任务
        </label>

        <div style={{ marginTop: 20 }}>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={primaryBtn}>
            {saveMutation.isPending ? '保存中...' : '保存调度设置'}
          </button>
        </div>
      </section>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 600, marginBottom: 16, color: '#1a1a2e',
};

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};

const hintStyle: React.CSSProperties = {
  fontSize: 12, color: '#999', marginTop: 4, marginBottom: 0,
};

const primaryBtn: React.CSSProperties = {
  background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};
