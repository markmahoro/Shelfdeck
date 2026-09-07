import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { helixAdminApi } from '../src/helix/api';

afterEach(()=>vi.restoreAllMocks());

it('shows a queued Aftercare Case in the existing work table and loads history only on demand',async()=>{
  const summary={totalCount:0,inProgressCount:0,attentionRequiredCount:0,completedCount:0};
  const projection={status:'ready' as const,asOfMs:100};
  const formation=vi.spyOn(helixAdminApi,'listFormation').mockResolvedValue({items:[],summary,nextCursor:'next',projection});
  const history=vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:'more-history',projection});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
  vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[{
    aftercareCaseId:'case-1',shelfEntryId:'entry-1',displayIdentity:'Aftercare Movie',targetShelfId:'shelf-1',targetShelfName:'Films',
    state:'queued',classification:'queued',goals:['video_codec_unmet'],createdAtMs:100,terminalAtMs:null,reasonCode:null,progress:null,
  }],counts:{queued:1},nextCursor:null});
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);
  expect(await screen.findByText('Aftercare Movie')).toBeInTheDocument();
  expect(screen.getByText('排队中，等待改善席位')).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:'加载更多整理记录'})).toBeInTheDocument());
  expect(formation).toHaveBeenCalledTimes(2);
  expect(history).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'查看过程'}));
  expect(await screen.findByRole('dialog')).toHaveTextContent('调整视频编码');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'加载更多整理记录'}));
  await waitFor(()=>expect(history).toHaveBeenCalledWith('more-history'));
});
