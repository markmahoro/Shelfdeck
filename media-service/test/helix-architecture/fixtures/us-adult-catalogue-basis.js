'use strict';
const {canonicalDigest:D}=require('../../../src/helix/contracts/canonical-json');
const {createGeneration,MEMBER_NAMES}=require('../../../src/helix/contracts/face-catalogue-generation');
const {policy}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-assessment');
const {catalogueSearchPolicy}=require('../../../src/helix/contracts/face-catalogue-search-policy');
const {representativeImagePolicy}=require('../../../src/helix/contracts/buffalo-representative-policy');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {sourceMediaObservationWork}=require('../../../src/helix/domains/libra/planning/media-production-work');
const contracts='../../../src/helix/contracts/';
const contractValidator=createCapabilityContractValidator({schemas:[
  ...['UsAdultCatalogueAnalysisBasis','FaceCatalogueGeneration','FaceModelRef','SamplingPlan','ClusterParameters'].map(type=>require(contracts+'domain-types/'+type+'/v1/schema.json')),
  ...['PhysicalMaterialReadHandle/v1','PhysicalMaterialIdentity/v2','MediaProbeEvidence/v1'].map(type=>require(contracts+'types/'+type+'/schema.json')),
  require(contracts+'capabilities/shared/material/media/probe/v1/result.schema.json'),
]});
function fixture(){
  const identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId:'mount',inode:'42',sizeBytes:100,
    fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('source')};
  identity.materialKey=D({schema:'physical-material-identity@2',...Object.fromEntries(Object.entries(identity).filter(([key])=>!['schemaRef','schemaVersion'].includes(key)))});
  const sourceHandle={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,handleId:'source',identity,
    ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run'},bindingRevision:1,endpointId:'source',location:'/fixture/source.mp4',
    mountScopeRevision:1,expectedSizeBytes:100,expectedMtimeNs:1,expectedCtimeNs:1,fingerprintVerifiedAtMs:1,readScope:'material_read',expiresAtMs:4102444800000,fenceDigest:D('fence')},
    probe={schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,evidenceId:'source-probe',evidenceKind:'media_probe',producerRef:'shared.material.media.probe@1',
      basisDigest:D(sourceHandle),observedAtMs:1,sourceHandleDigest:D(sourceHandle),resultKind:'probed',sizeBytes:100,durationMs:3600000,container:'matroska',
      videoStreams:[{streamIndex:0,dispositionDefault:true,codec:'h264',codecProfile:'high',pixelFormat:'yuv420p',bitDepth:8,chroma:'4:2:0',
        colorRange:'limited',colorPrimaries:'bt709',colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr',codedWidth:640,codedHeight:480,
        sampleAspectRatio:'1:1',rotation:0,displayWidth:640,displayHeight:480,longEdge:640,shortEdge:480}],audioStreams:[],subtitleStreams:[]};
  probe.payloadDigest=D(probe);
  const inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[{
    portName:'physicalMaterialReadHandleOrWorkspaceMaterialHandle',bindingKind:'projected_owner_facts',ownerDomain:'libra',processType:'libra_run',processId:'run',
    projectionRef:'helix://libra/input-projections/SourceMedia/v1',parameters:{}}]},
    sourceProbeRecord={workId:'probe-work',attemptId:'probe-attempt',planId:'probe-plan',eventId:'probe-event',resultId:'probe-result',outcomeKind:'succeeded',
      capabilityRef:'shared.material.media.probe@1',resultSchemaRef:'helix://contracts/capabilities/shared.material.media.probe/v1/result',
      inputBindings,inputBindingDigest:D(inputBindings),result:probe,resultDigest:D(probe)};
  const value={snapshot:{run:{libraRunId:'run',subjectId:'subject',state:'active',stateRevision:2,executionBasisDigest:D('execution'),acceptanceSpecId:'spec',
      runMaterialManifestId:'manifest',runMaterialManifestDigest:D('manifest'),runScopeDigest:D('scope'),createdAtMs:1},spec:{contentProfile:'western_adult'},
      materialInputForm:'stream_file',members:[{role:'primary_payload',materialKey:identity.materialKey,physicalIdentity:identity}],resolvedIdentityDigest:D('resolved')},
    sourceHandle,sourceProbeRecord,workspaceId:'workspace',catalogueGeneration:createGeneration({datasetVersion:'test-v1',manifestDigest:D('manifest'),
      members:MEMBER_NAMES.map(name=>({name,bytes:10,sha256:D(name)}))}),catalogueSearchPolicy:catalogueSearchPolicy(),representativeImagePolicy:representativeImagePolicy(),clusterThreshold:0.6,clusterAmbiguityMargin:0.05,
    selectionPolicy:policy({maximumDistance:0.5,minimumDistanceMargin:0.05,minimumRepresentativeStrata:2,minimumCoverageStrata:3}),
    resourceBudget:{cpuSlots:1,memoryBytes:2147483648,maximumFrames:40,maximumFacesPerFrame:32,maximumFrameBytes:10485760,
      maximumWorkspaceBytes:268435456,frameDeadlineMs:30000,imageDeadlineMs:60000,analysisDeadlineMs:900000},contractValidator};
  sourceProbeRecord.workId=sourceMediaObservationWork(value.snapshot).workId;return value;
}
module.exports=Object.freeze({fixture,contractValidator,D});
