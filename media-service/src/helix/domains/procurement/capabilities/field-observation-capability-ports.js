'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createCanonicalTransactionRegistry, createDomainCommitCoordinator,
  createDomainCommitRegistry } = require('../../../foundation/persistence/domain-commit-registry');
const { createFieldObservationCommitRegistration, createFieldObservationStore } = require('../persistence/field-observation-store');
const observationTransaction = require('../../../contracts/transaction-contracts/helix.transaction.field-observation-page-commit/v1/contract.json');

const OBSERVE_RESULT = 'helix://contracts/capabilities/procurement.field.page.observe/v1/result';
const OBSERVE_EVIDENCE = 'helix://contracts/capabilities/procurement.field.page.observe/v1/evidence';
const COMMIT_RESULT = 'helix://contracts/capabilities/procurement.field.observation.commit/v1/result';
const COMMIT_EVIDENCE = 'helix://contracts/capabilities/procurement.field.observation.commit/v1/evidence';

function envelope(page, producerRef) {
  return Object.freeze({ evidenceId: page.evidenceId, evidenceKind: page.evidenceKind, producerRef,
    basisDigest: page.basisDigest, payloadDigest: canonicalDigest(page), observedAtMs: page.observedAtMs });
}

function effectReceipt(context, committed, page, commitDigest) {
  const result = committed.typedResult;
  const effectId = canonicalDigest(['domain_fact_commit', context.idempotencyKey]);
  return Object.freeze({ schemaRef: 'helix://contracts/types/EffectReceipt/v1', schemaVersion: 1,
    effectReceiptId: 'field-observation-effect-receipt-' + context.eventAttemptId,
    effectId, effectClass: 'domain_fact_commit', idempotencyKey: context.idempotencyKey,
    commitMarker: committed.commitMarker, externalReceiptRef: null, outputDigest: canonicalDigest(result),
    verificationEvidenceDigest: commitDigest, committedAtMs: result.committedAtMs });
}

function createFieldObservationCapabilityPorts(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.enumerator ||
      typeof options.enumerator.enumeratePage !== 'function' || typeof options.pageObserverFactory !== 'function' ||
      typeof options.now !== 'function') throw new TypeError('Field Observation Capability ports require exact integrations and persistence.');
  const observer = options.pageObserverFactory({ now: options.now,
    enumeratePage: (request) => options.enumerator.enumeratePage(request), producerRef: 'procurement.field.page.observe@1' });
  const store = createFieldObservationStore({ schemaManifest: options.schemaManifest });
  const coordinator = createDomainCommitCoordinator({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    registry: createDomainCommitRegistry({ registrations: [createFieldObservationCommitRegistration(store)] }),
    transactionRegistry: createCanonicalTransactionRegistry({ contracts: [observationTransaction] }) });
  return Object.freeze({
    'procurement.field.page.observe@1': Object.freeze({
      validateInputs(context) {
        if (!context.namedInputs?.fieldAccessHandle || !context.namedInputs?.fieldObservationPageRequest) {
          throw new TypeError('Field Observation page inputs are incomplete.');
        }
      },
      async execute(context) {
        const page = await observer.observe({ fieldAccessHandle: context.namedInputs.fieldAccessHandle,
          pageRequest: context.namedInputs.fieldObservationPageRequest });
        return Object.freeze({ kind: 'succeeded', resultSchemaRef: OBSERVE_RESULT, result: page,
          evidenceSchemaRef: OBSERVE_EVIDENCE, evidence: envelope(page, 'procurement.field.page.observe@1') });
      },
      validateResult(_context, outcome) { if (outcome.result.pageDigest !== outcome.result.payloadDigest) {
        throw new TypeError('Field Observation page Result digest is inconsistent.');
      } },
    }),
    'procurement.field.observation.commit@1': Object.freeze({
      validateInputs(context) {
        const page = context.namedInputs?.fieldObservationPage;
        const handle = context.namedInputs?.domainFactCommitHandle;
        if (!page || !handle || handle.payloadDigest !== canonicalDigest(page)) throw new TypeError('Observation commit inputs are inconsistent.');
      },
      execute(context) {
        const page = context.namedInputs.fieldObservationPage;
        const handle = context.namedInputs.domainFactCommitHandle;
        const marker = 'field-observation-marker-' + canonicalDigest({ eventId: context.eventId, pageDigest: page.pageDigest }).slice(0, 40);
        const receiptId = 'field-observation-effect-receipt-' + context.eventAttemptId;
        const commitDigest = canonicalDigest({ schema: 'procurement.field-observation-page-commit@1',
          handle, page, commitMarker: marker });
        const effectId = canonicalDigest(['domain_fact_commit', context.idempotencyKey]);
        const committed = coordinator.execute({
          transactionId: 'helix.transaction.field-observation-page-commit', supportingWorkId: context.workId,
          handle, payload: page,
          commitMarker: { commitMarker: marker, effectId, commitDigest },
          resultBinding: { resultId: 'field-observation-result-' + canonicalDigest({ eventId: context.eventId }).slice(0, 40),
            eventId: context.eventId, evidenceSchemaRef: page.schemaRef, evidence: page, effectReceiptId: receiptId },
          outboxMessages: Object.freeze([]),
        });
        const receipt = effectReceipt(context, committed, page, commitDigest);
        return Object.freeze({ kind: 'succeeded', resultSchemaRef: COMMIT_RESULT, result: committed.typedResult,
          evidenceSchemaRef: COMMIT_EVIDENCE, evidence: envelope(page, 'procurement.field.observation.commit@1'), effectReceipt: receipt });
      },
      validateResult(context, outcome) {
        if (outcome.result.fieldObservationWorkId !== context.workId ||
            outcome.result.pageDigest !== context.namedInputs.fieldObservationPage.pageDigest) {
          throw new TypeError('Observation commit Result does not bind the current Work and Page.');
        }
      },
    }),
  });
}

module.exports = Object.freeze({ createFieldObservationCapabilityPorts });
