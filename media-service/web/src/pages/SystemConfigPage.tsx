import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { systemConfig, transcode, upgrade } from '../api/client';
import type { TranscodeConfig } from '../types';
import type { UpgradeConfig } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

type ScheduleMode = 'full_auto' | 'custom' | 'full_manual';

const MODES: { key: ScheduleMode; title: string; desc: string }[] = [
  { key: 'full_auto', title: '全自动', desc: '自动创建任务 + 自动触发执行\n洗版/压缩任务结束后自动替换' },
  { key: 'custom', title: '自定义', desc: '自由组合各项自动化开关' },
  { key: 'full_manual', title: '全手动', desc: '全部需要用户手动操作' },
];

function deriveMode(sysCfg: { executionMode?: string; wallRatingAutoEnqueue?: boolean },
                   upgCfg?: UpgradeConfig,
                   tcCfg?: TranscodeConfig): ScheduleMode {
  const autoCreate = sysCfg.wallRatingAutoEnqueue || false;
  const autoExecute = sysCfg.executionMode === 'auto';
  const autoReplaceUpgrade = !(upgCfg?.upgradeReplaceConfirmRequired);
  const autoReplaceTranscode = !(tcCfg?.transcodeReplaceConfirmRequired);

  if (autoCreate && autoExecute && autoReplaceUpgrade && autoReplaceTranscode) return 'full_auto';
  if (!autoCreate && !autoExecute && !autoReplaceUpgrade && !autoReplaceTranscode) return 'full_manual';
  return 'custom';
}

