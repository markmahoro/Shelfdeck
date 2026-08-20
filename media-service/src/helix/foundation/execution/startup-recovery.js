'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { EFFECT_CLASSES } = require('./runtime-contracts');

const HASH = /^[0-9a-f]{64}$/;
const RECOVERY_EVENT_STATES = new Set(['executing', 'waiting_for_external', 'waiting_for_resource']);
const NONTERMINAL_EFFECT_STATES = new Set(['intended', 'effect_observed', 'reconcile_required']);

class StartupRecoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StartupRecoveryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new StartupRecoveryError(code, message, details);
}

function listRepository(schemaManifest, repositoryId, tableId, columns) {
  return createRepositoryDefinition({
    repositoryId,
    owner: 'execution-foundation',
    schemaManifest,
    statements: { list: { kind: 'select-all', tableId, columns, keyColumns: [] } }
  });
}

function definitions(schemaManifest) {
  return Object.freeze({
    works: listRepository(schemaManifest, 'startup_works', 'fx_supporting_works', ['work_id', 'owner_domain', 'state']),
    workAttempts: listRepository(schemaManifest, 'startup_work_attempts', 'fx_work_attempts', ['attempt_id', 'work_id', 'state']),
    plans: listRepository(schemaManifest, 'startup_plans', 'fx_workflow_plans', ['plan_id', 'attempt_id', 'catalog_digest', 'state']),
    events: listRepository(schemaManifest, 'startup_events', 'fx_workflow_events', [
      'event_id', 'plan_id', 'node_id', 'work_id', 'attempt_id', 'owner_domain', 'capability_ref', 'state'
    ]),
    nodes: listRepository(schemaManifest, 'startup_nodes', 'fx_plan_nodes', [
      'plan_id', 'node_id', 'capability_ref', 'contract_version', 'effect_class'
    ]),
    attempts: listRepository(schemaManifest, 'startup_attempts', 'fx_event_attempts', [
      'event_attempt_id', 'event_id', 'ordinal', 'state', 'outcome_kind', 'failure_class', 'failure_code', 'started_at_ms'
    ]),
    effects: listRepository(schemaManifest, 'startup_effects', 'fx_effect_journal', [
      'effect_id', 'event_attempt_id', 'effect_class', 'state', 'external_receipt_ref', 'output_digest'
    ]),
    defers: listRepository(schemaManifest, 'startup_defers', 'fx_resource_defer', [
      'event_id', 'resource_key', 'state', 'retry_at_ms'
    ]),
    circuits: listRepository(schemaManifest, 'startup_circuits', 'fx_circuit_states', [
      'circuit_key', 'state', 'reason_code', 'evidence_digest'
    ])
  });
}

function groupBy(rows, field) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row[field])) grouped.set(row[field], []);
    grouped.get(row[field]).push(row);
  }
  return grouped;
}

