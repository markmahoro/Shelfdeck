import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MaterialFieldsPage from '../src/helix/MaterialFieldsPage';
import { helixAdminApi, type MaterialField, type ProcurementJourneyResult } from '../src/helix/api';

const { expire } = vi.hoisted(() => ({ expire:vi.fn() }));
vi.mock('../src/helix/session', () => ({ useSession: () => ({ expire }), isUnauthorized: () => false }));
vi.mock('../src/helix/RoutingPolicyPanel', () => ({ default: () => null }));
afterEach(() => vi.restoreAllMocks());

function field(): MaterialField {
  return {fieldId:'field-1',name:'电影来源',status:'active',extractionPolicyId:'policy',extractionPolicyRevision:1,
    currentAccessRevision:1,currentObservationRevision:60,currentProfileHintSnapshot:{revision:1,contentProfileHint:'movie'},
    access:{endpointId:'endpoint',rootLocation:'/media/Film',mountScopeId:'mount',mountScopeRevision:1},
    policy:{policy:{includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]}},
    procurementStatus:{stage:'not_started',observationScan:{state:'failed',pageCount:60,observationRevision:60,inProgress:false,failureMessage:'扫描超时'},
      runCount:0,activeRunCount:0,sealedRunCount:0,generatedPackageCount:0,acceptedPackageCount:0,waitingAcceptanceCount:0,rejectedPackageCount:0}};
}
function mount(current: {value:MaterialField}) {
  vi.spyOn(helixAdminApi,'listMaterialFields').mockImplementation(async()=>({items:[current.value]}));
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
  vi.spyOn(helixAdminApi,'getFieldIntakeAdmission').mockResolvedValue({fieldId:'field-1',predeckPipelineSeats:0,policyRevision:1,updatedAtMs:1,pipelineTokensHeld:0,pipelineSeatsFree:0});
  return render(<MemoryRouter><MaterialFieldsPage/></MemoryRouter>);
}
const accepted={observation:{observationWorkId:'scan-new',fieldId:'field-1',state:'admitted',replayed:false,
  operationRef:{operationType:'field_observation',operationId:'scan-new'}}} as ProcurementJourneyResult;

it('registers Series with retry state and duplicate submission protection', async()=>{
  vi.spyOn(helixAdminApi,'listMaterialFields').mockResolvedValue({items:[]});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
  const register=vi.spyOn(helixAdminApi,'registerMaterialField').mockRejectedValueOnce(new Error('目录不可访问'));
  render(<MemoryRouter><MaterialFieldsPage/></MemoryRouter>);
  const profile=await screen.findByLabelText('媒体类型');
  expect(profile).toHaveValue('movie');
  fireEvent.change(profile,{target:{value:'series'}});
  fireEvent.change(screen.getByLabelText('来源名称'),{target:{value:'我的剧集'}});
  fireEvent.change(screen.getByLabelText('媒体目录'),{target:{value:'/media/Series'}});
  fireEvent.click(screen.getByRole('button',{name:'保存文件来源'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('目录不可访问');
  expect(profile).toHaveValue('series');
  expect(screen.getByLabelText('来源名称')).toHaveValue('我的剧集');
  let resolve!:(value:any)=>void;
  register.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const submit=screen.getByRole('button',{name:'保存文件来源'});
  act(()=>{fireEvent.click(submit);fireEvent.click(submit);});
  await waitFor(()=>expect(register).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button',{name:'正在保存…'})).toBeDisabled();
  expect(profile).toBeDisabled();
  expect(register.mock.calls[1][0]).toMatchObject({name:'我的剧集',contentProfileHint:'series',access:{rootLocation:'/media/Series'}});
  expect(register.mock.calls[1][0]).toEqual(register.mock.calls[0][0]);
  const saved=field();saved.name='我的剧集';saved.currentProfileHintSnapshot.contentProfileHint='series';
  vi.mocked(helixAdminApi.listMaterialFields).mockResolvedValue({items:[saved]});
  await act(async()=>resolve({}));
  expect(await screen.findByRole('heading',{name:'我的剧集'})).toBeVisible();
  expect(screen.getByText('剧集',{exact:true})).toBeVisible();
  expect(screen.queryByLabelText('媒体类型')).not.toBeInTheDocument();
});

it('keeps one failed state and the rescan action when no specific reason is available',async()=>{
  const value=field();
  value.procurementStatus.observationScan!.failureMessage=undefined;
  mount({value});
  expect(await screen.findByRole('button',{name:'扫描新文件'})).toBeEnabled();
  expect(screen.getAllByText('扫描失败',{exact:true})).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('扫描失败');
});

it('retries an uncertain request with the same key, then gives a new action a new key',async()=>{
  const current={value:field()};
  const scan=vi.spyOn(helixAdminApi,'observeMaterialField').mockRejectedValueOnce(new TypeError('连接中断')).mockResolvedValue(accepted);
  mount(current);fireEvent.click(await screen.findByRole('button',{name:'扫描新文件'}));
  expect(await screen.findByText('连接中断')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'扫描新文件'}));
  await waitFor(()=>expect(screen.queryByText('连接中断')).not.toBeInTheDocument());
  expect(scan.mock.calls[1][1]).toBe(scan.mock.calls[0][1]);
  fireEvent.click(screen.getByRole('button',{name:'扫描新文件'}));
  await waitFor(()=>expect(scan).toHaveBeenCalledTimes(3));
  expect(scan.mock.calls[2][1]).not.toBe(scan.mock.calls[0][1]);
});

it('blocks duplicate clicks and drops the old failure when the new scan is running or complete',async()=>{
  const current={value:field()};let resolve!:(result:ProcurementJourneyResult)=>void;
  const scan=vi.spyOn(helixAdminApi,'observeMaterialField').mockImplementation(()=>new Promise(r=>{resolve=r;}));
  mount(current);const button=await screen.findByRole('button',{name:'扫描新文件'});
  expect(screen.getAllByText('扫描超时')).toHaveLength(1);
  act(()=>{fireEvent.click(button);fireEvent.click(button);});expect(scan).toHaveBeenCalledTimes(1);
  current.value={...current.value,procurementStatus:{...current.value.procurementStatus,
    observationScan:{state:'scanning',pageCount:0,observationRevision:60,inProgress:true}}};
  await act(async()=>resolve(accepted));await waitFor(()=>expect(screen.queryByText('扫描超时')).not.toBeInTheDocument());
  expect(screen.getByRole('button',{name:'扫描新文件'})).toBeDisabled();
  current.value={...current.value,procurementStatus:{...current.value.procurementStatus,
    observationScan:{state:'completed',pageCount:2,observationRevision:62,inProgress:false}}};
  fireEvent.click(screen.getByRole('button',{name:'刷新'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'扫描新文件'})).toBeEnabled());
  expect(screen.queryByText('扫描超时')).not.toBeInTheDocument();
});

it('uses distinct keys for new manual scans with unchanged revisions and preserves an explicit retry key',async()=>{
  const bodies:Array<{idempotencyKey:string}>=[];
  vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify(accepted));});
  await helixAdminApi.observeMaterialField(field());await helixAdminApi.observeMaterialField(field());
  expect(bodies[0].idempotencyKey).not.toBe(bodies[1].idempotencyKey);
  await helixAdminApi.observeMaterialField(field(),'same-request');await helixAdminApi.observeMaterialField(field(),'same-request');
  expect(bodies[2].idempotencyKey).toBe(bodies[3].idempotencyKey);
});
