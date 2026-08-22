/** Not a Helix product entry. Official Admin Web routes live in src/helix via App.tsx. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { emby, ruleTemplates, subLibraries } from '../api/client';
import type { SubLibrary } from '../types';
import { Button, Dialog, EmptyState, Field, Loading, Page, PageHeader, Status, Toast } from '../components/ui';

const priorityValue = { high: 50, normal: 100, low: 150 } as const;
function priorityClass(value?: number) { return (value || 100) <= 50 ? 'high' : (value || 100) >= 150 ? 'low' : 'normal'; }
function adultTemplateId(region: string) { return region === 'western_adult' ? 'adult_western_default' : 'adult_jav_default'; }
function defaultTemplateId(mediaType: string, adultRegion: string) {
  if (mediaType === 'adult') return adultTemplateId(adultRegion);
  return mediaType === 'tv' ? 'tv_default' : 'default';
}

const adultCapabilities = { metadata: ['metadata.sidecar.render', 'metadata.image.acquire'], optimize: ['media.transcode', 'media.file.replace', 'source.organize', 'metadata.artifacts.materialize'] };
const adultCapabilityParameters = { 'metadata.image.acquire': { kinds: ['poster', 'fanart'] } };
const generalCapabilities = { metadata: ['metadata.sidecar.render', 'series.metadata.sidecar.render'], optimize: ['media.transcode', 'container.remux', 'source.upgrade.request', 'media.file.replace', 'series.season.replace'] };
const allOptimizeCapabilities = [...new Set([...generalCapabilities.optimize, ...adultCapabilities.optimize])];
const capabilityLabels: Record<string, string> = { 'metadata.sidecar.render': 'NFO资料', 'series.metadata.sidecar.render': '剧集资料', 'metadata.image.acquire': '图片资料', 'media.transcode': '转码', 'container.remux': '重新封装', 'source.upgrade.request': '来源升级', 'media.file.replace': '文件替换', 'series.season.replace': '整季替换', 'source.organize': '文件整理', 'metadata.artifacts.materialize': '资料写入媒体目录' };
const initialLibraryDraft = { name: '', source: 'emby', embyServerId: '', sectionId: '', watchRoot: '', mediaType: 'movie', adultRegion: 'japanese_jav', ruleTemplateId: 'default', libraryAutomationMode: 'manual', maintenanceAutomationMode: 'manual', doubanEnabled: false, allowedCapabilities: generalCapabilities, capabilityParameters: {} as Record<string, { kinds: string[] }> };

function MetadataCapabilityControls({ allowed, parameters, onAllowed, onParameters }: { allowed: string[]; parameters: Record<string, { kinds?: string[] }>; onAllowed: (value: string[]) => void; onParameters: (value: Record<string, { kinds?: string[] }>) => void }) {
  const toggle = (capability: string, checked: boolean) => onAllowed(checked ? [...new Set([...allowed, capability])] : allowed.filter((entry) => entry !== capability));
  const kinds = parameters['metadata.image.acquire']?.kinds || [];
  const toggleKind = (kind: string, checked: boolean) => {
    const nextKinds = checked ? [...new Set([...kinds, kind])] : kinds.filter((entry) => entry !== kind);
    toggle('metadata.image.acquire', nextKinds.length > 0);
    onParameters({ ...parameters, 'metadata.image.acquire': { kinds: nextKinds } });
  };
  return <div className="page-actions">
    <label><input type="checkbox" checked={allowed.includes('metadata.sidecar.render') || allowed.includes('series.metadata.sidecar.render')} onChange={(event) => onAllowed(event.target.checked ? [...new Set([...allowed, 'metadata.sidecar.render', 'series.metadata.sidecar.render'])] : allowed.filter((entry) => !['metadata.sidecar.render', 'series.metadata.sidecar.render'].includes(entry)))} />NFO资料</label>
    <label><input type="checkbox" checked={kinds.includes('poster')} onChange={(event) => toggleKind('poster', event.target.checked)} />海报</label>
    <label><input type="checkbox" checked={kinds.includes('fanart')} onChange={(event) => toggleKind('fanart', event.target.checked)} />背景图</label>
  </div>;
}

function directionSummary(library: SubLibrary) {
  const counts = library.maintenanceSummary?.directionCounts;
  if (!counts) return '尚无维护判断';
  return `转码 ${counts.transcode || 0} · 洗版 ${counts.upgrade || 0} · 无需优化 ${counts.none || 0} · 待判断 ${counts.undetermined || 0}${counts.blocked ? ` · 受阻 ${counts.blocked}` : ''}`;
}

export default function LibrariesPage() {
  const qc = useQueryClient();
  const libraries = useQuery({ queryKey: ['libraries'], queryFn: subLibraries.list });
  const servers = useQuery({ queryKey: ['emby-servers'], queryFn: emby.getServers });
  const templates = useQuery({ queryKey: ['rule-templates'], queryFn: ruleTemplates.list });
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{ library: SubLibrary; action: 'stop' | 'delete' } | null>(null);
  const [capabilityLibrary, setCapabilityLibrary] = useState<SubLibrary | null>(null);
  const [capabilityDraft, setCapabilityDraft] = useState<{ allowed: { metadata: string[]; optimize: string[] }; parameters: Record<string, { kinds?: string[] }> }>({ allowed: generalCapabilities, parameters: {} });
  const [toast, setToast] = useState('');
  const [draft, setDraft] = useState(initialLibraryDraft);
  const folders = useQuery({ queryKey: ['emby-folders', draft.embyServerId], queryFn: () => emby.getMediaFolders(draft.embyServerId), enabled: !!draft.embyServerId && draft.source === 'emby' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['libraries'] });
  const create = useMutation({ mutationFn: () => subLibraries.create({
    name: draft.name,
    source: draft.source,
    embyServerId: draft.source === 'emby' ? draft.embyServerId : '',
    sectionId: draft.source === 'emby' ? draft.sectionId : '',
    watchRoot: draft.source === 'folder' ? draft.watchRoot : '',
    mediaType: draft.source === 'folder' ? 'adult' : draft.mediaType,
    ...(draft.source === 'folder' ? { adultRegion: draft.adultRegion, scraperType: draft.adultRegion === 'western_adult' ? 'western_builtin' : 'shelfdeck_japanese_jav' } : {}),
    ruleTemplateId: draft.ruleTemplateId,
    doubanEnabled: draft.source === 'emby' && draft.doubanEnabled,
    libraryAutomationMode: draft.libraryAutomationMode as 'auto' | 'manual',
    maintenanceAutomationMode: draft.maintenanceAutomationMode as 'auto' | 'manual',
    allowedCapabilities: draft.allowedCapabilities,
    capabilityParameters: draft.capabilityParameters,
  }), onSuccess: () => { refresh(); setCreateOpen(false); setDraft({ ...initialLibraryDraft, embyServerId: defaultServer }); setToast('媒体库已创建'); }, onError: (error) => setToast(error.message) });
  const update = useMutation({ mutationFn: ({ library, patch }: { library: SubLibrary; patch: Partial<SubLibrary> }) => subLibraries.update(library.uuid, patch), onSuccess: refresh, onError: (error) => setToast(error.message) });
  const observe = useMutation({ mutationFn: (library: SubLibrary) => subLibraries.observe(library.uuid), onSuccess: () => setToast('已开始观察媒体库'), onError: (error) => setToast(error.message) });
  const syncPerception = useMutation({ mutationFn: (library: SubLibrary) => subLibraries.syncUserPerception(library.uuid), onSuccess: () => setToast('已开始同步用户偏好'), onError: (error) => setToast(error.message) });
  const stop = useMutation({ mutationFn: (library: SubLibrary) => subLibraries.offboard(library.uuid, { idempotencyKey: `stop-library:${library.uuid}:${Date.now()}` }), onSuccess: () => { refresh(); setToast('媒体库已停止管理'); }, onError: (error) => setToast(error.message) });
  const remove = useMutation({ mutationFn: (library: SubLibrary) => subLibraries.remove(library.uuid), onSuccess: () => { refresh(); setToast('媒体库定义已删除'); }, onError: (error) => setToast(error.message) });
  const serverOptions = servers.data?.servers || [];
  const rows = libraries.data?.subLibraries || [];
  const defaultServer = useMemo(() => serverOptions[0]?.uuid || '', [serverOptions]);

  if (libraries.isLoading || servers.isLoading) return <Page><Loading /></Page>;
  return <Page>
    <PageHeader title="媒体库" meta={`${rows.length} 个媒体库`} actions={<Button variant="primary" icon="plus" onClick={() => { setDraft((value) => ({ ...value, embyServerId: value.embyServerId || defaultServer })); setCreateOpen(true); }}>新建媒体库</Button>} />
    {rows.length === 0 ? <section className="panel"><EmptyState title="尚未创建媒体库" action={serverOptions.length ? <Button variant="primary" onClick={() => setCreateOpen(true)}>新建媒体库</Button> : <Link className="btn btn-primary" to="/settings?tab=connections">连接 Emby</Link>} /></section> : <section className="panel table-wrap">
      <table className="table responsive"><thead><tr><th>媒体库</th><th>来源</th><th>自动管理</th><th>自动维护</th><th>维护策略</th><th>维护方向</th><th>优先级</th><th>操作</th></tr></thead><tbody>{rows.map((library) => <tr key={library.uuid}>
        <td data-label="媒体库"><div className="table-main">{library.name}</div><div className="table-sub">{library.mediaType || 'media'} · 基础信息 {library.maintenanceSummary?.basedataPassed || 0}/{library.maintenanceSummary?.total || 0} · 元数据 {library.maintenanceSummary?.metadataPassed || 0}/{library.maintenanceSummary?.total || 0} · 优化 {library.maintenanceSummary?.optimizePassed || 0}/{library.maintenanceSummary?.total || 0}</div></td>
        <td data-label="来源"><Status tone={library.enabled === false ? 'neutral' : 'success'}>{library.source === 'folder' ? '文件夹' : 'Emby'}</Status></td>
        <td data-label="自动管理"><select className="select" value={library.libraryAutomationMode || 'manual'} onChange={(event) => update.mutate({ library, patch: { libraryAutomationMode: event.target.value as 'auto' | 'manual' } })}><option value="auto">自动</option><option value="manual">手动</option></select></td>
        <td data-label="自动维护"><select className="select" value={library.maintenanceAutomationMode || 'manual'} onChange={(event) => update.mutate({ library, patch: { maintenanceAutomationMode: event.target.value as 'auto' | 'manual' } })}><option value="auto">自动</option><option value="manual">手动</option></select></td>
        <td data-label="维护策略"><select className="select" value={library.ruleTemplateId || 'default'} onChange={(event) => update.mutate({ library, patch: { ruleTemplateId: event.target.value } })}>{(templates.data?.ruleTemplates || []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></td>
        <td data-label="维护方向"><div className="table-sub">{directionSummary(library)}</div></td>
        <td data-label="优先级"><select className="select" value={priorityClass(library.priorityWeight)} onChange={(event) => update.mutate({ library, patch: { priorityWeight: priorityValue[event.target.value as keyof typeof priorityValue] } })}><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select></td>
        <td data-label="操作"><div className="page-actions"><Button variant="quiet" icon="refresh" onClick={() => observe.mutate(library)}>立即观察</Button>{library.doubanEnabled && <Button variant="quiet" onClick={() => syncPerception.mutate(library)}>同步用户偏好</Button>}<Button variant="quiet" onClick={() => { setCapabilityLibrary(library); setCapabilityDraft({ allowed: library.allowedCapabilities || (library.mediaType === 'adult' ? adultCapabilities : generalCapabilities), parameters: library.capabilityParameters || (library.mediaType === 'adult' ? adultCapabilityParameters : {}) }); }}>维护能力</Button><Button variant="quiet" onClick={() => update.mutate({ library, patch: { libraryAutomationMode: 'auto', maintenanceAutomationMode: 'auto' } })}>全自动</Button><Button variant="quiet" onClick={() => setConfirmation({ library, action: 'stop' })}>停止管理</Button><Button variant="danger" onClick={() => setConfirmation({ library, action: 'delete' })}>删除</Button></div></td>
      </tr>)}</tbody></table>
    </section>}
    <Dialog open={createOpen} title="新建媒体库" onClose={() => setCreateOpen(false)} actions={<><Button onClick={() => setCreateOpen(false)}>取消</Button><Button variant="primary" disabled={!draft.name || create.isPending || (draft.source === 'emby' ? !draft.sectionId : !draft.watchRoot)} onClick={() => create.mutate()}>{create.isPending ? '创建中' : '创建媒体库'}</Button></>}>
      <div className="form-grid">
        <Field label="名称"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="来源"><select className="select" value={draft.source} onChange={(e) => { const source = e.target.value; const mediaType = source === 'folder' ? 'adult' : 'movie'; setDraft({ ...draft, source, mediaType, ruleTemplateId: defaultTemplateId(mediaType, draft.adultRegion), allowedCapabilities: source === 'folder' ? adultCapabilities : generalCapabilities, capabilityParameters: source === 'folder' ? adultCapabilityParameters : {} }); }}><option value="emby">Emby 媒体库</option><option value="folder">文件夹</option></select></Field>
        {draft.source === 'emby' ? <>
          <Field label="Emby Server"><select className="select" value={draft.embyServerId} onChange={(e) => setDraft({ ...draft, embyServerId: e.target.value, sectionId: '' })}><option value="">请选择</option>{serverOptions.map((server) => <option key={server.uuid} value={server.uuid}>{server.serverName}</option>)}</select></Field>
          <Field label="Emby Library"><select className="select" value={draft.sectionId} onChange={(e) => setDraft({ ...draft, sectionId: e.target.value })}><option value="">请选择</option>{(folders.data?.folders || []).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></Field>
        </> : <Field label="媒体目录"><input className="input" value={draft.watchRoot} onChange={(e) => setDraft({ ...draft, watchRoot: e.target.value })} placeholder="/media/adult" /></Field>}
        <Field label="媒体类型"><select className="select" value={draft.mediaType} onChange={(e) => { const mediaType = e.target.value; setDraft({ ...draft, mediaType, ruleTemplateId: defaultTemplateId(mediaType, draft.adultRegion) }); }} disabled={draft.source === 'folder'}><option value="movie">电影</option><option value="tv">剧集</option><option value="adult">成人</option></select></Field>
        {draft.source === 'folder' && <Field label="成人类型"><select className="select" value={draft.adultRegion} onChange={(e) => { const adultRegion = e.target.value; setDraft({ ...draft, adultRegion, ruleTemplateId: adultTemplateId(adultRegion) }); }}><option value="japanese_jav">JAV</option><option value="western_adult">欧美成人</option></select></Field>}
        <Field label="维护策略"><select className="select" value={draft.ruleTemplateId} onChange={(e) => setDraft({ ...draft, ruleTemplateId: e.target.value })}>{(templates.data?.ruleTemplates || []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
        <Field label="媒体库自动管理"><select className="select" value={draft.libraryAutomationMode} onChange={(e) => setDraft({ ...draft, libraryAutomationMode: e.target.value })}><option value="auto">自动</option><option value="manual">手动</option></select></Field>
        <Field label="媒体自动维护"><select className="select" value={draft.maintenanceAutomationMode} onChange={(e) => setDraft({ ...draft, maintenanceAutomationMode: e.target.value })}><option value="auto">自动</option><option value="manual">手动</option></select></Field>
        {draft.source === 'emby' && <Field label="同步豆瓣用户偏好"><label className="page-actions"><input type="checkbox" checked={draft.doubanEnabled} onChange={(event) => setDraft({ ...draft, doubanEnabled: event.target.checked })} />启用</label></Field>}
        <Field label="允许的资料能力"><MetadataCapabilityControls allowed={draft.allowedCapabilities.metadata} parameters={draft.capabilityParameters} onAllowed={(metadata) => setDraft({ ...draft, allowedCapabilities: { ...draft.allowedCapabilities, metadata } })} onParameters={(capabilityParameters) => setDraft({ ...draft, capabilityParameters: capabilityParameters as Record<string, { kinds: string[] }> })} /></Field>
        <Field label="允许的优化能力"><div className="page-actions">{allOptimizeCapabilities.map((capability) => <label key={capability}><input type="checkbox" checked={draft.allowedCapabilities.optimize.includes(capability)} onChange={(event) => setDraft({ ...draft, allowedCapabilities: { ...draft.allowedCapabilities, optimize: event.target.checked ? [...draft.allowedCapabilities.optimize, capability] : draft.allowedCapabilities.optimize.filter((entry) => entry !== capability) } })} />{capabilityLabels[capability]}</label>)}</div></Field>
      </div>
    </Dialog>
    <Dialog open={!!capabilityLibrary} title="维护能力" onClose={() => setCapabilityLibrary(null)} actions={<><Button onClick={() => setCapabilityLibrary(null)}>取消</Button><Button variant="primary" onClick={() => { if (capabilityLibrary) update.mutate({ library: capabilityLibrary, patch: { allowedCapabilities: capabilityDraft.allowed, capabilityParameters: capabilityDraft.parameters } }); setCapabilityLibrary(null); }}>保存</Button></>}>
      <div className="stack"><Field label="资料产物"><MetadataCapabilityControls allowed={capabilityDraft.allowed.metadata} parameters={capabilityDraft.parameters} onAllowed={(metadata) => setCapabilityDraft({ ...capabilityDraft, allowed: { ...capabilityDraft.allowed, metadata } })} onParameters={(parameters) => setCapabilityDraft({ ...capabilityDraft, parameters })} /></Field><Field label="优化动作"><div className="page-actions">{allOptimizeCapabilities.map((capability) => <label key={capability}><input type="checkbox" checked={capabilityDraft.allowed.optimize.includes(capability)} onChange={(event) => setCapabilityDraft({ ...capabilityDraft, allowed: { ...capabilityDraft.allowed, optimize: event.target.checked ? [...capabilityDraft.allowed.optimize, capability] : capabilityDraft.allowed.optimize.filter((entry) => entry !== capability) } })} />{capabilityLabels[capability]}</label>)}</div></Field></div>
    </Dialog>
    <Dialog open={!!confirmation} title={confirmation?.action === 'delete' ? '删除媒体库定义' : '停止管理媒体库'} onClose={() => setConfirmation(null)} actions={<><Button onClick={() => setConfirmation(null)}>取消</Button><Button variant={confirmation?.action === 'delete' ? 'danger' : 'primary'} onClick={() => { if (!confirmation) return; if (confirmation.action === 'delete') remove.mutate(confirmation.library); else stop.mutate(confirmation.library); setConfirmation(null); }}>确认</Button></>}>
      <p>{confirmation?.action === 'delete' ? `删除“${confirmation?.library.name}”的 ShelfDeck 定义。` : `停止管理“${confirmation?.library.name}”。`}</p><Status tone="neutral">Emby Library 和媒体文件不会被修改</Status>
    </Dialog>
    <Toast message={toast} />
  </Page>;
}
