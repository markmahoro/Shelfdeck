'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createDecisionBasisStore, RESULT_SCHEMA: BASIS_RESULT } = require('../persistence/decision-basis-store');
const { createRoutingDecisionStore } = require('../persistence/routing-decision-store');
const { buildRoutingDecision, resolveRoutingAssessment } = require('../model/routing-contracts');

function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }

function createRoutingManualSelectionService(options) {
  const basisStore = createDecisionBasisStore(options), decisionStore = createRoutingDecisionStore(options);
  return Object.freeze({
    choose(subjectId, body) {
      if (!body || typeof body.targetShelfId !== 'string' || !body.targetShelfId || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey ||
          !body.expectedDecisionHead || !Number.isSafeInteger(body.expectedDecisionHead.revision) || typeof body.expectedDecisionHead.digest !== 'string') {
        const error = new Error('Manual Shelf selection does not match its closed command.'); error.code = 'ADMIN_ROUTING_MANUAL_INPUT_INVALID'; throw error;
      }
      const requestBody = { subjectId, targetShelfId: body.targetShelfId, expectedDecisionHead: body.expectedDecisionHead,
        idempotencyKey: body.idempotencyKey, actorId: 'admin' };
      const requestDigest = canonicalDigest({ schema: 'libra.select-shelf-command@1', ...requestBody });
      const state = options.contextReader.currentState(subjectId);
      if (!state) { const error = new Error('Formation Subject was not found.'); error.code = 'FORMATION_SUBJECT_NOT_FOUND'; throw error; }
      if (state.decision?.routingAuthorityKind === 'manual_selection' && state.decision.manualSelectionDigest === requestDigest) return Object.freeze({ decision: state.decision, replayed: true });
      if (!state.decision || state.decision.result !== 'unresolved') { const error = new Error('Manual Shelf selection is allowed only for an unresolved Subject.'); error.code = 'ADMIN_ROUTING_MANUAL_STATE_CONFLICT'; throw error; }
      const head = state.context.expectedHead;
      if (head.headRevision !== body.expectedDecisionHead.revision || head.headDigest !== body.expectedDecisionHead.digest) {
        const error = new Error('Routing Decision Head is stale.'); error.code = 'ADMIN_ROUTING_MANUAL_HEAD_CONFLICT'; throw error;
      }
      const intent = Object.freeze({ ...requestBody, requestDigest });
      const inputSet = options.contextReader.buildInputSet(subjectId, [], intent);
      const identity = { subjectId, requestDigest, inputSetDigest: inputSet.inputSetDigest };
      const handle = Object.freeze({ schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion: 1,
        handleId: stable('libra-manual-basis-handle-', identity), ownerDomain: 'libra', aggregateType: 'subject_decision_basis', aggregateId: subjectId,
        factType: 'decision_basis', factSchemaRef: 'libra.decision-basis@1', expectedRevision: inputSet.expectedDecisionHead.headRevision,
        payloadDigest: canonicalDigest(inputSet), resultSchemaRef: BASIS_RESULT, commitIdempotencyKey: body.idempotencyKey,
        eventFenceDigest: canonicalDigest({ schema: 'libra.manual-selection-fence@1', ...identity }) });
      const basis = basisStore.commit({ decisionInputSet: inputSet, domainFactCommitHandle: handle,
        commitMarker: stable('libra-manual-basis-marker-', identity), resultId: stable('libra-manual-basis-result-', identity) }).result;
      const assessment = resolveRoutingAssessment({ ...inputSet, decisionBasisId: basis.decisionBasisId });
      const expected = buildRoutingDecision(assessment, state.decision.decisionRevision + 1);
      const committed = decisionStore.commit({ decisionInputSet: inputSet, decisionBasis: basis,
        commitMarker: stable('libra-manual-decision-marker-', identity), resultId: stable('libra-manual-decision-result-', identity),
        expectedDecisionDigest: expected.decisionDigest });
      return Object.freeze({ decision: committed.result, replayed: committed.replayed });
    },
  });
}

module.exports = Object.freeze({ createRoutingManualSelectionService });
