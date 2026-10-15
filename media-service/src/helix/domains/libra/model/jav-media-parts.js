'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertJavPartSet,javPartSetSchema}=require('../../../contracts/jav-part-set');
const schema='libra.jav-part-source-evidence@1';
function assertJavSourceEvidence(value) {
  const invalid=()=>{throw Object.assign(new TypeError('JAV part source evidence must conserve the complete ordered Probe set.'),{code:'LIBRA_JAV_PART_SOURCE_INVALID'});};
  if(!value||Object.keys(value).sort().join(',')!=='evidenceDigest,javPartSet,libraRunId,parts,runExecutionBasisDigest,schema,sourceScopeDigest,totalDurationMs'||
      value.schema!==schema||!value.libraRunId||!['runExecutionBasisDigest','sourceScopeDigest','evidenceDigest'].every(key=>/^[a-f0-9]{64}$/.test(value[key]))||
      value.evidenceDigest!==canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='evidenceDigest')))||
      !Array.isArray(value.parts)||value.parts.length!==2||Buffer.byteLength(canonicalJson(value))>256*1024)invalid();
  assertJavPartSet(value.javPartSet);
  if(value.javPartSet.parts.length!==2)invalid();
  const handles=new Set();
  for(const [ordinal,part] of value.parts.entries()) {
    const named=value.javPartSet.parts[ordinal],probe=part.probeEvidence;
    if(Object.keys(part).sort().join(',')!=='materialKey,ordinal,probeEvidence,sourceHandleDigest'||part.ordinal!==ordinal||part.materialKey!==named.materialKey||
        !/^[a-f0-9]{64}$/.test(part.sourceHandleDigest)||handles.has(part.sourceHandleDigest)||probe?.resultKind!=='probed'||
        probe.sourceHandleDigest!==part.sourceHandleDigest||!Number.isSafeInteger(probe.durationMs)||probe.durationMs<=0||!probe.videoStreams?.length)invalid();
    handles.add(part.sourceHandleDigest);
  }
  if(value.totalDurationMs!==value.parts.reduce((total,part)=>total+part.probeEvidence.durationMs,0)||!Number.isSafeInteger(value.totalDurationMs))invalid();
  return value;
}
function buildJavSourceEvidence(snapshot,sources) {
  if(snapshot.materialInputForm!=='jav_named_parts'||snapshot.spec.contentProfile!=='jav')throw new TypeError('JAV part evidence requires a frozen named-part Run.');
  const javPartSet=snapshot.candidatePackage.javPartSet,byKey=new Map(sources.map(source=>[source.member.materialKey,source]));
  if(byKey.size!==2)throw new TypeError('JAV part observations must cover both actual members.');
  const parts=javPartSet.parts.map(part=>{
    const source=byKey.get(part.materialKey);if(!source)throw new TypeError('JAV part observation is absent.');
    return {ordinal:part.ordinal,materialKey:part.materialKey,sourceHandleDigest:canonicalDigest(source.readHandle),probeEvidence:source.record.result};
  });
  const value={schema,libraRunId:snapshot.run.libraRunId,runExecutionBasisDigest:snapshot.run.executionBasisDigest,
    javPartSet,sourceScopeDigest:snapshot.candidatePackage.structureEvidenceRef.unitDigest,parts,
    totalDurationMs:parts.reduce((total,part)=>total+part.probeEvidence.durationMs,0)};
  return assertJavSourceEvidence({...value,evidenceDigest:canonicalDigest(value)});
}
function javSourceEvidenceSchema() {
  const digest={type:'string',pattern:'^[a-f0-9]{64}$'},properties={schema:{const:schema},libraRunId:{type:'string',minLength:1,maxLength:256},
    runExecutionBasisDigest:digest,javPartSet:javPartSetSchema(),sourceScopeDigest:digest,
    parts:{type:'array',minItems:2,maxItems:2,items:{type:'object',additionalProperties:false,required:['ordinal','materialKey','sourceHandleDigest','probeEvidence'],properties:{
      ordinal:{type:'integer',minimum:0,maximum:1},materialKey:digest,sourceHandleDigest:digest,probeEvidence:{$ref:'helix://contracts/types/MediaProbeEvidence/v1'}}}},
    totalDurationMs:{type:'integer',minimum:1},evidenceDigest:digest};
  return {type:'object',additionalProperties:false,required:Object.keys(properties),properties,'x-helix-maxCanonicalBytes':256*1024};
}
module.exports=Object.freeze({assertJavSourceEvidence,buildJavSourceEvidence,javSourceEvidenceSchema});
