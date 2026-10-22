import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import RuntimeControls from '../src/helix/RuntimeControls';
import {SessionProvider} from '../src/helix/session';
import {helixAdminApi,type RuntimeStatus,type FormationResetPreview} from '../src/helix/api';

const stopped:RuntimeStatus={maintenance:{maintenanceActive:false,phase:null,currentTask:null,windowEndAtMs:null},mode:'stopped',desiredMode:'stopped',revision:1,normalSupplyAllowed:false,
  activity:{inFlightEvents:0,inFlightRecoveries:0,inFlightOwnerReconciliations:0},operation:null,error:null,recoveryBackup:null};
const preview:FormationResetPreview={previewDigest:'a'.repeat(64),ready:true,empty:false,items:[{subjectId:'s',displayIdentity:'测试电影',contentProfile:'movie'}],
  counts:{subjects:1,runs:1,works:1,workspaces:1},protected:{collectionCount:8,endedRunCount:3},blockers:[]};
afterEach(()=>vi.restoreAllMocks());
function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  render(<QueryClientProvider client={client}><SessionProvider><RuntimeControls/></SessionProvider></QueryClientProvider>);return client;}

it('shows maintenance and the executing task while keeping operator stop available',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue({...stopped,mode:'running',desiredMode:'running',
    maintenance:{maintenanceActive:true,phase:'maintaining',currentTask:'检查收藏健康',windowEndAtMs:1}});
  const resume=vi.spyOn(helixAdminApi,'resumeRuntime');
  show();
  expect(await screen.findByText('维护中')).toBeVisible();
  expect(screen.getByText('检查收藏健康')).toBeVisible();
  expect(screen.getByRole('button',{name:'安全停机'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'重置工作台'})).toBeDisabled();
  expect(screen.queryByText(/维护结果|维护历史|完成数量/)).not.toBeInTheDocument();
  expect(resume).not.toHaveBeenCalled();
});

it('requires the reset confirmation phrase and stays stopped after Reset completes',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue(preview);
  const reset=vi.spyOn(helixAdminApi,'resetFormation').mockImplementation(async()=>{
    vi.mocked(helixAdminApi.getRuntimeStatus).mockResolvedValue({...stopped,operation:{operationId:'reset',kind:'reset',state:'completed',result:{retiredSubjects:1}}});
    return {operationId:'reset',kind:'reset',state:'pending'};});
  const client=show(),invalidated=vi.spyOn(client,'invalidateQueries');
  await screen.findByText('已安全停机');fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));
  await screen.findByText(/将结束 1 项/);expect(screen.getByRole('button',{name:'确认重置'})).toBeDisabled();
  expect(screen.getByText(/保留 8 条收藏/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('确认词'),{target:{value:'重置工作台'}});
  fireEvent.click(screen.getByRole('button',{name:'确认重置'}));
  await screen.findByText('已重置工作台，服务保持停机。');expect(reset).toHaveBeenCalledWith(preview.previewDigest,expect.any(String));
  expect(screen.getByRole('button',{name:'恢复运行'})).toBeEnabled();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(invalidated).toHaveBeenCalledWith({queryKey:['overview']});
  await client.refetchQueries({queryKey:['runtime-operations']});expect(invalidated).toHaveBeenCalledTimes(1);
});

it('shows blockers even when the selected list is empty',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue({...preview,empty:true,ready:false,items:[],blockers:[{code:'uncertain',message:'存在尚未确认的文件操作，不能清除。'}]});
  show();await screen.findByText('已安全停机');fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('存在尚未确认的文件操作');expect(screen.getByRole('button',{name:'确认重置'})).toBeDisabled();
});

it('disables commands when a previously known status can no longer be read',async()=>{
  const read=vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);const client=show();await screen.findByText('已安全停机');
  read.mockRejectedValue(new Error('offline'));await client.refetchQueries({queryKey:['runtime-operations']});
  await waitFor(()=>expect(screen.getByRole('button',{name:'恢复运行'})).toBeDisabled());
  expect(screen.getByRole('button',{name:'重置工作台'})).toBeDisabled();expect(screen.getByRole('button',{name:'重试读取'})).toBeEnabled();
});

it('does not apply a late preview to a reopened confirmation dialog',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  let release!:(value:FormationResetPreview)=>void;
  vi.spyOn(helixAdminApi,'previewFormationReset').mockReturnValueOnce(new Promise(resolve=>{release=resolve;})).mockResolvedValueOnce({...preview,counts:{...preview.counts,subjects:2}});
  show();await screen.findByText('已安全停机');fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));
  fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));
  await screen.findByText(/将结束 2 项/);release(preview);await waitFor(()=>expect(screen.queryByText(/将结束 1 项/)).not.toBeInTheDocument());
});

it('invalidates an open confirmation when another session resumes and stops the service',async()=>{
  const read=vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  const inspect=vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue(preview);
  const reset=vi.spyOn(helixAdminApi,'resetFormation');const client=show();await screen.findByText('已安全停机');
  fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));await screen.findByText(/将结束 1 项/);fireEvent.change(screen.getByLabelText('确认词'),{target:{value:'重置工作台'}});
  read.mockResolvedValue({...stopped,mode:'running',revision:2,normalSupplyAllowed:true});await client.refetchQueries({queryKey:['runtime-operations']});
  await waitFor(()=>expect(screen.getByRole('button',{name:'确认重置'})).toBeDisabled());expect(screen.getByLabelText('确认词')).toBeDisabled();
  read.mockResolvedValue({...stopped,revision:3});await client.refetchQueries({queryKey:['runtime-operations']});
  await screen.findByText('运行状态已变化，请重新核对清单。');expect(screen.getByRole('button',{name:'确认重置'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重新核对'}));await waitFor(()=>expect(inspect).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.getByLabelText('确认词')).toBeEnabled());expect(screen.getByLabelText('确认词')).toHaveValue('');expect(reset).not.toHaveBeenCalled();
});
