import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import PersonWorksDialog from '../src/helix/PersonWorksDialog';
import {helixAdminApi,type PeopleProjection,type PersonRelatedCollection} from '../src/helix/api';
const person={personId:'actor',canonicalName:'Actor',libraryKind:'us_adult'} as PeopleProjection['items'][number];
const work=(id:string)=>({shelfEntryId:id,displayIdentity:id,year:2026,currentInventoryRevision:4,shelfName:'Shelf',hasPoster:true,structureKind:'single' as const});
const page=(items:PersonRelatedCollection['items'],nextCursor:string|null=null):PersonRelatedCollection=>({personId:'actor',libraryKind:'us_adult',items,nextCursor});
function mount(value=person){return render(<MemoryRouter><PersonWorksDialog person={value} onClose={vi.fn()} onUnauthorized={vi.fn()}/></MemoryRouter>);}
afterEach(()=>vi.restoreAllMocks());
it('loads bounded pages, preserves current Inventory image versions and links to the exact collection entry',async()=>{
  const read=vi.spyOn(helixAdminApi,'readPersonCollection').mockResolvedValueOnce(page([work('entry a')],'cursor'))
    .mockResolvedValueOnce(page([work('entry a'),work('entry b')]));mount();
  const link=await screen.findByRole('link',{name:'entry a 2026 · Shelf'});
  expect(link).toHaveAttribute('href','/collection?entry=entry%20a');
  expect(link.querySelector('img')).toHaveAttribute('src',helixAdminApi.collectionPosterUrl('entry a',4,'wall'));
  fireEvent.click(screen.getByRole('button',{name:'加载更多作品'}));
  expect(await screen.findByRole('link',{name:'entry b 2026 · Shelf'})).toBeVisible();
  expect(screen.getAllByRole('link')).toHaveLength(2);expect(read.mock.calls).toEqual([['actor',undefined],['actor','cursor']]);
});
it('rejects a different Person library instead of displaying its works and retries the failed page',async()=>{
  const read=vi.spyOn(helixAdminApi,'readPersonCollection').mockResolvedValueOnce({...page([work('foreign')]),libraryKind:'jav'})
    .mockResolvedValueOnce(page([]));mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('相关作品读取失败');expect(screen.queryByRole('link')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'重试'}));
  expect(await screen.findByText('当前收藏中没有这位演员的作品。')).toBeVisible();expect(read).toHaveBeenCalledTimes(2);
});
it('discards an old Person response after the dialog changes identity',async()=>{
  let resolve!:(value:PersonRelatedCollection)=>void;
  vi.spyOn(helixAdminApi,'readPersonCollection').mockImplementationOnce(()=>new Promise(done=>{resolve=done;}))
    .mockResolvedValueOnce({personId:'other',libraryKind:'normal',items:[work('current')],nextCursor:null});
  const view=mount();view.rerender(<MemoryRouter><PersonWorksDialog person={{...person,personId:'other',libraryKind:'normal'}} onClose={vi.fn()} onUnauthorized={vi.fn()}/></MemoryRouter>);
  expect(await screen.findByRole('link',{name:'current 2026 · Shelf'})).toBeVisible();resolve(page([work('stale')]));
  await waitFor(()=>expect(screen.queryByText('stale')).not.toBeInTheDocument());
});
