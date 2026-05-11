import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { transcode, system, nodes as nodesApi } from '../api/client';
import type { TranscodeConfig, EncodeDevice, DevicePoolEntry } from '../types';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

interface RemoteDevice extends DevicePoolEntry {
  remote?: boolean;
  deviceId?: string;
  nodeId?: string;
  nodeName?: string;
  nodeStatus?: string;
  label?: string;
  backend?: string;
}

export default function TranscodeConfigPage() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const queryClient = useQueryClient();

  const [tempRoot, setTempRoot] = useState('');
  const [cpuStrategy, setCpuStrategy] = useState<'normal' | 'backup_only'>('normal');
  const [initialized, setInitialized] = useState(false);
  const [platform, setPlatform] = useState('');

  // Local pool config (saved via PATCH transcode/config)
  const [localPoolDevices, setLocalPoolDevices] = useState<DevicePoolEntry[]>([]);
  // Remote pool config (saved via PATCH nodes/:id/devices on "保存")
  const [remotePoolState, setRemotePoolState] = useState<RemoteDevice[]>([]);
  const [remoteSeeded, setRemoteSeeded] = useState(false);

  const { isLoading: cfgLoading } = useQuery({
    queryKey: ['transcode-config'],
    queryFn: async () => {
      const cfg = await transcode.getConfig();
      if (!initialized) {
        setTempRoot(cfg.transcodeTempRoot || '');
        setCpuStrategy(cfg.transcodeCpuParticipationStrategy || 'normal');
        if (cfg.transcodeEncodingDevices?.length) setLocalPoolDevices(cfg.transcodeEncodingDevices);
        setInitialized(true);
      }
      return cfg;
    },
  });

  useQuery({
    queryKey: ['system-info-transcode'],
    queryFn: async () => {
      try { const info = await system.getInfo(); setPlatform(info.platform); return info; }
      catch { return { platform: '' }; }
    },
    enabled: initialized,
  });

  const { data: poolData, isLoading: poolLoading } = useQuery({
    queryKey: ['device-pool'],
    queryFn: transcode.getDevicePool,
    refetchInterval: 5000,
  });

  const { data: nodesData } = useQuery({
    queryKey: ['nodes-for-pool'],
    queryFn: nodesApi.list,
    refetchInterval: 10000,
  });

  // Seed remote pool state once from server data
  useEffect(() => {
    if (!remoteSeeded && poolData?.devices) {
      const remotes = poolData.devices.filter((d: RemoteDevice) => d.remote);
      if (remotes.length > 0) setRemotePoolState(remotes);
      setRemoteSeeded(true);
    }
  }, [poolData, remoteSeeded]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const savePool = useMutation({
    mutationFn: async () => {
      // Save local devices
      await transcode.patchConfig({
        transcodeEncodingDevices: localPoolDevices,
        transcodeCpuParticipationStrategy: cpuStrategy,
      } as Partial<TranscodeConfig>);

      // Save remote device changes: compute diff between current server state and local edits
      const serverRemotes = ((poolData?.devices || []) as RemoteDevice[]).filter((d) => d.remote);
      for (const local of remotePoolState) {
        const server = serverRemotes.find((s) => s.deviceId === local.deviceId);
        if (!server) continue;
        if (server.inPool !== local.inPool || server.priority !== local.priority || server.maxSlots !== local.maxSlots) {
          await nodesApi.patchDevice(local.nodeId!, local.stableKey, local.inPool, {
            priority: local.priority,
            maxSlots: local.maxSlots,
          });
        }
      }
    },
    onSuccess: () => {
      setAlert({ type: 'success', msg: '设备池已保存' });
      queryClient.invalidateQueries({ queryKey: ['device-pool'] });
      queryClient.invalidateQueries({ queryKey: ['nodes-for-pool'] });
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const saveBasic = useMutation({
    mutationFn: () => transcode.patchConfig({ transcodeTempRoot: tempRoot }),
    onSuccess: () => setAlert({ type: 'success', msg: '临时目录已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  // ── Probe (local only) ────────────────────────────────────────────────────

  const [probing, setProbing] = useState(false);
  const [probedLocalDevices, setProbedLocalDevices] = useState<EncodeDevice[]>([]);

  async function handleProbe() {
    setProbing(true);
    try {
      const result = await transcode.probeDevices();
      setProbedLocalDevices(result.devices);
    } catch (e: any) {
      setAlert({ type: 'error', msg: e.message });
    } finally {
      setProbing(false);
    }
  }

  // ── Local device actions (state only, saved on "保存") ─────────────────────

  function addLocalToPool(dev: EncodeDevice) {
    if (localPoolDevices.some((d) => d.stableKey === dev.stableKey)) return;
    setLocalPoolDevices([...localPoolDevices, { stableKey: dev.stableKey, inPool: true, priority: 100, maxSlots: 1, encoder: '', status: 'idle', activeSlots: 0 }]);
  }

  function removeLocalFromPool(stableKey: string) {
    setLocalPoolDevices(localPoolDevices.filter((d) => d.stableKey !== stableKey));
  }

  function updateLocalPoolDevice(stableKey: string, patch: Partial<DevicePoolEntry>) {
    setLocalPoolDevices(localPoolDevices.map((d) => (d.stableKey === stableKey ? { ...d, ...patch } : d)));
  }

  // ── Remote device actions (state only, saved on "保存") ────────────────────

  function addRemoteToPool(dev: RemoteDevice) {
    const exists = remotePoolState.find((r) => r.deviceId === dev.deviceId);
    if (exists) {
      setRemotePoolState(remotePoolState.map((r) => r.deviceId === dev.deviceId ? { ...r, inPool: true } : r));
    } else {
      setRemotePoolState([...remotePoolState, { ...dev, inPool: true }]);
    }
  }

  function removeRemoteFromPool(deviceId: string) {
    setRemotePoolState(remotePoolState.map((r) => r.deviceId === deviceId ? { ...r, inPool: false } : r));
  }

  function updateRemotePoolDevice(deviceId: string, patch: Partial<RemoteDevice>) {
    setRemotePoolState(remotePoolState.map((r) => r.deviceId === deviceId ? { ...r, ...patch } : r));
  }

  // ── Build available lists ─────────────────────────────────────────────────

  // Remote devices currently in pool (per local state)
  const remoteInPoolIds = new Set(remotePoolState.filter((r) => r.inPool).map((r) => r.deviceId));

  // Available remote devices = online nodes' devices NOT already in pool (per local state)
  const remoteAvailableDevices: RemoteDevice[] = [];
  if (nodesData) {
    for (const node of nodesData.nodes) {
      if (node.status !== 'online') continue;
      for (const dev of (node.capabilities?.devices || [])) {
        const deviceId = `node:${node.id}:${dev.stableKey}`;
        if (remoteInPoolIds.has(deviceId)) continue;
        remoteAvailableDevices.push({
          ...dev,
          deviceId,
          nodeId: node.id,
          nodeName: node.name,
          nodeStatus: node.status,
          stableKey: dev.stableKey,
          inPool: false,
          remote: true,
          priority: (dev as any).priority || 150,
          maxSlots: (dev as any).maxSlots || 1,
          encoder: '',
          status: 'idle',
          activeSlots: 0,
        });
      }
    }
  }

  if (cfgLoading) return <LoadingSpinner />;

  // Live status merge for display (server-side slot usage)
  const liveStatusMap: Record<string, { status: string; activeSlots: number }> = {};
  if (poolData) {
    for (const d of poolData.devices) {
      if (!(d as RemoteDevice).remote) liveStatusMap[d.stableKey] = { status: d.status, activeSlots: d.activeSlots };
    }
  }

  const displayLocal = localPoolDevices.map((d) => ({
    ...d,
    status: (liveStatusMap[d.stableKey]?.status || d.status) as DevicePoolEntry['status'],
    activeSlots: liveStatusMap[d.stableKey]?.activeSlots ?? d.activeSlots,
  }));

  // Remote pool display: use local state merged with live server status
  const serverRemotes = ((poolData?.devices || []) as RemoteDevice[]).filter((d) => d.remote);
  const serverRemoteMap = new Map(serverRemotes.map((d) => [d.deviceId, d]));

  const displayRemote = remotePoolState.filter((r) => r.inPool).map((r) => {
    const live = serverRemoteMap.get(r.deviceId);
    return {
      ...r,
      status: live?.status || r.status,
      activeSlots: live?.activeSlots ?? r.activeSlots,
      nodeStatus: live?.nodeStatus || r.nodeStatus,
    };
  });

  const totalLocal = displayLocal.length;
  const totalRemote = displayRemote.length;
  const idleCount = displayLocal.filter((d) => d.status === 'idle').length + displayRemote.filter((d) => d.status === 'idle').length;
  const totalSlots = displayLocal.reduce((s, d) => s + d.maxSlots, 0) + displayRemote.reduce((s, d) => s + d.maxSlots, 0);
  const usedSlots = displayLocal.reduce((s, d) => s + d.activeSlots, 0) + displayRemote.reduce((s, d) => s + d.activeSlots, 0);

  return (
    <div>
      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      {/* Card 1: Temp dir */}
      {platform !== 'linux' && (
      <section style={card}>
        <h3 style={sectionTitle}>转码临时目录</h3>
        <div>
          <label style={labelStyle}>临时目录</label>
          <input type="text" value={tempRoot} onChange={(e) => setTempRoot(e.target.value)} style={{ ...inputStyle, width: 400 }} placeholder="D:\transcode" />
          <p style={hint}>转码过程中的临时文件存放路径。需确保磁盘空间充足。</p>
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={() => saveBasic.mutate()} disabled={saveBasic.isPending} style={primaryBtn}>{saveBasic.isPending ? '保存中...' : '保存'}</button>
        </div>
      </section>
      )}

      {/* Card 2: Available devices */}
      <section style={card}>
        <h3 style={sectionTitle}>可用设备</h3>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <button onClick={handleProbe} disabled={probing} style={primaryBtn}>{probing ? '检测中...' : '检测本机设备'}</button>
          <span style={{ fontSize: 13, color: '#999' }}>检测本机 GPU 编码器。远程节点设备自动列出。</span>
        </div>

        {probedLocalDevices.length === 0 && remoteAvailableDevices.length === 0 && (
          <p style={{ color: '#888', fontSize: 14 }}>暂无可用设备。点击"检测本机设备"扫描本机 GPU，或在「转码节点」页面添加远程节点。</p>
        )}

        {(probedLocalDevices.length > 0 || remoteAvailableDevices.length > 0) && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>设备</th>
                <th style={thStyle}>来源</th>
                <th style={thStyle}>说明</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {probedLocalDevices.map((d) => {
                const inPool = localPoolDevices.some((p) => p.stableKey === d.stableKey);
                return (
                  <tr key={`local-${d.stableKey}`}>
                    <td style={tdStyle}>{d.label}</td>
                    <td style={tdStyle}><SourceTag label="本机" color="#1a73e8" bg="#e8f0fe" /></td>
                    <td style={{ ...tdStyle, fontSize: 13, color: '#888' }}>{ENCODER_NOTES[d.backend] || ''}</td>
                    <td style={tdStyle}>
                      {inPool ? <span style={{ color: '#27ae60', fontSize: 13 }}>已在池中</span>
                        : <button onClick={() => addLocalToPool(d)} style={smallPrimaryBtn}>入池</button>}
                    </td>
                  </tr>
                );
              })}
              {remoteAvailableDevices.map((d) => (
                <tr key={`remote-${d.deviceId}`}>
                  <td style={tdStyle}>{d.label}</td>
                  <td style={tdStyle}><SourceTag label={`节点: ${d.nodeName}`} color="#856404" bg="#fff3cd" /></td>
                  <td style={{ ...tdStyle, fontSize: 13, color: '#888' }}>{ENCODER_NOTES[d.backend || ''] || ''}</td>
                  <td style={tdStyle}>
                    <button onClick={() => addRemoteToPool(d)} style={smallPrimaryBtn}>入池</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Card 3: Device Pool */}
      <section style={card}>
        <h3 style={sectionTitle}>设备池</h3>

        {poolLoading && displayLocal.length === 0 && displayRemote.length === 0 ? (
          <LoadingSpinner text="加载设备池..." />
        ) : displayLocal.length === 0 && displayRemote.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>设备池为空。请在上方"可用设备"中将设备入池，然后保存。</p>
        ) : (
          <>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>设备</th>
                  <th style={thStyle}>来源</th>
                  <th style={thStyle}>优先级</th>
                  <th style={thStyle}>槽位</th>
                  <th style={thStyle}>状态</th>
                  <th style={thStyle}>活跃槽位</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {displayLocal.map((d) => {
                  const label = DEVICE_LABELS[d.stableKey] || d.stableKey;
                  return (
                    <tr key={`pool-local-${d.stableKey}`}>
                      <td style={tdStyle}>
                        <div>{label}</div>
                        {ENCODER_NOTES_BY_KEY[d.stableKey] && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{ENCODER_NOTES_BY_KEY[d.stableKey]}</div>}
                      </td>
                      <td style={tdStyle}><SourceTag label="本机" color="#1a73e8" bg="#e8f0fe" /></td>
                      <td style={tdStyle}><input type="number" value={d.priority} min={1} max={999} onChange={(e) => updateLocalPoolDevice(d.stableKey, { priority: parseInt(e.target.value) || 100 })} style={{ ...inlineInput, width: 60 }} /></td>
                      <td style={tdStyle}><input type="number" value={d.maxSlots} min={1} max={16} onChange={(e) => updateLocalPoolDevice(d.stableKey, { maxSlots: parseInt(e.target.value) || 1 })} style={{ ...inlineInput, width: 50 }} /></td>
                      <td style={tdStyle}><StatusBadge status={d.status} /></td>
                      <td style={tdStyle}>{d.activeSlots}</td>
                      <td style={tdStyle}><button onClick={() => removeLocalFromPool(d.stableKey)} style={dangerBtn}>移除</button></td>
                    </tr>
                  );
                })}
                {displayRemote.map((d) => {
                  const offline = d.nodeStatus === 'offline';
                  return (
                    <tr key={`pool-remote-${d.deviceId}`} style={{ background: '#fefdf5' }}>
                      <td style={tdStyle}>
                        <div>{d.label}</div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{d.backend}</div>
                      </td>
                      <td style={tdStyle}><SourceTag label={`节点: ${d.nodeName}`} color="#856404" bg="#fff3cd" /></td>
                      <td style={tdStyle}><input type="number" value={d.priority} min={1} max={999} disabled={offline} onChange={(e) => updateRemotePoolDevice(d.deviceId!, { priority: parseInt(e.target.value) || 150 })} style={{ ...inlineInput, width: 60 }} /></td>
                      <td style={tdStyle}><input type="number" value={d.maxSlots} min={1} max={16} disabled={offline} onChange={(e) => updateRemotePoolDevice(d.deviceId!, { maxSlots: parseInt(e.target.value) || 1 })} style={{ ...inlineInput, width: 50 }} /></td>
                      <td style={tdStyle}>{offline ? <span style={{ color: '#e74c3c', fontSize: 13 }}>节点离线</span> : <StatusBadge status={d.status} />}</td>
                      <td style={tdStyle}>{d.activeSlots}</td>
                      <td style={tdStyle}><button onClick={() => removeRemoteFromPool(d.deviceId!)} style={dangerBtn}>移除</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize: 13, color: '#888', marginTop: 8 }}>
              本机 {totalLocal} 台 · 远程 {totalRemote} 台 · 空闲 {idleCount} · 总槽位 {totalSlots} · 使用中 {usedSlots}
            </p>
          </>
        )}

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
          <div>
            <label style={labelStyle}>CPU 参与策略</label>
            <select value={cpuStrategy} onChange={(e) => setCpuStrategy(e.target.value as 'normal' | 'backup_only')} style={{ ...inputStyle, width: 240 }}>
              <option value="normal">正常参与编码调度</option>
              <option value="backup_only">仅 GPU 无法处理时使用（如 DV 格式）</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={() => savePool.mutate()} disabled={savePool.isPending} style={primaryBtn}>
            {savePool.isPending ? '保存中...' : '保存设备池'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ── Small components ─────────────────────────────────────────────────────────

function SourceTag({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: bg, color, fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'idle' ? '#27ae60' : status === 'busy' ? '#f39c12' : '#e74c3c';
  const label = status === 'idle' ? '空闲' : status === 'busy' ? '占用中' : status;
  return <span style={{ color, fontSize: 13 }}>{label}</span>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ENCODER_NOTES: Record<string, string> = {
  cpu: '速度慢，画质最好，文件最小', nvenc: '速度快，画质好，文件稍大', qsv: '速度快，画质较好，文件稍大', amf: '速度较快，画质一般，文件较大',
};

const ENCODER_NOTES_BY_KEY: Record<string, string> = {
  'cpu:libx265': '速度慢，画质最好，文件最小',
  'nvenc:0': '速度快，画质好，文件稍大', 'nvenc:1': '速度快，画质好，文件稍大',
  'qsv:0': '速度快，画质较好，文件稍大', 'amf:0': '速度较快，画质一般，文件较大',
};

const DEVICE_LABELS: Record<string, string> = {
  'cpu:libx265': 'CPU (libx265)', 'nvenc:0': 'NVIDIA NVENC', 'nvenc:1': 'NVIDIA NVENC',
  'qsv:0': 'Intel QSV', 'amf:0': 'AMD AMF',
};

// ── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = { background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginTop: 0, marginBottom: 16, color: '#1a1a2e' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 };
const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' };
const hint: React.CSSProperties = { fontSize: 12, color: '#999', marginTop: 4, marginBottom: 0 };
const inlineInput: React.CSSProperties = { padding: '4px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px', borderBottom: '1px solid #f0f0f0' };
const primaryBtn: React.CSSProperties = { background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
const smallPrimaryBtn: React.CSSProperties = { background: '#1a1a2e', color: '#fff', border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const dangerBtn: React.CSSProperties = { background: '#e74c3c', color: '#fff', border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
