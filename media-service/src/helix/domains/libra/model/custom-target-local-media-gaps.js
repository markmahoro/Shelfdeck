'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {assertStandardAcceptanceSpec}=require('./custom-acceptance-spec');
const {assertProbeEvidence,rasterClass}=require('./media-production-contracts');

function fail(code,message){throw Object.assign(new Error(message),{code});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

// This is a source observation, not a production feasibility or acceptance decision.
// Its caller must obtain the record and source handle from the current Libra Owner view.
function observeLocalMovieMediaGaps({libraRunId,acceptanceSpec,sourceHandleDigest,sourceProbeRecord}){
  if(typeof libraRunId!=='string'||!libraRunId||!/^[a-f0-9]{64}$/.test(sourceHandleDigest||''))
    fail('LIBRA_CUSTOM_MEDIA_GAP_INPUT_INVALID','Exact Run and source Handle identities are required.');
  const spec=assertStandardAcceptanceSpec(acceptanceSpec);
  if(spec.contentProfile!=='movie'||spec.structureKind!=='single')
    fail('LIBRA_CUSTOM_MEDIA_GAP_SCOPE_INVALID','A Movie standard and single product scope are required.');
  const base={libraRunId,acceptanceSpecId:spec.acceptanceSpecId,acceptanceSpecRecordDigest:spec.recordDigest,sourceHandleDigest};
  const finish=(value)=>freeze({...base,...value,observationDigest:canonicalDigest({...base,...value})});
  if(!sourceProbeRecord)return finish({status:'evidence_pending',reasonCode:'source_probe_missing',observed:null,differences:[]});
  const record=sourceProbeRecord,bindings=record.inputBindings?.bindings,
    sourceBindings=Array.isArray(bindings)?bindings.filter(item=>item.portName==='physicalMaterialReadHandleOrWorkspaceMaterialHandle'):[];
  if(record.outcomeKind!=='succeeded'||record.capabilityRef!=='shared.material.media.probe@1'||
      typeof record.resultId!=='string'||!record.resultId||record.resultId.length>256||
      !Array.isArray(bindings)||record.inputBindingDigest!==canonicalDigest(record.inputBindings)||sourceBindings.length!==1||
      sourceBindings[0].ownerDomain!=='libra'||sourceBindings[0].processType!=='libra_run'||sourceBindings[0].processId!==libraRunId||
      record.resultDigest!==canonicalDigest(record.result))
    fail('LIBRA_CUSTOM_MEDIA_GAP_EVIDENCE_INVALID','Probe Result is not bound to this Libra Run.');
  const probe=assertProbeEvidence(record.result);
  if(probe.sourceHandleDigest!==sourceHandleDigest)
    fail('LIBRA_CUSTOM_MEDIA_GAP_EVIDENCE_INVALID','Probe Result belongs to a different source Handle.');
  const defaults=probe.videoStreams.filter(item=>item.dispositionDefault),primary=defaults.length?defaults:probe.videoStreams.slice(0,1);
  if(probe.resultKind!=='probed'||!primary.length||primary.some(item=>!Number.isSafeInteger(item.longEdge)||item.longEdge<1||
      !Number.isSafeInteger(item.shortEdge)||item.shortEdge<1)||!probe.audioStreams.length)
    return finish({status:'evidence_pending',reasonCode:'source_media_facts_incomplete',observed:null,differences:[]});
  const mandatory=spec.requirements.mandatoryMedia,audioClasses=[...new Set(probe.audioStreams.map(item=>item.normalizedAudioClass))].sort(),
    observed={rasterClass:rasterClass(probe),audioClasses},probeResultRef={resultId:record.resultId,resultDigest:record.resultDigest},differences=[];
  if(mandatory.minimumRasterClass==='4k'&&observed.rasterClass!=='4k')
    differences.push({factKind:'source_raster_below_target',targetId:'minimumRasterClass'});
  if(mandatory.acceptedPrimaryAudioClasses.length&&!audioClasses.some(item=>mandatory.acceptedPrimaryAudioClasses.includes(item)))
    differences.push({factKind:'source_audio_classes_differ',targetId:'acceptedPrimaryAudioClasses'});
  return finish({status:'observed',reasonCode:null,observed,probeResultRef,differences});
}

module.exports=Object.freeze({observeLocalMovieMediaGaps});
