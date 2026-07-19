'use strict';

const CONTRACTS=Object.freeze({
  'libra.decision.query.resolve@1':'pure_observation',
  'libra.decision_basis.commit@1':'domain_fact_commit',
  'libra.intake.candidate.verify@1':'pure_observation',
  'libra.intake.material.verify@1':'pure_observation',
  'libra.intake.binding.resolve@1':'pure_observation',
  'libra.intake.accept.commit@1':'responsibility_control_commit',
  'libra.intake.rejection.commit@1':'domain_fact_commit'
});

class LibraFrontHalfCapabilityRegistrationError extends Error{
  constructor(code,message,details={}){super(message);this.name='LibraFrontHalfCapabilityRegistrationError';this.code=code;this.details=details;}
}
function fail(code,message,details){throw new LibraFrontHalfCapabilityRegistrationError(code,message,details);}
function exactKeys(value,expected){return value&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...expected].sort());}

function createLibraFrontHalfCapabilityRegistrations(options){
  const refs=Object.keys(CONTRACTS);
  if(!options||!exactKeys(options.manifests,refs)||!exactKeys(options.ports,refs)){
    fail('P8_LIBRA_CAPABILITY_SET_MISMATCH','Libra front half requires exactly its seven frozen Capability manifests and typed ports.');
  }
  return Object.freeze(refs.map((capabilityRef)=>{
    const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];
    if(!manifest||manifest.capabilityRef!==capabilityRef||manifest.ownerScope!=='libra'||
        manifest.effectClass!==CONTRACTS[capabilityRef]||manifest.contractVersion!==1||!port||
        typeof port.execute!=='function'||typeof port.validateInputs!=='function'||typeof port.validateResult!=='function'){
      fail('P8_LIBRA_CAPABILITY_BINDING_INVALID','Libra front-half Capability binding drifted from its frozen P2 contract.',{capabilityRef});
    }
    return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),
      semanticValidator:Object.freeze({ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),
        validateResult:(context,outcome)=>port.validateResult(context,outcome)})});
  }));
}

module.exports=Object.freeze({CONTRACTS,LibraFrontHalfCapabilityRegistrationError,createLibraFrontHalfCapabilityRegistrations});
