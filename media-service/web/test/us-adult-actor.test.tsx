import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import UsAdultActorDialog from '../src/helix/UsAdultActorDialog';
import {AdminApiError,helixAdminApi,type FormationSubject,type PeopleProjection,type UsAdultActorSelection} from '../src/helix/api';
const item={subjectId:'subject',contentProfile:'western_adult',displayIdentity:'Original source',currentRun:{libraRunId:'run'}} as FormationSubject;
const state:UsAdultActorSelection={libraRunId:'run',subjectId:'subject',expectedRunStateRevision:3,expectedChoiceRevision:1,canChoose:true,
  analysisState:'completed',detectedFaceCount:0,selectedActor:null,selectionOrigin:null};
const actor={personId:'actor-1',libraryKind:'us_adult',status:'active',canonicalName:'Actor One',currentRevision:4,currentReferenceRevision:2,
  aliases:[],providerIdentities:[],currentPreferenceRevision:null,createdAtMs:1} as PeopleProjection['items'][number];
const page:PeopleProjection={items:[actor],nextCursor:null,summary:{activePersonCount:1,mergedPersonCount:0,openRegistrationCandidateCount:0,openMergeCandidateCount:0}};
afterEach(()=>vi.restoreAllMocks());
function mount(){
  vi.spyOn(helixAdminApi,'readUsAdultActorSelection').mockResolvedValue(state);
  const people=vi.spyOn(helixAdminApi,'listPeople').mockResolvedValue(page),callbacks={onClose:vi.fn(),onSelected:vi.fn(),onRefresh:vi.fn(),onUnauthorized:vi.fn()};
  const view=render(<UsAdultActorDialog item={item} {...callbacks}/>);return {...callbacks,people,...view};
}
async function select(){
  const radio=await screen.findByRole('radio',{name:'Actor One'});
  const image=radio.closest('label')!.querySelector('img')!;fireEvent.load(image);fireEvent.click(radio);return image;
}
it('requires a loaded actor image and keeps the Formation picker free of creation actions',async()=>{
  const choose=vi.spyOn(helixAdminApi,'chooseUsAdultActor'),h=mount(),radio=await screen.findByRole('radio',{name:'Actor One'});
  expect(h.people).toHaveBeenCalledWith({libraryKind:'us_adult',limit:24});expect(radio).toBeDisabled();
  expect(screen.queryByRole('button',{name:/新建|建档|创建/})).not.toBeInTheDocument();
  const image=await select();expect(screen.getByRole('button',{name:'确认演员'})).toBeEnabled();
  fireEvent.error(image);expect(radio).toBeDisabled();expect(screen.getByRole('button',{name:'确认演员'})).toBeDisabled();
  expect(screen.getByText('图片无法读取')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'取消'}));
  expect(h.onClose).toHaveBeenCalledTimes(1);expect(choose).not.toHaveBeenCalled();
});
it('submits exact actor and Run versions and reuses the complete command after a missing response',async()=>{
  const choose=vi.spyOn(helixAdminApi,'chooseUsAdultActor').mockRejectedValueOnce(new Error('private transport detail')).mockResolvedValue({} as never),h=mount();
  await select();fireEvent.click(screen.getByRole('button',{name:'确认演员'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('确认结果尚未收到');expect(screen.getByRole('alert')).not.toHaveTextContent('private');
  fireEvent.click(screen.getByRole('button',{name:'确认演员'}));await waitFor(()=>expect(h.onSelected).toHaveBeenCalledTimes(1));
  expect(choose.mock.calls[0][0]).toBe('run');expect(choose.mock.calls[0][1]).toMatchObject({personId:'actor-1',expectedRunStateRevision:3,
    expectedChoiceRevision:1,expectedPersonRevision:4,expectedReferenceRevision:2});
  expect(choose.mock.calls[1]).toEqual(choose.mock.calls[0]);expect(choose.mock.calls[0][1]).not.toHaveProperty('canonicalName');
});
it('stops stale confirmation and contains Escape while a write is pending',async()=>{
  let reject!:(reason:Error)=>void;
  vi.spyOn(helixAdminApi,'chooseUsAdultActor').mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));const h=mount();
  await select();fireEvent.click(screen.getByRole('button',{name:'确认演员'}));
  expect(screen.getByRole('button',{name:'取消'})).toBeDisabled();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(h.onClose).not.toHaveBeenCalled();
  await act(async()=>reject(new AdminApiError(409,'US_ADULT_ACTOR_CHOICE_STALE','internal')));
  expect(screen.getByRole('button',{name:'确认演员'})).toBeDisabled();expect(h.onRefresh).toHaveBeenCalledTimes(1);expect(h.onSelected).not.toHaveBeenCalled();
});
it('searches only the US library and appends its bounded next page',async()=>{
  const h=mount();await screen.findByRole('radio',{name:'Actor One'});
  h.people.mockResolvedValueOnce({...page,nextCursor:'next-page'}).mockResolvedValueOnce({...page,items:[{...actor,personId:'actor-2',canonicalName:'Actor Two'}]});
  fireEvent.change(screen.getByLabelText('搜索 US Adult 演员'),{target:{value:'  Actor  '}});fireEvent.click(screen.getByRole('button',{name:'搜索'}));
  await screen.findByRole('button',{name:'加载更多演员'});fireEvent.click(screen.getByRole('button',{name:'加载更多演员'}));await screen.findByRole('radio',{name:'Actor Two'});
  expect(h.people.mock.calls[1][0]).toEqual({libraryKind:'us_adult',limit:24,search:'Actor'});
  expect(h.people.mock.calls[2][0]).toEqual({libraryKind:'us_adult',limit:24,search:'Actor',cursor:'next-page'});
  expect(screen.getAllByRole('radio')).toHaveLength(2);
});
it('ignores a late initial response after the picker unmounts',async()=>{
  let resolve!:(value:UsAdultActorSelection)=>void;const h=mount();
  // Remount with a deliberately delayed Owner response.
  h.unmount();vi.mocked(helixAdminApi.readUsAdultActorSelection).mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const view=render(<UsAdultActorDialog item={item} onClose={()=>{}} onSelected={h.onSelected} onRefresh={()=>{}}/>);view.unmount();
  await act(async()=>resolve(state));expect(h.onSelected).not.toHaveBeenCalled();
});

it('requires the new reference image after the same actor changes revision and clears stale failures after reload',async()=>{
  const choose=vi.spyOn(helixAdminApi,'chooseUsAdultActor').mockResolvedValue({} as never),h=mount();
  await select();h.people.mockResolvedValueOnce({...page,items:[{...actor,currentRevision:5,currentReferenceRevision:3}]});
  fireEvent.click(screen.getByRole('button',{name:'搜索'}));
  await waitFor(()=>expect(screen.getByRole('radio',{name:'Actor One'})).toBeDisabled());
  expect(screen.getByRole('button',{name:'确认演员'})).toBeDisabled();
  const radio=screen.getByRole('radio',{name:'Actor One'}),image=radio.closest('label')!.querySelector('img')!;
  expect(image).toHaveAttribute('src',helixAdminApi.personAvatarUrl(actor.personId,3));
  fireEvent.error(image);expect(screen.getByText('图片无法读取')).toBeVisible();fireEvent.load(image);
  expect(screen.queryByText('图片无法读取')).not.toBeInTheDocument();fireEvent.click(radio);fireEvent.click(screen.getByRole('button',{name:'确认演员'}));
  await waitFor(()=>expect(choose).toHaveBeenCalledWith('run',expect.objectContaining({expectedPersonRevision:5,expectedReferenceRevision:3})));
});
