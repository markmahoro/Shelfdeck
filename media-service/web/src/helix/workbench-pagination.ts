export type StreamCursor={cursor?:string;skip:number;done:boolean};
export type WorkbenchCursor=StreamCursor[];
type Page<T>={items:T[];nextCursor:string|null};
export async function readWorkbenchPage<T>(readers:Array<(cursor?:string)=>Promise<Page<T>>>,
  position:WorkbenchCursor|undefined,compare:(a:T,b:T)=>number,onPartial?:(items:T[])=>void,limit=25){
  const candidates:Array<{item:T;stream:number;after:StreamCursor}>=[];
  const ends=await Promise.all(readers.map(async(read,stream)=>{
    let current=position?.[stream]||{skip:0,done:false},available=0;
    if(current.done)return current;
    // At most two bounded Owner pages: the remainder of this page and the next.
    const requestLimit=current.skip>0?2:1;
    for(let request=0;request<requestLimit&&!current.done&&available<limit;request++){
      const page=await read(current.cursor),start=current.skip;
      for(let index=start;index<page.items.length;index++){
        const after=index+1<page.items.length?{cursor:current.cursor,skip:index+1,done:false}:
          {cursor:page.nextCursor||undefined,skip:0,done:!page.nextCursor};
        candidates.push({item:page.items[index],stream,after});available++;
      }
      if(onPartial)onPartial([...candidates].sort((a,b)=>compare(a.item,b.item)).slice(0,limit).map(row=>row.item));
      if(page.nextCursor&&page.nextCursor===current.cursor)throw new Error('媒体整理分页游标没有前进。');
      current={cursor:page.nextCursor||undefined,skip:0,done:!page.nextCursor};
    }
    return current;
  }));
  const selected=candidates.sort((a,b)=>compare(a.item,b.item)).slice(0,limit);
  const next=readers.map((_,stream)=>{
    const consumed=selected.filter(row=>row.stream===stream);
    if(consumed.length)return consumed[consumed.length-1].after;
    if(!candidates.some(row=>row.stream===stream))return ends[stream];
    return position?.[stream]||{skip:0,done:false};
  });
  return {items:selected.map(row=>row.item),nextCursor:next.some(row=>!row.done)?next:null};
}
