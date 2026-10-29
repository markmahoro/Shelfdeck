'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const {assertPreparedRegistration}=require('../model/prepared-registration');
const { faceModelReference } = require('../../../contracts/us-adult-face-model');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createPeopleImageOperationStore } = require('../persistence/people-image-operation-store');

const IMPORT = 'people.reference_asset.import@1', EMBED = 'shared.face.embedding.compute@1', COMMIT='people.reference_fact.commit@1';
const stable = (prefix, value) => prefix + canonicalDigest(value).slice(0, 40);
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    fail('PEOPLE_REGISTRATION_INPUT_INVALID', '演员建档参数无效。');
  }
}
function name(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value); }
function aliasFor(value) {
  return { aliasDisplay: value, aliasNormalized: value.toLocaleLowerCase(), provenanceDigest: canonicalDigest({ source: 'us_adult_user', alias: value }) };
}
function uniqueAliases(values) {
  const seen = new Set();
  return values.map(value => value.trim()).filter(value => {
    const normalized = value.toLocaleLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized); return true;
  });
}

function preparationWork(operation) {
  return Object.freeze({ schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1,
    workId: stable('people-image-work-', operation.operationId), ownerDomain: 'people', processType: 'people_image_preparation',
    processId: operation.operationId, workKind: 'people_image_preparation', workObjectiveTypeRef: 'helix://people/work/image-preparation/v1', workObjectiveVersion: 1,
    executionBasisId: operation.operationId, executionBasisDigest: operation.payloadDigest,
    dependencyRefs: [{ ownerDomain: 'people', objectType: 'people_image_operation', objectId: operation.operationId, revision: 1, digest: operation.payloadDigest }],
    priorityClass: 'normal_foreground', priorityRevision: 1, capabilityCatalogScope: 'people', workspaceMaterialScope: [],
    idempotencyKey: stable('people-image-work-key-', operation.operationId), concurrencyScope: 'people-image/' + operation.operationId,
    outputContractRef: !['registration','catalogue_registration'].includes(operation.payload.operationKind)?'helix://contracts/capabilities/people.reference_fact.commit/v1/result':'helix://contracts/capabilities/shared.face.embedding.compute/v1/result' });
}

