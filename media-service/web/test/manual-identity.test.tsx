import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ManualIdentityDialog from '../src/helix/ManualIdentityDialog';
import { AdminApiError, helixAdminApi, type FormationSubject, type MovieIdentityPreview } from '../src/helix/api';

const item={subjectId:'subject',currentRun:{libraRunId:'run',stateRevision:2,currentIdentityRevision:null},productIdentityIssue:{candidateSetDigest:'digest'}} as FormationSubject;
const movie:MovieIdentityPreview={tmdbMovieId:'639445',displayTitle:'金都',originalTitle:'金都',releaseYear:2020,posterUrl:null};
afterEach(()=>vi.restoreAllMocks());
function mount(){const callbacks={onClose:vi.fn(),onSelected:vi.fn(),onRefresh:vi.fn()};render(<ManualIdentityDialog item={item} {...callbacks}/>);return callbacks;}
async function lookup(){fireEvent.change(screen.getByLabelText('TMDB 影片 ID'),{target:{value:'639445'}});fireEvent.click(screen.getByRole('button',{name:'查询'}));await screen.findByLabelText('影片身份预览');}

it('requires a valid ID and preview; cancel has no write',async()=>{
  const preview=vi.spyOn(helixAdminApi,'previewProductIdentity').mockResolvedValue(movie);
  const choose=vi.spyOn(helixAdminApi,'chooseProductIdentity');const cb=mount();
  expect(screen.getByRole('button',{name:'确认选取'})).toBeDisabled();
  for(const id of ['0','-1','abc','https://tmdb.org/movie/639445']){
    fireEvent.change(screen.getByLabelText('TMDB 影片 ID'),{target:{value:id}});
    expect(screen.getByRole('button',{name:'查询'})).toBeDisabled();
  }
  expect(preview).not.toHaveBeenCalled();await lookup();
  expect(screen.getByText('2020 · TMDB 639445')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(cb.onClose).toHaveBeenCalled();expect(choose).not.toHaveBeenCalled();
});

it('invalidates previews immediately and rejects a late response for the previous ID',async()=>{
  let resolve!:(value:MovieIdentityPreview)=>void;
  vi.spyOn(helixAdminApi,'previewProductIdentity').mockImplementation(()=>new Promise(done=>{resolve=done;}));mount();
  fireEvent.change(screen.getByLabelText('TMDB 影片 ID'),{target:{value:'639445'}});fireEvent.click(screen.getByRole('button',{name:'查询'}));
  fireEvent.change(screen.getByLabelText('TMDB 影片 ID'),{target:{value:'550'}});
  await act(async()=>resolve(movie));expect(screen.queryByLabelText('影片身份预览')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'确认选取'})).toBeDisabled();
});

it('shows a recoverable lookup error and only submits the previewed ID with one retry key',async()=>{
  vi.spyOn(helixAdminApi,'previewProductIdentity').mockRejectedValueOnce(new AdminApiError(404,'LIBRA_IDENTITY_PREVIEW_NOT_FOUND','secret technical text')).mockResolvedValue(movie);
  const choose=vi.spyOn(helixAdminApi,'chooseProductIdentity').mockRejectedValueOnce(new Error('private failure')).mockResolvedValue({} as never);
  const cb=mount();fireEvent.change(screen.getByLabelText('TMDB 影片 ID'),{target:{value:'639445'}});fireEvent.click(screen.getByRole('button',{name:'查询'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('未找到这部电影');expect(screen.getByRole('button',{name:'确认选取'})).toBeDisabled();
  await lookup();fireEvent.click(screen.getByRole('button',{name:'确认选取'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('身份提交未确认');expect(cb.onSelected).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'确认选取'}));await waitFor(()=>expect(cb.onSelected).toHaveBeenCalledTimes(1));
  expect(choose.mock.calls[0][1]).toBe('639445');expect(choose.mock.calls[0][2]).toBe(choose.mock.calls[1][2]);
});

it('blocks stale retries, submitting closes, and keyboard escape during submission',async()=>{
  vi.spyOn(helixAdminApi,'previewProductIdentity').mockResolvedValue(movie);
  let reject!:(error:Error)=>void;
  vi.spyOn(helixAdminApi,'chooseProductIdentity').mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));const cb=mount();await lookup();
  fireEvent.click(screen.getByRole('button',{name:'确认选取'}));expect(screen.getByRole('button',{name:'取消'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'关闭'}));fireEvent.keyDown(screen.getByLabelText('TMDB 影片 ID'),{key:'Escape'});expect(cb.onClose).not.toHaveBeenCalled();
  await act(async()=>reject(new AdminApiError(409,'LIBRA_IDENTITY_SELECTION_STALE','internal')));
  expect(screen.getByRole('button',{name:'确认选取'})).toBeDisabled();expect(cb.onRefresh).toHaveBeenCalledTimes(1);expect(cb.onSelected).not.toHaveBeenCalled();
});

it('clears an already visible preview when the ID changes',async()=>{
  vi.spyOn(helixAdminApi,'previewProductIdentity').mockResolvedValue(movie);mount();await lookup();
  fireEvent.change(screen.getByLabelText('TMDB 影片 ID'),{target:{value:'550'}});
  expect(screen.queryByLabelText('影片身份预览')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'确认选取'})).toBeDisabled();
});

