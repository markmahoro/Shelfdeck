'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deriveAftercareSizeBudget}=require('../../src/helix/domains/arca/model/aftercare-media-policy');
const {deriveTargetSizeBudget}=require('../../src/helix/domains/libra/model/media-production-contracts');

test('UAT-218 Arca preserves the Libra quality floor for the same frozen media and size target',()=>{
  for(const size of [2,4,8,14,50])for(const raster of ['below_4k','4k']){
    const input={maxSizeBytes:size*1024**3,sourceSizeBytes:80*1024**3,durationMs:10_000_000,
      videoStreams:[{streamIndex:0,dispositionDefault:true,bitRateBps:30_000_000,
        longEdge:raster==='4k'?3840:1920,shortEdge:raster==='4k'?2160:1080}],
      audioStreams:[{streamIndex:1,bitRateBps:768_000}],subtitleStreams:[]};
    const arca=deriveAftercareSizeBudget(input),libra=deriveTargetSizeBudget({...input,rasterClass:raster,sourceVideoBitrateBps:30_000_000});
    assert.equal(arca.policyVideoBitrateFloorBps,libra.policyVideoBitrateFloorBps);
    assert.equal(arca.videoBitrateFloorBps,libra.videoBitrateFloorBps);
    assert.equal(arca.targetVideoBitrateBps,libra.targetVideoBitrateBps);
    assert.equal(arca.exceedsSizeCap,libra.exceedsSizeCap);
  }
});

test('UAT-218 a usable low-bitrate source is not inflated to the nominal quality floor',()=>{
  const result=deriveAftercareSizeBudget({maxSizeBytes:4*1024**3,sourceSizeBytes:3*1024**3,
    durationMs:10_000_000,videoStreams:[{streamIndex:0,bitRateBps:900_000,longEdge:1920,shortEdge:1080}],
    audioStreams:[{streamIndex:1,bitRateBps:128_000}],subtitleStreams:[]});
  assert.equal(result.videoBitrateFloorBps,900_000);
  assert.ok(result.targetVideoBitrateBps<=900_000);
});

test('UAT-218 missing source audio evidence cannot invent a lower source quality floor',()=>{
  const result=deriveAftercareSizeBudget({maxSizeBytes:4*1024**3,sourceSizeBytes:6*1024**3,
    durationMs:10_000_000,videoStreams:[{streamIndex:0,longEdge:1920,shortEdge:1080}],
    audioStreams:[{streamIndex:1,codec:'aac'}],subtitleStreams:[]});
  assert.equal(result.sourceVideoBitrateBps,null);
  assert.equal(result.videoBitrateFloorBps,2_000_000);
});
