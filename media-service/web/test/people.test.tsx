import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PeoplePage from '../src/helix/PeoplePage';
import { AdminApiError, helixAdminApi, type PeopleProjection, type PersonImageSearch } from '../src/helix/api';
import { SessionProvider } from '../src/helix/session';

const projection: PeopleProjection = {
  items: [
    {
      libraryKind: 'normal', personId: 'person-tmdb', status: 'active', currentRevision: 1, canonicalName: '周迅', aliases: ['周迅', 'Zhou Xun'],
      providerIdentities: [{ provider: 'tmdb', namespace: 'tmdb_person', providerKey: '1337' }],
      currentPreferenceRevision: null, currentReferenceRevision: null, createdAtMs: 1,
    },
    {
      libraryKind: 'normal', personId: 'person-local', status: 'active', currentRevision: 1, canonicalName: 'Local Artist', aliases: [],
      providerIdentities: [], currentPreferenceRevision: null, currentReferenceRevision: null, createdAtMs: 2,
    },
  ],
  nextCursor: null,
  summary: { activePersonCount: 2, mergedPersonCount: 0, openRegistrationCandidateCount: 0, openMergeCandidateCount: 0 },
};

function renderPeople(value:PeopleProjection=projection) {
  vi.spyOn(helixAdminApi, 'listPeople').mockResolvedValue(value);
  vi.spyOn(helixAdminApi, 'listPeopleRegistrationCandidates').mockResolvedValue({ items: [] });
  vi.spyOn(helixAdminApi, 'readUsAdultRecommendations').mockResolvedValue({publication:null,items:[]});
  return render(<SessionProvider><PeoplePage /></SessionProvider>);
}

