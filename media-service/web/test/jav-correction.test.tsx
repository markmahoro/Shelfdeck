import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import JavCorrectionDialog from '../src/helix/JavCorrectionDialog';
import {AdminApiError,helixAdminApi,type CollectionEntry,type JavCorrectionQualifiedPreview,type JavCorrectionStatus} from '../src/helix/api';

const item={shelfEntryId:'entry',providerKey:'IPX-177',displayIdentity:'Old film',hasPoster:true,currentInventoryRevision:1} as CollectionEntry;
const proof:JavCorrectionQualifiedPreview={result:'qualified',previewId:'preview',shelfEntryId:'entry',basisDigest:'basis',proposalDigest:'proposal',placementPreviewDigest:'placement',
  oldIdentity:{javCode:'IPX-177',title:'Old film'},newIdentity:{javCode:'IPX-178',title:'New film',posterUrl:'data:image/jpeg;base64,AA==',siteRef:'javdb'},
  paths:[{materialKey:'video',role:'primary_payload',previousLocation:'/shelf/Old/Old.mkv',targetLocation:'/shelf/New/New.mkv',targetEndpointId:'target'}]};
const accepted={correctionId:'correction',shelfEntryId:'entry',state:'admitted' as const,stateRevision:1,admissionDigest:'admission',updatedAtMs:100,replayed:false};
const committed:JavCorrectionStatus={...accepted,state:'committed',cleanupState:'completed',stateRevision:3,cancellation:{available:false,reasonCode:'not_attention_required'},recovery:{available:false,mode:null,previousIntentDigest:null},oldJavCode:'IPX-177',newJavCode:'IPX-178'};
const failed:JavCorrectionStatus={...committed,state:'attention_required',cleanupState:null,cancellation:{available:true,reasonCode:null}};
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
function mount(){vi.spyOn(helixAdminApi,'getLatestJavCorrection').mockResolvedValue({correction:null});
  const callbacks={onClose:vi.fn(),onChanged:vi.fn(),onUnauthorized:vi.fn()};render(<MemoryRouter><JavCorrectionDialog item={item} {...callbacks}/></MemoryRouter>);return callbacks;}
