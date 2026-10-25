'use strict';

const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { schemaClosure } = require('./catalog-schema-closure');
const { FORMAT: TERMINAL_FORMAT, validateTerminalAttestation } = require('./terminal-plan-attestation');

const FORMAT = 'helix://foundation/evidence/PlanExecutionContracts/v1';
const PROVENANCE = 'helix://foundation/evidence/PlanContractProvenance/v1';
const COMMAND_FORMAT = 'helix://foundation/evidence/SynchronousCommandContracts/v1';
const MAX_BYTES = 1024 * 1024;

function requireEvidence(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'P4_PLAN_CONTRACT_EVIDENCE_INVALID' });
}

function validateContractDocument(evidence, digest) {
  if (evidence?.schemaRef === TERMINAL_FORMAT) {
    validateTerminalAttestation(evidence);
    requireEvidence(canonicalDigest(evidence) === digest && Buffer.byteLength(canonicalJson(evidence)) <= MAX_BYTES,
      'Terminal attestation digest or size differs.');
    return evidence;
  }
  if (evidence?.schemaRef === COMMAND_FORMAT) {
    requireEvidence(evidence.schemaVersion === 1 && Object.keys(evidence).sort().join(',') ===
      'ownerDomain,plannerRef,schemaRef,schemaVersion,schemas,steps,workKind' &&
      ['ownerDomain', 'workKind', 'plannerRef'].every(key => typeof evidence[key] === 'string' && evidence[key].length > 0) &&
      Array.isArray(evidence.steps) && evidence.steps.length > 0 && evidence.steps.length <= 100 &&
      Array.isArray(evidence.schemas) && evidence.schemas.every(schema => schema && typeof schema.$id === 'string') &&
      evidence.steps.every(step => step && Object.keys(step).sort().join(',') ===
        'capabilityRef,contractVersion,effectClass,fenceSchemaRef,inputSchemaRef,parametersSchemaRef,resourceDemandSchemaRef,resultSchemaRef' &&
        step.contractVersion === 1 && step.effectClass === 'domain_fact_commit' &&
        Object.entries(step).every(([key, value]) => key === 'contractVersion' || typeof value === 'string' && value.length > 0)) &&
      canonicalDigest(evidence) === digest && Buffer.byteLength(canonicalJson(evidence)) <= MAX_BYTES,
    'Unsupported or corrupt synchronous command contract.');
    return evidence;
  }
  requireEvidence(evidence && evidence.schemaRef === FORMAT && evidence.schemaVersion === 1 &&
    Object.keys(evidence).sort().join(',') === 'capabilities,schemaRef,schemaVersion,schemas' &&
    Array.isArray(evidence.capabilities) && Array.isArray(evidence.schemas) &&
    evidence.capabilities.every(item => item && Object.keys(item).sort().join(',') === 'executorVersion,manifest,policy' &&
      item.manifest && typeof item.manifest.capabilityRef === 'string' &&
      Number.isSafeInteger(item.executorVersion) && item.executorVersion > 0 && item.policy &&
      Object.keys(item.policy).sort().join(',') === 'binding,compensation,retry,timeout' && Array.isArray(item.policy.compensation)) &&
    evidence.schemas.every(schema => schema && typeof schema.$id === 'string') &&
    /^[a-f0-9]{64}$/.test(digest) && canonicalDigest(evidence) === digest &&
    Buffer.byteLength(canonicalJson(evidence)) <= MAX_BYTES, 'Unsupported or corrupt Plan contract document.');
  return evidence;
}

function structuralDigest(plan) {
  return canonicalDigest({ ownerDomain: plan.ownerDomain, workAttemptId: plan.workAttemptId,
    executionBasisDigest: plan.executionBasisDigest,
    nodes: plan.nodes.map(node => ({ nodeId: node.nodeId, eventId: node.eventId, capabilityRef: node.capabilityRef,
      contractVersion: node.contractVersion, effectClass: node.effectClass,
      inputBindingsSchemaRef: node.inputBindingsSchemaRef, inputBindings: node.inputBindings,
      parametersSchemaRef: node.parametersSchemaRef, parameters: node.parameters,
      fenceSchemaRef: node.fenceSchemaRef, fenceBasis: node.fenceBasis,
      resourceDemandSchemaRef: node.resourceDemandSchemaRef, resourceDemand: node.resourceDemand,
      whenSchemaRef: node.whenSchemaRef, when: node.when,
      dependsOn: node.dependsOn.slice().sort((a, b) => a.eventId.localeCompare(b.eventId, 'en')),
    })).sort((a, b) => a.nodeId.localeCompare(b.nodeId, 'en')) });
}

