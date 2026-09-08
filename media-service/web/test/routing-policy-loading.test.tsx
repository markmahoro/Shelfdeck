import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import RoutingPolicyPanel from '../src/helix/RoutingPolicyPanel';
import {helixAdminApi,type MaterialField,type Shelf} from '../src/helix/api';
const field={fieldId:'field-a'} as MaterialField;
const shelves=[{shelfId:'shelf-a',name:'收藏架A',status:'active'},{shelfId:'shelf-b',name:'收藏架B',status:'active'}] as Shelf[];
function expand(container:HTMLElement){const details=container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));}
afterEach(()=>vi.restoreAllMocks());
it('loads only expanded policies and preserves drafts across refreshed Field and Shelf objects',async()=>{
  const load=vi.spyOn(helixAdminApi,'getRoutingPolicy').mockResolvedValue({policy:null});
  const {container,rerender}=render(<RoutingPolicyPanel field={field} shelves={shelves}/>);
  expect(load).not.toHaveBeenCalled();
  expand(container);
  const select=await screen.findByLabelText('目标收藏架');
  fireEvent.change(select,{target:{value:'shelf-b'}});
  rerender(<RoutingPolicyPanel field={{...field}} shelves={shelves.map(shelf=>({...shelf}))}/>);
  expect(load).toHaveBeenCalledTimes(1);
  expect(select).toHaveValue('shelf-b');
  const details=container.querySelector('details')!;details.open=false;fireEvent(details,new Event('toggle'));expand(container);
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('目标收藏架')).toHaveValue('shelf-b');
});
it('keeps editing unavailable after a failed read and retries only on request',async()=>{
  const load=vi.spyOn(helixAdminApi,'getRoutingPolicy').mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce({policy:null});
  const {container}=render(<RoutingPolicyPanel field={field} shelves={shelves}/>);expand(container);
  expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
  expect(screen.queryByRole('button',{name:'发布策略'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'重新读取分拣策略'}));
  expect(await screen.findByRole('button',{name:'发布策略'})).toBeEnabled();
  expect(load).toHaveBeenCalledTimes(2);
});
it('does not apply a late policy response from a previous field',async()=>{
  let resolveOld!:(value:{policy:null})=>void;
  vi.spyOn(helixAdminApi,'getRoutingPolicy').mockImplementation(id=>id==='field-a'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve({policy:null}));
  const {container,rerender}=render(<RoutingPolicyPanel field={field} shelves={shelves}/>);expand(container);
  await waitFor(()=>expect(resolveOld).toBeTypeOf('function'));
  rerender(<RoutingPolicyPanel field={{...field,fieldId:'field-b'}} shelves={shelves}/>);
  const select=await screen.findByLabelText('目标收藏架');fireEvent.change(select,{target:{value:'shelf-b'}});
  resolveOld({policy:null});await Promise.resolve();
  expect(select).toHaveValue('shelf-b');
});
