import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemConfig, transcode, upgrade, subLibraries } from '../api/client';
import type { TranscodeConfig, SubLibrary } from '../types';
import type { UpgradeConfig } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const MODES = [
  { key: 'full_auto' as const, title: '全自动', desc: '自动创建任务 + 自动触发执行\n洗版/压缩任务结束后自动替换' },
  { key: 'custom' as const, title: '自定义', desc: '自由组合各项自动化开关' },
  { key: 'full_manual' as const, title: '全手动', desc: '全部需要用户手动操作' },
];

type ScheduleMode = 'full_auto' | 'custom' | 'full_manual';

interface SubLibScheduleState {
  scheduleMode: ScheduleMode;
  autoCreate: boolean;
  autoExecute: boolean;
  autoReplaceTranscode: boolean;
  autoReplaceUpgrade: boolean;
  smartSelectEnabled: boolean;
  // Queue priority weight (lower = this library's tasks run first). Default 100.
  priorityWeight: number;
}

function applyMode(mode: ScheduleMode, prev: SubLibScheduleState): SubLibScheduleState {
  if (mode === 'full_auto') {
    return { scheduleMode: mode, autoCreate: true, autoExecute: true, autoReplaceTranscode: true, autoReplaceUpgrade: true, smartSelectEnabled: true, priorityWeight: prev.priorityWeight };
  }
  if (mode === 'full_manual') {
    return { scheduleMode: mode, autoCreate: false, autoExecute: false, autoReplaceTranscode: false, autoReplaceUpgrade: false, smartSelectEnabled: false, priorityWeight: prev.priorityWeight };
  }
  return { ...prev, scheduleMode: mode };
}

