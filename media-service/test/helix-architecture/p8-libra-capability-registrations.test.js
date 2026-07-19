'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {createCapabilityRegistry}=require('../../src/helix/foundation/capability/capability-registry');
const {createExecutorDispatcher}=require('../../src/helix/foundation/capability/executor-dispatcher');
const {CONTRACTS,createLibraFrontHalfCapabilityRegistrations}=
  require('../../src/helix/domains/libra/capabilities/libra-front-half-capability-registrations');

const contractsRoot=path.resolve(__dirname,'../../src/helix/contracts/capabilities');
function manifests(){const result={};function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const target=path.join(directory,entry.name);if(entry.isDirectory())visit(target);else if(entry.name==='manifest.json'){
    const manifest=JSON.parse(fs.readFileSync(target,'utf8'));if(Object.hasOwn(CONTRACTS,manifest.capabilityRef))result[manifest.capabilityRef]=manifest;
  }}}visit(path.join(contractsRoot,'libra'));return result;}
function ports(calls){return Object.fromEntries(Object.keys(CONTRACTS).map((ref)=>[ref,Object.freeze({
  validateInputs(context){calls.push(['input',ref,context.capabilityRef]);},
  async execute(context){calls.push(['execute',ref,context.capabilityRef]);return {kind:'committed'};},
  validateResult(context){calls.push(['result',ref,context.capabilityRef]);}
})]));}

test('registers exactly seven Libra front-half contracts with their frozen Effect Classes',async()=>{
  const calls=[],registrations=createLibraFrontHalfCapabilityRegistrations({manifests:manifests(),ports:ports(calls)});
  assert.equal(registrations.length,7);const registry=createCapabilityRegistry({registrations,expectedCapabilityRefs:Object.keys(CONTRACTS)});
  const dispatcher=createExecutorDispatcher({registry,contractValidator:{validate(){}}});
  for(const [capabilityRef,effectClass] of Object.entries(CONTRACTS)){
    const outcome=await dispatcher.dispatch({capabilityRef,ownerDomain:'libra',context:{capabilityRef,contractVersion:1,executorVersion:1,
      effectClass,ownerScope:{domain:'libra'},parameters:{},fenceSnapshot:{},namedInputs:{}}});assert.deepEqual(outcome,{kind:'committed'});
  }
  assert.equal(calls.length,14);
});

test('rejects incomplete, wrong-owner, wrong-effect, and untyped Libra bindings',()=>{
  const exactManifests=manifests(),exactPorts=ports([]),ref='libra.intake.accept.commit@1';
  assert.throws(()=>createLibraFrontHalfCapabilityRegistrations({manifests:{...exactManifests,[ref]:undefined},ports:exactPorts}),
    (error)=>error.code==='P8_LIBRA_CAPABILITY_BINDING_INVALID'||error.code==='P8_LIBRA_CAPABILITY_SET_MISMATCH');
  assert.throws(()=>createLibraFrontHalfCapabilityRegistrations({manifests:{...exactManifests,[ref]:{...exactManifests[ref],ownerScope:'procurement'}},ports:exactPorts}),
    (error)=>error.code==='P8_LIBRA_CAPABILITY_BINDING_INVALID');
  assert.throws(()=>createLibraFrontHalfCapabilityRegistrations({manifests:{...exactManifests,[ref]:{...exactManifests[ref],effectClass:'domain_fact_commit'}},ports:exactPorts}),
    (error)=>error.code==='P8_LIBRA_CAPABILITY_BINDING_INVALID');
  assert.throws(()=>createLibraFrontHalfCapabilityRegistrations({manifests:exactManifests,ports:{...exactPorts,[ref]:{execute(){},validateInputs(){}}}}),
    (error)=>error.code==='P8_LIBRA_CAPABILITY_BINDING_INVALID');
});

test('Libra front-half registration has no Workflow, Store, Procurement internal, or legacy imports',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/libra/capabilities/libra-front-half-capability-registrations.js'),'utf8');
  assert.doesNotMatch(source,/require\([^)]*(workflow|runtime|persistence|store|procurement|legacy|kairox|nexora)/i);
});
