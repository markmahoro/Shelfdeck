import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import UsAdultRecommendations from '../src/helix/UsAdultRecommendations';
import PeoplePage from '../src/helix/PeoplePage';
import {helixAdminApi,type PeopleProjection,type UsAdultRecommendations as Projection,type RecommendationClaimAccepted} from '../src/helix/api';
import {SessionProvider} from '../src/helix/session';
const projection:Projection={publication:{windowKey:100,revision:3,snapshotDigest:'a'.repeat(64)},items:[{
  recommendationId:'b'.repeat(64),coverageCount:2,qualityScore:0.8,source:{subjectId:'subject-A',libraRunId:'run-A',title:'A.mkv'},
  imageUrl:'/v1/admin/people/recommendations/photo/image',claim:null}]};
const actor={personId:'actor-1',libraryKind:'us_adult',status:'active',canonicalName:'Actor One',currentRevision:4,currentReferenceRevision:2,
  aliases:[],providerIdentities:[],currentPreferenceRevision:null,createdAtMs:1} as PeopleProjection['items'][number];
const people:PeopleProjection={items:[actor],nextCursor:null,summary:{activePersonCount:1,mergedPersonCount:0,openRegistrationCandidateCount:0,openMergeCandidateCount:0}};
const completed:RecommendationClaimAccepted={claimId:'claim-1',claimRef:'claim-1',replayed:false,state:'completed',revision:2,personId:'actor-1',
  failureCode:null,sourceConfirmed:true,source:projection.items[0].source};
