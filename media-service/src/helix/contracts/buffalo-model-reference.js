'use strict';
const {canonicalDigest}=require('./canonical-json');
const pack=require('./buffalo-model-pack.json');
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
freeze(pack);
const modelDigest=canonicalDigest(pack.models),inputContractDigest=canonicalDigest({schema:'shared.buffalo-image-input@1',
  preprocessingVersion:pack.preprocessingVersion,senseCommit:pack.senseCommit,detectorSize:pack.detectorSize,recognitionSize:pack.recognitionSize,
  minimumDetectionConfidence:pack.minimumDetectionConfidence,maximumFaces:pack.maximumFaces}),
  outputContractDigest=canonicalDigest({schema:'shared.buffalo-feature-output@1',dimension:512,normalization:'unit_l2'});
const featureSpaceDigest=canonicalDigest({schema:'shared.buffalo-feature-space@1',modelDigest,inputContractDigest,outputContractDigest});
function buffaloModelReference(mode){
  if(!['single_reference_face','western_frame_set'].includes(mode))throw new TypeError('An explicit buffalo image mode is required.');
  const value={contractId:canonicalDigest({schema:'shared.buffalo-model-contract@1',mode,featureSpaceDigest}),revision:1,
    schemaRef:'helix://contracts/domain-types/FaceModelRef/v1',mode,modelId:pack.modelId,modelRevision:1,modelDigest,runtimeKind:'onnx',
    inputContractDigest,outputContractDigest,licenseDigest:canonicalDigest(pack.usage),typedParameters:[
      {parameter:'onnxruntime_version',valueType:'string',value:pack.runtimeVersion},
      {parameter:'preprocessing_version',valueType:'string',value:pack.preprocessingVersion},
    ].map(item=>({...item,valueDigest:canonicalDigest(item)}))};
  return freeze({...value,digest:canonicalDigest(value)});
}
function assertBuffaloModelReference(value,mode){
  const expected=buffaloModelReference(mode);
  if(canonicalDigest(value)!==canonicalDigest(expected))throw Object.assign(new TypeError('The face model or feature space differs from pinned buffalo_l.'),{code:'BUFFALO_MODEL_REFERENCE_INVALID'});
  return value;
}
module.exports=Object.freeze({pack,featureSpaceDigest,buffaloModelReference,assertBuffaloModelReference});
