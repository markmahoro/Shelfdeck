'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buffaloModelReference}=require('../../src/helix/contracts/buffalo-model-reference');
const {createBuffaloPeopleReferencePreparation}=require('../../src/helix/integrations/buffalo-people-reference-preparation');

function fixture({faces=1,dimension=512,late=false,wrongModel=false}={}){
  const images=[],counter={stopped:0,analyzed:0},vector=Array(dimension).fill(0);vector[0]=1;
  const context={ownerScope:{domain:'people',processType:'people_image_preparation',processId:'operation'},deadlineAtMs:2000,
    assertExecutionActive(){if(late&&counter.analyzed)throw Object.assign(new Error('cancelled'),{code:'STOPPED'});}},
    imagePort={readUpload:()=>Buffer.from('image'),readArtifact:()=>Buffer.from('image'),materialize({personId,operationId,artifactKind,bytes,provenanceRef}){
      const digestHex=crypto.createHash('sha256').update(bytes).digest('hex'),result={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,
        artifactHandleId:'artifact-'+artifactKind,artifactKind,ownerDomain:'people',ownerScope:{scopeType:'person',scopeId:personId},
        storageRef:'fixture:'+operationId,digestAlgorithm:'sha256',digestHex,sizeBytes:bytes.length,mediaType:'application/json',provenanceRef,referenceRevision:1};
      images.push({result,bytes});return result;}};
  const preparation=createBuffaloPeopleReferencePreparation({imagePort,now:()=>1000,createCpuSession:()=>({
    faceModelRef:wrongModel?{}:buffaloModelReference('western_frame_set'),async analyzeEvidence(){counter.analyzed++;return {faces:Array.from({length:faces},()=>({vector}))};},
    async stop(){counter.stopped++;}})}),artifactHandle={ownerDomain:'people',ownerScope:{scopeType:'person',scopeId:'person'},artifactKind:'reference-image',digestHex:canonicalDigest('image')};
  return {preparation,context,artifactHandle,images,counter};
}
test('People Reference produces one exact buffalo_l 512D feature and stops its bounded CPU session',async()=>{
  const f=fixture(),result=await f.preparation.computeEmbedding({context:f.context,personId:'person',operationId:'operation',referenceRevision:1,
    artifactHandle:f.artifactHandle,faceModelRef:buffaloModelReference('single_reference_face')});
  assert.equal(result.dimension,512);assert.equal(result.vectorCount,1);assert.equal(result.sourceArtifactSetDigest,f.artifactHandle.digestHex);
  assert.equal(result.faceModelRefDigest,buffaloModelReference('single_reference_face').digest);
  assert.equal(JSON.parse(f.images[0].bytes).vectors[0].length,512);assert.equal(f.counter.stopped,1);
  const {handleDigest,...body}=result;assert.equal(canonicalDigest(body),handleDigest);
});
test('zero or multiple faces and invalid vectors never publish an embedding',async()=>{
  for(const options of [{faces:0},{faces:2},{dimension:128}]){
    const f=fixture(options);await assert.rejects(f.preparation.computeEmbedding({context:f.context,personId:'person',operationId:'operation',referenceRevision:1,
      artifactHandle:f.artifactHandle,faceModelRef:buffaloModelReference('single_reference_face')}));
    assert.equal(f.images.length,0);assert.equal(f.counter.stopped,1);
  }
});
test('cancellation after inference and a foreign model fail before publication and close the CPU session',async()=>{
  for(const options of [{late:true},{wrongModel:true}]){
    const f=fixture(options);await assert.rejects(f.preparation.computeEmbedding({context:f.context,personId:'person',operationId:'operation',referenceRevision:1,
      artifactHandle:f.artifactHandle,faceModelRef:buffaloModelReference('single_reference_face')}));
    assert.equal(f.images.length,0);assert.equal(f.counter.stopped,1);
  }
});
test('an inactive or foreign People operation cannot import an image',()=>{
  const f=fixture();assert.throws(()=>f.preparation.importImage({context:f.context,personId:'person',operationId:'other',
    selectedImage:{uploadId:'upload',handleDigest:canonicalDigest('handle')}}),{code:'PEOPLE_REFERENCE_PREPARATION_FENCE'});
  assert.equal(f.images.length,0);
});
test('People reference clamps a field-observation Event deadline into the buffalo analyzeEvidence 60s gate',async()=>{
  const nowMs=1_000_000,farDeadline=nowMs+3_600_000,vector=Array(512).fill(0);vector[0]=1;
  const images=[],counter={stopped:0};let seenDeadline;
  const context={ownerScope:{domain:'people',processType:'people_image_preparation',processId:'operation'},deadlineAtMs:farDeadline,
    assertExecutionActive(){}};
  const imagePort={readUpload:()=>Buffer.from('image'),readArtifact:()=>Buffer.from('image'),materialize({personId,operationId,artifactKind,bytes,provenanceRef}){
    const digestHex=crypto.createHash('sha256').update(bytes).digest('hex'),result={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,
      artifactHandleId:'artifact-'+artifactKind,artifactKind,ownerDomain:'people',ownerScope:{scopeType:'person',scopeId:personId},
      storageRef:'fixture:'+operationId,digestAlgorithm:'sha256',digestHex,sizeBytes:bytes.length,mediaType:'application/json',provenanceRef,referenceRevision:1};
    images.push(result);return result;}};
  const preparation=createBuffaloPeopleReferencePreparation({imagePort,now:()=>nowMs,createCpuSession:()=>({
    faceModelRef:buffaloModelReference('western_frame_set'),async analyzeEvidence(_bytes,options){
      seenDeadline=options.deadlineAtMs;
      if(!Number.isSafeInteger(options.deadlineAtMs)||options.deadlineAtMs<0||options.deadlineAtMs>nowMs+60000)
        throw Object.assign(new Error('An explicit bounded CPU deadline is required.'),{code:'BUFFALO_CPU_INPUT_INVALID'});
      return {faces:[{vector}]};
    },async stop(){counter.stopped++;}})});
  const artifactHandle={ownerDomain:'people',ownerScope:{scopeType:'person',scopeId:'person'},artifactKind:'reference-image',digestHex:canonicalDigest('image')};
  const result=await preparation.computeEmbedding({context,personId:'person',operationId:'operation',referenceRevision:1,
    artifactHandle,faceModelRef:buffaloModelReference('single_reference_face')});
  assert.equal(seenDeadline,nowMs+60000);assert.equal(result.vectorCount,1);assert.equal(images.length,1);assert.equal(counter.stopped,1);
});
