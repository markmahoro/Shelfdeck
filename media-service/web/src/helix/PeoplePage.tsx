import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { helixAdminApi, type PeopleProjection, type PersonLibrary } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import PersonRegistration from './PersonRegistration';
import PersonProfileEditor from './PersonProfileEditor';
import UsAdultRecommendations from './UsAdultRecommendations';
import PersonWorksDialog from './PersonWorksDialog';
import PersonReferencesDialog from './PersonReferencesDialog';
import { isUnauthorized, useSession } from './session';

type RegisteredPerson = PeopleProjection['items'][number];

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => Array.from(word)[0]).join('').toLocaleUpperCase();
  return Array.from(words[0] || '?').slice(0, 2).join('').toLocaleUpperCase();
}

function PersonAvatar({ person }: { person: RegisteredPerson }) {
  const hasTmdbIdentity = person.libraryKind === 'us_adult' ? (person.currentReferenceRevision || 0) > 0 : person.providerIdentities.some((identity) =>
    identity.provider === 'tmdb' && identity.namespace === 'tmdb_person');
  const [state, setState] = useState<'loading' | 'loaded' | 'fallback'>(hasTmdbIdentity ? 'loading' : 'fallback');

  useEffect(() => {
    setState(hasTmdbIdentity ? 'loading' : 'fallback');
  }, [hasTmdbIdentity, person.personId, person.currentReferenceRevision]);

  return <div className="people-avatar" data-state={state}>
    <span className="people-avatar-initials" aria-hidden="true">{initials(person.canonicalName)}</span>
    {hasTmdbIdentity && state !== 'fallback' && <img
      src={helixAdminApi.personAvatarUrl(person.personId,person.libraryKind==='us_adult'?person.currentReferenceRevision:null)}
      alt={`${person.canonicalName}头像`}
      loading="lazy"
      onLoad={() => setState('loaded')}
      onError={() => setState('fallback')}
    />}
    <span className="sr-only">{state === 'loaded' ? '人物头像已加载' : state === 'loading' ? '人物头像加载中' : '使用姓名首字头像'}</span>
  </div>;
}

function PersonCard({ person, onEdit, onAddReference,onWorks }: { person: RegisteredPerson; onEdit?:()=>void;onAddReference?:()=>void;onWorks:()=>void }) {
  const aliases = person.aliases.filter((alias) => alias !== person.canonicalName);
  return <article className="people-card" tabIndex={0} aria-label={`${person.canonicalName}，${person.status === 'active' ? '已登记' : '已合并'}`}>
    <PersonAvatar person={person} />
    <div className="people-card-body">
      <div className="people-card-title">
        <h3>{person.canonicalName}</h3>
        <span data-status={person.status}>{person.status === 'active' ? '已登记' : '已合并'}</span>
      </div>
      <dl>
        <div><dt>别名</dt><dd>{aliases.join('、') || '—'}</dd></div>
        <div><dt>外部编号</dt><dd>{person.providerIdentities.map((identity) => `${identity.provider.toUpperCase()} · ${identity.providerKey}`).join('、') || '—'}</dd></div>
      </dl>
      {onEdit && <Button type="button" onClick={onEdit} aria-label={`编辑 ${person.canonicalName}`}>编辑资料</Button>}
      {onAddReference && <Button type="button" onClick={onAddReference} aria-label={`管理 ${person.canonicalName} 的参考图片`}>参考图片</Button>}
      <Button type="button" onClick={onWorks} aria-label={`查看 ${person.canonicalName} 的相关作品`}>相关作品</Button>
    </div>
  </article>;
}

