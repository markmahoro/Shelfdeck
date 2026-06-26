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
}

function applyMode(mode: ScheduleMode, prev: SubLibScheduleState): SubLibScheduleState {
  if (mode === 'full_auto') {
    return { scheduleMode: mode, autoCreate: true, autoExecute: true, autoReplaceTranscode: true, autoReplaceUpgrade: true, smartSelectEnabled: true };
  }
  if (mode === 'full_manual') {
    return { scheduleMode: mode, autoCreate: false, autoExecute: false, autoReplaceTranscode: false, autoReplaceUpgrade: false, smartSelectEnabled: false };
  }
  return { ...prev, scheduleMode: mode };
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
