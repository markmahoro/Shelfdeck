import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { config, emby } from '../api/client';
import type { ServiceConfig } from '../types';

type Tab = 'emby' | 'transcode' | 'scheduler';

const PAGE_TITLE: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  marginBottom: '24px',
};

const CARD: React.CSSProperties = {
  background: '#fff',
  borderRadius: '10px',
  padding: '20px',
  marginBottom: '16px',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  marginBottom: '16px',
};

const TAB_NAV: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px',
};

const TAB_BTN: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #ddd',
  borderRadius: '8px',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '14px',
};

const TAB_BTN_ACTIVE: React.CSSProperties = {
  ...TAB_BTN,
  background: '#4a90d9',
  color: '#fff',
  borderColor: '#4a90d9',
};

const FORM_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr',
  gap: '12px',
  alignItems: 'center',
  marginBottom: '16px',
};

const LABEL: React.CSSProperties = {
  fontSize: '14px',
  color: '#444',
};

const INPUT: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  fontSize: '14px',
  width: '100%',
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '8px 20px',
  background: '#4a90d9',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
};

const BTN_OUTLINE: React.CSSProperties = {
  padding: '8px 20px',
  background: '#fff',
  color: '#4a90d9',
  border: '1px solid #4a90d9',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
};

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>('emby');
  const [testMsg, setTestMsg] = useState('');
  const qc = useQueryClient();

  const { data: cfg, isLoading } = useQuery<ServiceConfig>({
    queryKey: ['config'],
    queryFn: config.get,
  });

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<ServiceConfig>) => config.patch(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  const testMutation = useMutation({
    mutationFn: emby.testConnection,
    onSuccess: (res) => setTestMsg(res.ok ? '连接成功' : res.message || '连接失败'),
    onError: (e: Error) => setTestMsg(e.message),
  });

  const handleTest = () => {
    if (!cfg?.embyClient?.baseUrl || !cfg?.embyClient?.apiKey) return;
    testMutation.mutate({
      baseUrl: cfg.embyClient.baseUrl,
      apiKey: cfg.embyClient.apiKey,
      userId: cfg.embyClient.userId || '',
    });
  };

  const handleSaveEmby = (patch: Partial<ServiceConfig>) => {
    saveMutation.mutate(patch);
  };

  const handleSaveTranscode = (patch: Partial<ServiceConfig>) => {
    saveMutation.mutate(patch);
  };

  const handleSaveScheduler = (patch: Partial<ServiceConfig>) => {
    saveMutation.mutate(patch);
  };

  if (isLoading) return <div style={{ padding: 24 }}>加载中...</div>;

  const embyCfg = cfg?.embyClient;

  return (
    <div>
      <h2 style={PAGE_TITLE}>配置管理</h2>

      {/* Tab Nav */}
      <div style={TAB_NAV}>
        {(['emby', 'transcode', 'scheduler'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={tab === t ? TAB_BTN_ACTIVE : TAB_BTN}
          >
            {t === 'emby' ? '📺 Emby 连接' : t === 'transcode' ? '🎬 转码设置' : '⏰ 调度设置'}
          </button>
        ))}
      </div>

      {/* Emby Tab */}
      {tab === 'emby' && (
        <div style={CARD}>
          <h3 style={SECTION_TITLE}>Emby 连接配置</h3>
          <div style={FORM_GRID}>
            <label style={LABEL}>Emby 地址</label>
            <input
              style={INPUT}
              value={embyCfg?.baseUrl ?? cfg?.baseUrl ?? ''}
              onChange={() => {}}
              placeholder="http://emby.example.com:8096"
            />
            <label style={LABEL}>API Key</label>
            <input
              style={INPUT}
              type="password"
              value={embyCfg?.apiKey ?? cfg?.apiKey ?? ''}
              onChange={() => {}}
              placeholder="xxxxxxxxxxxx"
            />
            <label style={LABEL}>用户 ID</label>
            <input
              style={INPUT}
              value={embyCfg?.userId ?? cfg?.userId ?? ''}
              onChange={() => {}}
              placeholder="用户 ID"
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={BTN_OUTLINE}
              onClick={handleTest}
              disabled={
                testMutation.isPending ||
                !embyCfg?.baseUrl ||
                !embyCfg?.apiKey
              }
            >
              {testMutation.isPending ? '测试中...' : '测试连接'}
            </button>
            <button
              style={BTN_PRIMARY}
              onClick={() =>
                handleSaveEmby({
                  embyClient: {
                    baseUrl: embyCfg?.baseUrl ?? cfg?.baseUrl ?? '',
                    apiKey: embyCfg?.apiKey ?? cfg?.apiKey ?? '',
                    userId: embyCfg?.userId ?? cfg?.userId ?? '',
                  },
                })
              }
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </div>
          {testMsg && (
            <div
              style={{
                marginTop: '12px',
                color: testMsg.includes('成功') ? '#27ae60' : '#e53',
                fontSize: '13px',
              }}
            >
              {testMsg}
            </div>
          )}
        </div>
      )}

      {/* Transcode Tab */}
      {tab === 'transcode' && (
        <div style={CARD}>
          <h3 style={SECTION_TITLE}>转码设置</h3>
          <div style={FORM_GRID}>
            <label style={LABEL}>临时目录</label>
            <input
              style={INPUT}
              value={cfg?.transcodeTempRoot || ''}
              onChange={() => {}}
              placeholder="D:\\transcode_temp"
            />
            <label style={LABEL}>FFmpeg 路径</label>
            <input
              style={INPUT}
              value={cfg?.ffmpegPath || ''}
              onChange={() => {}}
              placeholder="ffmpeg"
            />
            <label style={LABEL}>FFprobe 路径</label>
            <input
              style={INPUT}
              value={cfg?.ffprobePath || ''}
              onChange={() => {}}
              placeholder="ffprobe"
            />
            <label style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={cfg?.transcodeReplaceConfirmRequired ?? false}
                onChange={() => {}}
              />
              替换前需用户确认
            </label>
          </div>
          <button
            style={BTN_PRIMARY}
            onClick={() =>
              handleSaveTranscode({
                transcodeTempRoot: cfg?.transcodeTempRoot,
                transcodeReplaceConfirmRequired: cfg?.transcodeReplaceConfirmRequired,
                ffmpegPath: cfg?.ffmpegPath,
                ffprobePath: cfg?.ffprobePath,
              })
            }
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      )}

      {/* Scheduler Tab */}
      {tab === 'scheduler' && (
        <div style={CARD}>
          <h3 style={SECTION_TITLE}>调度设置</h3>
          <div style={FORM_GRID}>
            <label style={LABEL}>执行模式</label>
            <select
              style={INPUT}
              value={cfg?.executionMode || 'manual'}
              onChange={() => {}}
            >
              <option value="manual">手动</option>
              <option value="scheduled">自动调度</option>
            </select>
            <label style={LABEL}>删除并发数</label>
            <input
              style={INPUT}
              type="number"
              value={cfg?.deleteConcurrency ?? 1}
              min={1}
              max={10}
              onChange={() => {}}
            />
            <label style={LABEL}>转码并发数</label>
            <input
              style={INPUT}
              type="number"
              value={cfg?.transcodeConcurrency ?? 1}
              min={1}
              max={10}
              onChange={() => {}}
            />
            <label style={LABEL}>升级并发数</label>
            <input
              style={INPUT}
              type="number"
              value={cfg?.upgradeConcurrency ?? 1}
              min={1}
              max={10}
              onChange={() => {}}
            />
          </div>
          <button
            style={BTN_PRIMARY}
            onClick={() =>
              handleSaveScheduler({
                executionMode: cfg?.executionMode,
                deleteConcurrency: cfg?.deleteConcurrency,
                transcodeConcurrency: cfg?.transcodeConcurrency,
                upgradeConcurrency: cfg?.upgradeConcurrency,
              })
            }
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      )}
    </div>
  );
}
