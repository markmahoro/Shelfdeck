import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemConfig, subLibraries } from '../api/client';
import type { ApprovalMode, ApprovalPolicyConfig, SubLibrary } from '../types';
import type { PriorityRule } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

type ActionType = 'ingest' | 'scrape' | 'delete' | 'upgrade' | 'transcode';
type TaskTarget = 'ingest' | 'metadata' | 'optimize' | 'archive';
type OptimizeOperation = 'transcode' | 'upgrade' | 'delete';
type PriorityMatch = NonNullable<PriorityRule['match']>;
type PriorityMatchKey = keyof PriorityMatch;

interface SubLibScheduleState {
  automationMode: 'auto' | 'manual';
  approvalPolicy: ApprovalPolicyConfig;
  priorityWeight: number;
}

const TASK_TARGETS: Array<{ key: TaskTarget; label: string; desc: string }> = [
  { key: 'ingest', label: '自动入库', desc: '允许系统把外部候选纳入 ShelfDeck 管理' },
  { key: 'metadata', label: '自动补元数据', desc: '允许系统为元数据不完整的条目创建刮削/修复任务' },
  { key: 'optimize', label: '自动优化', desc: '允许系统为已具备优化目标的条目创建优化任务' },
  { key: 'archive', label: '自动归档', desc: '允许系统为已完成处理的条目创建闭环归档任务' },
];

const OPTIMIZE_OPERATIONS: Array<{ key: OptimizeOperation; label: string }> = [
  { key: 'transcode', label: '转码压缩' },
  { key: 'upgrade', label: '洗版' },
  { key: 'delete', label: '删除' },
];

