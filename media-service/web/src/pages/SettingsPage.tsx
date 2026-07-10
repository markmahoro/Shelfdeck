import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adult, adminSettings, automation, douban, emby, nodes, publicHealth, transcode, upgrade } from '../api/client';
import type { DoubanSession } from '../types';
import { Button, Dialog, Diagnostic, Field, Loading, Page, PageHeader, Panel, Status, Tabs, Toast } from '../components/ui';

type TabKey = 'connections' | 'resources' | 'diagnostics' | 'security';

function Connections() {
  const qc = useQueryClient();
  const servers = useQuery({ queryKey: ['emby-servers'], queryFn: emby.getServers });
  const moviepilot = useQuery({ queryKey: ['moviepilot-config'], queryFn: upgrade.getConfig });
  const doubanQuery = useQuery({ queryKey: ['douban-session'], queryFn: douban.getSession });
  const adultQuery = useQuery({ queryKey: ['adult-config'], queryFn: adult.getConfig });
  const [embyOpen, setEmbyOpen] = useState(false);
  const [embyDraft, setEmbyDraft] = useState({ baseUrl: '', apiKey: '', username: '', password: '' });
  const [mpDraft, setMpDraft] = useState({ baseUrl: '', apiKey: '', savePath: '' });
  const [dbDraft, setDbDraft] = useState<DoubanSession>({ cookieHeader: '', userId: '', interestsRssUrl: '' });
  const [adultDraft, setAdultDraft] = useState<Record<string, string>>({ computeMode: 'local', aiWorkerBaseUrl: '', metadataApiBaseUrl: '', metadataApiKey: '', stashBoxGraphqlUrl: '', stashBoxApiKey: '', tmdbApiKey: '' });
  const [toast, setToast] = useState('');
  useEffect(() => { if (moviepilot.data) setMpDraft(moviepilot.data.moviepilot || { baseUrl: '', apiKey: '', savePath: '' }); }, [moviepilot.data]);
  useEffect(() => { if (doubanQuery.data) setDbDraft(doubanQuery.data); }, [doubanQuery.data]);
  useEffect(() => { if (adultQuery.data) { const value = adultQuery.data.western || {}; setAdultDraft((current) => ({ ...current, ...Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? '')])) })); } }, [adultQuery.data]);
  const testEmby = useMutation({ mutationFn: () => emby.testConnection(embyDraft), onSuccess: () => { qc.invalidateQueries({ queryKey: ['emby-servers'] }); setEmbyOpen(false); setToast('Emby 已连接'); }, onError: (error) => setToast(error.message) });
  const saveMp = useMutation({ mutationFn: () => upgrade.patchConfig({ moviepilot: mpDraft }), onSuccess: () => setToast('MoviePilot 已保存'), onError: (error) => setToast(error.message) });
  const saveDouban = useMutation({ mutationFn: () => douban.saveSession(dbDraft), onSuccess: () => setToast('Douban 已保存'), onError: (error) => setToast(error.message) });
  const saveAdult = useMutation({ mutationFn: () => adult.patchConfig({ western: { ...(adultQuery.data?.western || {}), ...adultDraft } }), onSuccess: () => setToast('成人 Provider 已保存'), onError: (error) => setToast(error.message) });
  if (servers.isLoading || moviepilot.isLoading || doubanQuery.isLoading || adultQuery.isLoading) return <Loading />;
  return <div className="stack">
    <Panel title="Emby" action={<Button variant="primary" onClick={() => setEmbyOpen(true)}>添加连接</Button>}><div className="connection-list">{(servers.data?.servers || []).map((server) => <div className="connection-row" key={server.uuid}><div><strong>{server.serverName}</strong><div className="table-sub">{server.baseUrl}</div></div><Status tone="success">已连接</Status></div>)}</div></Panel>
    <Panel title="MoviePilot" action={<Button onClick={() => saveMp.mutate()}>保存</Button>}><div className="form-grid"><Field label="服务地址"><input className="input" value={mpDraft.baseUrl} onChange={(event) => setMpDraft({ ...mpDraft, baseUrl: event.target.value })} /></Field><Field label="API Key"><input className="input" type="password" value={mpDraft.apiKey} onChange={(event) => setMpDraft({ ...mpDraft, apiKey: event.target.value })} /></Field><Field label="保存目录"><input className="input" value={mpDraft.savePath} onChange={(event) => setMpDraft({ ...mpDraft, savePath: event.target.value })} /></Field></div></Panel>
    <Panel title="Douban" action={<Button onClick={() => saveDouban.mutate()}>保存</Button>}><div className="form-grid"><Field label="用户 ID"><input className="input" value={dbDraft.userId} onChange={(event) => setDbDraft({ ...dbDraft, userId: event.target.value })} /></Field><Field label="RSS 地址"><input className="input" value={dbDraft.interestsRssUrl} onChange={(event) => setDbDraft({ ...dbDraft, interestsRssUrl: event.target.value })} /></Field><Field label="Cookie"><input className="input" type="password" value={dbDraft.cookieHeader} onChange={(event) => setDbDraft({ ...dbDraft, cookieHeader: event.target.value })} /></Field></div></Panel>
    <Panel title="成人 Provider" action={<Button onClick={() => saveAdult.mutate()}>保存</Button>}><div className="form-grid"><Field label="识别方式"><select className="select" value={adultDraft.computeMode} onChange={(event) => setAdultDraft({ ...adultDraft, computeMode: event.target.value })}><option value="local">本机</option><option value="worker">远端 Worker</option></select></Field><Field label="识别服务地址"><input className="input" value={adultDraft.aiWorkerBaseUrl} onChange={(event) => setAdultDraft({ ...adultDraft, aiWorkerBaseUrl: event.target.value })} /></Field><Field label="Metadata Provider"><input className="input" value={adultDraft.metadataApiBaseUrl} onChange={(event) => setAdultDraft({ ...adultDraft, metadataApiBaseUrl: event.target.value })} /></Field><Field label="Metadata API Key"><input className="input" type="password" value={adultDraft.metadataApiKey} onChange={(event) => setAdultDraft({ ...adultDraft, metadataApiKey: event.target.value })} /></Field><Field label="TPDB GraphQL"><input className="input" value={adultDraft.stashBoxGraphqlUrl} onChange={(event) => setAdultDraft({ ...adultDraft, stashBoxGraphqlUrl: event.target.value })} /></Field><Field label="TPDB API Key"><input className="input" type="password" value={adultDraft.stashBoxApiKey} onChange={(event) => setAdultDraft({ ...adultDraft, stashBoxApiKey: event.target.value })} /></Field></div></Panel>
    <Dialog open={embyOpen} title="连接 Emby" onClose={() => setEmbyOpen(false)} actions={<><Button onClick={() => setEmbyOpen(false)}>取消</Button><Button variant="primary" disabled={!embyDraft.baseUrl || testEmby.isPending} onClick={() => testEmby.mutate()}>连接并保存</Button></>}><div className="form-grid"><Field label="服务地址"><input className="input" value={embyDraft.baseUrl} onChange={(event) => setEmbyDraft({ ...embyDraft, baseUrl: event.target.value })} placeholder="http://emby:8096" /></Field><Field label="API Key"><input className="input" type="password" value={embyDraft.apiKey} onChange={(event) => setEmbyDraft({ ...embyDraft, apiKey: event.target.value })} /></Field><Field label="用户名"><input className="input" value={embyDraft.username} onChange={(event) => setEmbyDraft({ ...embyDraft, username: event.target.value })} /></Field><Field label="密码"><input className="input" type="password" value={embyDraft.password} onChange={(event) => setEmbyDraft({ ...embyDraft, password: event.target.value })} /></Field></div></Dialog>
    <Toast message={toast} />
  </div>;
}

