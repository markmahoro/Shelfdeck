import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import EpisodeMetadataDialog from '../src/helix/EpisodeMetadataDialog';
import {suggestEpisodeMetadataChoices} from '../src/helix/episodeMetadataSuggestions';
import {AdminApiError,helixAdminApi,type FormationSubject,type EpisodeMetadataState,type EpisodeMetadataReview} from '../src/helix/api';
const item={subjectId:'subject',contentProfile:'series',displayIdentity:'Synthetic season',currentRun:{libraRunId:'run'}} as FormationSubject;
const members=[1,2].map(number=>({materialKey:'material-'+number,localScope:{seasonNumber:2,episodeNumber:number,episodeKey:'E00'+number},title:'Local '+number,airDate:''}));
const evidence=[0,3].map(season=>({evidenceDigest:'evidence-'+season,title:'Provider '+season,plot:'Plot '+season,airDate:'2020-12-25',
  providerEpisode:{provider:'tmdb' as const,providerKey:'999',seasonNumber:season,episodeNumber:1,episodeId:100+season}}));
const review:EpisodeMetadataReview={reviewDigest:'review-digest',members,evidence};
const alignedMembers=[1,2,3].map(number=>({materialKey:'aligned-'+number,localScope:{seasonNumber:1,episodeNumber:number,episodeKey:'E00'+number},title:'Aligned '+number,airDate:'2001-0'+number+'-01'}));
const alignedEvidence=[1,2,3].map(number=>({evidenceDigest:'aligned-evidence-'+number,title:'Provider aligned '+number,plot:'Plot '+number,airDate:'2001-0'+number+'-01',
  providerEpisode:{provider:'tmdb' as const,providerKey:'999',seasonNumber:1,episodeNumber:number,episodeId:200+number}}));
