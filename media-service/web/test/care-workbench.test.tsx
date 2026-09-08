import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { CareWorkDetail } from '../src/helix/CareWorkRow';
import { helixAdminApi } from '../src/helix/api';

afterEach(()=>vi.restoreAllMocks());

it('renders current work before slow historical and configuration requests finish',async()=>{
  const summary={totalCount:0,inProgressCount:0,attentionRequiredCount:0,completedCount:0};
  const projection={status:'ready' as const,asOfMs:100};
  vi.spyOn(helixAdminApi,'listFormation').mockImplementation(section=>section==='active'
    ?Promise.resolve({items:[],summary,nextCursor:null,projection}):new Promise(()=>{}));
  vi.spyOn(helixAdminApi,'listFormationHistory').mockImplementation(()=>new Promise(()=>{}));
  vi.spyOn(helixAdminApi,'listShelves').mockImplementation(()=>new Promise(()=>{}));
  vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockImplementation(()=>new Promise(()=>{}));
  vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[],counts:{},nextCursor:null});
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);
  expect(await screen.findByRole('table')).toBeInTheDocument();
  expect(screen.queryByText('正在读取媒体整理工作区…')).not.toBeInTheDocument();
  expect(screen.getByLabelText('按片名筛选')).toBeEnabled();
});

it('shows an admitted Aftercare Case in the existing work table and loads history only on demand',async()=>{
  const summary={totalCount:0,inProgressCount:0,attentionRequiredCount:0,completedCount:0};
  const projection={status:'ready' as const,asOfMs:100};
  const formation=vi.spyOn(helixAdminApi,'listFormation').mockResolvedValue({items:[],summary,nextCursor:'next',projection});
  const history=vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:'more-history',projection});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
  vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[{
    aftercareCaseId:'case-1',shelfEntryId:'entry-1',displayIdentity:'Aftercare Movie',targetShelfId:'shelf-1',targetShelfName:'Films',
    state:'active',classification:'in_progress',goals:['video_codec_unmet'],createdAtMs:100,terminalAtMs:null,reasonCode:null,progress:null,
  }],counts:{in_progress:1},nextCursor:null});
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);
  expect(await screen.findByText('Aftercare Movie')).toBeInTheDocument();
  expect(screen.getByText('维护任务')).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:'下一页'})).toBeEnabled());
  expect(formation).toHaveBeenCalledTimes(2);
  expect(history).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'查看过程'}));
  expect(await screen.findByRole('dialog')).toHaveTextContent('调整视频编码');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'下一页'}));
  await waitFor(()=>expect(history).toHaveBeenCalledWith('more-history',{q:'',shelfId:''}));
});

it('shows maintenance detail request failures inside the open dialog',async()=>{
  const summary={totalCount:0,inProgressCount:0,attentionRequiredCount:0,completedCount:0};
  const projection={status:'ready' as const,asOfMs:100};
  vi.spyOn(helixAdminApi,'listFormation').mockResolvedValue({items:[],summary,nextCursor:null,projection});
  vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
  vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi,'listCareWork').mockImplementation((_cursor,caseId)=>caseId?Promise.reject(new Error('unavailable')):Promise.resolve({items:[{
    aftercareCaseId:'case-error',shelfEntryId:'entry-error',displayIdentity:'Detail Error Movie',targetShelfId:'shelf',targetShelfName:'Films',
    state:'active',classification:'in_progress',goals:['video_codec_unmet'],createdAtMs:100,terminalAtMs:null,reasonCode:null,progress:null,
  }],counts:{in_progress:1},nextCursor:null}));
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'查看过程'}));
  await waitFor(()=>expect(screen.getByRole('dialog')).toHaveTextContent('维护过程读取失败，请重新打开详情。'));
  expect(screen.queryByText('正在读取维护计划…')).not.toBeInTheDocument();
});


