'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const IMPORT = 'people.reference_asset.import@1', EMBED = 'shared.face.embedding.compute@1';

function createPeopleImagePreparationPorts(options) {
  const now = options.now || Date.now;
  function current(context) {
    if (context.ownerScope?.domain !== 'people' || context.ownerScope.processType !== 'people_image_preparation') throw new TypeError('Reference preparation requires its exact People operation.');
    return options.operationContext(context.ownerScope.processId);
  }
  function success(capabilityRef, context, result) {
    const digest = canonicalDigest(result), id = canonicalDigest({ eventId: context.eventId, digest }).slice(0, 40);
    return { kind: 'succeeded', resultSchemaRef: 'helix://contracts/capabilities/' + capabilityRef.replace('@1', '/v1/result'), result,
      evidenceSchemaRef: 'helix://contracts/capabilities/' + capabilityRef.replace('@1', '/v1/evidence'),
      evidence: { evidenceId: 'people-image-evidence-' + id, evidenceKind: 'people_reference_preparation', producerRef: capabilityRef,
        basisDigest: current(context).operation.payloadDigest, payloadDigest: digest, observedAtMs: now() },
      effectReceipt: { schemaRef: 'helix://contracts/types/EffectReceipt/v1', schemaVersion: 1, effectReceiptId: 'people-image-effect-' + id,
        effectId: canonicalDigest(['workspace_write', context.idempotencyKey]), effectClass: 'workspace_write', idempotencyKey: context.idempotencyKey,
        commitMarker: 'people-image-marker-' + id, externalReceiptRef: null, outputDigest: digest, verificationEvidenceDigest: digest, committedAtMs: now() } };
  }
  return Object.freeze({
    [IMPORT]: Object.freeze({
      validateInputs(context) {
        const value = current(context);
        if (canonicalDigest(context.namedInputs.peopleSelectedImageHandle) !== canonicalDigest(value.operation.payload.selectedImage) ||
            canonicalDigest(context.namedInputs.peopleWorkspace) !== canonicalDigest(value.peopleWorkspace)) throw new TypeError('Selected reference image does not match the frozen People operation.');
      },
      execute(context) {
        const operation = current(context).operation;
        return success(IMPORT, context, options.preparation.importImage({ context, personId: operation.personId,
          operationId: operation.operationId, selectedImage: context.namedInputs.peopleSelectedImageHandle }));
      },
      validateResult(context, outcome) {
        if (outcome.result.ownerDomain !== 'people' || outcome.result.ownerScope?.scopeId !== current(context).operation.personId ||
            outcome.result.digestHex !== current(context).operation.payload.selectedImage.digestHex) throw new TypeError('Imported image does not conserve the selected user bytes.');
      },
    }),
    [EMBED]: Object.freeze({
      validateInputs(context) {
        const operation = current(context).operation;
        if (canonicalDigest(context.namedInputs.faceModelRef) !== canonicalDigest(operation.payload.faceModelRef) || context.namedInputs.artifactHandleList?.length !== 1 ||
            context.namedInputs.artifactHandleList[0]?.ownerScope?.scopeId !== operation.personId) throw new TypeError('Reference embedding input is outside its frozen People operation.');
      },
      async execute(context) {
        const operation = current(context).operation;
        try {
          return success(EMBED, context, await options.preparation.computeEmbedding({ context, personId: operation.personId, operationId: operation.operationId,
            referenceRevision: 1, artifactHandle: context.namedInputs.artifactHandleList[0], faceModelRef: context.namedInputs.faceModelRef }));
        } catch (error) {
          const messages = {
            FACE_REFERENCE_SINGLE_FACE_REQUIRED: '参考图必须且只能包含一张可识别的人脸。',
            FACE_IMAGE_INVALID: '参考图片无法解码，请重新选择图片。',
            FACE_MODEL_PACK_MISSING: '本地人脸模型未安装。',
            FACE_MODEL_PACK_INVALID: '本地人脸模型未通过完整性校验。',
            FACE_MODEL_LICENSE_INVALID: '本地人脸模型分发许可未通过完整性校验。',
            FACE_MODEL_RUNTIME_VERSION_INVALID: '本地人脸运行时版本与锁定版本不一致。',
          };
          if (!Object.hasOwn(messages, error.code)) throw error;
          return Object.freeze({ kind: 'failed', failureClass: 'business_unachievable', code: error.code, message: messages[error.code],
            retryDirective: 'never', evidence: { operationId: operation.operationId, detectedFaceCount: error.details?.detectedFaceCount ?? null,
              eventAttemptId: context.eventAttemptId, idempotencyKey: context.idempotencyKey, writeStarted: false } });
        }
      },
      validateResult(context, outcome) {
        if (outcome.result.computationMode !== 'single_reference_face' || outcome.result.vectorCount !== 1 ||
            outcome.result.faceModelRefDigest !== current(context).operation.payload.faceModelRef.digest) throw new TypeError('Reference embedding result is not the frozen single-face model output.');
      },
    }),
  });
}

module.exports = Object.freeze({ createPeopleImagePreparationPorts, IMPORT, EMBED });
