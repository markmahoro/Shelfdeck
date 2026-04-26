import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { transcode } from '../api/client';
import type { TranscodeConfig, EncodeDevice, DevicePoolEntry } from '../types';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

function defaultEncoder(backend: string): string {
  switch (backend) {
    case 'nvenc': return 'hevc_nvenc';
    case 'qsv': return 'hevc_qsv';
    case 'amf': return 'hevc_amf';
    default: return 'libx265';
  }
}

export default function TranscodeConfigPage() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Basic settings form
  const [tempRoot, setTempRoot] = useState('');
  const [ffmpegPath, setFfmpegPath] = useState('');
  const [ffprobePath, setFfprobePath] = useState('');
  const [replaceConfirm, setReplaceConfirm] = useState(false);
  const [cpuStrategy, setCpuStrategy] = useState<'normal' | 'backup_only'>('normal');
  const [maxCpuSlots, setMaxCpuSlots] = useState(1);
  const [initialized, setInitialized] = useState(false);

  // Device pool — mutable
  const [poolDevices, setPoolDevices] = useState<DevicePoolEntry[]>([]);

  // Queries
  const { isLoading: cfgLoading } = useQuery({
    queryKey: ['transcode-config'],
    queryFn: async () => {
      const cfg = await transcode.getConfig();
      if (!initialized) {
        setTempRoot(cfg.transcodeTempRoot || '');
        setFfmpegPath(cfg.ffmpegPath || '');
        setFfprobePath(cfg.ffprobePath || '');
        setReplaceConfirm(cfg.transcodeReplaceConfirmRequired || false);
        setCpuStrategy(cfg.transcodeCpuParticipationStrategy || 'normal');
        setMaxCpuSlots(cfg.transcodeMaxCpuSlots || 1);
        if (cfg.transcodeEncodingDevices && cfg.transcodeEncodingDevices.length > 0) {
          setPoolDevices(cfg.transcodeEncodingDevices);
        }
        setInitialized(true);
      }
      return cfg;
    },
  });

  const { data: poolData, isLoading: poolLoading } = useQuery({
    queryKey: ['device-pool'],
    queryFn: transcode.getDevicePool,
    refetchInterval: 5000,
  });

  // Seed poolDevices from remote if we haven't edited locally yet
  const [poolSeeded, setPoolSeeded] = useState(false);
  useEffect(() => {
    if (!poolSeeded && poolData && poolData.devices.length > 0) {
      setPoolDevices(poolData.devices);
      setPoolSeeded(true);
    }
  }, [poolData, poolSeeded]);

  // Mutations
  const saveBasic = useMutation({
    mutationFn: () => transcode.patchConfig({ transcodeTempRoot: tempRoot, ffmpegPath, ffprobePath }),
    onSuccess: () => setAlert({ type: 'success', msg: '基本设置已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const savePool = useMutation({
    mutationFn: () =>
      transcode.patchConfig({
        transcodeEncodingDevices: poolDevices,
        transcodeReplaceConfirmRequired: replaceConfirm,
        transcodeCpuParticipationStrategy: cpuStrategy,
        transcodeMaxCpuSlots: maxCpuSlots,
      } as Partial<TranscodeConfig>),
    onSuccess: () => setAlert({ type: 'success', msg: '设备池设置已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const [probing, setProbing] = useState(false);
  const [probedDevices, setProbedDevices] = useState<EncodeDevice[]>([]);

  async function handleProbe() {
    setProbing(true);
    try {
      const result = await transcode.probeDevices();
      setProbedDevices(result.devices);
    } catch (e: any) {
      setAlert({ type: 'error', msg: e.message });
    } finally {
      setProbing(false);
    }
  }

  function addToPool(dev: EncodeDevice) {
    if (poolDevices.some((d) => d.stableKey === dev.stableKey)) {
      setAlert({ type: 'error', msg: `设备 ${dev.stableKey} 已在池中` });
      return;
    }
    const entry: DevicePoolEntry = {
      stableKey: dev.stableKey,
      inPool: true,
      priority: 100,
      maxSlots: 1,
      encoder: defaultEncoder(dev.backend),
      status: 'idle',
      activeSlots: 0,
    };
    setPoolDevices([...poolDevices, entry]);
    setAlert({ type: 'success', msg: `已添加 ${dev.stableKey} 到设备池（请点击保存设备池）` });
  }

  function removeFromPool(stableKey: string) {
    setPoolDevices(poolDevices.filter((d) => d.stableKey !== stableKey));
  }

  function updatePoolDevice(stableKey: string, patch: Partial<DevicePoolEntry>) {
    setPoolDevices(poolDevices.map((d) => (d.stableKey === stableKey ? { ...d, ...patch } : d)));
  }

  if (cfgLoading) return <LoadingSpinner />;

  // Merge live status from poolData into local poolDevices for display
  const liveStatusMap: Record<string, { status: string; activeSlots: number }> = {};
  if (poolData) {
    for (const d of poolData.devices) {
      liveStatusMap[d.stableKey] = { status: d.status, activeSlots: d.activeSlots };
    }
  }
  const displayDevices = poolDevices.map((d) => ({
    ...d,
    status: (liveStatusMap[d.stableKey]?.status || d.status) as DevicePoolEntry['status'],
    activeSlots: liveStatusMap[d.stableKey]?.activeSlots ?? d.activeSlots,
  }));

  // Summary computed from display devices
  const totalDevices = displayDevices.length;
  const idleDevices = displayDevices.filter((d) => d.status === 'idle').length;
  const totalSlots = displayDevices.reduce((sum, d) => sum + d.maxSlots, 0);
  const usedSlots = displayDevices.reduce((sum, d) => sum + d.activeSlots, 0);

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: '#1a1a2e' }}>转码设置</h2>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      {/* Basic settings */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>基本设置</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>临时目录</label>
            <input type="text" value={tempRoot} onChange={(e) => setTempRoot(e.target.value)} style={inputStyle} placeholder="D:\transcode" />
          </div>
          <div></div>
          <div>
            <label style={labelStyle}>FFmpeg 路径</label>
            <input type="text" value={ffmpegPath} onChange={(e) => setFfmpegPath(e.target.value)} style={inputStyle} placeholder="D:\tools\ffmpeg.exe" />
          </div>
          <div>
            <label style={labelStyle}>FFprobe 路径</label>
            <input type="text" value={ffprobePath} onChange={(e) => setFfprobePath(e.target.value)} style={inputStyle} placeholder="D:\tools\ffprobe.exe" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => saveBasic.mutate()} disabled={saveBasic.isPending} style={primaryBtn}>
            {saveBasic.isPending ? '保存中...' : '保存基本设置'}
          </button>
          <button onClick={handleProbe} disabled={probing} style={secondaryBtn}>
            {probing ? '检测中...' : '检测设备'}
          </button>
        </div>
      </section>

      {/* Probed devices */}
      {probedDevices.length > 0 && (
        <section style={cardStyle}>
          <h3 style={sectionTitle}>检测到的编码设备</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>设备</th>
                <th style={thStyle}>后端</th>
                <th style={thStyle}>Stable Key</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {probedDevices.map((d) => {
                const alreadyInPool = poolDevices.some((p) => p.stableKey === d.stableKey);
                return (
                  <tr key={d.stableKey}>
                    <td style={tdStyle}>{d.label}</td>
                    <td style={tdStyle}>{d.backend}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{d.stableKey}</td>
                    <td style={tdStyle}>
                      {alreadyInPool ? (
                        <span style={{ color: '#27ae60', fontSize: 13 }}>已在池中</span>
                      ) : (
                        <button onClick={() => addToPool(d)} style={smallPrimaryBtn}>入池</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Device pool */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>编码设备池</h3>
        {poolLoading && displayDevices.length === 0 ? (
          <LoadingSpinner text="加载设备池..." />
        ) : displayDevices.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>暂无入池设备。请先配置 ffmpeg 路径并点击「检测设备」，然后将设备保存入池。</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>设备</th>
                <th style={thStyle}>编码器</th>
                <th style={thStyle}>优先级</th>
                <th style={thStyle}>槽位</th>
                <th style={thStyle}>入池</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>活跃槽位</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {displayDevices.map((d) => (
                <tr key={d.stableKey}>
                  <td style={tdStyle}>{d.stableKey}</td>
                  <td style={tdStyle}>
                    <input
                      type="text"
                      value={d.encoder}
                      onChange={(e) => updatePoolDevice(d.stableKey, { encoder: e.target.value })}
                      style={{ ...inlineInputStyle, width: 120 }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      value={d.priority}
                      min={1}
                      max={999}
                      onChange={(e) => updatePoolDevice(d.stableKey, { priority: parseInt(e.target.value) || 100 })}
                      style={{ ...inlineInputStyle, width: 60 }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      value={d.maxSlots}
                      min={1}
                      max={16}
                      onChange={(e) => updatePoolDevice(d.stableKey, { maxSlots: parseInt(e.target.value) || 1 })}
                      style={{ ...inlineInputStyle, width: 50 }}
                    />
                  </td>
                  <td style={tdStyle}>{d.inPool ? '✅' : '—'}</td>
                  <td style={tdStyle}>
                    <span style={{ color: d.status === 'idle' ? '#27ae60' : d.status === 'busy' ? '#f39c12' : '#e74c3c' }}>
                      {d.status}
                    </span>
                  </td>
                  <td style={tdStyle}>{d.activeSlots}</td>
                  <td style={tdStyle}>
                    <button onClick={() => removeFromPool(d.stableKey)} style={dangerBtn}>移除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {displayDevices.length > 0 && (
          <p style={{ fontSize: 13, color: '#888', marginTop: 8 }}>
            总计 {totalDevices} 设备 · {idleDevices} 空闲 · {totalSlots} 总槽位 · {usedSlots} 使用中
          </p>
        )}
      </section>

      {/* Other settings */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>其他设置</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={replaceConfirm} onChange={(e) => setReplaceConfirm(e.target.checked)} />
          转码前需确认替换
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>CPU 参与策略</label>
            <select
              value={cpuStrategy}
              onChange={(e) => setCpuStrategy(e.target.value as 'normal' | 'backup_only')}
              style={{ ...inputStyle, width: 200 }}
            >
              <option value="normal">normal</option>
              <option value="backup_only">backup_only</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>CPU 最大槽位数</label>
            <input
              type="number"
              value={maxCpuSlots}
              min={1}
              max={16}
              onChange={(e) => setMaxCpuSlots(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }}
            />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={() => savePool.mutate()} disabled={savePool.isPending} style={primaryBtn}>
            {savePool.isPending ? '保存中...' : '保存设备池'}
          </button>
        </div>
      </section>

      <p style={{ fontSize: 13, color: '#888', marginTop: 8 }}>提示: 码率策略在「媒体库」→ 子库设置中独立配置</p>
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
  width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};

const inlineInputStyle: React.CSSProperties = {
  padding: '4px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, boxSizing: 'border-box',
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', color: '#666',
};

const tdStyle: React.CSSProperties = {
  padding: '8px', borderBottom: '1px solid #f0f0f0',
};

const primaryBtn: React.CSSProperties = {
  background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const secondaryBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const smallPrimaryBtn: React.CSSProperties = {
  background: '#1a1a2e', color: '#fff', border: 'none', padding: '4px 12px',
  borderRadius: 4, cursor: 'pointer', fontSize: 12,
};

const dangerBtn: React.CSSProperties = {
  background: '#e74c3c', color: '#fff', border: 'none', padding: '4px 12px',
  borderRadius: 4, cursor: 'pointer', fontSize: 12,
};