afterEach(()=>vi.restoreAllMocks());
function mount(){
  const read=vi.spyOn(helixAdminApi,'readUsAdultRecommendations').mockResolvedValue(projection),onChanged=vi.fn(),onEditingChange=vi.fn();
  const view=render(<SessionProvider><UsAdultRecommendations refreshKey={0} disabled={false} onChanged={onChanged} onEditingChange={onEditingChange}/></SessionProvider>);
  return {read,onChanged,onEditingChange,...view};
}
async function sourceLoaded(){const image=await screen.findByRole('img',{name:'推荐人物 1 的来源截图'});fireEvent.load(image);return image;}
it('shows recommendation controls only in the US library and never loads them for normal or JAV',async()=>{
  vi.spyOn(helixAdminApi,'listPeople').mockResolvedValue({...people,items:[]});
  const read=vi.spyOn(helixAdminApi,'readUsAdultRecommendations').mockResolvedValue(projection);
  render(<SessionProvider><PeoplePage/></SessionProvider>);
  await screen.findByText('本库还没有演员');expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab',{name:'JAV 演员'}));expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab',{name:'US Adult 演员'}));await screen.findByRole('article',{name:'推荐人物 1'});
  expect(read).toHaveBeenCalledTimes(1);expect(screen.getByText('2 部暂存影片出现过')).toBeVisible();
});
it('requires the source image to be visible before either claim action and blocks a failed photograph',async()=>{
  mount();const image=await screen.findByRole('img',{name:'推荐人物 1 的来源截图'}),existing=screen.getByRole('button',{name:'认领推荐人物 1 为已有演员'}),
    create=screen.getByRole('button',{name:'新建推荐人物 1 的演员档案'});
  expect(existing).toBeDisabled();expect(create).toBeDisabled();fireEvent.load(image);expect(existing).toBeEnabled();expect(create).toBeEnabled();
  fireEvent.error(image);expect(existing).toBeDisabled();expect(create).toBeDisabled();expect(screen.getByText('图片暂时无法显示，请刷新推荐。')).toBeVisible();
});
it('claims an existing actor through the source Saga with exact Person and publication versions',async()=>{
  const claim=vi.spyOn(helixAdminApi,'claimUsAdultRecommendation').mockResolvedValue(completed),direct=vi.spyOn(helixAdminApi,'chooseUsAdultActor'),
    selection=vi.spyOn(helixAdminApi,'readUsAdultActorSelection'),list=vi.spyOn(helixAdminApi,'listPeople').mockResolvedValue(people),h=mount();
  await sourceLoaded();fireEvent.click(screen.getByRole('button',{name:'认领推荐人物 1 为已有演员'}));
  const dialog=await screen.findByRole('dialog',{name:'认领为已有演员'}),radio=await within(dialog).findByRole('radio',{name:'Actor One'});
  fireEvent.load(radio.closest('label')!.querySelector('img')!);fireEvent.click(radio);
  expect(within(dialog).getByText('本次只确认这部来源影片，其余暂存影片保持原状。')).toBeVisible();
  h.read.mockResolvedValue({publication:projection.publication,items:[]});fireEvent.click(within(dialog).getByRole('button',{name:'确认认领'}));
  await screen.findByText('演员及来源影片已确认，影片会继续整理。');expect(h.onChanged).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledWith({libraryKind:'us_adult',limit:24});expect(selection).not.toHaveBeenCalled();expect(direct).not.toHaveBeenCalled();
  expect(claim.mock.calls[0]).toEqual([projection.items[0].recommendationId,expect.objectContaining({expectedPublicationRevision:3,
    expectedSnapshotDigest:'a'.repeat(64),target:{kind:'existing',personId:'actor-1',expectedPersonRevision:4,expectedReferenceRevision:2}})]);
});
it('creates from the displayed screenshot and retries the whole frozen request after an unknown outcome',async()=>{
  const claim=vi.spyOn(helixAdminApi,'claimUsAdultRecommendation').mockRejectedValueOnce(new Error('transport')).mockResolvedValue(completed),
    register=vi.spyOn(helixAdminApi,'registerPerson'),h=mount();
  await sourceLoaded();fireEvent.click(screen.getByRole('button',{name:'新建推荐人物 1 的演员档案'}));
  const name=screen.getByLabelText('姓名');expect(name).toHaveFocus();fireEvent.change(name,{target:{value:'New Actor'}});
  expect(screen.getByRole('button',{name:'建档并确认来源'})).toBeDisabled();
  fireEvent.load(screen.getByRole('img',{name:'已选择的演员参考图片'}));fireEvent.click(screen.getByRole('button',{name:'建档并确认来源'}));
  await screen.findByText('尚未收到提交结果，请重试同一次建档。');expect(name).toBeDisabled();
  h.read.mockResolvedValue({publication:projection.publication,items:[]});fireEvent.click(screen.getByRole('button',{name:'重试同一次建档'}));
  await screen.findByText('演员及来源影片已确认，影片会继续整理。');expect(claim).toHaveBeenCalledTimes(2);
  expect(claim.mock.calls[1]).toEqual(claim.mock.calls[0]);expect(claim.mock.calls[0][1].target).toEqual({kind:'create',canonicalName:'New Actor',aliases:[],image:{kind:'recommendation'}});
  expect(register).not.toHaveBeenCalled();
});
it('keeps a submitted claim across progress-query failure and retries its status without submitting again',async()=>{
  const accepted={...completed,state:'preparing_person',personId:null,sourceConfirmed:false} as RecommendationClaimAccepted,
    claim=vi.spyOn(helixAdminApi,'claimUsAdultRecommendation').mockResolvedValue(accepted),
    progress=vi.spyOn(helixAdminApi,'readRecommendationClaim').mockRejectedValueOnce(new Error('transport')).mockResolvedValue(completed),h=mount();
  await sourceLoaded();fireEvent.click(screen.getByRole('button',{name:'新建推荐人物 1 的演员档案'}));
  fireEvent.change(screen.getByLabelText('姓名'),{target:{value:'New Actor'}});fireEvent.load(screen.getByRole('img',{name:'已选择的演员参考图片'}));
  fireEvent.click(screen.getByRole('button',{name:'建档并确认来源'}));await screen.findByText('暂时无法读取认领进度，操作会继续。请重试查询。');
  expect(screen.getAllByText(/正在建立演员档案/)).toHaveLength(1);expect(screen.getAllByText('A.mkv')).toHaveLength(1);
  h.read.mockResolvedValue({publication:projection.publication,items:[]});fireEvent.click(screen.getByRole('button',{name:'重试查询认领进度'}));
  await screen.findByText('演员及来源影片已确认，影片会继续整理。');expect(claim).toHaveBeenCalledTimes(1);
  expect(progress.mock.calls).toEqual([['claim-1'],['claim-1']]);
});
it('rejects an unbounded recommendation response and ignores a late response after unmount',async()=>{
  const h=mount();h.unmount();
  let resolve!:(value:Projection)=>void;h.read.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const view=render(<SessionProvider><UsAdultRecommendations refreshKey={0} disabled={false} onChanged={h.onChanged} onEditingChange={h.onEditingChange}/></SessionProvider>);
  view.unmount();await act(async()=>resolve({...projection,items:Array(6).fill(projection.items[0])}));expect(h.onChanged).not.toHaveBeenCalled();
  h.read.mockResolvedValue({...projection,items:Array(6).fill(projection.items[0])});
  render(<SessionProvider><UsAdultRecommendations refreshKey={0} disabled={false} onChanged={h.onChanged} onEditingChange={h.onEditingChange}/></SessionProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('推荐数据不完整');expect(screen.queryByRole('article')).not.toBeInTheDocument();
});
