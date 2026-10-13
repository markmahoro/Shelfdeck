import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import RuntimeControls from '../src/helix/RuntimeControls';
import {SessionProvider} from '../src/helix/session';
import {helixAdminApi,type RuntimeStatus,type FormationResetPreview} from '../src/helix/api';

const stopped:RuntimeStatus={mode:'stopped',desiredMode:'stopped',revision:1,normalSupplyAllowed:false,
  activity:{inFlightEvents:0,inFlightRecoveries:0,inFlightOwnerReconciliations:0},operation:null,error:null,recoveryBackup:null};
const preview:FormationResetPreview={previewDigest:'a'.repeat(64),ready:true,empty:false,items:[{subjectId:'s',displayIdentity:'测试电影',contentProfile:'movie'}],
  counts:{subjects:1,runs:1,works:1,workspaces:1},protected:{collectionCount:8,endedRunCount:3},blockers:[]};
afterEach(()=>vi.restoreAllMocks());
function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  render(<QueryClientProvider client={client}><SessionProvider><RuntimeControls/></SessionProvider></QueryClientProvider>);return client;}

it('requires exact list confirmation and stays stopped after Reset completes',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue(preview);
  const reset=vi.spyOn(helixAdminApi,'resetFormation').mockImplementation(async()=>{
    vi.mocked(helixAdminApi.getRuntimeStatus).mockResolvedValue({...stopped,operation:{operationId:'reset',kind:'reset',state:'completed',result:{removedSubjects:1}}});
    return {operationId:'reset',kind:'reset',state:'pending'};});
  show();await screen.findByText('已安全停机');fireEvent.click(screen.getByRole('button',{name:'Reset 整理任务'}));
  await screen.findByText('测试电影');expect(screen.getByRole('button',{name:'确认 Reset'})).toBeDisabled();
  expect(screen.getByText(/保留 8 条收藏/)).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确认 Reset'}));
  await screen.findByText('已清理 1 项整理，服务保持停机。');expect(reset).toHaveBeenCalledWith(preview.previewDigest,expect.any(String));
  expect(screen.getByRole('button',{name:'恢复运行'})).toBeEnabled();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('shows blockers even when the selected list is empty',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue({...preview,empty:true,ready:false,items:[],blockers:[{code:'uncertain',message:'存在尚未确认的文件操作，不能清除。'}]});
  show();await screen.findByText('已安全停机');fireEvent.click(screen.getByRole('button',{name:'Reset 整理任务'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('存在尚未确认的文件操作');expect(screen.getByRole('button',{name:'确认 Reset'})).toBeDisabled();
});

it('disables commands when a previously known status can no longer be read',async()=>{
  const read=vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);const client=show();await screen.findByText('已安全停机');
  read.mockRejectedValue(new Error('offline'));await client.refetchQueries({queryKey:['runtime-operations']});
  await waitFor(()=>expect(screen.getByRole('button',{name:'恢复运行'})).toBeDisabled());
  expect(screen.getByRole('button',{name:'Reset 整理任务'})).toBeDisabled();expect(screen.getByRole('button',{name:'重试读取'})).toBeEnabled();
});

it('does not apply a late preview to a reopened confirmation dialog',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  let release!:(value:FormationResetPreview)=>void;
  vi.spyOn(helixAdminApi,'previewFormationReset').mockReturnValueOnce(new Promise(resolve=>{release=resolve;})).mockResolvedValueOnce({...preview,items:[{...preview.items[0],displayIdentity:'新清单'}]});
  show();await screen.findByText('已安全停机');fireEvent.click(screen.getByRole('button',{name:'Reset 整理任务'}));
  fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'Reset 整理任务'}));
  await screen.findByText('新清单');release(preview);await waitFor(()=>expect(screen.queryByText('测试电影')).not.toBeInTheDocument());
});

it('invalidates an open confirmation when another session resumes and stops the service',async()=>{
  const read=vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  const inspect=vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue(preview);
  const reset=vi.spyOn(helixAdminApi,'resetFormation');const client=show();await screen.findByText('已安全停机');
  fireEvent.click(screen.getByRole('button',{name:'Reset 整理任务'}));await screen.findByText('测试电影');fireEvent.click(screen.getByRole('checkbox'));
  read.mockResolvedValue({...stopped,mode:'running',revision:2,normalSupplyAllowed:true});await client.refetchQueries({queryKey:['runtime-operations']});
  await waitFor(()=>expect(screen.getByRole('button',{name:'确认 Reset'})).toBeDisabled());expect(screen.getByRole('checkbox')).toBeDisabled();
  read.mockResolvedValue({...stopped,revision:3});await client.refetchQueries({queryKey:['runtime-operations']});
  await screen.findByText('运行状态已变化，请重新核对清单。');expect(screen.getByRole('button',{name:'确认 Reset'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重新核对'}));await waitFor(()=>expect(inspect).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.getByRole('checkbox')).toBeEnabled());expect(screen.getByRole('checkbox')).not.toBeChecked();expect(reset).not.toHaveBeenCalled();
});
