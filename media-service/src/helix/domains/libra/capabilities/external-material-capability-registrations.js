'use strict';

const CONTRACTS=Object.freeze({
  'libra.external_material.query.prepare@1':'pure_observation','libra.external_material.search@1':'pure_observation',
  'libra.external_material.candidate.select@1':'pure_observation','libra.external_material.acquire.request@1':'external_request',
  'libra.external_material.acquire.observe@1':'pure_observation','libra.external_material.output.resolve@1':'pure_observation',
  'libra.external_material.stability.observe@1':'pure_observation','libra.external_material.identity.verify@1':'pure_observation',
  'libra.external_material.package.verify@1':'pure_observation','libra.workspace.material.import@1':'workspace_write'
});
class ExternalMaterialCapabilityRegistrationError extends Error{constructor(code,message){super(message);this.name='ExternalMaterialCapabilityRegistrationError';this.code=code;}}
const fail=(code,message)=>{throw new ExternalMaterialCapabilityRegistrationError(code,message);};
function createExternalMaterialCapabilityRegistrations(options){
  const refs=Object.keys(CONTRACTS),manifests=options?.manifests||{},ports=options?.ports||{};
  if(JSON.stringify(Object.keys(manifests).sort())!==JSON.stringify([...refs].sort())||JSON.stringify(Object.keys(ports).sort())!==JSON.stringify([...refs].sort()))
    fail('P9_EXTERNAL_CAPABILITY_SET','External acquisition requires exactly ten frozen bindings.');
  return Object.freeze(refs.map((capabilityRef)=>{
    const manifest=manifests[capabilityRef],port=ports[capabilityRef];
    if(manifest?.capabilityRef!==capabilityRef||manifest.ownerScope!=='libra'||manifest.effectClass!==CONTRACTS[capabilityRef]||
        manifest.contractVersion!==1||typeof port?.execute!=='function'||typeof port?.validateInputs!=='function'||typeof port?.validateResult!=='function')
      fail('P9_EXTERNAL_CAPABILITY_BINDING','External acquisition Capability binding drifted.');
    return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),semanticValidator:Object.freeze({
      ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),validateResult:(context,outcome)=>port.validateResult(context,outcome)})});
  }));
}
module.exports=Object.freeze({CONTRACTS,ExternalMaterialCapabilityRegistrationError,createExternalMaterialCapabilityRegistrations});
