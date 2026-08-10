'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createCanonicalTransactionRegistry, createDomainCommitCoordinator, createDomainCommitRegistry } = require('../../../foundation/persistence/domain-commit-registry');
const { createFieldObservationCommitRegistration, createFieldObservationStore } = require('../persistence/field-observation-store');
const observationTransaction = require('../../../contracts/transaction-contracts/helix.transaction.field-observation-page-commit/v1/contract.json');

const OBSERVATION_PAGE_COMMIT = 'procurement.field.observation.page.commit@1';
const RESULT_SCHEMA = 'helix://contracts/types/ObservationPageCommitResult/v1';
const CAPABILITY_RESULT_SCHEMA = 'helix://contracts/capabilities/procurement.field.observation.page.commit/v1/result';
const CAPABILITY_EVIDENCE_SCHEMA = 'helix://contracts/capabilities/procurement.field.observation.page.commit/v1/evidence';

function envelope(result, producerRef) {
  return Object.freeze({ evidenceId: result.observationId, evidenceKind: 'observation_page_commit', producerRef,
    basisDigest: result.factDigest, payloadDigest: canonicalDigest(result), observedAtMs: result.committedAtMs });
}
function effectReceipt(context, committed, result, commitDigest) {
  return Object.freeze({ schemaRef: 'helix://contracts/types/EffectReceipt/v1', schemaVersion: 1,
    effectReceiptId: 'field-observation-effect-receipt-' + context.eventAttemptId,
    effectId: canonicalDigest(['domain_fact_commit', context.idempotencyKey]), effectClass: 'domain_fact_commit',
    idempotencyKey: context.idempotencyKey, commitMarker: committed.commitMarker, externalReceiptRef: null,
    outputDigest: canonicalDigest(result), verificationEvidenceDigest: commitDigest, committedAtMs: result.committedAtMs });
}

function createFieldObservationCapabilityPorts(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.enumerator || typeof options.enumerator.enumeratePage !== 'function' ||
      typeof options.pageObserverFactory !== 'function' || typeof options.now !== 'function') throw new TypeError('Field Observation Capability ports require exact integrations and persistence.');
  const observer = options.pageObserverFactory({ now: options.now, enumeratePage: (request) => options.enumerator.enumeratePage(request), producerRef: OBSERVATION_PAGE_COMMIT });
  const store = createFieldObservationStore({ schemaManifest: options.schemaManifest });
  const coordinator = createDomainCommitCoordinator({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork,
    registry: createDomainCommitRegistry({ registrations: [createFieldObservationCommitRegistration(store)] }),
    transactionRegistry: createCanonicalTransactionRegistry({ contracts: [observationTransaction] }) });
  return Object.freeze({
    [OBSERVATION_PAGE_COMMIT]: Object.freeze({
      validateInputs(context) {
        if (!context.namedInputs?.fieldAccessHandle || !context.namedInputs?.fieldObservationPageRequest) throw new TypeError('Observation page inputs are incomplete.');
      },
      async execute(context) {
        const draft = await observer.observe({ fieldAccessHandle: context.namedInputs.fieldAccessHandle, pageRequest: context.namedInputs.fieldObservationPageRequest });
        const page = draft.page;
        const handle = Object.freeze({ schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion:1,
          handleId:'field-observation-handle-' + canonicalDigest({ eventId:context.eventId, pageDigest:page.pageDigest }), ownerDomain:'procurement',
          aggregateType:'material_field_observation', aggregateId:page.fieldId, factType:'ObservationPageCommit',
          factSchemaRef:'helix://domains/procurement/facts/FieldObservationRevision/v2', resultSchemaRef:RESULT_SCHEMA,
          expectedRevision:page.expectedObservationRevision, payloadDigest:canonicalDigest(draft),
          commitIdempotencyKey:context.idempotencyKey + ':page:' + page.pageOrdinal,
          eventFenceDigest:context.fenceBasis?.eventFenceDigest || canonicalDigest({ eventId:context.eventId, pageDigest:page.pageDigest }) });
        const marker = 'field-observation-marker-' + canonicalDigest({ eventId: context.eventId, pageDigest: page.pageDigest }).slice(0, 40);
        const commitDigest = canonicalDigest({ schema:'procurement.field-observation-page-commit@2', handle, pageDigest:page.pageDigest, entrySetDigest:page.entrySetDigest, commitMarker:marker });
        // The domain commit pre-binds the exact same compact evidence envelope
        // that Event Runtime will persist when the capability returns.  Keeping
        // one deterministic envelope avoids a result/evidence conflict at the
        // crash-window boundary.
        const resultEvidence = envelope({ ...page, factDigest:commitDigest, committedAtMs:page.observedAtMs }, OBSERVATION_PAGE_COMMIT);
        const committed = coordinator.execute({ transactionId:'helix.transaction.field-observation-page-commit', supportingWorkId:context.workId,
          handle, payload:draft, commitMarker:{ commitMarker:marker, effectId:canonicalDigest(['domain_fact_commit', context.idempotencyKey]), commitDigest },
          resultBinding:{ resultId:'field-observation-result-' + canonicalDigest({ eventId:context.eventId }).slice(0, 40), eventId:context.eventId,
            evidenceSchemaRef:CAPABILITY_EVIDENCE_SCHEMA, evidence:resultEvidence, effectReceiptId:'field-observation-effect-receipt-' + context.eventAttemptId }, outboxMessages:Object.freeze([]) });
        const result = committed.typedResult;
        return Object.freeze({ kind:'succeeded', resultSchemaRef:CAPABILITY_RESULT_SCHEMA, result,
          evidenceSchemaRef:CAPABILITY_EVIDENCE_SCHEMA, evidence:resultEvidence, effectReceipt:effectReceipt(context, committed, result, commitDigest) });
      },
      validateResult(context, outcome) {
        if (outcome.result.fieldObservationWorkId !== context.workId || outcome.result.pageDigest !== outcome.result.factDigest && !outcome.result.pageDigest) throw new TypeError('Observation Page Commit Result does not bind the current Work.');
      }
    })
  });
}

module.exports = Object.freeze({ createFieldObservationCapabilityPorts });
