'use strict';

const {buildWorkspaceMediaHandle}=require('../model/media-production-contracts');

class MediaProductionCoordinatorError extends Error{
  constructor(code,message){super(message);this.name='MediaProductionCoordinatorError';this.code=code;}
}
const fail=(code,message)=>{throw new MediaProductionCoordinatorError(code,message);};

function createMediaProductionCoordinator(options){
  if(!options?.mediaEffectPort||typeof options.mediaEffectPort.executeRemux!=='function'||typeof options.mediaEffectPort.executeTranscode!=='function')
    fail('P9_MEDIA_EFFECT_PORT','A typed media Effect port is required.');
  async function execute(kind,value){
    if(kind==='encode'&&value.transcodeInputVerification?.result!=='passed')
      fail('P9_TRANSCODE_INPUT_NOT_VERIFIED','Transcode requires the exact passed input verification.');
    if(value.outputTarget?.productionIntentDigest!==value.productionIntent?.intentDigest)
      fail('P9_MEDIA_TARGET_INTENT','Output target and production intent do not match.');
    const receipt=await (kind==='remux'?options.mediaEffectPort.executeRemux(value):options.mediaEffectPort.executeTranscode(value));
    if(!receipt||receipt.outputTargetId!==value.outputTarget.targetId||receipt.outputTargetDigest!==value.outputTarget.targetDigest||
        receipt.effectScopeDigest!==value.outputTarget.effectScopeDigest)
      fail('P9_MEDIA_EFFECT_RECEIPT','Media Effect receipt does not bind the frozen target.');
    return buildWorkspaceMediaHandle({sourceHandle:value.sourceHandle,outputTarget:value.outputTarget,
      workspaceMaterialHandle:receipt.workspaceMaterialHandle,productionIntentKind:kind,productionIntent:value.productionIntent,
      deviceSnapshot:kind==='encode'?value.deviceSnapshot:null,producingEventId:value.producingEventId,effectReceipt:receipt});
  }
  return Object.freeze({executeRemux:(value)=>execute('remux',value),executeTranscode:(value)=>execute('encode',value)});
}

module.exports=Object.freeze({MediaProductionCoordinatorError,createMediaProductionCoordinator});
