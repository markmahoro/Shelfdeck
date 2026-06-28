import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemConfig, subLibraries } from '../api/client';
import type { ApprovalMode, ApprovalPolicyConfig, SubLibrary } from '../types';
import type { PriorityRule } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

type ActionType = 'ingest' | 'scrape' | 'delete' | 'upgrade' | 'transcode';
type PriorityMatch = NonNullable<PriorityRule['match']>;
type PriorityMatchKey = keyof PriorityMatch;

interface SubLibScheduleState {
  automationMode: 'auto' | 'manual';
  approvalPolicy: ApprovalPolicyConfig;
  priorityWeight: number;
}

const ACTIONS: Array<{ key: ActionType; label: string }> = [
  { key: 'ingest', label: '入库' },
  { key: 'scrape', label: '刮削' },
  { key: 'delete', label: '删除' },
  { key: 'upgrade', label: '洗版' },
  { key: 'transcode', label: '转码压缩' },
];

const APPROVAL_GATES: Array<{ key: string; label: string; desc: string; force?: boolean }> = [
  { key: 'delete.beforeExecute', label: '删除前确认', desc: '真正删除 Emby 项和文件前是否需要用户确认' },
  { key: 'transcode.dolbyVisionTonemap', label: '杜比视界转码', desc: '遇到 Dolby Vision 片源是否需要人工确认 tone-map 风险' },
  { key: 'transcode.beforeReplace', label: '转码替换前', desc: '转码产物替换原文件前是否需要确认' },
  { key: 'upgrade.candidateSelect', label: '洗版选种', desc: 'MoviePilot 候选版本选择是否交给系统自动完成' },
  { key: 'upgrade.identityMismatch', label: '洗版身份异常', desc: 'TMDB、季信息或暂存文件不一致时必须人工确认', force: true },
  { key: 'upgrade.beforeReplace', label: '洗版替换前', desc: '洗版产物替换原文件前是否需要确认' },
  { key: 'scrape.beforeWriteMetadata', label: '刮削写元数据前', desc: '写入 NFO、海报和元数据前是否需要确认' },
  { key: 'scrape.beforeOrganize', label: '刮削整理目录前', desc: '刮削后移动/整理目录前是否需要确认' },
  { key: 'scrape.reviewResult', label: '刮削结果复核', desc: '刮削完成后是否需要用户复核结果' },
];

const DEFAULT_APPROVAL_POLICY: ApprovalPolicyConfig = {
  'delete.beforeExecute': 'confirm',
  'transcode.dolbyVisionTonemap': 'auto',
  'transcode.beforeReplace': 'confirm',
  'upgrade.candidateSelect': 'confirm',
  'upgrade.identityMismatch': 'forceConfirm',
  'upgrade.beforeReplace': 'confirm',
  'scrape.beforeWriteMetadata': 'auto',
  'scrape.beforeOrganize': 'auto',
  'scrape.reviewResult': 'auto',
};

const DEFAULT_ACTION_WEIGHTS: Record<ActionType, number> = {
  ingest: 60,
  scrape: 80,
  delete: 90,
  upgrade: 110,
  transcode: 130,
};

const DEFAULT_COOLDOWNS: Record<ActionType, number> = {
  ingest: 6,
  scrape: 6,
  delete: 48,
  upgrade: 48,
  transcode: 48,
};

const DEFAULT_QUEUE_LIMITS: Record<ActionType, number> = {
  ingest: 50,
  scrape: 20,
  delete: 50,
  upgrade: 50,
  transcode: 50,
};

function modeLabel(mode: ApprovalMode): string {
  if (mode === 'auto') return '自动';
  if (mode === 'forceConfirm') return '强制确认';
  return '需要确认';
}

function normalizeApprovalPolicy(policy?: ApprovalPolicyConfig): ApprovalPolicyConfig {
  return { ...DEFAULT_APPROVAL_POLICY, ...(policy || {}), 'upgrade.identityMismatch': 'forceConfirm' };
}

