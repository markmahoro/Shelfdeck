import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subLibraries, emby, spaceStats, ruleTemplates, systemConfig, dashboardHealth } from '../api/client';
import type { DashboardEventEntry, DashboardHealthSummary, SubLibrary, MediaFolder, RuleTemplate } from '../types';
import Modal from '../components/Modal';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const FLOW_LABELS: Record<string, string> = {
  ingest: '入库', scrape: '刮削', transcode: '转码压缩', delete: '删除', upgrade: '洗版',
};

const TARGET_GATE_LABELS: Record<string, string> = {
  ingest: '入库',
  metadata: '元数据',
  optimize: '归档前目标',
  archive: '归档',
  delete: '处置',
};

const METADATA_GATE_FIELDS = [
  { id: 'identity.itemId', label: '条目 ID' },
  { id: 'identity.externalId', label: '外部 ID' },
  { id: 'identity.name', label: '名称' },
  { id: 'identity.seriesName', label: '剧名' },
  { id: 'identity.seasonNumber', label: '季号' },
  { id: 'media.path', label: '路径' },
  { id: 'media.size', label: '大小' },
  { id: 'media.duration', label: '时长' },
  { id: 'media.bitrate', label: '码率' },
  { id: 'media.resolution', label: '分辨率' },
  { id: 'media.codec', label: '编码' },
  { id: 'media.audioCodecs', label: '音频编码' },
  { id: 'identity.providerId', label: '外部 Provider ID' },
  { id: 'adult.scraped', label: '成人已刮削' },
  { id: 'adult.scrapeStatus', label: '成人刮削状态' },
  { id: 'adult.adultId', label: '番号' },
  { id: 'adult.title', label: '成人标题' },
  { id: 'adult.protagonist', label: '主角' },
];

const EMBY_BASE_METADATA_GATE = [
  'identity.itemId',
  'identity.externalId',
  'identity.name',
  'identity.seriesName',
  'identity.seasonNumber',
  'media.path',
  'media.size',
  'media.duration',
  'media.bitrate',
  'media.resolution',
  'media.codec',
];

const ADULT_BASE_METADATA_GATE = [
  'adult.scraped',
  'adult.scrapeStatus',
  'adult.adultId',
  'adult.title',
  'adult.protagonist',
  'media.path',
  'media.size',
  'media.duration',
  'media.bitrate',
  'media.resolution',
  'media.codec',
];

function gateFieldLabel(field: string) {
  return METADATA_GATE_FIELDS.find((f) => f.id === field)?.label || field;
}

function uniqueFields(fields: string[]) {
  return Array.from(new Set(fields.filter(Boolean)));
}

function sanitizeMetadataGateField(field: string) {
  if (field === 'decision.providerId') return 'identity.providerId';
  if (field.startsWith('decision.')) return '';
  return field;
}

function sanitizeMetadataGateFields(fields: string[]) {
  return uniqueFields(fields.map(sanitizeMetadataGateField));
}

function conditionField(condition: any) {
  if (Array.isArray(condition)) return typeof condition[0] === 'string' ? condition[0] : '';
  return typeof condition?.field === 'string' ? condition.field : '';
}

function mapStrategyField(field: string) {
  switch (field) {
    case 'bucket': return 'media.resolution';
    case 'equivalentBitrate':
    case 'bitrate': return 'media.bitrate';
    case 'duration': return 'media.duration';
    case 'size': return 'media.size';
    case 'codec': return 'media.codec';
    case 'audioCodecs': return 'media.audioCodecs';
    case 'path': return 'media.path';
    case 'tmdbId':
    case 'doubanId': return 'identity.providerId';
    case 'watched':
    case 'userRating':
    case 'doubanRating':
    case 'doubanStars':
    default: return '';
  }
}

