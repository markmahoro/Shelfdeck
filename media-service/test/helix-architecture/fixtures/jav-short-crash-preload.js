'use strict';

const fs=require('node:fs');
const path=require('node:path');
const filename=require.resolve('../../../src/clean-arca-inventory-port');
const actual=require(filename),phase=process.env.JAV_SHORT_CRASH_PHASE;
const originalOpen=fs.openSync,originalMkdir=fs.mkdirSync,originalLink=fs.linkSync,
  originalAsyncLink=fs.promises.link,originalWriteStream=fs.createWriteStream;
let stageRequest=null,placementRequest=null;

function crash(request,point) {
  if (phase!==point) return;
  const target=request.shelf.target.rootLocation;
  fs.writeFileSync(process.env.JAV_SHORT_CRASH_PROOF,JSON.stringify({point,root:path.dirname(target),target,
    decisionDigest:request.finalInventoryDecision?.decisionDigest}));
  process.exit(79);
}

fs.openSync=function(file,flags,...rest){
  const fd=originalOpen.call(fs,file,flags,...rest);
  if(stageRequest&&flags==='wx+'&&String(file).includes('.tmp-'))crash(stageRequest,'stage_create_gap');
  return fd;
};
fs.createWriteStream=function(file,options){
  const stream=originalWriteStream.call(fs,file,options);
  if(stageRequest&&phase==='stage_copy_partial'&&String(file).includes('.tmp-')){
    const write=stream._write.bind(stream);
    stream._write=(chunk,encoding,done)=>write(chunk,encoding,error=>{
      if(!error)crash(stageRequest,'stage_copy_partial');
      done(error);
    });
  }
  return stream;
};
fs.promises.link=async function(source,target){
  const result=await originalAsyncLink.call(fs.promises,source,target);
  if(stageRequest&&String(target).includes('.shelfdeck-stage-'))crash(stageRequest,'stage_mid_link');
  return result;
};
fs.mkdirSync=function(directory,...rest){
  const result=originalMkdir.call(fs,directory,...rest);
  if(placementRequest&&directory===path.dirname(placementRequest.finalInventoryDecision.members[0].targetLocation))
    crash(placementRequest,'directory_create_gap');
  return result;
};
fs.linkSync=function(source,target){
  if(placementRequest)crash(placementRequest,'directory_created');
  const result=originalLink.call(fs,source,target);
  if(placementRequest)crash(placementRequest,'placement_mid_link');
  return result;
};

require.cache[filename].exports={...actual,createCleanArcaInventoryPort(options){
  const port=actual.createCleanArcaInventoryPort(options);
  return Object.freeze({...port,
    async stage(request){stageRequest=request;try{const result=await port.stage(request);crash(request,'stage');return result;}finally{stageRequest=null;}},
    async verifyStaged(request){crash(request,'verify');return port.verifyStaged(request);},
    async switchPlacement(request){placementRequest=request;try{const result=await port.switchPlacement(request);crash(request,'placement');return result;}finally{placementRequest=null;}},
  });
}};

if(process.env.JAV_SHORT_CRASH_CREDENTIAL){
  const safety=require.resolve('../../../scripts/helix-operational-safety'),original=require(safety);
  require.cache[safety].exports={...original,initializeCleanData(options){
    const result=original.initializeCleanData(options);
    fs.writeFileSync(process.env.JAV_SHORT_CRASH_CREDENTIAL,result.adminApiKey,{mode:0o600});
    return result;
  }};
}