function createStartupRecovery(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || !options.registry ||
      !options.policyRegistry || !options.effectReconciler || typeof options.effectReconciler.reconcile !== 'function' ||
      !options.integrityVerifier || typeof options.integrityVerifier.verify !== 'function' ||
      !options.catalogVerifier || typeof options.catalogVerifier.verify !== 'function') {
    fail('P4_STARTUP_DEPENDENCIES_REQUIRED', 'Startup Recovery requires exact stores, registries, reconciler, and integrity verifier.');
  }
  const repositories = definitions(options.schemaManifest);
  let readiness = Object.freeze({ state: 'bootstrapping', normalSupplyAllowed: false, findings: Object.freeze([]) });

  function snapshot() {
    return options.unitOfWork.execute([{
      participantId: 'startup_snapshot',
      owner: 'execution-foundation',
      repositories: Object.values(repositories),
      execute(context) {
        return Object.freeze(Object.fromEntries(Object.entries(repositories).map(([key, repository]) => [
          key, context.repository(repository.repositoryId).invoke('list')
        ])));
      }
    }]).startup_snapshot;
  }

  return Object.freeze({
    readiness() { return readiness; },
    async recover() {
      const integrity = options.integrityVerifier.verify();
      if (!integrity || integrity.ok !== true) {
        readiness = Object.freeze({ state: 'faulted', normalSupplyAllowed: false, findings: Object.freeze(['INTEGRITY_FAILED']) });
        return readiness;
      }

      const facts = snapshot();
      const findings = [];
      const actions = [];
      const workIds = new Set(facts.works.map((row) => row.work_id));
      const works = new Map(facts.works.map((row) => [row.work_id, row]));
      const workAttempts = new Map(facts.workAttempts.map((row) => [row.attempt_id, row]));
      const plans = new Map(facts.plans.map((row) => [row.plan_id, row]));
      const events = new Map(facts.events.map((row) => [row.event_id, row]));
      const nodes = new Map(facts.nodes.map((row) => [row.plan_id + '\0' + row.node_id, row]));
      const nodesByPlan = groupBy(facts.nodes, 'plan_id');
      const eventsByPlan = groupBy(facts.events, 'plan_id');
      const attemptsByEvent = groupBy(facts.attempts, 'event_id');
      const effectsByAttempt = groupBy(facts.effects, 'event_attempt_id');
      const defersByEvent = groupBy(facts.defers.filter((row) => row.state === 'waiting'), 'event_id');
      const processedEffectIds = new Set();

      for (const attempt of facts.workAttempts) {
        if (!workIds.has(attempt.work_id)) findings.push('ORPHAN_WORK_ATTEMPT:' + attempt.attempt_id);
      }
      for (const plan of facts.plans) {
        const workAttempt = workAttempts.get(plan.attempt_id);
        const work = workAttempt && works.get(workAttempt.work_id);
        if (!workAttempt || !work) findings.push('ORPHAN_PLAN:' + plan.plan_id);
        else if (!options.catalogVerifier.verify(Object.freeze({
          plan: Object.freeze(plan),
          workAttempt: Object.freeze(workAttempt),
          work: Object.freeze(work),
          nodes: Object.freeze(nodesByPlan.get(plan.plan_id) || []),
          events: Object.freeze(eventsByPlan.get(plan.plan_id) || []),
        }))) findings.push('PLAN_CATALOG_DRIFT:' + plan.plan_id);
      }
      for (const effect of facts.effects) {
        if (!facts.attempts.some((attempt) => attempt.event_attempt_id === effect.event_attempt_id)) findings.push('ORPHAN_EFFECT:' + effect.effect_id);
      }
      for (const defer of facts.defers.filter((row) => row.state === 'waiting')) {
        if (!events.has(defer.event_id)) findings.push('ORPHAN_RESOURCE_DEFER:' + defer.event_id);
        else if (events.get(defer.event_id).state !== 'waiting_for_resource') findings.push('RESOURCE_DEFER_STATE_DRIFT:' + defer.event_id);
      }
      for (const circuit of facts.circuits.filter((row) => row.state !== 'closed')) {
        if (!circuit.reason_code || !HASH.test(circuit.evidence_digest || '')) findings.push('INVALID_CIRCUIT_EVIDENCE:' + circuit.circuit_key);
      }

      for (const event of facts.events.filter((row) => RECOVERY_EVENT_STATES.has(row.state))) {
        const node = nodes.get(event.plan_id + '\0' + event.node_id);
        const workAttempt = workAttempts.get(event.attempt_id);
        const plan = plans.get(event.plan_id);
        if (!node || !workAttempt || !plan || workAttempt.work_id !== event.work_id || plan.attempt_id !== event.attempt_id ||
            !EFFECT_CLASSES.includes(node.effect_class)) {
          findings.push('ORPHAN_OR_UNKNOWN_EVENT_FACT:' + event.event_id);
          continue;
        }
        try {
          options.registry.resolve(event.capability_ref, event.owner_domain);
          options.policyRegistry.bindingFor(event.capability_ref, node.effect_class);
        } catch (error) {
          findings.push('UNKNOWN_EVENT_CONTRACT:' + event.event_id);
          continue;
        }

        const attempts = attemptsByEvent.get(event.event_id) || [];
        const active = attempts.filter((attempt) => attempt.state === 'executing');
        if (event.state === 'executing' && active.length !== 1) {
          findings.push('EXECUTING_ATTEMPT_CARDINALITY:' + event.event_id);
          continue;
        }
        if (event.state !== 'executing' && active.length !== 0) {
          findings.push('WAITING_EVENT_HAS_EXECUTING_ATTEMPT:' + event.event_id);
          continue;
        }
        if (event.state === 'waiting_for_resource') {
          if ((defersByEvent.get(event.event_id) || []).length < 1) findings.push('RESOURCE_DEFER_CARDINALITY:' + event.event_id);
          continue;
        }

        const attempt = event.state === 'executing'
          ? active[0]
          : [...attempts].sort((left, right) => right.ordinal - left.ordinal)[0];
        if (!attempt) {
          findings.push('RECOVERY_ATTEMPT_MISSING:' + event.event_id);
          continue;
        }
        const effects = effectsByAttempt.get(attempt.event_attempt_id) || [];
        if (effects.length > 1) {
          findings.push('MULTIPLE_EFFECTS_PER_ATTEMPT:' + event.event_id);
          continue;
        }
        const effect = effects[0];
        if (effect) processedEffectIds.add(effect.effect_id);
        if (node.effect_class === 'pure_observation') {
          if (effect) findings.push('PURE_EFFECT_JOURNAL_FORBIDDEN:' + event.event_id);
          else if (event.state === 'executing') actions.push(Object.freeze({ eventId: event.event_id, decision: 'safe_retry' }));
          else if (event.state !== 'waiting_for_external' ||
              attempt.state !== 'completed' || attempt.outcome_kind !== 'deferred') {
            findings.push('PURE_EVENT_EXTERNAL_WAIT_INVALID:' + event.event_id);
          }
          continue;
        }
        if (!effect) {
          if (event.state === 'executing') actions.push(Object.freeze({ eventId: event.event_id, decision: 'safe_retry_before_intent' }));
          else findings.push('WAITING_EFFECT_MISSING:' + event.event_id);
          continue;
        }
        if (effect.effect_class !== node.effect_class || effect.state === 'failed') {
          findings.push('EFFECT_CLASS_OR_STATE_DRIFT:' + event.event_id);
          continue;
        }
        if (effect.state === 'committed') {
          actions.push(Object.freeze({ eventId: event.event_id, decision: 'already_committed' }));
          continue;
        }
        if (!NONTERMINAL_EFFECT_STATES.has(effect.state)) {
          findings.push('UNKNOWN_EFFECT_STATE:' + event.event_id);
          continue;
        }
        try {
          const recovery = await options.effectReconciler.reconcile(node.effect_class, { effect: Object.freeze(effect) });
          actions.push(Object.freeze({ eventId: event.event_id, effectId: effect.effect_id, ...recovery }));
        } catch (error) {
          findings.push('RECONCILER_UNAVAILABLE:' + event.event_id);
        }
      }

      for (const effect of facts.effects.filter((row) => NONTERMINAL_EFFECT_STATES.has(row.state))) {
        if (!processedEffectIds.has(effect.effect_id)) findings.push('NONTERMINAL_EFFECT_WITHOUT_RECOVERY_EVENT:' + effect.effect_id);
      }

      const activeCircuits = facts.circuits.filter((row) => row.state !== 'closed');
      const globalCircuit = activeCircuits.some((row) => row.circuit_key.startsWith('foundation/'));
      if (globalCircuit) findings.push('GLOBAL_CIRCUIT_OPEN');
      const hardFinding = findings.some((finding) => !finding.startsWith('RECONCILER_UNAVAILABLE:'));
      const state = findings.length > 0
        ? (globalCircuit || hardFinding ? 'faulted' : 'recovering')
        : (actions.length > 0 ? 'recovering' : (activeCircuits.length > 0 ? 'degraded' : 'ready'));
      readiness = Object.freeze({
        state,
        normalSupplyAllowed: state === 'ready',
        findings: Object.freeze(findings),
        actions: Object.freeze(actions),
        durableDefers: facts.defers.filter((row) => row.state === 'waiting').length,
        nonterminalWorks: facts.works.filter((row) => !['succeeded', 'failed', 'cancelled'].includes(row.state)).length,
        nonterminalEvents: facts.events.filter((row) => !['succeeded', 'skipped', 'failed', 'cancelled'].includes(row.state)).length,
        recoveredInMemoryLeases: 0,
        recoveredInMemoryPermits: 0,
        recoveredInMemoryWaiters: 0
      });
      return readiness;
    }
  });
}

module.exports = Object.freeze({ StartupRecoveryError, createStartupRecovery });