function templateStrategyFields(template?: RuleTemplate) {
  const fields: string[] = [];
  for (const rule of template?.rules || []) {
    for (const group of rule.groups || []) {
      const rawConditions = Array.isArray(group) ? group : group.conditions || [];
      const groupFields = rawConditions.map(conditionField).filter(Boolean);
      for (const field of groupFields) {
        const mapped = mapStrategyField(field);
        if (mapped) fields.push(mapped);
      }
    }
    const targetFacts = rule.targetMediaFacts;
    if (
      targetFacts?.targetBitrate != null
      || (targetFacts?.targetBitrateByBucket && Object.values(targetFacts.targetBitrateByBucket).some((value) => value != null))
    ) {
      fields.push('media.duration');
    }
  }
  return uniqueFields(fields).sort();
}

function defaultMetadataGateFields(mediaType: string, ruleTemplateId: string, templates: RuleTemplate[]) {
  const tpl = templates.find((t) => t.id === ruleTemplateId);
  const base = mediaType === 'adult' ? ADULT_BASE_METADATA_GATE : EMBY_BASE_METADATA_GATE;
  return uniqueFields([...base, ...templateStrategyFields(tpl)]);
}

function gateFieldsFromConfig(gate: SubLibrary['metadataGate']) {
  const all = Array.isArray(gate?.all) ? gate.all : [];
  return uniqueFields(all
    .filter((node): node is string => typeof node === 'string')
    .map(sanitizeMetadataGateField));
}

function autoExecuteText(sl: SubLibrary) {
  const mode = (sl.automationMode || (sl.scheduleMode === 'full_manual' ? 'manual' : 'auto'));
  return mode === 'manual' ? '需要手动启动' : '自动开始执行';
}

