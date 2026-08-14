'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createInboxCoordinator } = require('../../../foundation/persistence/outbox-inbox');
const { buildRunLifecycleDecision } = require('../model/run-lifecycle-contracts');
const { createRunLifecycleStore } = require('../persistence/run-lifecycle-store');

class HandoffBOutcomeConsumerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HandoffBOutcomeConsumerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new HandoffBOutcomeConsumerError(code, message, details);
}

const REJECTED_MESSAGE_SCHEMA = 'ArcaProductRejectedMessage@1';
const REJECTION_CLOSURE_SCHEMA =
  'helix://contracts/types/LibraProductRejectionClosureResult/v1';

function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function definition(schemaManifest) {
  const libra = createRepositoryDefinition({
    repositoryId: 'libra_handoff_b_outcome_consumer',
    owner: 'libra',
    schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one',
        tableId: 'libra_runs',
        columns: [
          'libra_run_id', 'subject_id', 'state', 'state_revision',
          'state_digest',
        ],
        keyColumns: ['libra_run_id'],
        safeIntegers: true,
      },
      find_head: {
        kind: 'select-one',
        tableId: 'libra_run_admission_heads',
        columns: ['subject_id', 'head_revision', 'active_scope_set_digest'],
        keyColumns: ['subject_id'],
        safeIntegers: true,
      },
      find_package: {
        kind: 'select-one',
        tableId: 'libra_product_packages',
        columns: [
          'on_deck_package_id', 'offer_id', 'libra_run_id', 'package_digest',
          'state',
        ],
        keyColumns: ['on_deck_package_id'],
      },
      find_receipt: {
        kind: 'select-one',
        tableId: 'libra_delivery_receipts',
        columns: [
          'receipt_id', 'offer_id', 'on_deck_package_id', 'package_digest',
          'arca_acceptance_decision_id', 'arca_acceptance_decision_digest',
          'result', 'handoff_receipt_id', 'handoff_receipt_digest',
          'custody_id', 'arca_binding_set_digest',
          'control_revision_set_digest', 'rejection_digest',
          'closure_digest', 'received_at_ms',
        ],
        keyColumns: ['offer_id'],
        safeIntegers: true,
      },
      insert_receipt: {
        kind: 'insert',
        tableId: 'libra_delivery_receipts',
        columns: [
          'receipt_id', 'offer_id', 'on_deck_package_id', 'package_digest',
          'arca_acceptance_decision_id', 'arca_acceptance_decision_digest',
          'result', 'handoff_receipt_id', 'handoff_receipt_digest',
          'custody_id', 'arca_binding_set_digest',
          'control_revision_set_digest', 'rejection_digest',
          'closure_digest', 'received_at_ms',
        ],
      },
    },
  });
  const foundation = createRepositoryDefinition({
    repositoryId: 'libra_handoff_b_outcome_inbox_read',
    owner: 'execution-foundation',
    readOnly: true,
    schemaManifest,
    statements: {
      find_inbox: {
        kind: 'select-one',
        tableId: 'fx_inbox',
        columns: [
          'consumer_domain', 'message_id', 'dedup_key', 'received_at_ms',
          'consumed_at_ms', 'result_digest',
        ],
        keyColumns: ['consumer_domain', 'message_id'],
        safeIntegers: true,
      },
    },
  });
  return Object.freeze({ libra, foundation });
}

function validateAcceptedEnvelope(envelope) {
  const message = envelope?.payload;
  if (!message || message.messageKind !== 'arca.product.accepted@1' ||
      envelope.producerDomain !== 'arca' ||
      envelope.consumerDomain !== 'libra' ||
      envelope.messageId !== message.messageId ||
      envelope.dedupKey !== message.dedupKey ||
      envelope.payloadDigest !== canonicalDigest(message)) {
    fail('P14_HANDOFF_B_ACCEPTED_ENVELOPE',
      'Arca Product Accepted envelope is invalid.');
  }
  return message;
}

