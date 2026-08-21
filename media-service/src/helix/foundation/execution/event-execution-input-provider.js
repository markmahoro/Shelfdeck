'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

class EventExecutionInputProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EventExecutionInputProviderError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new EventExecutionInputProviderError(code, message, details);
}

function eventAttemptOrdinal(snapshot) {
  const active = snapshot?.activeAttempt?.ordinal;
  if (Number.isSafeInteger(active) && active >= 1) return active;
  const next = snapshot?.nextOrdinal;
  if (Number.isSafeInteger(next) && next >= 1) return next;
  return 1;
}

function eventExecutionIdempotencyKey({ eventId, workAttemptId, planId, eventAttemptOrdinal: ordinal }) {
  const eventAttemptOrdinalValue = Number.isSafeInteger(ordinal) && ordinal > 1 ? ordinal : 1;
  return canonicalDigest({
    schema: 'helix.event-execution-key@1',
    eventId,
    workAttemptId,
    planId,
    ...(eventAttemptOrdinalValue > 1 ? { eventAttemptOrdinal: eventAttemptOrdinalValue } : {}),
  });
}

function definition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId: 'event_input_results', owner: 'execution-foundation', schemaManifest, statements: {
    find: { kind: 'select-one', tableId: 'fx_event_result_bindings', columns: [
      'result_id', 'event_id', 'result_schema_ref', 'result_json', 'result_digest'
    ], keyColumns: ['event_id'] }
  } });
}

