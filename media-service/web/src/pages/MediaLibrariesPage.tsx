import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subLibraries, emby } from '../api/client';
import type { SubLibrary, EmbyUser, MediaFolder } from '../types';
import Modal from '../components/Modal';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

export default function MediaLibrariesPage() {
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

  // Queries
  const { data: slData, isLoading } = useQuery({
    queryKey: ['sublibraries'],
    queryFn: subLibraries.list,
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

  // Mutations
  const deleteMut = useMutation({
    mutationFn: subLibraries.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sublibraries'] }); setAlert({ type: 'success', msg: '媒体库已删除' }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ uuid, enabled }: { uuid: string; enabled: boolean }) => subLibraries.update(uuid, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sublibraries'] }),
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
        ruleTemplateId: 'default',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sublibraries'] });
      setAlert({ type: 'success', msg: '媒体库添加成功' });
      closeWizard();
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  function closeWizard() {
    setWizardOpen(false);
    setStep(1);
    setBaseUrl('');
    setApiKey('');
    setEmbyServerId('');
    setSelectedUserId('');
    setSelectedSectionId('');
    setSubLibName('');
    setDoubanEnabled(false);
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

  if (isLoading) return <LoadingSpinner />;

  const subLibs: SubLibrary[] = slData?.subLibraries || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>媒体库管理</h2>
        <button
          onClick={() => setWizardOpen(true)}
          style={{
            background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px',
            borderRadius: 6, cursor: 'pointer', fontSize: 14,
          }}
        >
          添加媒体库
        </button>
      </div>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}

      {subLibs.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 10, padding: 40, textAlign: 'center', color: '#888' }}>
          暂无媒体库，点击「添加媒体库」开始配置
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ textAlign: 'left', padding: '12px 16px', borderBottom: '2px solid #eee', color: '#666' }}>名称</th>
                <th style={{ textAlign: 'left', padding: '12px 16px', borderBottom: '2px solid #eee', color: '#666' }}>豆瓣同步</th>
                <th style={{ textAlign: 'left', padding: '12px 16px', borderBottom: '2px solid #eee', color: '#666' }}>状态</th>
                <th style={{ textAlign: 'left', padding: '12px 16px', borderBottom: '2px solid #eee', color: '#666' }}>最后刷新</th>
                <th style={{ textAlign: 'center', padding: '12px 16px', borderBottom: '2px solid #eee', color: '#666' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {subLibs.map((sl) => (
                <tr key={sl.uuid}>
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>{sl.name}</td>
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
                    {sl.doubanEnabled ? '✅' : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
                    <span style={{ color: sl.enabled ? '#27ae60' : '#888' }}>{sl.enabled ? '启用' : '暂停'}</span>
                  </td>
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', fontSize: 12, color: '#888' }}>
                    {sl.lastRefreshedAt ? new Date(sl.lastRefreshedAt).toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', textAlign: 'center' }}>
                    <button
                      onClick={() => toggleMut.mutate({ uuid: sl.uuid, enabled: !sl.enabled })}
                      style={{ background: 'none', border: 'none', color: '#1a1a2e', cursor: 'pointer', fontSize: 13, marginRight: 8 }}
                    >
                      {sl.enabled ? '暂停' : '启用'}
                    </button>
                    <button
                      onClick={() => { if (confirm('确认删除此媒体库？')) deleteMut.mutate(sl.uuid); }}
                      style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 13 }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Wizard Modal */}
      <Modal open={wizardOpen} title={`添加媒体库 (${step}/4)`} onClose={closeWizard} width={520}>
        {step === 1 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>服务器地址</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://192.168.1.100:8096"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Emby API Key"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
              />
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
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}
            >
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
            <select
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}
            >
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
              <input
                type="text"
                value={subLibName}
                onChange={(e) => setSubLibName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
              />
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
                    <th style={{ padding: 4 }}>2★</th>
                    <th style={{ padding: 4 }}>3★</th>
                    <th style={{ padding: 4 }}>4★</th>
                    <th style={{ padding: 4 }}>5★</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: 4 }}>1080p</td>
                    {[
                      [policy1080_2, setPolicy1080_2],
                      [policy1080_3, setPolicy1080_3],
                      [policy1080_4, setPolicy1080_4],
                      [policy1080_5, setPolicy1080_5],
                    ].map(([val, setter], i) => (
                      <td key={i} style={{ padding: 4 }}>
                        <input
                          type="number"
                          value={val as number}
                          onChange={(e) => (setter as (v: number) => void)(Number(e.target.value))}
                          min={0}
                          style={{ width: 50, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
                        />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td style={{ padding: 4 }}>4K</td>
                    {[
                      [policy4k_2, setPolicy4k_2],
                      [policy4k_3, setPolicy4k_3],
                      [policy4k_4, setPolicy4k_4],
                      [policy4k_5, setPolicy4k_5],
                    ].map(([val, setter], i) => (
                      <td key={i} style={{ padding: 4 }}>
                        <input
                          type="number"
                          value={val as number}
                          onChange={(e) => (setter as (v: number) => void)(Number(e.target.value))}
                          min={0}
                          style={{ width: 50, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(3)} style={secondaryBtn}>上一步</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!subLibName || createMut.isPending}
                style={primaryBtn}
              >
                {createMut.isPending ? '创建中...' : '完成添加'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const secondaryBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};
