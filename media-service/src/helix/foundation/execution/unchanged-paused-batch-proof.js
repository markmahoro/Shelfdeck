'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createCapabilityContractValidator } = require('../capability/contract-validator');
const { createExecutionPolicyRegistry } = require('./execution-policy');
const { executionCatalogDigest } = require('./workflow-plan');
const { schemaClosure } = require('./catalog-schema-closure');
const { createBoundedCatalogTransition } = require('./bounded-catalog-transition');
const { validateSupportingWorkDefinition } = require('./runtime-contracts');

// A paused technical batch retains its immutable graph and cursor. Historical
// executors are never registered; every executable contract must be unchanged.
function createUnchangedPausedBatchProof(options) {
  const { archive, archiveDigest, scopes, registry, policyRegistry, schemas, proofReader } = options;
  if (canonicalDigest(archive) !== archiveDigest || !/^[a-f0-9]{40}$/.test(archive.sourceCommit))
    throw new Error('Paused batch archive provenance mismatch.');
  const manifests = new Map(archive.manifests.map(value => [value.capabilityRef, value]));
  const oldSchemas = new Map(archive.schemas.map(value => [value.$id, value]));
  const oldPolicy = createExecutionPolicyRegistry(archive.policy);
  const sourceRegistry = {
    snapshot: archive.policy.expectedCapabilityRefs.slice().sort().map(capabilityRef => {
      const manifest = manifests.get(capabilityRef);
      if (!manifest) throw new Error('Missing paused batch source Capability.');
      return { capabilityRef, contractVersion: manifest.contractVersion, ownerScope: manifest.ownerScope,
        effectClass: manifest.effectClass, executorVersion: 1, executionContractDigest: canonicalDigest(manifest) };
    }),
    resolve(capabilityRef, owner) {
      const manifest = manifests.get(capabilityRef);
      if (!manifest || ![owner, 'execution-foundation'].includes(manifest.ownerScope)) throw new Error('Paused batch source Owner mismatch.');
      return { manifest };
    },
  };
  if (sourceRegistry.snapshot.length !== manifests.size || executionCatalogDigest(sourceRegistry, oldPolicy) !== archive.catalogDigest)
    throw new Error('Paused batch Catalog reconstruction mismatch.');
  const allowed = new Map(scopes.map(scope => [[scope.ownerDomain, scope.processType, scope.workKind].join('\0'), scope]));
  if (!allowed.size || allowed.size !== scopes.length) throw new Error('Invalid paused batch scope set.');
  const semantics = (policy, ref, effect) => ({ binding: policy.bindingFor(ref, effect),
    retry: policy.retryFor(ref, effect), timeout: policy.timeoutFor(ref, effect),
    compensation: policy.bindingFor(ref, effect).compensationContractRefs.map(value => policy.compensation(value)) });
  const equal = (left, right) => canonicalDigest(left) === canonicalDigest(right);
  for (const scope of scopes) for (const ref of scope.capabilityRefs) {
    const before = sourceRegistry.resolve(ref, scope.ownerDomain).manifest;
    const after = registry.resolve(ref, scope.ownerDomain).manifest;
    const { sourceLocator, ...current } = after;
    if (!['pure_observation', 'domain_fact_commit'].includes(before.effectClass) || !equal(before, current) ||
        !equal(schemaClosure(before, oldSchemas), schemaClosure(after, schemas)) ||
        !equal(semantics(oldPolicy, ref, before.effectClass), semantics(policyRegistry, ref, after.effectClass)))
      throw new Error('Paused batch executable contract changed: ' + ref);
  }
  function assertPaused(facts) {
    if (!facts || facts.plan.catalog_digest !== archive.catalogDigest) throw new Error('Unknown paused batch Catalog.');
    const scope = allowed.get([facts.work.owner_domain, facts.work.process_type, facts.work.work_kind].join('\0'));
    const refs = facts.nodes.map(node => node.capability_ref).sort();
    const definition = validateSupportingWorkDefinition(JSON.parse(facts.work.definition_json));
    if (!scope || !equal(refs, scope.capabilityRefs.slice().sort()) ||
        canonicalDigest(definition) !== facts.work.definition_digest || Buffer.byteLength(facts.work.definition_json) > 256 * 1024 ||
        !Object.entries({ workId: 'work_id', ownerDomain: 'owner_domain', processType: 'process_type',
          processId: 'process_id', workKind: 'work_kind' }).every(([field, column]) => definition[field] === facts.work[column]) ||
        facts.events.some(event => !['pending', 'ready', 'waiting_for_resource', 'succeeded', 'skipped', 'failed', 'cancelled'].includes(event.state)) ||
        facts.attempts.some(attempt => attempt.state !== 'completed') ||
        facts.effects.some(effect => !['committed', 'failed'].includes(effect.state)))
      throw new Error('Batch is not an unchanged, safely paused scope.');
    return facts;
  }
  let captured;
  const checkedReader = { verify(callback) {
    return proofReader.verify(reader => callback({ ...reader,
      read(planId) {
        const facts = assertPaused(reader.read(planId));
        captured?.set(planId, facts);
        return facts;
      },
    }));
  } };
  const witness = { sourceCommit: archive.sourceCommit, policyDigest: oldPolicy.digest,
    previousCatalogDigest: archive.catalogDigest, currentCatalogDigest: archive.catalogDigest,
    excludedActiveProcessTypes: [], preboundEvidenceSchemas: {},
    capabilities: sourceRegistry.snapshot.map(entry => ({ ...entry,
      previousContractDigest: entry.executionContractDigest, currentContractDigest: entry.executionContractDigest,
      previousSchemaDigest: canonicalDigest(schemaClosure(manifests.get(entry.capabilityRef), oldSchemas)),
      currentSchemaDigest: canonicalDigest(schemaClosure(manifests.get(entry.capabilityRef), oldSchemas)) })) };
  const proof = createBoundedCatalogTransition({ witness, registry: sourceRegistry, policyRegistry: oldPolicy,
    schemas: oldSchemas, contractValidator: createCapabilityContractValidator({ schemas: archive.schemas }),
    bindingProjectionRegistry: options.bindingProjectionRegistry, proofReader: checkedReader,
    onRejected: options.onRejected });
  return Object.freeze({
    supports(snapshot) {
      return snapshot?.plan?.catalog_digest === archive.catalogDigest &&
        !['succeeded', 'failed', 'cancelled'].includes(snapshot.workAttempt?.state) &&
        allowed.has([snapshot.work?.owner_domain, snapshot.work?.process_type, snapshot.work?.work_kind].join('\0'));
    },
    verify(snapshot) { return this.supports(snapshot) && proof.verify(snapshot); },
    inspect(snapshot) {
      // A batch can be ready between pages with a closed previous Attempt.
      // Prove that original graph too; the next Plan uses the current Catalog.
      if (snapshot?.plan?.catalog_digest !== archive.catalogDigest ||
          !['admitted', 'ready', 'running', 'blocked'].includes(snapshot.work?.state) ||
          !allowed.has([snapshot.work?.owner_domain, snapshot.work?.process_type, snapshot.work?.work_kind].join('\0'))) return null;
      captured = new Map();
      try { return proof.verify(snapshot) ? [...captured.values()] : null; }
      finally { captured = null; }
    },
  });
}

module.exports = Object.freeze({ createUnchangedPausedBatchProof });
