'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {fixture:specFixture}=require('./fixtures/custom-acceptance-spec-harness');
const {observeLocalMovieMediaGaps}=require('../../src/helix/domains/libra/model/custom-target-local-media-gaps');

const D=canonicalDigest;
function fixture({audio=['other'],width=1920,height=1080}={}){
  const spec=specFixture().baseSpec,sourceHandleDigest=D('source'),inputBindings={bindings:[{portName:'physicalMaterialReadHandleOrWorkspaceMaterialHandle',
    ownerDomain:'libra',processType:'libra_run',processId:'run',bindingKind:'projected_owner_facts'}]},
    probe={schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,evidenceId:'probe',evidenceKind:'media_probe',
      producerRef:'shared.material.media.probe@1',basisDigest:D('basis'),observedAtMs:1,sourceHandleDigest,resultKind:'probed',
      container:'matroska',durationMs:1000,videoStreams:[{streamIndex:0,dispositionDefault:true,bitDepth:8,pixelFormat:'yuv420p',
        dynamicRangeKind:'sdr',longEdge:width,shortEdge:height}],audioStreams:audio.map((value,index)=>({streamIndex:index+1,
        dispositionDefault:index===0,normalizedAudioClass:value})),subtitleStreams:[]};
  probe.payloadDigest=D(probe);
  const record={resultId:'probe-result',resultDigest:D(probe),outcomeKind:'succeeded',capabilityRef:'shared.material.media.probe@1',
    inputBindings,inputBindingDigest:D(inputBindings),result:probe};
  return {libraRunId:'run',acceptanceSpec:spec,sourceHandleDigest,sourceProbeRecord:record};
}

test('local source observations retain five-star audio and space while identifying only real hard media gaps',()=>{
  for(const audio of [['other'],['other']]){
    const value=fixture({audio}),observed=observeLocalMovieMediaGaps(value);
    assert.equal(observed.status,'observed');assert.deepEqual(observed.differences.map(item=>item.factKind),
      ['source_raster_below_target','source_audio_classes_differ']);
    assert.equal(observed.probeResultRef.resultDigest,value.sourceProbeRecord.resultDigest);
    assert.equal(value.acceptanceSpec.requirements.space.maxSizeGiB,50);
  }
  const value=fixture({audio:['dts_hd_ma','other']}),before=canonicalJson(value.acceptanceSpec),observed=observeLocalMovieMediaGaps(value);
  assert.deepEqual(observed.differences.map(item=>item.factKind),['source_raster_below_target']);
  assert.equal(canonicalJson(value.acceptanceSpec),before);
  assert.equal(observed.observed.audioClasses.includes('dts_hd_ma'),true);
  const sufficient=observeLocalMovieMediaGaps(fixture({audio:['dts_hd_ma'],width:3840,height:2160}));
  assert.deepEqual(sufficient.differences,[]);
});

test('no source result or incomplete dimensions do not become a recommendation to relax a requirement',()=>{
  const missing=fixture();missing.sourceProbeRecord=null;
  assert.equal(observeLocalMovieMediaGaps(missing).status,'evidence_pending');
  const unknown=fixture({width:null}),probe=unknown.sourceProbeRecord.result;
  delete probe.payloadDigest;probe.payloadDigest=D(probe);unknown.sourceProbeRecord.resultDigest=D(probe);
  const result=observeLocalMovieMediaGaps(unknown);
  assert.equal(result.status,'evidence_pending');assert.deepEqual(result.differences,[]);
});

test('a probe must belong to the exact Run and handle and retain its actual immutable Result',()=>{
  for(const mutate of [
    value=>{value.sourceProbeRecord.inputBindings.bindings[0].processId='another';value.sourceProbeRecord.inputBindingDigest=D(value.sourceProbeRecord.inputBindings);},
    value=>{value.sourceHandleDigest=D('another-source');},
    value=>{value.sourceProbeRecord.result.audioStreams[0].normalizedAudioClass='dts_hd_ma';},
    value=>{value.sourceProbeRecord.outcomeKind='failed';},
    value=>{value.acceptanceSpec={...value.acceptanceSpec,requirements:{...value.acceptanceSpec.requirements,
      space:{...value.acceptanceSpec.requirements.space,maxSizeGiB:14}}};},
  ]){
    const value=fixture();mutate(value);assert.throws(()=>observeLocalMovieMediaGaps(value));
  }
});