function validateRejectedEnvelope(envelope) {
  const message = envelope?.payload;
  const dedupKey = message ? 'arca_product_rejected:' + message.offerId : null;
  const messageId = dedupKey ? canonicalDigest({
    schema: 'foundation.outbox-message-id@1',
    producerDomain: 'arca',
    dedupKey,
  }) : null;
  if (!message || message.schemaRef !== REJECTED_MESSAGE_SCHEMA ||
      message.schemaVersion !== 1 ||
      message.messageKind !== 'arca_product_rejected' ||
      envelope.producerDomain !== 'arca' ||
      envelope.consumerDomain !== 'libra' ||
      envelope.payloadSchemaRef !== REJECTED_MESSAGE_SCHEMA ||
      envelope.messageId !== messageId || message.messageId !== messageId ||
      envelope.dedupKey !== dedupKey || message.dedupKey !== dedupKey ||
      envelope.payloadDigest !== canonicalDigest(message)) {
    fail('P14_HANDOFF_B_REJECTED_ENVELOPE',
      'Arca Product Rejected envelope is invalid.');
  }
  const receiptId = canonicalDigest({
    schema: 'libra.product-delivery-receipt-id@1',
    offerId: message.offerId,
  });
  const closure = {
    schemaRef: REJECTION_CLOSURE_SCHEMA,
    schemaVersion: 1,
    offerId: message.offerId,
    onDeckPackageId: message.onDeckPackageId,
    packageDigest: message.packageDigest,
    terminalDeliveryState: 'rejected',
    arcaAcceptanceDecisionId: message.acceptanceDecisionId,
    arcaAcceptanceDecisionDigest: message.decisionDigest,
    rejectionDigest: message.rejectionDigest,
    handoffReceiptId: message.receiptId,
    handoffReceiptDigest: message.receiptDigest,
    closureDigest: '',
  };
  closure.closureDigest = canonicalDigest(without(closure, 'closureDigest'));
  return Object.freeze({
    message,
    messageId,
    dedupKey,
    receiptId,
    closure: Object.freeze(closure),
  });
}

