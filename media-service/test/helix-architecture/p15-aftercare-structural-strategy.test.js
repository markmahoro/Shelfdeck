'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {assessMediaRepairStrategy}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const digest=value=>canonicalDigest({value});
function device(deviceId,deviceClass,supported=true){return {deviceId,deviceClass,snapshotDigest:digest(deviceId+supported),
  capabilityPayload:{supportedVideoCodecs:['hevc'],supportedRateControlModes:['quality_bound'],
    validatedVideoPipelines:supported?[{pipelineProfileId:'ordinary_to_hevc@1',inputDynamicRangeKinds:['sdr'],inputPixelFormats:['yuv420p']}]:[]}};}
function options(devices){return {mediaEffectPort:{verifyTranscodeInput(){throw Error('Health checks must not execute FFmpeg.');}},
  platformComputeRuntime:{listReadyDeviceRefs:()=>({resultKind:'available',items:devices.map(item=>({deviceId:item.deviceId,probeRevision:1,capabilityDigest:item.snapshotDigest}))}),
    readDeviceSnapshot:({deviceId})=>({resultKind:'found',snapshot:devices.find(item=>item.deviceId===deviceId)})}};}
const probe={videoStreams:[{dispositionDefault:true,dynamicRangeKind:'sdr',pixelFormat:'yuv420p'}]},evidence={evidenceId:'probe',payloadDigest:digest('probe')};
const context=index=>({shelfEntryId:'entry-'+index,basis:{digest:digest(index)},raw:{entry:{structure_kind:'movie'},facts:[],
  standard:{value:{profileRuleSets:[{contentProfile:'movie',baseRequirements:{}}]}},
  materials:[{role:'primary_payload',material_key:digest('material-'+index),endpoint_id:'endpoint',location:'movie.mkv',binding_revision:1}]}});

test('one hundred changed Entries select validated GPU strategies without invoking encoder preflight',async()=>{
  const input=options([device('cpu','software_cpu'),device('gpu','intel_qsv')]);
  for(let index=0;index<100;index++){
    const result=await assessMediaRepairStrategy(input,context(index),probe,evidence);
    assert.equal(result.selectedDeviceClass,'intel_qsv');
    assert.deepEqual(result.priorStrategyAssessments,[]);
    assert.match(result.selectedPreflightDigest,/^[a-f0-9]{64}$/);
  }
});

test('CPU selection requires an explicit structural rejection of each ordinary ready device',async()=>{
  const result=await assessMediaRepairStrategy(options([device('gpu','intel_qsv',false),device('cpu','software_cpu')]),context(1),probe,evidence);
  assert.equal(result.selectedDeviceClass,'software_cpu');
  assert.deepEqual(result.priorStrategyAssessments.map(item=>item.deviceId),['gpu']);
  assert.ok(result.priorStrategyAssessments[0].reasonCodes.includes('required_pipeline_profile_unavailable'));
  assert.equal(await assessMediaRepairStrategy(options([device('gpu','intel_qsv',false)]),context(1),probe,evidence),null);
});

test('UAT-218 frozen strategy carries the quality floor when the byte cap requires a lower bitrate',async()=>{
  const gpu=device('gpu','intel_qsv');gpu.capabilityPayload.supportedRateControlModes=['target_size'];
  const c=context(2);c.raw.standard.value.profileRuleSets[0].baseRequirements={space:{maxSizeBytes:4*1024**3}};
  c.raw.materials[0].size_bytes=20*1024**3;
  const source={...probe,durationMs:15_000_000,videoStreams:[{...probe.videoStreams[0],streamIndex:0,
    longEdge:1920,shortEdge:1080,bitRateBps:8_000_000}],audioStreams:[{streamIndex:1,bitRateBps:768_000}],subtitleStreams:[]};
  const before=JSON.stringify(c);
  const strategy=await assessMediaRepairStrategy(options([gpu]),c,source,evidence);
  assert.equal(strategy.video.targetVideoBitrateBps,2_000_000);
  assert.equal(strategy.video.rateControlMode,'target_size');
  assert.equal(JSON.stringify(c),before,'Planning must not alter the accepted Inventory or requirements.');
});
