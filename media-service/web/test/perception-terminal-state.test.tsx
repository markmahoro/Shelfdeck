import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import App from '../src/App';
import RatingControl from '../src/helix/RatingControl';
import WatchedControl from '../src/helix/WatchedControl';
import {helixAdminApi,type FormationSubject} from '../src/helix/api';
import {mockRunningRuntime} from './fixtures/runtime';

afterEach(()=>vi.restoreAllMocks());
it('shows terminal Formation rating states without claiming matching is in progress',async()=>{
  mockRunningRuntime();
  const summary={totalCount:3,inProgressCount:3,attentionRequiredCount:0,completedCount:0,endedCount:0},projection={status:'ready' as const,asOfMs:100};
  const item=(id:string,state:'failed'|'cancelled'|'pending')=>({subjectId:id,displayIdentity:id,classification:'in_progress',status:'active',contentProfile:'movie',structureKind:'single',addedAtMs:1,currentRun:null,handoffB:null,productIdentityIssue:null,currentPlan:null,myRating:null,ratingState:state,targetShelfId:null,targetShelfName:null,organizingRequirement:'',routingState:'resolved',unresolvedReasonCode:null,nextAction:{label:'处理中',state:'running',progress:null}} as unknown as FormationSubject);
  const items=[item('失败影片','failed'),item('取消影片','cancelled'),item('等待影片','pending')];
  vi.spyOn(helixAdminApi,'listFormation').mockImplementation(section=>Promise.resolve({items:section==='active'?items:[],summary,nextCursor:null,projection}));
  vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[],counts:{},nextCursor:null});vi.spyOn(helixAdminApi,'listJavCorrectionWork').mockResolvedValue({items:[],counts:{},nextCursor:null});
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);
  const failed=(await screen.findByText('失败影片')).closest('tr') as HTMLTableRowElement,cancelled=screen.getByText('取消影片').closest('tr') as HTMLTableRowElement,pending=screen.getByText('等待影片').closest('tr') as HTMLTableRowElement;
  expect(within(failed).getByText('评分匹配失败')).toBeInTheDocument();expect(within(cancelled).getByText('评分匹配已取消')).toBeInTheDocument();
  expect(within(pending).getByText('正在匹配豆瓣评分')).toBeInTheDocument();expect(within(failed).queryByText('正在匹配豆瓣评分')).not.toBeInTheDocument();
});
it('waits for the accepted rating revision instead of treating an old failure as the new command outcome',async()=>{
  vi.spyOn(helixAdminApi,'rate').mockResolvedValue({operationRef:'rating',state:'accepted',expectedResultRevision:1});
  const read=vi.spyOn(helixAdminApi,'listPerceptionRecords').mockResolvedValueOnce({items:[],nextCursor:null,currentRating:{state:'failed',rating:null,sourceKind:null,expectedRevision:0}})
    .mockResolvedValue({items:[],nextCursor:null,currentRating:{state:'ready',rating:4,sourceKind:'shelfdeck_direct',expectedRevision:1}});
  render(<RatingControl targetType="subject" targetId="subject" label="影片" initialRating={null} initialRevision={0}/>);
  fireEvent.click(screen.getByRole('button',{name:'4星'}));await waitFor(()=>expect(screen.getByText('4 星 · 我的评分')).toBeInTheDocument());
  expect(read).toHaveBeenCalledTimes(2);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('reports failure for the accepted rating revision',async()=>{
  vi.spyOn(helixAdminApi,'rate').mockResolvedValue({operationRef:'rating',state:'accepted',expectedResultRevision:1});
  vi.spyOn(helixAdminApi,'listPerceptionRecords').mockResolvedValue({items:[],nextCursor:null,currentRating:{state:'failed',rating:null,sourceKind:null,expectedRevision:1}});
  render(<RatingControl targetType="subject" targetId="subject" label="影片" initialRating={null} initialRevision={0}/>);
  fireEvent.click(screen.getByRole('button',{name:'4星'}));expect(await screen.findByRole('alert')).toHaveTextContent('评分匹配失败。');
});
it('reports a cancelled watched Resolution without waiting for the polling timeout',async()=>{
  vi.spyOn(helixAdminApi,'listPerceptionRecords').mockResolvedValue({items:[],nextCursor:null,currentWatched:{state:'cancelled',watchedState:null,sourceKind:null,expectedRevision:0}});
  render(<WatchedControl targetType="subject" targetId="subject" label="影片"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('已看状态匹配已取消。');
});