const libraries:Array<{kind:PersonLibrary;label:string}> = [{kind:'normal',label:'普通演员'},{kind:'jav',label:'JAV 演员'},{kind:'us_adult',label:'US Adult 演员'}];
export default function PeoplePage() {
  const {expire} = useSession();
  const [library,setLibrary] = useState<PersonLibrary>('normal');
  const [projection,setProjection] = useState<PeopleProjection|null>(null), [loading,setLoading] = useState(false);
  const [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [creating,setCreating] = useState(false), [search,setSearch] = useState(''), [query,setQuery] = useState('');
  const [editing,setEditing] = useState<RegisteredPerson|null>(null);
  const [addingReference,setAddingReference] = useState<RegisteredPerson|null>(null);
  const [worksFor,setWorksFor]=useState<RegisteredPerson|null>(null);
  const [recommendationEditing,setRecommendationEditing]=useState(false),[recommendationRefresh,setRecommendationRefresh]=useState(0);
  const sequence = useRef(0);
  const load = useCallback(async (cursor?:string) => {
    const id = ++sequence.current;setLoading(true);setError('');
    try {
      const value = await helixAdminApi.listPeople({libraryKind:library,limit:50,search:query,status:'active',...(cursor?{cursor}:{})});
      if (id !== sequence.current) return;
      setProjection(previous=>cursor && previous ? {...value,items:[...previous.items,...value.items]} : value);
    } catch (cause) {
      if (id !== sequence.current) return;
      if (isUnauthorized(cause)) expire();else setError(cause instanceof Error?cause.message:'人物名录读取失败。');
    } finally {if (id===sequence.current) setLoading(false);}
  },[library,query,expire]);
  useEffect(()=>{setProjection(null);void load();return ()=>{sequence.current++;};},[load]);
  function changeLibrary(value:PersonLibrary) {setLibrary(value);setQuery('');setSearch('');setNotice('');setError('');}
  function submitSearch(event:FormEvent) {event.preventDefault();if (query===search.trim()) void load();else setQuery(search.trim());}
  return <section className="source-page people-page">
    <PageHeader title="人物" actions={<><Button type="button" onClick={()=>{void load();setRecommendationRefresh(value=>value+1);}} disabled={loading}>刷新</Button>
      {library==='us_adult' && !creating && !editing && !addingReference && !recommendationEditing && <Button variant="primary" type="button" onClick={()=>{setCreating(true);setNotice('');}}>新建演员</Button>}</>}/>
    <div className="settings-tabs" role="tablist" aria-label="演员库">{libraries.map(item=><button key={item.kind} type="button" role="tab"
      aria-selected={library===item.kind} disabled={creating||Boolean(editing)||Boolean(addingReference)||recommendationEditing} onClick={()=>changeLibrary(item.kind)}>{item.label}</button>)}</div>
    {library!=='us_adult' && <p className="people-library-note">演员资料由系统收纳和完善，无需手动确认。</p>}
    {creating && <PersonRegistration onCancel={()=>setCreating(false)} onCreated={()=>{setCreating(false);setNotice('演员已建档，可以用于影片识别。');void load();}}/>}
    {addingReference&&<PersonReferencesDialog person={addingReference} onClose={()=>{setAddingReference(null);void load();}}
      onChanged={()=>void load()} onUnauthorized={expire}/>}
    {editing && <PersonProfileEditor key={editing.personId} person={editing} onCancel={()=>{setEditing(null);void load();}} onSaved={()=>{
      setEditing(null);setNotice('演员资料已保存。');void load();
    }}/>}
    {worksFor&&<PersonWorksDialog person={worksFor} onClose={()=>setWorksFor(null)} onUnauthorized={expire}/>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    {library==='us_adult'&&<UsAdultRecommendations refreshKey={recommendationRefresh} disabled={creating||Boolean(editing)||Boolean(addingReference)}
      onChanged={()=>void load()} onEditingChange={setRecommendationEditing}/>}
    <form className="people-filter" onSubmit={submitSearch}><label><span className="sr-only">搜索本库演员</span>
      <input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="按姓名或别名搜索"/></label><Button type="submit" disabled={loading}>搜索</Button></form>
    <section className="source-registry" role="tabpanel" aria-label={libraries.find(item=>item.kind===library)!.label}>
      <div className="source-registry-heading"><h2>已登记人物 <span className="section-count">{projection?.summary.activePersonCount ?? '—'}</span></h2><span>当前显示 {projection?.items.length ?? 0} 条</span></div>
      {!projection && loading ? <LoadingState>正在读取人物名录…</LoadingState> : projection?.items.length ?
        <div className="people-contact-sheet" aria-label="已登记人物名录">{projection.items.map(person=><PersonCard key={person.personId} person={person} onWorks={()=>setWorksFor(person)}
          onEdit={library==='us_adult'&&!creating&&!editing&&!addingReference&&!recommendationEditing?()=>{setEditing(person);setNotice('');}:undefined}
          onAddReference={library==='us_adult'&&!creating&&!editing&&!addingReference&&!recommendationEditing?()=>{setAddingReference(person);setNotice('');}:undefined}/>)}</div> :
        !error && <div className="source-empty"><strong>{query?'没有找到匹配的演员':'本库还没有演员'}</strong></div>}
      {projection?.nextCursor && <div className="source-create-footer"><Button type="button" disabled={loading} onClick={()=>void load(projection.nextCursor!)}>{loading?'正在读取…':'加载更多'}</Button></div>}
    </section>
  </section>;
}