it('previews the frozen Series Season and submits only its Series ID',async()=>{
  const series={...item,contentProfile:'series'} as FormationSubject;
  const cb={onClose:vi.fn(),onSelected:vi.fn(),onRefresh:vi.fn()};
  vi.spyOn(helixAdminApi,'previewProductIdentity').mockResolvedValue({tmdbSeriesId:'1399',seasonNumber:2,displayTitle:'示例剧集',originalTitle:null,releaseYear:2011,posterUrl:null});
  const choose=vi.spyOn(helixAdminApi,'chooseProductIdentity').mockResolvedValue({} as never);
  render(<ManualIdentityDialog item={series} {...cb}/>);
  expect(screen.getByRole('dialog',{name:'手动选取剧集身份'})).toBeVisible();
  fireEvent.change(screen.getByLabelText('TMDB 剧集 ID'),{target:{value:'1399'}});
  fireEvent.click(screen.getByRole('button',{name:'查询'}));
  expect(await screen.findByLabelText('剧集身份预览')).toHaveTextContent('第 2 季');
  fireEvent.click(screen.getByRole('button',{name:'确认选取'}));
  await waitFor(()=>expect(cb.onSelected).toHaveBeenCalledTimes(1));
  expect(choose.mock.calls[0][1]).toBe('1399');
});

it('rejects a Movie response or an invalid Season in a Series preview',async()=>{
  const preview=vi.spyOn(helixAdminApi,'previewProductIdentity').mockResolvedValueOnce(movie).mockResolvedValueOnce({tmdbSeriesId:'639445',seasonNumber:0,displayTitle:'Invalid',originalTitle:null,releaseYear:null,posterUrl:null});
  render(<ManualIdentityDialog item={{...item,contentProfile:'series'}} onClose={()=>{}} onSelected={()=>{}} onRefresh={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('TMDB 剧集 ID'),{target:{value:'639445'}});
  for(let attempt=1;attempt<=2;attempt++){
    fireEvent.click(screen.getByRole('button',{name:'查询'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('媒体信息读取失败');
    expect(screen.getByRole('button',{name:'确认选取'})).toBeDisabled();
    expect(preview).toHaveBeenCalledTimes(attempt);
  }
});

it('encodes mutually exclusive identity IDs in preview and choice HTTP requests',async()=>{
  const requests:Array<{url:string;body:any}>=[];
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    requests.push({url:String(url),body:init?.body?JSON.parse(String(init.body)):null});
    return new Response('{}');
  });
  for(const contentProfile of ['movie','series']){
    const subject={...item,contentProfile} as FormationSubject;
    await helixAdminApi.previewProductIdentity(subject,'1399');
    await helixAdminApi.chooseProductIdentity(subject,'1399','stable-key');
  }
  expect(requests[0].url).toContain('tmdbMovieId=1399');
  expect(requests[1].body.tmdbMovieId).toBe('1399');
  expect(requests[2].url).toContain('tmdbSeriesId=1399');
  expect(requests[3].body).toMatchObject({tmdbSeriesId:'1399',idempotencyKey:'stable-key',expectedRunStateRevision:2});
  expect(requests[3].body).not.toHaveProperty('tmdbMovieId');
  expect(requests[3].body).not.toHaveProperty('seasonNumber');
  expect(requests[3].body).not.toHaveProperty('episodeNumbers');
});