function planFromFacts(facts) {
  const events = new Map(facts.events.map(event => [event.node_id, event]));
  requireEvidence(events.size === facts.events.length && events.size === facts.nodes.length, 'Plan Node/Event cardinality changed.');
  return { ownerDomain: facts.work.owner_domain, workAttemptId: facts.plan.attempt_id,
    executionBasisDigest: facts.plan.basis_digest, nodes: facts.nodes.map(node => {
      const event = events.get(node.node_id);
      requireEvidence(event && event.plan_id === facts.plan.plan_id && node.plan_id === facts.plan.plan_id &&
        event.attempt_id === facts.workAttempt.attempt_id && event.work_id === facts.work.work_id &&
        event.owner_domain === facts.work.owner_domain && event.capability_ref === node.capability_ref &&
        event.contract_version === node.contract_version, 'Plan Node/Event ownership changed.');
      return { nodeId: node.node_id, eventId: event.event_id, capabilityRef: node.capability_ref,
        contractVersion: node.contract_version, effectClass: node.effect_class,
        inputBindingsSchemaRef: node.input_binding_schema_ref, inputBindings: JSON.parse(node.input_bindings_json),
        parametersSchemaRef: node.parameter_schema_ref, parameters: JSON.parse(node.parameters_json),
        fenceSchemaRef: node.fence_schema_ref, fenceBasis: JSON.parse(node.fence_basis_json),
        resourceDemandSchemaRef: node.resource_demand_schema_ref, resourceDemand: JSON.parse(node.resource_demand_json),
        whenSchemaRef: node.when_schema_ref, when: node.when_json === null ? null : JSON.parse(node.when_json),
        dependsOn: facts.edges.filter(edge => edge.to_node_id === node.node_id).map(edge => {
          requireEvidence(edge.plan_id === facts.plan.plan_id && events.has(edge.from_node_id), 'Plan dependency scope changed.');
          return { eventId: events.get(edge.from_node_id).event_id, satisfaction: edge.dependency_kind };
        }) };
    }) };
}

function verifyPlanContractBinding(saved, facts) {
  requireEvidence(saved && saved.binding.plan_id === facts.plan.plan_id && saved.binding.graph_digest === facts.plan.graph_digest &&
    saved.binding.catalog_digest === facts.plan.catalog_digest && facts.plan.attempt_id === facts.workAttempt.attempt_id &&
    facts.workAttempt.work_id === facts.work.work_id && facts.workAttempt.basis_digest === facts.plan.basis_digest,
  'Plan contract binding differs from its frozen graph or Owner.');
  const provenance = JSON.parse(saved.binding.provenance_json);
  requireEvidence(provenance.schemaRef === PROVENANCE && provenance.schemaVersion === 1 &&
    ['plan_publication', 'verified_contract_import'].includes(provenance.kind) &&
    provenance.ownerDomain === facts.work.owner_domain && provenance.structureDigest === structuralDigest(planFromFacts(facts)),
  'Plan structure differs from its publication evidence.');
  if (saved.evidence.schemaRef === TERMINAL_FORMAT) requireEvidence(provenance.kind === 'verified_contract_import' &&
    ['sourceCommit', 'sourceArchiveDigest', 'verifierDigest'].every(key => provenance[key] === saved.evidence[key]),
  'Terminal attestation requires its original import provenance.');
  return true;
}

function capturePlanContracts(plan, { registry, policyRegistry, contractValidator }) {
  requireEvidence(typeof contractValidator.readSchema === 'function', 'Frozen schema access is required for Plan publication.');
  const schemas = new Map();
  const schemaReader = { get(ref) {
    if (!schemas.has(ref)) schemas.set(ref, contractValidator.readSchema(ref));
    return schemas.get(ref);
  } };
  const capabilities = [...new Set(plan.nodes.map(node => node.capabilityRef))].sort().map(ref => {
    const entry = registry.resolve(ref, plan.ownerDomain);
    const { sourceLocator, ...manifest } = entry.manifest;
    requireEvidence(Number.isSafeInteger(entry.executor?.version) && entry.executor.version > 0,
      'Plan contract requires its registered Executor version.');
    const binding = policyRegistry.bindingFor(ref, manifest.effectClass);
    schemaClosure(manifest, schemaReader);
    return { manifest, executorVersion: entry.executor.version, policy: { binding,
      retry: policyRegistry.retryFor(ref, manifest.effectClass),
      timeout: policyRegistry.timeoutFor(ref, manifest.effectClass),
      compensation: binding.compensationContractRefs.map(value => policyRegistry.compensation(value)) } };
  });
  // Binding-set and condition schemas can be Plan-level contracts rather than
  // Capability input schemas. Preserve their exact transitive closure too.
  for (const node of plan.nodes) schemaClosure({ ...Object.fromEntries(Object.entries(node)
    .filter(([key, value]) => key.endsWith('SchemaRef') && typeof value === 'string')), inputPorts: {} }, schemaReader);
  for (const node of plan.nodes) for (const binding of node.inputBindings?.bindings || []) {
    const refs = [binding.resultSchemaRef, ...(binding.resultSchemaRefs || []),
      ...(binding.eventResults || []).map(source => source.resultSchemaRef)].filter(Boolean);
    for (const ref of refs) schemaClosure({ inputPorts: { source: { schemaRef: ref } } }, schemaReader);
  }
  const evidence = JSON.parse(canonicalJson({ schemaRef: FORMAT, schemaVersion: 1, capabilities,
    schemas: [...schemas].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, value]) => value) }));
  requireEvidence(Buffer.byteLength(canonicalJson(evidence)) <= MAX_BYTES, 'Plan contract closure exceeds its byte limit.');
  return Object.freeze({ evidence, digest: canonicalDigest(evidence) });
}

