import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import {mockRunningRuntime} from './fixtures/runtime';
beforeEach(()=>{mockRunningRuntime();});
import { helixAdminApi, type FormationSubject } from '../src/helix/api';

beforeEach(()=>{vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[],counts:{},nextCursor:null});vi.spyOn(helixAdminApi,'listJavCorrectionWork').mockResolvedValue({items:[],counts:{},nextCursor:null});});

const banned = [
  '你的收藏，正在被认真照料',
  '只看系统能否持续履职',
  '访问合同',
  '候选包已被收藏生产接收',
  '收藏运营台',
  '本地 Projection',
  'Closed Condition AST',
  '上架进度',
];

function completedSubject(): FormationSubject {
  return {
    formationViewId: 'subject-1',
    subjectId: 'subject-1',
    displayIdentity: '示例电影 (2024)',
    contentProfile: 'movie',
    structureKind: 'single',
    status: 'active',
    classification: 'completed',
    myRating: 4,
    myRatingSource: 'douban',
    myRatingRevision: 1,
    productIdentityIssue: null,
    executorIssue: null,
    primaryMaterialCount: 1,
    addedAtMs: 1,
    organizingRequirement: 'HEVC · 4k',
    organizingAction: '封装整理',
    organizingSteps: [{ key: 'remux', label: '封装整理', state: 'done', progress: null }],
    nextAction: { label: '已进入收藏架', state: 'completed', progress: null },
    routingState: 'resolved',
    routingPolicyMode: 'direct',
    routingPolicyRevision: 1,
    targetShelfId: 'shelf-1',
    targetShelfName: '电影收藏架',
    unresolvedReasonCode: null,
    routingDecisionRevision: 1,
    routingDecisionDigest: 'd',
    routingDecisionHeadRevision: 1,
    routingDecisionHeadDigest: 'h',
    acceptanceSpecId: 'spec',
    acceptanceSpecRevision: 1,
    acceptanceSpecDigest: 's',
    acceptanceSpecPublishedAtMs: 1,
    productionStage: null,
    currentRun: null,
    handoffB: null,
    completedAtMs: 2,
  };
}

