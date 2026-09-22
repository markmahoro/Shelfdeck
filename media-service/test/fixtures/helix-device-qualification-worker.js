'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const serviceRoot = process.env.HELIX_UAT_SERVICE_ROOT || path.resolve(__dirname, '../..');
const { PROBES, SDR_PROFILE_ID, runValidatedDeviceProfileProbe } = require(path.join(serviceRoot, 'src/clean-compute-device-runtime'));
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
const {createCleanMediaProductionEffectPort} = require(path.join(serviceRoot, 'src/clean-media-production-effect-port'));
const deviceKinds = process.argv.slice(2);
assert.ok(deviceKinds.length > 0 && deviceKinds.every(kind => ['software_cpu', 'intel_qsv'].includes(kind)));

(async () => {
  for (const deviceKind of deviceKinds) {
    const spec = PROBES.find(value => value.deviceKind === deviceKind);
    const result = await runValidatedDeviceProfileProbe(ffmpeg, spec, SDR_PROFILE_ID, spec.modes, 30_000);
    console.log(JSON.stringify({ deviceKind, profile: SDR_PROFILE_ID, ...result }));
    assert.equal(result.passed, true, `Actual ${deviceKind} qualification failed; this is not an absent-device skip.`);
    assert.deepEqual([...result.passedModes].sort(), [...spec.modes].sort());
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelfdeck-source-preflight-'));
    try {
      const source=path.join(root,'source.mkv');
      const generated=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
        'testsrc2=size=256x256:rate=24:duration=1','-c:v','libx264','-pix_fmt','yuv420p',source],
        {encoding:'utf8',windowsHide:true});
      assert.equal(generated.status,0,generated.stderr);
      const port=createCleanMediaProductionEffectPort({ffmpegPath:ffmpeg,workspaceProductPort:{
        materializeMedia(){throw new Error('Source preflight must not materialize a product.');}}});
      for (const mode of spec.modes) {
        const request={sourceHandle:{location:source},deviceSnapshot:{deviceClass:deviceKind,snapshotDigest:'a'.repeat(64)},
          productionIntent:{intentDigest:'qualification-'+mode,video:{rateControlMode:mode,qualityBound:23,
            targetVideoBitrateBps:500_000,dynamicRangeOperation:'preserve',pipelineProfileId:SDR_PROFILE_ID},
            audio:{mode:'copy'},subtitle:{mode:'copy'}}};
        const preflight=await port.verifyTranscodeInput(request);
        assert.equal(preflight.reasonCode,null,JSON.stringify({deviceKind,mode,preflight}));
        assert.equal(preflight.passedSampleCount,24);
        await assert.rejects(port.verifyTranscodeInput({...request,deadlineAtMs:Date.now()-1}),
          {code:'LIBRA_MEDIA_FFMPEG_TIMEOUT'});
        console.log(JSON.stringify({deviceKind,mode,actualSourcePreflight:true,expiredDeadlineRejected:true}));
      }
    } finally {fs.rmSync(root,{recursive:true,force:true});}
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