function createHandoffBOutcomeConsumer(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P14_HANDOFF_B_OUTCOME_DEPENDENCIES',
      'Handoff B outcome consumption requires Libra persistence.');
  }
  const repositories = definition(options.schemaManifest);
  const libra = repositories.libra;
  const foundation = repositories.foundation;
  const lifecycle = createRunLifecycleStore(options);
  const inbox = createInboxCoordinator(options);

  function readAcceptedState(message) {
    let ownerState;
    const result = options.unitOfWork.execute([{
      participantId: 'libra_handoff_b_accepted_state_read',
      owner: 'libra',
      repositories: [libra],
      execute(context) {
        const repo = context.repository(libra.repositoryId);
        const run = repo.invoke('find_run', {
          libra_run_id: message.libraRunId,
        });
        const pkg = repo.invoke('find_package', {
          on_deck_package_id: message.onDeckPackageId,
        });
        if (!run || !pkg || pkg.libra_run_id !== run.libra_run_id ||
            pkg.offer_id !== message.offerId ||
            pkg.package_digest !== message.packageDigest ||
            pkg.state !== 'published') {
          fail('P14_HANDOFF_B_ACCEPTED_PACKAGE',
            'Accepted message does not identify the immutable published Package.');
        }
        const head = repo.invoke('find_head', { subject_id: run.subject_id });
        const receipt = repo.invoke('find_receipt', {
          offer_id: message.offerId,
        });
        ownerState = Object.freeze({ run, head, receipt });
        return ownerState;
      },
    }, {
      participantId: 'libra_handoff_b_accepted_inbox_read',
      owner: 'execution-foundation',
      boundBusinessOwner: 'libra',
      repositories: [foundation],
      execute(context) {
        return context.repository(foundation.repositoryId).invoke('find_inbox', {
          consumer_domain: 'libra',
          message_id: message.messageId,
        });
      },
    }]);
    return Object.freeze({
      ...ownerState,
      inbox: result.libra_handoff_b_accepted_inbox_read,
    });
  }

  function assertAcceptedReceipt(message, state) {
    const receipt = state.receipt;
    if (!receipt || receipt.result !== 'accepted' ||
        receipt.on_deck_package_id !== message.onDeckPackageId ||
        receipt.package_digest !== message.packageDigest ||
        receipt.arca_acceptance_decision_id !== message.acceptanceDecisionId ||
        receipt.arca_acceptance_decision_digest !==
          message.acceptanceDecisionDigest ||
        receipt.handoff_receipt_id !== message.handoffReceipt?.receiptId ||
        receipt.handoff_receipt_digest !==
          message.handoffReceipt?.receiptDigest ||
        receipt.custody_id !== message.handoffReceipt?.custodyId ||
        receipt.arca_binding_set_digest !==
          message.handoffReceipt?.arcaBindingSetDigest ||
        receipt.control_revision_set_digest !==
          message.handoffReceipt?.controlRevisionSetDigest ||
        receipt.rejection_digest !== null || receipt.closure_digest !== null) {
      fail('P14_HANDOFF_B_ACCEPTED_RECEIPT',
        'Libra Delivery Receipt does not match the accepted Handoff B message.');
    }
  }

  function consumeAccepted(envelope) {
    const message = validateAcceptedEnvelope(envelope);
    let state = readAcceptedState(message);
    let transition = null;
    if (state.run.state !== 'completed') {
      if (!state.head || !['active', 'suspended'].includes(state.run.state)) {
        fail('P14_HANDOFF_B_ACCEPTED_RUN_STATE',
          'Accepted Product can complete only its active or suspended Libra Run.');
      }
      const decision = buildRunLifecycleDecision({
        libraRunId: message.libraRunId,
        expectedStateRevision: Number(state.run.state_revision),
        expectedStateDigest: state.run.state_digest,
        transitionKind: 'complete',
        transitionEvidence: message,
        expectedAdmissionHeadRevision: Number(state.head.head_revision),
        expectedActiveScopeSetDigest: state.head.active_scope_set_digest,
      });
      transition = lifecycle.transition({
        decision,
        commitMarker: canonicalDigest({
          schema: 'libra.handoff-b-accepted-run-completion-marker@1',
          messageId: message.messageId,
          decisionDigest: decision.decisionDigest,
        }),
        resultId: canonicalDigest({
          schema: 'libra.handoff-b-accepted-run-completion-result-id@1',
          messageId: message.messageId,
          libraRunId: message.libraRunId,
        }),
      });
      options.libraRunExecutionProjection?.invalidate(message.libraRunId);
      state = readAcceptedState(message);
    }
    if (state.run.state !== 'completed') {
      fail('P14_HANDOFF_B_ACCEPTED_RUN_STATE',
        'Accepted Handoff B did not terminally complete its Libra Run.');
    }
    assertAcceptedReceipt(message, state);
    if (!state.inbox || state.inbox.consumer_domain !== 'libra' ||
        state.inbox.dedup_key !== message.dedupKey ||
        state.inbox.consumed_at_ms === null ||
        !state.inbox.result_digest) {
      fail('P14_HANDOFF_B_ACCEPTED_INBOX_FENCE',
        'Completed Libra Run lacks its atomic Accepted Inbox receipt.');
    }
    return Object.freeze({
      libraRunId: message.libraRunId,
      resultDigest: state.inbox.result_digest,
      replayed: transition?.replayed ?? true,
    });
  }

  function consumeRejected(envelope) {
    const validated = validateRejectedEnvelope(envelope);
    const { message, messageId, dedupKey, receiptId, closure } = validated;
    const consumed = inbox.consume({
      message: Object.freeze({
        messageId,
        dedupKey,
        consumerDomain: 'libra',
      }),
      resultDigest: closure.closureDigest,
      domainParticipant: {
        participantId: 'libra_handoff_b_rejection_close',
        owner: 'libra',
        repositories: [libra],
        execute(context) {
          const repo = context.repository(libra.repositoryId);
          const pkg = repo.invoke('find_package', {
            on_deck_package_id: message.onDeckPackageId,
          });
          if (!pkg || pkg.offer_id !== message.offerId ||
              pkg.package_digest !== message.packageDigest ||
              pkg.state !== 'published') {
            fail('P14_HANDOFF_B_REJECTED_PACKAGE',
              'Rejected message does not identify the immutable published Package.');
          }
          const existing = repo.invoke('find_receipt', {
            offer_id: message.offerId,
          });
          if (existing) {
            if (existing.receipt_id !== receiptId ||
                existing.result !== 'rejected' ||
                existing.on_deck_package_id !== message.onDeckPackageId ||
                existing.package_digest !== message.packageDigest ||
                existing.arca_acceptance_decision_id !==
                  message.acceptanceDecisionId ||
                existing.arca_acceptance_decision_digest !==
                  message.decisionDigest ||
                existing.handoff_receipt_id !== message.receiptId ||
                existing.handoff_receipt_digest !== message.receiptDigest ||
                existing.custody_id !== null ||
                existing.arca_binding_set_digest !== null ||
                existing.control_revision_set_digest !== null ||
                existing.rejection_digest !== message.rejectionDigest ||
                existing.closure_digest !== closure.closureDigest) {
              fail('P14_HANDOFF_B_REJECTED_TERMINAL_CONFLICT',
                'Terminal Delivery Receipt conflicts with the rejection replay.');
            }
            return closure;
          }
          repo.invoke('insert_receipt', {
            receipt_id: receiptId,
            offer_id: message.offerId,
            on_deck_package_id: message.onDeckPackageId,
            package_digest: message.packageDigest,
            arca_acceptance_decision_id: message.acceptanceDecisionId,
            arca_acceptance_decision_digest: message.decisionDigest,
            result: 'rejected',
            handoff_receipt_id: message.receiptId,
            handoff_receipt_digest: message.receiptDigest,
            custody_id: null,
            arca_binding_set_digest: null,
            control_revision_set_digest: null,
            rejection_digest: message.rejectionDigest,
            closure_digest: closure.closureDigest,
            received_at_ms: context.commitTimeMs,
          });
          return closure;
        },
      },
    });
    return Object.freeze({
      closure,
      resultDigest: closure.closureDigest,
      replayed: consumed.replayed,
    });
  }

  return Object.freeze({ consumeAccepted, consumeRejected });
}

module.exports = Object.freeze({
  HandoffBOutcomeConsumerError,
  createHandoffBOutcomeConsumer,
});