function createPeopleImageOperationCoordinator(options) {
  if (!options?.peopleStore || !options.imagePort || !options.workResultReader || !options.contractValidator || typeof options.readSelectedImage !== 'function' ||
      typeof options.registrationCommand?.registerPerson !== 'function') {
    throw new TypeError('People image operations require Owner persistence, formal Work Results and controlled image ports.');
  }
  const store = createPeopleImageOperationStore(options);
  const registration = options.registrationCommand;
  const admission = createWorkAdmission({ ...options, limits: { globalOpenWorks: 1000, ownerOpenWorks: 100, openEvents: 256 },
    eligibilityProvider: { check(request) {
      const operation = store.get(request.processId);
      return { eligible: request.ownerDomain === 'people' && request.processType === 'people_image_preparation' &&
        operation?.state === 'preparing' && request.executionBasisDigest === operation.payloadDigest,
      basisDigest: operation?.payloadDigest || request.executionBasisDigest, reasonCode: 'PEOPLE_IMAGE_OPERATION_STALE' };
    } } });

  function readOperation(operationId) {
    const operation = store.get(operationId);
    if (!operation) fail('PEOPLE_IMAGE_OPERATION_NOT_FOUND', '未找到这次演员建档操作。');
    return operation;
  }
  function context(operationId) {
    const operation = readOperation(operationId);
    const body = { workspaceId: 'people-image:' + operation.operationId, workspaceHandles: [], scopeDigest: operation.payloadDigest };
    const peopleWorkspace = { schemaRef: 'helix://contracts/domain-types/PeopleWorkspace/v1', schemaVersion: 1,
      objectId: body.workspaceId, revision: 1, digest: canonicalDigest(body), ...body };
    return Object.freeze({ operation, peopleWorkspace });
  }
  function reconcile(operationId) {
    let operation = readOperation(operationId);
    if (operation.state !== 'preparing') return operation;
    const work = preparationWork(operation), prior = admission.replay(work), submitted = prior || admission.submit(work);
    if (submitted.kind === 'invalid_contract') fail(submitted.reasonCode, '演员图片准备未通过正式工作准入。');
    const status = options.workResultReader.status(work.workId);
    if (['failed', 'cancelled'].includes(status?.state)) {
      return store.finish({ operationId, expectedPayloadDigest: operation.payloadDigest,
        failureCode: status.latestAttempt?.failure_code || status.latestAttempt?.failureCode || 'PEOPLE_IMAGE_PREPARATION_FAILED' });
    }
    if (status?.state !== 'succeeded') return operation;
    // The separate system command verifies the Owner input and prepared
    // Evidence; it must never fall through to user Direct Registration.
    if(operation.payload.operationKind==='catalogue_registration')return operation;
    if(operation.payload.operationKind!=='registration'){
      const commits=options.workResultReader.read(work.workId).filter(item=>item.capabilityRef===COMMIT&&item.outcomeKind==='succeeded');
      if(commits.length!==1||commits[0].result.personId!==operation.personId||commits[0].result.referenceRevision!==operation.payload.expectedReferenceRevision+1)
        fail('PEOPLE_REFERENCE_PREPARATION_RESULT_INVALID','图片更新缺少唯一正式提交结果。');
      return store.finish({operationId,expectedPayloadDigest:operation.payloadDigest,result:{personId:operation.personId,
        personRevision:operation.payload.expectedPersonRevision,referenceRevision:commits[0].result.referenceRevision}});
    }
    const reference=referenceDecision(operationId);
    const value = { decisionId: stable('people-register-', operationId), newPersonId: operation.personId, libraryKind: 'us_adult',
      canonicalName: operation.payload.canonicalName, aliases: operation.payload.aliases.map(aliasFor), providerIdentities: [], actorId: operation.actorId,
      initialReference: reference };
    const decision = { ...value, decisionDigest: canonicalDigest(value) };
    options.contractValidator.validate('helix://contracts/domain-types/DirectPersonRegistrationDecision/v1', decision);
    registration.registerPerson(decision);
    options.afterRegistrationCommit?.({ operationId, personId: operation.personId });
    operation = store.finish({ operationId, expectedPayloadDigest: operation.payloadDigest,
      result: { personId: operation.personId, personRevision: 1, referenceRevision: 1 } });
    return operation;
  }
  function referenceDecision(operationId) {
    const operation=readOperation(operationId),work=preparationWork(operation);
    if(operation.payload.operationKind==='reference_release')return operation.payload.releaseDecision;
    const results = options.workResultReader.read(work.workId).filter(item => item.outcomeKind === 'succeeded');
    const imported = results.filter(item => item.capabilityRef === IMPORT), computed = results.filter(item => item.capabilityRef === EMBED);
    if (imported.length !== 1 || computed.length !== 1) fail('PEOPLE_REFERENCE_PREPARATION_RESULT_INVALID', '图片准备缺少唯一正式结果。');
    const artifactHandle = imported[0].result, embedding = computed[0].result;
    options.contractValidator.validate('helix://contracts/types/ArtifactHandle/v1', artifactHandle);
    options.contractValidator.validate('helix://contracts/types/FaceEmbeddingSetHandle/v1', embedding);
    if (artifactHandle.digestHex !== operation.payload.selectedImage.digestHex || embedding.faceModelRefDigest !== operation.payload.faceModelRef.digest ||
        embedding.sourceArtifactSetDigest !== artifactHandle.digestHex) fail('PEOPLE_REFERENCE_PREPARATION_RESULT_INVALID', '图片准备结果与冻结输入不一致。');
    const reference = { decisionId: stable('people-initial-reference-', operationId), operationKind: operation.payload.operationKind==='reference_replace'?'replace_image':'add_image', personId: operation.personId,
      expectedPersonRevision: operation.payload.expectedPersonRevision, expectedReferenceRevision: operation.payload.expectedReferenceRevision, actorId: operation.actorId,
      referenceAssetId: stable('people-reference-asset-', operationId), referenceFaceId: stable('people-reference-face-', operationId),
      artifactHandle, artifactDigest: artifactHandle.digestHex, faceEmbeddingSetHandle: embedding,
      modelRef: operation.payload.faceModelRef.digest, initialState: 'active',
      ...(operation.payload.operationKind==='reference_replace'?{replacedImage:operation.payload.replacedImage}:{}) };
    return Object.freeze({ ...reference, decisionDigest: canonicalDigest(reference) });
  }
  async function stageImage(image,actorId,idempotencyKey) {
    let bytes, provenance;
    if (image?.kind === 'upload') {
      exact(image, ['kind', 'bytesBase64']);
      if (typeof image.bytesBase64 !== 'string' || image.bytesBase64.length > 14 * 1024 * 1024) fail('PEOPLE_IMAGE_UPLOAD_INVALID', '上传图片过大或无效。');
      bytes = Buffer.from(image.bytesBase64, 'base64');
      if (bytes.toString('base64') !== image.bytesBase64) fail('PEOPLE_IMAGE_UPLOAD_INVALID', '上传图片编码无效。');
    } else if (image?.kind === 'search') {
      exact(image, ['kind', 'selectionToken']);
      const selected = await options.readSelectedImage(image.selectionToken); bytes = selected.bytes; provenance = selected.provenance;
    } else fail('PEOPLE_IMAGE_UPLOAD_INVALID', '请上传或选择一张演员图片。');
    const selectedImage = options.imagePort.stageUpload({ bytes, provenance, actorId, idempotencyKey: idempotencyKey });
    options.contractValidator.validate('helix://contracts/domain-types/PeopleSelectedImageHandle/v1', selectedImage);
    return selectedImage;
  }
  function preparedRegistration(operation){
    return Object.freeze({schema:'people.prepared-registration@1',operationId:operation.operationId,personId:operation.personId,
      actorId:operation.actorId,idempotencyKey:operation.idempotencyKey,requestDigest:operation.requestDigest,payload:operation.payload});
  }
  async function prepareRegistration(body, actorId) {
    exact(body, ['idempotencyKey', 'libraryKind', 'canonicalName', 'aliases', 'image']);
    if (body.libraryKind !== 'us_adult') fail('PEOPLE_LIBRARY_READ_ONLY', '此演员库由系统维护。');
    if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 128 || !actorId || !name(body.canonicalName) ||
        !Array.isArray(body.aliases) || body.aliases.length > 32 || body.aliases.some(value => !name(value))) fail('PEOPLE_REGISTRATION_INPUT_INVALID', '请填写演员姓名和有效图片。');
    const requestDigest = canonicalDigest(body), existing = store.findCommand(actorId, body.idempotencyKey);
    if (existing) {
      if (existing.requestDigest !== requestDigest) fail('PEOPLE_IMAGE_OPERATION_COMMAND_CONFLICT', '此操作标识已用于其他建档内容。');
      return preparedRegistration(existing);
    }
    const selectedImage=await stageImage(body.image,actorId,body.idempotencyKey);
    const operationId = stable('people-image-operation-', { actorId, key: body.idempotencyKey }), personId = stable('person-', operationId);
    const payload = { schema: 'people.image-operation-request@1',operationKind:'registration',expectedPersonRevision:1,expectedReferenceRevision:0, operationId, personId, actorId, canonicalName: body.canonicalName.trim(),
      aliases: uniqueAliases([body.canonicalName, ...body.aliases]), selectedImage, faceModelRef: faceModelReference('single_reference_face') };
    return preparedRegistration({operationId,personId,actorId,idempotencyKey:body.idempotencyKey,requestDigest,payload});
  }
  function beginPrepared(prepared){
    assertPreparedRegistration(prepared);
    const {operationId,personId,actorId,idempotencyKey,requestDigest,payload}=prepared;
    options.contractValidator.validate('helix://contracts/domain-types/PeopleSelectedImageHandle/v1',payload.selectedImage);
    const operation=store.create({operationId,personId,actorId,idempotencyKey,requestDigest,payload});
    reconcile(operation.operationId); options.wake?.();
    return Object.freeze({ operationRef: operationId, state: 'accepted' });
  }
  async function begin(body,actorId){return beginPrepared(await prepareRegistration(body,actorId));}
  function currentPerson(personId,body){
    const person=options.peopleStore.getPerson(personId);
    if(!person)fail('PEOPLE_PERSON_NOT_FOUND','未找到演员。');
    if(person.libraryKind!=='us_adult')fail('PEOPLE_LIBRARY_READ_ONLY','此演员库由系统维护。');
    if(person.status!=='active'||person.currentRevision!==body.expectedPersonRevision||person.currentReferenceRevision!==body.expectedReferenceRevision)
      fail('PEOPLE_PROFILE_REVISION_CONFLICT','演员资料或参考图已变化，请重新读取。');
    return person;
  }
  function imageSnapshot(personId,assetId){
    const projection=options.peopleStore.getPersonReferenceProjection(personId),own=projection.contributions.find(item=>item.ownerPersonId===personId),
      asset=own?.activeAssets.find(item=>item.referenceAssetId===assetId),faces=own?.activeFaces.filter(item=>item.referenceAssetId===assetId)||[];
    if(!asset||faces.length!==1)fail('PEOPLE_REFERENCE_IMAGE_NOT_FOUND','参考图已变化或不属于此演员。');
    const face=faces[0];return {referenceAssetId:asset.referenceAssetId,referenceFaceId:face.referenceFaceId,
      artifactDigest:asset.artifactDigest,embeddingDigest:face.embeddingDigest,modelRef:face.modelRef};
  }
  async function addReference(personId,body,actorId){
    exact(body,['idempotencyKey','expectedPersonRevision','expectedReferenceRevision','image',...(Object.hasOwn(body||{},'replaceAssetId')?['replaceAssetId']:[])]);
    if(typeof body.idempotencyKey!=='string'||!body.idempotencyKey||body.idempotencyKey.length>128||
      !Number.isSafeInteger(body.expectedPersonRevision)||body.expectedPersonRevision<1||!Number.isSafeInteger(body.expectedReferenceRevision)||body.expectedReferenceRevision<1)
      fail('PEOPLE_REGISTRATION_INPUT_INVALID','图片更新参数无效。');
    const replacing=Object.hasOwn(body,'replaceAssetId');
    if(replacing&&(typeof body.replaceAssetId!=='string'||!body.replaceAssetId||body.replaceAssetId.length>256))fail('PEOPLE_REGISTRATION_INPUT_INVALID','请指定要替换的参考图。');
    const requestDigest=canonicalDigest({operationKind:replacing?'reference_replace':'reference_add',personId,body}),existing=store.findCommand(actorId,body.idempotencyKey);
    if(existing){if(existing.requestDigest!==requestDigest)fail('PEOPLE_IMAGE_OPERATION_COMMAND_CONFLICT','操作标识已用于其他内容。');return {operationRef:existing.operationId,state:'accepted'};}
    const person=currentPerson(personId,body),replacedImage=replacing?imageSnapshot(personId,body.replaceAssetId):null;
    const selectedImage=await stageImage(body.image,actorId,body.idempotencyKey);
    if(options.peopleStore.hasReferenceImage(personId,selectedImage.digestHex))fail('PEOPLE_REFERENCE_IMAGE_EXISTS','此演员已经使用过这张图片。');
    if(!replacing&&options.peopleStore.getPersonReferenceProjection(personId).contributions.flatMap(item=>item.activeAssets).length>=256)fail('PEOPLE_REFERENCE_IMAGE_LIMIT','参考图片已达到数量上限。');
    const operationId=stable('people-image-operation-',{actorId,key:body.idempotencyKey}),payload={schema:'people.image-operation-request@1',operationKind:replacing?'reference_replace':'reference_add',
      expectedPersonRevision:body.expectedPersonRevision,expectedReferenceRevision:body.expectedReferenceRevision,operationId,personId,actorId,
      canonicalName:person.revision.canonicalName,aliases:person.revision.aliases.map(item=>item.aliasDisplay),selectedImage,faceModelRef:faceModelReference('single_reference_face'),
      ...(replacing?{replacedImage}:{})};
    store.create({operationId,personId,actorId,idempotencyKey:body.idempotencyKey,requestDigest,payload});reconcile(operationId);options.wake?.();return {operationRef:operationId,state:'accepted'};
  }
  function releaseReference(personId,assetId,body,actorId){
    exact(body,['idempotencyKey','expectedPersonRevision','expectedReferenceRevision']);
    if(typeof body.idempotencyKey!=='string'||!body.idempotencyKey||body.idempotencyKey.length>128||
        !Number.isSafeInteger(body.expectedPersonRevision)||body.expectedPersonRevision<1||!Number.isSafeInteger(body.expectedReferenceRevision)||body.expectedReferenceRevision<1)
      fail('PEOPLE_REGISTRATION_INPUT_INVALID','参考图释放参数无效。');
    const requestDigest=canonicalDigest({operationKind:'reference_release',personId,assetId,body}),existing=store.findCommand(actorId,body.idempotencyKey);
    if(existing){if(existing.requestDigest!==requestDigest)fail('PEOPLE_IMAGE_OPERATION_COMMAND_CONFLICT','操作标识已用于其他内容。');return {operationRef:existing.operationId,state:'accepted'};}
    currentPerson(personId,body);const image=imageSnapshot(personId,assetId),projection=options.peopleStore.getPersonReferenceProjection(personId);
    if(projection.contributions.flatMap(item=>item.activeAssets).length<=1)fail('PEOPLE_LAST_REFERENCE_REQUIRED','至少保留一张有效参考图，可以替换这张图片。');
    const operationId=stable('people-image-operation-',{actorId,key:body.idempotencyKey}),decision={decisionId:stable('people-release-reference-',operationId),operationKind:'release_image',
      personId,expectedPersonRevision:body.expectedPersonRevision,expectedReferenceRevision:body.expectedReferenceRevision,actorId,...image,
      expectedAssetState:'active',expectedFaceState:'active',terminalState:'released'},releaseDecision={...decision,decisionDigest:canonicalDigest(decision)},
      payload={schema:'people.image-operation-request@1',operationKind:'reference_release',operationId,personId,actorId,
        expectedPersonRevision:body.expectedPersonRevision,expectedReferenceRevision:body.expectedReferenceRevision,releaseDecision};
    options.contractValidator.validate('helix://contracts/domain-types/PeopleReferenceMaintenanceDecision/v1',releaseDecision);
    store.create({operationId,personId,actorId,idempotencyKey:body.idempotencyKey,requestDigest,payload});reconcile(operationId);options.wake?.();return {operationRef:operationId,state:'accepted'};
  }
  return Object.freeze({ begin, prepareRegistration,beginPrepared, addReference,releaseReference, referenceDecision, context, reconcile, listPendingPage: store.listPendingPage,
    get(operationId) {
      const operation = readOperation(operationId);
      return Object.freeze({ operationRef: operationId, state: operation.state, personId: operation.state === 'completed' ? operation.personId : null,
        failureCode: operation.failureCode });
    } });
}

module.exports = Object.freeze({ createPeopleImageOperationCoordinator, preparationWork });
