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
it('configures each source independently with an explicit anonymous route and retains saved feedback',async()=>{
  const state={kind:'jav-javdb',configured:false,configRevision:0,endpoint:null,settings:{networkRoute:{mode:'direct',proxyEndpoint:null}}} as IntegrationState;
  const read=vi.spyOn(helixAdminApi,'getIntegration').mockResolvedValue(state),test=vi.spyOn(helixAdminApi,'testIntegration').mockResolvedValue({connectionProofId:'proof',identityProviderKey:'IPX-177',expiresAtMs:1}),
    save=vi.spyOn(helixAdminApi,'configureIntegration').mockResolvedValue(state);render(<JavSourcesSettings onUnauthorized={vi.fn()}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'测试并连接'})).toBeEnabled());expect(read).toHaveBeenCalledTimes(8);
  fireEvent.change(screen.getByLabelText('网络方式'),{target:{value:'http_proxy'}});expect(screen.getByRole('button',{name:'测试并连接'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('代理地址'),{target:{value:'http://proxy.test:7890'}});fireEvent.click(screen.getByRole('button',{name:'测试并连接'}));
  await screen.findByText('来源验证通过，已保存连接。');expect(test.mock.calls[0][1]).toMatchObject({credential:{kind:'anonymous'},settings:{networkRoute:{mode:'http_proxy',proxyEndpoint:'http://proxy.test:7890'}}});
  expect(save.mock.calls[0][1]).toMatchObject({expectedConfigRevision:0,connectionProofId:'proof'});
});
it('keeps a rejected source disconnected and offers an editable route without leaking upstream details',async()=>{
  const state={kind:'jav-javdb',configured:false,configRevision:0,endpoint:null,settings:{networkRoute:{mode:'direct',proxyEndpoint:null}}} as IntegrationState;
  vi.spyOn(helixAdminApi,'getIntegration').mockResolvedValue(state);
  vi.spyOn(helixAdminApi,'testIntegration').mockRejectedValue(new AdminApiError(502,'PLATFORM_INTEGRATION_HTTP_FAILED','private upstream response'));
  const save=vi.spyOn(helixAdminApi,'configureIntegration');render(<JavSourcesSettings onUnauthorized={vi.fn()}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'测试并连接'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'测试并连接'}));
  await screen.findByText('来源未通过影片和封面验证，请核对网络方式后重试。');expect(screen.queryByText('private upstream response')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'断开该来源'})).not.toBeInTheDocument();expect(screen.getByRole('option',{name:'JavDB · 未连接'})).toBeInTheDocument();expect(screen.getByLabelText('网络方式')).toBeEnabled();
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
