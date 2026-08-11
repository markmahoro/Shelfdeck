'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createDecisionBasisStore } = require('../persistence/decision-basis-store');
const { createRoutingDecisionStore } = require('../persistence/routing-decision-store');
const { buildRoutingDecision, evaluateRoutingExpression, resolveRoutingAssessment } = require('../model/routing-contracts');

const LIMITS = Object.freeze({ globalOpenWorks: 256, ownerOpenWorks: 256, openEvents: 256 });
const FACT_RESULT = 'helix://contracts/types/RoutingFactObservation/v1';
const BASIS_RESULT = 'helix://contracts/types/DecisionBasisRevision/v1';
const EXTERNAL_FACTS = new Set(['release_year', 'region', 'genre', 'resolved_provider_identity']);

function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function succeeded(status) { return status?.state === 'succeeded' || status?.latestAttempt?.state === 'succeeded'; }
function collectKinds(expression, output = new Set()) {
  if (!expression) return output;
  if (expression.nodeKind === 'predicate' && EXTERNAL_FACTS.has(expression.factKind)) output.add(expression.factKind);
  if (Array.isArray(expression.children)) expression.children.forEach((child) => collectKinds(child, output));
  if (expression.child) collectKinds(expression.child, output);
  return output;
}

function definition(kind, subjectId, basisDigest, dependencyRefs = []) {
  const output = kind === 'routing_basis' ? BASIS_RESULT : FACT_RESULT;
  return Object.freeze({ schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1,
    workId: stable('libra-' + kind + '-work-', { subjectId, basisDigest }), ownerDomain: 'libra',
    processType: 'libra_routing', processId: subjectId, workKind: kind,
    workObjectiveTypeRef: 'helix://libra/work/' + kind + '/v1', workObjectiveVersion: 1,
    executionBasisId: stable('libra-' + kind + '-basis-', { subjectId, basisDigest }), executionBasisDigest: basisDigest,
    dependencyRefs: Object.freeze(dependencyRefs), priorityClass: 'normal_foreground', priorityRevision: 1,
    capabilityCatalogScope: 'libra', workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('libra-' + kind + '-key-', { subjectId, basisDigest }), concurrencyScope: subjectId + '/' + kind,
    outputContractRef: output });
}

