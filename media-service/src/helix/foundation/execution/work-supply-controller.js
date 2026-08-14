'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

const OPEN_WORK = new Set(['admitted', 'ready', 'running', 'blocked']);
const ACTIVE_ATTEMPT = new Set(['ready', 'running', 'blocked']);
const DISPATCHABLE_EVENT = new Set(['ready', 'waiting_for_resource', 'waiting_for_external', 'waiting_for_approval']);
const RESERVED = new Set(['safety_liveness', 'handoff_acceptance']);
const DEFAULT_LIMITS = Object.freeze({
  openWorkSoft: 192, openWorkHard: 256, activeAttemptSoft: 48, activeAttemptHard: 64,
  dispatchableEventSoft: 192, dispatchableEventHard: 256, backgroundWorkSoft: 12, backgroundWorkHard: 16
});

class WorkSupplyError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'WorkSupplyError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new WorkSupplyError(code, message, details); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function repositories(schemaManifest) {
  return Object.freeze({
    works: createRepositoryDefinition({ repositoryId: 'work_supply_works', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'priority_class', 'state'], keyColumns: [] },
      find: { kind: 'select-one', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'priority_class', 'state'], keyColumns: ['work_id'] }
    } }),
    attempts: createRepositoryDefinition({ repositoryId: 'work_supply_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'state'], keyColumns: [] }
    } }),
    events: createRepositoryDefinition({ repositoryId: 'work_supply_events', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_workflow_events', columns: ['event_id', 'work_id', 'owner_domain', 'priority_class', 'state'], keyColumns: [] },
      find: { kind: 'select-one', tableId: 'fx_workflow_events', columns: ['event_id', 'work_id', 'owner_domain', 'priority_class', 'state'], keyColumns: ['event_id'] }
    } }),
    eventAttempts: createRepositoryDefinition({ repositoryId: 'work_supply_event_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_event_attempts', columns: ['event_id', 'started_at_ms'], keyColumns: [] }
    } }),
    circuits: createRepositoryDefinition({ repositoryId: 'work_supply_circuits', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_circuit_states', columns: ['state'], keyColumns: ['circuit_key'] }
    } })
  });
}

function assertLimits(limits) {
  const expected = Object.keys(DEFAULT_LIMITS);
  if (!limits || JSON.stringify(Object.keys(limits).sort()) !== JSON.stringify(expected.sort()) ||
      expected.some((key) => !Number.isSafeInteger(limits[key]) || limits[key] < 1) ||
      limits.openWorkSoft >= limits.openWorkHard || limits.activeAttemptSoft >= limits.activeAttemptHard ||
      limits.dispatchableEventSoft >= limits.dispatchableEventHard || limits.backgroundWorkSoft >= limits.backgroundWorkHard) {
    fail('P4_WORK_SUPPLY_LIMITS_INVALID', 'Work Supply limits must be exact positive soft/hard pairs.');
  }
}

