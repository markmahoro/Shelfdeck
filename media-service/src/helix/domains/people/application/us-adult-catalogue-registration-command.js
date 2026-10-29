'use strict';

const {createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buildCatalogueRegistration,SYSTEM}=require('../model/us-adult-catalogue-registration');
const {preparationWork}=require('./people-image-operation-coordinator');
const IMPORT='people.reference_asset.import@1',EMBED='shared.face.embedding.compute@1';
const COMMAND='people.catalogue-register-person@1';
const resultRef=capability=>'helix://contracts/capabilities/'+capability.replace('@1','/v1/result');
function fail(code,message){throw Object.assign(new Error(message),{code});}
function exactArtifact(record,handle){
  if(!record||record.state!=='active')fail('PEOPLE_CATALOGUE_REFERENCE_STALE','The prepared reference Artifact is unavailable.');
  const projection={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:record.artifactHandleId,
    artifactKind:record.artifactKind,ownerDomain:record.ownerDomain,ownerScope:{scopeType:record.ownerScopeType,scopeId:record.ownerScopeId},
    storageRef:record.storageRef,digestAlgorithm:record.digestAlgorithm,digestHex:record.digestHex,sizeBytes:record.sizeBytes,
    mediaType:record.mediaType,provenanceRef:record.provenanceRef,referenceRevision:record.referenceRevision};
  if(canonicalJson(projection)!==canonicalJson(handle))fail('PEOPLE_CATALOGUE_REFERENCE_STALE','The prepared Artifact differs from its exact Registry record.');
}
function createPeopleCatalogueRegistrationCommand(options){
  if(!options?.peopleStore||typeof options.peopleStore.createCatalogueRegistrationParticipant!=='function'||
    !options.commandCoordinator||typeof options.commandCoordinator.execute!=='function'||
    !options.unitOfWork||typeof options.unitOfWork.captureReadFence!=='function'||
    !options.catalogueInputReader||typeof options.catalogueInputReader.compile!=='function'||
    !options.operationStore||typeof options.operationStore.get!=='function'||
    !options.workResultReader||!['status','readDefinition','read'].every(key=>typeof options.workResultReader[key]==='function')||
    !options.artifactRepository||typeof options.artifactRepository.get!=='function'||
    !options.peopleImagePort||typeof options.peopleImagePort.readArtifact!=='function'||
    !options.contractValidator||typeof options.contractValidator.validate!=='function')
    throw new TypeError('Catalogue registration requires the People, Libra and Foundation public evidence boundaries.');
  function verifyCurrent(evidence,decision){
    const compiled=options.catalogueInputReader.compile({libraRunId:evidence.input.libraRunId,mode:evidence.input.observationHandle.mode});
    if(compiled?.kind!=='qualified'||compiled.inputDigest!==evidence.inputDigest||canonicalJson(compiled.input)!==canonicalJson(evidence.input))
      fail('PEOPLE_CATALOGUE_OWNER_STALE','The current Libra observation or manual actor choice changed.');
    const operation=options.operationStore.get(decision.operationId);
    if(!operation||operation.state!=='preparing'||operation.personId!==decision.newPersonId||operation.actorId!==SYSTEM||
      operation.payloadDigest!==canonicalDigest(operation.payload)||operation.payload.catalogueDecisionInputDigest!==evidence.inputDigest)
      fail('PEOPLE_CATALOGUE_OPERATION_STALE','The system image preparation operation is not current.');
    const work=preparationWork(operation),status=options.workResultReader.status(work.workId),definition=options.workResultReader.readDefinition(work.workId);
    if(!status||status.state!=='succeeded'||status.latestAttempt?.state!=='succeeded'||status.owner_domain!=='people'||
      status.process_type!=='people_image_preparation'||status.process_id!==operation.operationId||status.basis_digest!==operation.payloadDigest||
      !definition||canonicalJson(definition.definition)!==canonicalJson(work))
      fail('PEOPLE_CATALOGUE_PREPARATION_INCOMPLETE','The exact system image preparation Work has not completed.');
    const attempt=status.latestAttempt.attempt_id,records=options.workResultReader.read(work.workId).filter(item=>item.attemptId===attempt&&
      item.state==='succeeded'&&item.outcomeKind==='succeeded'&&[IMPORT,EMBED].includes(item.capabilityRef));
    if(records.length!==2||new Set(records.map(item=>item.capabilityRef)).size!==2||new Set(records.map(item=>item.planId)).size!==1||
      records.some(item=>item.workId!==work.workId||!item.eventAttemptId||!/^[a-f0-9]{64}$/.test(item.inputSnapshotDigest||'')||
        item.resultSchemaRef!==resultRef(item.capabilityRef)||canonicalDigest(item.result)!==item.resultDigest))
      fail('PEOPLE_CATALOGUE_PREPARATION_INCOMPLETE','The exact image and embedding Events lack successful durable Results.');
    const image=records.find(item=>item.capabilityRef===IMPORT).result,embedding=records.find(item=>item.capabilityRef===EMBED).result,
      reference=decision.initialReference;
    if(canonicalJson(image)!==canonicalJson(reference.artifactHandle)||canonicalJson(embedding)!==canonicalJson(reference.faceEmbeddingSetHandle))
      fail('PEOPLE_CATALOGUE_REFERENCE_STALE','The selected reference is not the actual preparation Result.');
    options.contractValidator.validate('helix://contracts/types/ArtifactHandle/v1',image);
    options.contractValidator.validate('helix://contracts/types/FaceEmbeddingSetHandle/v1',embedding);
    for(const handle of [image,embedding.artifactHandle]){
      exactArtifact(options.artifactRepository.get(handle.artifactHandleId),handle);
      const bytes=options.peopleImagePort.readArtifact(handle);
      if(!Buffer.isBuffer(bytes)||bytes.length!==handle.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==handle.digestHex)
        fail('PEOPLE_CATALOGUE_REFERENCE_STALE','The prepared Artifact bytes do not match their Registry.');
      if(handle.artifactKind==='reference-embedding'){
        let payload;try{payload=JSON.parse(bytes.toString('utf8'));}catch{fail('PEOPLE_CATALOGUE_REFERENCE_STALE','The prepared feature is unreadable.');}
        if(canonicalJson(payload)!==bytes.toString('utf8')||payload.schema!=='shared.face-embedding-set@1'||payload.dimension!==512||
          !Array.isArray(payload.vectors)||payload.vectors.length!==1||!Array.isArray(payload.vectors[0])||payload.vectors[0].length!==512||
          payload.vectors[0].some(value=>!Number.isFinite(value))||Math.abs(Math.hypot(...payload.vectors[0])-1)>1e-5)
          fail('PEOPLE_CATALOGUE_REFERENCE_STALE','The prepared reference is not one normalized buffalo feature.');
      }
    }
  }
  return Object.freeze({register(input){
    const evidence=JSON.parse(canonicalJson(input)),decision=buildCatalogueRegistration(evidence);
    options.contractValidator.validate(decision.schemaRef,decision);
    const readFence=options.unitOfWork.captureReadFence();let stale=null;
    // Preflight failures are deferred until after command receipt replay so a
    // successful historical registration remains idempotent after its Run ends.
    try{verifyCurrent(evidence,decision);}catch(error){stale=error;}
    const participant=options.peopleStore.createCatalogueRegistrationParticipant(evidence,readFence),guarded={...participant,
      execute(context){if(stale)throw stale;return participant.execute(context);}},scopeId=decision.newPersonId,id=decision.decisionId,
      receiptId='people-catalogue-registration-'+id;
    options.beforeCatalogueCommit?.({decision,readFence});
    return options.commandCoordinator.execute({readFence,command:{commandReceiptId:receiptId,ownerDomain:'people',commandContract:COMMAND,
      callerScope:SYSTEM,idempotencyKey:id,requestDigest:decision.decisionDigest,targetType:'person',targetId:scopeId},domainParticipant:guarded,
      commitMarker:{commitMarker:receiptId,effectId:null,scopeType:'person',scopeId,
        commitDigest:canonicalDigest({commandContract:COMMAND,decisionDigest:decision.decisionDigest,scopeId})},
      auditRecords:[{auditId:'people-catalogue-audit-'+id,actorType:'system',actorId:SYSTEM,action:'people.person.catalogue_register',
        scopeType:'person',scopeId,evidenceDigest:decision.decisionDigest}],
      outboxMessages:[{messageId:'people-catalogue-message-'+id,producerDomain:'people',messageKind:'people.person.registered',aggregateType:'person',
        aggregateId:scopeId,aggregateRevision:1,dedupKey:'person-catalogue-registered/'+id,intendedConsumers:['people'],
        payloadSchemaRef:'helix://contracts/signals/people-person-registered/v1',payload:{personId:scopeId,personRevision:1}}],
      resultEnvelope(person){return {resultSchemaRef:'helix://contracts/types/PersonRevision/v1',resultRef:{personId:person.personId,
        personRevision:person.currentRevision,referenceProjectionRevision:person.currentReferenceProjectionRevision,personFactDigest:person.revision.factDigest}};}});
  }});
}
module.exports=Object.freeze({COMMAND,createPeopleCatalogueRegistrationCommand});