function adultWatchRootPlaceholder(kind: 'emby' | 'japanese_jav' | 'western_adult') {
  if (kind === 'western_adult') return '/adult_media/US';
  if (kind === 'japanese_jav') return '/adult_media/JAV';
  return '/media/movies';
}

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
  const [metadataGateCustom, setMetadataGateCustom] = useState(false);
  const [metadataGateFields, setMetadataGateFields] = useState<string[]>([]);
  const [mediaType, setMediaType] = useState('movie');
  const [watchRoot, setWatchRoot] = useState('');
  const [pathMapFrom, setPathMapFrom] = useState('');
  const [pathMapTo, setPathMapTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editingUuid, setEditingUuid] = useState('');

  const { data: businessHealth, isLoading: businessHealthLoading } = useQuery({
    queryKey: ['dashboard-health'],
    queryFn: dashboardHealth.get,
    refetchInterval: 30000,
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sublibraries'] }); setAlert({ type: 'success', msg: '媒体库配置已移除' }); },
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
          metadataGate: metadataGateCustom ? { all: sanitizeMetadataGateFields(metadataGateFields) } : undefined,
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
          metadataGate: metadataGateCustom ? { all: sanitizeMetadataGateFields(metadataGateFields) } : undefined,
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
        metadataGate: metadataGateCustom ? { all: sanitizeMetadataGateFields(metadataGateFields) } : null,
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
    setMediaType(sl.mediaType || 'movie');
    const customFields = gateFieldsFromConfig(sl.metadataGate);
    setMetadataGateCustom(customFields.length > 0);
    setMetadataGateFields(customFields.length > 0
      ? customFields
      : defaultMetadataGateFields(sl.mediaType || 'movie', sl.ruleTemplateId || 'default', templates));
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
    setMetadataGateCustom(false);
    setMetadataGateFields([]);
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

  if (slLoading) return <LoadingSpinner text="加载媒体库中..." />;

  const subLibs: SubLibrary[] = slData?.subLibraries || [];
  const enabledAutoTargets = sysCfg?.automaticTaskTargets;
  const allowedOptimizeFlows = sysCfg?.optimizeAllowedOperations || [];
  const enabledAutoTargetText = !enabledAutoTargets
    ? '读取中'
    : enabledAutoTargets.length > 0
    ? `${enabledAutoTargets.map((gate) => TARGET_GATE_LABELS[gate] || gate).join('、')}${allowedOptimizeFlows.length > 0 ? `；Optimize flow：${allowedOptimizeFlows.map((flow) => FLOW_LABELS[flow] || flow).join('、')}` : ''}`
    : '未选择自动目标';

  function applyRuleTemplate(nextRuleTemplateId: string) {
    setRuleTemplateId(nextRuleTemplateId);
    if (!metadataGateCustom) {
      setMetadataGateFields(defaultMetadataGateFields(mediaType, nextRuleTemplateId, templates));
    }
  }

  function applyMediaType(nextMediaType: string) {
    setMediaType(nextMediaType);
    const nextRuleTemplateId = nextMediaType === 'tv' ? 'tv_default' : 'default';
    setRuleTemplateId(nextRuleTemplateId);
    if (!metadataGateCustom) {
      setMetadataGateFields(defaultMetadataGateFields(nextMediaType, nextRuleTemplateId, templates));
    }
  }

  function toggleMetadataGateCustom(enabled: boolean) {
    setMetadataGateCustom(enabled);
    if (enabled && metadataGateFields.length === 0) {
      setMetadataGateFields(defaultMetadataGateFields(mediaType, ruleTemplateId, templates));
    }
  }

  function toggleMetadataGateField(field: string) {
    setMetadataGateFields((current) => (
      current.includes(field)
        ? current.filter((value) => value !== field)
        : uniqueFields([...current, field])
    ));
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: '#1a1a2e' }}>仪表盘</h2>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      <DashboardHealthPanel
        data={businessHealth}
        loading={businessHealthLoading}
      />

      <DashboardActionStrip
        libraryCount={subLibs.length}
        onAddLibrary={() => setWizardOpen(true)}
      />

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
              const slMedia = (businessHealth?.media?.bySubLibrary || []).find((s) => s.subLibraryId === sl.uuid);
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
                      <span style={{ fontSize: 12, color: '#999' }}>{slMedia ? `${slMedia.totalItems} 条目` : (slSpace ? `${slSpace.itemCount} 条目` : '')}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(sl)} style={cardBtn}>编辑</button>
                      <button onClick={() => deleteSubLibrary(sl)} style={{ ...cardBtn, color: '#e74c3c', borderColor: '#f5c6cb' }}>移除库配置</button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                    {/* Sub-card 1: Sync Status */}
                    <SubCard title="同步状态">
                      <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                        <div>最后入库同步: {sl.lastRefreshedAt ? new Date(sl.lastRefreshedAt).toLocaleString() : '—'}</div>
                        <div>豆瓣同步: {sl.doubanEnabled ? (sl.doubanSyncedAt ? new Date(sl.doubanSyncedAt).toLocaleString() : '等待中') : '未启用'}</div>
                      </div>
                    </SubCard>

                    <SubCard title="生命周期阶段">
                      <StageCounts counts={slMedia?.byLifecycleStage || {}} total={slMedia?.totalItems || 0} />
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
                        策略模板中的规则决定归档前目标
                      </div>
                    </SubCard>

                    {/* Sub-card 3: Task execution after creation */}
                    <SubCard title="任务创建后">
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>
                        {autoExecuteText(sl)}
                      </div>
                      <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                        只控制已创建任务的启动方式，不负责自动创建任务
                      </div>
                      <div style={{ fontSize: 11, color: enabledAutoTargets && enabledAutoTargets.length === 0 ? '#c2410c' : '#6b7280', marginTop: 4 }}>
                        自动推进目标：{enabledAutoTargetText}
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

      <DashboardEventFeed entries={businessHealth?.events?.recent || []} />

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
                  { key: 'western_adult', title: '欧美成人', desc: '真实目录' },
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
                        if (!metadataGateCustom) setMetadataGateFields(defaultMetadataGateFields('adult', 'adult_jav_default', templates));
                        setSubLibName('JAV');
                      } else if (next === 'western_adult') {
                        setMediaType('adult');
                        setRuleTemplateId('adult_western_default');
                        if (!metadataGateCustom) setMetadataGateFields(defaultMetadataGateFields('adult', 'adult_western_default', templates));
                        setSubLibName('欧美成人');
                      } else {
                        setMediaType('movie');
                        setRuleTemplateId('default');
                        if (!metadataGateCustom) setMetadataGateFields(defaultMetadataGateFields('movie', 'default', templates));
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
              <button onClick={() => libraryKind === 'emby' ? handleTestAndNext() : setStep(3)} disabled={testing} style={primaryBtn}>
                {libraryKind === 'emby' ? (testing ? '登录中...' : '登录 Emby') : '下一步'}
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
                    placeholder={adultWatchRootPlaceholder(libraryKind)}
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
              <select value={mediaType} onChange={(e) => applyMediaType(e.target.value)}
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
              <select value={ruleTemplateId} onChange={(e) => applyRuleTemplate(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                在「策略模板管理」页面编辑模板规则
              </div>
            </div>
            <MetadataGateEditor
              custom={metadataGateCustom}
              fields={metadataGateFields}
              defaultFields={defaultMetadataGateFields(mediaType, ruleTemplateId, templates)}
              onCustomChange={toggleMetadataGateCustom}
              onToggleField={toggleMetadataGateField}
            />
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
          <select value={ruleTemplateId} onChange={(e) => applyRuleTemplate(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
            种子体积上限由策略模板规则定义 — 在「策略模板管理」页面编辑
          </div>
        </div>
        <MetadataGateEditor
          custom={metadataGateCustom}
          fields={metadataGateFields}
          defaultFields={defaultMetadataGateFields(mediaType, ruleTemplateId, templates)}
          onCustomChange={toggleMetadataGateCustom}
          onToggleField={toggleMetadataGateField}
        />

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

function MetadataGateEditor({
  custom,
  fields,
  defaultFields,
  onCustomChange,
  onToggleField,
}: {
  custom: boolean;
  fields: string[];
  defaultFields: string[];
  onCustomChange: (enabled: boolean) => void;
  onToggleField: (field: string) => void;
}) {
  const visibleFields = custom ? fields : defaultFields;
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>元数据完整 Gate</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => onCustomChange(false)}
          style={custom ? secondaryBtn : primaryBtn}
        >
          系统默认
        </button>
        <button
          type="button"
          onClick={() => onCustomChange(true)}
          style={custom ? primaryBtn : secondaryBtn}
        >
          自定义
        </button>
      </div>
      {!custom ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {visibleFields.map((field) => (
            <span key={field} style={gateChipStyle}>{gateFieldLabel(field)}</span>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8 }}>
          {METADATA_GATE_FIELDS.map((field) => (
            <label key={field.id} style={gateCheckStyle}>
              <input
                type="checkbox"
                checked={fields.includes(field.id)}
                onChange={() => onToggleField(field.id)}
              />
              <span>{field.label}</span>
            </label>
          ))}
        </div>
      )}
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

function healthTone(status?: DashboardHealthSummary['status']) {
  if (status === 'red') return { label: '异常', color: '#c62828', bg: '#ffebee' };
  if (status === 'green') return { label: '正常', color: '#2e7d32', bg: '#e8f5e9' };
  return { label: '降级', color: '#b45309', bg: '#fff7ed' };
}

const LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  source_discovered: 'source/discovered',
  ingested: 'ingested',
  metadata_ready: 'metadata-ready',
  optimized: 'optimized',
  archived: 'archived',
  unknown: 'unknown',
};

const LIFECYCLE_STAGE_ORDER = ['source_discovered', 'ingested', 'metadata_ready', 'optimized', 'archived', 'unknown'];

function lifecycleStageEntries(counts: Record<string, number>) {
  const seen = new Set<string>();
  const ordered = LIFECYCLE_STAGE_ORDER
    .filter((key) => {
      seen.add(key);
      return Number(counts[key] || 0) > 0;
    })
    .map((key) => [key, Number(counts[key] || 0)] as const);
  const extra = Object.entries(counts || {})
    .filter(([key, count]) => !seen.has(key) && Number(count || 0) > 0)
    .map(([key, count]) => [key, Number(count || 0)] as const);
  return [...ordered, ...extra];
}

function StatusGroupCard({
  title,
  group,
  emptyText = '等待健康检查',
}: {
  title: string;
  group?: DashboardHealthSummary['serviceAvailability'];
  emptyText?: string;
}) {
  const tone = healthTone(group?.status);
  const checks = group?.checks || [];
  return (
    <SubCard title={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: tone.color }}>{tone.label}</span>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: tone.color }} />
      </div>
      {checks.length === 0 ? (
        <div style={{ fontSize: 12, color: '#888' }}>{emptyText}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {checks.map((check) => {
            const checkTone = healthTone(check.status);
            return (
              <div key={check.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: '#333', fontWeight: 700 }}>{check.label}</span>
                <span title={check.message || check.label} style={{ color: checkTone.color, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {check.message || checkTone.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </SubCard>
  );
}

function StageCounts({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = lifecycleStageEntries(counts);
  if (!total || entries.length === 0) {
    return <div style={{ fontSize: 12, color: '#999' }}>暂无条目</div>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {entries.map(([key, count]) => (
        <span
          key={key}
          title={`${LIFECYCLE_STAGE_LABELS[key] || key}: ${count}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 7px',
            borderRadius: 6,
            background: key === 'archived' ? '#e8f5e9' : '#eef2ff',
            color: key === 'archived' ? '#2e7d32' : '#1f3a8a',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <span>{LIFECYCLE_STAGE_LABELS[key] || key}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</span>
        </span>
      ))}
    </div>
  );
}

function DashboardActionStrip({ libraryCount, onAddLibrary }: { libraryCount: number; onAddLibrary: () => void }) {
  return (
    <div style={actionStripStyle}>
      <div>
        <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, marginBottom: 4 }}>关键入口</div>
        <div style={{ fontSize: 15, color: '#1a1a2e', fontWeight: 800 }}>
          {libraryCount > 0 ? `${libraryCount} 个媒体库已接入` : '还没有媒体库'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onAddLibrary} style={primaryBtn}>添加媒体库</button>
        <DashboardLinkButton to="/tasks">任务中心</DashboardLinkButton>
        <DashboardLinkButton to="/media">媒体库</DashboardLinkButton>
      </div>
    </div>
  );
}

function DashboardLinkButton({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} style={linkBtnStyle}>
      {children}
    </Link>
  );
}

function DashboardHealthPanel({ data, loading }: { data?: DashboardHealthSummary; loading: boolean }) {
  const enabledTargets = data?.automation?.enabledTaskTargets || [];
  const allowedOptimizeFlows = data?.automation?.allowedOptimizeFlows || [];
  const enabledText = enabledTargets.length > 0
    ? enabledTargets.map((gate) => TARGET_GATE_LABELS[gate] || gate).join('、')
    : '未启用';
  const flowText = allowedOptimizeFlows.length > 0
    ? `Optimize 可用 flow：${allowedOptimizeFlows.map((flow) => FLOW_LABELS[flow] || flow).join('、')}`
    : '';

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>服务状态</h3>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            可用性与外部集成
          </div>
        </div>
      </div>

      {loading || !data ? (
        <LoadingSpinner text="加载服务状态中..." />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatusGroupCard title="服务可用性" group={data.serviceAvailability} />
            <StatusGroupCard title="外部集成" group={data.externalIntegrations} emptyText="未配置外部集成" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <SubCard title="自动推进">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: enabledTargets.length > 0 ? '#1a1a2e' : '#c2410c', lineHeight: 1.5 }}>
                    {enabledText}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                    {enabledTargets.length > 0 ? (flowText || '系统仅在已授权 target gate 内自动推进') : '自动推进当前关闭，可在任务调度中配置'}
                  </div>
                </div>
                <Link to="/system" style={{ ...linkBtnStyle, padding: '6px 10px', whiteSpace: 'nowrap' }}>
                  任务调度
                </Link>
              </div>
            </SubCard>
          </div>
        </>
      )}
    </div>
  );
}

function activitySourceMeta(source: string) {
  switch (source) {
    case 'media_library': return { label: '媒体库', color: '#1565c0', bg: '#e3f2fd' };
    case 'douban': return { label: '豆瓣', color: '#7b1fa2', bg: '#f3e5f5' };
    case 'strategy_engine':
    case 'optimize_target_projection':
      return { label: '优化目标', color: '#2e7d32', bg: '#e8f5e9' };
    case 'smart_task_engine': return { label: '自动入队', color: '#b45309', bg: '#fff7ed' };
    case 'task': return { label: '任务', color: '#1a1a2e', bg: '#eef0f4' };
    case 'task_event': return { label: '任务事件', color: '#1a1a2e', bg: '#eef0f4' };
    case 'health': return { label: '健康', color: '#047857', bg: '#d1fae5' };
    case 'user_action': return { label: '用户', color: '#6d28d9', bg: '#ede9fe' };
    default: return { label: source || '系统', color: '#4b5563', bg: '#f3f4f6' };
  }
}

function eventSeverityColor(entry: DashboardEventEntry, fallback: string) {
  if (entry.severity === 'red') return '#c62828';
  if (entry.severity === 'yellow') return '#b45309';
  if (entry.severity === 'green') return '#2e7d32';
  return fallback;
}

function DashboardEventFeed({ entries }: { entries: DashboardEventEntry[] }) {
  const latest = entries[0] ? new Date(entries[0].ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>系统事件</h3>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            {latest ? `最近更新 ${latest}` : '等待后台事件'}
          </div>
        </div>
        <a href="/v1/admin/log" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#666', textDecoration: 'none', fontWeight: 700 }}>
          完整记录
        </a>
      </div>
      {entries.length === 0 ? (
        <div style={{ color: '#888', fontSize: 14, padding: '8px 0' }}>暂无事件</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {entries.slice(0, 15).map((entry, i) => {
            const ts = new Date(entry.ts);
            const timeStr = ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const source = activitySourceMeta(entry.source);
            const eventColor = eventSeverityColor(entry, source.color);
            return (
              <div key={`${entry.ts}-${i}`} style={eventRowStyle}>
                <div style={eventStemStyle}>
                  <span style={{ ...eventDotStyle, background: eventColor }} />
                </div>
                <div style={{ width: 78, color: '#888', flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{timeStr}</div>
                <span style={{ ...eventSourceStyle, color: source.color, background: source.bg }}>{entry.sourceLabel || source.label}</span>
                <div style={{ color: '#333', fontSize: 13, lineHeight: 1.5, minWidth: 0 }}>{entry.message}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

const actionStripStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
  background: '#fff',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  marginBottom: 24,
  border: '1px solid #eef0f4',
};

const linkBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 34,
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid #d7dbe3',
  color: '#1a1a2e',
  textDecoration: 'none',
  fontSize: 14,
  fontWeight: 700,
  background: '#fff',
  boxSizing: 'border-box',
};

const eventRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  minHeight: 32,
  padding: '5px 0',
  position: 'relative',
};

const eventStemStyle: React.CSSProperties = {
  width: 14,
  minHeight: 32,
  position: 'relative',
  flexShrink: 0,
  borderLeft: '1px solid #e5e7eb',
  marginLeft: 5,
};

const eventDotStyle: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  left: -5,
  width: 9,
  height: 9,
  borderRadius: '50%',
  border: '2px solid #fff',
  boxShadow: '0 0 0 1px #e5e7eb',
};

const eventSourceStyle: React.CSSProperties = {
  flexShrink: 0,
  minWidth: 62,
  textAlign: 'center',
  padding: '2px 7px',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 800,
  lineHeight: 1.5,
};

const primaryBtn: React.CSSProperties = {
  background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const secondaryBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const gateChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 24,
  padding: '2px 8px',
  borderRadius: 6,
  background: '#f3f4f6',
  color: '#374151',
  fontSize: 12,
  fontWeight: 600,
};

const gateCheckStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 32,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #e5e7eb',
  background: '#fff',
  fontSize: 12,
  color: '#374151',
};
