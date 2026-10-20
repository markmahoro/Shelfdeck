'use strict';
const {canonicalDigest,canonicalJson}=require('../contracts/canonical-json');
const {frameGeometry,restoreFrameAnalysis}=require('../contracts/us-adult-frame-geometry');
const {uniformFrameTimes}=require('./us-adult-frame-analysis');
const {sourcePrepared,assertSourcePrepared}=require('../contracts/us-adult-inventory-analysis');
const readAuthority=require('../contracts/us-adult-inventory-read-handle');
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_US_ADULT_PREPARED_ANALYSIS_INVALID'});}
function createUsAdultInventoryAnalysis(options){
  const {engine,workspace,mediaProbe,context,contractValidator}=options||{},now=options?.now||Date.now;
  if(typeof engine?.analyzeSource!=='function'||typeof workspace?.write!=='function'||typeof workspace?.readJson!=='function'||
      typeof mediaProbe?.probe!=='function'||typeof context?.assertExecutionActive!=='function'||typeof contractValidator?.validate!=='function')
    throw new TypeError('Inventory analysis requires controlled CPU, probe, Workspace and nominal result ports.');
  function assertManifest({intent,aftercareCaseId,result,analysis}){
    const manifest=workspace.readJson({intent,aftercareCaseId,context,handle:result.frameManifestHandle,maximumBytes:128*1024}),{manifestDigest,...body}=manifest;
    if(manifest.schema!=='arca.us-adult-frame-manifest@1'||manifest.shelfEntryId!==intent.shelfEntryId||manifest.aftercareCaseId!==aftercareCaseId||
        manifest.intentId!==intent.intentId||manifest.intentDigest!==intent.intentDigest||manifest.sourceHandleDigest!==canonicalDigest(result.sourceHandle)||
        manifest.analysisDigest!==result.analysisDigest||manifestDigest!==canonicalDigest(body)||!Array.isArray(manifest.frames)||manifest.frames.length!==20)
      fail('Frame manifest no longer explains this Case, source and complete analysis.');
    for(const [ordinal,item]of manifest.frames.entries()){
      const frame=analysis.frameMembers[ordinal];
      contractValidator.validate('helix://contracts/types/WorkspaceMaterialHandle/v1',item.handle);
      if(Object.keys(item).sort().join(',')!=='handle,imageDigest,ordinal,timestampMs'||item.ordinal!==ordinal||item.timestampMs!==frame.timestampMs||
          item.imageDigest!==frame.imageDigest||item.handle.digestHex!==frame.imageDigest||!item.handle.relativePath.includes('/frame-'+String(ordinal).padStart(2,'0')+'-'))
        fail('Frame manifest contains a reordered or substituted screenshot.');
    }
    return manifest;
  }
  function read({intent,aftercareCaseId,result,includeFrames=false}){
    context.assertExecutionActive();assertSourcePrepared({intent,aftercareCaseId,result,validator:contractValidator});
    const payload=workspace.readJson({intent,aftercareCaseId,context,handle:result.featuresHandle}),analysis=restoreFrameAnalysis(payload),
      times=uniformFrameTimes(result.durationMs);
    if(analysis.analysisDigest!==result.analysisDigest||analysis.detectedFaceCount!==result.detectedFaceCount||analysis.frameMembers.length!==20||
        analysis.frameMembers.some((frame,ordinal)=>frame.timestampMs!==times[ordinal]))fail('Persisted features changed their complete sampling or source analysis.');
    const manifest=assertManifest({intent,aftercareCaseId,result,analysis});
    const frames=includeFrames?manifest.frames.map(item=>({timestampMs:item.timestampMs,
      bytes:workspace.read({intent,aftercareCaseId,context,handle:item.handle,maximumBytes:10*1024*1024})})):null;
    context.assertExecutionActive();return Object.freeze({analysis,frames,manifest});
  }
  async function prepare({intent,aftercareCaseId,sourceHandle,recoveryDecision=null}){
    context.assertExecutionActive();readAuthority.assertReadHandle({intent,aftercareCaseId,handle:sourceHandle,atMs:now()});
    const probe=await mediaProbe.probe(sourceHandle);context.assertExecutionActive();
    const {payloadDigest:probeDigest,...probeBody}=probe||{};
    if(probe?.sourceHandleDigest!==canonicalDigest(sourceHandle)||probe.resultKind!=='probed'||probeDigest!==canonicalDigest(probeBody)||
        !Array.isArray(probe.videoStreams)||probe.videoStreams.length<1||!Number.isSafeInteger(probe.durationMs)||probe.durationMs<1||
        typeof probe.container!=='string'||!probe.container||probe.container==='unknown')fail('Source probe did not establish its actual readable video container and duration.');
    const prepared=await engine.analyzeSource({sourceHandle,durationMs:probe.durationMs}),
      write=(kind,bytes)=>workspace.write({intent,aftercareCaseId,context,kind,bytes,recoveryDecision}),
      frames=prepared.frames.map((frame,ordinal)=>({ordinal,timestampMs:frame.timestampMs,imageDigest:prepared.analysis.frameMembers[ordinal].imageDigest,
        handle:write('frame-'+String(ordinal).padStart(2,'0'),frame.bytes)})),
      manifestBody={schema:'arca.us-adult-frame-manifest@1',shelfEntryId:intent.shelfEntryId,aftercareCaseId,intentId:intent.intentId,intentDigest:intent.intentDigest,
        sourceHandleDigest:canonicalDigest(sourceHandle),analysisDigest:prepared.analysis.analysisDigest,frames},
      frameManifestHandle=write('frames',Buffer.from(canonicalJson({...manifestBody,manifestDigest:canonicalDigest(manifestBody)}))),
      featuresHandle=write('features',Buffer.from(canonicalJson({schema:'shared.face-embedding-set@1',dimension:128,
        vectors:prepared.analysis.faces.map(face=>face.vector),frameGeometry:frameGeometry(prepared.analysis)}))),
      result=sourcePrepared({intent,aftercareCaseId,sourceHandle,sourceProbeDigest:canonicalDigest(probe),durationMs:probe.durationMs,container:probe.container,
        analysis:prepared.analysis,frameManifestHandle,featuresHandle,atMs:now()});
    read({intent,aftercareCaseId,result});return result;
  }
  return Object.freeze({prepare,read});
}
module.exports=Object.freeze({createUsAdultInventoryAnalysis});