it('keeps failed historical care out of attention and combines terminal outcomes without hiding their results',async()=>{
  const summary={totalCount:0,inProgressCount:0,attentionRequiredCount:0,completedCount:0};
  const projection={status:'ready' as const,asOfMs:100};
  vi.spyOn(helixAdminApi,'listFormation').mockResolvedValue({items:[],summary,nextCursor:null,projection});
  vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
  vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  const failed={aftercareCaseId:'failed',shelfEntryId:'hobbit',displayIdentity:'霍比特人1',targetShelfId:'shelf',targetShelfName:'电影',
    state:'unresolved',classification:'ended' as const,goals:['conformance:max_size_exceeded'],createdAtMs:100,terminalAtMs:200,
    reasonCode:'settlement_or_commit_failed',progress:null,currentHealth:{state:'healthy' as const,healthState:'healthy' as const},
    caseEvidence:{inventoryRevision:1,standardRevision:1,originalPrimaryBytes:11666913036,currentInventoryRevision:2,currentPrimaryBytes:4027793937},
    processDetail:{contract:'aftercare_process_actual_plans@1' as const,stages:[]}};
  vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[failed,{...failed,aftercareCaseId:'success',displayIdentity:'成功影片',state:'resolved',classification:'completed',reasonCode:'reassessed_healthy',currentHealth:{state:'attention_required',healthState:'unhealthy',maintenanceState:'none'}}],counts:{ended:1,completed:1},nextCursor:null});
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);
  await screen.findByText('霍比特人1');
  expect(screen.queryByRole('button',{name:/^已完成/})).not.toBeInTheDocument();
  expect(screen.queryByText('回收站')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'需要处理 0'}));
  expect(screen.queryByText('霍比特人1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'已结束 2'}));
  const row=screen.getByText('霍比特人1').closest('tr')!;
  expect(row).toHaveTextContent('已结束 · 未解决');
  expect(row).toHaveTextContent('当前收藏健康');
  expect(screen.getByText('成功影片').closest('tr')).toHaveTextContent('维护完成');
  fireEvent.click(within(row).getByRole('button',{name:'查看过程'}));
  const dialog=await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('建单时影片体积超过当时适用的收藏上限');
  expect(dialog).toHaveTextContent('10.87 GiB');
  expect(dialog).toHaveTextContent('3.75 GiB');
  expect(dialog).toHaveTextContent('旧文件收尾或收藏提交失败');
  expect(dialog).toHaveTextContent('建单记录未保存具体体积上限');
  fireEvent.click(screen.getByRole('button',{name:'关闭媒体整理过程卡片'}));
  const unhealthy=screen.getByText('成功影片').closest('tr')!;
  expect(unhealthy).toHaveTextContent('当前仍有问题');
  expect(within(unhealthy).getByRole('link',{name:'收藏健康'})).toHaveAttribute('href','/collection');
  fireEvent.click(within(unhealthy).getByRole('button',{name:'查看过程'}));
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前问题仍保留');
});


it('centralizes recycle history and exact film directory previews in settings',async()=>{
  vi.spyOn(helixAdminApi,'getIntegration').mockResolvedValue({kind:'douban',supported:true,configured:false,state:'idle',configRevision:0,
    endpoint:null,configDigest:null,capabilityCodes:[],lastTestSummary:null,landingBinding:null});
  const records=vi.spyOn(helixAdminApi,'listRecycle').mockResolvedValue({items:[]});
  const preview=vi.spyOn(helixAdminApi,'previewRecycle').mockResolvedValue({items:[]});
  const archive=vi.spyOn(helixAdminApi,'archiveRecycle');
  const restore=vi.spyOn(helixAdminApi,'restoreRecycle');
  vi.spyOn(helixAdminApi,'listCollection').mockResolvedValue({items:[{shelfEntryId:'hobbit',displayIdentity:'霍比特人1'} as never],nextCursor:null});
  render(<MemoryRouter initialEntries={['/settings']}><App/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab',{name:'回收站'}));
  expect(screen.getByRole('heading',{name:'回收站'})).toBeInTheDocument();
  await waitFor(()=>expect(records).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button',{name:'读取收藏列表'}));
  await screen.findByRole('option',{name:'霍比特人1'});
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'hobbit'}});
  const panel=screen.getByText('旧目录与回收站').closest('details')!;
  panel.open=true;fireEvent(panel,new Event('toggle',{bubbles:true}));
  await waitFor(()=>expect(preview).toHaveBeenCalledWith('hobbit'));
  expect(archive).not.toHaveBeenCalled();expect(restore).not.toHaveBeenCalled();
});

it('UAT-213 shows the frozen size target without claiming it is missing',()=>{
  render(<MemoryRouter><CareWorkDetail item={{aftercareCaseId:'snapshot',shelfEntryId:'entry',displayIdentity:'Movie',
    state:'resolved',classification:'completed',goals:['conformance:max_size_exceeded'],createdAtMs:100,terminalAtMs:200,reasonCode:null,progress:null,
    caseEvidence:{inventoryRevision:1,standardRevision:1,originalPrimaryBytes:2000,currentInventoryRevision:2,currentPrimaryBytes:900,
      objective:{requirements:{space:{maxSizeBytes:1073741824}},requirementsDigest:'a'.repeat(64)}},
    processDetail:{contract:'aftercare_process_actual_plans@1',stages:[]}}}/></MemoryRouter>);
  expect(screen.getByText(/当时目标：体积不超过 1.00 GiB/)).toBeInTheDocument();
  expect(screen.queryByText(/建单记录未保存具体体积上限/)).not.toBeInTheDocument();
});