const APPROVAL_GATES: Array<{ key: string; label: string; desc: string; force?: boolean }> = [
  { key: 'delete.beforeExecute', label: '删除前确认', desc: '真正删除 Emby 项或本地媒体文件/文件夹前是否需要用户确认' },
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

const DEFAULT_TARGET_GATE_WEIGHTS: Record<TaskTarget, number> = {
  ingest: 60,
  metadata: 80,
  optimize: 110,
  archive: 70,
};

const DEFAULT_OPTIMIZE_OPERATION_HINTS: Record<OptimizeOperation, number> = {
  transcode: 20,
  upgrade: 0,
  delete: -20,
};

const DEFAULT_GATE_COOLDOWNS: Record<TaskTarget, number> = {
  ingest: 6,
  metadata: 6,
  optimize: 48,
  archive: 0,
};

const DEFAULT_GATE_QUEUE_LIMITS: Record<TaskTarget, number> = {
  ingest: 50,
  metadata: 20,
  optimize: 50,
  archive: 50,
};

function modeLabel(mode: ApprovalMode): string {
  if (mode === 'auto') return '自动';
  if (mode === 'forceConfirm') return '强制确认';
  return '需要确认';
}

function normalizeApprovalPolicy(policy?: ApprovalPolicyConfig): ApprovalPolicyConfig {
  return { ...DEFAULT_APPROVAL_POLICY, ...(policy || {}), 'upgrade.identityMismatch': 'forceConfirm' };
}

function splitLegacySmartTaskActions(actions: string[] = []): { automaticTaskTargets: TaskTarget[]; optimizeAllowedOperations: OptimizeOperation[] } {
  const targets = new Set<TaskTarget>();
  const operations = new Set<OptimizeOperation>();
  for (const raw of actions) {
    const action = String(raw || '').trim().toLowerCase();
    if (action === 'ingest') targets.add('ingest');
    else if (action === 'scrape' || action === 'metadata') targets.add('metadata');
    else if (action === 'archive') targets.add('archive');
    else if (action === 'optimize') {
      targets.add('optimize');
      operations.add('transcode');
      operations.add('upgrade');
      operations.add('delete');
    } else if (action === 'transcode' || action === 'upgrade' || action === 'delete') {
      targets.add('optimize');
      operations.add(action);
    }
  }
  return { automaticTaskTargets: [...targets], optimizeAllowedOperations: [...operations] };
}

function projectLegacySmartTaskActions(targets: TaskTarget[], operations: OptimizeOperation[]): string[] {
  const actions: string[] = [];
  if (targets.includes('ingest')) actions.push('ingest');
  if (targets.includes('metadata')) actions.push('scrape');
  if (targets.includes('optimize')) actions.push(...operations);
  if (targets.includes('archive')) actions.push('archive');
  return actions;
}

function legacyActionWeightsToGateWeights(weights: Partial<Record<ActionType, number>> = {}): Record<TaskTarget, number> {
  const optimizeValues = [weights.transcode, weights.upgrade, weights.delete]
    .map((value) => Number(value))
    .filter(Number.isFinite);
  return {
    ingest: typeof weights.ingest === 'number' ? weights.ingest : DEFAULT_TARGET_GATE_WEIGHTS.ingest,
    metadata: typeof weights.scrape === 'number' ? weights.scrape : DEFAULT_TARGET_GATE_WEIGHTS.metadata,
    optimize: optimizeValues.length ? Math.round(optimizeValues.reduce((sum, value) => sum + value, 0) / optimizeValues.length) : DEFAULT_TARGET_GATE_WEIGHTS.optimize,
    archive: DEFAULT_TARGET_GATE_WEIGHTS.archive,
  };
}

function gateWeightsToLegacyActionWeights(weights: Record<TaskTarget, number>, hints: Record<OptimizeOperation, number>): Record<ActionType, number> {
  return {
    ingest: weights.ingest,
    scrape: weights.metadata,
    transcode: weights.optimize + hints.transcode,
    upgrade: weights.optimize + hints.upgrade,
    delete: weights.optimize + hints.delete,
  };
}

function legacyActionMapToGateMap(values: Partial<Record<ActionType, number>> = {}, defaults: Record<TaskTarget, number>): Record<TaskTarget, number> {
  const optimizeValues = [values.transcode, values.upgrade, values.delete]
    .map((value) => Number(value))
    .filter(Number.isFinite);
  return {
    ingest: typeof values.ingest === 'number' ? values.ingest : defaults.ingest,
    metadata: typeof values.scrape === 'number' ? values.scrape : defaults.metadata,
    optimize: optimizeValues.length ? Math.min(...optimizeValues) : defaults.optimize,
    archive: defaults.archive,
  };
}

function gateMapToLegacyActionMap(values: Record<TaskTarget, number>): Record<ActionType, number> {
  return {
    ingest: values.ingest,
    scrape: values.metadata,
    transcode: values.optimize,
    upgrade: values.optimize,
    delete: values.optimize,
  };
}

function legacyRulesToGateRules(rules: Partial<Record<ActionType, PriorityRule[]>> = {}): Record<TaskTarget, PriorityRule[]> {
  return {
    ingest: rules.ingest || [],
    metadata: rules.scrape || [],
    optimize: [...(rules.transcode || []), ...(rules.upgrade || []), ...(rules.delete || [])],
    archive: [],
  };
}

function gateRulesToLegacyRules(rules: Record<TaskTarget, PriorityRule[]>): Record<ActionType, PriorityRule[]> {
  return {
    ingest: rules.ingest || [],
    scrape: rules.metadata || [],
    transcode: rules.optimize || [],
    upgrade: [],
    delete: [],
  };
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
  const [automaticTaskTargets, setAutomaticTaskTargets] = useState<TaskTarget[]>([]);
  const [optimizeAllowedOperations, setOptimizeAllowedOperations] = useState<OptimizeOperation[]>([]);
  const [smartTaskInterval, setSmartTaskInterval] = useState(10);
  const [smartTaskLookback, setSmartTaskLookback] = useState(30);
  const [smartTaskQueueMax, setSmartTaskQueueMax] = useState(50);
  const [strategyInterval, setStrategyInterval] = useState(30);
  const [manualPrio, setManualPrio] = useState(0);
  const [autoPrioBase, setAutoPrioBase] = useState(100);
  const [targetGateWeights, setTargetGateWeights] = useState<Record<TaskTarget, number>>(DEFAULT_TARGET_GATE_WEIGHTS);
  const [optimizeOperationHints, setOptimizeOperationHints] = useState<Record<OptimizeOperation, number>>(DEFAULT_OPTIMIZE_OPERATION_HINTS);
  const [priorityRulesByTargetGate, setPriorityRulesByTargetGate] = useState<Record<TaskTarget, PriorityRule[]>>({
    ingest: [],
    metadata: [],
    optimize: [],
    archive: [],
  });
  const [globalApprovalPolicy, setGlobalApprovalPolicy] = useState<ApprovalPolicyConfig>(DEFAULT_APPROVAL_POLICY);
  const [gateCooldowns, setGateCooldowns] = useState<Record<TaskTarget, number>>(DEFAULT_GATE_COOLDOWNS);
  const [gateQueueLimits, setGateQueueLimits] = useState<Record<TaskTarget, number>>(DEFAULT_GATE_QUEUE_LIMITS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPriorityAdvanced, setShowPriorityAdvanced] = useState(false);
  const [showGlobalApproval, setShowGlobalApproval] = useState(false);
  const [expandedApprovalLibs, setExpandedApprovalLibs] = useState<Record<string, boolean>>({});

  const { data, isLoading, isFetching, error: loadError, refetch } = useQuery({
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
        const split = splitLegacySmartTaskActions(sysCfg.smartTaskEnabledActions ?? []);
        setAutomaticTaskTargets((sysCfg.automaticTaskTargets as TaskTarget[] | undefined) ?? split.automaticTaskTargets);
        setOptimizeAllowedOperations((sysCfg.optimizeAllowedOperations as OptimizeOperation[] | undefined) ?? split.optimizeAllowedOperations);
        setSmartTaskInterval(sysCfg.smartTaskPollIntervalMinutes ?? 10);
        setSmartTaskLookback(sysCfg.smartTaskLookbackDays ?? 30);
        setSmartTaskQueueMax(sysCfg.smartTaskMaxQueueSize ?? 50);
        setStrategyInterval(sysCfg.strategyPollIntervalMinutes ?? 30);
        setManualPrio(sysCfg.taskPriority?.manualTaskPriority ?? 0);
        setAutoPrioBase(sysCfg.taskPriority?.autoTaskPriorityBase ?? 100);
        setTargetGateWeights({
          ...legacyActionWeightsToGateWeights(sysCfg.taskPriority?.actionTypeWeights || {}),
          ...(sysCfg.taskPriority?.targetGateWeights || {}),
        });
        setOptimizeOperationHints({ ...DEFAULT_OPTIMIZE_OPERATION_HINTS, ...(sysCfg.taskPriority?.optimizeOperationHints || {}) });
        setPriorityRulesByTargetGate({
          ...legacyRulesToGateRules(sysCfg.taskPriority?.rules || {}),
          ...(sysCfg.taskPriority?.rulesByTargetGate || {}),
        });
        setGlobalApprovalPolicy(normalizeApprovalPolicy(sysCfg.approvalPolicy));
        setGateCooldowns({
          ...legacyActionMapToGateMap(sysCfg.taskAdmission?.cooldownHoursByAction || {}, DEFAULT_GATE_COOLDOWNS),
          ...(sysCfg.taskAdmission?.cooldownHoursByTargetGate || {}),
        });
        setGateQueueLimits({
          ...legacyActionMapToGateMap(sysCfg.taskAdmission?.maxQueuedByAction || {}, DEFAULT_GATE_QUEUE_LIMITS),
          ...(sysCfg.taskAdmission?.maxQueuedByTargetGate || {}),
        });
        const scheds: Record<string, SubLibScheduleState> = {};
        for (const sl of slRes.subLibraries || []) {
          const legacyManual = sl.scheduleMode === 'full_manual' || sl.autoExecute === false;
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

  function toggleTaskTarget(target: TaskTarget) {
    setAutomaticTaskTargets((prev) => {
      const next = prev.includes(target) ? prev.filter((x) => x !== target) : [...prev, target];
      if (!next.includes('optimize')) setOptimizeAllowedOperations([]);
      return next;
    });
  }

  function toggleOptimizeOperation(operation: OptimizeOperation) {
    setOptimizeAllowedOperations((prev) => {
      const next = prev.includes(operation) ? prev.filter((x) => x !== operation) : [...prev, operation];
      if (next.length > 0 && !automaticTaskTargets.includes('optimize')) {
        setAutomaticTaskTargets((targets) => targets.includes('optimize') ? targets : [...targets, 'optimize']);
      }
      return next;
    });
  }

  function updateSubLib(uuid: string, patch: Partial<SubLibScheduleState>) {
    setSlSchedules((prev) => ({ ...prev, [uuid]: { ...prev[uuid], ...patch } }));
  }

  function updatePolicy(policy: ApprovalPolicyConfig, gateId: string, mode: ApprovalMode): ApprovalPolicyConfig {
    return normalizeApprovalPolicy({ ...policy, [gateId]: gateId === 'upgrade.identityMismatch' ? 'forceConfirm' : mode });
  }

  function toggleSubLibApproval(uuid: string) {
    setExpandedApprovalLibs((prev) => ({ ...prev, [uuid]: !prev[uuid] }));
  }

  function addPriorityRule(target: TaskTarget) {
    setPriorityRulesByTargetGate((prev) => ({
      ...prev,
      [target]: [...(prev[target] || []), { match: { subLibraryId: subLibs[0]?.uuid || '' }, adjust: { op: 'subtract', value: 50 } }],
    }));
  }

  function updatePriorityRule(target: TaskTarget, idx: number, patch: Partial<PriorityRule>) {
    setPriorityRulesByTargetGate((prev) => ({
      ...prev,
      [target]: (prev[target] || []).map((r, i) => (
        i === idx
          ? { ...r, ...patch, match: { ...r.match, ...(patch.match || {}) }, adjust: { ...r.adjust, ...(patch.adjust || {}) } }
          : r
      )),
    }));
  }

  function removePriorityRule(target: TaskTarget, idx: number) {
    setPriorityRulesByTargetGate((prev) => ({ ...prev, [target]: (prev[target] || []).filter((_, i) => i !== idx) }));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const compatSmartTaskActions = projectLegacySmartTaskActions(automaticTaskTargets, optimizeAllowedOperations);
      const compatActionWeights = gateWeightsToLegacyActionWeights(targetGateWeights, optimizeOperationHints);
      const compatCooldowns = gateMapToLegacyActionMap(gateCooldowns);
      const compatQueueLimits = gateMapToLegacyActionMap(gateQueueLimits);
      const compatPriorityRules = gateRulesToLegacyRules(priorityRulesByTargetGate);
      const promises: Promise<unknown>[] = [
        systemConfig.patch({
          ingestConcurrency: ingestConc,
          deleteConcurrency: deleteConc,
          transcodeConcurrency: transcodeConc,
          upgradeConcurrency: upgradeConc,
          scrapeConcurrency: scrapeConc,
          smartTaskMaxPerRun: smartTaskMax,
          automaticTaskTargets,
          optimizeAllowedOperations,
          smartTaskEnabledActions: compatSmartTaskActions,
          smartTaskPollIntervalMinutes: smartTaskInterval,
          smartTaskLookbackDays: smartTaskLookback,
          smartTaskMaxQueueSize: smartTaskQueueMax,
          strategyPollIntervalMinutes: strategyInterval,
          approvalPolicy: normalizeApprovalPolicy(globalApprovalPolicy),
          taskAdmission: {
            defaultCooldownHours: data?.sysCfg.taskAdmission?.defaultCooldownHours ?? 48,
            defaultMaxQueued: data?.sysCfg.taskAdmission?.defaultMaxQueued ?? 50,
            cooldownHoursByTargetGate: gateCooldowns,
            maxQueuedByTargetGate: gateQueueLimits,
            cooldownHoursByAction: compatCooldowns,
            maxQueuedByAction: compatQueueLimits,
          },
          taskPriority: {
            manualTaskPriority: manualPrio,
            autoTaskPriorityBase: autoPrioBase,
            targetGateWeights,
            optimizeOperationHints,
            rulesByTargetGate: priorityRulesByTargetGate,
            actionTypeWeights: compatActionWeights,
            rules: compatPriorityRules,
          },
        }),
      ];

      for (const [uuid, sched] of Object.entries(slSchedules)) {
        const policy = normalizeApprovalPolicy(sched.approvalPolicy);
        promises.push(subLibraries.update(uuid, {
          automationMode: sched.automationMode,
          scheduleMode: sched.automationMode === 'manual' ? 'full_manual' : 'full_auto',
          autoCreate: true,
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

  if (isLoading) {
    return (
      <div>
        <LoadingSpinner text="加载设置页..." />
        <div style={{ ...hintStyle, marginTop: 12 }}>
          正在请求 /v1/config 和 /v1/admin/sublibraries。
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <Alert
          type="error"
          message={`设置页加载失败：${loadError instanceof Error ? loadError.message : 'GET /v1/config failed'}`}
        />
        <button type="button" onClick={() => void refetch()} style={primaryBtn}>
          {isFetching ? '重试中...' : '重试加载'}
        </button>
      </div>
    );
  }

  return (
    <div>
      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      <section style={cardStyle}>
        <h3 style={sectionTitle}>任务执行方式</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>任务执行方式决定任务创建后是否自动进入执行队列；后台是否自动创建任务由「后台自动入队」统一控制。</p>
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
                        {mode === 'auto' ? '自动执行' : '手动启动'}
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
                    <span style={hintStyle}>数值越小越优先；参与全局任务队列排序。</span>
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
          const expanded = !!expandedApprovalLibs[sl.uuid];
          return (
            <div key={sl.uuid} style={approvalSummaryBlock}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{sl.name}</div>
                  <div style={hintStyle}>{approvalSummary(sched.approvalPolicy)}</div>
                </div>
                <button onClick={() => toggleSubLibApproval(sl.uuid)} style={collapseBtn}>
                  {expanded ? '收起审批策略' : '展开审批策略'}
                </button>
              </div>
              {expanded && (
                <ApprovalPolicyEditor
                  title=""
                  policy={sched.approvalPolicy}
                  onChange={(policy) => updateSubLib(sl.uuid, { approvalPolicy: policy })}
                  updatePolicy={updatePolicy}
                  compact
                />
              )}
            </div>
          );
        })}
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>后台自动入队</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>后台自动入队分两层授权：先决定系统能不能自动创建某个 Gate 的任务，再决定优化任务里允许哪些操作路径。</p>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>允许自动创建的任务目标</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            {TASK_TARGETS.map((target) => (
              <label key={target.key} style={checkboxCard}>
                <input type="checkbox" checked={automaticTaskTargets.includes(target.key)} onChange={() => toggleTaskTarget(target.key)} />
                <span>
                  <strong>{target.label}</strong>
                  <small>{target.desc}</small>
                </span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>优化任务允许的操作</label>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {OPTIMIZE_OPERATIONS.map((operation) => (
                <label key={operation.key} style={checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={optimizeAllowedOperations.includes(operation.key)}
                    onChange={() => toggleOptimizeOperation(operation.key)}
                  />
                  {operation.label}
                </label>
              ))}
            </div>
          </div>
          {automaticTaskTargets.length === 0 ? (
            <div style={warningBox}>
              当前没有选择任何自动任务目标。媒体库仍会显示推荐方向，但系统不会自动创建任务；需要手动执行，或在这里授权对应 Gate 后保存。
            </div>
          ) : automaticTaskTargets.includes('optimize') && optimizeAllowedOperations.length === 0 ? (
            <div style={warningBox}>
              已允许自动创建优化任务，但没有授权任何优化操作。系统不会自动创建转码、洗版或删除任务。
            </div>
          ) : (
            <div style={infoBox}>
              当前允许自动任务目标：{automaticTaskTargets.map((key) => TASK_TARGETS.find((target) => target.key === key)?.label || key).join('、')}。
              {automaticTaskTargets.includes('optimize') ? ` 优化操作：${optimizeAllowedOperations.map((key) => OPTIMIZE_OPERATIONS.find((operation) => operation.key === key)?.label || key).join('、') || '未授权'}。` : ''}
            </div>
          )}
          <div style={{ ...hintStyle, marginTop: 8 }}>用户在具体条目上手动创建任务属于明确操作，不受这个自动入队开关拦截，但仍会保留 active task 去重等安全规则。</div>
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
              <NumberField label="优化目标计算间隔（分钟）" value={strategyInterval} min={10} max={360} onChange={setStrategyInterval} />
              <NumberField label="回溯天数" value={smartTaskLookback} min={1} max={365} onChange={setSmartTaskLookback} />
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>失败/重复入队冷却</div>
              <div style={fourColGrid}>
                {TASK_TARGETS.map((target) => (
                  <NumberField
                    key={target.key}
                    label={`${target.label}（小时）`}
                    value={gateCooldowns[target.key]}
                    min={0}
                    max={240}
                    onChange={(v) => setGateCooldowns((prev) => ({ ...prev, [target.key]: v }))}
                  />
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>自动队列上限</div>
              <div style={fourColGrid}>
                {TASK_TARGETS.map((target) => (
                  <NumberField
                    key={target.key}
                    label={target.label}
                    value={gateQueueLimits[target.key]}
                    min={1}
                    max={500}
                    onChange={(v) => setGateQueueLimits((prev) => ({ ...prev, [target.key]: v }))}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section style={cardStyle}>
        <h3 style={sectionTitle}>队列优先级</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>数值越小越优先。最终优先级由来源权重、目标 Gate 权重、优化操作提示、子库权重、业务信号、等待时间、重试惩罚和高级规则叠加计算。</p>
        <div style={fourColGrid}>
          <NumberField label="手动来源权重" value={manualPrio} min={0} max={999} onChange={setManualPrio} />
          <NumberField label="自动来源权重" value={autoPrioBase} min={0} max={999} onChange={setAutoPrioBase} />
          {TASK_TARGETS.map((target) => (
            <NumberField
              key={target.key}
              label={`${target.label}权重`}
              value={targetGateWeights[target.key]}
              min={0}
              max={999}
              onChange={(v) => setTargetGateWeights((prev) => ({ ...prev, [target.key]: v }))}
            />
          ))}
        </div>
        <div style={{ ...fourColGrid, marginTop: 16 }}>
          {OPTIMIZE_OPERATIONS.map((operation) => (
            <NumberField
              key={operation.key}
              label={`${operation.label}提示`}
              value={optimizeOperationHints[operation.key]}
              min={-999}
              max={999}
              onChange={(v) => setOptimizeOperationHints((prev) => ({ ...prev, [operation.key]: v }))}
            />
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setShowPriorityAdvanced((v) => !v)} style={collapseBtn}>
            {showPriorityAdvanced ? '收起高级优先级规则' : '展开高级优先级规则'}
          </button>
          {showPriorityAdvanced && (
            <div style={advancedBox}>
              <p style={{ ...hintStyle, marginBottom: 12 }}>规则按顺序叠加到当前分数上：更优先会减分，延后会加分；不使用绝对覆盖。</p>
              {TASK_TARGETS.map((target) => (
                <div key={target.key} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{target.label}</div>
                  {(priorityRulesByTargetGate[target.key] || []).map((rule, idx) => (
                    <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <select value={rule.adjust.op} onChange={(e) => updatePriorityRule(target.key, idx, { adjust: { ...rule.adjust, op: e.target.value as PriorityRule['adjust']['op'] } })} style={{ ...inputStyle, width: 90 }}>
                        <option value="subtract">更优先 -</option>
                        <option value="add">延后 +</option>
                      </select>
                      <input type="number" value={rule.adjust.value} onChange={(e) => updatePriorityRule(target.key, idx, { adjust: { ...rule.adjust, value: parseInt(e.target.value, 10) || 0 } })} style={{ ...inputStyle, width: 70 }} />
                      <span style={{ fontSize: 11, color: '#999' }}>当</span>
                      <select value={firstMatchKey(rule.match)} onChange={(e) => updatePriorityRule(target.key, idx, { match: setSingleMatch(rule.match, e.target.value) })} style={{ ...inputStyle, width: 120 }}>
                        <option value="subLibraryId">媒体库</option>
                        <option value="type">类型</option>
                        <option value="isDiscLike">原盘</option>
                        <option value="isDolbyVision">杜比视界</option>
                        <option value="resolution">分辨率前缀</option>
                      </select>
                      <MatchValueInput rule={rule} subLibs={subLibs} onChange={(val) => updatePriorityRule(target.key, idx, { match: setSingleMatchValue(rule.match, val) })} />
                      <button onClick={() => removePriorityRule(target.key, idx)} style={deleteTextBtn}>删除</button>
                    </div>
                  ))}
                  <button onClick={() => addPriorityRule(target.key)} style={dashBtn}>+ 添加规则</button>
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
      {title && <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: '#1a1a2e' }}>{title}</div>}
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

function approvalSummary(policy: ApprovalPolicyConfig): string {
  const normalized = normalizeApprovalPolicy(policy);
  let confirmCount = 0;
  let forceCount = 0;
  for (const gate of APPROVAL_GATES) {
    const value = normalized[gate.key];
    if (value === 'forceConfirm') forceCount += 1;
    else if (value === 'confirm') confirmCount += 1;
  }
  return `当前 ${confirmCount} 个节点需要确认，${forceCount} 个节点强制确认`;
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

const approvalSummaryBlock: React.CSSProperties = {
  borderTop: '1px solid #eee',
  paddingTop: 12,
  marginTop: 12,
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

const checkboxCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  border: '1px solid #e2e5ea',
  borderRadius: 6,
  padding: 10,
  fontSize: 13,
  cursor: 'pointer',
  background: '#fff',
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
