'use strict';

const CONTRACTS=Object.freeze({'libra.product_package.publish@1':'pure_observation','libra.workspace.cleanup.commit@1':'pure_observation','libra.workspace.material.reclaim@1':'workspace_write'});
class DeliveryLifecycleCapabilityRegistrationError extends Error{constructor(code,message){super(message);this.name='DeliveryLifecycleCapabilityRegistrationError';this.code=code;}}
const fail=(code,message)=>{throw new DeliveryLifecycleCapabilityRegistrationError(code,message);};
function createDeliveryLifecycleCapabilityRegistrations(options){
  const refs=Object.keys(CONTRACTS),manifests=options?.manifests||{},ports=options?.ports||{};
  if(JSON.stringify(Object.keys(manifests).sort())!==JSON.stringify([...refs].sort())||JSON.stringify(Object.keys(ports).sort())!==JSON.stringify([...refs].sort()))fail('P9_DELIVERY_CAPABILITY_SET','Delivery lifecycle requires exactly three frozen bindings.');
  return Object.freeze(refs.map((capabilityRef)=>{const manifest=manifests[capabilityRef],port=ports[capabilityRef];if(manifest?.capabilityRef!==capabilityRef||manifest.ownerScope!=='libra'||manifest.effectClass!==CONTRACTS[capabilityRef]||manifest.contractVersion!==1||typeof port?.execute!=='function'||typeof port?.validateInputs!=='function'||typeof port?.validateResult!=='function')fail('P9_DELIVERY_CAPABILITY_BINDING','Delivery lifecycle Capability binding drifted.');return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),semanticValidator:Object.freeze({ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),validateResult:(context,outcome)=>port.validateResult(context,outcome)})});}));
}
module.exports=Object.freeze({CONTRACTS,DeliveryLifecycleCapabilityRegistrationError,createDeliveryLifecycleCapabilityRegistrations});
