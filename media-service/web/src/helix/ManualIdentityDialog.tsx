import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/ui';
import { Button } from './chrome';
import { AdminApiError, helixAdminApi, type FormationSubject, type ProductIdentityPreview } from './api';
import { newOpaqueId } from './id';

export default function ManualIdentityDialog({item,onClose,onSelected,onRefresh,onUnauthorized}:{item:FormationSubject;onClose:()=>void;onSelected:()=>void;onRefresh:()=>void;onUnauthorized?:()=>void}) {
  const series = item.contentProfile === 'series';
  const identityLabel = series ? '剧集身份' : '影片身份';
  const idLabel = series ? 'TMDB 剧集 ID' : 'TMDB 影片 ID';
  const previewId = (value: ProductIdentityPreview) => 'tmdbSeriesId' in value ? value.tmdbSeriesId : value.tmdbMovieId;
  const [id,setId]=useState('');
  const [movie,setMovie]=useState<ProductIdentityPreview|null>(null);
  const [querying,setQuerying]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [stale,setStale]=useState(false);
  const [error,setError]=useState('');
  const [posterFailed,setPosterFailed]=useState(false);
  const generation=useRef(0);
  const command=useRef<string|null>(null);
  const input=useRef<HTMLInputElement>(null);
  const content=useRef<HTMLDivElement>(null);
  const valid=/^[1-9]\d{0,14}$/.test(id)&&Number.isSafeInteger(Number(id));
  useEffect(()=>{input.current?.focus();return()=>{generation.current++;};},[]);
  useEffect(()=>{
    const dialog=content.current?.closest('[role="dialog"]');
    if(!dialog)return;
    const keydown=(event:Event)=>{
      const key=event as KeyboardEvent;
      if(key.key==='Escape'){key.preventDefault();if(!submitting)onClose();}
      if(key.key==='Tab'){
        const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]'));
        const first=controls[0],last=controls[controls.length-1];
        if(key.shiftKey&&document.activeElement===first){key.preventDefault();last?.focus();}
        else if(!key.shiftKey&&document.activeElement===last){key.preventDefault();first?.focus();}
      }
    };
    dialog.addEventListener('keydown',keydown);
    return()=>dialog.removeEventListener('keydown',keydown);
  },[onClose,submitting]);
  const lookup=async()=>{
    if(!valid||querying||submitting)return;
    const current=++generation.current;
    setMovie(null);setError('');setQuerying(true);setPosterFailed(false);
    try{
      const result=await helixAdminApi.previewProductIdentity(item,id);
      if(current!==generation.current)return;
      if(previewId(result)!==id || (series ? !('seasonNumber' in result) || !Number.isSafeInteger(result.seasonNumber) || result.seasonNumber < 1 : !('tmdbMovieId' in result)))throw new Error('Preview identity mismatch');
      setMovie(result);
    }catch(cause){if(current===generation.current){
      if(cause instanceof AdminApiError&&cause.status===401){onUnauthorized?.();return;}
      const code=cause instanceof AdminApiError?cause.code:'';
      setError(code==='LIBRA_IDENTITY_PREVIEW_NOT_FOUND'?(series ? '未找到这部剧集的当前季，请核对 ID。' : '未找到这部电影，请核对 ID。'):code==='PLATFORM_INTEGRATION_NOT_CONFIGURED'?'请先在应用设置中连接 TMDB。':'媒体信息读取失败，请重试。');
    }}finally{if(current===generation.current)setQuerying(false);}
  };
  const submit=async()=>{
    if(!movie||previewId(movie)!==id||submitting||stale)return;
    command.current??=`choose-product-identity:${item.currentRun?.libraRunId}:${newOpaqueId()}`;
    setSubmitting(true);setError('');
    try{await helixAdminApi.chooseProductIdentity(item,previewId(movie),command.current);onSelected();}
    catch(cause){
      if(cause instanceof AdminApiError&&cause.status===401){onUnauthorized?.();return;}
      if(cause instanceof AdminApiError&&['LIBRA_IDENTITY_SELECTION_STALE','LIBRA_IDENTITY_SELECTION_IDENTITY_STALE','LIBRA_IDENTITY_SELECTION_RUN_STATE','LIBRA_RUN_NOT_FOUND'].includes(cause.code)){
        setStale(true);setError('整理状态已变化，请关闭后重新选择。');onRefresh();
      }else setError('身份提交未确认，请重试。');
    }finally{setSubmitting(false);}
  };
  return <Dialog open title={`手动选取${identityLabel}`} onClose={()=>{if(!submitting)onClose();}} actions={<>
    <Button type="button" disabled={submitting} onClick={onClose}>取消</Button>
    <Button type="button" variant="primary" disabled={!movie||previewId(movie)!==id||querying||submitting||stale} onClick={()=>void submit()}>{submitting?'正在提交…':'确认选取'}</Button>
  </>}><div ref={content} className="identity-picker">
    <form onSubmit={event=>{event.preventDefault();void lookup();}}>
      <label htmlFor="identity-movie-id">{idLabel}</label>
      <div className="identity-picker-input"><input ref={input} id="identity-movie-id" inputMode="numeric" autoComplete="off" value={id} disabled={submitting||stale} aria-invalid={!!id&&!valid} aria-describedby={id&&!valid?'identity-input-error':undefined} onChange={event=>{
        generation.current++;setId(event.target.value.trim());setMovie(null);setError('');setQuerying(false);command.current=null;
      }}/><Button type="submit" disabled={!valid||querying||submitting||stale}>{querying?'正在查询…':'查询'}</Button></div>
      {id&&!valid&&<p id="identity-input-error" className="identity-picker-error">请输入有效的纯数字 ID。</p>}
    </form>
    {error&&<p className="identity-picker-error" role="alert">{error}</p>}
    {querying&&<span className="sr-only" role="status">正在读取媒体信息…</span>}
    {movie&&<div className="identity-picker-preview" aria-label={`${identityLabel}预览`}>
      {movie.posterUrl&&!posterFailed?<img src={movie.posterUrl} alt={`${movie.displayTitle}海报`} onError={()=>setPosterFailed(true)}/>:<div className="identity-picker-poster-empty">暂无海报</div>}
      <div><strong>{movie.displayTitle}</strong>{'seasonNumber' in movie && <p>第 {movie.seasonNumber} 季</p>}{movie.originalTitle&&movie.originalTitle!==movie.displayTitle&&<p>{movie.originalTitle}</p>}<p>{movie.releaseYear??'年份未知'} · TMDB {previewId(movie)}</p></div>
    </div>}
  </div></Dialog>;
}
