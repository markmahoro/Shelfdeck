import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import JavIdentityDialog from '../src/helix/JavIdentityDialog';
import JavSourcesSettings from '../src/helix/JavSourcesSettings';
import {AdminApiError,helixAdminApi,type FormationSubject,type JavQualifiedIdentityPreview,type IntegrationState} from '../src/helix/api';
const item={subjectId:'subject',displayIdentity:'Unknown file',contentProfile:'jav',currentRun:{libraRunId:'run',stateRevision:1,currentIdentityRevision:null},
  productIdentityIssue:{claimedCode:null,sourceLocation:'/source/Unknown.mkv'}} as FormationSubject;
const proof:JavQualifiedIdentityPreview={result:'qualified',javCode:'IPX-177',displayTitle:'Fixture title',posterUrl:'https://example.test/cover.jpg',siteRef:'javdb',resourceKey:'fixture',
  previewId:'preview',candidateSetDigest:'digest',expectedRunStateRevision:1,expectedIdentityRevision:0,expectedSelectionIntentRevision:2};
afterEach(()=>vi.restoreAllMocks());
function mount(){const callbacks={onClose:vi.fn(),onSelected:vi.fn(),onRefresh:vi.fn()};render(<MemoryRouter><JavIdentityDialog item={item} {...callbacks}/></MemoryRouter>);return callbacks;}
async function query(code='IPX-177'){fireEvent.change(screen.getByLabelText('番号'),{target:{value:code}});fireEvent.click(screen.getByRole('button',{name:'查询'}));}
it('keeps an unrecognized source pending until exact qualified confirmation and closing has no write',async()=>{
  vi.spyOn(helixAdminApi,'previewJavIdentity').mockResolvedValue(proof);const choose=vi.spyOn(helixAdminApi,'chooseJavIdentity'),callbacks=mount();
  expect(screen.getByLabelText('番号')).toHaveFocus();expect(screen.getByText('/source/Unknown.mkv')).toBeVisible();
  expect(screen.getByRole('button',{name:'确认影片并继续整理'})).toBeDisabled();await query();
  await screen.findByLabelText('影片预览');fireEvent.click(screen.getByRole('button',{name:'稍后处理'}));
  expect(callbacks.onClose).toHaveBeenCalled();expect(choose).not.toHaveBeenCalled();
});
it('invalidates a preview when input changes and ignores late old responses',async()=>{
  let finish!:(value:JavQualifiedIdentityPreview)=>void;vi.spyOn(helixAdminApi,'previewJavIdentity').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));mount();
  await query();fireEvent.change(screen.getByLabelText('番号'),{target:{value:'FC2-718323'}});await act(async()=>finish(proof));
  expect(screen.queryByLabelText('影片预览')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'确认影片并继续整理'})).toBeDisabled();
});
it('requires an exact ambiguous resource to be qualified before confirmation',async()=>{
  const preview=vi.spyOn(helixAdminApi,'previewJavIdentity').mockResolvedValueOnce({result:'ambiguous',javCode:'IPX-177',candidates:[
    {siteRef:'javdb',resourceKey:'first',javCode:'IPX-177'},{siteRef:'javdb',resourceKey:'second',javCode:'IPX-177'}]}).mockResolvedValue(proof);
  mount();await query();const candidate=await screen.findByRole('button',{name:'核验候选 2 · JavDB'});
  expect(screen.getByRole('button',{name:'确认影片并继续整理'})).toBeDisabled();fireEvent.click(candidate);await screen.findByLabelText('影片预览');
  expect(preview.mock.calls[1]).toEqual([item,'IPX-177',{siteRef:'javdb',resourceKey:'second'}]);
});
it('submits the complete server proof using one retry key and reports only accepted selection',async()=>{
  vi.spyOn(helixAdminApi,'previewJavIdentity').mockResolvedValue(proof);
  const choose=vi.spyOn(helixAdminApi,'chooseJavIdentity').mockRejectedValueOnce(new Error('private technical failure')).mockResolvedValue({selectionIntentId:'intent',intentRevision:3,replayed:true});
  const callbacks=mount();await query();await screen.findByLabelText('影片预览');fireEvent.click(screen.getByRole('button',{name:'确认影片并继续整理'}));
  await screen.findByRole('alert');expect(screen.queryByText('private technical failure')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'确认影片并继续整理'}));await waitFor(()=>expect(callbacks.onSelected).toHaveBeenCalled());
  expect(choose.mock.calls[0][1]).toEqual(proof);expect(choose.mock.calls[0][2]).toEqual(choose.mock.calls[1][2]);
});
it('shows a source settings link and handles a concurrent first identity lock',async()=>{
  vi.spyOn(helixAdminApi,'previewJavIdentity').mockRejectedValueOnce(new AdminApiError(409,'PLATFORM_INTEGRATION_NOT_CONFIGURED','private'))
    .mockRejectedValueOnce(new AdminApiError(409,'LIBRA_JAV_IDENTITY_LOCKED','private'));
  const callbacks=mount();await query();expect(await screen.findByRole('link',{name:'连接 JAV 资料来源'})).toHaveAttribute('href','/settings');
  await query();await screen.findByText('身份已确认，整理中不能更改番号。');expect(callbacks.onRefresh).toHaveBeenCalled();expect(screen.getByLabelText('番号')).toBeDisabled();
});
it('tests all sources from one action with no per-site proxy controls',async()=>{
  const state={configured:false,configRevision:0,endpoint:null} as IntegrationState;
  vi.spyOn(helixAdminApi,'getIntegration').mockResolvedValue(state);
  const test=vi.spyOn(helixAdminApi,'testIntegration').mockResolvedValue({connectionProofId:'proof',identityProviderKey:'IPX-177',expiresAtMs:1});
  const save=vi.spyOn(helixAdminApi,'configureIntegration').mockResolvedValue({...state,configured:true});
  render(<JavSourcesSettings onUnauthorized={vi.fn()}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'一键测试并启用'})).toBeEnabled());
  expect(screen.queryByLabelText('网络方式')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'一键测试并启用'}));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(8));
  await screen.findByText('8 / 8 已启用');
  for(const call of test.mock.calls){expect(call[1]).toMatchObject({credential:{kind:'anonymous'}});expect(call[1]).not.toHaveProperty('settings');}
});
it('shows precise station failures, preserves successful stations and does not print upstream content',async()=>{
  const state={configured:false,configRevision:0,endpoint:null} as IntegrationState;
  vi.spyOn(helixAdminApi,'getIntegration').mockResolvedValue(state);
  vi.spyOn(helixAdminApi,'testIntegration').mockImplementation(async kind=>{
    if(kind==='jav-javdb')throw new AdminApiError(502,'PLATFORM_INTEGRATION_HTTP_FAILED','private upstream response',{reasonCode:'JAV_SOURCE_ACCESS_DENIED',status:403});
    return {connectionProofId:'proof',identityProviderKey:'IPX-177',expiresAtMs:1};
  });
  const save=vi.spyOn(helixAdminApi,'configureIntegration').mockResolvedValue({...state,configured:true});
  render(<JavSourcesSettings onUnauthorized={vi.fn()}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'一键测试并启用'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'一键测试并启用'}));
  await screen.findByText('站点拒绝访问（HTTP 403）');await screen.findByText('7 / 8 已启用');
  expect(save).toHaveBeenCalledTimes(7);expect(screen.queryByText('private upstream response')).not.toBeInTheDocument();
});
it('blocks confirmation after a failed cover display until a fresh query',async()=>{
  vi.spyOn(helixAdminApi,'previewJavIdentity').mockResolvedValue(proof);const choose=vi.spyOn(helixAdminApi,'chooseJavIdentity');mount();await query();
  const image=await screen.findByRole('img',{name:'Fixture title封面'});fireEvent.error(image);
  expect(screen.getByText('封面显示失败')).toBeVisible();expect(screen.getByRole('button',{name:'确认影片并继续整理'})).toBeDisabled();expect(choose).not.toHaveBeenCalled();
  await query();await screen.findByRole('img',{name:'Fixture title封面'});expect(screen.getByRole('button',{name:'确认影片并继续整理'})).toBeEnabled();
});
it('discards an expired proof and requires a new query before confirmation',async()=>{
  const lookup=vi.spyOn(helixAdminApi,'previewJavIdentity').mockResolvedValueOnce(proof).mockResolvedValue({...proof,previewId:'fresh-preview'}),
    choose=vi.spyOn(helixAdminApi,'chooseJavIdentity').mockRejectedValueOnce(new AdminApiError(409,'LIBRA_JAV_PREVIEW_EXPIRED','private')).mockResolvedValue({selectionIntentId:'accepted',intentRevision:3,replayed:false});
  mount();await query();await screen.findByLabelText('影片预览');fireEvent.click(screen.getByRole('button',{name:'确认影片并继续整理'}));await screen.findByText('预览已过期，请重新查询。');
  expect(screen.queryByLabelText('影片预览')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'确认影片并继续整理'})).toBeDisabled();
  await query();await screen.findByLabelText('影片预览');fireEvent.click(screen.getByRole('button',{name:'确认影片并继续整理'}));await waitFor(()=>expect(choose).toHaveBeenCalledTimes(2));
  expect(lookup).toHaveBeenCalledTimes(2);expect(choose.mock.calls[1][1].previewId).toBe('fresh-preview');expect(choose.mock.calls[1][2]).not.toBe(choose.mock.calls[0][2]);
});
