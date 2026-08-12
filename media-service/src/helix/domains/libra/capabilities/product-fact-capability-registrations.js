'use strict';

const { IDENTITY, MEDIA_CAST_RESOLVE, MEDIA_CAST_COMMIT, METADATA_COMMIT } = require('./product-fact-capability-ports');

function createProductFactCapabilityRegistrations(options) {
  const effects=Object.freeze({[IDENTITY]:'domain_fact_commit',[MEDIA_CAST_RESOLVE]:'pure_observation',
    [MEDIA_CAST_COMMIT]:'domain_fact_commit',[METADATA_COMMIT]:'domain_fact_commit'});
  if(JSON.stringify(Object.keys(options?.manifests||{}).sort())!==JSON.stringify(Object.keys(effects).sort())||
      JSON.stringify(Object.keys(options?.ports||{}).sort())!==JSON.stringify(Object.keys(effects).sort()))
    throw new TypeError('Product Fact Capability set is incomplete.');
  return Object.freeze(Object.keys(effects).map((capabilityRef)=>{
    const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];
    if(!manifest||manifest.capabilityRef!==capabilityRef||manifest.ownerScope!=='libra'||manifest.effectClass!==effects[capabilityRef]||
        manifest.contractVersion!==1||!port||typeof port.execute!=='function')
      throw new TypeError('Product Fact Capability binding is invalid: '+capabilityRef);
    return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),
      semanticValidator:Object.freeze({ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),
        validateResult:(context,outcome)=>port.validateResult(context,outcome)})});
  }));
}

module.exports=Object.freeze({createProductFactCapabilityRegistrations});
