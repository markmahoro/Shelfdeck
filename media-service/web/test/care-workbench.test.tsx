import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
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
  await waitFor(()=>expect(screen.getByRole('button',{name:'加载更多整理记录'})).toBeInTheDocument());
  expect(formation).toHaveBeenCalledTimes(2);
  expect(history).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'查看过程'}));
  expect(await screen.findByRole('dialog')).toHaveTextContent('调整视频编码');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'加载更多整理记录'}));
  await waitFor(()=>expect(history).toHaveBeenCalledWith('more-history'));
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
