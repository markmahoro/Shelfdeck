'use strict';
function samplingPoints(durationMs){
  if(!Number.isSafeInteger(durationMs)||durationMs<1)throw Object.assign(new TypeError('A known positive video duration is required.'),{code:'BUFFALO_VIDEO_EVIDENCE_INVALID'});
  const seen=new Set(),initial=[],supplement=[];
  for(const [stage,offset,result]of [['initial',0.5,initial],['supplement',0.25,supplement]])for(let stratum=0;stratum<20;stratum++){
    const timestampMs=Math.min(durationMs-1,Math.floor(durationMs*(0.05+0.9*(stratum+offset)/20)));
    if(!seen.has(timestampMs)){seen.add(timestampMs);result.push(Object.freeze({stage,stratum,timestampMs}));}
  }
  return Object.freeze({initial:Object.freeze(initial),supplement:Object.freeze(supplement)});
}
module.exports=Object.freeze({samplingPoints});
