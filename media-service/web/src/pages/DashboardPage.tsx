import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { health, tasks, subLibraries, emby, activityLog, spaceStats, moviepilot } from '../api/client';
import type { ActivityEntry, MpSite } from '../api/client';
import type { SubLibrary, EmbyUser, MediaFolder, MediaTask } from '../types';
import HealthCard from '../components/HealthCard';
import Modal from '../components/Modal';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const ACTION_TYPE_LABELS: Record<string, string> = {
  transcode: '码率压缩', delete: '删除', upgrade: '洗版',
};

const STATUS_LABELS: Record<string, string> = {
  created: '已创建', pending_manual: '待手动', queued: '排队中', executing: '执行中',
  pausing: '暂停中...', awaiting_user_confirm: '等待确认', paused: '已暂停',
  interrupted: '已中断', done: '已完成', failed_hard: '失败',
};

export default function DashboardPage() {
  const qc = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Wizard state
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [embyServerId, setEmbyServerId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [subLibName, setSubLibName] = useState('');
  const [doubanEnabled, setDoubanEnabled] = useState(false);
  const [policy1080_2, setPolicy1080_2] = useState(2);
  const [policy1080_3, setPolicy1080_3] = useState(4);
  const [policy1080_4, setPolicy1080_4] = useState(7);
  const [policy1080_5, setPolicy1080_5] = useState(12);
  const [policy4k_2, setPolicy4k_2] = useState(5);
  const [policy4k_3, setPolicy4k_3] = useState(10);
  const [policy4k_4, setPolicy4k_4] = useState(16);
  const [policy4k_5, setPolicy4k_5] = useState(25);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editingUuid, setEditingUuid] = useState('');

  // Smart select config
  const [smartEnabled, setSmartEnabled] = useState(false);
  const [smartCodecs, setSmartCodecs] = useState<string[]>([]);
  const [smartResolutions, setSmartResolutions] = useState<string[]>([]);
  const [smartAudios, setSmartAudios] = useState<string[]>([]);
  const [smartSites, setSmartSites] = useState<string[]>([]);
  const [sizeLimit4_1080, setSizeLimit4_1080] = useState(0);
  const [sizeLimit4_4k, setSizeLimit4_4k] = useState(0);
  const [sizeLimit5_1080, setSizeLimit5_1080] = useState(0);
  const [sizeLimit5_4k, setSizeLimit5_4k] = useState(0);
  const [smartCNSub, setSmartCNSub] = useState(false);

  const { data: h, isLoading: hLoading } = useQuery({
    queryKey: ['admin-health'],
    queryFn: health.check,
    refetchInterval: 30000,
  });

  const { data: taskList, isLoading: tLoading } = useQuery({
    queryKey: ['admin-tasks'],
    queryFn: () => tasks.list(),
    refetchInterval: 10000,
  });

  const { data: slData, isLoading: slLoading } = useQuery({
    queryKey: ['sublibraries'],
    queryFn: subLibraries.list,
  });

  const { data: activityData } = useQuery({
    queryKey: ['activity-log'],
    queryFn: () => activityLog.getRecent(10),
    refetchInterval: 15000,
  });

  const { data: spaceData } = useQuery({
    queryKey: ['space-stats'],
    queryFn: spaceStats.get,
    refetchInterval: 30000,
  });

  const { data: userData } = useQuery({
    queryKey: ['emby-users', embyServerId],
    queryFn: () => emby.getUsers(embyServerId),
    enabled: step === 2 && !!embyServerId,
  });

  const { data: folderData } = useQuery({
    queryKey: ['emby-folders', embyServerId],
    queryFn: () => emby.getMediaFolders(embyServerId),
    enabled: step === 3 && !!embyServerId,
  });

  const { data: mpSites } = useQuery({
    queryKey: ['mp-sites'],
    queryFn: moviepilot.getSites,
    staleTime: 60000,
  });

  const deleteMut = useMutation({
    mutationFn: subLibraries.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sublibraries'] }); setAlert({ type: 'success', msg: '媒体库已删除' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      subLibraries.create({
        name: subLibName,
        embyServerId,
        sectionId: selectedSectionId,
        source: 'emby',
        doubanEnabled,
        mediaPolicy: {
          target1080p: { '2': policy1080_2, '3': policy1080_3, '4': policy1080_4, '5': policy1080_5 },
          target4k: { '2': policy4k_2, '3': policy4k_3, '4': policy4k_4, '5': policy4k_5 },
        },
        upgradeSmartSelect: {
          enabled: smartEnabled,
          codecPreference: smartCodecs,
          resolutionPreference: smartResolutions,
          audioPreference: smartAudios,
          sitePreference: smartSites,
          preferCNSub: smartCNSub,
          maxSizeGB: { target1080p: { '4': sizeLimit4_1080, '5': sizeLimit5_1080 }, target4k: { '4': sizeLimit4_4k, '5': sizeLimit5_4k } },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sublibraries'] });
      setAlert({ type: 'success', msg: '媒体库添加成功' });
      closeWizard();
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      subLibraries.update(editingUuid, {
        name: subLibName,
        doubanEnabled,
        mediaPolicy: {
          target1080p: { '2': policy1080_2, '3': policy1080_3, '4': policy1080_4, '5': policy1080_5 },
          target4k: { '2': policy4k_2, '3': policy4k_3, '4': policy4k_4, '5': policy4k_5 },
        },
        upgradeSmartSelect: {
          enabled: smartEnabled,
          codecPreference: smartCodecs,
          resolutionPreference: smartResolutions,
          audioPreference: smartAudios,
          sitePreference: smartSites,
          preferCNSub: smartCNSub,
          maxSizeGB: { target1080p: { '4': sizeLimit4_1080, '5': sizeLimit5_1080 }, target4k: { '4': sizeLimit4_4k, '5': sizeLimit5_4k } },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sublibraries'] });
      qc.invalidateQueries({ queryKey: ['space-stats'] });
      setAlert({ type: 'success', msg: '媒体库已更新' });
      setEditOpen(false);
      setEditingUuid('');
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  function openEdit(sl: SubLibrary) {
    setEditingUuid(sl.uuid);
    setSubLibName(sl.name);
    setDoubanEnabled(sl.doubanEnabled || false);
    const mp = sl.mediaPolicy || {};
    setPolicy1080_2(mp.target1080p?.['2'] ?? 2);
    setPolicy1080_3(mp.target1080p?.['3'] ?? 4);
    setPolicy1080_4(mp.target1080p?.['4'] ?? 7);
    setPolicy1080_5(mp.target1080p?.['5'] ?? 12);
    setPolicy4k_2(mp.target4k?.['2'] ?? 5);
    setPolicy4k_3(mp.target4k?.['3'] ?? 10);
    setPolicy4k_4(mp.target4k?.['4'] ?? 16);
    setPolicy4k_5(mp.target4k?.['5'] ?? 25);
    const ss = sl.upgradeSmartSelect || {};
    setSmartEnabled(ss.enabled || false);
    setSmartCodecs(ss.codecPreference || []);
    setSmartResolutions(ss.resolutionPreference || []);
    setSmartAudios(ss.audioPreference || []);
    setSmartSites(ss.sitePreference || []);
    const sz = ss.maxSizeGB || {};
    if (typeof sz === 'number') { setSizeLimit4_1080(0); setSizeLimit4_4k(0); setSizeLimit5_1080(0); setSizeLimit5_4k(0); }
    else { setSizeLimit4_1080(sz.target1080p?.['4']||0); setSizeLimit4_4k(sz.target4k?.['4']||0); setSizeLimit5_1080(sz.target1080p?.['5']||0); setSizeLimit5_4k(sz.target4k?.['5']||0); }
    setSmartCNSub(ss.preferCNSub || false);
    setEditOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
    setStep(1);
    setBaseUrl(''); setApiKey(''); setEmbyServerId('');
    setSelectedUserId(''); setSelectedSectionId(''); setSubLibName('');
    setDoubanEnabled(false);
    setSmartEnabled(false); setSmartCodecs([]); setSmartResolutions([]);
    setSmartAudios([]); setSmartSites([]);
    setSizeLimit4_1080(0); setSizeLimit4_4k(0); setSizeLimit5_1080(0); setSizeLimit5_4k(0);
    setSmartCNSub(false);
    setTestError('');
  }

  async function handleTestAndNext() {
    if (!baseUrl || !apiKey) { setTestError('请填写服务器地址和 API Key'); return; }
    setTesting(true);
    setTestError('');
    try {
      const result = await emby.testConnection({ baseUrl, apiKey, userId: '' });
      if (result.ok && result.embyServerId) {
        setEmbyServerId(result.embyServerId);
        setStep(2);
      } else {
        setTestError(result.message || '连接失败');
      }
    } catch (e: any) {
      setTestError(e.message || '连接测试失败');
    } finally {
      setTesting(false);
    }
  }

  if (hLoading || slLoading) return <LoadingSpinner />;

  const recentTasks: MediaTask[] = (taskList?.tasks || []).slice(0, 5);
  const subLibs: SubLibrary[] = slData?.subLibraries || [];

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: '#1a1a2e' }}>仪表盘</h2>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      <div style={{ marginBottom: 24 }}>
        <HealthCard status={h?.status || 'red'} checks={h?.checks as Record<string, { status: string; message?: string }> | undefined} />
      </div>

      {/* Media Libraries */}
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e', margin: 0 }}>媒体库</h3>
          <button
            onClick={() => setWizardOpen(true)}
            style={{ background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
          >
            添加媒体库
          </button>
        </div>

        {subLibs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
            暂无媒体库，点击「添加媒体库」开始配置
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {subLibs.map((sl) => {
              const slSpace = (spaceData?.subLibraries || []).find((s) => s.uuid === sl.uuid);
              const ss = sl.upgradeSmartSelect;
              const mp = sl.mediaPolicy || {};
              return (
                <div key={sl.uuid} style={{ border: '1px solid #e8e8e8', borderRadius: 12, padding: 16, background: '#fff' }}>
                  {/* Header bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 17, fontWeight: 700, color: '#1a1a2e' }}>{sl.name}</span>
                      <span style={{ fontSize: 12, color: '#999' }}>{slSpace ? `${slSpace.itemCount} 条目` : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(sl)} style={cardBtn}>编辑</button>
                      <button onClick={() => { if (confirm('确认删除此媒体库？')) deleteMut.mutate(sl.uuid); }} style={{ ...cardBtn, color: '#e74c3c', borderColor: '#f5c6cb' }}>删除</button>
                    </div>
                  </div>

                  {/* 2x2 sub-card grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {/* Sub-card 1: Sync Status */}
                    <SubCard title="同步状态">
                      <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                        <div>最后刷新: {sl.lastRefreshedAt ? new Date(sl.lastRefreshedAt).toLocaleString() : '—'}</div>
                        <div>豆瓣同步: {sl.doubanEnabled ? (sl.doubanSyncedAt ? new Date(sl.doubanSyncedAt).toLocaleString() : '等待中') : '未启用'}</div>
                      </div>
                    </SubCard>

                    {/* Sub-card 2: Bitrate Targets */}
                    <SubCard title="码率目标 (Mbps)">
                      <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                          <tr style={{ color: '#666' }}>
                            <th style={{ padding: '2px 6px', textAlign: 'left' }}></th>
                            <th style={{ padding: '2px 6px' }}>2★</th><th style={{ padding: '2px 6px' }}>3★</th>
                            <th style={{ padding: '2px 6px' }}>4★</th><th style={{ padding: '2px 6px' }}>5★</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ padding: '2px 6px', color: '#888' }}>1080p</td>
                            {['2','3','4','5'].map(r => <td key={r} style={{ padding: '2px 6px', textAlign: 'center', fontWeight: 600 }}>{mp.target1080p?.[r] ?? '-'}</td>)}
                          </tr>
                          <tr>
                            <td style={{ padding: '2px 6px', color: '#888' }}>4K</td>
                            {['2','3','4','5'].map(r => <td key={r} style={{ padding: '2px 6px', textAlign: 'center', fontWeight: 600 }}>{mp.target4k?.[r] ?? '-'}</td>)}
                          </tr>
                        </tbody>
                      </table>
                      <div style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>策略引擎将依据上述目标码率计算推荐操作</div>
                    </SubCard>

                    {/* Sub-card 3: Smart Select or volume limits */}
                    <SubCard title={ss?.enabled ? '智能洗版 · 已开启' : '建议容量上限'}>
                      {ss?.enabled ? (
                        <div style={{ fontSize: 13, color: '#1565c0', marginBottom: 8, lineHeight: 1.6 }}>
                          {ss.codecPreference?.length > 0 && <span>{ss.codecPreference.map((c: string) => ({ h265: 'H.265', h264: 'H.264', dv: 'DV' }[c] || c)).join(' · ')} · </span>}
                          {ss.resolutionPreference?.length > 0 && <span>{ss.resolutionPreference.join(' · ')} · </span>}
                          {ss.audioPreference?.length > 0 && <span>{ss.audioPreference.join(' · ')} · </span>}
                          {ss.preferCNSub && <span>中字</span>}
                          {ss.sitePreference?.length > 0 && <span>@{ss.sitePreference.join(',')}</span>}
                        </div>
                      ) : null}
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>容量上限 (GB) — 4★/5★:</div>
                      <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                          <tr style={{ color: '#888' }}>
                            <th style={{ padding: '1px 4px', textAlign: 'left' }}></th>
                            <th style={{ padding: '1px 4px' }}>4★</th><th style={{ padding: '1px 4px' }}>5★</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ padding: '1px 4px', color: '#888' }}>1080p</td>
                            {['4','5'].map(r => {
                              const sz = ss?.maxSizeGB && typeof ss.maxSizeGB === 'object' ? ss.maxSizeGB.target1080p?.[r] : 0;
                              const t = mp.target1080p?.[r];
                              const gb = sz || (t ? Math.round(t * 5400 / 8 / 1024 / 1024 * 1000) : 0);
                              return <td key={r} style={{ padding: '1px 4px', textAlign: 'center', fontWeight: sz ? 600 : 400, color: sz ? '#1565c0' : '#555' }}>{gb > 0 ? `≤${gb}GB` : '—'}</td>;
                            })}
                          </tr>
                          <tr>
                            <td style={{ padding: '1px 4px', color: '#888' }}>4K</td>
                            {['4','5'].map(r => {
                              const sz = ss?.maxSizeGB && typeof ss.maxSizeGB === 'object' ? ss.maxSizeGB.target4k?.[r] : 0;
                              const t = mp.target4k?.[r];
                              const gb = sz || (t ? Math.round(t * 5400 / 8 / 1024 / 1024 * 1000) : 0);
                              return <td key={r} style={{ padding: '1px 4px', textAlign: 'center', fontWeight: sz ? 600 : 400, color: sz ? '#1565c0' : '#555' }}>{gb > 0 ? `≤${gb}GB` : '—'}</td>;
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </SubCard>

                    {/* Sub-card 4: Space Stats */}
                    <SubCard title="空间统计">
                      {slSpace ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <MiniStat label="当前容量" value={fmtSizeBytes(slSpace.currentBytes)} color="#1a1a2e" />
                          <MiniStat label="预期容量" value={fmtSizeBytes(slSpace.expectedBytes)} color="#2e7d32" />
                          <MiniStat label="可回收" value={fmtSizeBytes(slSpace.transcode.expectedSavingsBytes + slSpace.delete.expectedSavingsBytes)} sub={`${slSpace.transcode.itemCount + slSpace.delete.itemCount} 条`} color="#1565c0" />
                          <MiniStat label="洗版增加" value={fmtSizeBytes(slSpace.upgrade.expectedIncreaseBytes)} sub={`${slSpace.upgrade.itemCount} 条`} color="#e65100" />
                        </div>
                      ) : <span style={{ fontSize: 12, color: '#999' }}>等待数据...</span>}
                    </SubCard>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Tasks */}
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: '#1a1a2e' }}>最近任务</h3>
        {tLoading ? (
          <LoadingSpinner text="加载任务中..." />
        ) : recentTasks.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>暂无任务</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={thStyle}>影片</th>
                <th style={thStyle}>类型</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>进度</th>
              </tr>
            </thead>
            <tbody>
              {recentTasks.map((t) => (
                <tr key={t.id}>
                  <td style={tdStyle}>{t.itemName || (t.itemInfo && t.itemInfo.name) || t.itemId}</td>
                  <td style={tdStyle}>{ACTION_TYPE_LABELS[t.actionType] || t.actionType}</td>
                  <td style={tdStyle}>{STATUS_LABELS[t.status] || t.status}</td>
                  <td style={tdStyle}>{Math.round(t.progress || 0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Real-time Activity Log */}
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#1a1a2e' }}>实时日志</h3>
        {!activityData?.entries || activityData.entries.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>暂无活动记录</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(activityData.entries as ActivityEntry[]).slice(0, 15).map((entry, i) => {
              const ts = new Date(entry.ts);
              const timeStr = ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const sourceLabel =
                entry.source === 'media_library' ? '媒体库' :
                entry.source === 'strategy_engine' ? '策略引擎' :
                entry.source === 'smart_task_engine' ? '智能入队' :
                entry.source === 'task' ? '任务' :
                entry.source === 'health' ? '健康' :
                entry.source === 'user_action' ? '用户' : entry.source;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <span style={{ color: '#888', whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
                  <span style={{ color: '#1a1a2e', fontWeight: 500, flexShrink: 0 }}>[{sourceLabel}]</span>
                  <span style={{ color: '#333' }}>{entry.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Wizard Modal */}
      <Modal open={wizardOpen} title={`添加媒体库 (${step}/5)`} onClose={closeWizard} width={560}>
        {step === 1 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>服务器地址</label>
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://192.168.1.100:8096"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder="Emby API Key"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            {testError && <Alert type="error" message={testError} onClose={() => setTestError('')} />}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={closeWizard} style={secondaryBtn}>取消</button>
              <button onClick={handleTestAndNext} disabled={testing} style={primaryBtn}>
                {testing ? '测试中...' : '下一步'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>选择该 Emby 服务器下的用户</p>
            <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
              <option value="">— 请选择 —</option>
              {(userData?.users || []).map((u: EmbyUser) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(1)} style={secondaryBtn}>上一步</button>
              <button onClick={() => setStep(3)} disabled={!selectedUserId} style={primaryBtn}>下一步</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>选择要同步的 Emby 媒体文件夹</p>
            <select value={selectedSectionId} onChange={(e) => setSelectedSectionId(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
              <option value="">— 请选择 —</option>
              {(folderData?.folders || []).map((f: MediaFolder) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(2)} style={secondaryBtn}>上一步</button>
              <button onClick={() => { setSubLibName((folderData?.folders || []).find((f: MediaFolder) => f.id === selectedSectionId)?.name || ''); setStep(4); }} disabled={!selectedSectionId} style={primaryBtn}>下一步</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>媒体库名称</label>
              <input type="text" value={subLibName} onChange={(e) => setSubLibName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={doubanEnabled} onChange={(e) => setDoubanEnabled(e.target.checked)} />
                启用豆瓣评分同步
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500 }}>码率策略 (Mbps)</label>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ padding: 4 }}></th>
                    <th style={{ padding: 4 }}>2★</th><th style={{ padding: 4 }}>3★</th>
                    <th style={{ padding: 4 }}>4★</th><th style={{ padding: 4 }}>5★</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: 4 }}>1080p</td>
                    {[[policy1080_2, setPolicy1080_2], [policy1080_3, setPolicy1080_3], [policy1080_4, setPolicy1080_4], [policy1080_5, setPolicy1080_5]].map(([val, setter], i) => (
                      <td key={i} style={{ padding: 4 }}>
                        <input type="number" value={val as number} onChange={(e) => (setter as (v: number) => void)(Number(e.target.value))}
                          min={0} style={{ width: 50, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td style={{ padding: 4 }}>4K</td>
                    {[[policy4k_2, setPolicy4k_2], [policy4k_3, setPolicy4k_3], [policy4k_4, setPolicy4k_4], [policy4k_5, setPolicy4k_5]].map(([val, setter], i) => (
                      <td key={i} style={{ padding: 4 }}>
                        <input type="number" value={val as number} onChange={(e) => (setter as (v: number) => void)(Number(e.target.value))}
                          min={0} style={{ width: 50, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(3)} style={secondaryBtn}>上一步</button>
              <button onClick={() => setStep(5)} disabled={!subLibName} style={primaryBtn}>下一步</button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>智能选种偏好（可选，留空则不启用）</p>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={smartEnabled} onChange={(e) => setSmartEnabled(e.target.checked)} />
              启用智能选种
            </label>

            {smartEnabled && (
              <div style={{ padding: '12px 16px', background: '#f8f9fb', borderRadius: 8, marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: '#999', marginTop: 0, marginBottom: 8 }}>所有偏好类别之间为 AND 关系，类别内部为 OR。空 = 不限制。</p>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>编码格式</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(['h265','h264','dv'] as const).map((opt) => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' }}>
                        <input type="checkbox" checked={smartCodecs.includes(opt)} onChange={() => setSmartCodecs(smartCodecs.includes(opt) ? smartCodecs.filter((x) => x !== opt) : [...smartCodecs, opt])} />
                        {{ h265: 'H.265', h264: 'H.264', dv: 'Dolby Vision' }[opt]}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>分辨率</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['4K','1080p','720p'].map((opt) => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' }}>
                        <input type="checkbox" checked={smartResolutions.includes(opt)} onChange={() => setSmartResolutions(smartResolutions.includes(opt) ? smartResolutions.filter((x) => x !== opt) : [...smartResolutions, opt])} />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>音轨</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['DTS','TrueHD','Atmos','AC3','AAC','FLAC'].map((opt) => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' }}>
                        <input type="checkbox" checked={smartAudios.includes(opt)} onChange={() => setSmartAudios(smartAudios.includes(opt) ? smartAudios.filter((x) => x !== opt) : [...smartAudios, opt])} />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>站点偏好</label>
                  {(!mpSites || mpSites.length === 0) ? (
                    <p style={{ fontSize: 12, color: '#999' }}>未获取到 MoviePilot 站点列表</p>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {mpSites.filter((s: MpSite) => s.is_active).map((s: MpSite) => (
                        <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' }}>
                          <input type="checkbox" checked={smartSites.includes(s.name)} onChange={() => setSmartSites(smartSites.includes(s.name) ? smartSites.filter((x) => x !== s.name) : [...smartSites, s.name])} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>容量上限 (GB) — 4★/5★</label>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr><th style={{padding:4}}></th><th style={{padding:4}}>4★</th><th style={{padding:4}}>5★</th></tr></thead>
                    <tbody>
                      <tr>
                        <td style={{padding:4,color:'#888'}}>1080p</td>
                        <td style={{padding:4}}><input type="number" value={sizeLimit4_1080||''} placeholder="0" min={0} onChange={e=>setSizeLimit4_1080(Math.max(0,parseInt(e.target.value)||0))} style={{width:60,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>
                        <td style={{padding:4}}><input type="number" value={sizeLimit5_1080||''} placeholder="0" min={0} onChange={e=>setSizeLimit5_1080(Math.max(0,parseInt(e.target.value)||0))} style={{width:60,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>
                      </tr>
                      <tr>
                        <td style={{padding:4,color:'#888'}}>4K</td>
                        <td style={{padding:4}}><input type="number" value={sizeLimit4_4k||''} placeholder="0" min={0} onChange={e=>setSizeLimit4_4k(Math.max(0,parseInt(e.target.value)||0))} style={{width:60,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>
                        <td style={{padding:4}}><input type="number" value={sizeLimit5_4k||''} placeholder="0" min={0} onChange={e=>setSizeLimit5_4k(Math.max(0,parseInt(e.target.value)||0))} style={{width:60,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: 12, color: '#999', marginTop: 4 }}>0 = 不限制。建议按码率目标折算（1080p 4★ ~4.5GB, 5★ ~7.7GB; 4K 4★ ~10.3GB, 5★ ~16.1GB）</p>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={smartCNSub} onChange={(e) => setSmartCNSub(e.target.checked)} />
                  必须含中文字幕
                </label>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(4)} style={secondaryBtn}>上一步</button>
              <button onClick={() => createMut.mutate()} disabled={!subLibName || createMut.isPending} style={primaryBtn}>
                {createMut.isPending ? '创建中...' : '完成添加'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal open={editOpen} title="编辑媒体库" onClose={() => { setEditOpen(false); setEditingUuid(''); }} width={560}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>媒体库名称</label>
          <input type="text" value={subLibName} onChange={(e) => setSubLibName(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={doubanEnabled} onChange={(e) => setDoubanEnabled(e.target.checked)} />
            启用豆瓣评分同步
          </label>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500 }}>码率策略 (Mbps)</label>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={{ padding: 4 }}></th><th style={{ padding: 4 }}>2★</th><th style={{ padding: 4 }}>3★</th><th style={{ padding: 4 }}>4★</th><th style={{ padding: 4 }}>5★</th></tr></thead>
            <tbody>
              <tr><td style={{ padding: 4 }}>1080p</td>
                {[[policy1080_2,setPolicy1080_2],[policy1080_3,setPolicy1080_3],[policy1080_4,setPolicy1080_4],[policy1080_5,setPolicy1080_5]].map(([v,s],i)=><td key={i} style={{padding:4}}><input type="number" value={v as number} onChange={e=>(s as (v:number)=>void)(Number(e.target.value))} min={0} style={{width:50,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>)}</tr>
              <tr><td style={{ padding: 4 }}>4K</td>
                {[[policy4k_2,setPolicy4k_2],[policy4k_3,setPolicy4k_3],[policy4k_4,setPolicy4k_4],[policy4k_5,setPolicy4k_5]].map(([v,s],i)=><td key={i} style={{padding:4}}><input type="number" value={v as number} onChange={e=>(s as (v:number)=>void)(Number(e.target.value))} min={0} style={{width:50,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>)}</tr>
            </tbody>
          </table>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={smartEnabled} onChange={(e) => setSmartEnabled(e.target.checked)} />
          启用智能选种
        </label>
        {smartEnabled && (
          <div style={{ padding: '12px 16px', background: '#f8f9fb', borderRadius: 8, marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>编码格式</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['h265','h264','dv'] as const).map(o=><label key={o} style={{display:'flex',alignItems:'center',gap:4,fontSize:14,cursor:'pointer'}}><input type="checkbox" checked={smartCodecs.includes(o)} onChange={()=>setSmartCodecs(smartCodecs.includes(o)?smartCodecs.filter(x=>x!==o):[...smartCodecs,o])}/>{({h265:'H.265',h264:'H.264',dv:'DV'} as Record<string,string>)[o]}</label>)}</div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>分辨率</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['4K','1080p','720p'].map(o=><label key={o} style={{display:'flex',alignItems:'center',gap:4,fontSize:14,cursor:'pointer'}}><input type="checkbox" checked={smartResolutions.includes(o)} onChange={()=>setSmartResolutions(smartResolutions.includes(o)?smartResolutions.filter(x=>x!==o):[...smartResolutions,o])}/>{o}</label>)}</div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>音轨</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['DTS','TrueHD','Atmos','AC3','AAC','FLAC'].map(o=><label key={o} style={{display:'flex',alignItems:'center',gap:4,fontSize:14,cursor:'pointer'}}><input type="checkbox" checked={smartAudios.includes(o)} onChange={()=>setSmartAudios(smartAudios.includes(o)?smartAudios.filter(x=>x!==o):[...smartAudios,o])}/>{o}</label>)}</div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>站点偏好</label>
              {(!mpSites || mpSites.length === 0) ? <p style={{ fontSize: 12, color: '#999' }}>未获取到 MoviePilot 站点列表</p> :
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {mpSites.filter((s: MpSite) => s.is_active).map((s: MpSite) => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' }}>
                      <input type="checkbox" checked={smartSites.includes(s.name)} onChange={() => setSmartSites(smartSites.includes(s.name) ? smartSites.filter(x => x !== s.name) : [...smartSites, s.name])} />
                      {s.name}
                    </label>
                  ))}
                </div>}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>容量上限 (GB) — 4★/5★</label>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><th style={{padding:4}}></th><th style={{padding:4}}>4★</th><th style={{padding:4}}>5★</th></tr></thead>
                <tbody>
                  <tr>
                    <td style={{padding:4,color:'#888'}}>1080p</td>
                    <td style={{padding:4}}><input type="number" value={sizeLimit4_1080||''} placeholder="0" min={0} onChange={e=>setSizeLimit4_1080(Math.max(0,parseInt(e.target.value)||0))} style={{width:60,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>
                    <td style={{padding:4}}><input type="number" value={sizeLimit5_1080||''} placeholder="0" min={0} onChange={e=>setSizeLimit5_1080(Math.max(0,parseInt(e.target.value)||0))} style={{width:60,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>
                  </tr>
                  <tr>
                    <td style={{padding:4,color:'#888'}}>4K</td>
                    <td style={{padding:4}}><input type="number" value={sizeLimit4_4k||''} placeholder="0" min={0} onChange={e=>setSizeLimit4_4k(Math.max(0,parseInt(e.target.value)||0))} style={{width:60,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>
                    <td style={{padding:4}}><input type="number" value={sizeLimit5_4k||''} placeholder="0" min={0} onChange={e=>setSizeLimit5_4k(Math.max(0,parseInt(e.target.value)||0))} style={{width:60,padding:'4px 8px',border:'1px solid #ddd',borderRadius:4,fontSize:13}}/></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={smartCNSub} onChange={e => setSmartCNSub(e.target.checked)} />
              必须含中文字幕
            </label>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={() => { setEditOpen(false); setEditingUuid(''); }} style={secondaryBtn}>取消</button>
          <button onClick={() => updateMut.mutate()} disabled={!subLibName || updateMut.isPending} style={primaryBtn}>
            {updateMut.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function fmtSizeBytes(bytes: number): string {
  if (bytes == null || bytes === 0) return '0 B';
  const abs = Math.abs(bytes);
  const sign = bytes < 0 ? '-' : '';
  if (abs >= 1024 * 1024 * 1024 * 1024) return sign + Math.round(abs / (1024 * 1024 * 1024 * 1024)) + ' TB';
  if (abs >= 1024 * 1024 * 1024) return sign + Math.round(abs / (1024 * 1024 * 1024)) + ' GB';
  if (abs >= 1024 * 1024) return sign + Math.round(abs / (1024 * 1024)) + ' MB';
  if (abs >= 1024) return sign + Math.round(abs / 1024) + ' KB';
  return sign + abs + ' B';
}

function SubCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#f8f9fb', borderRadius: 8, padding: 12, border: '1px solid #f0f0f0' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
      {children}
    </div>
  );
}

function MiniStat({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#888' }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: '#aaa' }}>{sub}</div>}
    </div>
  );
}

const cardBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #ddd', color: '#555',
  padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
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
