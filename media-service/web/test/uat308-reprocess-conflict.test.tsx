import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import RunOutcomeDetail from '../src/helix/RunOutcomeDetail';
import {ProcessDialog} from '../src/helix/ProcessStages';
import {AdminApiError,helixAdminApi,type FormationRunHistory,type LibraRunOutcome} from '../src/helix/api';
const expire=()=>{};
vi.mock('../src/helix/session',()=>({useSession:()=>({expire}),isUnauthorized:()=>false}));
const item={historyId:'history',libraRunId:'run',subjectId:'subject',displayIdentity:'Example Series',outcome:'unable_to_on_deck',
  label:'无法上架',endedAtMs:1,stateRevision:4,stateDigest:'state',evidenceDigest:'evidence'} as FormationRunHistory;
const outcome={libraRunId:'run',outcome:'unable_to_on_deck',reasonCode:'processing_failed',outcomeDigest:'digest',committedAtMs:1,
  terminalReasons:[{failureClass:'business_unachievable',failureCode:'required_artifact_missing',capabilityRef:'verify'}]} as LibraRunOutcome;
afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');this.querySelector('button')?.focus();}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
  vi.spyOn(helixAdminApi,'readRunOutcome').mockResolvedValue({outcome});
});

it('reports the exact source observation conflict and replays the same pending intent after cancel and reopen',async()=>{
  const conflict=new AdminApiError(409,'ADMIN_FIELD_CONFLICT','Material Field revision or Observation changed',
    {reasonCode:'FIELD_OBSERVATION_WORK_DEFERRED'});
  const submit=vi.spyOn(helixAdminApi,'reprocessRun').mockRejectedValueOnce(conflict).mockResolvedValue({intentId:'saved-intent',replayed:true});
  const changed=vi.fn();render(<RunOutcomeDetail item={item} onChanged={changed}/>);
  const trigger=await screen.findByRole('button',{name:'重新整理'});trigger.focus();fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button',{name:'确认重新整理'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('来源扫描尚未结束，稍后再试。');
  expect(screen.getByRole('button',{name:'确认重新整理'})).toBeEnabled();
  expect(changed).not.toHaveBeenCalled();expect(screen.queryByText('已提交重新整理')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(trigger).toHaveFocus();
  trigger.focus();fireEvent.click(trigger);fireEvent.click(screen.getByRole('button',{name:'确认重新整理'}));
  await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
  expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  expect(screen.getByText('已提交重新整理')).toBeVisible();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not misdiagnose other 409 reasons as a busy source scan',async()=>{
  vi.spyOn(helixAdminApi,'reprocessRun').mockRejectedValue(new AdminApiError(409,'ADMIN_FIELD_CONFLICT','revision changed',
    {reasonCode:'FIELD_OBSERVATION_ADMIN_FENCE_CONFLICT'}));
  render(<RunOutcomeDetail item={item} onChanged={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'重新整理'}));fireEvent.click(screen.getByRole('button',{name:'确认重新整理'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('未确认成功');
  expect(screen.queryByText('来源扫描尚未结束，稍后再试。')).not.toBeInTheDocument();
});

it('keeps the outer process detail open when Escape cancels the reprocess confirmation',async()=>{
  const outerCancel=vi.fn();render(<ProcessDialog title="整理过程" onClose={outerCancel}><RunOutcomeDetail item={item} onChanged={()=>{}}/></ProcessDialog>);
  const trigger=await screen.findByRole('button',{name:'重新整理'});trigger.focus();fireEvent.click(trigger);
  fireEvent.keyDown(document,{key:'Escape'});expect(outerCancel).not.toHaveBeenCalled();
  fireEvent(screen.getByRole('dialog',{name:'确认重新整理'}),new Event('cancel',{bubbles:true,cancelable:true}));
  expect(outerCancel).not.toHaveBeenCalled();expect(screen.queryByRole('dialog',{name:'确认重新整理'})).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.keyDown(document,{key:'Escape'});expect(outerCancel).toHaveBeenCalledOnce();
});
