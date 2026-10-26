import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import EpisodeMetadataDialog from '../src/helix/EpisodeMetadataDialog';
import {AdminApiError,helixAdminApi,type FormationSubject,type EpisodeMetadataState,type EpisodeMetadataReview} from '../src/helix/api';
const item={subjectId:'subject',contentProfile:'series',displayIdentity:'Synthetic season',currentRun:{libraRunId:'run'}} as FormationSubject;
const members=[1,2].map(number=>({materialKey:'material-'+number,localScope:{seasonNumber:2,episodeNumber:number,episodeKey:'E00'+number},title:'Local '+number,airDate:''}));
const evidence=[0,3].map(season=>({evidenceDigest:'evidence-'+season,title:'Provider '+season,plot:'Plot '+season,airDate:'2020-12-25',
  providerEpisode:{provider:'tmdb' as const,providerKey:'999',seasonNumber:season,episodeNumber:1,episodeId:100+season}}));
const review:EpisodeMetadataReview={reviewDigest:'review-digest',members,evidence};
const state:EpisodeMetadataState={libraRunId:'run',providerKey:'999',runStateRevision:4,state:'frozen',packageRevisionHead:0,expectedMappingRevision:0,members,currentMapping:null,currentReview:null};
afterEach(()=>vi.restoreAllMocks());
function mount(overrides:Partial<EpisodeMetadataState>={}){
  vi.spyOn(helixAdminApi,'readEpisodeMetadataMapping').mockResolvedValue({...state,...overrides});
  const inspect=vi.spyOn(helixAdminApi,'inspectEpisodeMetadata').mockResolvedValue({reviewRecord:{recordId:'review-id',review}});
  const confirm=vi.spyOn(helixAdminApi,'confirmEpisodeMetadata').mockResolvedValue({replayed:false});
  const callbacks={onClose:vi.fn(),onSelected:vi.fn(),onUnauthorized:vi.fn()};
  render(<EpisodeMetadataDialog item={item} {...callbacks}/>);return {inspect,confirm,...callbacks};
}
async function query(){
  await waitFor(()=>expect(screen.getByRole('button',{name:'查询资料'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText(/查询 Provider 季号/),{target:{value:'0,3'}});
  fireEvent.click(screen.getByRole('button',{name:'查询资料'}));await screen.findByLabelText('本地集');
}
function pair(local:string,provider:string){
  fireEvent.change(screen.getByLabelText('本地集'),{target:{value:local}});
  fireEvent.change(screen.getByLabelText('Provider 集'),{target:{value:provider}});
  fireEvent.click(screen.getByRole('button',{name:'加入对应'}));
}
it('queries only by explicit command, displays evidence and requires each pair and consequence acknowledgement',async()=>{
  const h=mount();await waitFor(()=>expect(screen.getByRole('button',{name:'查询资料'})).toBeEnabled());expect(h.inspect).not.toHaveBeenCalled();
  await query();expect(h.inspect).toHaveBeenCalledWith('run',expect.objectContaining({providerSeasons:[0,3],expectedRunStateRevision:4}));
  expect(screen.getByLabelText('本地集')).toHaveValue('');expect(screen.getByLabelText('Provider 集')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('本地集'),{target:{value:'material-1'}});
  fireEvent.change(screen.getByLabelText('Provider 集'),{target:{value:'evidence-0'}});
  expect(screen.getByText('Plot 0')).toBeVisible();expect(screen.getByText('本地日期：未知')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'加入对应'}));
  expect(screen.getByRole('button',{name:'确认对应并重新整理'})).toBeDisabled();
  pair('material-2','evidence-3');fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'确认对应并重新整理'}));
  await waitFor(()=>expect(h.onSelected).toHaveBeenCalledOnce());
  expect(h.confirm).toHaveBeenCalledWith('run',expect.objectContaining({reviewId:'review-id',reviewDigest:'review-digest',choices:[
    {materialKey:'material-1',localScope:members[0].localScope,evidenceDigest:'evidence-0'},
    {materialKey:'material-2',localScope:members[1].localScope,evidenceDigest:'evidence-3'},
  ]}));
});
it('refuses duplicate Provider assignment and never carries prior mapping without explicit selection',async()=>{
  const h=mount({expectedMappingRevision:1,currentMapping:{entries:[{materialKey:'material-1',localScope:members[0].localScope,evidenceDigest:'evidence-0'}]},currentReview:review});
  await query();expect(screen.getByText('本次已选择 0 / 2 集')).toBeVisible();pair('material-1','evidence-0');pair('material-2','evidence-0');
  expect(screen.getByRole('alert')).toHaveTextContent('已对应另一集');expect(screen.getByText('本次已选择 1 / 2 集')).toBeVisible();expect(h.confirm).not.toHaveBeenCalled();
});
it('retries uncertain confirmation with identical command and locks changed selection',async()=>{
  const h=mount();h.confirm.mockRejectedValueOnce(new Error('connection lost'));await query();pair('material-1','evidence-0');
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认对应并重新整理'}));
  await screen.findByRole('alert');expect(screen.getByLabelText('本地集')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重试本次确认'}));await waitFor(()=>expect(h.onSelected).toHaveBeenCalledOnce());
  expect(h.confirm.mock.calls[1]).toEqual(h.confirm.mock.calls[0]);
});
it('blocks stale confirmations and does not silently re-query or remap',async()=>{
  const h=mount();h.confirm.mockRejectedValue(new AdminApiError(409,'LIBRA_EPISODE_REVIEW_STALE','changed'));await query();pair('material-1','evidence-0');
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认对应并重新整理'}));
  await screen.findByRole('alert');expect(screen.getByRole('button',{name:'重试本次确认'})).toBeDisabled();expect(h.inspect).toHaveBeenCalledTimes(1);
});
it('keeps already delivered Run read-only and handles Escape',async()=>{
  const h=mount({packageRevisionHead:1});await screen.findByText('当前任务已交付或结束，无法修改资料对应。');
  expect(screen.getByRole('button',{name:'查询资料'})).toBeDisabled();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(h.onClose).toHaveBeenCalledOnce();
});
