'use strict';

const {createHash}=require('node:crypto');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {buffaloModelReference}=require('../../../contracts/buffalo-model-reference');
const {SYSTEM}=require('../model/us-adult-catalogue-registration');
const {resolveUsAdultProviderName}=require('../model/us-adult-provider-name-resolution');
const {preparationWork}=require('./people-image-operation-coordinator');
const {providerImageRequest,catalogueRunToken}=require('./us-adult-catalogue-registration-evidence');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const buffaloRef=()=>buffaloModelReference('single_reference_face');

function createUsAdultCatalogueBuffaloRefresh(options){
  if(!options?.peopleStore||typeof options.peopleStore.getPerson!=='function'||
    typeof options.peopleStore.readUsAdultPersonSnapshot!=='function'||
    typeof options.peopleStore.getPersonReferenceProjection!=='function'||
    !options.operationStore||typeof options.operationStore.create!=='function'||
    typeof options.peopleImagePort?.stageUpload!=='function'||
    typeof options.workResultReader?.status!=='function'||
    typeof options.observeProviderSearch!=='function'||
    typeof options.readImageBytes!=='function')
    throw new TypeError('Buffalo catalogue refresh requires People store, image ops, provider search and image bytes.');

  function buffaloAsset(snapshot){
    const model=buffaloRef().digest;
    const own=snapshot?.referenceProjection?.contributions?.find(item=>item.ownerPersonId===snapshot.personId);
    const face=own?.activeFaces?.find(item=>item.modelRef===model);
    if(!face||!own.activeAssets?.some(asset=>asset.referenceAssetId===face.referenceAssetId))return null;
    return face.referenceAssetId;
  }
  function pendingResult(fields){
    return Object.freeze({kind:'pending',pendingCode:fields.pendingCode,workId:fields.workId||null,operationId:fields.operationId||null});
  }
  function failed(code){return Object.freeze({kind:'failed',code});}
  function modeOf(input,candidate){
    const mode=input?.observationHandle?.mode||candidate?.completedBatches?.mode;
    return mode==='initial'||mode==='initial_and_supplement'?mode:null;
  }
  function replacedImage(personId){
    const projection=options.peopleStore.getPersonReferenceProjection(personId);
    const own=projection?.contributions?.find(item=>item.ownerPersonId===personId);
    const faces=(own?.activeFaces||[]).filter(face=>face.modelRef!==buffaloRef().digest)
      .sort((left,right)=>left.referenceAssetId<right.referenceAssetId?-1:left.referenceAssetId>right.referenceAssetId?1:0);
    const face=faces[0];
    if(!face)return null;
    const asset=own.activeAssets.find(item=>item.referenceAssetId===face.referenceAssetId);
    if(!asset)return null;
    return {referenceAssetId:asset.referenceAssetId,referenceFaceId:face.referenceFaceId,artifactDigest:asset.artifactDigest,
      embeddingDigest:face.embeddingDigest,modelRef:face.modelRef};
  }
  function imageBytesFor(input){
    const direct=options.readImageBytes({kind:'buffalo_refresh',input});
    if(Buffer.isBuffer(direct)&&direct.length)return {bytes:direct,source:'catalogue_frame'};
    let providerObservation;
    try{providerObservation=options.observeProviderSearch({name:input.winner.name,aliases:input.winner.aliases||[],input});}
    catch(error){
      const code=error?.pendingCode||error?.code||'PEOPLE_CATALOGUE_PROVIDER_PENDING';
      if(typeof code==='string'&&code.startsWith('PEOPLE_CATALOGUE_PROVIDER_')&&code!=='PEOPLE_CATALOGUE_PROVIDER_PENDING')
        return failed(code);
      return pendingResult({pendingCode:code});
    }
    if(providerObservation?.kind==='failed')
      return failed(providerObservation.code||'PEOPLE_CATALOGUE_PROVIDER_FAILED');
    if(!providerObservation||providerObservation.kind==='waiting')
      return pendingResult({
        pendingCode:providerObservation?.pendingCode||'PEOPLE_CATALOGUE_PROVIDER_PENDING',
        workId:providerObservation?.workId||null,
      });
    let providerResolution;
    try{providerResolution=resolveUsAdultProviderName({name:input.winner.name,aliases:input.winner.aliases||[],observation:providerObservation});}
    catch(error){
      const code=error?.pendingCode||error?.code||'PEOPLE_CATALOGUE_PROVIDER_INVALID';
      if(typeof code==='string'&&code.startsWith('PEOPLE_CATALOGUE_PROVIDER_')&&code!=='PEOPLE_CATALOGUE_PROVIDER_PENDING')
        return failed(code);
      return pendingResult({pendingCode:code});
    }
    if(!['resolved','not_found'].includes(providerResolution.kind))return failed('PEOPLE_CATALOGUE_PROVIDER_AMBIGUOUS');
    const selected=providerImageRequest(providerObservation,providerResolution);
    if(selected){
      const bytes=options.readImageBytes({kind:'provider',...selected,input});
      if(!Buffer.isBuffer(bytes)||!bytes.length)return pendingResult({pendingCode:'PEOPLE_BUFFALO_REFRESH_IMAGE_PENDING'});
      return {bytes,source:'stashbox'};
    }
    if(typeof options.buildFrameImageProof!=='function')return failed('PEOPLE_CATALOGUE_FRAME_PROOF_UNWIRED');
    const proof=options.buildFrameImageProof({input,providerObservation,providerResolution});
    if(proof?.kind==='failed')return failed(proof.code||'PEOPLE_CATALOGUE_FRAME_PROOF_FAILED');
    if(!proof||proof.kind!=='frame'||!Buffer.isBuffer(proof.bytes)||!proof.bytes.length)
      return pendingResult({pendingCode:'PEOPLE_CATALOGUE_FRAME_PROOF_PENDING'});
    return {bytes:proof.bytes,source:'catalogue_frame'};
  }
  function refreshBuffaloCatalogueReference({personId,head,input,inputDigest,candidate}){
    if(!personId||!head||head.personId!==personId||!input?.winner?.name||typeof inputDigest!=='string')
      return failed('PEOPLE_BUFFALO_REFRESH_STALE');
    const person=options.peopleStore.getPerson(personId);
    if(!person||person.currentRevision!==head.personRevision)return failed('PEOPLE_BUFFALO_REFRESH_STALE');
    const referenceRevision=Number.isSafeInteger(head.currentReferenceRevision)&&head.currentReferenceRevision>=1
      ?head.currentReferenceRevision:0;
    if(referenceRevision>=1){
      const snapshot=options.peopleStore.readUsAdultPersonSnapshot({
        personId,expectedPersonRevision:head.personRevision,expectedReferenceRevision:referenceRevision});
      const readyAsset=buffaloAsset(snapshot);
      if(readyAsset)return Object.freeze({kind:'ready',personSnapshot:snapshot,referenceAssetId:readyAsset});
    }
    const image=imageBytesFor(input);
    if(image?.kind==='pending'||image?.kind==='failed')return image;
    const digest=sha(image.bytes);
    if(options.peopleStore.hasReferenceImage?.(personId,digest)&&referenceRevision>=1){
      const snapshot=options.peopleStore.readUsAdultPersonSnapshot({
        personId,expectedPersonRevision:person.currentRevision,expectedReferenceRevision:person.currentReferenceRevision||referenceRevision});
      if(!buffaloAsset(snapshot))return failed('PEOPLE_REFERENCE_IMAGE_EXISTS');
    }
    const replacing=referenceRevision>=1?replacedImage(personId):null;
    if(referenceRevision>=1&&!replacing)return failed('PEOPLE_BUFFALO_REFRESH_STALE');
    const mode=modeOf(input,candidate);
    const idempotencyKey=canonicalDigest({schema:'people.catalogue-buffalo-refresh@1',personId,
      expectedPersonRevision:head.personRevision,expectedReferenceRevision:referenceRevision,inputDigest,
      imageDigest:digest,modelDigest:buffaloRef().digest,operationKind:replacing?'reference_replace':'reference_add'});
    const existing=options.operationStore.findCommand?.(SYSTEM,idempotencyKey)||null;
    let operationId=existing?.operationId;
    if(!existing){
      const selectedImage=options.peopleImagePort.stageUpload({
        bytes:image.bytes,actorId:SYSTEM,idempotencyKey,
        provenance:{source:image.source,...(mode&&input.libraRunId?{sourceObjectId:catalogueRunToken(input.libraRunId,mode)}:{})}});
      operationId=stable('people-image-operation-',{actorId:SYSTEM,key:idempotencyKey});
      const aliases=(person.revision?.aliases||[]).map(item=>typeof item==='string'?item:item.aliasDisplay).filter(Boolean);
      const payload={schema:'people.image-operation-request@1',operationKind:replacing?'reference_replace':'reference_add',
        expectedPersonRevision:head.personRevision,expectedReferenceRevision:referenceRevision,operationId,personId,actorId:SYSTEM,
        canonicalName:person.revision.canonicalName,aliases:aliases.length?aliases:[person.revision.canonicalName],
        selectedImage,faceModelRef:buffaloRef(),...(replacing?{replacedImage:replacing}:{})};
      options.operationStore.create({operationId,personId,actorId:SYSTEM,idempotencyKey,
        requestDigest:canonicalDigest(payload),payload});
    }
    if(typeof options.reconcileImageOperation==='function')options.reconcileImageOperation(operationId);
    const operation=options.operationStore.get(operationId);
    if(!operation)return failed('PEOPLE_BUFFALO_REFRESH_STALE');
    if(operation.state==='failed')return failed(operation.failureCode||'PEOPLE_BUFFALO_REFRESH_FAILED');
    const work=preparationWork(operation),status=options.workResultReader.status(work.workId);
    if(operation.state==='preparing'&&status?.state!=='succeeded')
      return pendingResult({pendingCode:'PEOPLE_BUFFALO_REFRESH_PREP_PENDING',workId:work.workId,operationId});
    if(['failed','cancelled'].includes(status?.state))
      return failed(status.latestAttempt?.failure_code||status.latestAttempt?.failureCode||'PEOPLE_BUFFALO_REFRESH_FAILED');
    const refreshed=options.peopleStore.getPerson(personId);
    if(!refreshed?.currentReferenceRevision)return failed('PEOPLE_BUFFALO_REFRESH_UNAPPLIED');
    const personSnapshot=options.peopleStore.readUsAdultPersonSnapshot({
      personId,expectedPersonRevision:refreshed.currentRevision,expectedReferenceRevision:refreshed.currentReferenceRevision});
    const referenceAssetId=buffaloAsset(personSnapshot);
    if(!referenceAssetId)return failed('PEOPLE_BUFFALO_REFRESH_UNAPPLIED');
    return Object.freeze({kind:'ready',personSnapshot,referenceAssetId});
  }
  return Object.freeze({refreshBuffaloCatalogueReference,buffaloAsset});
}

module.exports=Object.freeze({createUsAdultCatalogueBuffaloRefresh});
