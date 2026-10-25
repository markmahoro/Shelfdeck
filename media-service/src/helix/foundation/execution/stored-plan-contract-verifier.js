'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createCapabilityContractValidator } = require('../capability/contract-validator');
const { createExecutionPolicyRegistry } = require('./execution-policy');
const { executionCatalogDigest } = require('./workflow-plan');
const { schemaClosure } = require('./catalog-schema-closure');
const { createBoundedCatalogTransition } = require('./bounded-catalog-transition');
const { capturePlanContracts, planFromFacts, verifyPlanContractBinding, validateContractDocument, COMMAND_FORMAT } = require('./plan-contract-evidence');
const { proveSynchronousPlan } = require('./synchronous-plan-contract');
const { FORMAT: TERMINAL_FORMAT, proveTerminalAttestation } = require('./terminal-plan-attestation');
const { verifyTerminalEffectReceipt } = require('./terminal-effect-proof');
const { PLAN_RESOLUTIONS } = require('./runtime-contracts');

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

// Read-only proof from each Plan's own publication evidence. There is no list of
// accepted release digests and no registration of a historical Executor.
function createStoredPlanContractVerifier(options) {
  const cache = new Map();
  function decode(saved) {
    const key = saved.binding.contract_digest;
    if (cache.has(key)) return cache.get(key);
    const { evidence } = saved;
    const byRef = new Map(evidence.capabilities.map(value => [value.manifest.capabilityRef, value]));
    const schemas = new Map(evidence.schemas.map(value => [value.$id, value]));
    if (byRef.size !== evidence.capabilities.length || schemas.size !== evidence.schemas.length)
      throw new Error('Duplicate stored contract identity.');
    const unique = values => {
      const entries = new Map();
      for (const value of values) {
        if (entries.has(value.ref) && canonicalDigest(entries.get(value.ref)) !== canonicalDigest(value))
          throw new Error('Conflicting stored policy identity.');
        entries.set(value.ref, value);
      }
      return [...entries.values()];
    };
    const policies = evidence.capabilities.map(value => value.policy);
    const policyRegistry = createExecutionPolicyRegistry({ expectedCapabilityRefs: [...byRef.keys()],
      capabilityBindings: policies.map(value => value.binding), retryPolicies: unique(policies.map(value => value.retry)),
      timeoutPolicies: unique(policies.map(value => value.timeout)), compensationContracts: unique(policies.flatMap(value => value.compensation)) });
    const registry = { snapshot: [...byRef].map(([capabilityRef, value]) => ({ capabilityRef,
      contractVersion: value.manifest.contractVersion, ownerScope: value.manifest.ownerScope,
      effectClass: value.manifest.effectClass, executorVersion: value.executorVersion,
      executionContractDigest: canonicalDigest(value.manifest) })),
      resolve(ref, owner) {
        const value = byRef.get(ref);
        if (!value || ![owner, 'execution-foundation'].includes(value.manifest.ownerScope)) throw new Error('Stored contract Owner mismatch.');
        return { manifest: value.manifest };
      } };
    const catalogDigest = executionCatalogDigest(registry, policyRegistry);
    const preboundEvidenceSchemas = {};
    for (const [ref, value] of byRef) for (const declared of value.manifest.preboundEvidenceContracts || []) {
      if (!['domain_evidence', 'full_result', 'evidence_reference'].includes(declared.representation)) throw new Error('Unknown Evidence representation.');
      const closure = canonicalDigest(schemaClosure({ inputPorts: { evidence: { schemaRef: declared.schemaRef } } }, schemas));
      const entry = preboundEvidenceSchemas[declared.schemaRef] ||= { capabilityRefs: [], previousSchemaDigest: closure,
        currentSchemaDigest: closure, ...(declared.representation === 'full_result' ? { fullResultRecord: true } : {}),
        ...(declared.representation === 'evidence_reference' ? { referenceRecord: true } : {}) };
      if (Boolean(entry.fullResultRecord) !== (declared.representation === 'full_result') ||
          Boolean(entry.referenceRecord) !== (declared.representation === 'evidence_reference')) throw new Error('Conflicting Evidence representation.');
      entry.capabilityRefs.push(ref);
    }
    const witness = { policyDigest: policyRegistry.digest, previousCatalogDigest: catalogDigest, currentCatalogDigest: catalogDigest,
      capabilities: registry.snapshot.map(entry => ({ ...entry, previousContractDigest: entry.executionContractDigest,
        currentContractDigest: entry.executionContractDigest,
        previousSchemaDigest: canonicalDigest(schemaClosure(byRef.get(entry.capabilityRef).manifest, schemas)),
        currentSchemaDigest: canonicalDigest(schemaClosure(byRef.get(entry.capabilityRef).manifest, schemas)) })),
      preboundEvidenceSchemas, excludedActiveProcessTypes: [] };
    const decoded = { registry, policyRegistry, schemas, witness,
      contractValidator: createCapabilityContractValidator({ schemas: evidence.schemas }) };
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, decoded);
    return decoded;
  }
  function verify(snapshot) {
    const proofs = new Map();
    function resolve(reader, planId) {
      if (proofs.has(planId)) return proofs.get(planId).proveStored;
      const saved = reader.readContract(planId);
      if (!saved) throw new Error('Missing immutable Plan contract evidence.');
      validateContractDocument(saved.evidence, saved.binding.contract_digest);
      if (saved.evidence.schemaRef === TERMINAL_FORMAT) {
        const observed = new Map();
        const prove = (currentReader, id, _requireUnchanged, _visiting, _proven, resolution) => {
          const current = currentReader.readContract(id);
          if (!current || current.binding.contract_digest !== saved.binding.contract_digest) throw new Error('Terminal evidence changed.');
          validateContractDocument(current.evidence, current.binding.contract_digest);
          const facts = proveTerminalAttestation(currentReader, id, current.evidence);
          verifyPlanContractBinding(current, facts);
          for (const item of current.evidence.footprint) {
            const graph = currentReader.read(item.planId);
            for (const effect of graph.effects.filter(value => !['committed', 'failed'].includes(value.state))) {
              const receipt = observed.get(effect.effect_id) || resolution?.proofs.get(effect.effect_id);
              if (!receipt) {
                if (resolution) resolution.pending = graph;
                throw Object.assign(new Error('Terminal Effect still requires current Owner proof.'), { pendingGraph: graph });
              }
              verifyTerminalEffectReceipt({ facts: graph, effect, receipt, proveSource(sourceId) {
                if (!current.evidence.footprint.some(value => value.planId === sourceId)) throw new Error('Owner proof escaped attested dependency graph.');
                return currentReader.read(sourceId);
              } });
            }
          }
          return facts;
        };
        const proof = { proveStored: prove, verify() {
          for (let count = 0; count < 100; count++) {
            try { return options.proofReader.verify(currentReader => Boolean(prove(currentReader, planId))); }
            catch (error) {
              if (!error.pendingGraph || !options.terminalEffectObserver) throw error;
              const receipts = options.terminalEffectObserver.observe(error.pendingGraph);
              const unresolved = error.pendingGraph.effects.filter(value => !['committed', 'failed'].includes(value.state));
              if (!Array.isArray(receipts) || receipts.length !== unresolved.length ||
                new Set(receipts.map(value => value.effectId)).size !== receipts.length ||
                receipts.some(value => !unresolved.some(effect => effect.effect_id === value.effectId)))
                throw new Error('Owner proof does not cover the exact unresolved Effect set.');
              for (const receipt of receipts) observed.set(receipt.effectId, receipt);
            }
          }
          throw new Error('Terminal Owner proof exceeded its bounded dependency closure.');
        } };
        proofs.set(planId, proof);
        return prove;
      }
      if (saved.evidence.schemaRef === COMMAND_FORMAT) {
        const prove = (currentReader, id) => proveSynchronousPlan(currentReader.readContract(id), currentReader.read(id),
          options.ownerCommandContracts || [], false);
        const proof = { proveStored: prove, verify: () => options.proofReader.verify(currentReader => Boolean(prove(currentReader, planId))) };
        proofs.set(planId, proof);
        return prove;
      }
      if (saved.evidence.capabilities.length === 0) {
        const prove = (currentReader, id) => {
          const facts = currentReader.read(id), current = currentReader.readContract(id);
          verifyPlanContractBinding(current, facts);
          if (id !== planId || current.binding.contract_digest !== saved.binding.contract_digest ||
              current.evidence.schemas.length || ![...TERMINAL, 'ready', 'running', 'blocked'].includes(facts.workAttempt.state) ||
              !PLAN_RESOLUTIONS.includes(facts.plan.state) || facts.plan.state === 'planned' ||
              ['nodes', 'edges', 'events', 'attempts', 'effects', 'results', 'markers'].some(key => facts[key].length))
            throw new Error('Empty Plan has executable or unclosed facts.');
          return facts;
        };
        const proof = { proveStored: prove, verify: () => options.proofReader.verify(currentReader => Boolean(prove(currentReader, planId))) };
        proofs.set(planId, proof);
        return prove;
      }
      const decoded = decode(saved);
      const proof = createBoundedCatalogTransition({ ...decoded, proofReader: options.proofReader,
        bindingProjectionRegistry: options.bindingProjectionRegistry, terminalEffectObserver: options.terminalEffectObserver,
        onRejected: options.onRejected, planProofResolver: resolve,
        planEvidence: { planId, verify(currentReader, facts, requireUnchanged) {
          const current = currentReader.readContract(planId);
          verifyPlanContractBinding(current, facts);
          if (current.binding.contract_digest !== saved.binding.contract_digest) throw new Error('Plan evidence changed during verification.');
          if (!TERMINAL.has(facts.workAttempt.state)) {
            const executable = capturePlanContracts(planFromFacts(facts), options);
            if (executable.digest !== current.binding.contract_digest) throw new Error('Executable Plan contracts changed.');
          }
          return true;
        } } });
      proofs.set(planId, proof);
      return proof.proveStored;
    }
    try {
      // The first read selects immutable evidence only. Every graph and binding
      // is then rechecked together in the proof transaction, including sources.
      options.proofReader.verify(reader => resolve(reader, snapshot.plan.plan_id));
      return proofs.get(snapshot.plan.plan_id).verify(snapshot);
    } catch (error) { options.onRejected?.(error.message); return false; }
  }
  return Object.freeze({ verify, verifyBatch: snapshots => snapshots.map(verify) });
}

module.exports = Object.freeze({ createStoredPlanContractVerifier });
