'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const test=require('node:test');
const {createCapabilityRegistry}=require('../../src/helix/foundation/capability/capability-registry');
const {createExecutorDispatcher}=require('../../src/helix/foundation/capability/executor-dispatcher');
const {CONTRACTS,createMediaProductionCapabilityRegistrations}=require('../../src/helix/domains/libra/capabilities/media-production-capability-registrations');
const root=path.resolve(__dirname,'../../src/helix/contracts/capabilities/libra');
function manifests(){const result={};(function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);
  if(entry.isDirectory())visit(target);else if(entry.name==='manifest.json'){const manifest=JSON.parse(fs.readFileSync(target,'utf8'));if(Object.hasOwn(CONTRACTS,manifest.capabilityRef))result[manifest.capabilityRef]=manifest;}}})(root);return result;}
function ports(calls){return Object.fromEntries(Object.keys(CONTRACTS).map((ref)=>[ref,{validateInputs(context){calls.push(['input',ref,context.capabilityRef]);},
  async execute(context){calls.push(['execute',ref,context.capabilityRef]);return {kind:'fixture'};},validateResult(){}}]));}
test('registers exactly six P9 media contracts with frozen owners and Effect Classes',async()=>{const calls=[],registrations=createMediaProductionCapabilityRegistrations({manifests:manifests(),ports:ports(calls)});
  assert.equal(registrations.length,6);const dispatcher=createExecutorDispatcher({registry:createCapabilityRegistry({registrations,expectedCapabilityRefs:Object.keys(CONTRACTS)}),contractValidator:{validate(){}}});
  for(const [capabilityRef,effectClass]of Object.entries(CONTRACTS))assert.deepEqual(await dispatcher.dispatch({capabilityRef,ownerDomain:'libra',context:{capabilityRef,contractVersion:1,executorVersion:1,effectClass,ownerScope:{domain:'libra'},parameters:{},fenceSnapshot:{},namedInputs:{}}}),{kind:'fixture'});
  assert.equal(calls.length,12);});
test('rejects missing and owner-drifted media bindings',()=>{const exact=manifests(),typed=ports([]),ref='libra.media.transcode@1';
  assert.throws(()=>createMediaProductionCapabilityRegistrations({manifests:{...exact,[ref]:undefined},ports:typed}),(error)=>error.code==='P9_MEDIA_CAPABILITY_SET'||error.code==='P9_MEDIA_CAPABILITY_BINDING');
  assert.throws(()=>createMediaProductionCapabilityRegistrations({manifests:{...exact,[ref]:{...exact[ref],ownerScope:'platform-settings'}},ports:typed}),(error)=>error.code==='P9_MEDIA_CAPABILITY_BINDING');});
test('registration imports no Workflow, Store, legacy Runtime, or other Domain internals',()=>{const source=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/libra/capabilities/media-production-capability-registrations.js'),'utf8');
  assert.doesNotMatch(source,/require\([^)]*(workflow|runtime|persistence|store|procurement|arca|legacy|kairox|nexora)/i);});
