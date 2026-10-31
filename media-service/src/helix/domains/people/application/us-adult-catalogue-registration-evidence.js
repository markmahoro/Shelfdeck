'use strict';

const {createHash}=require('node:crypto');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {buffaloModelReference}=require('../../../contracts/buffalo-model-reference');
const {operationIdentity,SYSTEM}=require('../model/us-adult-catalogue-registration');
const {SCHEMA:CATALOGUE_SCHEMA}=require('../model/prepared-catalogue-registration');
const {resolveUsAdultProviderName}=require('../model/us-adult-provider-name-resolution');
const {pending}=require('./us-adult-catalogue-registration-admission');
const {preparationWork}=require('./people-image-operation-coordinator');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const RUN_TOKEN=/^catalogue-run\/([^/]+)\/(initial|initial_and_supplement)$/;
const PREP_KINDS=new Set(['catalogue_registration','reference_add','reference_replace']);

function catalogueRunToken(libraRunId,mode){
  return 'catalogue-run/'+libraRunId+'/'+mode;
}
function catalogueRunId(sourceObjectId){
  const match=typeof sourceObjectId==='string'?sourceObjectId.match(RUN_TOKEN):null;
  return match?match[1]:null;
}
function buffaloModel(){return buffaloModelReference('single_reference_face');}
function isBuffaloModel(faceModelRef){
  return Boolean(faceModelRef)&&canonicalDigest(faceModelRef)===canonicalDigest(buffaloModel());
}
function providerImageRequest(providerObservation,providerResolution){
  if(providerResolution?.kind!=='resolved')return null;
  const providerKey=providerResolution.candidates[0].providerKey;
  const person=providerObservation.queries.flatMap(query=>query.candidates).find(item=>item.providerKey===providerKey);
  const image=[...(person?.images||[])].sort((left,right)=>Buffer.compare(Buffer.from(left.imageId),Buffer.from(right.imageId)))[0];
  if(!image)return null;
  return {kind:'provider',providerKey,imageId:image.imageId,urlDigest:image.urlDigest};
}
function openCataloguePrepRunIds(operationStore){
  const runs=new Set();
  if(typeof operationStore?.listPendingPage!=='function'||typeof operationStore.get!=='function')return runs;
  let cursor=null;
  for(let page=0;page<20;page+=1){
    const items=operationStore.listPendingPage({cursor,limit:100});
    if(!items.length)break;
    for(const item of items){
      const operation=operationStore.get(item.scope?.operationId||item.cursor);
      if(!operation||operation.state!=='preparing')continue;
      if(!PREP_KINDS.has(operation.payload?.operationKind)||!isBuffaloModel(operation.payload.faceModelRef))continue;
      const runId=catalogueRunId(operation.payload.selectedImage?.provenance?.sourceObjectId);
      if(runId)runs.add(runId);
    }
    if(items.length<100)break;
    cursor=items[items.length-1].cursor;
  }
  return runs;
}

