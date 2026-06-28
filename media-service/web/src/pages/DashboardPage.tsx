import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { health, tasks, subLibraries, emby, activityLog, spaceStats, ruleTemplates, systemConfig } from '../api/client';
import type { ActivityEntry } from '../api/client';
import type { SubLibrary, MediaFolder, MediaTask, RuleTemplate } from '../types';
import HealthCard from '../components/HealthCard';
import Modal from '../components/Modal';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const ACTION_TYPE_LABELS: Record<string, string> = {
  ingest: '入库', scrape: '刮削', transcode: '转码压缩', delete: '删除', upgrade: '洗版',
};

const STATUS_LABELS: Record<string, string> = {
  created: '已创建', pending_manual: '待手动', queued: '排队中', executing: '执行中',
  pausing: '暂停中...', awaiting_user_confirm: '等待确认', paused: '已暂停',
  interrupted: '已中断', done: '已完成', failed_hard: '失败',
};
const TERMINAL_TASK_STATUSES = new Set(['done', 'failed_hard', 'cancelled', 'skipped', 'deleted']);

export default function DashboardPage() {
  const qc = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Wizard state
  const [libraryKind, setLibraryKind] = useState<'emby' | 'japanese_jav' | 'western_adult'>('emby');
  const [baseUrl, setBaseUrl] = useState('');
  const [embyUsername, setEmbyUsername] = useState('');
  const [embyPassword, setEmbyPassword] = useState('');
  const [embyServerId, setEmbyServerId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [subLibName, setSubLibName] = useState('');
  const [doubanEnabled, setDoubanEnabled] = useState(false);
  const [ruleTemplateId, setRuleTemplateId] = useState('default');
  const [mediaType, setMediaType] = useState('movie');
  const [watchRoot, setWatchRoot] = useState('');
  const [pathMapFrom, setPathMapFrom] = useState('');
  const [pathMapTo, setPathMapTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editingUuid, setEditingUuid] = useState('');

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

  const { data: sysCfg } = useQuery({
    queryKey: ['system-config-dashboard'],
    queryFn: systemConfig.get,
    refetchInterval: 30000,
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

  const { data: folderData } = useQuery({
    queryKey: ['emby-folders', embyServerId],
    queryFn: () => emby.getMediaFolders(embyServerId),
    enabled: step === 2 && !!embyServerId,
  });

  const { data: rtData } = useQuery({
    queryKey: ['ruleTemplates'],
    queryFn: () => ruleTemplates.list(),
  });
  const templates: RuleTemplate[] = rtData?.ruleTemplates || [];

  const deleteMut = useMutation({
    mutationFn: subLibraries.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sublibraries'] }); setAlert({ type: 'success', msg: '媒体库已删除' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      libraryKind === 'emby'
        ? subLibraries.create({
          name: subLibName,
          embyServerId,
          sectionId: selectedSectionId,
          source: 'emby',
          doubanEnabled,
          ruleTemplateId,
          pathMapFrom: pathMapFrom || '',
          pathMapTo: pathMapTo || '',
          mediaType,
        })
        : subLibraries.create({
          name: subLibName,
          embyServerId: '',
          sectionId: '',
          source: 'folder',
          doubanEnabled: false,
          ruleTemplateId: 'adult_jav_default',
          mediaType: 'adult',
          adultRegion: libraryKind,
          scraperType: libraryKind === 'japanese_jav' ? 'shelfdeck_japanese_jav' : 'western_builtin',
          watchRoot,
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
        ruleTemplateId,
        pathMapFrom: pathMapFrom || '',
        pathMapTo: pathMapTo || '',
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
    setRuleTemplateId(sl.ruleTemplateId || 'default');
    setEditOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
    setStep(1);
    setLibraryKind('emby');
    setBaseUrl(''); setEmbyUsername(''); setEmbyPassword(''); setEmbyServerId('');
    setSelectedSectionId(''); setSubLibName('');
    setDoubanEnabled(false);
    setRuleTemplateId('default');
    setMediaType('movie');
    setWatchRoot('');
    setTestError('');
  }

  function deleteSubLibrary(sl: SubLibrary) {
    const name = sl.name || sl.uuid;
    const ok = confirm(`将删除 ShelfDeck 中「${name}」的媒体库配置和缓存条目。确认删除？`);
    if (ok) deleteMut.mutate(sl.uuid);
  }

  async function handleTestAndNext() {
    if (!baseUrl || !embyUsername || !embyPassword) { setTestError('请填写服务器地址、用户名和密码'); return; }
    setTesting(true);
    setTestError('');
    try {
      const result = await emby.testConnection({ baseUrl, apiKey: '', username: embyUsername, password: embyPassword, userId: '' });
      if (result.ok && result.embyServerId) {
        setEmbyServerId(result.embyServerId);
        setStep(2); // skip user selection — userId is auto-set from auth response
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

  const allVisibleTasks: MediaTask[] = taskList?.tasks || [];
  const currentTasks = allVisibleTasks.filter((t) => !TERMINAL_TASK_STATUSES.has(t.status)).slice(0, 5);
  const recentResultTasks = allVisibleTasks.filter((t) => TERMINAL_TASK_STATUSES.has(t.status)).slice(0, 5);
  const subLibs: SubLibrary[] = slData?.subLibraries || [];
  const enabledAutoActions = sysCfg?.smartTaskEnabledActions;
  const enabledAutoActionText = !enabledAutoActions
    ? '读取中'
    : enabledAutoActions.length > 0
    ? enabledAutoActions.map((a) => ACTION_TYPE_LABELS[a] || a).join('、')
    : '未选择任务类型';

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
              const tpl = templates.find((t) => t.id === (sl.ruleTemplateId || 'default'));
              const typeLabel = sl.mediaType === 'adult'
                ? (sl.adultRegion === 'western_adult' ? '欧美成人' : 'JAV')
                : (sl.mediaType || 'movie') === 'tv' ? '剧集' : '电影';
              const typeColor = sl.mediaType === 'adult'
                ? { bg: '#fff3e0', fg: '#ef6c00' }
                : (sl.mediaType || 'movie') === 'tv'
                ? { bg: '#e8f5e9', fg: '#2e7d32' }
                : { bg: '#e3f2fd', fg: '#1565c0' };
              return (
                <div key={sl.uuid} style={{ border: '1px solid #e8e8e8', borderRadius: 12, padding: 16, background: '#fff' }}>
                  {/* Header bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 17, fontWeight: 700, color: '#1a1a2e' }}>{sl.name}</span>
                      <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: typeColor.bg, color: typeColor.fg, fontWeight: 600 }}>{typeLabel}</span>
                      <span style={{ fontSize: 12, color: '#999' }}>{slSpace ? `${slSpace.itemCount} 条目` : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(sl)} style={cardBtn}>编辑</button>
                      <button onClick={() => deleteSubLibrary(sl)} style={{ ...cardBtn, color: '#e74c3c', borderColor: '#f5c6cb' }}>删除</button>
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

                    {/* Sub-card 2: Strategy Template */}
                    <SubCard title="策略模板">
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>
                        {tpl ? tpl.name : (sl.ruleTemplateId || '默认策略')}
                      </div>
                      {tpl?.description && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{tpl.description}</div>}
                      <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                        {tpl ? `${tpl.rules.length} 条规则` : '未配置'}
                      </div>
                      <div style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>
                        策略模板中的规则决定视频的推荐操作
                      </div>
                    </SubCard>

                    {/* Sub-card 3: Schedule Mode */}
                    <SubCard title="子库调度">
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
                        {((sl as any).automationMode || ((sl as any).scheduleMode === 'full_manual' ? 'manual' : 'auto')) === 'manual' ? '手动调度' : '自动调度'}
                      </div>
                      <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                        审批策略在「任务调度」页面独立配置
                      </div>
                      <div style={{ fontSize: 11, color: enabledAutoActions && enabledAutoActions.length === 0 ? '#c2410c' : '#6b7280', marginTop: 4 }}>
                        后台自动入队：{enabledAutoActionText}
                      </div>
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

      {/* Current Tasks */}
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e', margin: 0 }}>当前任务</h3>
          <span style={{ fontSize: 12, color: '#888' }}>只显示执行中、排队中、等待确认和已暂停的任务</span>
        </div>
        {tLoading ? (
          <LoadingSpinner text="加载任务中..." />
        ) : currentTasks.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>当前没有正在处理的任务</p>
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
              {currentTasks.map((t) => (
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

      {/* Recent Task Results */}
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e', margin: 0 }}>最近任务结果</h3>
          <span style={{ fontSize: 12, color: '#888' }}>按更新时间显示最近完成、失败或取消的任务</span>
        </div>
        {tLoading ? (
          <LoadingSpinner text="加载任务中..." />
        ) : recentResultTasks.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>暂无最近完成或失败的任务</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={thStyle}>影片</th>
                <th style={thStyle}>类型</th>
                <th style={thStyle}>结果</th>
                <th style={thStyle}>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {recentResultTasks.map((t) => (
                <tr key={t.id}>
                  <td style={tdStyle}>{t.itemName || (t.itemInfo && t.itemInfo.name) || t.itemId}</td>
                  <td style={tdStyle}>{ACTION_TYPE_LABELS[t.actionType] || t.actionType}</td>
                  <td style={tdStyle}>{STATUS_LABELS[t.status] || t.status}</td>
                  <td style={tdStyle}>{t.updatedAt ? new Date(t.updatedAt).toLocaleString() : '—'}</td>
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
                entry.source === 'douban' ? '豆瓣' :
                entry.source === 'strategy_engine' ? '策略引擎' :
                entry.source === 'smart_task_engine' ? '后台自动入队' :
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
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <a href="/v1/admin/log" target="_blank" style={{ fontSize: 12, color: '#888', textDecoration: 'none' }}>
            查看完整运行日志 →
          </a>
        </div>
      </div>

      {/* Add Wizard Modal */}
      <Modal open={wizardOpen} title={`添加媒体库 (${step}/3)`} onClose={closeWizard} width={560}>
        {step === 1 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500 }}>媒体库类型</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { key: 'emby', title: 'Emby 媒体库', desc: '电影/剧集' },
                  { key: 'japanese_jav', title: 'JAV', desc: '真实目录' },
                  { key: 'western_adult', title: '欧美成人', desc: '真实目录（待开放）' },
                ].map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => {
                      const next = k.key as 'emby' | 'japanese_jav' | 'western_adult';
                      setLibraryKind(next);
                      if (next === 'japanese_jav') {
                        setMediaType('adult');
                        setRuleTemplateId('adult_jav_default');
                        setSubLibName('JAV');
                      } else if (next === 'western_adult') {
                        setMediaType('adult');
                        setRuleTemplateId('adult_jav_default');
                        setSubLibName('欧美成人');
                      } else {
                        setMediaType('movie');
                        setRuleTemplateId('default');
                        setSubLibName('');
                      }
                    }}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 8,
                      border: libraryKind === k.key ? '2px solid #1a1a2e' : '1px solid #ddd',
                      background: libraryKind === k.key ? '#f5f6fb' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1a2e' }}>{k.title}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{k.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            {libraryKind === 'emby' ? (
            <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>服务器地址</label>
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://192.168.1.100:8096"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>Emby 用户名</label>
              <input type="text" value={embyUsername} onChange={(e) => setEmbyUsername(e.target.value)}
                placeholder="您的 Emby 登录用户名"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>Emby 密码</label>
              <input type="password" value={embyPassword} onChange={(e) => setEmbyPassword(e.target.value)}
                placeholder="您的 Emby 登录密码"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
              <p style={{ fontSize: 11, color: '#999', marginTop: 4 }}>密码仅用于登录 Emby 获取授权，不会明文存储</p>
            </div>
            {testError && <Alert type="error" message={testError} onClose={() => setTestError('')} />}
            </>
            ) : (
              <div style={{ padding: 12, background: '#f8f9fb', borderRadius: 8, fontSize: 13, color: '#666', lineHeight: 1.6 }}>
                文件夹库记录真实媒体目录；是否自动创建入库、刮削或转码任务，由「任务调度」里的后台自动入队统一控制。本页不提供独立自动扫描或自动刮削开关。
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={closeWizard} style={secondaryBtn}>取消</button>
              <button onClick={() => libraryKind === 'emby' ? handleTestAndNext() : setStep(3)} disabled={testing || libraryKind === 'western_adult'} style={primaryBtn}>
                {libraryKind === 'emby' ? (testing ? '登录中...' : '登录 Emby') : libraryKind === 'western_adult' ? '暂未开放' : '下一步'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
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
              <button onClick={() => setStep(1)} style={secondaryBtn}>上一步</button>
              <button onClick={() => {
                const folder = (folderData?.folders || []).find((f: MediaFolder) => f.id === selectedSectionId);
                setSubLibName(folder?.name || '');
                const ct = folder?.collectionType || '';
                setMediaType(ct === 'tvshows' ? 'tv' : 'movie');
                setRuleTemplateId(ct === 'tvshows' ? 'tv_default' : 'default');
                setStep(3);
              }} disabled={!selectedSectionId} style={primaryBtn}>下一步</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>媒体库名称</label>
              <input type="text" value={subLibName} onChange={(e) => setSubLibName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            {libraryKind !== 'emby' && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>监控目录</label>
                  <input type="text" value={watchRoot} onChange={(e) => setWatchRoot(e.target.value)}
                    placeholder="E:\\my_project\\emby_third_party\\jav_test"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </>
            )}
            {libraryKind === 'emby' && (
            <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>路径映射（Emby → 本地）</label>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 8px' }}>用于转码/洗版时将 Emby 访问路径翻译为本地文件路径（前缀替换）</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" value={pathMapFrom} onChange={(e) => setPathMapFrom(e.target.value)}
                  placeholder="如 /volume1/Media"
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
                <span style={{ color: '#888' }}>→</span>
                <input type="text" value={pathMapTo} onChange={(e) => setPathMapTo(e.target.value)}
                  placeholder="如 Z:\\"
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>媒体类型</label>
              <select value={mediaType} onChange={(e) => { const mt = e.target.value; setMediaType(mt); setRuleTemplateId(mt === 'tv' ? 'tv_default' : 'default'); }}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
                <option value="movie">电影</option>
                <option value="tv">剧集</option>
              </select>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                {mediaType === 'tv' ? '自动选择剧集策略模板（码率阈值低于电影一档）' : '使用电影默认策略模板'}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={doubanEnabled} onChange={(e) => setDoubanEnabled(e.target.checked)} />
                启用豆瓣评分同步
              </label>
            </div>
            </>
            )}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>策略模板</label>
              <select value={ruleTemplateId} onChange={(e) => setRuleTemplateId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                在「策略模板管理」页面编辑模板规则
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(libraryKind === 'emby' ? 2 : 1)} style={secondaryBtn}>上一步</button>
              <button onClick={() => createMut.mutate()} disabled={!subLibName || (libraryKind !== 'emby' && !watchRoot) || createMut.isPending} style={primaryBtn}>
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
          <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>策略模板</label>
          <select value={ruleTemplateId} onChange={(e) => setRuleTemplateId(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
            种子体积上限由策略模板规则定义 — 在「策略模板管理」页面编辑
          </div>
        </div>

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
