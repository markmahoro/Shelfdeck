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
  const qc = useQueryClient();

  // Emby tab state
  const [baseUrl, setBaseUrl] = useState(cfg?.embyClient?.baseUrl || cfg?.baseUrl || '');
  const [apiKey, setApiKey] = useState(cfg?.embyClient?.apiKey || cfg?.apiKey || '');
  const [userId, setUserId] = useState(cfg?.embyClient?.userId || cfg?.userId || '');
  const [embyUserPassword, setEmbyUserPassword] = useState(cfg?.embyClient?.embyUserPassword || '');
  const [users, setUsers] = useState<Array<{ Id: string; Name: string }>>([]);
  const [folders, setFolders] = useState<Array<{ Id: string; Name: string }>>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>(cfg?.embyClient?.enabledSectionIds || []);
  const [testMsg, setTestMsg] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  const { data: cfg, isLoading } = useQuery<ServiceConfig>({
    queryKey: ['config'],
    queryFn: config.get,
  });

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<ServiceConfig>) => config.patch(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  // Emby tab handlers
  const handleFetchUsers = async () => {
    if (!baseUrl || !apiKey) return;
    setTestLoading(true);
    try {
      const list = await emby.listUsers({ baseUrl, apiKey });
      setUsers(list);
    } catch (e: any) {
      setTestMsg('获取用户列表失败: ' + e.message);
    } finally {
      setTestLoading(false);
    }
  };

  const handleFetchFolders = async () => {
    if (!baseUrl || !apiKey) return;
    setTestLoading(true);
    try {
      const list = await emby.listMediaFolders({ baseUrl, apiKey });
      setFolders(list);
    } catch (e: any) {
      setTestMsg('获取媒体库失败: ' + e.message);
    } finally {
      setTestLoading(false);
    }
  };

  const handleTest = async () => {
    if (!baseUrl || !apiKey) return;
    setTestLoading(true);
    try {
      const res = await emby.testConnection({ baseUrl, apiKey, userId });
      setTestMsg(res.ok ? '连接成功' : (res.message || '连接失败'));
    } catch (e: any) {
      setTestMsg('连接失败: ' + e.message);
    } finally {
      setTestLoading(false);
    }
  };

  const handleSaveEmby = () => {
    saveMutation.mutate({
      embyClient: { baseUrl, apiKey, userId, embyUserPassword },
      enabledSectionIds: selectedSections,
    });
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
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://emby.example.com:8096"
            />
            <label style={LABEL}>API Key</label>
            <input
              style={INPUT}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="xxxxxxxxxxxx"
            />
            <label style={LABEL}>用户密码</label>
            <input
              style={INPUT}
              type="password"
              value={embyUserPassword}
              onChange={(e) => setEmbyUserPassword(e.target.value)}
              placeholder="可选：用户密码（用于刮削）"
            />
          </div>

          {/* Fetch Users */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              style={BTN_OUTLINE}
              onClick={handleFetchUsers}
              disabled={testLoading || !baseUrl || !apiKey}
            >
              {testLoading ? '获取中...' : '获取用户列表'}
            </button>
            {users.length > 0 && (
              <select
                style={{ ...INPUT, maxWidth: '200px' }}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">选择用户</option>
                {users.map((u) => (
                  <option key={u.Id} value={u.Id}>
                    {u.Name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Fetch Folders */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              style={BTN_OUTLINE}
              onClick={handleFetchFolders}
              disabled={testLoading || !baseUrl || !apiKey}
            >
              {testLoading ? '获取中...' : '获取媒体库'}
            </button>
          </div>

          {/* Folder Checkboxes */}
          {folders.length > 0 && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#f9f9f9', borderRadius: '6px' }}>
              <div style={{ marginBottom: '8px', fontSize: '13px', color: '#666' }}>选择媒体库（多选）：</div>
              {folders.map((f) => (
                <label
                  key={f.Id}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedSections.includes(f.Id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSections([...selectedSections, f.Id]);
                      } else {
                        setSelectedSections(selectedSections.filter((id) => id !== f.Id));
                      }
                    }}
                  />
                  {f.Name}
                </label>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={BTN_OUTLINE}
              onClick={handleTest}
              disabled={testLoading || !baseUrl || !apiKey}
            >
              {testLoading ? '测试中...' : '测试连接'}
            </button>
            <button
              style={BTN_PRIMARY}
              onClick={handleSaveEmby}
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
