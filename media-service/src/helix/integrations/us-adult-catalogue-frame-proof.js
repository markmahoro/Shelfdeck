'use strict';

const {createHash}=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {restoreBuffaloEmbeddingSet}=require('../contracts/buffalo-frame-artifact');
const {representativeImagePolicy}=require('../contracts/buffalo-representative-policy');
const {readCompletedCatalogueBatches}=require('../domains/libra/model/us-adult-catalogue-work-results');
const {createBuffaloCpuSession}=require('./buffalo-cpu-session');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function fail(message,code='PEOPLE_CATALOGUE_FRAME_PROOF_INVALID'){
  throw Object.assign(new Error(message),{code});
}

function createCatalogueRegistrationFrameProofPort(options){
  if(typeof options?.createCpuSession!=='function'||typeof options.readArtifactBytes!=='function'||
    typeof options.resolveCatalogueReaders!=='function')
    throw new TypeError('Catalogue frame proof requires a buffalo CPU session, workspace reads and catalogue readers.');
  const cache=new Map(),inflight=new Set(),failures=new Map();
  const now=typeof options.now==='function'?options.now:()=>Date.now();

  function wake(){options.wake?.();}

  function loadObservation(input,observation){
    if(observation)return observation;
    const handle=input?.observationHandle?.observationArtifactHandle;
    if(!handle)fail('Catalogue observation is required for a frame proof.','PEOPLE_CATALOGUE_OBSERVATION_PENDING');
    const loaded=options.readArtifactBytes(handle);
    const bytes=Buffer.isBuffer(loaded)?loaded:loaded?.bytes;
    if(!Buffer.isBuffer(bytes)||!bytes.length)
      fail('Catalogue observation bytes are not available for a frame proof.','PEOPLE_CATALOGUE_OBSERVATION_PENDING');
    let parsed;
    try{parsed=JSON.parse(bytes.toString('utf8'));}
    catch{fail('Catalogue observation bytes are not readable.','PEOPLE_CATALOGUE_OBSERVATION_PENDING');}
    if(handle.digestHex&&canonicalDigest(parsed)!==handle.digestHex)
      fail('Catalogue observation bytes do not match the frozen handle.','PEOPLE_CATALOGUE_OBSERVATION_PENDING');
    return parsed;
  }

  function selectFace(input,observation){
    const winner=input?.winner;
    if(!winner?.groupIds?.length)fail('Catalogue frame proof requires a winner group.');
    const keys=[];
    for(const group of observation.groups||[]){
      if(!winner.groupIds.includes(group.clusterId))continue;
      for(const key of group.representativeKeys||[]){
        const query=(observation.queries||[]).find(item=>item.faceKey===key);
        if(!query?.result?.matches?.some(match=>match.identityKey===winner.identityKey&&
          match.uid===winner.uid&&match.name===winner.name))continue;
        keys.push(key);
      }
    }
    if(!keys.length)fail('No winner representative face is available for a frame proof.');
    keys.sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right)));
    const key=keys[0];
    const [frameOrdinal,faceOrdinal]=key.split(':').map(Number);
    if(!Number.isSafeInteger(frameOrdinal)||!Number.isSafeInteger(faceOrdinal))
      fail('Winner representative face key is not a frame:face ordinal pair.');
    const frameRef=observation.frameEvidenceRefs?.[frameOrdinal];
    const faceRef=frameRef?.faces?.find(item=>item.faceOrdinal===faceOrdinal);
    if(!frameRef||!faceRef)fail('Winner representative face is missing from observation frame evidence.');
    return {key,frameOrdinal,faceOrdinal,frameRef,faceRef};
  }

  function loadEvidence(input,selected){
    const mode=input?.observationHandle?.mode;
    if(mode!=='initial'&&mode!=='initial_and_supplement')
      fail('Catalogue frame proof needs the completed observation mode.');
    const readers=options.resolveCatalogueReaders();
    if(!readers?.movieProductionReader||!readers.usAdultCatalogueStore||!readers.workResultReader||!readers.contractValidator)
      fail('Catalogue frame proof readers are not ready.');
    const snapshot=readers.movieProductionReader.readRunSnapshot(input.libraRunId);
    const basis=readers.usAdultCatalogueStore.readForExecution({
      libraRunId:input.libraRunId,expectedBasisDigest:input.catalogueBasisDigest});
    if(!snapshot||!basis)fail('Catalogue Basis is not available for a frame proof.');
    const completed=readCompletedCatalogueBatches({
      movieProductionReader:readers.movieProductionReader,
      workResultReader:readers.workResultReader,
      contractValidator:readers.contractValidator,
    },snapshot,basis,mode);
    for(const batch of completed.batches){
      const embeddingBytes=options.readArtifactBytes(batch.faceEmbeddingSetHandle.artifactHandle);
      const embeddingPayload=Buffer.isBuffer(embeddingBytes)?embeddingBytes:embeddingBytes?.bytes;
      if(!Buffer.isBuffer(embeddingPayload)||!embeddingPayload.length)continue;
      const restored=restoreBuffaloEmbeddingSet(JSON.parse(embeddingPayload.toString('utf8')));
      const evidence=restored.frames.find(frame=>frame.frame.ordinal===selected.frameOrdinal&&
        frame.evidenceDigest===selected.frameRef.frameEvidenceDigest&&
        frame.faces.some(face=>face.faceOrdinal===selected.faceOrdinal&&
          face.faceEvidenceDigest===selected.faceRef.faceEvidenceDigest));
      if(!evidence)continue;
      if(evidence.frame.imageDigest!==selected.frameRef.imageDigest||
        evidence.basisDigest!==input.catalogueBasisDigest)
        fail('Restored frame evidence does not match the observation winner.');
      const compositeBytes=options.readArtifactBytes(batch.frameArtifactSet.frameSetArtifactHandle);
      const compositePayload=Buffer.isBuffer(compositeBytes)?compositeBytes:compositeBytes?.bytes;
      if(!Buffer.isBuffer(compositePayload)||!compositePayload.length)
        fail('Catalogue frame composite bytes are not available.');
      const composite=JSON.parse(compositePayload.toString('utf8'));
      if(composite.schema!=='libra.western-frame-composite@1'||!Array.isArray(composite.members)||
        !Array.isArray(composite.memberPayloads))
        fail('Catalogue frame composite is not a western frame composite.');
      const member=composite.members.find(item=>item.contentDigest===evidence.frame.imageDigest);
      if(!member)fail('Catalogue frame composite does not contain the winner image digest.');
      const memberPayload=composite.memberPayloads[member.ordinal];
      if(!memberPayload||memberPayload.contentDigest!==member.contentDigest)
        fail('Catalogue frame composite member payload is not aligned.');
      const frameBytes=Buffer.from(memberPayload.bytesBase64,'base64');
      if(!frameBytes.length||sha(frameBytes)!==member.contentDigest)
        fail('Catalogue frame bytes do not match their content digest.');
      return {evidence,frameBytes};
    }
    fail('Winner frame evidence is not present in completed catalogue batches.');
  }

  async function render(input,observation){
    const selected=selectFace(input,observation);
    const {evidence,frameBytes}=loadEvidence(input,selected);
    const policy=representativeImagePolicy();
    if(policy.policyDigest!==input.representativeImagePolicyDigest)
      fail('Representative image policy does not match the catalogue Basis.');
    const session=options.createCpuSession();
    try{
      const rendered=await session.renderRepresentative({
        frameBytes,evidence,faceOrdinal:selected.faceOrdinal,policy,
      },{deadlineAtMs:now()+Math.min(60000,options.renderDeadlineMs||30000)});
      if(!rendered||!Buffer.isBuffer(rendered.bytes)||!rendered.bytes.length||!rendered.proof)
        fail('Buffalo representative render did not return a frame proof.');
      return Object.freeze({kind:'frame',bytes:Buffer.from(rendered.bytes),proof:rendered.proof});
    }finally{
      await session.stop().catch(()=>{});
    }
  }

  function cacheKey(input,observation){
    const mode=input?.observationHandle?.mode||null;
    const winner=input?.winner||{};
    return canonicalDigest({
      schema:'people.catalogue-frame-proof-cache@1',
      libraRunId:input?.libraRunId||null,
      catalogueBasisDigest:input?.catalogueBasisDigest||null,
      mode,
      observationDigest:observation?.observationDigest||input?.observationHandle?.observationDigest||null,
      identityKey:winner.identityKey||null,
      uid:winner.uid||null,
      name:winner.name||null,
      groupIds:winner.groupIds||[],
      representativeImagePolicyDigest:input?.representativeImagePolicyDigest||null,
    });
  }

  function buildFrameImageProof({input,observation}={}){
    if(!input?.libraRunId||!input.catalogueBasisDigest||!input.winner?.name)
      return Object.freeze({kind:'failed',code:'PEOPLE_CATALOGUE_FRAME_PROOF_INVALID'});
    let loaded;
    try{loaded=loadObservation(input,observation);}
    catch(error){
      return Object.freeze({kind:'failed',code:error?.code||'PEOPLE_CATALOGUE_FRAME_PROOF_INVALID'});
    }
    const key=cacheKey(input,loaded);
    if(cache.has(key))return cache.get(key);
    if(failures.has(key))return failures.get(key);
    if(!inflight.has(key)){
      inflight.add(key);
      Promise.resolve().then(()=>render(input,loaded)).then(result=>{
        cache.set(key,result);
        wake();
      }).catch(error=>{
        failures.set(key,Object.freeze({kind:'failed',code:error?.code||'PEOPLE_CATALOGUE_FRAME_PROOF_FAILED'}));
        wake();
      }).finally(()=>inflight.delete(key));
    }
    return null;
  }

  return Object.freeze({buildFrameImageProof});
}

module.exports=Object.freeze({createCatalogueRegistrationFrameProofPort});
