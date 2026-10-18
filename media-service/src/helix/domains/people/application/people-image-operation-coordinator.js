'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { faceModelReference } = require('../../../contracts/us-adult-face-model');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createPeopleImageOperationStore } = require('../persistence/people-image-operation-store');

const IMPORT = 'people.reference_asset.import@1', EMBED = 'shared.face.embedding.compute@1';
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

function preparationWork(operation) {
  return Object.freeze({ schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1,
    workId: stable('people-image-work-', operation.operationId), ownerDomain: 'people', processType: 'people_image_preparation',
    processId: operation.operationId, workKind: 'people_image_preparation', workObjectiveTypeRef: 'helix://people/work/image-preparation/v1', workObjectiveVersion: 1,
    executionBasisId: operation.operationId, executionBasisDigest: operation.payloadDigest,
    dependencyRefs: [{ ownerDomain: 'people', objectType: 'people_image_operation', objectId: operation.operationId, revision: 1, digest: operation.payloadDigest }],
    priorityClass: 'normal_foreground', priorityRevision: 1, capabilityCatalogScope: 'people', workspaceMaterialScope: [],
    idempotencyKey: stable('people-image-work-key-', operation.operationId), concurrencyScope: 'people-image/' + operation.operationId,
    outputContractRef: 'helix://contracts/capabilities/shared.face.embedding.compute/v1/result' });
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
    const results = options.workResultReader.read(work.workId).filter(item => item.outcomeKind === 'succeeded');
    const imported = results.filter(item => item.capabilityRef === IMPORT), computed = results.filter(item => item.capabilityRef === EMBED);
    if (imported.length !== 1 || computed.length !== 1) fail('PEOPLE_REFERENCE_PREPARATION_RESULT_INVALID', '图片准备缺少唯一正式结果。');
    const artifactHandle = imported[0].result, embedding = computed[0].result;
    options.contractValidator.validate('helix://contracts/types/ArtifactHandle/v1', artifactHandle);
    options.contractValidator.validate('helix://contracts/types/FaceEmbeddingSetHandle/v1', embedding);
    if (artifactHandle.digestHex !== operation.payload.selectedImage.digestHex || embedding.faceModelRefDigest !== operation.payload.faceModelRef.digest ||
        embedding.sourceArtifactSetDigest !== artifactHandle.digestHex) fail('PEOPLE_REFERENCE_PREPARATION_RESULT_INVALID', '图片准备结果与冻结输入不一致。');
    const reference = { decisionId: stable('people-initial-reference-', operationId), operationKind: 'add_image', personId: operation.personId,
      expectedPersonRevision: 1, expectedReferenceRevision: 0, actorId: operation.actorId,
      referenceAssetId: stable('people-reference-asset-', operationId), referenceFaceId: stable('people-reference-face-', operationId),
      artifactHandle, artifactDigest: artifactHandle.digestHex, faceEmbeddingSetHandle: embedding,
      modelRef: operation.payload.faceModelRef.digest, initialState: 'active' };
    const value = { decisionId: stable('people-register-', operationId), newPersonId: operation.personId, libraryKind: 'us_adult',
      canonicalName: operation.payload.canonicalName, aliases: operation.payload.aliases.map(aliasFor), providerIdentities: [], actorId: operation.actorId,
      initialReference: { ...reference, decisionDigest: canonicalDigest(reference) } };
    const decision = { ...value, decisionDigest: canonicalDigest(value) };
    options.contractValidator.validate('helix://contracts/domain-types/DirectPersonRegistrationDecision/v1', decision);
    registration.registerPerson(decision);
    options.afterRegistrationCommit?.({ operationId, personId: operation.personId });
    operation = store.finish({ operationId, expectedPayloadDigest: operation.payloadDigest,
      result: { personId: operation.personId, personRevision: 1, referenceRevision: 1 } });
    return operation;
  }
  async function begin(body, actorId) {
    exact(body, ['idempotencyKey', 'libraryKind', 'canonicalName', 'aliases', 'image']);
    if (body.libraryKind !== 'us_adult') fail('PEOPLE_LIBRARY_READ_ONLY', '此演员库由系统维护。');
    if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 128 || !actorId || !name(body.canonicalName) ||
        !Array.isArray(body.aliases) || body.aliases.length > 32 || body.aliases.some(value => !name(value))) fail('PEOPLE_REGISTRATION_INPUT_INVALID', '请填写演员姓名和有效图片。');
    const requestDigest = canonicalDigest(body), existing = store.findCommand(actorId, body.idempotencyKey);
    if (existing) {
      if (existing.requestDigest !== requestDigest) fail('PEOPLE_IMAGE_OPERATION_COMMAND_CONFLICT', '此操作标识已用于其他建档内容。');
      return Object.freeze({ operationRef: existing.operationId, state: 'accepted' });
    }
    let bytes, provenance;
    if (body.image?.kind === 'upload') {
      exact(body.image, ['kind', 'bytesBase64']);
      if (typeof body.image.bytesBase64 !== 'string' || body.image.bytesBase64.length > 14 * 1024 * 1024) fail('PEOPLE_IMAGE_UPLOAD_INVALID', '上传图片过大或无效。');
      bytes = Buffer.from(body.image.bytesBase64, 'base64');
      if (bytes.toString('base64') !== body.image.bytesBase64) fail('PEOPLE_IMAGE_UPLOAD_INVALID', '上传图片编码无效。');
    } else if (body.image?.kind === 'search') {
      exact(body.image, ['kind', 'selectionToken']);
      const selected = await options.readSelectedImage(body.image.selectionToken); bytes = selected.bytes; provenance = selected.provenance;
    } else fail('PEOPLE_IMAGE_UPLOAD_INVALID', '请上传或选择一张演员图片。');
    const selectedImage = options.imagePort.stageUpload({ bytes, provenance, actorId, idempotencyKey: body.idempotencyKey });
    options.contractValidator.validate('helix://contracts/domain-types/PeopleSelectedImageHandle/v1', selectedImage);
    const operationId = stable('people-image-operation-', { actorId, key: body.idempotencyKey }), personId = stable('person-', operationId);
    const payload = { schema: 'people.image-operation-request@1', operationId, personId, actorId, canonicalName: body.canonicalName.trim(),
      aliases: [...new Set([body.canonicalName.trim(), ...body.aliases.map(value => value.trim())])], selectedImage, faceModelRef: faceModelReference('single_reference_face') };
    const operation = store.create({ operationId, personId, actorId, idempotencyKey: body.idempotencyKey, requestDigest, payload });
    reconcile(operation.operationId); options.wake?.();
    return Object.freeze({ operationRef: operationId, state: 'accepted' });
  }
  return Object.freeze({ begin, context, reconcile, listPendingPage: store.listPendingPage,
    get(operationId) {
      const operation = readOperation(operationId);
      return Object.freeze({ operationRef: operationId, state: operation.state, personId: operation.state === 'completed' ? operation.personId : null,
        failureCode: operation.failureCode });
    } });
}

module.exports = Object.freeze({ createPeopleImageOperationCoordinator, preparationWork });
