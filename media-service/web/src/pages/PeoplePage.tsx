/** Not a Helix product entry. Official Admin Web routes live in src/helix via App.tsx. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { people, type PersonSummary } from '../api/client';
import { Button, Dialog, Drawer, EmptyState, Field, Loading, Page, PageHeader, Status, Toast } from '../components/ui';

const preferences = [
  { value: -2, short: '避', label: '回避' },
  { value: -1, short: '否', label: '不喜欢' },
  { value: 0, short: '常', label: '普通' },
  { value: 1, short: '喜', label: '喜欢' },
  { value: 2, short: '爱', label: '非常喜欢' },
] as const;

function preferenceLabel(value: number) { return preferences.find((item) => item.value === value)?.label || '普通'; }
function contentKindValue(values: string[] = []) { return values.includes('general') && values.includes('adult') ? 'both' : values.includes('adult') ? 'adult' : 'general'; }
function contentKinds(value: string) { return value === 'both' ? ['general', 'adult'] : [value === 'adult' ? 'adult' : 'general']; }

export default function PeoplePage() {
  const pageSize = 50;
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [preference, setPreference] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PersonSummary | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', aliases: '', preference: 0, contentKind: 'general' });
  const [toast, setToast] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const query = useQuery({
    queryKey: ['people', search, kind, preference, page],
    queryFn: () => people.list({ search, contentKind: kind, preference, limit: pageSize, offset: (page - 1) * pageSize }),
  });
  const candidates = useQuery({ queryKey: ['person-merge-candidates'], queryFn: people.mergeCandidates });
  const related = useQuery({ queryKey: ['person-media', selected?.personId], queryFn: () => people.relatedMedia(selected!.personId), enabled: !!selected });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['people'] }); qc.invalidateQueries({ queryKey: ['person-merge-candidates'] }); };
  const update = useMutation({ mutationFn: ({ personId, body }: { personId: string; body: Partial<PersonSummary> }) => people.update(personId, body), onSuccess: (person) => { refresh(); setSelected((current) => current?.personId === person.personId ? person : current); }, onError: (error) => setToast(error.message) });
  const create = useMutation({ mutationFn: () => people.create({ name: draft.name, aliases: draft.aliases.split(',').map((value) => value.trim()).filter(Boolean), preference: draft.preference, contentKinds: contentKinds(draft.contentKind) }), onSuccess: () => { refresh(); setCreateOpen(false); setDraft({ name: '', aliases: '', preference: 0, contentKind: 'general' }); setToast('演员已创建'); }, onError: (error) => setToast(error.message) });
  const merge = useMutation({ mutationFn: ({ targetPersonId, sourcePersonId }: { targetPersonId: string; sourcePersonId: string }) => people.merge({ targetPersonId, sourcePersonId }), onSuccess: () => { refresh(); setToast('演员身份已合并'); }, onError: (error) => setToast(error.message) });
  const addImage = useMutation({ mutationFn: async (file: File) => {
    if (!selected) throw new Error('未选择演员');
    const imageBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); });
    return people.addReferenceImage({ personId: selected.personId, name: selected.name, aliases: selected.aliases, imageBase64 });
  }, onSuccess: (person) => { setSelected(person); refresh(); setToast('参考头像已保存'); }, onError: (error) => setToast(error.message) });
  const deleteFace = useMutation({ mutationFn: ({ personId, artifactId }: { personId: string; artifactId: string }) => people.deleteReferenceFace(personId, artifactId), onSuccess: async () => { if (selected) setSelected(await people.get(selected.personId)); refresh(); setToast('参考人脸已删除'); }, onError: (error) => setToast(error.message) });
  if (query.isLoading) return <Page><Loading /></Page>;
  const rows = query.data?.people || [];
  const total = Number(query.data?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return <Page>
    <PageHeader title="演员" meta={`${total} 位演员`} actions={<><Button onClick={() => setMergeOpen(true)} disabled={!candidates.data?.candidates.length}>身份合并 {candidates.data?.candidates.length ? `(${candidates.data.candidates.length})` : ''}</Button><Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>新建演员</Button></>} />
    <div className="toolbar"><input className="input search" placeholder="搜索演员或别名" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} /><select className="select filter-compact" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">全部内容</option><option value="general">普通</option><option value="adult">成人</option></select><select className="select filter-compact" value={preference} onChange={(e) => { setPreference(e.target.value); setPage(1); }}><option value="">全部偏好</option>{preferences.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
    {rows.length === 0 ? <section className="panel"><EmptyState title="没有匹配的演员" /></section> : <section className="panel table-wrap"><table className="table responsive"><thead><tr><th>演员</th><th>分类</th><th>偏好</th><th>关联媒体</th><th></th></tr></thead><tbody>{rows.map((person) => <tr key={person.personId}>
      <td data-label="演员"><div className="person-cell">{person.referenceFaceCount ? <img className="avatar" src={people.referenceImageUrl(person.personId)} alt="" /> : <div className="avatar">{person.name.slice(0, 1)}</div>}<div><div className="table-main">{person.name}</div><div className="table-sub">{person.aliases.join(' · ') || '无别名'}</div></div></div></td>
      <td data-label="分类"><div className="page-actions">{person.contentKinds.includes('general') && <Status tone="neutral">普通</Status>}{person.contentKinds.includes('adult') && <Status tone="attention">成人</Status>}</div></td>
      <td data-label="偏好"><div className="preference" aria-label={`当前偏好：${preferenceLabel(person.preference)}`}>{preferences.map((item) => <button key={item.value} className={person.preference === item.value ? 'active' : ''} title={item.label} aria-label={item.label} onClick={() => update.mutate({ personId: person.personId, body: { preference: item.value } })}>{item.short}</button>)}</div></td>
      <td data-label="关联媒体" className="numeric">{person.relatedMediaCount}</td>
      <td><Button variant="quiet" onClick={() => people.get(person.personId).then(setSelected).catch((error) => setToast(error.message))}>查看</Button></td>
    </tr>)}</tbody></table>{total > pageSize && <div className="page-actions"><Button variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button><span className="muted">{page} / {totalPages}</span><Button variant="quiet" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</Button></div>}</section>}

    <Drawer open={!!selected} title={selected?.name || '演员'} onClose={() => setSelected(null)}>{selected && <div className="stack">
      <div className="person-cell">{selected.referenceFaceCount ? <img className="avatar avatar-large" src={people.referenceImageUrl(selected.personId, false)} alt="" /> : <div className="avatar avatar-large">{selected.name.slice(0, 1)}</div>}<div><strong>{selected.name}</strong><div className="table-sub">{preferenceLabel(selected.preference)}</div></div></div>
      <Field label="名称"><input className="input" value={selected.name} onChange={(e) => setSelected({ ...selected, name: e.target.value })} onBlur={() => update.mutate({ personId: selected.personId, body: { name: selected.name } })} /></Field>
      <Field label="别名"><input className="input" value={selected.aliases.join(', ')} onChange={(e) => setSelected({ ...selected, aliases: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} onBlur={() => update.mutate({ personId: selected.personId, body: { aliases: selected.aliases } })} /></Field>
      <Field label="分类"><select className="select" value={contentKindValue(selected.contentKinds)} onChange={(e) => { const next = contentKinds(e.target.value); setSelected({ ...selected, contentKinds: next }); update.mutate({ personId: selected.personId, body: { contentKinds: next } }); }}><option value="general">普通</option><option value="adult">成人</option><option value="both">两者</option></select></Field>
      <Field label="参考头像"><input className="input" type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) addImage.mutate(file); }} /></Field>
      {!!selected.referenceFaces?.length && <section><div className="field-label">Reference Face</div><div className="connection-list field-actions">{selected.referenceFaces.map((face) => <div className="connection-row" key={face.artifactId}><span className="table-sub">{face.artifactId}</span><Button variant="danger" onClick={() => deleteFace.mutate({ personId: selected.personId, artifactId: face.artifactId })}>删除</Button></div>)}</div></section>}
      <section><div className="field-label">Provider identity</div>{Object.keys(selected.providerIds).length ? <div className="stack field-actions">{Object.entries(selected.providerIds).map(([key, value]) => <div key={key} className="table-sub">{key}: {value}</div>)}</div> : <p className="table-sub">无</p>}</section>
      <section><div className="field-label">关联媒体</div><div className="stack field-actions">{(related.data?.items || []).slice(0, 20).map((item: any) => <div key={item.subjectId} className="related-media"><strong>{item.name || item.title || item.subjectId}</strong></div>)}</div></section>
    </div>}</Drawer>

    <Dialog open={createOpen} title="新建演员" onClose={() => setCreateOpen(false)} actions={<><Button onClick={() => setCreateOpen(false)}>取消</Button><Button variant="primary" disabled={!draft.name || create.isPending} onClick={() => create.mutate()}>创建演员</Button></>}><div className="stack"><Field label="名称"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field><Field label="别名"><input className="input" value={draft.aliases} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} placeholder="用逗号分隔" /></Field><Field label="分类"><select className="select" value={draft.contentKind} onChange={(e) => setDraft({ ...draft, contentKind: e.target.value })}><option value="general">普通</option><option value="adult">成人</option><option value="both">两者</option></select></Field><Field label="偏好"><select className="select" value={draft.preference} onChange={(e) => setDraft({ ...draft, preference: Number(e.target.value) })}>{preferences.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field></div></Dialog>
    <Dialog open={mergeOpen} title="身份合并" onClose={() => setMergeOpen(false)} actions={<Button onClick={() => setMergeOpen(false)}>关闭</Button>}><div className="stack">{(candidates.data?.candidates || []).map((candidate) => <section key={candidate.candidateId} className="panel"><div className="panel-body"><strong>{candidate.left.name}</strong> 与 <strong>{candidate.right.name}</strong><div className="form-actions"><Button onClick={() => merge.mutate({ targetPersonId: candidate.left.personId, sourcePersonId: candidate.right.personId })}>保留 {candidate.left.name}</Button><Button onClick={() => merge.mutate({ targetPersonId: candidate.right.personId, sourcePersonId: candidate.left.personId })}>保留 {candidate.right.name}</Button></div></div></section>)}</div></Dialog>
    <Toast message={toast} />
  </Page>;
}
