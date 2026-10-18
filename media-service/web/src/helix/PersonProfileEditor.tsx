import {FormEvent,useRef,useState} from 'react';
import {AdminApiError,helixAdminApi,type PeopleProjection} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {isUnauthorized,useSession} from './session';
type Person=PeopleProjection['items'][number];
type Request=Parameters<typeof helixAdminApi.updatePersonProfile>[1];
export default function PersonProfileEditor({person,onSaved,onCancel}:{person:Person;onSaved:()=>void;onCancel:()=>void}){
  const {expire}=useSession(),[name,setName]=useState(person.canonicalName),[aliases,setAliases]=useState(person.aliases.filter(value=>value!==person.canonicalName).join('、'));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),request=useRef<Request|null>(null),[stale,setStale]=useState(false);
  async function submit(event:FormEvent){
    event.preventDefault();setError('');
    if(!request.current)request.current={idempotencyKey:newOpaqueId('people-profile-'),expectedPersonRevision:person.currentRevision,canonicalName:name.trim(),
      aliases:aliases.split(/[,，、\n]/).map(value=>value.trim()).filter(Boolean)};
    setBusy(true);
    try{await helixAdminApi.updatePersonProfile(person.personId,request.current);onSaved();}
    catch(cause){if(isUnauthorized(cause))expire();else if(cause instanceof AdminApiError&&cause.status<500){request.current=null;
      setError(cause.message);if(cause.code==='PEOPLE_PROFILE_REVISION_CONFLICT')setStale(true);
    }else setError('尚未收到保存结果，请重试同一次修改。');}
    finally{setBusy(false);}
  }
  const locked=busy||Boolean(request.current)||stale;
  return <form className="source-create" onSubmit={event=>void submit(event)}>
    <div className="source-create-heading"><h2>编辑 {person.canonicalName}</h2></div>
    <div className="source-form-grid">
      <label><span>演员姓名</span><input value={name} maxLength={200} required disabled={locked} onChange={event=>setName(event.target.value)}/></label>
      <label><span>演员别名</span><input value={aliases} disabled={locked} onChange={event=>setAliases(event.target.value)}/></label>
    </div>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="source-create-footer"><Button variant="primary" type="submit" disabled={busy||stale||!name.trim()}>{busy?'正在保存…':request.current?'重试同一次修改':'保存资料'}</Button>
      <Button type="button" disabled={busy||Boolean(request.current)} onClick={onCancel}>{stale?'关闭并重新读取':'取消'}</Button></div>
  </form>;
}