describe('Helix primary copy and workbench structure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retains an acknowledged Series retry across an actual workbench read failure and reopening',async()=>{
    let failReads=false;
    const item={...completedSubject(),subjectId:'series-parent-refresh',formationViewId:'series-parent-refresh',displayIdentity:'Series parent refresh',contentProfile:'series' as const,structureKind:'season' as const,classification:'attention_required' as const,completedAtMs:null,
      executorIssue:{phase:'series_presentation',owner:'arca',canRetry:true,canSupplyImages:false,offerId:'series-parent-offer',errorCode:'ARCA_SERIES_REQUIRED_ASSET_UNAVAILABLE',recoveryState:'attention_required'}} as FormationSubject;
    const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0},projection={status:'ready' as const,asOfMs:1};
    vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async section=>{if(failReads)throw new Error('GET failed');return {items:section==='active'?[item]:[],summary,nextCursor:null,projection};});
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    const post=vi.spyOn(helixAdminApi,'retryAcceptance').mockImplementation(async()=>{failReads=true;return {} as never;});
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'重试上架',exact:true}));
    let dialog=screen.getByRole('dialog',{name:'重试上架'});fireEvent.click(within(dialog).getByRole('button',{name:'重试上架',exact:true}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('任务已受理，状态读取失败');expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button',{name:'返回',exact:true}));fireEvent.click(screen.getByRole('button',{name:'重试上架',exact:true}));dialog=screen.getByRole('dialog',{name:'重试上架'});
    failReads=false;fireEvent.click(within(dialog).getByRole('button',{name:'刷新状态',exact:true}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'重试上架'})).not.toBeInTheDocument());expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps an Intake task in the same list through retry and Subject acceptance',async()=>{
    let stage='failed';
    const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0};
    const projection={status:'ready' as const,asOfMs:1};
    const subject={...completedSubject(),subjectId:'task',formationViewId:'task',displayIdentity:'Retry Movie',
      classification:'in_progress' as const,completedAtMs:null,nextAction:{label:'正在确认整理要求',state:'pending',progress:null}};
    const list=vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async section=>({
      items:section==='active'&&stage==='accepted'?[subject]:[],
      intakeItems:section==='active'&&stage!=='accepted'?[{kind:'intake' as const,formationViewId:'task',displayIdentity:'Retry Movie',
        classification:stage==='failed'?'attention_required' as const:'in_progress' as const,targetShelfId:null,addedAtMs:1,
        label:stage==='failed'?'接收材料失败':'正在接收材料',retryWorkId:stage==='failed'?'failed-work':null,failureCode:null}]:[],
      summary:stage==='failed'?summary:{...summary,inProgressCount:1,attentionRequiredCount:0},nextCursor:null,projection}));
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
    vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    const retry=vi.spyOn(helixAdminApi,'retryPreparation').mockResolvedValueOnce({kind:'deferred'})
      .mockRejectedValueOnce(new Error('response lost')).mockImplementation(async()=>{stage='running';return {kind:'admitted'};});
    const oldList=vi.spyOn(helixAdminApi,'listPreparationFailures');
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    const button=await screen.findByRole('button',{name:'重试接收'});
    expect(screen.queryByRole('button',{name:'准备异常'})).not.toBeInTheDocument();
    fireEvent.click(button);expect(await screen.findByText('当前资源忙，请稍后重试。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'重试接收'}));expect(await screen.findByRole('alert')).toHaveTextContent('尚未确认');
    fireEvent.click(screen.getByRole('button',{name:'重试接收'}));
    expect(await screen.findByText('正在接收材料')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'重试接收'})).not.toBeInTheDocument();
    expect(screen.getAllByText('Retry Movie')).toHaveLength(1);
    expect(retry.mock.calls).toEqual([['failed-work'],['failed-work'],['failed-work']]);
    stage='accepted';fireEvent.click(screen.getByRole('button',{name:'刷新',exact:true}));
    await screen.findByRole('button',{name:'查看过程'});expect(screen.getAllByText('Retry Movie')).toHaveLength(1);
    expect(oldList).not.toHaveBeenCalled();expect(list).toHaveBeenCalled();
  });

  it('retries pre-Run preparation on the original Subject row and preserves cancellation',async()=>{
    let recovered=false;
    const item={...completedSubject(),classification:'attention_required' as const,completedAtMs:null,
      preparationFailure:{workId:'routing-work',phase:'确定收藏去向',failureCode:'TEMPORARY_FAILURE'}};
    const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0},projection={status:'ready' as const,asOfMs:1};
    vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async section=>({items:section==='active'?
      [{...item,preparationFailure:recovered?null:item.preparationFailure}]:[],summary,nextCursor:null,projection}));
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
    vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    const retry=vi.spyOn(helixAdminApi,'retryPreparation').mockImplementation(async()=>{recovered=true;return {kind:'admitted'};});
    const arca=vi.spyOn(helixAdminApi,'retryAcceptance');
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'重试整理'}));
    await screen.findByText('已提交重试整理');expect(retry).toHaveBeenCalledWith('routing-work');expect(arca).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'重试整理'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'取消整理任务'})).toBeInTheDocument();
  });

  it('consumes mixed Subject and Intake pages once in the same chronological order',async()=>{
    const summary={totalCount:31,inProgressCount:0,attentionRequiredCount:31,completedCount:0},projection={status:'ready' as const,asOfMs:1};
    const rows=Array.from({length:31},(_,i)=>i%2?{...completedSubject(),formationViewId:'view-'+i,subjectId:'view-'+i,
      displayIdentity:'Mixed '+i,classification:'attention_required' as const,completedAtMs:null,addedAtMs:100-i}:
      {kind:'intake' as const,formationViewId:'view-'+i,displayIdentity:'Mixed '+i,classification:'attention_required' as const,
        targetShelfId:null,addedAtMs:100-i,label:'接收材料失败',retryWorkId:'work-'+i,failureCode:null});
    vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async(section,cursor)=>{
      const page=section==='active'?rows.slice(cursor?25:0,cursor?31:25):[];
      return {items:page.filter((item):item is FormationSubject=>'subjectId' in item),
        intakeItems:page.filter((item):item is Extract<typeof item,{kind:'intake'}>=>'kind' in item),summary,projection,
        nextCursor:section==='active'&&!cursor?'page-2':null};
    });
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
    vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    await screen.findByText('Mixed 0');
    expect(screen.getAllByText(/^Mixed \d+$/).map(node=>node.textContent)).toEqual(rows.slice(0,25).map(r=>r.displayIdentity));
    fireEvent.click(screen.getByRole('button',{name:'下一页'}));await screen.findByText('Mixed 30');
    expect(screen.getAllByText(/^Mixed \d+$/).map(node=>node.textContent)).toEqual(rows.slice(25).map(r=>r.displayIdentity));
    fireEvent.click(screen.getByRole('button',{name:'上一页'}));await screen.findByText('Mixed 0');
    expect(screen.getAllByText(/^Mixed \d+$/)).toHaveLength(25);
  });

  it('clears an uncertain retry error when refreshed Owner facts show the Intake is running',async()=>{
    let running=false;
    const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0},projection={status:'ready' as const,asOfMs:1};
    vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async section=>({items:[],intakeItems:section==='active'?[{
      kind:'intake' as const,formationViewId:'view',displayIdentity:'Response Lost',classification:running?'in_progress' as const:'attention_required' as const,
      targetShelfId:null,addedAtMs:1,label:running?'正在接收材料':'接收材料失败',retryWorkId:running?null:'work',failureCode:null}]:[],
      summary,nextCursor:null,projection}));
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
    vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    vi.spyOn(helixAdminApi,'retryPreparation').mockImplementation(async()=>{running=true;throw Error('response lost');});
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'重试接收'}));await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'刷新',exact:true}));await screen.findByText('正在接收材料');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'重试接收'})).not.toBeInTheDocument();
  });

  it('refreshes an open Formation detail and ignores a response after closing', async () => {
    let poll!:()=>void;
    const scheduleInterval=window.setInterval.bind(window);
    vi.spyOn(window,'setInterval').mockImplementation((callback,delay)=>{
      if(delay===10000)poll=callback as ()=>void;
      return scheduleInterval(()=>{},delay);
    });
    const item=completedSubject(),second={...completedSubject(),subjectId:'subject-2',formationViewId:'subject-2',displayIdentity:'Second Movie'},summary={totalCount:2,inProgressCount:0,attentionRequiredCount:0,completedCount:2},projection={status:'ready' as const,asOfMs:1};
    vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async section=>({items:section==='completed'?[item,second]:[],summary,nextCursor:null,projection}));
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection});
    vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
    const detail=vi.spyOn(helixAdminApi,'getFormation').mockResolvedValue(item);
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    const [trigger,secondTrigger]=await screen.findAllByRole('button',{name:'查看过程'});
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(()=>expect(detail).toHaveBeenCalledTimes(1));
    detail.mockResolvedValue({...item,organizingRequirement:'Updated formal requirement'});
    fireEvent.click(screen.getByRole('button',{name:'刷新',exact:true}));
    await waitFor(()=>expect(screen.getByRole('dialog')).toHaveTextContent('Updated formal requirement'));
    detail.mockRejectedValueOnce(new Error('private transport failure'));
    await act(async()=>poll());
    expect(await screen.findByRole('alert')).toHaveTextContent('整理过程读取失败');
    detail.mockResolvedValue({...item,organizingRequirement:'Recovered formal requirement'});
    await act(async()=>poll());
    await waitFor(()=>expect(screen.getByRole('dialog')).toHaveTextContent('Recovered formal requirement'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    let resolve!:(value:FormationSubject)=>void;
    detail.mockImplementation(()=>new Promise(done=>{resolve=done;}));
    await act(async()=>poll());
    await waitFor(()=>expect(detail).toHaveBeenCalledTimes(5));
    const oldResponse=resolve;
    detail.mockResolvedValue({...item,organizingRequirement:'Latest formal requirement'});
    await act(async()=>poll());
    await waitFor(()=>expect(screen.getByRole('dialog')).toHaveTextContent('Latest formal requirement'));
    await act(async()=>oldResponse({...item,organizingRequirement:'Outdated response'}));
    expect(screen.getByRole('dialog')).toHaveTextContent('Latest formal requirement');
    detail.mockImplementation(()=>new Promise(done=>{resolve=done;}));
    await act(async()=>poll());
    await waitFor(()=>expect(detail).toHaveBeenCalledTimes(7));
    fireEvent.keyDown(document,{key:'Escape'});
    await act(async()=>resolve({...item,organizingRequirement:'Late old detail'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(()=>expect(trigger).toHaveFocus());
    let staleOpen!:(value:FormationSubject)=>void;
    detail.mockImplementationOnce(()=>new Promise(done=>{staleOpen=done;}));
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document,{key:'Escape'});
    detail.mockResolvedValue(second);
    secondTrigger.focus();
    fireEvent.click(secondTrigger);
    await waitFor(()=>expect(screen.getByRole('dialog')).toHaveTextContent('Second Movie'));
    await act(async()=>staleOpen({...item,organizingRequirement:'Old object response'}));
    expect(screen.getByRole('dialog')).toHaveTextContent('Second Movie');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Old object response');
  });

  it('shows package counts once per Field, including rejection and paused reception', async () => {
    vi.spyOn(helixAdminApi, 'listMaterialFields').mockResolvedValue({ items: [{
      fieldId:'field-1', name:'电影来源', status:'active', extractionPolicyId:'policy-1', extractionPolicyRevision:1,
      currentAccessRevision:1, currentObservationRevision:1,
      currentProfileHintSnapshot:{revision:1,contentProfileHint:'movie'},
      access:{endpointId:'endpoint-1',rootLocation:'D:\\Movies',mountScopeId:'mount-1',mountScopeRevision:1},
      policy:{policy:{includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]}},
      procurementStatus:{stage:'handoff_a_ready',observationScan:{state:'completed',pageCount:4,observationRevision:1,inProgress:false},
        runCount:1,activeRunCount:0,sealedRunCount:1,generatedPackageCount:960,acceptedPackageCount:726,
        waitingAcceptanceCount:226,rejectedPackageCount:8},
    }] });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({items:[]});
    vi.spyOn(helixAdminApi, 'getFieldIntakeAdmission').mockResolvedValue({fieldId:'field-1',predeckPipelineSeats:0,
      policyRevision:2,updatedAtMs:1,pipelineTokensHeld:3,pipelineSeatsFree:0});
    vi.spyOn(helixAdminApi, 'getRoutingPolicy').mockResolvedValue({policy:null});
    render(<MemoryRouter initialEntries={['/material-fields']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '文件来源' })).toBeInTheDocument();
    expect(screen.getAllByText('960')).toHaveLength(1);
    expect(screen.getAllByText('726')).toHaveLength(1);
    expect(screen.getAllByText('226')).toHaveLength(1);
    expect(document.querySelector('.material-fields-page .source-facts')).toBeNull();
    expect(screen.getByText('累计拒绝').parentElement).toHaveTextContent('累计拒绝8 包');
    expect(screen.getByText('累计生成').parentElement).toHaveTextContent('累计生成960 包');
    expect(screen.getByText('累计接收').parentElement).toHaveTextContent('累计接收726 包');
    expect(screen.getByText('等待接收').parentElement).toHaveTextContent('等待接收226包');
    expect(document.querySelector('.source-handoff-bar')).toBeNull();
    expect(screen.queryByText(/接收被拒|未能进入整理|待重试|等待恢复|技术标识/)).not.toBeInTheDocument();
    expect(screen.getByText('暂停接收')).toBeInTheDocument();
    expect(screen.queryByText(/暂停该来源进入整理/)).not.toBeInTheDocument();
  });

  it('uses honest people and settings claims', async () => {
    vi.spyOn(helixAdminApi, 'listPeople').mockResolvedValue({
      items: [],
      nextCursor: null,
      summary: { activePersonCount: 0, mergedPersonCount: 0, openRegistrationCandidateCount: 0, openMergeCandidateCount: 0 },
    });
    vi.spyOn(helixAdminApi, 'listPeopleRegistrationCandidates').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/people']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '人物' })).toBeInTheDocument();
    expect(screen.queryByText(/名录是已经登记的人，不是某部电影的演员表/)).not.toBeInTheDocument();
    expect(screen.queryByText('维护人物身份，而不是改写媒体演职员事实')).not.toBeInTheDocument();
    expect(screen.queryByText('本页暂不处理合并')).not.toBeInTheDocument();
  });

  it('describes settings as connections plus rating log', async () => {
    vi.spyOn(helixAdminApi, 'getIntegration').mockResolvedValue({
      kind: 'douban', supported: true, configured: false, state: 'idle', configRevision: 0,
      endpoint: null, configDigest: null, capabilityCodes: [], lastTestSummary: null, landingBinding: null,
    });
    const ratings = vi.spyOn(helixAdminApi, 'listPerceptionRecords');
    render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '系统设置' })).toBeInTheDocument();
    expect(screen.queryByText(/管理连接、自动运营与评分日志/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '豆瓣' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'TMDB' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '网络代理' })).toBeInTheDocument();
    expect(screen.getByLabelText('网络方式')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'MoviePilot' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '退出规则' })).toBeInTheDocument();
    vi.spyOn(helixAdminApi,'getWorkspaceRootSettings').mockResolvedValue({current:{rootPath:'D:\\ShelfDeck\\workspace',configRevision:1},
      pending:null,restartRequired:false});
    vi.spyOn(helixAdminApi,'getSecondaryWorkshop').mockResolvedValue({secondarySeats:5,policyRevision:1,updatedAtMs:0,held:0,free:5});
    fireEvent.click(screen.getByRole('tab',{name:'整理空间'}));
    expect(await screen.findByRole('heading',{level:2,name:'整理工作目录'})).toBeInTheDocument();
    expect(screen.getByDisplayValue('D:\\ShelfDeck\\workspace')).toBeInTheDocument();
    expect(screen.queryByText(/保存会检查读写/)).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'验证并保存'})).toBeInTheDocument();
    expect(screen.queryByText(/不会搬动或删除旧目录/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading',{level:2,name:'二号暂存车间'})).toBeInTheDocument();
    expect(document.querySelectorAll('.settings-card')).toHaveLength(2);
    expect(screen.queryByText('连接、空间、资源与安全')).not.toBeInTheDocument();
    expect(ratings).not.toHaveBeenCalled();
  });

  it('revises configured MoviePilot Landing without asking for or sending its credential', async () => {
    const unconfigured = (kind:string) => ({
      kind, supported:true, configured:false, state:'unconfigured', configRevision:0,
      endpoint:null, configDigest:null, capabilityCodes:[], lastTestSummary:null, landingBinding:null,
    });
    const configuredMoviePilot = {
      kind:'moviepilot', supported:true, configured:true, state:'active', configRevision:7,
      endpoint:'http://moviepilot.test', configDigest:'digest', capabilityCodes:['acquisition'],
      lastTestSummary:{ identityProviderKey:'moviepilot-instance' }, settings:{},
      landingBinding:{ bindingId:'binding', bindingRevision:7,
        providerRequestSaveRoot:'/provider/downloads', providerOrganizedRoot:'/provider/organized',
        shelfDeckVisibleRoot:'F:\\old-landing', endpointId:'endpoint', mountScopeId:'mount',
        mountScopeRevision:1, bindingDigest:'binding-digest' },
    };
    vi.spyOn(helixAdminApi,'getIntegration').mockImplementation(async(kind) =>
      kind==='moviepilot' ? configuredMoviePilot : unconfigured(kind));
    const configure=vi.spyOn(helixAdminApi,'configureIntegration').mockResolvedValue({
      ...configuredMoviePilot, configRevision:8,
      landingBinding:{...configuredMoviePilot.landingBinding,bindingRevision:8,
        shelfDeckVisibleRoot:'F:\\new-landing'},
    });
    render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>);
    expect(await screen.findByDisplayValue('F:\\old-landing')).toBeInTheDocument();
    const moviePilotCard=screen.getByRole('heading',{level:2,name:'MoviePilot'}).closest('section');
    expect(moviePilotCard?.querySelector('input[type="password"]')).toBeNull();
    fireEvent.change(screen.getByRole('textbox',{name:/ShelfDeck 可见目录/}),{
      target:{value:'F:\\new-landing'},
    });
    fireEvent.click(screen.getByRole('button',{name:'验证并保存目录'}));
    await waitFor(()=>expect(configure).toHaveBeenCalledTimes(1));
    const [kind,body]=configure.mock.calls[0];
    expect(kind).toBe('moviepilot');
    expect(body).toMatchObject({kind:'moviepilot',expectedConfigRevision:7,settings:{
      providerRequestSaveRoot:'/provider/downloads',providerOrganizedRoot:'/provider/organized',
      shelfDeckVisibleRoot:'F:\\new-landing',
    }});
    expect(body).not.toHaveProperty('credential');
    expect(body).not.toHaveProperty('connectionProofId');
  });

  it('renders completed history as read-only organizing results', async () => {
    vi.spyOn(helixAdminApi, 'listFormation').mockImplementation(async (section) => {
      if (section === 'completed') {
        return {
          items: [completedSubject()],
          summary: { totalCount: 1, inProgressCount: 0, attentionRequiredCount: 0, completedCount: 1 },
          nextCursor: null,
          projection: { status: 'ready', asOfMs: 1 },
        };
      }
      return {
        items: [],
        summary: { totalCount: 1, inProgressCount: 0, attentionRequiredCount: 0, completedCount: 1 },
        nextCursor: null,
        projection: { status: 'ready', asOfMs: 1 },
      };
    });
    vi.spyOn(helixAdminApi, 'listFormationHistory').mockResolvedValue({ items: [], summary: { totalCount:1, inProgressCount:0, attentionRequiredCount:0, completedCount:1 }, nextCursor:null, projection:{status:'ready',asOfMs:1} });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '媒体整理工作区' })).toBeInTheDocument();
    expect(await screen.findByText('示例电影 (2024)')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '当前进展' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '详情' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '用户操作' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '加急' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '放弃本次整理' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '示例电影 (2024)无需加急' })).toBeDisabled();
  });

  it('accepts cancellation once and reports durable background closure', async () => {
    const current:FormationSubject={...completedSubject(),displayIdentity:'局内人 (2006) 1080p DTS-sample',
      classification:'attention_required',completedAtMs:null,
      productIdentityIssue:{result:'not_found',reasonCode:'provider_no_match',candidateSetDigest:'candidate-set',candidates:[]},
      currentRun:{libraRunId:'sample-run',state:'active',stateRevision:2,stateDigest:'run-digest',
        priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:null}};
    const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0};
    vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async section=>({
      items:section==='active'?[current]:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}}));
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}});
    vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    let finish!:()=>void;
    const discard=vi.spyOn(helixAdminApi,'discardRun')
      .mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({resultKind:'closure_pending',libraRunId:'sample-run'});}))
      .mockResolvedValueOnce({resultKind:'discarded',libraRunId:'sample-run'});
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    const trigger=await screen.findByRole('button',{name:'取消整理任务'});trigger.focus();fireEvent.click(trigger);
    const initialDialog=screen.getByRole('dialog',{name:'确认取消整理任务'}),closeButton=within(initialDialog).getByRole('button',{name:'关闭'});
    expect(closeButton).toHaveFocus();fireEvent.keyDown(closeButton,{key:'Tab',shiftKey:true});
    expect(within(initialDialog).getByRole('button',{name:'确认取消任务'})).toHaveFocus();
    fireEvent.keyDown(document.activeElement!,{key:'Tab'});expect(closeButton).toHaveFocus();
    fireEvent.keyDown(closeButton,{key:'Escape'});expect(initialDialog).not.toBeInTheDocument();expect(trigger).toHaveFocus();expect(discard).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    const dialog=screen.getByRole('dialog',{name:'确认取消整理任务'});
    const confirm=within(dialog).getByRole('button',{name:'确认取消任务'});confirm.focus();fireEvent.click(confirm);
    const busyClose=within(dialog).getByRole('button',{name:'关闭'});expect(busyClose).toHaveFocus();
    fireEvent.keyDown(busyClose,{key:'Tab'});expect(busyClose).toHaveFocus();
    fireEvent.keyDown(busyClose,{key:'Escape'});expect(dialog).toBeInTheDocument();
    await act(async()=>finish());
    await waitFor(()=>expect(dialog).not.toBeInTheDocument());
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard.mock.calls[0][2]).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('正在取消整理任务');
  });

  it('blocks stale discard retries and hides technical errors from the confirmation', async () => {
    const current:FormationSubject={...completedSubject(),displayIdentity:'局内人 (2006) 1080p DTS-sample',
      classification:'attention_required',completedAtMs:null,
      productIdentityIssue:{result:'not_found',reasonCode:'provider_no_match',candidateSetDigest:'candidate-set',candidates:[]},
      currentRun:{libraRunId:'sample-run',state:'active',stateRevision:2,stateDigest:'run-digest',
        priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:null}};
    const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0};
    vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async section=>({
      items:section==='active'?[current]:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}}));
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}});
    vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    const discard=vi.spyOn(helixAdminApi,'discardRun')
      .mockResolvedValueOnce({resultKind:'invalid_state',libraRunId:'sample-run',reasonCode:'run_not_discardable'})
      .mockRejectedValueOnce(new Error('P9_DISCARD_EFFECT_PENDING internal stack'))
      .mockResolvedValueOnce({resultKind:'discarded',libraRunId:'sample-run'});
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'取消整理任务'}));
    let dialog=screen.getByRole('dialog',{name:'确认取消整理任务'});
    fireEvent.click(within(dialog).getByRole('button',{name:'确认取消任务'}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请关闭窗口并刷新列表后重试');
    expect(within(dialog).getByRole('button',{name:'确认取消任务'})).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button',{name:'取消'}));
    await waitFor(()=>expect(screen.queryByRole('dialog',{name:'确认取消整理任务'})).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'取消整理任务'}));
    dialog=screen.getByRole('dialog',{name:'确认取消整理任务'});
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button',{name:'确认取消任务'}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('暂未确认本次整理是否结束');
    expect(within(dialog).getByRole('checkbox')).toBeDisabled();
    expect(within(dialog).getByRole('checkbox')).toBeChecked();
    expect(within(dialog).queryByText(/P9_DISCARD|internal stack/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button',{name:'确认取消任务'}));
    await waitFor(()=>expect(dialog).not.toBeInTheDocument());
    expect(discard.mock.calls[0][1]).not.toBe(discard.mock.calls[1][1]);
    expect(discard.mock.calls[1][1]).toBe(discard.mock.calls[2][1]);
    expect(discard.mock.calls[1][2]).toBe(true);
    expect(discard.mock.calls[2][2]).toBe(true);
  });

  it('renders current media as stacked steps, progress, user actions, and expedite', async () => {
    const current: FormationSubject = {
      ...completedSubject(),
      classification: 'in_progress',
      organizingAction: 'GPU转码 · HEVC · 4k · 不超过 20 GiB',
      organizingSteps: [{
        key: 'transcode',
        label: 'GPU转码 · HEVC · 4k · 不超过 20 GiB',
        state: 'running',
        progress: { mode: 'determinate', currentValue: 40, totalValue: 100, unit: 'percent', rate: null, etaMs: null, bucket: 'transcode' },
      }],
      currentPlan: {
        stageKey:'media_organization',planId:'plan-14',planNumber:14,title:'处理媒体文件',
        label:'计划14 处理媒体文件',state:'running',statusText:'等待处理资源',progress:null,
      },
      nextAction: { label: '继续整理媒体', state: 'running', progress: null },
      currentRun: {
        libraRunId: 'run-1', state: 'active', stateRevision: 1, stateDigest: 'd',
        priorityClass: 'normal', packageRevisionHead: 0, currentIdentityRevision: 1,
      },
      completedAtMs: null,
    };
    vi.spyOn(helixAdminApi, 'listFormation').mockImplementation(async(section)=>({
      items: section==='active'?[current]:[], summary: { totalCount:1,inProgressCount:1,attentionRequiredCount:0,completedCount:0 },
      nextCursor:null,projection:{status:'ready',asOfMs:1},
    }));
    vi.spyOn(helixAdminApi, 'listFormationHistory').mockResolvedValue({ items:[],summary:{totalCount:1,inProgressCount:1,attentionRequiredCount:0,completedCount:0},nextCursor:null,projection:{status:'ready',asOfMs:1} });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    expect(await screen.findByRole('columnheader', { name: '媒体名称' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '当前进展' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '用户操作' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '加急' })).toBeInTheDocument();
    expect(screen.getByText('计划14 处理媒体文件')).toBeInTheDocument();
    expect(screen.getByText('等待处理资源')).toBeInTheDocument();
    expect(screen.queryByText('GPU转码 · HEVC · 4k · 不超过 20 GiB')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加急 示例电影 (2024)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /待整理/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('按片名筛选')).toBeInTheDocument();
    const toolbar = document.querySelector('.formation-toolbar');
    expect(toolbar).toContainElement(screen.getByRole('group', { name: '媒体整理状态' }));
    expect(toolbar).toContainElement(screen.getByLabelText('按片名筛选'));
    expect(toolbar).toContainElement(screen.getByLabelText('按目标收藏架筛选'));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/当前显示/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /需要处理/ }));
    await waitFor(() => expect(screen.queryByText('示例电影 (2024)')).not.toBeInTheDocument());
  });

  it('renders the media process card from backend actual Plans and Nodes', async () => {
    const current:FormationSubject={...completedSubject(),classification:'in_progress',completedAtMs:null,
      nextAction:{label:'正在处理视频文件',state:'executing',progress:null},
      currentRun:{libraRunId:'run-1',state:'active',stateRevision:1,stateDigest:'d',priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:1},
      processDetail:{contract:'formation_process_actual_plans@1',stages:[
        {key:'material_preparation',label:'材料准备',description:'发现并准备原始材料',state:'completed',summary:'1 个计划已完成',plans:[
          {planId:'proc-plan',title:'检查材料结构',state:'completed',createdAtMs:1,nodes:[{nodeId:'inspect',label:'检查材料结构',description:'材料结构可以进入后续整理。',state:'completed',progress:null,results:[{label:'结构结果',value:'单个主媒体文件'}],technicalDetail:null}]},
        ]},
        {key:'media_organization',label:'媒体整理',description:'按收藏要求制作媒体产品',state:'running',summary:'计划1正在进行',plans:[
          {planId:'libra-plan',title:'处理媒体文件',state:'running',createdAtMs:2,nodes:[{nodeId:'transcode',label:'处理视频文件',description:'正在生成符合收藏要求的新版本。',state:'running',progress:{mode:'determinate',currentValue:16,totalValue:100,unit:'percent',rate:null,etaMs:null,bucket:'transcode'},results:[],technicalDetail:{summary:'只显示真实计划参数。',fields:[{label:'处理方式',value:'Intel QSV'}],parameters:[{label:'target_bitrate',value:'12M'}]}}]},
        ]},
        {key:'acceptance_shelving',label:'验收与上架',description:'由收藏架检查最终产品',state:'pending',summary:'等待媒体整理完成；当前还没有形成这一阶段的计划',plans:[]},
      ]}};
    const summary={totalCount:1,inProgressCount:1,attentionRequiredCount:0,completedCount:0};
    vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async(section)=>({items:section==='active'?[current]:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}}));
    vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}});
    vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
    vi.spyOn(helixAdminApi,'getFormation').mockResolvedValue(current);
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'查看过程'}));
    expect(await screen.findByRole('dialog',{name:'示例电影 (2024)的媒体整理过程'})).toBeInTheDocument();
    expect(screen.getByText('计划1正在进行')).toBeInTheDocument();
    expect(screen.getByText('正在生成符合收藏要求的新版本。')).toBeInTheDocument();
    fireEvent.click(screen.getByText('查看处理详情'));
    expect(screen.getByText('Intel QSV')).toBeInTheDocument();
    expect(screen.getByText('target_bitrate')).toBeInTheDocument();
    expect(screen.getByText(/这里只展示已经由系统形成并保存的真实计划/)).toBeInTheDocument();
  });

  it('shows the first formation page before remaining pages finish', async () => {
    let releaseRest = () => {};
    const rest = new Promise<void>((resolve) => { releaseRest = resolve; });
    const first: FormationSubject = {
      ...completedSubject(),
      classification: 'in_progress',
      displayIdentity: '第一部电影',
      nextAction: { label: '继续整理媒体', state: 'running', progress: null },
      currentRun: {
        libraRunId: 'run-1', state: 'active', stateRevision: 1, stateDigest: 'd',
        priorityClass: 'normal', packageRevisionHead: 0, currentIdentityRevision: 1,
      },
      completedAtMs: null,
    };
    const second: FormationSubject = { ...first, formationViewId: 'subject-2', subjectId: 'subject-2', displayIdentity: '第二部电影' };
    const summary = { totalCount: 2, inProgressCount: 2, attentionRequiredCount: 0, completedCount: 0 };
    vi.spyOn(helixAdminApi, 'listFormation').mockImplementation(async (section, cursor) => {
      if (section === 'active' && !cursor) {
        return { items: [first], summary, nextCursor: 'page-2', projection: { status: 'ready', asOfMs: 1 } };
      }
      if (section === 'active' && cursor === 'page-2') {
        await rest;
        return { items: [second], summary, nextCursor: null, projection: { status: 'ready', asOfMs: 1 } };
      }
      return { items: [], summary, nextCursor: null, projection: { status: 'ready', asOfMs: 1 } };
    });
    vi.spyOn(helixAdminApi, 'listFormationHistory').mockResolvedValue({ items: [], summary, nextCursor: null, projection: { status: 'ready', asOfMs: 1 } });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    expect(await screen.findByText('第一部电影')).toBeInTheDocument();
    expect(screen.queryByText('正在读取媒体整理工作区…')).not.toBeInTheDocument();
    expect(screen.queryByText('第二部电影')).not.toBeInTheDocument();
    expect(screen.queryByText(/当前显示|其余继续载入/)).not.toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole('button',{name:'下一页'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'下一页'}));
    releaseRest();
    expect(await screen.findByText('第二部电影')).toBeInTheDocument();
  });

  it('loads attention-required movies when that filter is selected', async () => {
    const newest: FormationSubject = {
      ...completedSubject(),
      classification: 'in_progress',
      displayIdentity: '最新电影',
      nextAction: { label: '继续整理媒体', state: 'running', progress: null },
      currentRun: {
        libraRunId: 'run-new', state: 'active', stateRevision: 1, stateDigest: 'd',
        priorityClass: 'normal', packageRevisionHead: 0, currentIdentityRevision: 1,
      },
      completedAtMs: null,
    };
    const attention: FormationSubject = {
      ...completedSubject(),
      formationViewId: 'subject-attention',
      subjectId: 'subject-attention',
      classification: 'attention_required',
      displayIdentity: '需要确认的电影',
      productIdentityIssue: {
        result: 'ambiguous', reasonCode: 'provider_identity_ambiguous', candidateSetDigest: 'c',
        candidates: [{ providerKey: 'tmdb:movie:1', displayTitle: '需要确认的电影', originalTitle: null, releaseYear: 2004 }],
      },
      nextAction: { label: '需要确认媒体身份', state: 'attention_required', progress: null },
      currentRun: {
        libraRunId: 'run-attention', state: 'active', stateRevision: 1, stateDigest: 'd',
        priorityClass: 'normal', packageRevisionHead: 0, currentIdentityRevision: 1,
      },
      completedAtMs: null,
    };
    const summary = { totalCount: 2, inProgressCount: 1, attentionRequiredCount: 1, completedCount: 0 };
    vi.spyOn(helixAdminApi, 'listFormation').mockImplementation(async (section, cursor, filters) => {
      if (section === 'active' && filters?.classification === 'attention_required') {
        return { items: [attention], summary, nextCursor: null, projection: { status: 'ready', asOfMs: 1 } };
      }
      if (section === 'active' && !cursor) {
        return { items: [newest], summary, nextCursor: null, projection: { status: 'ready', asOfMs: 1 } };
      }
      return { items: [], summary, nextCursor: null, projection: { status: 'ready', asOfMs: 1 } };
    });
    vi.spyOn(helixAdminApi, 'listFormationHistory').mockResolvedValue({ items: [], summary, nextCursor: null, projection: { status: 'ready', asOfMs: 1 } });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    expect(await screen.findByText('最新电影')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /需要处理/ }));
    expect(await screen.findByText('需要确认的电影')).toBeInTheDocument();
  });

  it('does not keep banned slogans on the default chrome', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    for (const phrase of banned) {
      expect(screen.queryByText(phrase)).not.toBeInTheDocument();
    }
  });
});

it('opens a loading dialog immediately and ignores a response after the user closes it',async()=>{
  const item=completedSubject(),summary={totalCount:1,inProgressCount:0,attentionRequiredCount:0,completedCount:1};
  vi.spyOn(helixAdminApi,'listFormation').mockImplementation(async(section)=>({items:section==='completed'?[item]:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}}));
  vi.spyOn(helixAdminApi,'listFormationHistory').mockResolvedValue({items:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}});
  vi.spyOn(helixAdminApi,'listShelves').mockResolvedValue({items:[]});
  vi.spyOn(helixAdminApi,'listCareWork').mockResolvedValue({items:[],counts:{},nextCursor:null});
  vi.spyOn(helixAdminApi,'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  let resolveDetail!:(value:FormationSubject)=>void;
  vi.spyOn(helixAdminApi,'getFormation').mockImplementation(()=>new Promise(resolve=>{resolveDetail=resolve;}));
  render(<MemoryRouter initialEntries={['/formation']}><App/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'查看过程'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('正在读取整理计划…');
  expect(screen.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'关闭媒体整理过程卡片'}));
  resolveDetail(item);
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  vi.restoreAllMocks();
});
