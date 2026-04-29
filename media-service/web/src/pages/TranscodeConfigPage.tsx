import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { transcode } from '../api/client';
import type { TranscodeConfig, EncodeDevice, DevicePoolEntry } from '../types';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

export default function TranscodeConfigPage() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [tempRoot, setTempRoot] = useState('');
  const [cpuStrategy, setCpuStrategy] = useState<'normal' | 'backup_only'>('normal');
  const [initialized, setInitialized] = useState(false);

  const [poolDevices, setPoolDevices] = useState<DevicePoolEntry[]>([]);

  const { isLoading: cfgLoading } = useQuery({
    queryKey: ['transcode-config'],
    queryFn: async () => {
      const cfg = await transcode.getConfig();
      if (!initialized) {
        setTempRoot(cfg.transcodeTempRoot || '');
        setCpuStrategy(cfg.transcodeCpuParticipationStrategy || 'normal');
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

  const [poolSeeded, setPoolSeeded] = useState(false);
  useEffect(() => {
    if (!poolSeeded && poolData && poolData.devices.length > 0) {
      setPoolDevices(poolData.devices);
      setPoolSeeded(true);
    }
  }, [poolData, poolSeeded]);

  const saveBasic = useMutation({
    mutationFn: () => transcode.patchConfig({ transcodeTempRoot: tempRoot }),
    onSuccess: () => setAlert({ type: 'success', msg: '临时目录已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const savePool = useMutation({
    mutationFn: () =>
      transcode.patchConfig({
        transcodeEncodingDevices: poolDevices,
        transcodeCpuParticipationStrategy: cpuStrategy,
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
      encoder: '',
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

  const totalDevices = displayDevices.length;
  const idleDevices = displayDevices.filter((d) => d.status === 'idle').length;
  const totalSlots = displayDevices.reduce((sum, d) => sum + d.maxSlots, 0);
  const usedSlots = displayDevices.reduce((sum, d) => sum + d.activeSlots, 0);

  return (
    <div>
      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      {/* Card 1: 转码临时目录 */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>转码临时目录</h3>
        <div>
          <label style={labelStyle}>临时目录</label>
          <input type="text" value={tempRoot} onChange={(e) => setTempRoot(e.target.value)} style={{ ...inputStyle, width: 400 }} placeholder="D:\transcode" />
          <p style={hintStyle}>转码过程中的临时文件存放路径。需确保磁盘空间充足。</p>
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={() => saveBasic.mutate()} disabled={saveBasic.isPending} style={primaryBtn}>
            {saveBasic.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </section>

      {/* Card 2: 编码设备池 */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>编码设备池</h3>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <button onClick={handleProbe} disabled={probing} style={primaryBtn}>
            {probing ? '检测中...' : '检测设备'}
          </button>
          <span style={{ fontSize: 13, color: '#999' }}>检测系统中的编码设备</span>
        </div>

        {/* Probed devices */}
        {probedDevices.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#666' }}>检测到的设备</h4>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>设备</th>
                  <th style={thStyle}>说明</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {probedDevices.map((d) => {
                  const alreadyInPool = poolDevices.some((p) => p.stableKey === d.stableKey);
                  return (
                    <tr key={d.stableKey}>
                      <td style={tdStyle}>{d.label}</td>
                      <td style={{ ...tdStyle, fontSize: 13, color: '#888' }}>{ENCODER_NOTES[d.backend] || ''}</td>
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
          </div>
        )}

        {/* Pool table */}
        {poolLoading && displayDevices.length === 0 ? (
          <LoadingSpinner text="加载设备池..." />
        ) : displayDevices.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>暂无入池设备，请点击「检测设备」后将 GPU 设备入池。</p>
        ) : (
          <>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>设备</th>
                  <th style={thStyle}>优先级</th>
                  <th style={thStyle}>槽位</th>
                  <th style={thStyle}>入池</th>
                  <th style={thStyle}>状态</th>
                  <th style={thStyle}>活跃槽位</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {displayDevices.map((d) => {
                  const label = DEVICE_LABELS[d.stableKey] || d.stableKey;
                  const note = ENCODER_NOTES_BY_KEY[d.stableKey] || '';
                  return (
                    <tr key={d.stableKey}>
                      <td style={tdStyle}>
                        <div>{label}</div>
                        {note && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{note}</div>}
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
                          {d.status === 'idle' ? '空闲' : d.status === 'busy' ? '占用中' : d.status}
                        </span>
                      </td>
                      <td style={tdStyle}>{d.activeSlots}</td>
                      <td style={tdStyle}>
                        <button onClick={() => removeFromPool(d.stableKey)} style={dangerBtn}>移除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize: 13, color: '#888', marginTop: 8 }}>
              总计 {totalDevices} 设备 · {idleDevices} 空闲 · {totalSlots} 总槽位 · {usedSlots} 使用中
            </p>
          </>
        )}

        {/* CPU strategy */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
          <div>
            <label style={labelStyle}>CPU 参与策略</label>
            <select
              value={cpuStrategy}
              onChange={(e) => setCpuStrategy(e.target.value as 'normal' | 'backup_only')}
              style={{ ...inputStyle, width: 240 }}
            >
              <option value="normal">正常参与编码调度</option>
              <option value="backup_only">仅 GPU 无法处理时使用（如 DV 格式）</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={() => savePool.mutate()} disabled={savePool.isPending} style={primaryBtn}>
            {savePool.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </section>
    </div>
  );
}

const ENCODER_NOTES: Record<string, string> = {
  cpu: '速度慢，画质最好，文件最小。可处理 GPU 不支持的格式（如杜比视界）',
  nvenc: '速度快，画质好，文件稍大。NVIDIA 显卡用户首选',
  qsv: '速度快，画质较好，文件稍大。Intel 核显专用',
  amf: '速度较快，画质一般，文件较大。AMD 显卡专用',
};

const ENCODER_NOTES_BY_KEY: Record<string, string> = {
  'cpu:libx265': '速度慢，画质最好，文件最小',
  'nvenc:0': '速度快，画质好，文件稍大',
  'nvenc:1': '速度快，画质好，文件稍大',
  'nvenc:2': '速度快，画质好，文件稍大',
  'nvenc:3': '速度快，画质好，文件稍大',
  'nvenc:4': '速度快，画质好，文件稍大',
  'nvenc:5': '速度快，画质好，文件稍大',
  'nvenc:6': '速度快，画质好，文件稍大',
  'nvenc:7': '速度快，画质好，文件稍大',
  'qsv:0': '速度快，画质较好，文件稍大',
  'amf:0': '速度较快，画质一般，文件较大',
};

const DEVICE_LABELS: Record<string, string> = {
  'cpu:libx265': 'CPU (libx265)',
  'nvenc:0': 'NVIDIA NVENC',
  'nvenc:1': 'NVIDIA NVENC',
  'nvenc:2': 'NVIDIA NVENC',
  'nvenc:3': 'NVIDIA NVENC',
  'nvenc:4': 'NVIDIA NVENC',
  'nvenc:5': 'NVIDIA NVENC',
  'nvenc:6': 'NVIDIA NVENC',
  'nvenc:7': 'NVIDIA NVENC',
  'qsv:0': 'Intel QSV',
  'amf:0': 'AMD AMF',
};

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

const smallPrimaryBtn: React.CSSProperties = {
  background: '#1a1a2e', color: '#fff', border: 'none', padding: '4px 12px',
  borderRadius: 4, cursor: 'pointer', fontSize: 12,
};

const dangerBtn: React.CSSProperties = {
  background: '#e74c3c', color: '#fff', border: 'none', padding: '4px 12px',
  borderRadius: 4, cursor: 'pointer', fontSize: 12,
};
