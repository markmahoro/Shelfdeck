import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import WatchedControl from '../src/helix/WatchedControl';
import {helixAdminApi} from '../src/helix/api';

afterEach(()=>vi.restoreAllMocks());
function projection(watchedState:boolean|null,expectedRevision:number,sourceKind:string|null='shelfdeck_direct'){
  return {items:[],nextCursor:null,currentWatched:{state:'ready' as const,watchedState,sourceKind,expectedRevision}};
}
it('sets false explicitly and clears only its own watched mark',async()=>{
  const read=vi.spyOn(helixAdminApi,'listPerceptionRecords').mockResolvedValue(projection(null,0,null));
  const submit=vi.spyOn(helixAdminApi,'setWatched').mockResolvedValue({operationRef:'watch',state:'accepted',expectedResultRevision:1});
  render(<WatchedControl targetType="shelf_entry" targetId="entry" label="影片"/>);
  await screen.findByText('未标记');await waitFor(()=>expect(screen.getByRole('button',{name:'未看'})).toBeEnabled());
  read.mockResolvedValue(projection(false,1));fireEvent.click(screen.getByRole('button',{name:'未看'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'未看'})).toHaveAttribute('aria-pressed','true'));
  expect(submit).toHaveBeenLastCalledWith('shelf_entry','entry',0,false);
  submit.mockResolvedValue({operationRef:'clear',state:'accepted',expectedResultRevision:2});read.mockResolvedValue(projection(null,2,null));
  fireEvent.click(screen.getByRole('button',{name:'清除我的标记'}));await screen.findByText('未标记');
  expect(submit).toHaveBeenLastCalledWith('shelf_entry','entry',1,null);expect(screen.queryByRole('button',{name:'清除我的标记'})).not.toBeInTheDocument();
});
it('reports a conflict and reloads the current state without claiming success',async()=>{
  vi.spyOn(helixAdminApi,'listPerceptionRecords').mockResolvedValue(projection(true,3));
  vi.spyOn(helixAdminApi,'setWatched').mockRejectedValue(new Error('标记已改变，请重试。'));
  render(<WatchedControl targetType="subject" targetId="subject" label="影片"/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'未看'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'未看'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('标记已改变，请重试。');
  await waitFor(()=>expect(screen.getByRole('button',{name:'已看'})).toHaveAttribute('aria-pressed','true'));
});
it('cannot clear a watched observation inherited from the accepted Subject',async()=>{
  vi.spyOn(helixAdminApi,'listPerceptionRecords').mockResolvedValue(projection(true,0));
  render(<WatchedControl targetType="shelf_entry" targetId="entry" label="影片"/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'已看'})).toBeEnabled());
  expect(screen.queryByRole('button',{name:'清除我的标记'})).not.toBeInTheDocument();
});