function Resources() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['resource-settings'], queryFn: adminSettings.getResources });
  const pool = useQuery({ queryKey: ['device-pool'], queryFn: transcode.getDevicePool });
  const workerQuery = useQuery({ queryKey: ['nodes'], queryFn: nodes.list });
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof adminSettings.getResources>> | null>(null);
  const [workerOpen, setWorkerOpen] = useState(false);
  const [worker, setWorker] = useState({ name: '', address: '', apiKey: '' });
  const [toast, setToast] = useState('');
  useEffect(() => { if (query.data && !draft) setDraft(query.data); }, [query.data, draft]);
  const save = useMutation({ mutationFn: () => adminSettings.patchResources(draft || {}), onSuccess: (data) => { setDraft(data); setToast('资源设置已保存'); }, onError: (error) => setToast(error.message) });
  const addWorker = useMutation({ mutationFn: () => nodes.create(worker), onSuccess: () => { qc.invalidateQueries({ queryKey: ['nodes'] }); setWorkerOpen(false); setToast('Worker 已添加'); }, onError: (error) => setToast(error.message) });
  if (!draft || query.isLoading) return <Loading />;
  const limitFields: Array<[keyof typeof draft.resourceLimits, string]> = [['embyApiPerServer', '每个 Emby 连接'], ['filesystemPerVolume', '每个媒体卷'], ['localFfmpeg', '本机转码'], ['workerPerNode', '每个远端 Worker']];
  return <div className="stack"><Panel title="并发限制" action={<Button variant="primary" onClick={() => save.mutate()}>保存</Button>}><div className="form-grid">{limitFields.map(([key, label]) => <Field label={label} key={key}><input className="input" min="1" max="64" type="number" value={draft.resourceLimits[key]} onChange={(event) => setDraft({ ...draft, resourceLimits: { ...draft.resourceLimits, [key]: Number(event.target.value) } })} /></Field>)}</div></Panel>
    <Panel title="媒体访问与工作空间"><div className="form-grid"><Field label="转码临时目录"><input className="input" value={draft.workspace.transcodeTempRoot} onChange={(event) => setDraft({ ...draft, workspace: { ...draft.workspace, transcodeTempRoot: event.target.value } })} /></Field><Field label="升级暂存目录"><input className="input" value={draft.workspace.upgradeStagingLocalPath} onChange={(event) => setDraft({ ...draft, workspace: { ...draft.workspace, upgradeStagingLocalPath: event.target.value } })} /></Field><Field label="CPU 参与策略"><select className="select" value={draft.compute.transcodeCpuParticipationStrategy} onChange={(event) => setDraft({ ...draft, compute: { ...draft.compute, transcodeCpuParticipationStrategy: event.target.value } })}><option value="normal">正常参与</option><option value="backup_only">仅作为备用</option></select></Field></div></Panel>
    <Panel title="计算设备"><div className="connection-list">{(pool.data?.devices || []).map((device) => <div className="connection-row" key={`${device.nodeId || 'local'}:${device.stableKey}`}><div><strong>{device.label}</strong><div className="table-sub">{device.remote ? device.nodeName : '本机'} · {device.backend}</div></div><Status tone={device.status === 'error' ? 'danger' : device.status === 'busy' ? 'attention' : 'success'}>{device.status === 'busy' ? '使用中' : device.status === 'error' ? '不可用' : '可用'}</Status></div>)}</div></Panel>
    <Panel title="远端 Worker" action={<Button onClick={() => setWorkerOpen(true)}>添加 Worker</Button>}><div className="connection-list">{(workerQuery.data?.nodes || []).map((node) => <div className="connection-row" key={node.id}><div><strong>{node.name}</strong><div className="table-sub">{node.address}</div></div><Status tone={node.status === 'online' ? 'success' : 'danger'}>{node.status === 'online' ? '在线' : '离线'}</Status></div>)}</div></Panel>
    <Dialog open={workerOpen} title="添加远端 Worker" onClose={() => setWorkerOpen(false)} actions={<><Button onClick={() => setWorkerOpen(false)}>取消</Button><Button variant="primary" disabled={!worker.name || !worker.address || addWorker.isPending} onClick={() => addWorker.mutate()}>添加</Button></>}><div className="form-grid"><Field label="名称"><input className="input" value={worker.name} onChange={(event) => setWorker({ ...worker, name: event.target.value })} /></Field><Field label="地址"><input className="input" value={worker.address} onChange={(event) => setWorker({ ...worker, address: event.target.value })} /></Field><Field label="API Key"><input className="input" type="password" value={worker.apiKey} onChange={(event) => setWorker({ ...worker, apiKey: event.target.value })} /></Field></div></Dialog><Toast message={toast} /></div>;
}

