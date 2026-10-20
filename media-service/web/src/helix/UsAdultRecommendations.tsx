import {useCallback,useEffect,useRef,useState} from 'react';
import {helixAdminApi,type UsAdultRecommendations as Projection,type UsAdultRecommendation,type RecommendationPublication,
  type RecommendationClaim,type RecommendationClaimAccepted} from './api';
import {Button} from './chrome';
import PersonRegistration from './PersonRegistration';
import UsAdultActorDialog from './UsAdultActorDialog';
import {isUnauthorized,useSession} from './session';

type Selection={kind:'existing'|'create';item:UsAdultRecommendation;publication:RecommendationPublication};
const claimFailure:Record<string,string>={FACE_NOT_FOUND:'图片中没有可用人脸，请换一张清晰的单人照片。',
  FACE_REFERENCE_SINGLE_FACE_REQUIRED:'参考图须恰好包含一张人脸，请重新选择图片。'};
export default function UsAdultRecommendations({refreshKey,disabled,onChanged,onEditingChange}:{refreshKey:number;disabled:boolean;
  onChanged:()=>void;onEditingChange:(value:boolean)=>void}){
  const {expire}=useSession();
  const [projection,setProjection]=useState<Projection|null>(null),[loading,setLoading]=useState(false),[loadFailed,setLoadFailed]=useState(false),
    [error,setError]=useState(''),[notice,setNotice]=useState(''),[selection,setSelection]=useState<Selection|null>(null),
    [images,setImages]=useState<Set<string>>(new Set()),[failedImages,setFailedImages]=useState<Set<string>>(new Set()),
    [tracking,setTracking]=useState<RecommendationClaim|null>(null),[pollPaused,setPollPaused]=useState(false);
  const generation=useRef(0),lastLoadError=useRef(''),changed=useRef(onChanged);changed.current=onChanged;
  const load=useCallback(async()=>{
    const current=++generation.current;setLoading(true);
    try{
      const value=await helixAdminApi.readUsAdultRecommendations();if(current!==generation.current)return;
      if(value.items.length>5||!value.publication&&value.items.length)throw new Error('推荐数据不完整，请刷新后重试。');
      const previousLoadError=lastLoadError.current;setProjection(value);setLoadFailed(false);
      setError(previous=>previous===previousLoadError?'':previous);lastLoadError.current='';
    }catch(cause){if(current!==generation.current)return;
      if(isUnauthorized(cause))expire();else{setLoadFailed(true);lastLoadError.current=cause instanceof Error?cause.message:'人物推荐读取失败。';setError(lastLoadError.current);}
    }finally{if(current===generation.current)setLoading(false);}
  },[expire]);
  useEffect(()=>{void load();return()=>{generation.current++;};},[load,refreshKey]);
  useEffect(()=>{onEditingChange(Boolean(selection));return()=>onEditingChange(false);},[selection,onEditingChange]);
  const completed=useCallback(()=>{setTracking(null);setNotice('演员及来源影片已确认，影片会继续整理。');setError('');void load();changed.current();},[load]);
  useEffect(()=>{
    if(!tracking||pollPaused)return;
    let active=true,timer:ReturnType<typeof setTimeout>;const claimId=tracking.claimId;
    async function poll(){
      try{
        const value=await helixAdminApi.readRecommendationClaim(claimId);if(!active)return;
        if(value.state==='completed'){completed();return;}
        if(value.state==='conflict'||value.state==='person_failed'){
          setTracking(null);setError(value.state==='conflict'?'来源影片或演员资料已变化，请刷新后查看。已完成的演员建档会保留。':
            claimFailure[value.failureCode||'']||'演员参考图未通过校验，请重新选择图片。');void load();changed.current();return;
        }
        setTracking(value);timer=setTimeout(()=>void poll(),1000);
      }catch(cause){if(!active)return;if(isUnauthorized(cause))expire();else{setPollPaused(true);setError('暂时无法读取认领进度，操作会继续。请重试查询。');}}
    }
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[tracking?.claimId,pollPaused,expire,completed,load]);
  function accepted(value:RecommendationClaimAccepted){
    setSelection(null);setError('');setPollPaused(false);
    if(value.state==='completed'){completed();return;}
    if(value.state==='conflict'||value.state==='person_failed'){
      setError(value.state==='conflict'?'来源影片或演员资料已变化，请刷新后查看。':'演员参考图未通过校验，请重新选择图片。');void load();changed.current();return;
    }
    setTracking(value);void load();
  }
  return <section className="source-registry people-recommendations" aria-label="US Adult 人物推荐">
    <div className="source-registry-heading"><div><h2>人物推荐</h2></div>
      <Button type="button" disabled={loading} onClick={()=>{setError('');void load();}}>刷新推荐</Button></div>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-notice" role="status">{notice}</p>}
    {tracking&&<div className="people-recommendation-progress form-neutral" role="status">
      <strong>{tracking.state==='preparing_person'?'正在建立演员档案…':'正在确认来源影片…'}</strong>{!projection?.items.some(item=>item.source.libraRunId===tracking.source.libraRunId)&&<p>{tracking.source.title}</p>}
      {pollPaused&&<Button type="button" onClick={()=>{setPollPaused(false);setError('');}}>重试查询认领进度</Button>}
    </div>}
    {!projection&&loading?<p role="status">正在读取人物推荐…</p>:projection?.items.length?
      <div className="people-contact-sheet people-recommendation-grid">{projection.items.map((item,index)=>{
        const id=item.recommendationId,available=images.has(id)&&!loadFailed&&!disabled&&selection?.kind!=='create',
          activeClaim=item.claim||(tracking?.source.libraRunId===item.source.libraRunId?tracking:null);
        return <article key={id} className="people-card" aria-label={`推荐人物 ${index+1}`}>
          <div className="people-recommendation-photo"><img src={item.imageUrl} alt={`推荐人物 ${index+1} 的来源截图`} loading="lazy"
            onLoad={()=>{setImages(previous=>new Set([...previous,id]));setFailedImages(previous=>new Set([...previous].filter(value=>value!==id)));}}
            onError={()=>{setImages(previous=>new Set([...previous].filter(value=>value!==id)));setFailedImages(previous=>new Set([...previous,id]));}}/>
            {failedImages.has(id)&&<p role="status">图片暂时无法显示，请刷新推荐。</p>}</div>
          <div className="people-card-body"><h3>推荐人物 {index+1}</h3><p>{item.coverageCount} 部暂存影片出现过</p>
            <dl><div><dt>本次确认的来源影片</dt><dd>{item.source.title}</dd></div></dl>
            {activeClaim?tracking?.claimId===activeClaim.claimId?null:<><p className="form-neutral" role="status">{activeClaim.state==='preparing_person'?'正在建立演员档案':'正在确认来源影片'}</p>
              <Button type="button" onClick={()=>{setTracking(activeClaim);setPollPaused(false);setError('');}}>查看认领进度</Button></>:
              <div className="people-recommendation-actions"><Button type="button" disabled={!available} aria-label={`认领推荐人物 ${index+1} 为已有演员`}
                onClick={()=>{setSelection({kind:'existing',item,publication:projection.publication!});setError('');setNotice('');}}>是已有演员</Button>
                <Button type="button" variant="primary" disabled={!available} aria-label={`新建推荐人物 ${index+1} 的演员档案`}
                  onClick={()=>{setSelection({kind:'create',item,publication:projection.publication!});setError('');setNotice('');}}>新建演员档案</Button></div>}
          </div></article>;
      })}</div>:!loadFailed&&!loading&&<p className="people-library-note">暂时没有可推荐的人物。</p>}
    {selection?.kind==='create'&&<PersonRegistration key={selection.item.recommendationId} recommendationFor={selection} onClaimStarted={accepted}
      onCreated={completed} onCancel={()=>setSelection(null)}/>}
    {selection?.kind==='existing'&&<UsAdultActorDialog key={selection.item.recommendationId} recommendation={selection} onClaimStarted={accepted}
      onClose={()=>setSelection(null)} onSelected={completed} onRefresh={()=>void load()} onUnauthorized={expire}/>}
  </section>;
}
