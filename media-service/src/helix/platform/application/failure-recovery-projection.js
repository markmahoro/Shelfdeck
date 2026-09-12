'use strict';
const {canonicalDigest}=require('../../contracts/canonical-json');

function providerRecoveryDigest(snapshot) {
  const integration=snapshot?.integration,config=integration?.config;
  return canonicalDigest({state:integration?.state||'absent',endpoint:config?.endpoint||null,
    credentialDigest:config?.secretEnvelopeDigest||null,settings:config?.settings||null,
    capabilities:config?.capabilityCodes||[],landingBinding:config?.landingBinding||null});
}
function computeRecoveryDigest(runtime) {
  if(!runtime)return canonicalDigest({devices:[]});
  const body={queryContract:'platform.compute-ready-device-refs@1',limit:64};
  const listed=runtime.listReadyDeviceRefs({...body,queryDigest:canonicalDigest(body)});
  if(listed.resultKind!=='available'||listed.items.length>=64)throw new Error('Compute recovery projection is unavailable or exceeds its bound.');
  const devices=listed.items.map(ref=>{
    const query={deviceId:ref.deviceId,expectedProbeRevision:ref.probeRevision,expectedCapabilityDigest:ref.capabilityDigest};
    const result=runtime.readDeviceSnapshot({...query,queryDigest:canonicalDigest(query)});
    if(result.resultKind!=='found')throw new Error('Compute recovery projection changed during read.');
    const payload=JSON.parse(JSON.stringify(result.snapshot.capabilityPayload,(key,value)=>key==='selfTestDigest'?undefined:value));
    return {deviceId:ref.deviceId,deviceClass:ref.deviceClass,capability:payload};
  }).sort((a,b)=>a.deviceId.localeCompare(b.deviceId));
  return canonicalDigest({devices});
}
module.exports=Object.freeze({providerRecoveryDigest,computeRecoveryDigest});
