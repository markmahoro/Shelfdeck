import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import App from '../src/App';
import {mockRunningRuntime} from './fixtures/runtime';
beforeEach(()=>{mockRunningRuntime();});
import {AdminApiError,helixAdminApi,type JavCorrectionWorkItem} from '../src/helix/api';
import {JavCorrectionWorkRow} from '../src/helix/JavCorrectionWorkRow';
const item:JavCorrectionWorkItem={taskType:'jav_identity_correction',correctionId:'correction-1',shelfEntryId:'entry',state:'attention_required',cleanupState:null,stateRevision:2,admissionDigest:'admission',
  cancellation:{available:true,reasonCode:null},recovery:{available:false,mode:null,previousIntentDigest:null},oldJavCode:'IPX-177',newJavCode:'IPX-178',updatedAtMs:20,classification:'attention_required',displayIdentity:'Example film',targetShelfId:'shelf',targetShelfName:'Films',createdAtMs:10,terminalAtMs:null,
  processDetail:{contract:'jav_correction_process_actual_plans@1',stages:[]}};
beforeEach(()=>{
  const summary={totalCount:0,inProgressCount:0,attentionRequiredCount:0,completedCount:0},projection={status:'ready' as const,asOfMs:1};
  vi.spyOn(helixAdminApi,'listFormation').mockResolvedValue({items:[],summary,nextCursor:null,projection});
  vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
  vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[],counts:{},nextCursor:null});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi,'listJavCorrectionWork').mockResolvedValue({items:[item],counts:{attention_required:1},nextCursor:null});
});
afterEach(()=>vi.restoreAllMocks());
it('invalidates unsubmitted consent when the recovery consequence changes while preserving an unknown submitted request',async()=>{
  const original={...item,recovery:{available:true,mode:'continue_correction' as const,previousIntentDigest:null}},
    cleanup={...original,state:'committed' as const,cleanupState:'attention_required' as const,stateRevision:3,recovery:{...original.recovery,mode:'continue_cleanup' as const}},
    changed=vi.fn(),props={onOpen:vi.fn(),onChanged:changed,onUnauthorized:vi.fn()},
    recover=vi.spyOn(helixAdminApi,'recoverJavCorrection').mockRejectedValue(new Error('unknown result')),
    view=render(<table><tbody><JavCorrectionWorkRow item={original} {...props}/></tbody></table>);
  fireEvent.click(screen.getByRole('button',{name:'继续纠正'}));fireEvent.click(screen.getByRole('checkbox'));
  view.rerender(<table><tbody><JavCorrectionWorkRow item={cleanup} {...props}/></tbody></table>);
  expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.getByRole('button',{name:'继续清理'})).toBeDisabled();expect(recover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'继续清理'}));await screen.findByRole('alert');
  view.rerender(<table><tbody><JavCorrectionWorkRow item={{...cleanup,stateRevision:4,recovery:{...cleanup.recovery,available:false,previousIntentDigest:'new-intent'}}} {...props}/></tbody></table>);
  expect(screen.getByRole('checkbox')).toBeChecked();fireEvent.click(screen.getByRole('button',{name:'继续清理'}));
  await waitFor(()=>expect(recover).toHaveBeenCalledTimes(2));expect(recover.mock.calls[1]).toEqual(recover.mock.calls[0]);expect(recover.mock.calls[0][1]).toEqual(cleanup);
});
it('shows independent corrections as maintenance and keeps process details read-only',async()=>{
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);
  const row=(await screen.findByText('Example film')).closest('tr')!;
  expect(within(row).getByText('维护任务')).toBeVisible();expect(within(row).getByText('身份纠正')).toBeVisible();expect(within(row).getByText('IPX-177 → IPX-178')).toBeVisible();
  fireEvent.click(within(row).getByRole('button',{name:'查看过程'}));const dialog=screen.getByRole('dialog');
  expect(within(dialog).queryByRole('button',{name:'取消纠正'})).not.toBeInTheDocument();expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  await waitFor(()=>expect(helixAdminApi.listJavCorrectionWork).toHaveBeenCalledWith(undefined,'correction-1'));
});
it('cancels only from the interaction cell with explicit consent and retains the key on a network retry',async()=>{
  const cancel=vi.spyOn(helixAdminApi,'cancelJavCorrection').mockRejectedValueOnce(new Error('private')).mockResolvedValue({state:'cancelled',stateRevision:3,cancelledAtMs:30,replayed:false});
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);await screen.findByText('Example film');
  fireEvent.click(screen.getByRole('button',{name:'取消纠正'}));expect(screen.getByRole('button',{name:'确认取消'})).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认取消'}));await screen.findByText('取消未完成，请重试。');
  expect(screen.queryByText('private')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'确认取消'}));
  await waitFor(()=>expect(cancel).toHaveBeenCalledTimes(2));expect(cancel.mock.calls[1]).toEqual(cancel.mock.calls[0]);
});
it('locates an exact correction from Collection without enumerating unrelated work',async()=>{
  render(<MemoryRouter initialEntries={['/formation?correctionId=correction-1']}><App/></MemoryRouter>);await screen.findByText('Example film');
  expect(helixAdminApi.listJavCorrectionWork).toHaveBeenCalledWith(undefined,'correction-1',expect.any(Object));
  expect(helixAdminApi.listCareWork).not.toHaveBeenCalled();expect(helixAdminApi.listFormation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'显示全部任务'}));await waitFor(()=>expect(helixAdminApi.listCareWork).toHaveBeenCalled());
});
it('invalidates cancellation consent after a stale command and refreshes actual eligibility',async()=>{
  vi.spyOn(helixAdminApi,'cancelJavCorrection').mockRejectedValue(new AdminApiError(409,'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN','private'));
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);await screen.findByText('Example film');
  fireEvent.click(screen.getByRole('button',{name:'取消纠正'}));fireEvent.click(screen.getByRole('checkbox'));
  vi.mocked(helixAdminApi.listJavCorrectionWork).mockResolvedValue({items:[{...item,cancellation:{available:false,reasonCode:'no_effect_unproven'}}],counts:{attention_required:1},nextCursor:null});
  fireEvent.click(screen.getByRole('button',{name:'确认取消'}));await screen.findByText('当前状态已变化，请刷新任务。');
  await waitFor(()=>expect(screen.queryByRole('button',{name:'取消纠正'})).not.toBeInTheDocument());expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('blocks duplicate cancellation while the command is pending',async()=>{
  let finish!:(value:{state:'cancelled';stateRevision:number;cancelledAtMs:number;replayed:boolean})=>void;
  const cancel=vi.spyOn(helixAdminApi,'cancelJavCorrection').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);await screen.findByText('Example film');
  fireEvent.click(screen.getByRole('button',{name:'取消纠正'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认取消'}));
  expect(screen.getByRole('button',{name:'正在取消…'})).toBeDisabled();expect(screen.getByRole('checkbox')).toBeDisabled();expect(screen.getByRole('button',{name:'返回'})).toBeDisabled();expect(cancel).toHaveBeenCalledTimes(1);
  finish({state:'cancelled',stateRevision:3,cancelledAtMs:30,replayed:false});await waitFor(()=>expect(screen.queryByRole('button',{name:'正在取消…'})).not.toBeInTheDocument());
});
it('continues the same correction from the interaction cell with consequence consent and one key across a network retry',async()=>{
  const recovering={...item,recovery:{available:true,mode:'continue_correction' as const,previousIntentDigest:'previous-intent'}},
    reply={correctionId:item.correctionId,shelfEntryId:item.shelfEntryId,state:'active' as const,stateRevision:4,admissionDigest:item.admissionDigest,cleanupState:null,recoveryIntentDigest:'new-intent',updatedAtMs:30,replayed:false},
    recover=vi.spyOn(helixAdminApi,'recoverJavCorrection').mockRejectedValueOnce(new Error('private details')).mockResolvedValue(reply);
  vi.mocked(helixAdminApi.listJavCorrectionWork).mockResolvedValue({items:[recovering],counts:{attention_required:1},nextCursor:null});
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);await screen.findByText('Example film');
  const row=screen.getByText('Example film').closest('tr')!;expect(within(row.children[6] as HTMLElement).getByRole('button',{name:'继续纠正'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'继续纠正'}));expect(screen.getByRole('button',{name:'继续纠正'})).toBeDisabled();
  expect(screen.queryByRole('button',{name:'取消纠正'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox',{name:'继续按已确认的番号更新资料和文件位置，保留视频。'}));fireEvent.click(screen.getByRole('button',{name:'继续纠正'}));
  await screen.findByText('尚未确认继续请求，请重试。');expect(screen.queryByText('private details')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'继续纠正'}));await waitFor(()=>expect(recover).toHaveBeenCalledTimes(2));
  expect(recover.mock.calls[1]).toEqual(recover.mock.calls[0]);expect(recover.mock.calls[0][1].recovery.previousIntentDigest).toBe('previous-intent');
});
it('shows cleanup recovery after identity commit and keeps both recovery and cancel out of read-only details',async()=>{
  const recovering={...item,state:'committed' as const,cleanupState:'attention_required' as const,cancellation:{available:false,reasonCode:'not_attention_required' as const},
    recovery:{available:true,mode:'continue_cleanup' as const,previousIntentDigest:null}};
  vi.mocked(helixAdminApi.listJavCorrectionWork).mockResolvedValue({items:[recovering],counts:{attention_required:1},nextCursor:null});
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);await screen.findByText('Example film');
  expect(screen.getByText('身份已更新 · 清理需要处理')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'查看过程'}));
  const dialog=screen.getByRole('dialog');expect(within(dialog).queryByRole('button',{name:'继续清理'})).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button',{name:'关闭媒体整理过程卡片'}));fireEvent.click(screen.getByRole('button',{name:'继续清理'}));
  expect(screen.getByRole('checkbox',{name:'继续清理本次纠正的旧资料和临时文件，保留当前影片和视频。'})).toBeVisible();
});
it('reports exact conflicting files and clears recovery consent without claiming that the identity changed',async()=>{
  const recovering={...item,recovery:{available:true,mode:'continue_correction' as const,previousIntentDigest:null}};
  vi.mocked(helixAdminApi.listJavCorrectionWork).mockResolvedValue({items:[recovering],counts:{attention_required:1},nextCursor:null});
  vi.spyOn(helixAdminApi,'recoverJavCorrection').mockRejectedValue(new AdminApiError(409,'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN','private',{reasonCode:'file_changed',locations:['E:/Shelf/poster.jpg']}));
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);await screen.findByText('Example film');fireEvent.click(screen.getByRole('button',{name:'继续纠正'}));
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'继续纠正'}));
  await screen.findByText('文件与处理记录不一致，请核对后重试。');expect(screen.getByText('E:/Shelf/poster.jpg')).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.getByText('纠正需要处理')).toBeVisible();
});
