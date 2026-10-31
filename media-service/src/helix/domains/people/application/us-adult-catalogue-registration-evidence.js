'use strict';

const {createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buffaloModelReference}=require('../../../contracts/buffalo-model-reference');
const {operationIdentity,SYSTEM}=require('../model/us-adult-catalogue-registration');
const {SCHEMA:CATALOGUE_SCHEMA}=require('../model/prepared-catalogue-registration');
const {resolveUsAdultProviderName}=require('../model/us-adult-provider-name-resolution');
const {pending}=require('./us-adult-catalogue-registration-admission');
const {preparationWork}=require('./people-image-operation-coordinator');

const IMPORT='people.reference_asset.import@1',EMBED='shared.face.embedding.compute@1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/**
 * People-owned Host evidence assembly for catalogue auto-registration.
 * Creates catalogue_registration image ops and returns waiting until import+embed
 * Results exist, then returns the frozen evidence tuple for admission/register.
 */
function createUsAdultCatalogueRegistrationEvidence(options){
  if(!options?.operationStore||typeof options.operationStore.createCatalogue!=='function'||
    typeof options.operationStore.get!=='function'||
    typeof options.peopleImagePort?.stageUpload!=='function'||
    typeof options.workResultReader?.status!=='function'||
    typeof options.observeProviderSearch!=='function'||
    typeof options.readImageBytes!=='function')
    throw new TypeError('Catalogue registration evidence requires operation store, image port, provider search and image bytes.');
  const pendingByInput=new Map();

  function aliasesFor(input){
    const names=[input.winner.name,...(input.winner.aliases||[])];
    return [...new Map(names.map(name=>[name.toLowerCase(),name])).values()];
  }

  function selectProof({input,resolution,observation,providerObservation}){
    const providerResolution=resolveUsAdultProviderName({
      name:input.winner.name,aliases:input.winner.aliases||[],observation:providerObservation});
    if(!['resolved','not_found'].includes(providerResolution.kind))
      pending('PEOPLE_CATALOGUE_PROVIDER_AMBIGUOUS','Provider name result is not unique for catalogue registration.');
    if(providerResolution.kind==='resolved'){
      const key=providerResolution.candidates[0].providerKey;
      const person=providerObservation.queries.flatMap(query=>query.candidates).find(item=>item.providerKey===key);
      const image=person?.images?.[0];
      if(image){
        return Object.freeze({kind:'provider',providerKey:key,imageId:image.imageId,urlDigest:image.urlDigest,
          imageDigest:null,providerResolution,selectedPerson:person,selectedImage:image});
      }
    }
    if(typeof options.buildFrameImageProof!=='function')
      pending('PEOPLE_CATALOGUE_FRAME_PROOF_PENDING','Catalogue registration needs a frame proof when Provider has no image.');
    const proof=options.buildFrameImageProof({input,observation,providerObservation,providerResolution});
    if(!proof||proof.kind!=='frame')pending('PEOPLE_CATALOGUE_FRAME_PROOF_PENDING','Frame proof for catalogue registration is not ready.');
    return Object.freeze({...proof,providerResolution});
  }

  function ensureOperation({input,inputDigest,resolution,observation,providerObservation,imageSourceProof,selectedImage}){
    const identity=operationIdentity({inputDigest,nameResolutionDigest:resolution.resolutionDigest,imageSourceProof});
    const existing=options.operationStore.get(identity.operationId);
    if(existing)return existing;
    const aliases=aliasesFor(input);
    const payload={schema:CATALOGUE_SCHEMA,operationKind:'catalogue_registration',expectedPersonRevision:1,expectedReferenceRevision:0,
      operationId:identity.operationId,personId:identity.personId,actorId:SYSTEM,canonicalName:input.winner.name,aliases,
      selectedImage,faceModelRef:buffaloModelReference('single_reference_face'),
      catalogueDecisionInputDigest:inputDigest,nameResolutionDigest:resolution.resolutionDigest,
      imageSourceProofDigest:identity.imageSourceProofDigest};
    return options.operationStore.createCatalogue(payload);
  }

  function assembleEvidence({input,inputDigest,resolution,candidate}){
    if(!input||!inputDigest||!resolution||resolution.kind!=='not_found')
      pending('PEOPLE_CATALOGUE_EVIDENCE_PENDING','Catalogue registration evidence requires a not_found name resolution.');
    const observation=candidate?.observation||options.readObservation?.(candidate)||null;
    if(!observation)pending('PEOPLE_CATALOGUE_OBSERVATION_PENDING','Catalogue observation is not available for registration evidence.');
    let providerObservation;
    try{providerObservation=options.observeProviderSearch({name:input.winner.name,aliases:input.winner.aliases||[]});}
    catch(error){
      if(error?.code==='PEOPLE_CATALOGUE_REGISTRATION_PENDING')throw error;
      pending(error?.pendingCode||'PEOPLE_CATALOGUE_PROVIDER_PENDING',error?.message||'Provider search for catalogue registration is not ready.');
    }
    if(providerObservation?.kind==='waiting')
      return Object.freeze({kind:'waiting',pendingCode:providerObservation.pendingCode||'PEOPLE_CATALOGUE_PROVIDER_PENDING',
        workId:providerObservation.workId||null});
    const selected=selectProof({input,resolution,observation,providerObservation});
    let imageBytes,imageSourceProof;
    if(selected.kind==='provider'){
      imageBytes=options.readImageBytes({kind:'provider',providerKey:selected.providerKey,imageId:selected.imageId,
        urlDigest:selected.urlDigest,person:selected.selectedPerson,image:selected.selectedImage});
      if(!Buffer.isBuffer(imageBytes)||!imageBytes.length)
        pending('PEOPLE_CATALOGUE_IMAGE_PENDING','Provider image bytes are not ready for catalogue registration.');
      imageSourceProof=Object.freeze({kind:'provider',providerKey:selected.providerKey,imageId:selected.imageId,
        urlDigest:selected.urlDigest,imageDigest:sha(imageBytes)});
    }else{
      imageBytes=selected.bytes;
      imageSourceProof=Object.freeze({kind:'frame',proof:selected.proof});
      if(!Buffer.isBuffer(imageBytes)||!imageBytes.length)
        pending('PEOPLE_CATALOGUE_IMAGE_PENDING','Frame crop bytes are not ready for catalogue registration.');
    }
    const selectedImage=options.peopleImagePort.stageUpload({
      bytes:imageBytes,actorId:SYSTEM,idempotencyKey:'catalogue-registration-'+imageSourceProof.kind+'-'+
        (imageSourceProof.imageDigest||imageSourceProof.proof.imageDigest),
      provenance:imageSourceProof.kind==='provider'
        ?{source:'stashbox',providerKey:imageSourceProof.providerKey,imageId:imageSourceProof.imageId}
        :{source:'catalogue_frame',proofDigest:imageSourceProof.proof.proofDigest},
    });
    const operation=ensureOperation({input,inputDigest,resolution,observation,providerObservation,imageSourceProof,selectedImage});
    if(typeof options.reconcileImageOperation==='function')options.reconcileImageOperation(operation.operationId);
    const work=preparationWork(operation),status=options.workResultReader.status(work.workId);
    const record={input,inputDigest,resolution,observation,providerObservation,imageSourceProof,operationId:operation.operationId};
    pendingByInput.set(inputDigest,record);
    if(status?.state!=='succeeded')
      return Object.freeze({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_IMAGE_PREP_PENDING',workId:work.workId,
        operationId:operation.operationId});
    if(typeof options.referenceDecision!=='function')
      pending('PEOPLE_CATALOGUE_REFERENCE_PENDING','Catalogue reference decision is not available after image prep.');
    const initialReference=options.referenceDecision(operation.operationId);
    return Object.freeze({...record,initialReference});
  }

  function readCatalogueRegistrationEvidence({operation,initialReference}){
    if(!operation?.payload)return Object.freeze({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_EVIDENCE_PENDING'});
    const inputDigest=operation.payload.catalogueDecisionInputDigest;
    const record=pendingByInput.get(inputDigest)||options.readPendingEvidence?.(inputDigest)||null;
    if(!record)return Object.freeze({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_EVIDENCE_PENDING'});
    if(!initialReference)return Object.freeze({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_REFERENCE_PENDING'});
    return Object.freeze({...record,initialReference});
  }

  function hasOpenPrep(){
    // Catalogue auto-registration image prep only (not buffalo reference refresh).
    if(typeof options.operationStore.listPendingPage!=='function')return false;
    const page=options.operationStore.listPendingPage({cursor:null,limit:100});
    return page.some(item=>{
      const operation=options.operationStore.get(item.scope.operationId);
      return operation&&operation.payload?.operationKind==='catalogue_registration'&&
        operation.payload?.faceModelRef&&
        canonicalDigest(operation.payload.faceModelRef)===canonicalDigest(buffaloModelReference('single_reference_face'));
    });
  }

  return Object.freeze({assembleEvidence,readCatalogueRegistrationEvidence,hasOpenPrep,SYSTEM});
}

module.exports=Object.freeze({createUsAdultCatalogueRegistrationEvidence});
