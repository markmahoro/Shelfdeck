import {useState} from 'react';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {ProcessDialog,ProcessStages,type ProcessStage} from '../src/helix/ProcessStages';

it('explains exhausted file observation from the exact failure code without inventing other reasons',()=>{
  const node=(nodeId:string,code:string,message='系统没有保存可展示的文字原因')=>({nodeId,label:nodeId,description:'',state:'failed' as const,statusText:'执行失败',progress:null,technicalDetail:null,
    results:[{label:'失败原因',value:message},{label:'失败代码',value:code}]});
  const stages=[{key:'acceptance',label:'验收与上架',summary:'需要处理',description:'',state:'attention',plans:[{
    planId:'plan',title:'剧集资料',state:'attention',nodes:[node('写入剧集资料','P4_EVENT_RECOVERY_OBSERVATION_UNAVAILABLE'),
      node('权限失败','EPERM'),node('未识别失败','OTHER_FAILURE','Unclassified failure')],
  }]}] as ProcessStage[];
  render(<ProcessStages stages={stages}/>);
  expect(screen.getByText('未能在规定时间内核对文件状态')).toBeVisible();
  expect(screen.getByText('没有文件操作权限')).toBeVisible();
  expect(screen.getByText('具体失败原因暂不可用')).toBeVisible();
  expect(screen.queryByText('P4_EVENT_RECOVERY_OBSERVATION_UNAVAILABLE')).not.toBeInTheDocument();
});

it('keeps forward and backward focus within visible process controls and restores the trigger',()=>{
  function Harness(){const [open,setOpen]=useState(false);return <>
    <button onClick={()=>setOpen(true)}>查看过程</button><button>背景操作</button>
    {open&&<ProcessDialog title="整理过程" onClose={()=>setOpen(false)}>
      <details open><summary>已展开阶段</summary><details open><summary>已展开计划</summary>
        <details><summary>查看处理详情</summary><button>折叠中的操作</button></details>
      </details></details>
      <details><summary>已折叠阶段</summary><button>不可见操作</button></details>
      <button hidden>隐藏操作</button><button style={{display:'none'}}>隐藏样式操作</button><button disabled>禁用操作</button>
    </ProcessDialog>}
  </>;}
  render(<Harness/>);
  const trigger=screen.getByRole('button',{name:'查看过程'});trigger.focus();fireEvent.click(trigger);
  const dialog=screen.getByRole('dialog',{name:'整理过程'}),close=within(dialog).getByRole('button',{name:'关闭媒体整理过程卡片'}),
    last=within(dialog).getByText('已折叠阶段');
  expect(close).toHaveFocus();last.focus();expect(last).toHaveFocus();
  fireEvent.keyDown(last,{key:'Tab'});expect(close).toHaveFocus();
  fireEvent.keyDown(close,{key:'Tab',shiftKey:true});expect(last).toHaveFocus();
  (last.parentElement as HTMLDetailsElement).open=true;
  const expanded=within(dialog).getByRole('button',{name:'不可见操作'});expanded.focus();
  fireEvent.keyDown(expanded,{key:'Tab'});expect(close).toHaveFocus();
  screen.getByRole('button',{name:'背景操作'}).focus();expect(close).toHaveFocus();
  fireEvent.keyDown(close,{key:'Escape'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(trigger).toHaveFocus();
});

it('lets a nested native confirmation own Escape and Tab until it closes',()=>{
  const close=vi.fn();render(<ProcessDialog title="整理过程" onClose={close}>
    <dialog open aria-label="确认"><button>确认操作</button></dialog>
  </ProcessDialog>);
  const confirmation=screen.getByRole('dialog',{name:'确认'}),button=within(confirmation).getByRole('button',{name:'确认操作'});
  button.focus();const tab=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});button.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);expect(button).toHaveFocus();
  fireEvent.keyDown(button,{key:'Escape'});expect(close).not.toHaveBeenCalled();
});