function firstMatchKey(match: PriorityMatch = {}): string {
  return Object.keys(match)[0] || 'subLibraryId';
}

function setSingleMatch(_match: PriorityMatch = {}, key: string): PriorityMatch {
  if (key === 'isDiscLike' || key === 'isDolbyVision') return { [key]: true } as PriorityMatch;
  if (key === 'type') return { type: 'movie' } as PriorityMatch;
  if (key === 'resolution') return { resolution: '4K' } as PriorityMatch;
  return { subLibraryId: '' } as PriorityMatch;
}

function setSingleMatchValue(match: PriorityMatch = {}, value: unknown): PriorityMatch {
  const key = firstMatchKey(match) as PriorityMatchKey;
  return { [key]: value } as PriorityMatch;
}

function MatchValueInput({ rule, subLibs, onChange }: {
  rule: PriorityRule;
  subLibs: SubLibrary[];
  onChange: (value: unknown) => void;
}) {
  const key = firstMatchKey(rule.match || {});
  const value = (rule.match || {})[key as PriorityMatchKey] as unknown;
  if (key === 'subLibraryId') {
    return (
      <select value={String(value || '')} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: 170 }}>
        <option value="">请选择媒体库</option>
        {subLibs.map((sl) => <option key={sl.uuid} value={sl.uuid}>{sl.name}</option>)}
      </select>
    );
  }
  if (key === 'isDiscLike' || key === 'isDolbyVision') {
    return (
      <select value={String(value === false ? 'false' : 'true')} onChange={(e) => onChange(e.target.value === 'true')} style={{ ...inputStyle, width: 90 }}>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    );
  }
  if (key === 'type') {
    return (
      <select value={String(value || 'movie')} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: 110 }}>
        <option value="movie">电影</option>
        <option value="episode">剧集</option>
      </select>
    );
  }
  return <input value={String(value || '')} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: 120 }} placeholder="4K / 1080" />;
}

