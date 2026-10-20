import {useEffect,useRef,useState} from 'react';
import {AdminApiError,helixAdminApi,type PeopleProjection} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {useModalFocus} from './useModalFocus';
import {isUnauthorized} from './session';
import PersonRegistration from './PersonRegistration';
type Gallery=Awaited<ReturnType<typeof helixAdminApi.readPersonReferences>>;
type Release={assetId:string;body:Parameters<typeof helixAdminApi.releasePersonReference>[2]};
export default function PersonReferencesDialog({person,onClose,onChanged,onUnauthorized}:{person:PeopleProjection['items'][number];onClose:()=>void;onChanged:()=>void;onUnauthorized:()=>void}){
  const [gallery,setGallery]=useState<Gallery|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),
    [editing,setEditing]=useState<{replaceAssetId?:string}|null>(null),[editPending,setEditPending]=useState(false),[operation,setOperation]=useState<string|null>(null),
    [pollPaused,setPollPaused]=useState(false),[ready,setReady]=useState<Set<string>>(new Set()),generation=useRef(0),pending=useRef<Release|null>(null),
    busy=saving||editPending||operation!==null||pending.current!==null,content=useModalFocus(true,onClose,busy);
  async function load(){const version=generation.current;setLoading(true);
    try{const value=await helixAdminApi.readPersonReferences(person.personId);if(version!==generation.current)return;
      if(value.personId!==person.personId||value.libraryKind!=='us_adult')throw new Error('Reference gallery has a foreign Person scope.');
      setGallery(value);setReady(new Set());
    }catch(cause){if(version!==generation.current)return;if(isUnauthorized(cause))onUnauthorized();else setError('参考图片读取失败，请重试。');}
    finally{if(version===generation.current)setLoading(false);}}
  useEffect(()=>{generation.current++;void load();return()=>{generation.current++;};},[person.personId]);
  useEffect(()=>{if(!operation||pollPaused)return;let active=true,timer:ReturnType<typeof setTimeout>;
    async function poll(){try{const value=await helixAdminApi.getPersonImageOperation(operation!);if(!active)return;
      if(value.state==='completed'){setOperation(null);pending.current=null;setError('');await load();onChanged();return;}
      if(value.state==='failed'){setOperation(null);pending.current=null;setError('参考图片已变化，本次移除未完成，请重新读取。');await load();return;}
      timer=setTimeout(()=>void poll(),1000);
    }catch(cause){if(!active)return;if(isUnauthorized(cause))onUnauthorized();else{setPollPaused(true);setError('暂时无法读取处理进度，请重试查询。');}}}
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[operation,pollPaused]);
  async function release(assetId:string){if(saving||!gallery)return;const version=generation.current;
    pending.current??={assetId,body:{idempotencyKey:newOpaqueId('reference-release-'),expectedPersonRevision:gallery.currentRevision,
      expectedReferenceRevision:gallery.currentReferenceRevision}};setSaving(true);setError('');
    try{const result=await helixAdminApi.releasePersonReference(person.personId,pending.current.assetId,pending.current.body);if(version!==generation.current)return;
      setOperation(result.operationRef);setPollPaused(false);
    }catch(cause){if(version!==generation.current)return;if(isUnauthorized(cause))onUnauthorized();
      else if(cause instanceof AdminApiError&&cause.status<500){pending.current=null;setError(cause.message);await load();}
      else setError('尚未收到移除结果，请重试同一次操作。');
    }finally{if(version===generation.current)setSaving(false);}}
  const current=gallery?{...person,currentRevision:gallery.currentRevision,currentReferenceRevision:gallery.currentReferenceRevision}:person;
  return <div className="dialog-scrim" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <section ref={content} tabIndex={-1} className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="person-references-title">
      <div className="dialog-head"><h2 id="person-references-title">{person.canonicalName} 的参考图片</h2></div>
      <div className="dialog-body stack">
        {error&&<p role="alert" className="form-error">{error}</p>}
        {loading&&<p role="status">正在读取参考图片…</p>}
        {!gallery&&!loading&&<Button type="button" onClick={()=>{setError('');void load();}}>重新读取</Button>}
        {operation&&<p role="status">正在保存参考图片变更…</p>}
        {pollPaused&&<Button type="button" onClick={()=>{setPollPaused(false);setError('');}}>重试查询</Button>}
        {pending.current&&!operation&&!saving&&<Button type="button" onClick={()=>void release(pending.current!.assetId)}>重试移除</Button>}
        {editing?<PersonRegistration key={editing.replaceAssetId||'add'} referenceFor={current} replaceAssetId={editing.replaceAssetId} onPendingChange={setEditPending}
          onCancel={()=>setEditing(null)} onCreated={()=>{setEditing(null);void load();onChanged();}}/>:<>
          <div className="people-reference-gallery">{gallery?.referenceImages.map((image,index)=><article key={image.referenceAssetId}>
            <img src={helixAdminApi.personReferenceUrl(person.personId,image.referenceAssetId,gallery.currentReferenceRevision)} alt={`参考图片 ${index+1}`}
              onLoad={()=>setReady(previous=>new Set([...previous,image.referenceAssetId]))}
              onError={()=>setReady(previous=>new Set([...previous].filter(id=>id!==image.referenceAssetId)))}/>
            <div><Button type="button" disabled={busy||loading||!ready.has(image.referenceAssetId)} onClick={()=>setEditing({replaceAssetId:image.referenceAssetId})}>替换图片 {index+1}</Button>
              <Button type="button" disabled={busy||loading||gallery.referenceImages.length<=1||!ready.has(image.referenceAssetId)} onClick={()=>void release(image.referenceAssetId)}>移除图片 {index+1}</Button></div>
          </article>)}</div>
          {gallery&&<Button type="button" disabled={busy||loading||gallery.referenceImages.length>=256} onClick={()=>setEditing({})}>补充参考图</Button>}
        </>}
      </div><div className="dialog-actions"><Button type="button" disabled={busy} onClick={onClose}>关闭</Button></div>
    </section>
  </div>;
}