function createEventExecutionInputProvider(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.contractValidator) {
    fail('P4_EVENT_INPUT_PROVIDER_DEPENDENCIES_REQUIRED', 'Event input resolution requires scoped persistence and Contract Validator.');
  }
  const repository = definition(options.schemaManifest);

  function resolveBindings(snapshot, bindingSet) {
    const namedInputs = {};
    const ownerScope = Object.freeze({
      ownerDomain: snapshot.work.owner_domain,
      processType: snapshot.work.process_type,
      processId: snapshot.work.process_id,
    });
    function readResult(eventId, resultSchemaRef) {
      const row = options.unitOfWork.execute([{
        participantId: 'event_input_result_read', owner: 'execution-foundation', repositories: [repository], execute(context) {
          return context.repository(repository.repositoryId).invoke('find', { event_id: eventId });
        }
      }]).event_input_result_read;
      if (!row || row.result_schema_ref !== resultSchemaRef) {
        fail('P4_EVENT_INPUT_RESULT_MISSING', 'Bound predecessor Event Result is absent or has the wrong Output Contract.', {
          eventId: snapshot.event.event_id, sourceEventId: eventId,
        });
      }
      let result;
      try { result = JSON.parse(row.result_json); } catch {
        fail('P4_EVENT_INPUT_RESULT_CORRUPT', 'Bound predecessor Event Result JSON is corrupt.');
      }
      if (canonicalDigest(result) !== row.result_digest) {
        fail('P4_EVENT_INPUT_RESULT_CORRUPT', 'Bound predecessor Event Result digest is corrupt.');
      }
      return Object.freeze(result);
    }
    for (const binding of bindingSet.bindings) {
      if (binding.bindingKind === 'literal') {
        namedInputs[binding.portName] = binding.value;
        continue;
      }
      if (binding.bindingKind === 'projected_event_results') {
        if (!options.bindingProjectionRegistry || typeof options.bindingProjectionRegistry.resolve !== 'function') {
          fail('P4_EVENT_INPUT_PROJECTION_REGISTRY_REQUIRED', 'Projected Event Results binding requires the typed projection registry.');
        }
        const sources = binding.eventResults.map((resultRef) => Object.freeze({
          eventId: resultRef.eventId,
          resultSchemaRef: resultRef.resultSchemaRef,
          result: readResult(resultRef.eventId, resultRef.resultSchemaRef),
        }));
        const projection = options.bindingProjectionRegistry.resolve(binding.projectionRef);
        namedInputs[binding.portName] = projection.project(Object.freeze({
          sourceResults: Object.freeze(sources), parameters: Object.freeze(binding.parameters),
          ownerScope,
          targetEventId: snapshot.event.event_id,
        }));
        continue;
      }
      if (binding.bindingKind === 'projected_work_results') {
        if (binding.sourceWorkId !== snapshot.work.work_id) {
          fail('P4_EVENT_INPUT_WORK_SCOPE_MISMATCH', 'Projected Work Results may only read the Event owning Work.', {
            eventId: snapshot.event.event_id, sourceWorkId: binding.sourceWorkId,
          });
        }
        if (!options.workResultReader || !options.bindingProjectionRegistry ||
            typeof options.workResultReader.read !== 'function' || typeof options.bindingProjectionRegistry.resolve !== 'function') {
          fail('P4_EVENT_INPUT_WORK_RESULTS_REQUIRED', 'Projected Work Results require the typed Work Result reader and projection registry.');
        }
        const allowed = new Set(binding.resultSchemaRefs);
        const sources = options.workResultReader.read(binding.sourceWorkId)
          .filter((item) => item.outcomeKind === 'succeeded' && allowed.has(item.resultSchemaRef))
          .map((item) => Object.freeze({ eventId: item.eventId, resultSchemaRef: item.resultSchemaRef, result: item.result }));
        const projection = options.bindingProjectionRegistry.resolve(binding.projectionRef);
        namedInputs[binding.portName] = projection.project(Object.freeze({
          sourceResults: Object.freeze(sources), parameters: Object.freeze(binding.parameters),
          ownerScope,
          sourceWorkId: binding.sourceWorkId, targetEventId: snapshot.event.event_id,
        }));
        continue;
      }
      if (binding.bindingKind === 'projected_owner_facts') {
        if (binding.ownerDomain !== snapshot.work.owner_domain || binding.processType !== snapshot.work.process_type ||
            binding.processId !== snapshot.work.process_id) {
          fail('P4_EVENT_INPUT_OWNER_SCOPE_MISMATCH', 'Projected Owner Facts must match the Event owning Work scope.', {
            eventId:snapshot.event.event_id, processId:binding.processId,
          });
        }
        if (!options.bindingProjectionRegistry || typeof options.bindingProjectionRegistry.resolve !== 'function') {
          fail('P4_EVENT_INPUT_PROJECTION_REGISTRY_REQUIRED', 'Projected Owner Facts require the typed projection registry.');
        }
        const projection=options.bindingProjectionRegistry.resolve(binding.projectionRef);
        namedInputs[binding.portName]=projection.project(Object.freeze({parameters:Object.freeze(binding.parameters),
          ownerScope,
          targetEventId:snapshot.event.event_id}));
        continue;
      }
      const result = readResult(binding.eventId, binding.resultSchemaRef);
      if (binding.bindingKind === 'projected_event_result') {
        if (!options.bindingProjectionRegistry || typeof options.bindingProjectionRegistry.resolve !== 'function') {
          fail('P4_EVENT_INPUT_PROJECTION_REGISTRY_REQUIRED', 'Projected Event Result binding requires the typed projection registry.');
        }
        const projection = options.bindingProjectionRegistry.resolve(binding.projectionRef);
        namedInputs[binding.portName] = projection.project(Object.freeze({
          sourceResult: Object.freeze(result), parameters: Object.freeze(binding.parameters),
          ownerScope,
          sourceEventId: binding.eventId, targetEventId: snapshot.event.event_id,
        }));
      } else namedInputs[binding.portName] = result;
    }
    return namedInputs;
  }

  return Object.freeze({
    prepare({ snapshot }) {
      let frozen;
      try { frozen = JSON.parse(snapshot.node.input_bindings_json); } catch {
        fail('P4_EVENT_INPUT_BINDING_CORRUPT', 'Frozen Event input bindings are not valid JSON.');
      }
      const namedInputs = frozen?.schemaRef === 'helix://foundation/types/EventInputBindingSet/v1'
        ? resolveBindings(snapshot, frozen) : frozen;
      options.contractValidator.validate(snapshot.node.input_binding_schema_ref, namedInputs);
      const values=Object.values(namedInputs),approvalHandle=values.find((value)=>value?.schemaRef==='helix://contracts/types/ApprovalHandle/v1'),authorizationHandle=values.find((value)=>value?.schemaRef==='helix://contracts/types/AuthorizationHandle/v1');
      return Object.freeze({
        ownerScope: Object.freeze({ domain: snapshot.work.owner_domain, processType: snapshot.work.process_type,
          processId: snapshot.work.process_id, objectRefs: Object.freeze([]) }),
        basisRefs: Object.freeze([{ basisType: 'execution_basis', basisId: snapshot.work.work_id,
          revision: 1, digest: snapshot.work.basis_digest }]),
        namedInputs: Object.freeze(namedInputs),
        idempotencyKey: eventExecutionIdempotencyKey({
          eventId: snapshot.event.event_id,
          workAttemptId: snapshot.workAttempt.attempt_id,
          planId: snapshot.plan.plan_id,
          eventAttemptOrdinal: eventAttemptOrdinal(snapshot),
        }),
        traceContext: Object.freeze({ traceId: snapshot.work.work_id, spanId: snapshot.event.event_id }),
        ...(approvalHandle?{approvalHandle}:{}),
        ...(authorizationHandle?{authorizationHandle}:{}),
      });
    },
  });
}

module.exports = Object.freeze({
  EventExecutionInputProviderError,
  createEventExecutionInputProvider,
  eventExecutionIdempotencyKey,
});
