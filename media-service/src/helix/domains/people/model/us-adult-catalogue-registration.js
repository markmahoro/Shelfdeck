'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buffaloModelReference}=require('../../../contracts/buffalo-model-reference');
const {assertCatalogueObservation}=require('../../../contracts/buffalo-catalogue-observation');
const {assertCatalogueDecisionInput}=require('../../../contracts/us-adult-catalogue-decision-input');
const {POLICY,queryNames}=require('../../../contracts/us-adult-name-query');
const {resolveUsAdultProviderName}=require('./us-adult-provider-name-resolution');

const SCHEMA='helix://contracts/domain-types/PeopleCatalogueRegistrationDecision/v1';
const ORIGIN='people.us-adult-catalogue-origin@1',SYSTEM='system:people.catalogue-registration',HASH=/^[a-f0-9]{64}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const hash=value=>typeof value==='string'&&HASH.test(value),text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max;
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),id=()=>({type:'string',minLength:1,maxLength:256}),
  object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),
  ref=name=>({$ref:'helix://contracts/domain-types/'+name+'/v1'});
function fail(message){throw Object.assign(new TypeError(message),{code:'PEOPLE_CATALOGUE_REGISTRATION_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function proofSchema(){
  const provider=object({kind:{const:'provider'},providerKey:id(),imageId:id(),urlDigest:digest(),imageDigest:digest()});
  const rectangle=object({left:{type:'integer',minimum:0},top:{type:'integer',minimum:0},width:{type:'integer',minimum:1},height:{type:'integer',minimum:1}});
  const frame=object({kind:{const:'frame'},proof:object({schema:{const:'shared.buffalo-representative-image@1'},basisDigest:digest(),
    frameEvidenceDigest:digest(),sourceImageDigest:digest(),faceOrdinal:{type:'integer',minimum:0,maximum:31},faceEvidenceDigest:digest(),
    modelRefDigest:digest(),coordinateSpaceDigest:digest(),renderingPolicyDigest:digest(),rectangle,encoding:{const:'png'},
    imageDigest:digest(),imageBytes:{type:'integer',minimum:1,maximum:10485760},proofDigest:digest()})});
  return {oneOf:[provider,frame]};
}
function originSchema(){return object({schema:{const:ORIGIN},catalogueDecisionInputDigest:digest(),sourceObservationDigest:digest(),assessmentDigest:digest(),
  identityKey:id(),uid:id(),selectedName:{type:'string',minLength:1,maxLength:200},aliases:{type:'array',maxItems:16,items:{type:'string',minLength:1,maxLength:200}},
  nameQueryDigest:digest(),libraryNamesDigest:digest(),nameResolutionDigest:digest(),providerObservationDigest:digest(),providerResolutionDigest:digest(),
  imageSourceProofDigest:digest(),imageSourceProof:proofSchema()});}
function schema(){
  const alias=object({aliasDisplay:{type:'string',minLength:1,maxLength:200},aliasNormalized:{type:'string',minLength:1,maxLength:200},provenanceDigest:digest()});
  const identity=object({provider:{const:'theporndb'},namespace:{const:'performer'},providerKey:id(),provenanceDigest:digest()});
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCHEMA,title:'PeopleCatalogueRegistrationDecision@1',
    'x-helix-ssotRefs':['6.4.7.1','8.6.18','8.6.20'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':256*1024,
    ...object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},decisionId:digest(),operationId:id(),newPersonId:id(),libraryKind:{const:'us_adult'},
      canonicalName:{type:'string',minLength:1,maxLength:200},aliases:{type:'array',minItems:1,maxItems:17,items:alias},
      providerIdentities:{type:'array',maxItems:1,items:identity},initialReference:ref('PeopleReferenceMaintenanceDecision'),
      catalogueOrigin:originSchema(),decisionDigest:digest()})};
}
function operationIdentity({inputDigest,nameResolutionDigest,imageSourceProof}){
  if(!hash(inputDigest)||!hash(nameResolutionDigest)||!imageSourceProof||typeof imageSourceProof!=='object')fail('A frozen actor input, name decision and image proof are required.');
  return operationIdentityFromDigest({inputDigest,nameResolutionDigest,imageSourceProofDigest:canonicalDigest(imageSourceProof)});
}
function operationIdentityFromDigest({inputDigest,nameResolutionDigest,imageSourceProofDigest}){
  if(!hash(inputDigest)||!hash(nameResolutionDigest)||!hash(imageSourceProofDigest))fail('An exact frozen registration identity is required.');
  const key=canonicalDigest({schema:'people.catalogue-registration-operation-id@1',
    catalogueDecisionInputDigest:inputDigest,nameResolutionDigest,imageSourceProofDigest});
  const operationId='people-image-operation-'+key.slice(0,40),personId='person-'+canonicalDigest(operationId).slice(0,40);
  return Object.freeze({operationId,personId,imageSourceProofDigest});
}
function assertLocalNotFound(input,resolution){
  if(!exact(resolution,['schema','policyRef','kind','nameQueryDigest','libraryNamesDigest','candidates','resolutionDigest'])||
    resolution.schema!=='people.us-adult-name-resolution@1'||resolution.policyRef!==POLICY||resolution.kind!=='not_found'||
    !Array.isArray(resolution.candidates)||resolution.candidates.length!==0||!hash(resolution.libraryNamesDigest)||!hash(resolution.nameQueryDigest)||
    !hash(resolution.resolutionDigest)||resolution.nameQueryDigest!==canonicalDigest({policyRef:POLICY,names:queryNames(input.winner.name,input.winner.aliases)}))
    fail('System registration requires a complete People not-found result for this exact name.');
  const {resolutionDigest,...body}=resolution;if(canonicalDigest(body)!==resolutionDigest)fail('The People name resolution was modified.');
}
function assertImageSource({input,observation,providerObservation,providerResolution,imageSourceProof,artifactDigest}){
  if(!imageSourceProof||!['provider','frame'].includes(imageSourceProof.kind)||!hash(artifactDigest))fail('One exact selected image source is required.');
  const candidates=providerResolution.kind==='resolved'?providerObservation.queries.flatMap(query=>query.candidates)
    .filter(candidate=>candidate.providerKey===providerResolution.candidates[0].providerKey):[];
  if(imageSourceProof.kind==='provider'){
    if(!exact(imageSourceProof,['kind','providerKey','imageId','urlDigest','imageDigest'])||providerResolution.kind!=='resolved'||
      !text(imageSourceProof.providerKey)||!text(imageSourceProof.imageId)||!hash(imageSourceProof.urlDigest)||imageSourceProof.imageDigest!==artifactDigest||
      !candidates.some(candidate=>candidate.providerKey===imageSourceProof.providerKey&&candidate.images.some(image=>
        image.imageId===imageSourceProof.imageId&&image.urlDigest===imageSourceProof.urlDigest)))
      fail('The selected Provider image is not in the unique complete name result.');
    return;
  }
  if(!exact(imageSourceProof,['kind','proof'])||providerResolution.kind==='resolved'&&candidates.some(candidate=>candidate.images.length))
    fail('A video representative is allowed only when the complete Provider result has no image.');
  const proof=imageSourceProof.proof,keys=['schema','basisDigest','frameEvidenceDigest','sourceImageDigest','faceOrdinal','faceEvidenceDigest',
    'modelRefDigest','coordinateSpaceDigest','renderingPolicyDigest','rectangle','encoding','imageDigest','imageBytes','proofDigest'];
  if(!exact(proof,keys)||proof.schema!=='shared.buffalo-representative-image@1'||proof.basisDigest!==input.catalogueBasisDigest||
    proof.modelRefDigest!==observation.modelRefDigest||proof.renderingPolicyDigest!==input.representativeImagePolicyDigest||
    !['frameEvidenceDigest','sourceImageDigest','faceEvidenceDigest','coordinateSpaceDigest','proofDigest'].every(key=>hash(proof[key]))||
    !Number.isSafeInteger(proof.faceOrdinal)||proof.faceOrdinal<0||proof.faceOrdinal>31||proof.encoding!=='png'||proof.imageDigest!==artifactDigest||
    !Number.isSafeInteger(proof.imageBytes)||proof.imageBytes<1||proof.imageBytes>10485760||!exact(proof.rectangle,['left','top','width','height'])||
    !['left','top','width','height'].every(key=>Number.isSafeInteger(proof.rectangle[key])&&proof.rectangle[key]>=(['width','height'].includes(key)?1:0)))
    fail('The video representative does not match its bounded input and rendering policy.');
  const {proofDigest,...body}=proof;if(canonicalDigest(body)!==proofDigest)fail('The representative-image proof was modified.');
  const frame=observation.frameEvidenceRefs.find(item=>item.frameEvidenceDigest===proof.frameEvidenceDigest&&item.imageDigest===proof.sourceImageDigest),
    face=frame?.faces.find(item=>item.faceOrdinal===proof.faceOrdinal&&item.faceEvidenceDigest===proof.faceEvidenceDigest),
    faceKey=frame&&frame.frameOrdinal+':'+proof.faceOrdinal,
    group=observation.groups.find(item=>input.winner.groupIds.includes(item.clusterId)&&item.representativeKeys.includes(faceKey)),
    query=observation.queries.find(item=>item.faceKey===faceKey&&item.faceEvidenceDigest===proof.faceEvidenceDigest);
  if(!face||!group||!query?.result.matches.some(item=>item.identityKey===input.winner.identityKey&&item.uid===input.winner.uid&&item.name===input.winner.name))
    fail('The video crop is not a representative of the selected observed directory identity.');
}
function buildCatalogueRegistration({input,inputDigest,resolution,observation,providerObservation,imageSourceProof,initialReference}){
  assertCatalogueDecisionInput(input,inputDigest);assertLocalNotFound(input,resolution);assertCatalogueObservation(observation);
  const sourceObservationDigest=canonicalDigest(observation);
  if(sourceObservationDigest!==input.observationHandle.observationArtifactHandle.digestHex||
    observation.observationDigest!==input.observationHandle.observationDigest||observation.basisDigest!==input.catalogueBasisDigest||
    !observation.queries.some(query=>query.result.matches.some(item=>item.identityKey===input.winner.identityKey&&
      item.uid===input.winner.uid&&item.name===input.winner.name)))fail('The directory Observation does not contain the selected identity.');
  const providerResolution=resolveUsAdultProviderName({name:input.winner.name,aliases:input.winner.aliases,observation:providerObservation});
  if(!['resolved','not_found'].includes(providerResolution.kind))fail('The Provider name result is ambiguous or incomplete.');
  const identity=operationIdentity({inputDigest,nameResolutionDigest:resolution.resolutionDigest,imageSourceProof}),reference=initialReference;
  const image=reference?.artifactHandle,embedding=reference?.faceEmbeddingSetHandle;
  const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
  if(!reference||reference.operationKind!=='add_image'||reference.personId!==identity.personId||reference.actorId!==SYSTEM||
    reference.expectedPersonRevision!==1||reference.expectedReferenceRevision!==0||reference.initialState!=='active'||
    reference.decisionId!==stable('people-initial-reference-',identity.operationId)||
    reference.referenceAssetId!==stable('people-reference-asset-',identity.operationId)||
    reference.referenceFaceId!==stable('people-reference-face-',identity.operationId)||
    reference.modelRef!==buffaloModelReference('single_reference_face').digest||!hash(reference.artifactDigest)||
    image?.digestHex!==reference.artifactDigest||image?.artifactKind!=='reference-image'||image?.ownerDomain!=='people'||
    image?.ownerScope?.scopeType!=='person'||image?.ownerScope?.scopeId!==identity.personId||
    embedding?.faceModelRefDigest!==reference.modelRef||embedding?.sourceArtifactSetDigest!==reference.artifactDigest||
    embedding?.detectedFaceCount!==1||embedding?.vectorCount!==1||embedding?.dimension!==512||embedding?.computationMode!=='single_reference_face'||
    embedding?.libraRunId!==null||embedding?.workspaceId!==null||embedding?.artifactHandle?.artifactKind!=='reference-embedding'||
    embedding?.artifactHandle?.ownerDomain!=='people'||embedding?.artifactHandle?.ownerScope?.scopeType!=='person'||
    embedding?.artifactHandle?.ownerScope?.scopeId!==identity.personId||embedding?.artifactHandleId!==embedding?.artifactHandle?.artifactHandleId||
    embedding?.embeddingDigest!==embedding?.artifactHandle?.digestHex||!hash(embedding?.handleDigest)||
    canonicalDigest(Object.fromEntries(Object.entries(embedding).filter(([key])=>key!=='handleDigest')))!==embedding.handleDigest)
    fail('The new Person requires an exact single-face buffalo_l initial reference.');
  const {decisionDigest:referenceDigest,...referenceBody}=reference;
  if(!hash(referenceDigest)||canonicalDigest(referenceBody)!==referenceDigest)fail('The initial Reference decision changed.');
  assertImageSource({input,observation,providerObservation,providerResolution,imageSourceProof,artifactDigest:reference.artifactDigest});
  const catalogueOrigin={schema:ORIGIN,catalogueDecisionInputDigest:inputDigest,sourceObservationDigest,assessmentDigest:input.assessmentDigest,
    identityKey:input.winner.identityKey,uid:input.winner.uid,selectedName:input.winner.name,aliases:input.winner.aliases,
    nameQueryDigest:resolution.nameQueryDigest,libraryNamesDigest:resolution.libraryNamesDigest,nameResolutionDigest:resolution.resolutionDigest,
    providerObservationDigest:canonicalDigest(providerObservation),providerResolutionDigest:providerResolution.resolutionDigest,
    imageSourceProofDigest:identity.imageSourceProofDigest,imageSourceProof};
  if(Buffer.byteLength(canonicalJson(catalogueOrigin))>64*1024)fail('The complete People origin exceeds its bound.');
  const names=[...new Map([input.winner.name,...input.winner.aliases].map(name=>[name.toLowerCase(),name])).values()],
    aliases=names.map(name=>({aliasDisplay:name,aliasNormalized:name.toLowerCase(),provenanceDigest:canonicalDigest({schema:'people.catalogue-alias@1',inputDigest,name})})),
    providerIdentities=providerResolution.kind==='resolved'?[{provider:'theporndb',namespace:'performer',providerKey:providerResolution.candidates[0].providerKey,
      provenanceDigest:providerResolution.resolutionDigest}]:[];
  const decisionId=canonicalDigest({schema:'people.catalogue-registration-decision-id@1',operationId:identity.operationId,inputDigest,
    providerObservationDigest:catalogueOrigin.providerObservationDigest,imageSourceProofDigest:identity.imageSourceProofDigest});
  const body={schemaRef:SCHEMA,schemaVersion:1,decisionId,operationId:identity.operationId,newPersonId:identity.personId,libraryKind:'us_adult',
    canonicalName:input.winner.name,aliases,providerIdentities,initialReference:reference,catalogueOrigin};
  if(Buffer.byteLength(canonicalJson(body))>256*1024)fail('The complete system registration exceeds its bound.');
  return freeze(JSON.parse(canonicalJson({...body,decisionDigest:canonicalDigest(body)})));
}
module.exports=Object.freeze({SCHEMA,ORIGIN,SYSTEM,schema,operationIdentity,operationIdentityFromDigest,assertLocalNotFound,assertImageSource,buildCatalogueRegistration});
