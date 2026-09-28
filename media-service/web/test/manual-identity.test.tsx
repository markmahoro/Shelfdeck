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