type PriorityMatch = NonNullable<import('../api/client').PriorityRule['match']>;
type PriorityMatchKey = keyof PriorityMatch;

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
  rule: import('../api/client').PriorityRule;
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

  // per-subLibrary scheduling state: uuid → SubLibScheduleState
  const [slSchedules, setSlSchedules] = useState<Record<string, SubLibScheduleState>>({});

  // Global settings
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Queue priority: base values + advanced overlay rules.
  const [manualPrio, setManualPrio] = useState(0);
  const [autoPrioBase, setAutoPrioBase] = useState(100);
  const [priorityRules, setPriorityRules] = useState<Record<string, import('../api/client').PriorityRule[]>>({ transcode: [], upgrade: [], delete: [], scrape: [] });
  const [showPriorityAdvanced, setShowPriorityAdvanced] = useState(false);

  const { data: slData } = useQuery({
    queryKey: ['sublibraries'],
    queryFn: subLibraries.list,
  });

  const { isLoading } = useQuery({
    queryKey: ['system-config-full'],
    queryFn: async () => {
      const [sysCfg, upgCfg, tcCfg] = await Promise.all([
        systemConfig.get(),
        upgrade.getConfig().catch(() => null as UpgradeConfig | null),
        transcode.getConfig().catch(() => null as TranscodeConfig | null),
      ]);
      if (!initialized) {
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
        setPriorityRules({
          transcode: sysCfg.taskPriority?.rules?.transcode || [],
          upgrade: sysCfg.taskPriority?.rules?.upgrade || [],
          delete: sysCfg.taskPriority?.rules?.delete || [],
          scrape: sysCfg.taskPriority?.rules?.scrape || [],
        });
        setInitialized(true);
      }

      // SubLibrary scheduling state — synced every refetch (not guarded by initialized)
      const slRes = await subLibraries.list().catch(() => ({ subLibraries: [] as SubLibrary[] }));
      const scheds: Record<string, SubLibScheduleState> = {};
      for (const sl of (slRes.subLibraries || [])) {
        scheds[sl.uuid] = {
          scheduleMode: (sl as any).scheduleMode || 'full_auto',
          autoCreate: (sl as any).autoCreate !== undefined ? (sl as any).autoCreate : true,
          autoExecute: (sl as any).autoExecute !== undefined ? (sl as any).autoExecute : true,
          autoReplaceTranscode: !!(sl as any).autoReplaceTranscode,
          autoReplaceUpgrade: !!(sl as any).autoReplaceUpgrade,
          smartSelectEnabled: !!(sl as any).smartSelectEnabled,
          priorityWeight: typeof (sl as any).priorityWeight === 'number' ? (sl as any).priorityWeight : 100,
        };
      }
      setSlSchedules(scheds);
      return { sysCfg, upgCfg, tcCfg };
    },
  });

  const toggleAction = (a: string) => {
    setSmartTaskActions((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const promises: Promise<unknown>[] = [
        systemConfig.patch({
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
          taskPriority: {
            manualTaskPriority: manualPrio,
            autoTaskPriorityBase: autoPrioBase,
            rules: {
              transcode: priorityRules.transcode || [],
              upgrade: priorityRules.upgrade || [],
              delete: priorityRules.delete || [],
              scrape: priorityRules.scrape || [],
            },
          },
        }),
      ];

      // Persist per-subLibrary scheduling
      for (const [uuid, sched] of Object.entries(slSchedules)) {
        promises.push(
          subLibraries.update(uuid, {
            scheduleMode: sched.scheduleMode,
            autoCreate: sched.autoCreate,
            autoExecute: sched.autoExecute,
            autoReplaceTranscode: sched.autoReplaceTranscode,
            autoReplaceUpgrade: sched.autoReplaceUpgrade,
            smartSelectEnabled: sched.smartSelectEnabled,
            priorityWeight: sched.priorityWeight,
          } as any)
        );
      }

      await Promise.all(promises);
      qc.invalidateQueries({ queryKey: ['sublibraries'] });
    },
    onSuccess: () => setAlert({ type: 'success', msg: '调度设置已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (isLoading) return <LoadingSpinner />;

  const subLibs: SubLibrary[] = slData?.subLibraries || [];

  // ── Priority rule editor helpers ──────────────────────────────────────────
  function addPriorityRule(at: string) {
    setPriorityRules((prev) => ({
      ...prev,
      [at]: [...(prev[at] || []), { match: { subLibraryId: subLibs[0]?.uuid || '' }, adjust: { op: 'subtract', value: 50 } }],
    }));
  }
  function updatePriorityRule(at: string, idx: number, patch: Partial<import('../api/client').PriorityRule>) {
    setPriorityRules((prev) => ({
      ...prev,
      [at]: (prev[at] || []).map((r, i) => (i === idx ? { ...r, ...patch, match: { ...r.match, ...(patch.match || {}) }, adjust: { ...r.adjust, ...(patch.adjust || {}) } } : r)),
    }));
  }
  function removePriorityRule(at: string, idx: number) {
    setPriorityRules((prev) => ({ ...prev, [at]: (prev[at] || []).filter((_, i) => i !== idx) }));
  }

  return (
    <div>
      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      {/* Per-SubLibrary Scheduling Cards */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>子库任务调度</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>每个子库独立配置自动化程度</p>

        {subLibs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#999', fontSize: 14 }}>
            暂无子库，请先在仪表盘添加媒体库
          </div>
        ) : (
          subLibs.map((sl) => {
            const sched = slSchedules[sl.uuid];
            if (!sched) return null;
            return (
              <div key={sl.uuid} style={{ border: '1px solid #e8e8e8', borderRadius: 10, padding: 16, marginBottom: 14, background: '#fff' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e', marginBottom: 12 }}>{sl.name}</div>

                {/* Queue priority weight (lower = this library runs first) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: '#f8f9fb', borderRadius: 8 }}>
                  <label style={{ fontSize: 13, color: '#1a1a2e', fontWeight: 500 }}>队列优先级权重</label>
                  <input
                    type="number"
                    min={0}
                    value={sched.priorityWeight}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setSlSchedules((prev) => ({ ...prev, [sl.uuid]: { ...sched, priorityWeight: Number.isFinite(v) && v >= 0 ? v : 100 } }));
                    }}
                    style={{ width: 80, padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 13 }}
                  />
                  <span style={{ fontSize: 11, color: '#999' }}>数值越小，该库任务越优先执行（默认 100）</span>
                </div>

                {/* Mode selection */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  {MODES.map((m) => (
                    <div
                      key={m.key}
                      onClick={() => setSlSchedules((prev) => ({ ...prev, [sl.uuid]: applyMode(m.key, sched) }))}
                      style={sched.scheduleMode === m.key ? modeCardActive : modeCardInactive}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: sched.scheduleMode === m.key ? '#1a1a2e' : '#666' }}>
                        {m.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#999', lineHeight: 1.4, whiteSpace: 'pre-line' }}>
                        {m.desc}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Custom toggles */}
                {sched.scheduleMode === 'custom' && (
                  <div style={{ padding: '12px 14px', background: '#f8f9fb', borderRadius: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <label style={checkboxLabel}>
                        <input type="checkbox" checked={sched.autoCreate}
                          onChange={(e) => setSlSchedules((prev) => ({ ...prev, [sl.uuid]: { ...sched, autoCreate: e.target.checked } }))} />
                        自动创建任务
                      </label>
                      <label style={checkboxLabel}>
                        <input type="checkbox" checked={sched.autoExecute}
                          onChange={(e) => setSlSchedules((prev) => ({ ...prev, [sl.uuid]: { ...sched, autoExecute: e.target.checked } }))} />
                        自动触发执行
                      </label>
                      <label style={checkboxLabel}>
                        <input type="checkbox" checked={sched.autoReplaceUpgrade}
                          onChange={(e) => setSlSchedules((prev) => ({ ...prev, [sl.uuid]: { ...sched, autoReplaceUpgrade: e.target.checked } }))} />
                        洗版自动替换
                      </label>
                      <label style={checkboxLabel}>
                        <input type="checkbox" checked={sched.autoReplaceTranscode}
                          onChange={(e) => setSlSchedules((prev) => ({ ...prev, [sl.uuid]: { ...sched, autoReplaceTranscode: e.target.checked } }))} />
                        码率压缩自动替换
                      </label>
                      <label style={checkboxLabel}>
                        <input type="checkbox" checked={sched.smartSelectEnabled}
                          onChange={(e) => setSlSchedules((prev) => ({ ...prev, [sl.uuid]: { ...sched, smartSelectEnabled: e.target.checked } }))} />
                        智能选种
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* Card: 任务并发数 (global) */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>任务并发数</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>并发执行任务上限（全局）</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>删除并发任务数</label>
            <input type="number" value={deleteConc} min={1} max={10}
              onChange={(e) => setDeleteConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }} />
          </div>
          <div>
            <label style={labelStyle}>转码并发任务数</label>
            <input type="number" value={transcodeConc} min={1} max={10}
              onChange={(e) => setTranscodeConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }} />
          </div>
          <div>
            <label style={labelStyle}>洗版并发任务数</label>
            <input type="number" value={upgradeConc} min={1} max={10}
              onChange={(e) => setUpgradeConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }} />
          </div>
          <div>
            <label style={labelStyle}>刮削并发任务数</label>
            <input type="number" value={scrapeConc} min={1} max={10}
              onChange={(e) => setScrapeConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }} />
          </div>
        </div>
      </section>

      {/* Card: 智能创建任务 (global) */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>智能创建任务（全局）</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>
          子库自动创建任务开启时，下面这些设置生效
        </p>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>允许自动创建的任务类型</label>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { key: 'scrape', label: '刮削' },
              { key: 'transcode', label: '码率压缩' },
              { key: 'upgrade', label: '洗版' },
              { key: 'delete', label: '删除' },
            ].map((a) => (
              <label key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={smartTaskActions.includes(a.key)}
                  onChange={() => toggleAction(a.key)} />
                {a.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <button onClick={() => setShowAdvanced(!showAdvanced)} style={collapseBtn}>
            <span style={{ marginRight: 4 }}>{showAdvanced ? '▾' : '▸'}</span>
            高级配置
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 12, padding: '12px 16px', background: '#f8f9fb', borderRadius: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>每轮最多入队数</label>
                  <input type="number" value={smartTaskMax} min={1} max={100}
                    onChange={(e) => setSmartTaskMax(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ ...inputStyle, width: 100 }} />
                </div>
                <div>
                  <label style={labelStyle}>队列上限</label>
                  <input type="number" value={smartTaskQueueMax} min={1} max={500}
                    onChange={(e) => setSmartTaskQueueMax(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ ...inputStyle, width: 100 }} />
                </div>
                <div>
                  <label style={labelStyle}>轮询间隔（分钟）</label>
                  <input type="number" value={smartTaskInterval} min={5} max={120}
                    onChange={(e) => setSmartTaskInterval(Math.max(5, parseInt(e.target.value) || 5))}
                    style={{ ...inputStyle, width: 100 }} />
                </div>
                <div>
                  <label style={labelStyle}>回溯天数</label>
                  <input type="number" value={smartTaskLookback} min={1} max={365}
                    onChange={(e) => setSmartTaskLookback(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ ...inputStyle, width: 100 }} />
                </div>
                <div>
                  <label style={labelStyle}>策略计算间隔（分钟）</label>
                  <input type="number" value={strategyInterval} min={10} max={360}
                    onChange={(e) => setStrategyInterval(Math.max(10, parseInt(e.target.value) || 10))}
                    style={{ ...inputStyle, width: 100 }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Card: 队列优先级（库权重在上方各库卡片内配置） */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>队列优先级</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>
          数值越小越优先执行。手动创建的任务固定使用手动基准；自动入队任务取「自动基准」与「该库权重」的较小值。
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>手动任务基准</label>
            <input type="number" min={0} value={manualPrio}
              onChange={(e) => setManualPrio(Math.max(0, parseInt(e.target.value) || 0))}
              style={{ ...inputStyle, width: 100 }} />
          </div>
          <div>
            <label style={labelStyle}>自动任务基准</label>
            <input type="number" min={0} value={autoPrioBase}
              onChange={(e) => setAutoPrioBase(Math.max(0, parseInt(e.target.value) || 0))}
              style={{ ...inputStyle, width: 100 }} />
          </div>
        </div>

        {/* Advanced overlay rules (collapsible) */}
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowPriorityAdvanced((v) => !v)}
            style={{ background: 'none', border: '1px solid #d9d9d9', borderRadius: 6, padding: '6px 12px', fontSize: 13, color: '#1a1a2e', cursor: 'pointer' }}
          >
            {showPriorityAdvanced ? '收起' : '展开'}高级优先级规则
          </button>
          {showPriorityAdvanced && (
            <div style={{ marginTop: 12, padding: 14, background: '#f8f9fb', borderRadius: 8 }}>
              <p style={{ ...hintStyle, marginBottom: 12 }}>
                规则按顺序叠加到基准值上：subtract（更优先）、add（延后）、set（绝对档位）。匹配条件为 AND 关系。
              </p>
              {(['transcode', 'upgrade'] as const).map((at) => (
                <div key={at} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    {at === 'transcode' ? '码率压缩' : '洗版'}
                  </div>
                  {(priorityRules[at] || []).map((rule, idx) => (
                    <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <select value={rule.adjust.op}
                        onChange={(e) => updatePriorityRule(at, idx, { adjust: { ...rule.adjust, op: e.target.value as any } })}
                        style={{ ...inputStyle, width: 90 }}>
                        <option value="subtract">更优先 -</option>
                        <option value="add">延后 +</option>
                        <option value="set">设为 =</option>
                      </select>
                      <input type="number" value={rule.adjust.value}
                        onChange={(e) => updatePriorityRule(at, idx, { adjust: { ...rule.adjust, value: parseInt(e.target.value) || 0 } })}
                        style={{ ...inputStyle, width: 70 }} />
                      <span style={{ fontSize: 11, color: '#999' }}>当</span>
                      <select value={firstMatchKey(rule.match)}
                        onChange={(e) => updatePriorityRule(at, idx, { match: setSingleMatch(rule.match, e.target.value) })}
                        style={{ ...inputStyle, width: 120 }}>
                        <option value="subLibraryId">媒体库</option>
                        <option value="type">类型</option>
                        <option value="isDiscLike">原盘</option>
                        <option value="isDolbyVision">杜比视界</option>
                        <option value="resolution">分辨率前缀</option>
                      </select>
                      <MatchValueInput rule={rule} subLibs={subLibs}
                        onChange={(val) => updatePriorityRule(at, idx, { match: setSingleMatchValue(rule.match, val) })} />
                      <button onClick={() => removePriorityRule(at, idx)}
                        style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 13 }}>删除</button>
                    </div>
                  ))}
                  <button onClick={() => addPriorityRule(at)}
                    style={{ background: 'none', border: '1px dashed #bbb', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#666', cursor: 'pointer' }}>
                    + 添加规则
                  </button>
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

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16, color: '#1a1a2e',
};

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};

const hintStyle: React.CSSProperties = {
  fontSize: 13, color: '#999', marginTop: 4, marginBottom: 0,
};

const primaryBtn: React.CSSProperties = {
  background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const modeCardActive: React.CSSProperties = {
  padding: 10,
  border: '2px solid #1a1a2e',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#f8f9fb',
};

const modeCardInactive: React.CSSProperties = {
  padding: 10,
  border: '2px solid #e8e8e8',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#fff',
};

const checkboxLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer',
};

const collapseBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#1a1a2e', cursor: 'pointer',
  fontSize: 14, fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center',
};
