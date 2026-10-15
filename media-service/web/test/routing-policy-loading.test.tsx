import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import RoutingPolicyPanel from '../src/helix/RoutingPolicyPanel';
import {canonicalDigest,helixAdminApi,type MaterialField,type Shelf,type RoutingPolicy} from '../src/helix/api';
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

it.each(['movie','series'] as const)('publishes %s identity predicates with matching digests', async profile => {
  vi.spyOn(helixAdminApi,'getRoutingPolicy').mockResolvedValue({policy:null});
  const publish=vi.spyOn(helixAdminApi,'publishRoutingPolicy').mockRejectedValue(new Error('captured'));
  const {container}=render(<RoutingPolicyPanel field={{...field,currentProfileHintSnapshot:{revision:1,contentProfileHint:profile}}} shelves={shelves.slice(0,1)}/>);
  expand(container); await screen.findByLabelText('模式');
  fireEvent.change(screen.getByLabelText('模式'),{target:{value:'sorting'}});
  fireEvent.change(screen.getByLabelText('事实类型'),{target:{value:'resolved_provider_identity'}});
  fireEvent.change(screen.getByLabelText('TMDB ID'),{target:{value:'1399'}});
  expect(screen.getByLabelText('TMDB ID')).toHaveValue('1399');
  fireEvent.change(screen.getByLabelText('比较方式'),{target:{value:'one_of'}});
  fireEvent.change(screen.getByLabelText('TMDB ID'),{target:{value:'1399, 42'}});
  fireEvent.click(screen.getByRole('button',{name:'发布策略'}));
  await waitFor(()=>expect(publish).toHaveBeenCalledOnce());
  const body=publish.mock.calls[0][1] as any;
  const identities=body.policy.targets[0].matchExpression.expectedValue;
  for (const [index,key] of ['1399','42'].entries()) {
    const identity={provider:'tmdb',namespace:`tmdb_${profile}`,providerKey:key,identityRevision:1};
    expect(identities[index]).toEqual({...identity,identityDigest:await canonicalDigest(identity)});
  }
});
it('preserves existing identity namespaces inside nested conditions on a Series field', async()=>{
  const identity={provider:'tmdb',namespace:'tmdb_movie',providerKey:'11',identityRevision:1,identityDigest:'old'};
  vi.spyOn(helixAdminApi,'getRoutingPolicy').mockResolvedValue({policy:{routingPolicyId:'existing',revision:2,mode:'sorting',targets:[{shelfId:'shelf-a',rank:1,matchExpression:{nodeKind:'not',child:{nodeKind:'predicate',factKind:'resolved_provider_identity',operator:'eq',expectedValue:identity}}}]} as RoutingPolicy});
  const publish=vi.spyOn(helixAdminApi,'publishRoutingPolicy').mockRejectedValue(new Error('captured'));
  const {container}=render(<RoutingPolicyPanel field={{...field,currentProfileHintSnapshot:{revision:1,contentProfileHint:'series'}}} shelves={shelves}/>);
  expand(container);
  expect(await screen.findByLabelText('TMDB ID')).toHaveValue('11');
  fireEvent.change(screen.getByLabelText('TMDB ID'),{target:{value:'12'}});
  fireEvent.change(screen.getByLabelText('比较方式'),{target:{value:'one_of'}});
  fireEvent.click(screen.getByRole('button',{name:'发布策略'}));
  await waitFor(()=>expect(publish).toHaveBeenCalledOnce());
  const body=publish.mock.calls[0][1] as any;
  const expected={provider:'tmdb',namespace:'tmdb_movie',providerKey:'12',identityRevision:1};
  expect(body.policy.targets[0].matchExpression.child.expectedValue).toEqual([{...expected,identityDigest:await canonicalDigest(expected)}]);
});
it('opens the linked source configuration immediately without opening other sources',async()=>{
  const load=vi.spyOn(helixAdminApi,'getRoutingPolicy').mockResolvedValue({policy:null});
  const {container}=render(<><RoutingPolicyPanel field={field} shelves={shelves} initiallyOpen/><RoutingPolicyPanel field={{...field,fieldId:'other'}} shelves={shelves}/></>);
  expect(await screen.findByLabelText('目标收藏架')).toBeVisible();
  expect(container.querySelectorAll('details[open]')).toHaveLength(1);
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith('field-a');
});
