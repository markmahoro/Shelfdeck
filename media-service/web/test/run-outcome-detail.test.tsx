import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import RunOutcomeDetail,{terminalReasonLabels} from '../src/helix/RunOutcomeDetail';
import {helixAdminApi,type FormationRunHistory,type LibraRunOutcome} from '../src/helix/api';
const expire=()=>{};
vi.mock('../src/helix/session',()=>({useSession:()=>({expire}),isUnauthorized:()=>false}));
const item:FormationRunHistory={historyId:'history',libraRunId:'run',subjectId:'subject',displayIdentity:'示例影片',outcome:'unable_to_on_deck',label:'无法上架',endedAtMs:1,stateRevision:4,stateDigest:'state',evidenceDigest:'evidence'};
const outcome:LibraRunOutcome={libraRunId:'run',outcome:'unable_to_on_deck',reasonCode:'processing_failed',outcomeDigest:'digest',committedAtMs:1,terminalReasons:[{failureClass:'business_unachievable',failureCode:'playback_decode_failed',capabilityRef:'verify'}]};
afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');this.querySelector('button')?.focus();}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});

it('unknown and missing reasons keep a neutral result without inventing a failed product check',()=>{
  expect(terminalReasonLabels([])).toEqual(['本次处理未完成']);
  expect(terminalReasonLabels([{failureCode:'source_binding_missing',failureClass:'executor',capabilityRef:'probe'}])).toEqual(['本次处理未完成']);
});

it('read failure cannot expose reprocessing and can be retried',async()=>{
  vi.spyOn(helixAdminApi,'readRunOutcome').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({outcome});
  const mutate=vi.spyOn(helixAdminApi,'reprocessRun');
  render(<RunOutcomeDetail item={item} onChanged={()=>{}}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
  expect(screen.queryByRole('button',{name:'重试任务'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'重新读取'}));
  expect(await screen.findByText('成品未通过播放检查')).toBeTruthy();
  expect(mutate).not.toHaveBeenCalled();
});

it('cancel has no effect and an uncertain submit reuses the exact request key',async()=>{
  vi.spyOn(helixAdminApi,'readRunOutcome').mockResolvedValue({outcome});
  const mutate=vi.spyOn(helixAdminApi,'reprocessRun').mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({intentId:'intent',replayed:true});
  const changed=vi.fn();render(<RunOutcomeDetail item={item} onChanged={changed}/>);
  fireEvent.click(await screen.findByRole('button',{name:'重试任务'}));
  fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'重试任务'}));
  fireEvent.click(screen.getByRole('button',{name:'确认重试任务'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('未确认成功');
  fireEvent.click(screen.getByRole('button',{name:'确认重试任务'}));
  await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
  expect(mutate.mock.calls[1]).toEqual(mutate.mock.calls[0]);
  expect(screen.getByText('已提交重试任务')).toBeTruthy();
});

it('nested Escape cancellation stays inside the confirmation and returns focus',async()=>{
  vi.spyOn(helixAdminApi,'readRunOutcome').mockResolvedValue({outcome});
  const mutate=vi.spyOn(helixAdminApi,'reprocessRun'),escaped=vi.fn();document.addEventListener('keydown',escaped);
  try{
    render(<RunOutcomeDetail item={item} onChanged={()=>{}}/>);
    const trigger=await screen.findByRole('button',{name:'重试任务'});trigger.focus();fireEvent.click(trigger);
    const dialog=screen.getByRole('dialog');fireEvent.keyDown(dialog,{key:'Escape'});
    expect(escaped).not.toHaveBeenCalled();fireEvent(dialog,new Event('cancel',{cancelable:true}));
    expect(screen.queryByRole('dialog')).toBeNull();expect(trigger).toHaveFocus();expect(mutate).not.toHaveBeenCalled();
  }finally{document.removeEventListener('keydown',escaped);}
});