function createPlanContractEvidenceStore({ schemaManifest, unitOfWork }) {
  const contracts = createRepositoryDefinition({ repositoryId: 'plan_contract_documents', owner: 'execution-foundation', schemaManifest,
    statements: {
      find: { kind: 'select-one', tableId: 'fx_execution_contracts', columns: ['contract_digest', 'format_version', 'contract_schema_ref', 'contract_json'], keyColumns: ['contract_digest'] },
      insert: { kind: 'insert', tableId: 'fx_execution_contracts', columns: ['contract_digest', 'format_version', 'contract_schema_ref', 'contract_json', 'created_at_ms'] },
    } });
  const bindings = createRepositoryDefinition({ repositoryId: 'plan_contract_bindings', owner: 'execution-foundation', schemaManifest,
    statements: {
      find: { kind: 'select-one', tableId: 'fx_plan_contracts', columns: ['plan_id', 'contract_digest', 'graph_digest', 'catalog_digest', 'provenance_schema_ref', 'provenance_json'], keyColumns: ['plan_id'] },
      insert: { kind: 'insert', tableId: 'fx_plan_contracts', columns: ['plan_id', 'contract_digest', 'graph_digest', 'catalog_digest', 'provenance_schema_ref', 'provenance_json', 'created_at_ms'] },
    } });
  const repositories = Object.freeze([contracts, bindings]);
  function read(context, planId) {
    const binding = context.repository(bindings.repositoryId).invoke('find', { plan_id: planId });
    if (!binding) return null;
    const row = context.repository(contracts.repositoryId).invoke('find', { contract_digest: binding.contract_digest });
    requireEvidence(row && row.format_version === 1 && [FORMAT, COMMAND_FORMAT, TERMINAL_FORMAT].includes(row.contract_schema_ref), 'Plan contract document is missing or unsupported.');
    const evidence = JSON.parse(row.contract_json);
    requireEvidence(Buffer.byteLength(row.contract_json) <= MAX_BYTES, 'Plan contract document byte limit exceeded.');
    validateContractDocument(evidence, row.contract_digest);
    requireEvidence(row.contract_schema_ref === evidence.schemaRef, 'Plan contract format binding changed.');
    requireEvidence(binding.provenance_schema_ref === PROVENANCE, 'Plan contract provenance format is unsupported.');
    return { binding, evidence };
  }
  return Object.freeze({ repositories, readInTransaction: read,
    publish(context, plan, graphDigest, captured, importProvenance = null) {
      requireEvidence(captured.evidence.schemaRef !== TERMINAL_FORMAT || importProvenance, 'Terminal attestations require verified import.');
      if (importProvenance) requireEvidence(importProvenance.kind === 'verified_contract_import' &&
        /^[a-f0-9]{40}$/.test(importProvenance.sourceCommit) && /^[a-f0-9]{64}$/.test(importProvenance.sourceArchiveDigest) &&
        /^[a-f0-9]{64}$/.test(importProvenance.verifierDigest), 'Imported contract requires precise provenance.');
      const documents = context.repository(contracts.repositoryId);
      const existing = documents.invoke('find', { contract_digest: captured.digest });
      const json = canonicalJson(captured.evidence);
      validateContractDocument(captured.evidence, captured.digest);
      requireEvidence(canonicalDigest(captured.evidence) === captured.digest && Buffer.byteLength(json) <= MAX_BYTES,
        'Captured Plan contract changed before commit.');
      if (existing) requireEvidence(existing.format_version === 1 && existing.contract_schema_ref === captured.evidence.schemaRef &&
        existing.contract_json === json, 'Content-addressed contract collision or corruption.');
      else documents.invoke('insert', { contract_digest: captured.digest, format_version: 1,
        contract_schema_ref: captured.evidence.schemaRef, contract_json: json, created_at_ms: context.commitTimeMs });
      context.repository(bindings.repositoryId).invoke('insert', { plan_id: plan.planId, contract_digest: captured.digest,
        graph_digest: graphDigest, catalog_digest: plan.capabilityCatalogDigest, provenance_schema_ref: PROVENANCE,
        provenance_json: canonicalJson({ schemaRef: PROVENANCE, schemaVersion: 1, kind: 'plan_publication', ...importProvenance,
          ownerDomain: plan.ownerDomain, structureDigest: structuralDigest(plan) }),
        created_at_ms: context.commitTimeMs });
    },
    read(planId) { return unitOfWork.execute([{ participantId: 'plan_contract_read', owner: 'execution-foundation', repositories,
      execute: context => read(context, planId) }]).plan_contract_read; },
  });
}

module.exports = Object.freeze({ FORMAT, COMMAND_FORMAT, PROVENANCE, capturePlanContracts, createPlanContractEvidenceStore,
  structuralDigest, planFromFacts, verifyPlanContractBinding, validateContractDocument });
