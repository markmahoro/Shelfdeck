'use strict';

const {canonicalDigest,canonicalJson}=require('../contracts/canonical-json');
const {buffaloModelReference}=require('../contracts/buffalo-model-reference');

function fail(code,message){throw Object.assign(new Error(message),{code});}
function createBuffaloPeopleReferencePreparation(options){
  if(!options?.imagePort||!['readUpload','readArtifact','materialize'].every(key=>typeof options.imagePort[key]==='function')||
    typeof options.createCpuSession!=='function')throw new TypeError('People reference preparation requires controlled storage and a buffalo CPU session.');
  const model=buffaloModelReference('single_reference_face'),videoModel=buffaloModelReference('western_frame_set'),now=options.now||Date.now;
  function assertScope(context,operationId){
    if(!context||context.ownerScope?.domain!=='people'||context.ownerScope.processType!=='people_image_preparation'||
      context.ownerScope.processId!==operationId||typeof context.assertExecutionActive!=='function'||
      !Number.isSafeInteger(context.deadlineAtMs)||context.deadlineAtMs<=now())
      fail('PEOPLE_REFERENCE_PREPARATION_FENCE','The reference operation lacks its current People Event authority.');
    context.assertExecutionActive();
  }
  function importImage({context,personId,operationId,selectedImage}){
    assertScope(context,operationId);const bytes=options.imagePort.readUpload(selectedImage);assertScope(context,operationId);
    return options.imagePort.materialize({context,personId,operationId,artifactKind:'reference-image',bytes,
      provenanceRef:{objectType:'people_selected_image',objectId:selectedImage.uploadId,revision:1,digest:selectedImage.handleDigest}});
  }
  async function computeEmbedding({context,personId,operationId,referenceRevision,artifactHandle,faceModelRef}){
    assertScope(context,operationId);
    if(canonicalJson(faceModelRef)!==canonicalJson(model)||!Number.isSafeInteger(referenceRevision)||referenceRevision<1||
      artifactHandle?.ownerDomain!=='people'||artifactHandle.ownerScope?.scopeType!=='person'||
      artifactHandle.ownerScope.scopeId!==personId||artifactHandle.artifactKind!=='reference-image')
      fail('PEOPLE_REFERENCE_PREPARATION_FENCE','The selected image or buffalo model differs from its People operation.');
    const bytes=options.imagePort.readArtifact(artifactHandle);assertScope(context,operationId);
    const cpu=options.createCpuSession();let analyzed;
    try{
      if(!cpu||typeof cpu.analyzeEvidence!=='function'||typeof cpu.stop!=='function'||canonicalJson(cpu.faceModelRef)!==canonicalJson(videoModel))
        fail('PEOPLE_REFERENCE_PREPARATION_FENCE','The technical CPU session does not use the qualified buffalo feature space.');
      analyzed=await cpu.analyzeEvidence(bytes,{deadlineAtMs:context.deadlineAtMs,signal:context.abortSignal});
      assertScope(context,operationId);
      if(!Array.isArray(analyzed?.faces)||analyzed.faces.length!==1)
        fail('FACE_REFERENCE_SINGLE_FACE_REQUIRED','The reference image must contain exactly one recognizable face.');
      const vector=analyzed.faces[0]?.vector;
      if(!Array.isArray(vector)||vector.length!==512||vector.some(value=>!Number.isFinite(value))||
        Math.abs(Math.hypot(...vector)-1)>1e-5)
        fail('PEOPLE_REFERENCE_PREPARATION_RESULT_INVALID','The reference face did not produce one normalized 512-dimensional feature.');
      const payload={schema:'shared.face-embedding-set@1',dimension:512,vectors:[[...vector]]};
      assertScope(context,operationId);
      const artifact=options.imagePort.materialize({context,personId,operationId,artifactKind:'reference-embedding',
        bytes:Buffer.from(canonicalJson(payload)),provenanceRef:{objectType:'people_reference_embedding',objectId:operationId,
          revision:referenceRevision,digest:canonicalDigest({imageDigest:artifactHandle.digestHex,modelRefDigest:model.digest})}});
      const body={schemaRef:'helix://contracts/types/FaceEmbeddingSetHandle/v1',schemaVersion:1,artifactHandleId:artifact.artifactHandleId,
        artifactHandle:artifact,computationMode:'single_reference_face',libraRunId:null,workspaceId:null,faceModelRefDigest:model.digest,
        sourceArtifactSetDigest:artifactHandle.digestHex,detectedFaceCount:1,vectorCount:1,dimension:512,embeddingDigest:artifact.digestHex};
      return Object.freeze({...body,handleDigest:canonicalDigest(body)});
    }finally{if(typeof cpu?.stop==='function')await cpu.stop();}
  }
  return Object.freeze({modelReference:()=>model,importImage,computeEmbedding,clearCache:()=>{}});
}
module.exports=Object.freeze({createBuffaloPeopleReferencePreparation});
