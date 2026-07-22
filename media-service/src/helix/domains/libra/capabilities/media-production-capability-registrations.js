'use strict';

const CONTRACTS=Object.freeze({
  'libra.transcode.input.verify@1':'pure_observation',
  'libra.media.remux@1':'workspace_write',
  'libra.media.transcode@1':'workspace_write',
  'libra.product_media.verify@1':'pure_observation',
  'libra.product_output.select@1':'pure_observation',
  'libra.product.conformance.verify@1':'pure_observation'
});
class MediaProductionCapabilityRegistrationError extends Error{
  constructor(code,message){super(message);this.name='MediaProductionCapabilityRegistrationError';this.code=code;}
}
const fail=(code,message)=>{throw new MediaProductionCapabilityRegistrationError(code,message);};
const exact=(value,keys)=>value&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
function createMediaProductionCapabilityRegistrations(options){
  const refs=Object.keys(CONTRACTS);
  if(!options||!exact(options.manifests,refs)||!exact(options.ports,refs))fail('P9_MEDIA_CAPABILITY_SET','Media production requires exactly six frozen Capability bindings.');
  return Object.freeze(refs.map((capabilityRef)=>{
    const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];
    if(!manifest||manifest.capabilityRef!==capabilityRef||manifest.ownerScope!=='libra'||manifest.effectClass!==CONTRACTS[capabilityRef]||
        manifest.contractVersion!==1||!port||typeof port.execute!=='function'||typeof port.validateInputs!=='function'||typeof port.validateResult!=='function')
      fail('P9_MEDIA_CAPABILITY_BINDING','Media production Capability binding drifted from the frozen contract.');
    return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),
      semanticValidator:Object.freeze({ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),
        validateResult:(context,outcome)=>port.validateResult(context,outcome)})});
  }));
}
module.exports=Object.freeze({CONTRACTS,MediaProductionCapabilityRegistrationError,createMediaProductionCapabilityRegistrations});