function createRoutingProcessCoordinator(options) {
  if (!options?.contextReader || !options.workResultReader) throw new TypeError('Routing Coordinator requires Owner context and Foundation results.');
  const admission = createWorkAdmission({ schemaManifest: options.schemaManifest, unitOfWork: options.unitOfWork, limits: LIMITS,
    eligibilityProvider: { check: (request) => Object.freeze({ eligible: request.ownerDomain === 'libra' && request.processType === 'libra_routing',
      basisDigest: request.executionBasisDigest, reasonCode: 'LIBRA_ROUTING_BASIS_STALE' }) } });
  const basisStore = options.basisStore || createDecisionBasisStore(options);
  const decisionStore = options.decisionStore || createRoutingDecisionStore(options);

  function submit(work) {
    const result = admission.replay(work) || admission.submit(work);
    if (result?.kind === 'invalid_contract') {
      const error = new Error('Libra Routing Work violates the Foundation contract.');
      error.code = result.reasonCode || 'LIBRA_ROUTING_WORK_INVALID'; throw error;
    }
    return result;
  }
  function rows(subjectId, kind) {
    return options.workResultReader.listWorks({ ownerDomain: 'libra', processType: 'libra_routing', processId: subjectId, workKind: kind });
  }
  function latest(subjectId, kind) {
    return rows(subjectId, kind).sort((a, b) => a.work_id.localeCompare(b.work_id)).at(-1) || null;
  }
  function results(subjectId) {
    return ['routing_nfo_facts', 'routing_provider_facts'].flatMap((kind) => rows(subjectId, kind))
      .flatMap((work) => options.workResultReader.read(work.work_id))
      .filter((item) => item.outcomeKind === 'succeeded' && item.result?.schemaRef === FACT_RESULT)
      .map((item) => item.result);
  }
  function neededKinds(context, observations) {
    const input = options.contextReader.buildInputSet(context.subject.subjectId, observations);
    const present = new Set(input.decisionFacts.map((fact) => fact.factKind));
    for (const target of context.policy.targets) {
      const evaluation = evaluateRoutingExpression(target.matchExpression, input.decisionFacts);
      if (evaluation === 'false') continue;
      if (evaluation === 'true') return Object.freeze([]);
      return Object.freeze([...collectKinds(target.matchExpression)].filter((kind) => !present.has(kind)).sort());
    }
    return Object.freeze([]);
  }
  function dependency(work) {
    return Object.freeze({ ownerDomain: 'libra', objectType: 'supporting_work', objectId: work.workId, revision: 1,
      digest: work.executionBasisDigest });
  }
  function factWork(kind, context, factKinds, dependencies) {
    const sourceKind = kind === 'routing_nfo_facts' ? 'related_nfo' : 'provider';
    return definition(kind, context.subject.subjectId, canonicalDigest({ schema: 'libra.routing-fact-work-basis@1',
      subjectSnapshotDigest: context.subject.snapshotDigest, policyDigest: context.policy.policyDigest, sourceKind, factKinds }), dependencies);
  }
  function pending(work, admissionResult, stage) {
    return Object.freeze({ kind: stage + '_pending', subjectId: work.processId, workId: work.workId, replayed: admissionResult.replayed });
  }

  function reconcile(subjectId) {
    const state = options.contextReader.currentState(subjectId);
    if (!state) return Object.freeze({ kind: 'not_found', subjectId });
    const context = state.context;
    if (!context.policy) return Object.freeze({ kind: 'unresolved', subjectId, reasonCode: 'routing_policy_unavailable' });
    if (state.decision && state.decision.routingPolicyId === context.policy.routingPolicyId &&
        state.decision.routingPolicyRevision === context.policy.revision) {
      return Object.freeze({ kind: 'terminal', subjectId, decision: state.decision });
    }
    if (state.decision?.routingAuthorityKind === 'manual_selection' &&
        state.latestPolicyDecision?.routingPolicyId === context.policy.routingPolicyId &&
        state.latestPolicyDecision.routingPolicyRevision === context.policy.revision) {
      return Object.freeze({ kind: 'terminal', subjectId, decision: state.decision });
    }

    let observations = results(subjectId), needed = neededKinds(context, observations), lastDependency = [];
    if (needed.length && options.contextReader.nfoReadHandle(context)) {
      const work = factWork('routing_nfo_facts', context, needed, []), admitted = submit(work), status = options.workResultReader.status(work.workId);
      if (!succeeded(status)) return pending(work, admitted, 'nfo_facts');
      observations = results(subjectId); needed = neededKinds(context, observations); lastDependency = [dependency(work)];
    }
    if (needed.length) {
      const intent = options.contextReader.factObservationIntent(context, 'provider', needed, observations);
      const handle = intent && options.resolveRoutingIntegrationHandle?.(intent);
      if (handle) {
        const work = factWork('routing_provider_facts', context, needed, lastDependency), admitted = submit(work), status = options.workResultReader.status(work.workId);
        if (!succeeded(status)) return pending(work, admitted, 'provider_facts');
        observations = results(subjectId); needed = neededKinds(context, observations); lastDependency = [dependency(work)];
      }
    }

    const inputSet = options.contextReader.buildInputSet(subjectId, observations);
    const basisWork = definition('routing_basis', subjectId, canonicalDigest({ schema: 'libra.routing-basis-work@1',
      subjectSnapshotDigest: context.subject.snapshotDigest, policyDigest: context.policy.policyDigest,
      inputFacts: inputSet.decisionFacts.map((fact) => fact.factDigest) }), lastDependency);
    const basisAdmission = submit(basisWork), basisStatus = options.workResultReader.status(basisWork.workId);
    if (!succeeded(basisStatus)) return pending(basisWork, basisAdmission, 'decision_basis');
    const basis = options.workResultReader.read(basisWork.workId).find((item) =>
      item.outcomeKind === 'succeeded' && item.resultSchemaRef === BASIS_RESULT)?.result;
    if (!basis) throw new Error('Terminal Routing Basis Work has no DecisionBasisRevision Result.');
    const persisted = basisStore.readInputSet(basis.decisionBasisId);
    if (!persisted || persisted.inputSet.inputSetDigest !== basis.inputSetDigest) throw new Error('Routing Basis relationized inputs are unavailable.');
    const assessment = resolveRoutingAssessment({ ...persisted.inputSet, decisionBasisId: basis.decisionBasisId });
    const nextRevision = (state.decision?.decisionRevision || 0) + 1;
    const expected = buildRoutingDecision(assessment, nextRevision);
    const identity = { subjectId, decisionBasisId: basis.decisionBasisId, decisionDigest: expected.decisionDigest };
    const committed = decisionStore.commit({ decisionInputSet: persisted.inputSet, decisionBasis: basis,
      commitMarker: stable('libra-routing-decision-marker-', identity), resultId: stable('libra-routing-decision-result-', identity),
      expectedDecisionDigest: expected.decisionDigest });
    return Object.freeze({ kind: 'terminal', subjectId, decision: committed.result, replayed: committed.replayed, missingFactKinds: needed });
  }

  function reconcileField(fieldId, limit = 100) {
    let cursor = null, visited = 0;
    while (visited < limit) {
      const page = options.contextReader.listActiveSubjectPage(cursor, Math.min(100, limit - visited), fieldId);
      if (!page.items.length) break;
      page.items.forEach((item) => { visited += 1; reconcile(item.subjectId); });
      if (!page.nextCursor) break; cursor = page.nextCursor;
    }
    return Object.freeze({ fieldId, visited });
  }

  return Object.freeze({ reconcile, reconcileField });
}

module.exports = Object.freeze({ createRoutingProcessCoordinator });