export default function SystemConfigPage() {
  const qc = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [slSchedules, setSlSchedules] = useState<Record<string, SubLibScheduleState>>({});

  const [ingestConc, setIngestConc] = useState(1);
  const [deleteConc, setDeleteConc] = useState(3);
  const [transcodeConc, setTranscodeConc] = useState(1);
  const [upgradeConc, setUpgradeConc] = useState(1);
  const [scrapeConc, setScrapeConc] = useState(1);
  const [smartTaskMax, setSmartTaskMax] = useState(10);
  const [smartTaskActions, setSmartTaskActions] = useState<string[]>(['transcode', 'upgrade']);
  const [smartTaskInterval, setSmartTaskInterval] = useState(10);
  const [smartTaskLookback, setSmartTaskLookback] = useState(30);
  const [smartTaskQueueMax, setSmartTaskQueueMax] = useState(50);
  const [strategyInterval, setStrategyInterval] = useState(30);
  const [manualPrio, setManualPrio] = useState(0);
  const [autoPrioBase, setAutoPrioBase] = useState(100);
  const [actionWeights, setActionWeights] = useState<Record<ActionType, number>>(DEFAULT_ACTION_WEIGHTS);
  const [priorityRules, setPriorityRules] = useState<Record<ActionType, PriorityRule[]>>({
    ingest: [],
    scrape: [],
    delete: [],
    upgrade: [],
    transcode: [],
  });
  const [globalApprovalPolicy, setGlobalApprovalPolicy] = useState<ApprovalPolicyConfig>(DEFAULT_APPROVAL_POLICY);
  const [cooldowns, setCooldowns] = useState<Record<ActionType, number>>(DEFAULT_COOLDOWNS);
  const [queueLimits, setQueueLimits] = useState<Record<ActionType, number>>(DEFAULT_QUEUE_LIMITS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPriorityAdvanced, setShowPriorityAdvanced] = useState(false);
  const [showGlobalApproval, setShowGlobalApproval] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['system-config-full'],
    queryFn: async () => {
      const [sysCfg, slRes] = await Promise.all([
        systemConfig.get(),
        subLibraries.list().catch(() => ({ subLibraries: [] as SubLibrary[] })),
      ]);
      if (!initialized) {
        setIngestConc(sysCfg.ingestConcurrency ?? 1);
        setDeleteConc(sysCfg.deleteConcurrency ?? 3);
        setTranscodeConc(sysCfg.transcodeConcurrency ?? 1);
        setUpgradeConc(sysCfg.upgradeConcurrency ?? 1);
        setScrapeConc(sysCfg.scrapeConcurrency ?? 1);
        setSmartTaskMax(sysCfg.smartTaskMaxPerRun ?? 10);
        setSmartTaskActions(sysCfg.smartTaskEnabledActions ?? ['transcode', 'upgrade']);
        setSmartTaskInterval(sysCfg.smartTaskPollIntervalMinutes ?? 10);
        setSmartTaskLookback(sysCfg.smartTaskLookbackDays ?? 30);
        setSmartTaskQueueMax(sysCfg.smartTaskMaxQueueSize ?? 50);
        setStrategyInterval(sysCfg.strategyPollIntervalMinutes ?? 30);
        setManualPrio(sysCfg.taskPriority?.manualTaskPriority ?? 0);
        setAutoPrioBase(sysCfg.taskPriority?.autoTaskPriorityBase ?? 100);
        setActionWeights({ ...DEFAULT_ACTION_WEIGHTS, ...(sysCfg.taskPriority?.actionTypeWeights || {}) });
        setPriorityRules({
          ingest: sysCfg.taskPriority?.rules?.ingest || [],
          scrape: sysCfg.taskPriority?.rules?.scrape || [],
          delete: sysCfg.taskPriority?.rules?.delete || [],
          upgrade: sysCfg.taskPriority?.rules?.upgrade || [],
          transcode: sysCfg.taskPriority?.rules?.transcode || [],
        });
        setGlobalApprovalPolicy(normalizeApprovalPolicy(sysCfg.approvalPolicy));
        setCooldowns({ ...DEFAULT_COOLDOWNS, ...(sysCfg.taskAdmission?.cooldownHoursByAction || {}) });
        setQueueLimits({ ...DEFAULT_QUEUE_LIMITS, ...(sysCfg.taskAdmission?.maxQueuedByAction || {}) });
        const scheds: Record<string, SubLibScheduleState> = {};
        for (const sl of slRes.subLibraries || []) {
          const legacyManual = sl.scheduleMode === 'full_manual' || sl.autoCreate === false;
          scheds[sl.uuid] = {
            automationMode: sl.automationMode || (legacyManual ? 'manual' : 'auto'),
            approvalPolicy: normalizeApprovalPolicy(sl.approvalPolicy),
            priorityWeight: typeof sl.priorityWeight === 'number' ? sl.priorityWeight : 100,
          };
        }
        setSlSchedules(scheds);
        setInitialized(true);
      }
      return { sysCfg, subLibs: slRes.subLibraries || [] };
    },
  });

  const subLibs = data?.subLibs || [];

  function toggleAction(a: string) {
    setSmartTaskActions((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  }

  function updateSubLib(uuid: string, patch: Partial<SubLibScheduleState>) {
    setSlSchedules((prev) => ({ ...prev, [uuid]: { ...prev[uuid], ...patch } }));
  }

  function updatePolicy(policy: ApprovalPolicyConfig, gateId: string, mode: ApprovalMode): ApprovalPolicyConfig {
    return normalizeApprovalPolicy({ ...policy, [gateId]: gateId === 'upgrade.identityMismatch' ? 'forceConfirm' : mode });
  }

  function addPriorityRule(at: ActionType) {
    setPriorityRules((prev) => ({
      ...prev,
      [at]: [...(prev[at] || []), { match: { subLibraryId: subLibs[0]?.uuid || '' }, adjust: { op: 'subtract', value: 50 } }],
    }));
  }

  function updatePriorityRule(at: ActionType, idx: number, patch: Partial<PriorityRule>) {
    setPriorityRules((prev) => ({
      ...prev,
      [at]: (prev[at] || []).map((r, i) => (
        i === idx
          ? { ...r, ...patch, match: { ...r.match, ...(patch.match || {}) }, adjust: { ...r.adjust, ...(patch.adjust || {}) } }
          : r
      )),
    }));
  }

  function removePriorityRule(at: ActionType, idx: number) {
    setPriorityRules((prev) => ({ ...prev, [at]: (prev[at] || []).filter((_, i) => i !== idx) }));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const promises: Promise<unknown>[] = [
        systemConfig.patch({
          ingestConcurrency: ingestConc,
          deleteConcurrency: deleteConc,
          transcodeConcurrency: transcodeConc,
          upgradeConcurrency: upgradeConc,
          scrapeConcurrency: scrapeConc,
          smartTaskMaxPerRun: smartTaskMax,
          smartTaskEnabledActions: smartTaskActions,
          smartTaskPollIntervalMinutes: smartTaskInterval,
          smartTaskLookbackDays: smartTaskLookback,
          smartTaskMaxQueueSize: smartTaskQueueMax,
          strategyPollIntervalMinutes: strategyInterval,
          approvalPolicy: normalizeApprovalPolicy(globalApprovalPolicy),
          taskAdmission: {
            defaultCooldownHours: data?.sysCfg.taskAdmission?.defaultCooldownHours ?? 48,
            defaultMaxQueued: data?.sysCfg.taskAdmission?.defaultMaxQueued ?? 50,
            cooldownHoursByAction: cooldowns,
            maxQueuedByAction: queueLimits,
          },
          taskPriority: {
            manualTaskPriority: manualPrio,
            autoTaskPriorityBase: autoPrioBase,
            actionTypeWeights: actionWeights,
            rules: priorityRules,
          },
        }),
      ];

      for (const [uuid, sched] of Object.entries(slSchedules)) {
        const policy = normalizeApprovalPolicy(sched.approvalPolicy);
        promises.push(subLibraries.update(uuid, {
          automationMode: sched.automationMode,
          scheduleMode: sched.automationMode === 'manual' ? 'full_manual' : 'full_auto',
          autoCreate: sched.automationMode === 'auto',
          autoExecute: sched.automationMode === 'auto',
          approvalPolicy: policy,
          priorityWeight: sched.priorityWeight,
          autoReplaceTranscode: policy['transcode.beforeReplace'] === 'auto',
          autoReplaceUpgrade: policy['upgrade.beforeReplace'] === 'auto',
          smartSelectEnabled: policy['upgrade.candidateSelect'] === 'auto',
        }));
      }

      await Promise.all(promises);
      qc.invalidateQueries({ queryKey: ['system-config-full'] });
      qc.invalidateQueries({ queryKey: ['sublibraries'] });
    },
    onSuccess: () => setAlert({ type: 'success', msg: '任务调度与审批策略已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      <section style={cardStyle}>
        <h3 style={sectionTitle}>子库任务调度</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>调度只决定任务是否自动入队与自动执行；关键节点是否暂停由审批策略决定。</p>
        {subLibs.length === 0 ? (
          <div style={emptyStyle}>暂无子库，请先在仪表盘添加媒体库</div>
        ) : (
          subLibs.map((sl) => {
            const sched = slSchedules[sl.uuid];
            if (!sched) return null;
            return (
              <div key={sl.uuid} style={subLibBlock}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e' }}>{sl.name}</div>
                    <div style={hintStyle}>{sl.mediaType === 'adult' ? '成人影视库' : '普通媒体库'} · {sl.enabled ? '已启用' : '已停用'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['auto', 'manual'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateSubLib(sl.uuid, { automationMode: mode })}
                        style={sched.automationMode === mode ? modeBtnActive : modeBtn}
                      >
                        {mode === 'auto' ? '全自动' : '纯手动'}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, alignItems: 'center' }}>
                  <label style={labelStyle}>队列优先级权重</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      value={sched.priorityWeight}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        updateSubLib(sl.uuid, { priorityWeight: Number.isFinite(v) && v >= 0 ? v : 100 });
                      }}
                      style={{ ...inputStyle, width: 90 }}
                    />
                    <span style={hintStyle}>数值越小越优先；用于同类任务或全局队列排序。</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>审批策略</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>审批策略控制任务内部关键节点。子库未单独调整时，按全局策略执行；强制确认节点不可降级。</p>
        <button onClick={() => setShowGlobalApproval((v) => !v)} style={collapseBtn}>
          {showGlobalApproval ? '收起全局策略' : '展开全局策略'}
        </button>
        {showGlobalApproval && (
          <ApprovalPolicyEditor
            title="全局默认"
            policy={globalApprovalPolicy}
            onChange={setGlobalApprovalPolicy}
            updatePolicy={updatePolicy}
          />
        )}
        {subLibs.map((sl) => {
          const sched = slSchedules[sl.uuid];
          if (!sched) return null;
          return (
            <ApprovalPolicyEditor
              key={sl.uuid}
              title={sl.name}
              policy={sched.approvalPolicy}
              onChange={(policy) => updateSubLib(sl.uuid, { approvalPolicy: policy })}
              updatePolicy={updatePolicy}
              compact
            />
          );
        })}
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>任务并发数</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>执行阶段的全局并发上限。</p>
        <div style={fourColGrid}>
          <NumberField label="入库并发" value={ingestConc} min={1} max={10} onChange={setIngestConc} />
          <NumberField label="删除并发" value={deleteConc} min={1} max={10} onChange={setDeleteConc} />
          <NumberField label="转码并发" value={transcodeConc} min={1} max={10} onChange={setTranscodeConc} />
          <NumberField label="洗版并发" value={upgradeConc} min={1} max={10} onChange={setUpgradeConc} />
          <NumberField label="刮削并发" value={scrapeConc} min={1} max={10} onChange={setScrapeConc} />
        </div>
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>自动入队</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>自动入队决定“媒体库里的推荐策略”是否自动创建为任务；未勾选的类型只会显示推荐，不会自动出现在任务中心。</p>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>允许自动创建的任务类型</label>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {ACTIONS.filter((a) => a.key !== 'ingest').map((a) => (
              <label key={a.key} style={checkboxLabel}>
                <input type="checkbox" checked={smartTaskActions.includes(a.key)} onChange={() => toggleAction(a.key)} />
                {a.label}
              </label>
            ))}
          </div>
          {smartTaskActions.length === 0 ? (
            <div style={warningBox}>
              当前没有选择任何任务类型。媒体库仍会显示“转码压缩、洗版、删除、刮削”等推荐策略，但系统不会自动创建这些任务；需要手动执行，或在这里勾选对应类型后保存。
            </div>
          ) : (
            <div style={infoBox}>
              当前允许自动创建：{smartTaskActions.map((key) => ACTIONS.find((a) => a.key === key)?.label || key).join('、')}。
            </div>
          )}
          <div style={{ ...hintStyle, marginTop: 8 }}>入库任务由真实目录扫描和监听创建，不受这里的任务类型勾选控制。</div>
        </div>
        <button onClick={() => setShowAdvanced(!showAdvanced)} style={collapseBtn}>
          {showAdvanced ? '收起高级配置' : '展开高级配置'}
        </button>
        {showAdvanced && (
          <div style={advancedBox}>
            <div style={fourColGrid}>
              <NumberField label="每轮最多入队数" value={smartTaskMax} min={1} max={100} onChange={setSmartTaskMax} />
              <NumberField label="队列上限" value={smartTaskQueueMax} min={1} max={500} onChange={setSmartTaskQueueMax} />
              <NumberField label="轮询间隔（分钟）" value={smartTaskInterval} min={5} max={120} onChange={setSmartTaskInterval} />
              <NumberField label="策略计算间隔（分钟）" value={strategyInterval} min={10} max={360} onChange={setStrategyInterval} />
              <NumberField label="回溯天数" value={smartTaskLookback} min={1} max={365} onChange={setSmartTaskLookback} />
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>失败/重复入队冷却</div>
              <div style={fiveColGrid}>
                {ACTIONS.map((a) => (
                  <NumberField
                    key={a.key}
                    label={`${a.label}（小时）`}
                    value={cooldowns[a.key]}
                    min={0}
                    max={240}
                    onChange={(v) => setCooldowns((prev) => ({ ...prev, [a.key]: v }))}
                  />
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>自动队列上限</div>
              <div style={fiveColGrid}>
                {ACTIONS.map((a) => (
                  <NumberField
                    key={a.key}
                    label={a.label}
                    value={queueLimits[a.key]}
                    min={1}
                    max={500}
                    onChange={(v) => setQueueLimits((prev) => ({ ...prev, [a.key]: v }))}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>队列优先级</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>数值越小越优先。最终优先级由来源、任务类型、子库权重、规则和用户手动调整共同决定。</p>
        <div style={fourColGrid}>
          <NumberField label="手动任务基准" value={manualPrio} min={0} max={999} onChange={setManualPrio} />
          <NumberField label="自动任务基准" value={autoPrioBase} min={0} max={999} onChange={setAutoPrioBase} />
          {ACTIONS.map((a) => (
            <NumberField
              key={a.key}
              label={`${a.label}基准`}
              value={actionWeights[a.key]}
              min={0}
              max={999}
              onChange={(v) => setActionWeights((prev) => ({ ...prev, [a.key]: v }))}
            />
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setShowPriorityAdvanced((v) => !v)} style={collapseBtn}>
            {showPriorityAdvanced ? '收起高级优先级规则' : '展开高级优先级规则'}
          </button>
          {showPriorityAdvanced && (
            <div style={advancedBox}>
              <p style={{ ...hintStyle, marginBottom: 12 }}>规则按顺序叠加到基准值上：subtract 更优先，add 延后，set 设为绝对档位。</p>
              {ACTIONS.map((at) => (
                <div key={at.key} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{at.label}</div>
                  {(priorityRules[at.key] || []).map((rule, idx) => (
                    <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <select value={rule.adjust.op} onChange={(e) => updatePriorityRule(at.key, idx, { adjust: { ...rule.adjust, op: e.target.value as PriorityRule['adjust']['op'] } })} style={{ ...inputStyle, width: 90 }}>
                        <option value="subtract">更优先 -</option>
                        <option value="add">延后 +</option>
                        <option value="set">设为 =</option>
                      </select>
                      <input type="number" value={rule.adjust.value} onChange={(e) => updatePriorityRule(at.key, idx, { adjust: { ...rule.adjust, value: parseInt(e.target.value, 10) || 0 } })} style={{ ...inputStyle, width: 70 }} />
                      <span style={{ fontSize: 11, color: '#999' }}>当</span>
                      <select value={firstMatchKey(rule.match)} onChange={(e) => updatePriorityRule(at.key, idx, { match: setSingleMatch(rule.match, e.target.value) })} style={{ ...inputStyle, width: 120 }}>
                        <option value="subLibraryId">媒体库</option>
                        <option value="type">类型</option>
                        <option value="isDiscLike">原盘</option>
                        <option value="isDolbyVision">杜比视界</option>
                        <option value="resolution">分辨率前缀</option>
                      </select>
                      <MatchValueInput rule={rule} subLibs={subLibs} onChange={(val) => updatePriorityRule(at.key, idx, { match: setSingleMatchValue(rule.match, val) })} />
                      <button onClick={() => removePriorityRule(at.key, idx)} style={deleteTextBtn}>删除</button>
                    </div>
                  ))}
                  <button onClick={() => addPriorityRule(at.key)} style={dashBtn}>+ 添加规则</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={primaryBtn}>
          {saveMutation.isPending ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

function ApprovalPolicyEditor({ title, policy, onChange, updatePolicy, compact }: {
  title: string;
  policy: ApprovalPolicyConfig;
  onChange: (policy: ApprovalPolicyConfig) => void;
  updatePolicy: (policy: ApprovalPolicyConfig, gateId: string, mode: ApprovalMode) => ApprovalPolicyConfig;
  compact?: boolean;
}) {
  return (
    <div style={{ borderTop: '1px solid #eee', paddingTop: 12, marginTop: compact ? 12 : 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: '#1a1a2e' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) 1fr 150px', gap: 10, alignItems: 'center' }}>
        {APPROVAL_GATES.map((gate) => {
          const value = gate.force ? 'forceConfirm' : (policy[gate.key] || DEFAULT_APPROVAL_POLICY[gate.key] || 'confirm');
          return (
            <div key={gate.key} style={{ display: 'contents' }}>
              <div style={{ fontSize: 13, color: '#1a1a2e', fontWeight: 600 }}>{gate.label}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{gate.desc}</div>
              <select
                value={value}
                disabled={gate.force}
                onChange={(e) => onChange(updatePolicy(policy, gate.key, e.target.value as ApprovalMode))}
                style={{ ...inputStyle, width: 140, opacity: gate.force ? 0.65 : 1 }}
              >
                <option value="auto">{modeLabel('auto')}</option>
                <option value="confirm">{modeLabel('confirm')}</option>
                <option value="forceConfirm">{modeLabel('forceConfirm')}</option>
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10);
          const safe = Number.isFinite(parsed) ? parsed : min;
          onChange(Math.min(max, Math.max(min, safe)));
        }}
        style={{ ...inputStyle, width: 110 }}
      />
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 10,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

const subLibBlock: React.CSSProperties = {
  border: '1px solid #e8e8e8',
  borderRadius: 8,
  padding: 16,
  marginBottom: 14,
  background: '#fff',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  marginTop: 0,
  marginBottom: 16,
  color: '#1a1a2e',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 13,
  fontWeight: 600,
  color: '#1a1a2e',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
  background: '#fff',
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  marginTop: 4,
  marginBottom: 0,
};

const primaryBtn: React.CSSProperties = {
  background: '#1a1a2e',
  color: '#fff',
  border: 'none',
  padding: '8px 20px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
};

const modeBtn: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  color: '#555',
  padding: '6px 14px',
  cursor: 'pointer',
  fontSize: 13,
};

const modeBtnActive: React.CSSProperties = {
  ...modeBtn,
  borderColor: '#1a1a2e',
  color: '#1a1a2e',
  background: '#f8f9fb',
  fontWeight: 700,
};

const checkboxLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  cursor: 'pointer',
};

const collapseBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  color: '#1a1a2e',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 12px',
  fontWeight: 600,
};

const warningBox: React.CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 6,
  border: '1px solid #fed7aa',
  background: '#fff7ed',
  color: '#9a3412',
  fontSize: 13,
  lineHeight: 1.6,
};

const infoBox: React.CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 6,
  border: '1px solid #bfdbfe',
  background: '#eff6ff',
  color: '#1d4ed8',
  fontSize: 13,
  lineHeight: 1.6,
};

const advancedBox: React.CSSProperties = {
  marginTop: 12,
  padding: 14,
  background: '#f8f9fb',
  borderRadius: 8,
};

const fourColGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))',
  gap: 16,
};

const fiveColGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))',
  gap: 12,
};

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: 20,
  color: '#999',
  fontSize: 14,
};

const dashBtn: React.CSSProperties = {
  background: 'none',
  border: '1px dashed #bbb',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  color: '#666',
  cursor: 'pointer',
};

const deleteTextBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#e74c3c',
  cursor: 'pointer',
  fontSize: 13,
};
