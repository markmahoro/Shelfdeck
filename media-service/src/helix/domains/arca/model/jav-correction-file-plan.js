'use strict';
const path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertJavCorrectionVerifiedSource,assertJavCorrectionHistoricalSource}=require('./jav-correction-execution-contract');
const {buildJavCorrectionProposal}=require('./jav-identity-correction');
const {buildJavCorrectionMetadata}=require('./jav-correction-metadata');
const {javCorrectionRetainedLocation}=require('../../../contracts/jav-correction-retained-location');
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1';
const REPLACEMENTS=Object.freeze({metadata_sidecar:'nfo',poster:'poster',fanart:'fanart'});
const fail=message=>{throw Object.assign(new TypeError(message),{code:'ARCA_JAV_CORRECTION_FILE_PLAN_INVALID'});};
const payloadFields=['correctionId','admissionDigest','confirmedProposalDigest','actualProposalDigest','sourceObservationDigest','metadataFactDigest','metadataHandle','artifacts'];
function filePlanValue({record,scope,verified,prepared,target},assertSource) {
  assertSource(record,scope,verified);
  const q=verified.qualification,proposal=buildJavCorrectionProposal({basis:record.proof.basis,...q}),
    metadata=buildJavCorrectionMetadata({correctionId:record.correctionId,admissionDigest:record.admissionDigest,basis:record.proof.basis,proposal}),
    basis=record.proof.basis,payload=Object.fromEntries(payloadFields.map(key=>[key,prepared?.[key]]));
  if(prepared?.schemaRef!=='helix://contracts/types/JavCorrectionAssetsPrepared/v1'||prepared.basisDigest!==scope.digest||prepared.correctionId!==record.correctionId||
      prepared.admissionDigest!==record.admissionDigest||prepared.confirmedProposalDigest!==verified.confirmedProposalDigest||
      prepared.actualProposalDigest!==verified.actualProposalDigest||prepared.metadataFactDigest!==metadata.factDigest||prepared.sourceObservationDigest!==q.observation.observationDigest||
      prepared.payloadDigest!==canonicalDigest(payload)||prepared.artifacts.map(item=>item.artifactKind).join(',')!=='nfo,poster,fanart')fail('File Plan requires the exact frozen Source and prepared Artifact Results.');
  if(!target||!path.isAbsolute(target.rootLocation)||target.endpointId==null||target.mountScopeId==null||
      basis.shelfTargetDigest!==canonicalDigest(target))fail('File Plan target differs from the frozen Shelf target.');
  const root=path.resolve(target.rootLocation),key=location=>process.platform==='win32'?path.resolve(location).toLowerCase():path.resolve(location),
    contained=location=>{const relative=path.relative(root,location);return Boolean(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);},
    targets=new Set(),counts={nfo:0,poster:0,fanart:0};
  const members=basis.materials.map(original=>{
    const preview=record.proof.paths.find(item=>item.materialKey===original.physicalIdentity.materialKey),kind=REPLACEMENTS[original.role]||null;
    if(!preview||preview.previousLocation!==original.location||preview.role!==original.role||preview.targetEndpointId!==target.endpointId||
        !path.isAbsolute(original.location)||!path.isAbsolute(preview.targetLocation)||
        !contained(preview.targetLocation)||targets.has(key(preview.targetLocation)))fail('File Plan must conserve the exact approved owned paths without aliases or escapes.');
    targets.add(key(preview.targetLocation));
    let source={kind:'retained_inventory',workspaceMaterialHandle:null,artifactHandle:null};
    if(kind) {
      counts[kind]++;const item=prepared.artifacts.find(item=>item.artifactKind===kind),expectation=verified.byteExpectations.find(item=>item.kind===kind),handle=item?.workspaceMaterialHandle,artifact=item?.artifactHandle;
      if(!handle||!artifact||handle.ownerDomain!=='arca'||handle.processId!==record.correctionId||handle.workspaceId!==record.correctionId+'-assets'||
          handle.rootHandleRef!==scope.workspaceRootHandleRef||handle.digestHex!==expectation.byteDigest||handle.sizeBytes!==expectation.sizeBytes||
          artifact.ownerDomain!=='arca'||artifact.ownerScope.scopeType!=='jav_identity_correction'||artifact.ownerScope.scopeId!==record.correctionId||
          artifact.artifactKind!==kind||artifact.digestHex!==handle.digestHex||artifact.sizeBytes!==handle.sizeBytes||artifact.provenanceRef.digest!==record.admissionDigest)
        fail('Replacement must use this correction\'s exact prepared Artifact bytes.');
      source={kind:'correction_artifact',workspaceMaterialHandle:handle,artifactHandle:artifact};
    }
    return {ordinal:original.ordinal,role:original.role,original,source,retainedLocation:javCorrectionRetainedLocation(record.correctionId,original.ordinal,original.location),
      targetEndpointId:target.endpointId,targetLocation:preview.targetLocation};
  });
  if(members.filter(item=>item.role==='primary_payload').length!==1||Object.values(counts).some(count=>count!==1)||record.proof.paths.length!==members.length)
    fail('JAV File Plan must retain one video and replace exactly one NFO, poster and fanart.');
  const body={schemaRef:SCHEMA,schemaVersion:1,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,
    scopeDigest:scope.digest,basisDigest:basis.basisDigest,placementPreviewDigest:record.proof.placementPreviewDigest,
    verifiedSourcePayloadDigest:verified.payloadDigest,preparedAssetsPayloadDigest:prepared.payloadDigest,
    target,retainedPrimaryMaterialKey:basis.materials.find(item=>item.role==='primary_payload').physicalIdentity.materialKey,members};
  if(Buffer.byteLength(canonicalJson(body))>2*1024*1024)fail('Complete File Plan exceeds its bounded Entry scope.');
  return Object.freeze({...body,planDigest:canonicalDigest(body)});
}
const buildJavCorrectionFilePlan=input=>filePlanValue(input,assertJavCorrectionVerifiedSource),
  buildJavCorrectionFilePlanForRecovery=input=>filePlanValue(input,assertJavCorrectionHistoricalSource);
module.exports=Object.freeze({SCHEMA,buildJavCorrectionFilePlan,buildJavCorrectionFilePlanForRecovery});