const alignedReview:EpisodeMetadataReview={reviewDigest:'aligned-digest',members:alignedMembers,evidence:alignedEvidence};
const state:EpisodeMetadataState={libraRunId:'run',providerKey:'999',runStateRevision:4,state:'frozen',packageRevisionHead:0,expectedMappingRevision:0,members,currentMapping:null,currentReview:null};
afterEach(()=>vi.restoreAllMocks());
function mount(overrides:Partial<EpisodeMetadataState>={},reviewOverride:EpisodeMetadataReview=review){
  vi.spyOn(helixAdminApi,'readEpisodeMetadataMapping').mockResolvedValue({...state,...overrides});
  const inspect=vi.spyOn(helixAdminApi,'inspectEpisodeMetadata').mockResolvedValue({reviewRecord:{recordId:'review-id',review:reviewOverride}});
  const confirm=vi.spyOn(helixAdminApi,'confirmEpisodeMetadata').mockResolvedValue({replayed:false});
  const callbacks={onClose:vi.fn(),onSelected:vi.fn(),onUnauthorized:vi.fn()};
  render(<EpisodeMetadataDialog item={item} {...callbacks}/>);return {inspect,confirm,...callbacks};
}
async function query(seasonValue='0,3'){
  await waitFor(()=>expect(screen.getByRole('button',{name:'查询资料'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText(/查询 Provider 季号/),{target:{value:seasonValue}});
  fireEvent.click(screen.getByRole('button',{name:'查询资料'}));await screen.findByText(/已选 0 \//);
}
it('keeps exact unique SxxExx matches high-confidence and leaves ambiguous rows uncertain',()=>{
  const mixed:EpisodeMetadataReview={reviewDigest:'mixed',members:[
    ...alignedMembers.slice(0,2),
    {materialKey:'special',localScope:{seasonNumber:1,episodeNumber:9,episodeKey:'E009'},title:'Special local',airDate:''},
  ],evidence:[
    ...alignedEvidence.slice(0,2),
    {evidenceDigest:'dup-a',title:'Dup A',plot:'',airDate:'2001-09-01',providerEpisode:{provider:'tmdb',providerKey:'999',seasonNumber:1,episodeNumber:9,episodeId:301}},
    {evidenceDigest:'dup-b',title:'Dup B',plot:'',airDate:'2001-09-02',providerEpisode:{provider:'tmdb',providerKey:'999',seasonNumber:1,episodeNumber:9,episodeId:302}},
  ]};
  const suggestion=suggestEpisodeMetadataChoices(mixed);
  expect(suggestion.confident.map(choice=>choice.materialKey)).toEqual(['aligned-1','aligned-2']);
  expect(suggestion.uncertain.map(member=>member.materialKey)).toEqual(['special']);
});
it('queries only by explicit command and requires batch or manual pairs plus consequence acknowledgement',async()=>{
  const h=mount();await waitFor(()=>expect(screen.getByRole('button',{name:'查询资料'})).toBeEnabled());expect(h.inspect).not.toHaveBeenCalled();
  await query();expect(h.inspect).toHaveBeenCalledWith('run',expect.objectContaining({providerSeasons:[0,3],expectedRunStateRevision:4}));
  expect(screen.getByText('已选 0 / 2 集 · 高置信 0 · 待核对 2')).toBeVisible();
  expect(screen.getByRole('heading',{name:'待核对 2'})).toBeVisible();
  expect(screen.getByRole('button',{name:'确认对应并重新整理'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('为 S02E01 选择 Provider 集'),{target:{value:'evidence-0'}});
  fireEvent.click(within(screen.getByLabelText('为 S02E01 选择 Provider 集').closest('li')!).getByRole('button',{name:'加入对应'}));
  expect(screen.getByRole('button',{name:'确认对应并重新整理'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('为 S02E02 选择 Provider 集'),{target:{value:'evidence-3'}});
  fireEvent.click(within(screen.getByLabelText('为 S02E02 选择 Provider 集').closest('li')!).getByRole('button',{name:'加入对应'}));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'确认对应并重新整理'}));
  await waitFor(()=>expect(h.onSelected).toHaveBeenCalledOnce());
  expect(h.confirm).toHaveBeenCalledWith('run',expect.objectContaining({reviewId:'review-id',reviewDigest:'review-digest',choices:[
    {materialKey:'material-1',localScope:members[0].localScope,evidenceDigest:'evidence-0'},
    {materialKey:'material-2',localScope:members[1].localScope,evidenceDigest:'evidence-3'},
  ]}));
});
it('batch-adds high-confidence rows without forcing per-episode clicks',async()=>{
  const h=mount({},alignedReview);await query('1');
  expect(screen.getByText('已选 0 / 3 集 · 高置信 3 · 待核对 0')).toBeVisible();
  expect(screen.queryByRole('heading',{name:/待核对/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'加入全部高置信（3）'}));
  expect(screen.getByText('已选 3 / 3 集 · 高置信 3 · 待核对 0')).toBeVisible();
  expect(screen.queryByRole('button',{name:/加入全部高置信/})).toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'确认对应并重新整理'}));
  await waitFor(()=>expect(h.onSelected).toHaveBeenCalledOnce());
  expect(h.confirm).toHaveBeenCalledWith('run',expect.objectContaining({choices:[
    {materialKey:'aligned-1',localScope:alignedMembers[0].localScope,evidenceDigest:'aligned-evidence-1'},
    {materialKey:'aligned-2',localScope:alignedMembers[1].localScope,evidenceDigest:'aligned-evidence-2'},
    {materialKey:'aligned-3',localScope:alignedMembers[2].localScope,evidenceDigest:'aligned-evidence-3'},
  ]}));
});
it('offers season batch when multiple seasons have pending high-confidence rows',async()=>{
  const multiMembers=[
    {materialKey:'s1e1',localScope:{seasonNumber:1,episodeNumber:1,episodeKey:'E001'},title:'S1',airDate:''},
    {materialKey:'s2e1',localScope:{seasonNumber:2,episodeNumber:1,episodeKey:'E001'},title:'S2',airDate:''},
  ];
  const multiEvidence=[
    {evidenceDigest:'e-s1',title:'P1',plot:'',airDate:'2001-01-01',providerEpisode:{provider:'tmdb' as const,providerKey:'999',seasonNumber:1,episodeNumber:1,episodeId:1}},
    {evidenceDigest:'e-s2',title:'P2',plot:'',airDate:'2002-01-01',providerEpisode:{provider:'tmdb' as const,providerKey:'999',seasonNumber:2,episodeNumber:1,episodeId:2}},
  ];
  mount({}, {reviewDigest:'multi',members:multiMembers,evidence:multiEvidence});await query('1,2');
  expect(screen.getByRole('button',{name:'加入全部高置信（2）'})).toBeVisible();
  expect(screen.getByRole('button',{name:'加入第 1 季高置信（1）'})).toBeVisible();
  expect(screen.getByRole('button',{name:'加入第 2 季高置信（1）'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'加入第 1 季高置信（1）'}));
  expect(screen.getByText('已选 1 / 2 集 · 高置信 2 · 待核对 0')).toBeVisible();
  expect(screen.getByRole('button',{name:'加入全部高置信（1）'})).toBeVisible();
});
it('never carries prior mapping without explicit selection and hides already used Provider options',async()=>{
  const h=mount({expectedMappingRevision:1,currentMapping:{entries:[{materialKey:'material-1',localScope:members[0].localScope,evidenceDigest:'evidence-0'}]},currentReview:review});
  await query();expect(screen.getByText('已选 0 / 2 集 · 高置信 0 · 待核对 2')).toBeVisible();
  fireEvent.change(screen.getByLabelText('为 S02E01 选择 Provider 集'),{target:{value:'evidence-0'}});
  fireEvent.click(within(screen.getByLabelText('为 S02E01 选择 Provider 集').closest('li')!).getByRole('button',{name:'加入对应'}));
  expect(screen.getByText('已选 1 / 2 集 · 高置信 0 · 待核对 2')).toBeVisible();
  const second=screen.getByLabelText('为 S02E02 选择 Provider 集') as HTMLSelectElement;
  expect([...second.options].map(option=>option.value)).toEqual(['','evidence-3']);
  expect(h.confirm).not.toHaveBeenCalled();
});
it('retries uncertain confirmation with identical command and locks changed selection',async()=>{
  const h=mount();h.confirm.mockRejectedValueOnce(new Error('connection lost'));await query();
  fireEvent.change(screen.getByLabelText('为 S02E01 选择 Provider 集'),{target:{value:'evidence-0'}});
  fireEvent.click(within(screen.getByLabelText('为 S02E01 选择 Provider 集').closest('li')!).getByRole('button',{name:'加入对应'}));
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认对应并重新整理'}));
  await screen.findByRole('alert');expect(screen.getByLabelText('为 S02E02 选择 Provider 集')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重试本次确认'}));await waitFor(()=>expect(h.onSelected).toHaveBeenCalledOnce());
  expect(h.confirm.mock.calls[1]).toEqual(h.confirm.mock.calls[0]);
});
it('blocks stale confirmations and does not silently re-query or remap',async()=>{
  const h=mount();h.confirm.mockRejectedValue(new AdminApiError(409,'LIBRA_EPISODE_REVIEW_STALE','changed'));await query();
  fireEvent.change(screen.getByLabelText('为 S02E01 选择 Provider 集'),{target:{value:'evidence-0'}});
  fireEvent.click(within(screen.getByLabelText('为 S02E01 选择 Provider 集').closest('li')!).getByRole('button',{name:'加入对应'}));
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认对应并重新整理'}));
  await screen.findByRole('alert');expect(screen.getByRole('button',{name:'重试本次确认'})).toBeDisabled();expect(h.inspect).toHaveBeenCalledTimes(1);
});
it('keeps already delivered Run read-only and handles Escape',async()=>{
  const h=mount({packageRevisionHead:1});await screen.findByText('当前任务已交付或结束，无法修改资料对应。');
  expect(screen.getByRole('button',{name:'查询资料'})).toBeDisabled();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(h.onClose).toHaveBeenCalledOnce();
});