function Diagnostics() {
  const health = useQuery({ queryKey: ['public-health'], queryFn: publicHealth.check, refetchInterval: 10000 });
  const engines = useQuery({ queryKey: ['automation-health'], queryFn: automation.get, refetchInterval: 10000 });
  const log = useQuery({ queryKey: ['service-log'], queryFn: () => adminSettings.getLog(300), refetchInterval: 10000 });
  return <div className="stack"><Panel title="服务健康"><Status tone={health.data?.status === 'green' ? 'success' : 'danger'}>{health.data?.status === 'green' ? '正常运行' : '系统故障'}</Status></Panel><Panel title="运行日志"><pre className="log-view">{log.data || '暂无日志'}</pre></Panel><Panel title="内部资源状态"><Diagnostic value={engines.data} /></Panel></div>;
}

function Security() {
  const query = useQuery({ queryKey: ['security-settings'], queryFn: adminSettings.getSecurity });
  const [value, setValue] = useState('');
  const [toast, setToast] = useState('');
  const save = useMutation({ mutationFn: () => adminSettings.patchSecurity({ apiKey: value }), onSuccess: () => { if (value) localStorage.setItem('admin_api_key', value); else localStorage.removeItem('admin_api_key'); setToast('安全设置已保存，重启服务后生效'); }, onError: (error) => setToast(error.message) });
  if (query.isLoading) return <Loading />;
  return <Panel title="API 访问"><div className="stack"><Status tone={query.data?.apiKeyConfigured ? 'success' : 'attention'}>{query.data?.apiKeyConfigured ? '已启用 API Key' : '尚未设置 API Key'}</Status><Field label="新 API Key"><input className="input" type="password" disabled={query.data?.environmentManaged} value={value} onChange={(event) => setValue(event.target.value)} autoComplete="new-password" /></Field><div><Button variant="primary" disabled={query.data?.environmentManaged || save.isPending || (!!value && value.length < 16)} onClick={() => save.mutate()}>保存</Button></div><Toast message={toast} /></div></Panel>;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('connections');
  return <Page><PageHeader title="系统设置" /><Tabs items={[{ key: 'connections', label: '连接与集成' }, { key: 'resources', label: '资源与计算' }, { key: 'diagnostics', label: '系统诊断' }, { key: 'security', label: '安全' }]} value={tab} onChange={(value) => setTab(value as TabKey)} />{tab === 'connections' ? <Connections /> : tab === 'resources' ? <Resources /> : tab === 'diagnostics' ? <Diagnostics /> : <Security />}</Page>;
}
