import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { upgrade } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

export default function MoviePilotConfigPage() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [savePath, setSavePath] = useState('');
  const [stagingPath, setStagingPath] = useState('');
  const [stagingLocalPath, setStagingLocalPath] = useState('');
  const [retryInterval, setRetryInterval] = useState(3600000);
  const [maxRetries, setMaxRetries] = useState(3);
  const [initialized, setInitialized] = useState(false);

  const { isLoading } = useQuery({
    queryKey: ['upgrade-config'],
    queryFn: async () => {
      const cfg = await upgrade.getConfig();
      if (!initialized) {
        setBaseUrl(cfg.moviepilot?.baseUrl || '');
        setApiKey(cfg.moviepilot?.apiKey || '');
        setSavePath(cfg.moviepilot?.savePath || '');
        setStagingPath(cfg.moviepilot?.stagingPath || '');
        setStagingLocalPath(cfg.upgradeStagingLocalPath || '');
        setRetryInterval(cfg.upgradeRetryInterval ?? 3600000);
        setMaxRetries(cfg.upgradeMaxRetries ?? 3);
        setInitialized(true);
      }
      return cfg;
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      upgrade.patchConfig({
        moviepilot: {
          baseUrl,
          apiKey,
          savePath,
          stagingPath,
        },
        upgradeStagingLocalPath: stagingLocalPath,
        upgradeRetryInterval: retryInterval,
        upgradeMaxRetries: maxRetries,
      }),
    onSuccess: () => setAlert({ type: 'success', msg: '洗版设置已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: '#1a1a2e' }}>洗版设置</h2>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      <section style={cardStyle}>
        <h3 style={sectionTitle}>MoviePilot 连接</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>服务地址</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://192.168.12.230:3000"
            style={{ ...inputStyle, width: 360 }}
          />
          <p style={hintStyle}>MoviePilot 的访问地址，包含端口号。</p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>API Token</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="输入 MoviePilot API Token"
            style={{ ...inputStyle, width: 360 }}
          />
          <p style={hintStyle}>在 MoviePilot 设置 → API 密钥中获取。</p>
        </div>
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>路径映射</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>容器内下载目录 (save_path)</label>
          <input
            type="text"
            value={savePath}
            onChange={(e) => setSavePath(e.target.value)}
            placeholder="/vol1/1000/media_download/shelfdeck"
            style={{ ...inputStyle, width: 420 }}
          />
          <p style={hintStyle}>
            MoviePilot 容器的下载目标路径。创建下载任务时指定 save_path，文件将下载到此目录。
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>容器内 Staging 目录</label>
          <input
            type="text"
            value={stagingPath}
            onChange={(e) => setStagingPath(e.target.value)}
            placeholder="留空则不使用 transfer 中间步骤"
            style={{ ...inputStyle, width: 420 }}
          />
          <p style={hintStyle}>可选。MoviePilot transfer 的目标目录。留空则直接从下载目录读取。</p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>本地 Staging 路径</label>
          <input
            type="text"
            value={stagingLocalPath}
            onChange={(e) => setStagingLocalPath(e.target.value)}
            placeholder="W:\shelfdeck"
            style={{ ...inputStyle, width: 360 }}
          />
          <p style={hintStyle}>
            ShelfDeck 访问 staging 目录的本地路径。对应容器内 save_path 通过 SMB/Docker 卷映射后的 Windows 路径。
          </p>
        </div>
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>重试策略</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>重搜间隔 (毫秒)</label>
            <input
              type="number"
              value={retryInterval}
              min={60000} max={86400000} step={60000}
              onChange={(e) => setRetryInterval(Math.max(60000, parseInt(e.target.value) || 3600000))}
              style={{ ...inputStyle, width: 160 }}
            />
            <p style={hintStyle}>waiting_media_source 状态下重新搜索的间隔。默认 1 小时 (3600000ms)。</p>
          </div>
          <div>
            <label style={labelStyle}>最大重试次数</label>
            <input
              type="number"
              value={maxRetries}
              min={1} max={10}
              onChange={(e) => setMaxRetries(Math.max(1, parseInt(e.target.value) || 3))}
              style={{ ...inputStyle, width: 100 }}
            />
            <p style={hintStyle}>下载/替换失败后的最大重试次数。</p>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={primaryBtn}>
            {saveMutation.isPending ? '保存中...' : '保存洗版设置'}
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