function createUsAdultCatalogueRegistrationEvidence(options){
  if(!options?.operationStore||typeof options.operationStore.createCatalogue!=='function'||
    typeof options.operationStore.get!=='function'||
    typeof options.peopleImagePort?.stageUpload!=='function'||
    typeof options.workResultReader?.status!=='function'||
    typeof options.observeProviderSearch!=='function'||
    typeof options.readImageBytes!=='function')
    throw new TypeError('Catalogue registration evidence requires operation store, image port, provider search and image bytes.');
  function closedEvidence(record,initialReference){
    return Object.freeze({input:record.input,inputDigest:record.inputDigest,resolution:record.resolution,
      observation:record.observation,providerObservation:record.providerObservation,
      imageSourceProof:record.imageSourceProof,initialReference});
  }

  function aliasesFor(input){
    return [...new Map([input.winner.name,...(input.winner.aliases||[])].map(name=>[name.toLowerCase(),name])).values()];
  }
  function modeOf(input,candidate){
    const mode=input?.observationHandle?.mode||candidate?.completedBatches?.mode;
    if(mode!=='initial'&&mode!=='initial_and_supplement')
      pending('PEOPLE_CATALOGUE_OBSERVATION_PENDING','Catalogue registration needs the completed observation mode.');
    return mode;
  }
  function provenanceFor(input,candidate,imageSourceProof){
    if(typeof input?.libraRunId!=='string'||!input.libraRunId)
      pending('PEOPLE_CATALOGUE_OBSERVATION_PENDING','Catalogue registration needs the Libra run that observed this actor.');
    const base={source:imageSourceProof.kind==='provider'?'stashbox':'catalogue_frame',
      sourceObjectId:catalogueRunToken(input.libraRunId,modeOf(input,candidate))};
    if(imageSourceProof.kind==='provider')
      return {...base,providerKey:imageSourceProof.providerKey,imageId:imageSourceProof.imageId};
    return {...base,proofDigest:imageSourceProof.proof.proofDigest};
  }
  function loadObservation(input,candidate){
    if(candidate?.observation)return candidate.observation;
    const direct=options.readObservation?.({input,candidate});
    if(direct)return direct;
    const handle=input?.observationHandle?.observationArtifactHandle;
    if(typeof options.workspaceProductPort?.readArtifactBytes!=='function'||!handle)
      pending('PEOPLE_CATALOGUE_OBSERVATION_PENDING','Catalogue observation is not available for registration evidence.');
    const loaded=options.workspaceProductPort.readArtifactBytes(handle);
    const bytes=Buffer.isBuffer(loaded)?loaded:loaded?.bytes;
    if(!Buffer.isBuffer(bytes)||!bytes.length)
      pending('PEOPLE_CATALOGUE_OBSERVATION_PENDING','Catalogue observation bytes are not available for registration evidence.');
    let observation;
    try{observation=JSON.parse(bytes.toString('utf8'));}
    catch{pending('PEOPLE_CATALOGUE_OBSERVATION_PENDING','Catalogue observation bytes are not readable.');}
    if(canonicalDigest(observation)!==handle.digestHex)
      pending('PEOPLE_CATALOGUE_OBSERVATION_PENDING','Catalogue observation bytes do not match the frozen handle.');
    return observation;
  }
  function providerObservationFor(input,candidate){
    let providerObservation;
    try{providerObservation=options.observeProviderSearch({name:input.winner.name,aliases:input.winner.aliases||[],input,candidate});}
    catch(error){
      if(error?.code==='PEOPLE_CATALOGUE_REGISTRATION_PENDING')throw error;
      pending(error?.pendingCode||error?.code||'PEOPLE_CATALOGUE_PROVIDER_PENDING',error?.message||'Provider search for catalogue registration is not ready.');
    }
    if(!providerObservation||providerObservation.kind==='waiting')
      return {waiting:true,pendingCode:providerObservation?.pendingCode||'PEOPLE_CATALOGUE_PROVIDER_PENDING',workId:providerObservation?.workId||null};
    return {providerObservation};
  }
  function selectProof({input,resolution,observation,providerObservation}){
    const providerResolution=resolveUsAdultProviderName({
      name:input.winner.name,aliases:input.winner.aliases||[],observation:providerObservation});
    if(!['resolved','not_found'].includes(providerResolution.kind))
      pending('PEOPLE_CATALOGUE_PROVIDER_AMBIGUOUS','Provider name result is not unique for catalogue registration.');
    const selected=providerImageRequest(providerObservation,providerResolution);
    if(selected)return Object.freeze({...selected,providerResolution});
    if(typeof options.buildFrameImageProof!=='function')
      throw Object.assign(new Error('Catalogue registration frame proof is not wired.'),{code:'PEOPLE_CATALOGUE_FRAME_PROOF_UNWIRED'});
    const proof=options.buildFrameImageProof({input,resolution,observation,providerObservation,providerResolution});
    if(!proof||proof.kind!=='frame'||!proof.proof)
      pending('PEOPLE_CATALOGUE_FRAME_PROOF_PENDING','Frame proof for catalogue registration is not ready.');
    return Object.freeze({kind:'frame',bytes:proof.bytes,proof:proof.proof,providerResolution});
  }
  function imageFor(input,candidate,selected){
    if(selected.kind==='provider'){
      const imageBytes=options.readImageBytes({kind:'provider',providerKey:selected.providerKey,imageId:selected.imageId,
        urlDigest:selected.urlDigest,input,candidate});
      if(!Buffer.isBuffer(imageBytes)||!imageBytes.length)
        pending('PEOPLE_CATALOGUE_IMAGE_PENDING','Provider image bytes are not ready for catalogue registration.');
      return {imageBytes,imageSourceProof:Object.freeze({kind:'provider',providerKey:selected.providerKey,imageId:selected.imageId,
        urlDigest:selected.urlDigest,imageDigest:sha(imageBytes)})};
    }
    const imageBytes=selected.bytes;
    const imageSourceProof=Object.freeze({kind:'frame',proof:selected.proof});
    if(!Buffer.isBuffer(imageBytes)||!imageBytes.length||sha(imageBytes)!==selected.proof.imageDigest||
      imageBytes.length!==selected.proof.imageBytes)
      pending('PEOPLE_CATALOGUE_IMAGE_PENDING','Frame crop bytes are not ready for catalogue registration.');
    return {imageBytes,imageSourceProof};
  }
  function stageImage(input,candidate,imageBytes,imageSourceProof){
    const imageDigest=imageSourceProof.kind==='provider'?imageSourceProof.imageDigest:imageSourceProof.proof.imageDigest;
    return options.peopleImagePort.stageUpload({
      bytes:imageBytes,actorId:SYSTEM,idempotencyKey:'catalogue-'+imageSourceProof.kind+'-'+imageDigest,
      provenance:provenanceFor(input,candidate,imageSourceProof),
    });
  }
  function ensureOperation({input,inputDigest,resolution,imageSourceProof,selectedImage}){
    const identity=operationIdentity({inputDigest,nameResolutionDigest:resolution.resolutionDigest,imageSourceProof});
    const existing=options.operationStore.get(identity.operationId);
    if(existing)return existing;
    return options.operationStore.createCatalogue({
      schema:CATALOGUE_SCHEMA,operationKind:'catalogue_registration',expectedPersonRevision:1,expectedReferenceRevision:0,
      operationId:identity.operationId,personId:identity.personId,actorId:SYSTEM,canonicalName:input.winner.name,aliases:aliasesFor(input),
      selectedImage,faceModelRef:buffaloModel(),catalogueDecisionInputDigest:inputDigest,
      nameResolutionDigest:resolution.resolutionDigest,imageSourceProofDigest:identity.imageSourceProofDigest});
  }
  function waiting(operation,pendingCode){
    const work=preparationWork(operation);
    return Object.freeze({kind:'waiting',pendingCode,workId:work.workId,operationId:operation.operationId});
  }
  function failed(code,operation){
    return Object.freeze({kind:'failed',code,operationId:operation?.operationId||null,
      workId:operation?preparationWork(operation).workId:null});
  }
  function evidenceFrom({input,inputDigest,resolution,observation,providerObservation,imageSourceProof,operation}){
    if(typeof options.referenceDecision!=='function')
      pending('PEOPLE_CATALOGUE_REFERENCE_PENDING','Catalogue reference decision is not available after image prep.');
    const initialReference=options.referenceDecision(operation.operationId);
    if(canonicalDigest(imageSourceProof)!==operation.payload.imageSourceProofDigest)
      return failed('PEOPLE_CATALOGUE_EVIDENCE_STALE',operation);
    return Object.freeze({input,inputDigest,resolution,observation,providerObservation,imageSourceProof,initialReference});
  }
  function assembleEvidence({input,inputDigest,resolution,candidate}){
    if(!input||!inputDigest||!resolution||resolution.kind!=='not_found')
      pending('PEOPLE_CATALOGUE_RESOLUTION_REQUIRED','Catalogue registration evidence requires a not_found name resolution.');
    const observation=loadObservation(input,candidate);
    const provider=providerObservationFor(input,candidate);
    if(provider.waiting)return Object.freeze({kind:'waiting',pendingCode:provider.pendingCode,workId:provider.workId});
    const selected=selectProof({input,resolution,observation,providerObservation:provider.providerObservation});
    const staged=imageFor(input,candidate,selected);
    const selectedImage=stageImage(input,candidate,staged.imageBytes,staged.imageSourceProof);
    const operation=ensureOperation({input,inputDigest,resolution,imageSourceProof:staged.imageSourceProof,selectedImage});
    if(typeof options.reconcileImageOperation==='function')options.reconcileImageOperation(operation.operationId);
    const current=options.operationStore.get(operation.operationId)||operation;
    if(current.state==='failed')return failed(current.failureCode||'PEOPLE_CATALOGUE_IMAGE_PREP_FAILED',current);
    if(current.state==='completed')
      return evidenceFrom({input,inputDigest,resolution,observation,providerObservation:provider.providerObservation,
        imageSourceProof:staged.imageSourceProof,operation:current});
    const work=preparationWork(current),status=options.workResultReader.status(work.workId);
    if(['failed','cancelled'].includes(status?.state))
      return failed(status.latestAttempt?.failure_code||status.latestAttempt?.failureCode||'PEOPLE_CATALOGUE_IMAGE_PREP_FAILED',current);
    if(status?.state!=='succeeded')return waiting(current,'PEOPLE_CATALOGUE_IMAGE_PREP_PENDING');
    return evidenceFrom({input,inputDigest,resolution,observation,providerObservation:provider.providerObservation,
      imageSourceProof:staged.imageSourceProof,operation:current});
  }
  function readCatalogueRegistrationEvidence({operation,initialReference}){
    if(!operation?.payload)return Object.freeze({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_EVIDENCE_UNWIRED'});
    if(typeof options.catalogueInputReader?.compile!=='function')
      return Object.freeze({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_EVIDENCE_UNWIRED',operationId:operation.operationId});
    const runId=catalogueRunId(operation.payload.selectedImage?.provenance?.sourceObjectId);
    const mode=operation.payload.selectedImage?.provenance?.sourceObjectId?.match(RUN_TOKEN)?.[2];
    if(!runId||!mode)return failed('PEOPLE_CATALOGUE_EVIDENCE_STALE',operation);
    let compiled;
    try{compiled=options.catalogueInputReader.compile({libraRunId:runId,mode});}
    catch(error){
      return Object.freeze({kind:'waiting',pendingCode:error?.code||'PEOPLE_CATALOGUE_INPUT_PENDING',operationId:operation.operationId});
    }
    if(compiled?.kind!=='qualified'||compiled.inputDigest!==operation.payload.catalogueDecisionInputDigest)
      return failed('PEOPLE_CATALOGUE_EVIDENCE_STALE',operation);
    const input=compiled.input;
    if(typeof options.peopleStore?.resolveUsAdultName!=='function')
      return Object.freeze({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_EVIDENCE_UNWIRED',operationId:operation.operationId});
    const resolution=options.peopleStore.resolveUsAdultName({name:input.winner.name,aliases:input.winner.aliases||[],
      expectedLibraryNamesDigest:null});
    if(resolution?.resolutionDigest!==operation.payload.nameResolutionDigest)
      return failed('PEOPLE_CATALOGUE_NAME_CHANGED',operation);
    let observation;
    try{observation=loadObservation(input,null);}
    catch(error){
      if(error?.code==='PEOPLE_CATALOGUE_REGISTRATION_PENDING')
        return Object.freeze({kind:'waiting',pendingCode:error.pendingCode,operationId:operation.operationId});
      throw error;
    }
    const provider=providerObservationFor(input,null);
    if(provider.waiting)return Object.freeze({kind:'waiting',pendingCode:provider.pendingCode,operationId:operation.operationId});
    let selected;
    try{selected=selectProof({input,resolution,observation,providerObservation:provider.providerObservation});}
    catch(error){
      if(error?.code==='PEOPLE_CATALOGUE_REGISTRATION_PENDING')
        return Object.freeze({kind:'waiting',pendingCode:error.pendingCode,operationId:operation.operationId});
      throw error;
    }
    const imageDigest=operation.payload.selectedImage.digestHex;
    const imageSourceProof=selected.kind==='provider'
      ?Object.freeze({kind:'provider',providerKey:selected.providerKey,imageId:selected.imageId,urlDigest:selected.urlDigest,imageDigest})
      :Object.freeze({kind:'frame',proof:selected.proof});
    if(canonicalDigest(imageSourceProof)!==operation.payload.imageSourceProofDigest)
      return failed('PEOPLE_CATALOGUE_EVIDENCE_STALE',operation);
    if(!initialReference)return Object.freeze({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_REFERENCE_PENDING',operationId:operation.operationId});
    return closedEvidence({input,inputDigest:compiled.inputDigest,resolution,observation,
      providerObservation:provider.providerObservation,imageSourceProof},initialReference);
  }
  function hasOpenPrep(scope){
    if(!scope?.libraRunId)return false;
    return openCataloguePrepRunIds(options.operationStore).has(scope.libraRunId);
  }
  return Object.freeze({assembleEvidence,readCatalogueRegistrationEvidence,hasOpenPrep,SYSTEM});
}

module.exports=Object.freeze({
  createUsAdultCatalogueRegistrationEvidence,openCataloguePrepRunIds,providerImageRequest,catalogueRunToken,catalogueRunId,
});
