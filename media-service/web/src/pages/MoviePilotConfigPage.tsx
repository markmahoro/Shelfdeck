import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { upgrade, system } from '../api/client';
import type { MpDirectory } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

export default function MoviePilotConfigPage() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [savePath, setSavePath] = useState('');
  const [stagingLocalPath, setStagingLocalPath] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Directories from MoviePilot
  const [directories, setDirectories] = useState<MpDirectory[]>([]);
  const [selectedDir, setSelectedDir] = useState('');
  const [fetchingDirs, setFetchingDirs] = useState(false);

  // Platform info for conditional display
  const [platform, setPlatform] = useState('');

  const { isLoading } = useQuery({
    queryKey: ['upgrade-config'],
    queryFn: async () => {
      const cfg = await upgrade.getConfig();
      if (!initialized) {
        setBaseUrl(cfg.moviepilot?.baseUrl || '');
        setApiKey(cfg.moviepilot?.apiKey || '');
        setSavePath(cfg.moviepilot?.savePath || '');
        setStagingLocalPath(cfg.upgradeStagingLocalPath || '');
        setInitialized(true);
      }
      return cfg;
    },
  });

  // Load platform info
  useQuery({
    queryKey: ['system-info'],
    queryFn: async () => {
      try {
        const info = await system.getInfo();
        setPlatform(info.platform);
        return info;
      } catch {
        return { platform: '' };
      }
    },
    enabled: initialized,
  });

  async function handleFetchDirectories() {
    if (!baseUrl || !apiKey) {
      setAlert({ type: 'error', msg: '请先填写 MoviePilot 服务地址和 API Token' });
      return;
    }
    setFetchingDirs(true);
    try {
      const dirs = await upgrade.getDirectories();
      setDirectories(dirs);
      if (dirs.length === 0) {
        setAlert({ type: 'error', msg: '未获取到下载目录，请在 MoviePilot 设置中配置' });
      }
    } catch (e: any) {
      setAlert({ type: 'error', msg: `获取目录失败: ${e.message}` });
    } finally {
      setFetchingDirs(false);
    }
  }

  function handleDirSelect(dirName: string) {
    setSelectedDir(dirName);
    const dir = directories.find((d) => d.name === dirName);
    if (dir) {
      setSavePath(dir.download_path);
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      upgrade.patchConfig({
        moviepilot: {
          baseUrl,
          apiKey,
          savePath,
        },
        upgradeStagingLocalPath: stagingLocalPath,
      }),
    onSuccess: () => setAlert({ type: 'success', msg: '洗版设置已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
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
        <h3 style={sectionTitle}>下载目录</h3>

        <div style={{ marginBottom: 16 }}>
          <button
            onClick={handleFetchDirectories}
            disabled={fetchingDirs || !baseUrl || !apiKey}
            style={{
              ...primaryBtn,
              opacity: !baseUrl || !apiKey ? 0.5 : 1,
              cursor: !baseUrl || !apiKey ? 'not-allowed' : 'pointer',
            }}
          >
            {fetchingDirs ? '获取中...' : '获取目录'}
          </button>
          <span style={{ fontSize: 12, color: '#999', marginLeft: 12 }}>
            从 MoviePilot 获取已配置的下载目录
          </span>
        </div>

        {directories.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>选择目录</label>
            <select
              value={selectedDir}
              onChange={(e) => handleDirSelect(e.target.value)}
              style={{ ...inputStyle, width: 420 }}
            >
              <option value="">-- 请选择 ShelfDeck 使用的目录 --</option>
              {directories.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} — {d.download_path}
                </option>
              ))}
            </select>
            <p style={hintStyle}>
              选择一个 MoviePilot 下载目录，ShelfDeck 将通过此目录下发洗版任务。
            </p>
          </div>
        )}

        {platform !== 'linux' && (
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
            MoviePilot 容器的下载目标路径。选择上方目录后自动填充，也可手动修改。
          </p>
        </div>
        )}
      </section>

      {platform !== 'linux' && (
      <section style={cardStyle}>
        <h3 style={sectionTitle}>本地 Staging 路径</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>本地 Staging 路径</label>
          <input
            type="text"
            value={stagingLocalPath}
            onChange={(e) => setStagingLocalPath(e.target.value)}
            placeholder="W:\\shelfdeck"
            style={{ ...inputStyle, width: 360 }}
          />
          <p style={hintStyle}>
            ShelfDeck 访问 staging 目录的本地路径。对应 MoviePilot 下载目录通过 SMB/网络映射后的 Windows 路径。
          </p>
        </div>
      </section>
      )}

      <div>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={primaryBtn}>
          {saveMutation.isPending ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 600, marginTop: 0, marginBottom: 16, color: '#1a1a2e',
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
