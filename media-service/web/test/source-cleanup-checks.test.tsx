import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SessionProvider} from '../src/helix/session';
import SourceCleanupChecks from '../src/helix/SourceCleanupChecks';
import {helixAdminApi} from '../src/helix/api';

afterEach(()=>vi.restoreAllMocks());

it('shows the exact pending source separately and opens inspection without archive authorization',async()=>{
  vi.spyOn(helixAdminApi,'listRecycle').mockResolvedValue({items:[],cleanupChecks:[{onDeckRunId:'run-1',shelfEntryId:'entry-1',state:'attention',checkedAtMs:1,checks:[{sourceLocation:'/source/movie',state:'awaiting_confirmation'}]}]});
  const archive=vi.spyOn(helixAdminApi,'archiveRecycle'),inspect=vi.fn();render(<SessionProvider><SourceCleanupChecks onInspect={inspect}/></SessionProvider>);
  expect(await screen.findByText('/source/movie')).toBeInTheDocument();
  expect(screen.getByText('有剩余文件，等待确认具体清单')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'检查这部影片的具体清单'}));
  expect(inspect).toHaveBeenCalledWith('entry-1');expect(archive).not.toHaveBeenCalled();
});

it('replaces paginated cleanup records and returns to the previous cursor',async()=>{
  const list=vi.spyOn(helixAdminApi,'listRecycle').mockImplementation(async(cursor)=>({items:[],cleanupNextCursor:cursor?null:'next',cleanupChecks:[{onDeckRunId:cursor?'two':'one',shelfEntryId:'entry',state:'attention',checkedAtMs:1,checks:[{sourceLocation:cursor?'/second':'/first',state:'blocked',errorCode:'EACCES'}]}]}));
  render(<SessionProvider><SourceCleanupChecks onInspect={vi.fn()}/></SessionProvider>);await screen.findByText('/first');
  fireEvent.click(screen.getByRole('button',{name:'下一页'}));await screen.findByText('/second');
  expect(screen.queryByText('/first')).not.toBeInTheDocument();expect(list).toHaveBeenLastCalledWith('next');
  fireEvent.click(screen.getByRole('button',{name:'上一页'}));await waitFor(()=>expect(screen.getByText('/first')).toBeInTheDocument());
  expect(screen.queryByText('/second')).not.toBeInTheDocument();
});