describe('People contact sheet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads an existing NFO Person avatar from its reliable TMDB Person ID',async()=>{
    renderPeople({...projection,items:[{...projection.items[0],providerIdentities:[{provider:'tmdb',namespace:'person',providerKey:'1337'}]}]});
    expect(await screen.findByRole('img',{name:'周迅头像'})).toHaveAttribute('src',helixAdminApi.personAvatarUrl('person-tmdb',null));
  });

  it('shows registered people as accessible cards with Provider identities', async () => {
    renderPeople();
    expect(await screen.findByRole('article', { name: '周迅，已登记' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Local Artist，已登记' })).toBeInTheDocument();
    expect(screen.getByText('TMDB · 1337')).toBeInTheDocument();
    expect(screen.getByText('Zhou Xun')).toBeInTheDocument();
  });

  it('loads a protected TMDB avatar lazily and falls back to name initials on failure or missing identity', async () => {
    // Flush the mocked projection and mount effects before dispatching image events.
    await act(async () => { renderPeople(); });
    const image = await screen.findByRole('img', { name: '周迅头像' });
    const avatar = image.closest('.people-avatar');
    expect(avatar).toHaveAttribute('data-state', 'loading');
    expect(image).toHaveAttribute('src', '/v1/admin/people/person-tmdb/avatar');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(screen.getByText('LA')).toBeInTheDocument();
    await act(async () => { fireEvent.load(image); });
    expect(avatar).toHaveAttribute('data-state', 'loaded');
    expect(screen.getByRole('img', { name: '周迅头像' })).toBe(image);
    expect(screen.getByText('人物头像已加载')).toBeInTheDocument();
    await act(async () => { fireEvent.error(image); });
    expect(avatar).toHaveAttribute('data-state', 'fallback');
    expect(avatar?.querySelector('.people-avatar-initials')).toHaveTextContent('周迅');
    await waitFor(() => expect(screen.getAllByText('使用姓名首字头像')).toHaveLength(2));
    expect(screen.queryByRole('img', { name: '周迅头像' })).not.toBeInTheDocument();
  });

  it('keeps normal and JAV read-only and pages within the selected library', async () => {
    renderPeople();
    await screen.findByRole('article', {name:'周迅，已登记'});
    expect(helixAdminApi.listPeopleRegistrationCandidates).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'新建演员'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab',{name:'JAV 演员'}));
    await waitFor(()=>expect(helixAdminApi.listPeople).toHaveBeenLastCalledWith(expect.objectContaining({libraryKind:'jav'})));
    expect(screen.queryByRole('button',{name:'新建演员'})).not.toBeInTheDocument();
    vi.mocked(helixAdminApi.listPeople).mockResolvedValueOnce({...projection,nextCursor:'next-jav-person'});
    fireEvent.click(screen.getByRole('button',{name:'刷新'}));
    const more=await screen.findByRole('button',{name:'加载更多'});
    vi.mocked(helixAdminApi.listPeople).mockResolvedValueOnce({...projection,items:[]});
    fireEvent.click(more);
    await waitFor(()=>expect(helixAdminApi.listPeople).toHaveBeenLastCalledWith(expect.objectContaining({libraryKind:'jav',cursor:'next-jav-person'})));
  });
});

const searched:PersonImageSearch = {sources:[{source:'stashbox',state:'failed',items:[],error:{code:'SOURCE_FAILED',message:'StashBox 搜索失败。'}},
  {source:'wikimedia',state:'available',items:[{source:'wikimedia',sourceObjectId:'photo-1',canonicalName:'Sample Actor',aliases:[],
    sourcePageUrl:'https://commons.wikimedia.org/wiki/File:Sample.jpg',attribution:'Wikimedia Commons',width:600,height:900,selectionToken:'chosen-photo'}]}]};

async function openRegistration() {
  renderPeople();await screen.findByRole('article',{name:'周迅，已登记'});
  fireEvent.click(screen.getByRole('tab',{name:'US Adult 演员'}));
  fireEvent.click(await screen.findByRole('button',{name:'新建演员'}));
  fireEvent.change(screen.getByLabelText('姓名'),{target:{value:'Sample Actor'}});
}
describe('US Adult registration',()=>{
  afterEach(()=>vi.restoreAllMocks());
  it('requires explicit selection, shows independent source errors, and retries the same operation after an unknown outcome',async()=>{
    vi.spyOn(helixAdminApi,'searchPersonImages').mockResolvedValue(searched);
    const register=vi.spyOn(helixAdminApi,'registerPerson').mockRejectedValueOnce(new TypeError('network')).mockResolvedValue({operationRef:'op-1',state:'accepted'});
    vi.spyOn(helixAdminApi,'getPersonImageOperation').mockResolvedValue({operationRef:'op-1',state:'completed',personId:'person-created',failureCode:null});
    await openRegistration();
    fireEvent.click(screen.getByRole('button',{name:'按姓名辅助搜图'}));
    await screen.findByText('StashBox 搜索失败。');
    expect(screen.getByRole('button',{name:'确认建档'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'选择 Sample Actor 的图片，Wikimedia Commons'}));
    fireEvent.click(screen.getByRole('button',{name:'确认建档'}));
    await screen.findByText('尚未收到提交结果，请重试同一次建档。');
    expect(screen.getByLabelText('姓名')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'重试同一次建档'}));
    await screen.findByText('演员已建档，可以用于影片识别。');
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[1][0]).toEqual(register.mock.calls[0][0]);
    expect(register.mock.calls[0][0]).toMatchObject({libraryKind:'us_adult',canonicalName:'Sample Actor',image:{kind:'search',selectionToken:'chosen-photo'}});
  });
  it('rejects unsupported uploads and displays a failed single-face check without claiming registration',async()=>{
    vi.spyOn(helixAdminApi,'registerPerson').mockResolvedValue({operationRef:'op-bad',state:'accepted'});
    vi.spyOn(helixAdminApi,'getPersonImageOperation').mockResolvedValue({operationRef:'op-bad',state:'failed',personId:null,failureCode:'FACE_REFERENCE_SINGLE_FACE_REQUIRED'});
    await openRegistration();
    fireEvent.change(screen.getByLabelText('上传参考图片'),{target:{files:[new File(['gif'],'actor.gif',{type:'image/gif'})]}});
    await screen.findByText('请选择不超过 10 MiB 的 JPEG、PNG 或 WebP 图片。');
    expect(screen.getByRole('button',{name:'确认建档'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('上传参考图片'),{target:{files:[new File(['jpeg-fixture'],'actor.jpg',{type:'image/jpeg'})]}});
    await screen.findByRole('img',{name:'已选择的演员参考图片'});
    fireEvent.click(screen.getByRole('button',{name:'确认建档'}));
    await screen.findByText('参考图片必须恰好包含一张人脸，请重新选图。');
    expect(screen.queryByText('演员已建档，可以用于影片识别。')).not.toBeInTheDocument();
    expect(screen.getByLabelText('姓名')).toBeEnabled();
  });
  it('ignores stale search results after the name changes',async()=>{
    let resolve!:(value:PersonImageSearch)=>void;
    vi.spyOn(helixAdminApi,'searchPersonImages').mockImplementation(()=>new Promise(done=>{resolve=done;}));
    await openRegistration();
    fireEvent.click(screen.getByRole('button',{name:'按姓名辅助搜图'}));
    fireEvent.change(screen.getByLabelText('姓名'),{target:{value:'Another Actor'}});
    await act(async()=>resolve(searched));
    expect(screen.queryByRole('button',{name:'选择 Sample Actor 的图片，Wikimedia Commons'})).not.toBeInTheDocument();
  });
});