function createWorkSupplyController(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function' ||
      !options.executionProjectionProvider || typeof options.executionProjectionProvider.read !== 'function' ||
      typeof options.now !== 'function') fail('P4_WORK_SUPPLY_DEPENDENCIES_REQUIRED', 'Scoped UoW and clock are required.');
  const limits = Object.freeze({ ...(options.limits || DEFAULT_LIMITS) });
  assertLimits(limits);
  const definitions = repositories(options.schemaManifest);
  return Object.freeze({
    evaluate(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(['supplyKind', 'targetId']) ||
          !['work_attempt', 'event_dispatch'].includes(request.supplyKind) || typeof request.targetId !== 'string' || !request.targetId) {
        fail('P4_WORK_SUPPLY_REQUEST_INVALID', 'Supply request must contain only exact kind and target identity.');
      }
      const nowMs = options.now();
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail('P4_WORK_SUPPLY_CLOCK_INVALID', 'Supply clock must return epoch milliseconds.');
      const results = options.unitOfWork.execute([{
        participantId: 'work_supply_evaluate', owner: 'execution-foundation', repositories: Object.values(definitions),
        execute(context) {
          const worksRepo = context.repository('work_supply_works');
          const eventsRepo = context.repository('work_supply_events');
          const target = request.supplyKind === 'work_attempt'
            ? worksRepo.invoke('find', { work_id: request.targetId })
            : eventsRepo.invoke('find', { event_id: request.targetId });
          const eventDispatchable = target && [
            'ready',
            'waiting_for_resource',
            'waiting_for_external',
          ].includes(target.state);
          if (!target || (request.supplyKind === 'work_attempt' ? !['admitted', 'ready'].includes(target.state) : !eventDispatchable)) {
            return Object.freeze({ kind: 'ineligible', reasonCode: 'TARGET_NOT_SUPPLY_ELIGIBLE' });
          }
          const work=request.supplyKind==='work_attempt'?target:worksRepo.invoke('find',{work_id:target.work_id});
          if(!work)fail('P4_WORK_SUPPLY_WORK_FACT_MISSING','Supply target has no Supporting Work fact.');
          const projection=options.executionProjectionProvider.read(Object.freeze({ownerDomain:work.owner_domain,
            processType:work.process_type,processId:work.process_id,workKind:work.work_kind}));
          if(!projection||!['expansion','completion'].includes(projection.supplyRole)){
            fail('P4_WORK_SUPPLY_PROJECTION_INVALID','Domain Execution Projection is missing a valid supply role.');
          }
          for (const key of ['foundation/work-supply', 'owner/' + target.owner_domain + '/work-supply']) {
            const circuit = context.repository('work_supply_circuits').invoke('find', { circuit_key: key });
            if (circuit && circuit.state !== 'closed') return Object.freeze({ kind: 'deferred', reasonCode: 'CIRCUIT_' + circuit.state.toUpperCase() });
          }
          const works = worksRepo.invoke('list');
          const attempts = context.repository('work_supply_attempts').invoke('list');
          const events = eventsRepo.invoke('list');
          const snapshot = {
            openWork: works.filter((item) => OPEN_WORK.has(item.state)).length,
            activeAttempt: attempts.filter((item) => ACTIVE_ATTEMPT.has(item.state)).length,
            dispatchableEvent: events.filter((item) => DISPATCHABLE_EVENT.has(item.state)).length,
            backgroundWork: works.filter((item) => OPEN_WORK.has(item.state) && item.priority_class === 'background_observation').length
          };
          // Open Work and background Work caps govern admission of new durable demand.
          // They must never prevent an already-admitted Work from starting, because
          // execution is the only operation that can drain that backlog. Work planning
          // is instead bounded by active Attempts and the dispatchable Event frontier.
          const hard = snapshot.activeAttempt >= limits.activeAttemptHard ||
            snapshot.dispatchableEvent >= limits.dispatchableEventHard;
          const soft = snapshot.activeAttempt >= limits.activeAttemptSoft ||
            snapshot.dispatchableEvent >= limits.dispatchableEventSoft;
          const priority = target.priority_class;
          let minimumBackgroundDue = false;
          if (request.supplyKind === 'event_dispatch' && priority === 'background_observation') {
            const eventPriority = new Map(events.map((event) => [event.event_id, event.priority_class]));
            const lastBackground = context.repository('work_supply_event_attempts').invoke('list')
              .filter((attempt) => eventPriority.get(attempt.event_id) === 'background_observation')
              .reduce((latest, attempt) => Math.max(latest, attempt.started_at_ms || 0), 0);
            const reservedReady = events.some((event) => event.state === 'ready' && RESERVED.has(event.priority_class));
            minimumBackgroundDue = !reservedReady && nowMs - lastBackground >= 60000;
          }
          // Backlog limits gate creation of another Work Attempt. Once an Event exists,
          // refusing to dispatch it would prevent the active backlog from ever draining;
          // Resource Governor remains the sole Capability-capacity gate for that Event.
          if (request.supplyKind === 'work_attempt' && hard) {
            return Object.freeze({ kind: 'deferred', reasonCode: 'SUPPLY_HARD_CAP', snapshotDigest: digest(JSON.stringify(canonical(snapshot))) });
          }
          if (request.supplyKind === 'work_attempt' && soft && !RESERVED.has(priority) && projection.supplyRole !== 'completion') {
            return Object.freeze({ kind: 'deferred', reasonCode: 'SUPPLY_SOFT_CAP', snapshotDigest: digest(JSON.stringify(canonical(snapshot))) });
          }
          return Object.freeze({
            kind: 'permitted', supplyKind: request.supplyKind, targetId: request.targetId,
            lane: RESERVED.has(priority) ? 'reserved' : minimumBackgroundDue ? 'minimum_background' :
              projection.supplyRole==='completion'?'completion':'normal',
            snapshotDigest: digest(JSON.stringify(canonical(snapshot)))
          });
        }
      }]);
      return results.work_supply_evaluate;
    }
  });
}

module.exports = Object.freeze({ DEFAULT_LIMITS, WorkSupplyError, createWorkSupplyController });