export default function SystemConfigPage() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('full_auto');
  const [autoCreate, setAutoCreate] = useState(true);
  const [autoExecute, setAutoExecute] = useState(true);
  const [autoReplaceUpgrade, setAutoReplaceUpgrade] = useState(false);
  const [autoReplaceTranscode, setAutoReplaceTranscode] = useState(false);

  const [deleteConc, setDeleteConc] = useState(3);
  const [transcodeConc, setTranscodeConc] = useState(1);
  const [upgradeConc, setUpgradeConc] = useState(1);
  const [smartTaskMax, setSmartTaskMax] = useState(10);
  const [smartTaskActions, setSmartTaskActions] = useState<string[]>(['transcode', 'upgrade']);
  const [smartTaskInterval, setSmartTaskInterval] = useState(10);
  const [smartTaskLookback, setSmartTaskLookback] = useState(30);
  const [smartTaskQueueMax, setSmartTaskQueueMax] = useState(50);
  const [strategyInterval, setStrategyInterval] = useState(30);
  const [initialized, setInitialized] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const smartEnabled = scheduleMode === 'full_manual' ? false : autoCreate;

  const { isLoading } = useQuery({
    queryKey: ['system-config-full'],
    queryFn: async () => {
      const [sysCfg, upgCfg, tcCfg] = await Promise.all([
        systemConfig.get(),
        upgrade.getConfig().catch(() => null as UpgradeConfig | null),
        transcode.getConfig().catch(() => null as TranscodeConfig | null),
      ]);
      if (!initialized) {
        const mode = deriveMode(sysCfg, upgCfg ?? undefined, tcCfg ?? undefined);

        setScheduleMode(mode);
        if (mode === 'full_auto') {
          setAutoCreate(true); setAutoExecute(true);
          setAutoReplaceUpgrade(true); setAutoReplaceTranscode(true);
        } else if (mode === 'full_manual') {
          setAutoCreate(false); setAutoExecute(false);
          setAutoReplaceUpgrade(false); setAutoReplaceTranscode(false);
        } else {
          setAutoCreate(sysCfg.wallRatingAutoEnqueue || false);
          setAutoExecute(sysCfg.executionMode === 'auto');
          setAutoReplaceUpgrade(!(upgCfg?.upgradeReplaceConfirmRequired));
          setAutoReplaceTranscode(!(tcCfg?.transcodeReplaceConfirmRequired));
        }

        setDeleteConc(sysCfg.deleteConcurrency ?? 3);
        setTranscodeConc(sysCfg.transcodeConcurrency ?? 1);
        setUpgradeConc(sysCfg.upgradeConcurrency ?? 1);
        setSmartTaskMax(sysCfg.smartTaskMaxPerRun ?? 10);
        setSmartTaskActions(sysCfg.smartTaskEnabledActions ?? ['transcode', 'upgrade']);
        setSmartTaskInterval(sysCfg.smartTaskPollIntervalMinutes ?? 10);
        setSmartTaskLookback(sysCfg.smartTaskLookbackDays ?? 30);
        setSmartTaskQueueMax(sysCfg.smartTaskMaxQueueSize ?? 50);
        setStrategyInterval(sysCfg.strategyPollIntervalMinutes ?? 30);
        setInitialized(true);
      }
      return { sysCfg, upgCfg, tcCfg };
    },
  });

  const toggleAction = (a: string) => {
    setSmartTaskActions((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  };

  function selectMode(mode: ScheduleMode) {
    setScheduleMode(mode);
    if (mode === 'full_auto') {
      setAutoCreate(true); setAutoExecute(true);
      setAutoReplaceUpgrade(true); setAutoReplaceTranscode(true);
    } else if (mode === 'full_manual') {
      setAutoCreate(false); setAutoExecute(false);
      setAutoReplaceUpgrade(false); setAutoReplaceTranscode(false);
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        systemConfig.patch({
          executionMode: autoExecute ? 'auto' : 'manual',
          deleteConcurrency: deleteConc,
          transcodeConcurrency: transcodeConc,
          upgradeConcurrency: upgradeConc,
          wallRatingAutoEnqueue: autoCreate,
          smartTaskMaxPerRun: smartTaskMax,
          smartTaskEnabledActions: smartTaskActions,
          smartTaskPollIntervalMinutes: smartTaskInterval,
          smartTaskLookbackDays: smartTaskLookback,
          smartTaskMaxQueueSize: smartTaskQueueMax,
          strategyPollIntervalMinutes: strategyInterval,
        }),
        upgrade.patchConfig({
          upgradeReplaceConfirmRequired: !autoReplaceUpgrade,
        }),
        transcode.patchConfig({
          transcodeReplaceConfirmRequired: !autoReplaceTranscode,
        }),
      ]);
    },
    onSuccess: () => setAlert({ type: 'success', msg: '调度设置已保存' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      {/* Card 1: 执行模式 */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>执行模式</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {MODES.map((m) => (
            <div
              key={m.key}
              onClick={() => selectMode(m.key)}
              style={scheduleMode === m.key ? modeCardActive : modeCardInactive}
            >
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: scheduleMode === m.key ? '#1a1a2e' : '#666' }}>
                {m.title}
              </div>
              <div style={{ fontSize: 13, color: '#999', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                {m.desc}
              </div>
            </div>
          ))}
        </div>

        {scheduleMode === 'custom' && (
          <div style={{ marginTop: 16, padding: '14px 16px', background: '#f8f9fb', borderRadius: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={checkboxLabel}>
                <input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} />
                自动创建任务
              </label>
              <label style={checkboxLabel}>
                <input type="checkbox" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} />
                自动触发执行
              </label>
              <label style={checkboxLabel}>
                <input type="checkbox" checked={autoReplaceUpgrade} onChange={(e) => setAutoReplaceUpgrade(e.target.checked)} />
                洗版自动替换
              </label>
              <label style={checkboxLabel}>
                <input type="checkbox" checked={autoReplaceTranscode} onChange={(e) => setAutoReplaceTranscode(e.target.checked)} />
                码率压缩自动替换
              </label>
            </div>
          </div>
        )}
      </section>

      {/* Card 2: 任务并发数 */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>任务并发数</h3>
        <p style={{ ...hintStyle, marginBottom: 16 }}>并发执行任务上限</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>删除并发任务数</label>
            <input
              type="number"
              value={deleteConc}
              min={1} max={10}
              onChange={(e) => setDeleteConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }}
            />
          </div>
          <div>
            <label style={labelStyle}>转码并发任务数</label>
            <input
              type="number"
              value={transcodeConc}
              min={1} max={10}
              onChange={(e) => setTranscodeConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }}
            />
          </div>
          <div>
            <label style={labelStyle}>洗版并发任务数</label>
            <input
              type="number"
              value={upgradeConc}
              min={1} max={10}
              onChange={(e) => setUpgradeConc(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 100 }}
            />
          </div>
        </div>
      </section>

      {/* Card 3: 智能创建任务 */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>
          智能创建任务
          <span style={{
            marginLeft: 10,
            fontSize: 12,
            fontWeight: 500,
            color: smartEnabled ? '#27ae60' : '#999',
            background: smartEnabled ? '#e8f5e9' : '#f0f0f0',
            padding: '2px 10px',
            borderRadius: 10,
          }}>
            {smartEnabled ? '已开启' : '已关闭'}
          </span>
        </h3>

        <p style={{ ...hintStyle, marginBottom: 16 }}>
          开启智能创建任务后，ShelfDeck 将依据视频的目标码率/评分智能创建任务
        </p>

        {smartEnabled && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>允许自动创建的任务类型</label>
              <div style={{ display: 'flex', gap: 16 }}>
                {[
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
                智能创建任务高级配置
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
          </>
        )}
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
  padding: 14,
  border: '2px solid #1a1a2e',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#f8f9fb',
};

const modeCardInactive: React.CSSProperties = {
  padding: 14,
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