it('edits US actor details with the frozen revision and preserves the command across uncertain delivery',async()=>{
  const person={...projection.items[0],libraryKind:'us_adult' as const,canonicalName:'Sample Actor',aliases:['Sample Actor','Alias'],currentReferenceRevision:1};
  vi.spyOn(helixAdminApi,'listPeople').mockResolvedValue({...projection,items:[person]});
  vi.spyOn(helixAdminApi,'updatePersonProfile').mockRejectedValueOnce(new TypeError('network')).mockRejectedValueOnce(new AdminApiError(409,'PEOPLE_PROFILE_REVISION_CONFLICT','演员资料已变化。'));
  render(<SessionProvider><PeoplePage/></SessionProvider>);
  await screen.findByRole('tab',{name:'US Adult 演员'});
  fireEvent.click(screen.getByRole('tab',{name:'US Adult 演员'}));
  fireEvent.click(await screen.findByRole('button',{name:'编辑 Sample Actor'}));
  fireEvent.change(screen.getByLabelText('演员姓名'),{target:{value:'Updated Actor'}});
  fireEvent.click(screen.getByRole('button',{name:'保存资料'}));
  await screen.findByText('尚未收到保存结果，请重试同一次修改。');
  expect(screen.getByLabelText('演员姓名')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重试同一次修改'}));
  await screen.findByText('演员资料已变化。');
  const calls=vi.mocked(helixAdminApi.updatePersonProfile).mock.calls;
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0][1]).toMatchObject({expectedPersonRevision:1,canonicalName:'Updated Actor',aliases:['Alias']});
  expect(screen.getByRole('button',{name:'保存资料'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'关闭并重新读取'}));
  expect(screen.queryByLabelText('演员姓名')).not.toBeInTheDocument();
  vi.restoreAllMocks();
});

it('adds a reference to the existing US actor without creating another identity',async()=>{
  const person={...projection.items[0],libraryKind:'us_adult' as const,canonicalName:'Sample Actor',currentReferenceRevision:2,currentRevision:3};
  vi.spyOn(helixAdminApi,'listPeople').mockResolvedValue({...projection,items:[person]});
  const register=vi.spyOn(helixAdminApi,'registerPerson');
  vi.spyOn(helixAdminApi,'addPersonReference').mockResolvedValue({operationRef:'image-update',state:'accepted'});
  vi.spyOn(helixAdminApi,'readPersonReferences').mockResolvedValue({personId:person.personId,libraryKind:'us_adult',currentRevision:3,currentReferenceRevision:2,
    referenceImages:[{referenceAssetId:'existing'}]});
  vi.spyOn(helixAdminApi,'getPersonImageOperation').mockResolvedValue({operationRef:'image-update',state:'completed',personId:person.personId,failureCode:null});
  render(<SessionProvider><PeoplePage/></SessionProvider>);
  fireEvent.click(await screen.findByRole('tab',{name:'US Adult 演员'}));
  fireEvent.click(await screen.findByRole('button',{name:'管理 Sample Actor 的参考图片'}));
  fireEvent.click(await screen.findByRole('button',{name:'补充参考图'}));
  expect(screen.getByLabelText('搜图姓名')).toHaveValue('Sample Actor');
  fireEvent.change(screen.getByLabelText('上传参考图片'),{target:{files:[new File(['new-photo'],'photo.jpg',{type:'image/jpeg'})]}});
  await screen.findByRole('img',{name:'已选择的演员参考图片'});
  fireEvent.click(screen.getByRole('button',{name:'确认添加图片'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'确认添加图片'})).not.toBeInTheDocument());
  expect(register).not.toHaveBeenCalled();
  expect(helixAdminApi.addPersonReference).toHaveBeenCalledWith(person.personId,expect.objectContaining({expectedPersonRevision:3,expectedReferenceRevision:2,image:{kind:'upload',bytesBase64:btoa('new-photo')}}));
  vi.restoreAllMocks();
});
