import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import RuntimeControls from '../src/helix/RuntimeControls';
import {SessionProvider} from '../src/helix/session';
import {helixAdminApi,type RuntimeStatus,type FormationResetPreview} from '../src/helix/api';

const stopped:RuntimeStatus={maintenance:{maintenanceActive:false,phase:null,currentTask:null,windowEndAtMs:null},mode:'stopped',desiredMode:'stopped',revision:1,normalSupplyAllowed:false,
  activity:{inFlightEvents:0,inFlightRecoveries:0,inFlightOwnerReconciliations:0},operation:null,error:null,recoveryBackup:null};
const preview:FormationResetPreview={previewDigest:'a'.repeat(64),ready:true,contractVersion:'shelfdeck.fresh-formation-reset@1',runtimeRevision:1,
  counts:[{table:'proc_candidate_packages',retained:8,removed:1},{table:'libra_runs',retained:8,removed:1}],protectedSummary:{collectionCount:8},
  expectedReleasedBytes:'1073741824',blockers:[],volumeBudget:{volumes:[{device:'test-volume',requiredBytes:'2147483648',availableBytes:'4294967296',sufficient:true,
    allocations:[{directory:'/isolated/operations',purpose:'reset',bytes:'2147483648'}]}]}};
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
  await screen.findByText(/将清除 1 个/);expect(screen.getByRole('button',{name:'确认重置'})).toBeDisabled();
  expect(screen.getByText(/保留 8 条当前及历史收藏/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('确认词'),{target:{value:'重置工作台'}});
  fireEvent.click(screen.getByRole('button',{name:'确认重置'}));
  await screen.findByText('已重置工作台，服务保持停机。');expect(reset).toHaveBeenCalledWith(preview.previewDigest,expect.any(String));
  expect(screen.getByRole('button',{name:'恢复运行'})).toBeEnabled();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(invalidated).toHaveBeenCalledWith({queryKey:['overview']});
  await client.refetchQueries({queryKey:['runtime-operations']});expect(invalidated).toHaveBeenCalledTimes(1);
});

it('shows blockers even when the selected list is empty',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue({...preview,counts:null,protectedSummary:null,ready:false,blockers:[{code:'uncertain',message:'存在尚未确认的文件操作，不能清除。'}]});
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
  vi.spyOn(helixAdminApi,'previewFormationReset').mockReturnValueOnce(new Promise(resolve=>{release=resolve;})).mockResolvedValueOnce({...preview,counts:preview.counts!.map(row=>({...row,removed:2}))});
  show();await screen.findByText('已安全停机');fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));
  fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));
  await screen.findByText(/将清除 2 个/);release(preview);await waitFor(()=>expect(screen.queryByText(/将清除 1 个/)).not.toBeInTheDocument());
});

it('invalidates an open confirmation when another session resumes and stops the service',async()=>{
  const read=vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  const inspect=vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue(preview);
  const reset=vi.spyOn(helixAdminApi,'resetFormation');const client=show();await screen.findByText('已安全停机');
  fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));await screen.findByText(/将清除 1 个/);fireEvent.change(screen.getByLabelText('确认词'),{target:{value:'重置工作台'}});
  read.mockResolvedValue({...stopped,mode:'running',revision:2,normalSupplyAllowed:true});await client.refetchQueries({queryKey:['runtime-operations']});
  await waitFor(()=>expect(screen.getByRole('button',{name:'确认重置'})).toBeDisabled());expect(screen.getByLabelText('确认词')).toBeDisabled();
  read.mockResolvedValue({...stopped,revision:3});await client.refetchQueries({queryKey:['runtime-operations']});
  await screen.findByText('运行状态已变化，请重新核对清单。');expect(screen.getByRole('button',{name:'确认重置'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重新核对'}));await waitFor(()=>expect(inspect).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.getByLabelText('确认词')).toBeEnabled());expect(screen.getByLabelText('确认词')).toHaveValue('');expect(reset).not.toHaveBeenCalled();
});

it('shows uncomputed scope and the insufficient volume without enabling confirmation',async()=>{
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue(stopped);
  vi.spyOn(helixAdminApi,'previewFormationReset').mockResolvedValue({...preview,ready:false,counts:null,protectedSummary:null,expectedReleasedBytes:null,
    selectionStatus:'not_evaluated',blockers:[{code:'RESET_OPERATOR_SPACE_INSUFFICIENT'}],volumeBudget:{volumes:[{...preview.volumeBudget.volumes[0],availableBytes:'1073741824',sufficient:false}]}});
  show();await screen.findByText('已安全停机');fireEvent.click(screen.getByRole('button',{name:'重置工作台'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('作业空间不足');
  expect(screen.getByLabelText('各卷空间预算')).toHaveTextContent('需要 2 GiB · 可用 1 GiB · 空间不足');
  expect(screen.queryByLabelText('确认词')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'确认重置'})).toBeDisabled();
  expect(screen.queryByText(/保留 0 条/)).not.toBeInTheDocument();
});

it('retries only the previously confirmed cold request and does not offer Resume',async()=>{
  const resetRetry={previewDigest:preview.previewDigest,idempotencyKey:'original-request',confirmed:true as const};
  vi.spyOn(helixAdminApi,'getRuntimeStatus').mockResolvedValue({...stopped,mode:'error',resetStage:'closed',resetRetry,recoveryBackup:'backup',error:{code:'RESET_TEST_INTERRUPTION',message:'重置未完成'}});
  const reset=vi.spyOn(helixAdminApi,'resetFormation').mockResolvedValue({operationId:'original',kind:'reset',state:'pending'});
  show();fireEvent.click(await screen.findByRole('button',{name:'继续本次重置'}));
  await waitFor(()=>expect(reset).toHaveBeenCalledWith(preview.previewDigest,'original-request'));
  expect(screen.queryByRole('button',{name:'恢复运行'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'重置工作台'})).not.toBeInTheDocument();
});
