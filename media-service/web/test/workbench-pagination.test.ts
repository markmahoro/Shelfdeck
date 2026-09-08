import {expect,it,vi} from 'vitest';
import {readWorkbenchPage,type WorkbenchCursor} from '../src/helix/workbench-pagination';

it('UAT-212 merges Owner pages without omissions, duplicates or unbounded prefetch',async()=>{
  const readers=[0,1].map(parity=>vi.fn(async(cursor?:string)=>{
    const offset=Number(cursor||0),items=Array.from({length:60},(_,index)=>index*2+parity).slice(offset,offset+25);
    return {items,nextCursor:offset+25<60?String(offset+25):null};
  }));
  let cursor:WorkbenchCursor|undefined;const received:number[]=[];
  do{
    const before=readers.map(read=>read.mock.calls.length);
    const result=await readWorkbenchPage(readers,cursor,(a,b)=>a-b);
    expect(result.items.length).toBeLessThanOrEqual(25);
    readers.forEach((read,index)=>expect(read.mock.calls.length-before[index]).toBeLessThanOrEqual(2));
    received.push(...result.items);cursor=result.nextCursor||undefined;
  }while(cursor);
  expect(received).toEqual(Array.from({length:120},(_,index)=>index));
  expect((await readWorkbenchPage(readers,undefined,(a,b)=>a-b)).items).toEqual(received.slice(0,25));
});

it('UAT-212 empty bounded pages advance and invalid repeating cursors fail explicitly',async()=>{
  const read=vi.fn(async(cursor?:string)=>({items:cursor?[1]:[],nextCursor:cursor?null:'next'}));
  const first=await readWorkbenchPage([read],undefined,(a,b)=>a-b);
  expect(first.items).toEqual([]);expect(read).toHaveBeenCalledTimes(1);
  expect((await readWorkbenchPage([read],first.nextCursor!,(a,b)=>a-b)).items).toEqual([1]);
  await expect(readWorkbenchPage([async()=>({items:[],nextCursor:'same'})],[{cursor:'same',skip:0,done:false}],()=>0)).rejects.toThrow('游标没有前进');
});