async function query(){await waitFor(()=>expect(screen.getByLabelText('新番号')).toBeEnabled());fireEvent.change(screen.getByLabelText('新番号'),{target:{value:'IPX-178'}});fireEvent.click(screen.getByRole('button',{name:'查询'}));}
it('shows the old and new identity and exact paths, requiring consequence consent before a write',async()=>{
  vi.spyOn(helixAdminApi,'previewJavCorrection').mockResolvedValue(proof);const confirm=vi.spyOn(helixAdminApi,'confirmJavCorrection');const callbacks=mount();
  await query();await screen.findByLabelText('新旧影片预览');expect(screen.getByText('Old film')).toBeVisible();expect(screen.getByText('New film')).toBeVisible();
  expect(screen.getByRole('button',{name:'确认纠正'})).toBeDisabled();fireEvent.click(screen.getByText('文件位置 · 1 项'));
  expect(screen.getByText('/shelf/Old/Old.mkv')).toBeVisible();expect(screen.getByText('/shelf/New/New.mkv')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'确认纠正'})).toBeEnabled();
  fireEvent.click(screen.getAllByRole('button',{name:'关闭',exact:true})[1]);expect(callbacks.onClose).toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();
});
it('discards late previews and clears consent when the code changes',async()=>{
  let finish!:(value:JavCorrectionQualifiedPreview)=>void;vi.spyOn(helixAdminApi,'previewJavCorrection').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));mount();
  await query();fireEvent.change(screen.getByLabelText('新番号'),{target:{value:'FC2-718323'}});await act(async()=>finish(proof));
  expect(screen.queryByLabelText('新旧影片预览')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'确认纠正'})).toBeDisabled();
});
it('retries confirmation with the same exact proof and key and reports only real completion',async()=>{
  vi.spyOn(helixAdminApi,'previewJavCorrection').mockResolvedValue(proof);
  const confirm=vi.spyOn(helixAdminApi,'confirmJavCorrection').mockRejectedValueOnce(new Error('private details')).mockResolvedValue(accepted);
  vi.spyOn(helixAdminApi,'getJavCorrection').mockResolvedValue(committed);const callbacks=mount();
  await query();await screen.findByLabelText('新旧影片预览');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认纠正'}));
  await screen.findByRole('alert');expect(screen.queryByText('private details')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'确认纠正'}));
  await screen.findByText('等待纠正');expect(callbacks.onChanged).not.toHaveBeenCalled();
  expect(confirm.mock.calls[0][1]).toEqual(proof);expect(confirm.mock.calls[0][2]).toEqual(confirm.mock.calls[1][2]);
  await screen.findByText('身份已纠正',{}, {timeout:3500});expect(callbacks.onChanged).toHaveBeenCalledTimes(1);expect(screen.queryByLabelText('新番号')).not.toBeInTheDocument();
});
it('reopens an active correction without allowing a second query or confirmation',async()=>{
  vi.spyOn(helixAdminApi,'getLatestJavCorrection').mockResolvedValue({correction:{...committed,state:'active'}});
  const lookup=vi.spyOn(helixAdminApi,'previewJavCorrection'),onClose=vi.fn();render(<MemoryRouter><JavCorrectionDialog item={item} onClose={onClose} onChanged={vi.fn()} onUnauthorized={vi.fn()}/></MemoryRouter>);
  await screen.findByText('正在纠正');expect(screen.queryByLabelText('新番号')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'确认纠正'})).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(onClose).toHaveBeenCalled();expect(lookup).not.toHaveBeenCalled();
});
it('provides a settings action and invalidates an expired preview before retry',async()=>{
  vi.spyOn(helixAdminApi,'previewJavCorrection').mockRejectedValueOnce(new AdminApiError(400,'PLATFORM_INTEGRATION_NOT_CONFIGURED','private')).mockResolvedValue(proof);
  vi.spyOn(helixAdminApi,'confirmJavCorrection').mockRejectedValue(new AdminApiError(409,'ARCA_JAV_CORRECTION_PREVIEW_EXPIRED','private'));mount();
  await query();expect(await screen.findByRole('link',{name:'连接 JAV 资料来源'})).toHaveAttribute('href','/settings');
  await query();await screen.findByLabelText('新旧影片预览');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认纠正'}));
  await screen.findByRole('alert');expect(screen.getByRole('button',{name:'确认纠正'})).toBeDisabled();expect(screen.getByRole('button',{name:'查询'})).toBeEnabled();
});
it('contains keyboard focus across the dialog header and confirmation actions',async()=>{
  mount();await waitFor(()=>expect(screen.getByLabelText('新番号')).toBeEnabled());
  const [first,close]=screen.getAllByRole('button',{name:'关闭',exact:true});
  close.focus();fireEvent.keyDown(close,{key:'Tab'});expect(first).toHaveFocus();
});
it('holds a committed correction until cleanup finishes and does not offer a second identity query',async()=>{
  vi.spyOn(helixAdminApi,'getLatestJavCorrection').mockResolvedValue({correction:{...committed,cleanupState:'pending'}});
  vi.spyOn(helixAdminApi,'getJavCorrection').mockResolvedValue({...committed,cleanupState:'attention_required'});
  const lookup=vi.spyOn(helixAdminApi,'previewJavCorrection');render(<MemoryRouter><JavCorrectionDialog item={item} onClose={vi.fn()} onChanged={vi.fn()} onUnauthorized={vi.fn()}/></MemoryRouter>);
  await screen.findByText('身份已更新 · 等待清理');expect(screen.queryByLabelText('新番号')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'完成'})).not.toBeInTheDocument();
  await screen.findByText('身份已更新 · 清理需要处理',{}, {timeout:3500});expect(screen.getByRole('button',{name:'刷新状态'})).toBeEnabled();expect(lookup).not.toHaveBeenCalled();
});
it("routes an existing failed correction to its workbench task without offering business actions in Collection",async()=>{
  vi.spyOn(helixAdminApi,"getLatestJavCorrection").mockResolvedValue({correction:failed});const cancel=vi.spyOn(helixAdminApi,"cancelJavCorrection");
  render(<MemoryRouter><JavCorrectionDialog item={item} onClose={vi.fn()} onChanged={vi.fn()} onUnauthorized={vi.fn()}/></MemoryRouter>);
  await screen.findByText("纠正需要处理");expect(screen.getByRole("link",{name:"查看维护任务"})).toHaveAttribute("href","/formation?correctionId=correction");
  expect(screen.queryByRole("button",{name:"取消纠正"})).not.toBeInTheDocument();expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();expect(cancel).not.toHaveBeenCalled();
});
