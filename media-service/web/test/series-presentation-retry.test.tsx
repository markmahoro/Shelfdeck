import {useState} from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import SeriesPresentationRetryDialog from '../src/helix/SeriesPresentationRetryDialog';
import {AdminApiError,helixAdminApi,type FormationSubject} from '../src/helix/api';

let serial=0;
beforeEach(()=>{
  class ImageFixture{src='';get width(){return this.src.includes('fanart')?120:4;}get height(){return this.src.includes('fanart')?80:6;}async decode(){if(this.src.includes('corrupt'))throw new Error('The source image cannot be decoded.');}}
  class URLFixture extends URL{static createObjectURL(file:File){return 'blob:'+file.name;}static revokeObjectURL(){}}
  vi.stubGlobal('Image',ImageFixture);vi.stubGlobal('URL',URLFixture);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(kind:'acceptance'|'entry',callbacks?:{onClose:()=>void;onComplete:()=>Promise<void>}){
  const id='shared-ui-'+(++serial),item={subjectId:id,displayIdentity:'Demo Show',executorIssue:{offerId:id,canRetry:true}} as FormationSubject,
    props=kind==='entry'?{entry:{shelfEntryId:id,displayIdentity:'Demo Show'}}:{item},cb=callbacks||{onClose:vi.fn(),onComplete:vi.fn().mockResolvedValue(undefined)};
  const view=render(<SeriesPresentationRetryDialog {...props} {...cb}/>);return {...cb,...view};
}
function images(){fireEvent.change(screen.getByLabelText(/剧集海报/),{target:{files:[new File(['original-poster'],'poster.jpg',{type:'image/jpeg'})]}});
  fireEvent.change(screen.getByLabelText(/剧集背景/),{target:{files:[new File(['original-fanart'],'fanart.jpg',{type:'image/jpeg'})]}});}
for(const kind of ['acceptance','entry'] as const){
  it(`${kind} freezes command identity and bytes after an uncertain response`,async()=>{
    const api=vi.spyOn(helixAdminApi,kind==='entry'?'checkCare':'retryAcceptance').mockRejectedValueOnce(new TypeError('network failure')).mockResolvedValue({} as never);
    const cb=mount(kind);images();fireEvent.click(screen.getByRole('button',{name:'重试任务',exact:true}));
    expect(await screen.findByRole('alert')).toHaveTextContent('提交结果尚未确认');expect(screen.getByLabelText(/剧集海报/)).toBeDisabled();expect(screen.getByLabelText(/剧集背景/)).toBeDisabled();
    // Even a synthetic change event cannot alter the already submitted intent.
    fireEvent.change(screen.getByLabelText(/剧集背景/),{target:{files:[new File(['changed'],'new-fanart.jpg',{type:'image/jpeg'})]}});
    fireEvent.click(screen.getByRole('button',{name:'确认提交结果',exact:true}));await waitFor(()=>expect(cb.onClose).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledTimes(2);expect(api.mock.calls[0][2]).toBe(api.mock.calls[1][2]);expect(api.mock.calls[0][1]).toEqual(api.mock.calls[1][1]);expect(api.mock.calls[1][1]).toHaveLength(2);
  });
  it(`${kind} retries only the read after an acknowledged command`,async()=>{
    const api=vi.spyOn(helixAdminApi,kind==='entry'?'checkCare':'retryAcceptance').mockResolvedValue({} as never),onComplete=vi.fn().mockRejectedValueOnce(new Error('GET unavailable')).mockResolvedValue(undefined),cb=mount(kind,{onComplete,onClose:vi.fn()});
    fireEvent.click(screen.getByRole('button',{name:'重试任务',exact:true}));expect(await screen.findByRole('alert')).toHaveTextContent('任务已受理，状态读取失败');
    expect(screen.getByLabelText(/剧集海报/)).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'刷新状态',exact:true}));
    await waitFor(()=>expect(cb.onClose).toHaveBeenCalledTimes(1));expect(api).toHaveBeenCalledTimes(1);expect(onComplete).toHaveBeenCalledTimes(2);
  });
}
it('takes focus, traps Tab, and restores the original trigger on idle Escape without a write',async()=>{
  const api=vi.spyOn(helixAdminApi,'checkCare');function Harness(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>打开重试</button>{open&&<SeriesPresentationRetryDialog entry={{shelfEntryId:'focus',displayIdentity:'Show'}} onClose={()=>setOpen(false)} onComplete={async()=>{}}/>}</>;}
  render(<Harness/>);const trigger=screen.getByRole('button',{name:'打开重试'});trigger.focus();fireEvent.click(trigger);const dialog=screen.getByRole('dialog');expect(dialog).toHaveFocus();
  const last=screen.getByRole('button',{name:'重试任务',exact:true});last.focus();fireEvent.keyDown(last,{key:'Tab'});expect(screen.getByRole('button',{name:'关闭',exact:true})).toHaveFocus();
  fireEvent.keyDown(dialog,{key:'Escape'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();await waitFor(()=>expect(trigger).toHaveFocus());expect(api).not.toHaveBeenCalled();
});
it('guards Escape and return while a command is pending',async()=>{
  let resolve!:(value:never)=>void;vi.spyOn(helixAdminApi,'checkCare').mockImplementation(()=>new Promise(done=>{resolve=done;}));const cb=mount('entry');
  fireEvent.click(screen.getByRole('button',{name:'重试任务',exact:true}));await waitFor(()=>expect(screen.getByRole('button',{name:'返回',exact:true})).toBeDisabled());
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});fireEvent.click(screen.getByRole('button',{name:'关闭',exact:true}));expect(cb.onClose).not.toHaveBeenCalled();
  resolve({} as never);await waitFor(()=>expect(cb.onClose).toHaveBeenCalledTimes(1));
});
it('uses Chinese semantic feedback for a corrupt image and clears it on correction',async()=>{
  const api=vi.spyOn(helixAdminApi,'checkCare');mount('entry');fireEvent.change(screen.getByLabelText(/剧集海报/),{target:{files:[new File(['bad'],'corrupt.png',{type:'image/png'})]}});
  fireEvent.click(screen.getByRole('button',{name:'重试任务',exact:true}));const error=await screen.findByRole('alert');expect(error).toHaveClass('form-error');expect(error).toHaveTextContent('剧集海报无法读取');expect(error).not.toHaveTextContent('cannot be decoded');expect(api).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/剧集海报/),{target:{files:[new File(['valid'],'poster.jpg',{type:'image/jpeg'})]}});expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('maps a definite Owner rejection without exposing its English exception',async()=>{
  vi.spyOn(helixAdminApi,'checkCare').mockRejectedValue(new AdminApiError(409,'ARCA_SERIES_EXTERNAL_CHANGE','Registered Series file changed outside its accepted Inventory.'));mount('entry');
  fireEvent.click(screen.getByRole('button',{name:'重试任务',exact:true}));expect(await screen.findByRole('alert')).toHaveTextContent('剧集资料被其他程序修改');expect(screen.getByLabelText(/剧集海报/)).toBeEnabled();expect(screen.getByRole('button',{name:'重试任务',exact:true})).toBeEnabled();
});
