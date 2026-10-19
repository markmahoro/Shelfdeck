import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import UsAdultInventoryActorDialog from '../src/helix/UsAdultInventoryActorDialog';
import {AdminApiError,helixAdminApi,type CollectionEntry,type PeopleProjection,type UsAdultActorRefreshView} from '../src/helix/api';
const item={shelfEntryId:'entry',displayIdentity:'Old Actor Original source'} as CollectionEntry;
const state:UsAdultActorRefreshView={shelfEntryId:'entry',expectedInventoryRevision:4,expectedRepresentationDigest:'inventory-digest',
  currentActor:{personId:'old',displayName:'Old Actor'},canRefresh:true,blockingCaseId:null,progress:null};
const person={personId:'actor',canonicalName:'New Actor',libraryKind:'us_adult',currentRevision:3,currentReferenceRevision:2} as PeopleProjection['items'][number];
afterEach(()=>vi.restoreAllMocks());
function mount(view=state){
  const read=vi.spyOn(helixAdminApi,'readInventoryActorRefresh').mockResolvedValue(view),
    people=vi.spyOn(helixAdminApi,'listPeople').mockResolvedValue({items:[person],nextCursor:null} as PeopleProjection),
    callbacks={onClose:vi.fn(),onChanged:vi.fn(),onUnauthorized:vi.fn()};
  render(<UsAdultInventoryActorDialog item={item} {...callbacks}/>);return {read,people,...callbacks};
}
it('reports a proven failed publication and allows a fresh explicit refresh without claiming completion',async()=>{
  const refresh=vi.spyOn(helixAdminApi,'refreshInventoryActor').mockResolvedValue({aftercareCaseId:'new-case',state:'queued',replayed:false}),
    h=mount({...state,progress:{aftercareCaseId:'failed-case',mode:'specified',state:'unresolved',reasonCode:'ARCA_US_ADULT_TARGET_CONFLICT',
      works:[{workId:'failed-work',phase:'publish',state:'failed',failureCode:'ARCA_US_ADULT_TARGET_CONFLICT'}]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('处理冲突后可重新提交刷新');
  expect(screen.queryByText('演员刷新已完成。')).not.toBeInTheDocument();
  const button=screen.getByRole('button',{name:'自动刷新演员'});expect(button).toBeEnabled();fireEvent.click(button);
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
  expect(refresh.mock.calls[0][1]).toMatchObject({mode:'automatic',expectedInventoryRevision:4,expectedRepresentationDigest:'inventory-digest'});
  expect(h.onChanged).not.toHaveBeenCalled();
});
it('requires a visible reference image and submits the exact Inventory and Actor revisions',async()=>{
  const refresh=vi.spyOn(helixAdminApi,'refreshInventoryActor').mockResolvedValue({aftercareCaseId:'case',state:'queued',replayed:false}),h=mount(),
    radio=await screen.findByRole('radio',{name:'New Actor'}),button=screen.getByRole('button',{name:'指定演员并更新'});
  expect(radio).toBeDisabled();expect(button).toBeDisabled();expect(h.people).toHaveBeenCalledWith({libraryKind:'us_adult',limit:24});
  const image=radio.closest('label')!.querySelector('img')!;fireEvent.load(image);fireEvent.click(radio);fireEvent.error(image);
  expect(button).toBeDisabled();fireEvent.load(image);fireEvent.click(radio);fireEvent.click(button);
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
  expect(refresh.mock.calls[0]).toEqual(['entry',expect.objectContaining({mode:'specified',expectedInventoryRevision:4,
    expectedRepresentationDigest:'inventory-digest',personId:'actor',expectedPersonRevision:3,expectedReferenceRevision:2})]);
  expect(screen.queryByRole('button',{name:/新建|建档|创建/})).not.toBeInTheDocument();
});
it('automatic refresh reuses its exact command after an unknown response and never borrows a selected name',async()=>{
  const refresh=vi.spyOn(helixAdminApi,'refreshInventoryActor').mockRejectedValueOnce(new Error('private transport')).mockResolvedValue({aftercareCaseId:'case',state:'queued',replayed:true});
  mount();const button=await screen.findByRole('button',{name:'自动刷新演员'});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('提交结果尚未收到');expect(screen.getByRole('alert')).not.toHaveTextContent('private');
  fireEvent.click(button);await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(2));
  expect(refresh.mock.calls[0]).toEqual(refresh.mock.calls[1]);expect(refresh.mock.calls[0][1]).not.toHaveProperty('personId');
  expect(refresh.mock.calls[0][1]).toMatchObject({mode:'automatic',expectedInventoryRevision:4});
});
it('reports completed no-match without inviting a second actor confirmation',async()=>{
  const h=mount({...state,progress:{aftercareCaseId:'case',mode:'automatic',state:'resolved',reasonCode:'actor_match_unchanged',works:[]}});
  expect(await screen.findByText('未找到有效匹配，保留原演员。')).toBeVisible();expect(h.onChanged).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Old Actor')).toBeVisible();
});
it('a version conflict stops further submissions until the user reopens current state',async()=>{
  const refresh=vi.spyOn(helixAdminApi,'refreshInventoryActor').mockRejectedValue(new AdminApiError(409,'conflict','changed'));mount();
  const button=await screen.findByRole('button',{name:'自动刷新演员'});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('影片或演员资料已变化');expect(button).toBeDisabled();expect(refresh).toHaveBeenCalledTimes(1);
});
it('reports a file collision without presenting an active Case as completed or allowing a duplicate refresh',async()=>{
  mount({...state,canRefresh:false,blockingCaseId:'case',progress:{aftercareCaseId:'case',mode:'specified',state:'active',reasonCode:null,
    works:[{workId:'publish',phase:'publish',state:'failed',failureCode:'ARCA_US_ADULT_TARGET_CONFLICT'}]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('目标位置存在冲突文件');
  expect(screen.getByRole('button',{name:'自动刷新演员'})).toBeDisabled();
  expect(screen.queryByText('演员刷新已完成。')).not.toBeInTheDocument();
});
