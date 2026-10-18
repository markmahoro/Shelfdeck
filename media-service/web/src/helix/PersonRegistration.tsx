import { FormEvent, useEffect, useRef, useState } from 'react';
import { AdminApiError, helixAdminApi, type PersonImageSearch, type PersonImageSelection, type PeopleProjection,
  type UsAdultRecommendation,type RecommendationPublication,type RecommendationClaimRequest,type RecommendationClaimAccepted } from './api';
import { Button } from './chrome';
import { newOpaqueId } from './id';
import { isUnauthorized, useSession } from './session';

type RegistrationRequest = Parameters<typeof helixAdminApi.registerPerson>[0];
type ReferenceRequest = {personId:string;body:Parameters<typeof helixAdminApi.addPersonReference>[1]};
type RecommendationRequest={recommendationId:string;body:RecommendationClaimRequest};
const failureCopy:Record<string,string> = {
  FACE_NOT_FOUND:'图片中没有检测到可用人脸，请换一张清晰的正面照片。',
  FACE_REFERENCE_SINGLE_FACE_REQUIRED:'参考图片必须恰好包含一张人脸，请重新选图。',
  FACE_IMAGE_INVALID:'图片无法解码，请选择有效的 JPEG、PNG 或 WebP 图片。',
  FACE_MODEL_PACK_MISSING:'本机人脸模型尚未安装，请安装服务模型包后重试。',
  FACE_MODEL_PACK_INVALID:'本机人脸模型校验失败，请检查服务模型包后重试。',
  P6_PEOPLE_REFERENCE_REVISION_CONFLICT:'演员资料或参考图已变化，请关闭后重新读取。',
};
function upload(file:File):Promise<{image:PersonImageSelection;preview:string}> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size) {
    return Promise.reject(new Error('请选择不超过 10 MiB 的 JPEG、PNG 或 WebP 图片。'));
  }
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.onload = () => {
      const value = String(reader.result), comma = value.indexOf(',');
      if (comma < 0) reject(new Error('图片读取失败。'));
      else resolve({image:{kind:'upload',bytesBase64:value.slice(comma+1)},preview:value});
    };
    reader.readAsDataURL(file);
  });
}
export default function PersonRegistration({onCreated,onCancel,referenceFor,recommendationFor,onClaimStarted}:{onCreated:()=>void;onCancel:()=>void;
  referenceFor?:PeopleProjection['items'][number];recommendationFor?:{item:UsAdultRecommendation;publication:RecommendationPublication};
  onClaimStarted?:(value:RecommendationClaimAccepted)=>void}) {
  const {expire} = useSession();
  const [name,setName] = useState(referenceFor?.canonicalName || ''), [aliases,setAliases] = useState('');
  const [selected,setSelected] = useState<PersonImageSelection|{kind:'recommendation'}|null>(recommendationFor?{kind:'recommendation'}:null),
    [preview,setPreview] = useState(recommendationFor?.item.imageUrl||''),[previewReady,setPreviewReady]=useState(false);
  const [results,setResults] = useState<PersonImageSearch|null>(null);
  const [searching,setSearching] = useState(false), [reading,setReading] = useState(false);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [operation,setOperation] = useState<string|null>(null), [pollPaused,setPollPaused] = useState(false);
  const request = useRef<RegistrationRequest|ReferenceRequest|RecommendationRequest|null>(null), searchSequence = useRef(0), fileSequence = useRef(0);
  const mounted = useRef(true);
  const form=useRef<HTMLFormElement>(null);
  useEffect(()=>{if(recommendationFor)form.current?.querySelector<HTMLInputElement>('input')?.focus();},[recommendationFor?.item.recommendationId]);
  useEffect(() => {mounted.current=true;return () => {mounted.current=false;searchSequence.current++;fileSequence.current++;};},[]);
  const locked = busy || operation !== null || request.current !== null;
  const created = useRef(onCreated); created.current = onCreated;
  useEffect(() => {
    if (!operation || pollPaused) return;
    let active = true, timer:ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const status = await helixAdminApi.getPersonImageOperation(operation!);
        if (!active) return;
        if (status.state === 'completed') {created.current();return;}
        if (status.state === 'failed') {
          setError(failureCopy[status.failureCode || ''] || `图片建档失败（${status.failureCode || 'UNKNOWN'}），请修正后重新提交。`);
          setOperation(null);request.current = null;setBusy(false);return;
        }
        timer = setTimeout(() => void poll(),1000);
      } catch (cause) {
        if (!active) return;
        if (isUnauthorized(cause)) expire();
        else {setError('暂时无法读取校验进度，演员建档仍保留。请重试查询。');setPollPaused(true);}
      }
    }
    void poll();return () => {active = false;clearTimeout(timer);};
  },[operation,pollPaused,expire]);
  async function search() {
    const sequence = ++searchSequence.current;
    setSearching(true);setError('');setResults(null);
    try {
      const value = await helixAdminApi.searchPersonImages(name.trim());
      if (sequence === searchSequence.current && mounted.current) setResults(value);
    } catch (cause) {
      if (sequence !== searchSequence.current || !mounted.current) return;
      if (isUnauthorized(cause)) expire();else setError(cause instanceof Error ? cause.message : '搜图失败。');
    } finally {if (sequence === searchSequence.current && mounted.current) setSearching(false);}
  }
  async function selectFile(file?:File) {
    const sequence = ++fileSequence.current;
    setSelected(null);setPreview('');setPreviewReady(false);setError('');
    if (!file) return;
    setReading(true);
    try {
      const value = await upload(file);
      if (sequence === fileSequence.current && mounted.current) {setSelected(value.image);setPreview(value.preview);}
    } catch (cause) {if (sequence === fileSequence.current && mounted.current) setError((cause as Error).message);}
    finally {if (sequence === fileSequence.current && mounted.current) setReading(false);}
  }
  async function submit(event:FormEvent) {
    event.preventDefault();setError('');
    if (!request.current) {
      if (!selected || !name.trim()) {setError('请填写姓名并选择参考图片。');return;}
      if(recommendationFor){
        if(!previewReady)return;
        request.current={recommendationId:recommendationFor.item.recommendationId,body:{idempotencyKey:newOpaqueId('us-recommendation-create-'),
          expectedPublicationRevision:recommendationFor.publication.revision,expectedSnapshotDigest:recommendationFor.publication.snapshotDigest,
          target:{kind:'create',canonicalName:name.trim(),aliases:aliases.split(/[,，\n]/).map(value=>value.trim()).filter(Boolean),image:selected}}};
      }else{
        if(selected.kind==='recommendation')return;
        request.current = referenceFor?{personId:referenceFor.personId,body:{idempotencyKey:newOpaqueId('us-person-image-'),
        expectedPersonRevision:referenceFor.currentRevision,expectedReferenceRevision:referenceFor.currentReferenceRevision!,image:selected}}:
        {idempotencyKey:newOpaqueId('us-person-'),libraryKind:'us_adult',canonicalName:name.trim(),
        aliases:aliases.split(/[,，\n]/).map(value=>value.trim()).filter(Boolean),image:selected};
      }
    }
    setBusy(true);
    try {
      if('recommendationId' in request.current){
        const accepted=await helixAdminApi.claimUsAdultRecommendation(request.current.recommendationId,request.current.body);
        if(mounted.current)onClaimStarted?.(accepted);return;
      }
      const accepted = 'personId' in request.current ? await helixAdminApi.addPersonReference(request.current.personId,request.current.body):await helixAdminApi.registerPerson(request.current);
      if (mounted.current) {setOperation(accepted.operationRef);setPollPaused(false);}
    } catch (cause) {
      if (!mounted.current) return;
      if (isUnauthorized(cause)) expire();
      else if (cause instanceof AdminApiError && cause.status >= 400 && cause.status < 500) {request.current=null;setError(cause.message);}
      else setError('尚未收到提交结果，请重试同一次建档。');
    } finally {if (mounted.current) setBusy(false);}
  }
  return <form ref={form} className="source-create people-registration" onSubmit={event=>void submit(event)}>
    <div className="source-create-heading"><h2>{referenceFor?`补充 ${referenceFor.canonicalName} 的参考图片`:'新建 US Adult 演员'}</h2>
      <p>{recommendationFor?`建档后会自动确认来源影片：${recommendationFor.item.source.title}。其余影片保持原状。`:
        referenceFor?'选择一张清晰的单人照片，校验成功后加入这位演员的参考图。':'姓名和一张清晰的单人照片齐备后，演员才可用于影片识别。'}</p></div>
    <fieldset disabled={locked}><div className="source-form-grid">
      <label><span>{referenceFor?'搜图姓名':'姓名'}</span><input value={name} maxLength={200} required onChange={event=>{
        setName(event.target.value);searchSequence.current++;setResults(null);setSearching(false);
      }}/></label>
      {!referenceFor&&<label><span>别名</span><input value={aliases} onChange={event=>setAliases(event.target.value)} placeholder="可选，逗号分隔"/></label>}
    </div><div className="people-image-tools">
      <label><span>上传参考图片</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>void selectFile(event.target.files?.[0])}/></label>
      <Button type="button" disabled={!name.trim() || searching || reading} onClick={()=>void search()}>{searching?'正在搜索…':'按姓名辅助搜图'}</Button>
    </div>
    {results && <div className="people-search-sources">{results.sources.map(source=><section key={source.source} aria-label={source.source==='stashbox'?'StashBox 图片':'Wikimedia 图片'}>
      <h3>{source.source==='stashbox'?'StashBox':'Wikimedia Commons'}</h3>
      {source.state==='unconfigured' && <p>尚未配置，请在设置中连接 StashBox。</p>}
      {source.state==='failed' && <p role="alert">{source.error?.message || '此来源搜索失败。'}</p>}
      {source.state==='empty' && <p>没有找到可用图片。</p>}
      <div className="people-image-options">{source.items.map(item=><div className="people-image-option" key={item.selectionToken}>
        <button type="button" aria-pressed={selected?.kind==='search' && selected.selectionToken===item.selectionToken}
          aria-label={`选择 ${item.canonicalName} 的图片，${item.attribution}`} disabled={reading} onClick={()=>{
            setSelected({kind:'search',selectionToken:item.selectionToken});setPreview(helixAdminApi.personImagePreviewUrl(item.selectionToken));setPreviewReady(false);setError('');
          }}><img src={helixAdminApi.personImagePreviewUrl(item.selectionToken)} alt={item.canonicalName} loading="lazy"/><span>{item.canonicalName}</span></button>
        <a href={item.sourcePageUrl} target="_blank" rel="noreferrer">{item.attribution}</a>
      </div>)}</div>
    </section>)}</div>}
    {recommendationFor&&selected?.kind!=='recommendation'&&<Button type="button" onClick={()=>{
      setSelected({kind:'recommendation'});setPreview(recommendationFor.item.imageUrl);setPreviewReady(false);setError('');
    }}>使用来源影片截图</Button>}
    {preview && <figure className="people-selected-image"><img src={preview} alt="已选择的演员参考图片" onLoad={()=>setPreviewReady(true)}
      onError={()=>{setPreviewReady(false);if(recommendationFor)setError('参考图片无法显示，请重新选择。');}}/><figcaption>已选择这张图片</figcaption></figure>}
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    {operation && <p role="status">{referenceFor?'正在校验并保存参考图片…':'正在校验参考图片并建立演员档案…'}</p>}
    <div className="source-create-footer">
      {pollPaused ? <Button type="button" onClick={()=>{setError('');setPollPaused(false);}}>重试查询</Button> :
        <Button variant="primary" type="submit" disabled={busy || operation!==null || reading || searching || (!request.current && (!selected || !name.trim()||Boolean(recommendationFor&&!previewReady)))}>
          {busy?'正在提交…':request.current && !operation?'重试同一次建档':recommendationFor?'建档并确认来源':referenceFor?'确认添加图片':'确认建档'}
        </Button>}
      <Button type="button" disabled={locked} onClick={onCancel}>取消</Button>
    </div>
  </form>;
}
