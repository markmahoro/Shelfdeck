'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createCapabilityContractValidator } = require('../capability/contract-validator');
const { createExecutionPolicyRegistry } = require('./execution-policy');
const { executionCatalogDigest } = require('./workflow-plan');
const { schemaClosure } = require('./catalog-schema-closure');
const { createBoundedCatalogTransition } = require('./bounded-catalog-transition');
const { createTerminalCatalogHistory } = require('./terminal-catalog-history');

// Frozen data only: no historical executor is registered or exposed to dispatch.
function createFrozenCatalogHistory(options) {
  const { archive, archiveDigest, priorArchive, priorArchiveDigest, witness } = options;
  if (canonicalDigest(archive) !== archiveDigest || !/^[a-f0-9]{40}$/.test(archive.sourceCommit) ||
      priorArchive.targetCatalogDigest !== archive.catalogDigest) {
    throw new Error('Frozen historical contract provenance mismatch.');
  }
  const manifests = new Map(archive.manifests.map(manifest => [manifest.capabilityRef, manifest]));
  if (manifests.size !== archive.manifests.length) throw new Error('Duplicate historical Capability.');
  const schemas = new Map(archive.schemas.map(schema => [schema.$id, schema]));
  const policyRegistry = createExecutionPolicyRegistry(archive.policy);
  const registry = Object.freeze({
    snapshot: archive.policy.expectedCapabilityRefs.slice().sort().map(capabilityRef => {
      const manifest = manifests.get(capabilityRef);
      if (!manifest) throw new Error('Missing historical Capability.');
      return { capabilityRef, contractVersion: manifest.contractVersion, ownerScope: manifest.ownerScope,
        effectClass: manifest.effectClass, executorVersion: 1, executionContractDigest: canonicalDigest(manifest) };
    }),
    resolve(ref, owner) {
      const manifest = manifests.get(ref);
      if (!manifest || !['libra', 'arca', 'procurement', 'perception', 'people'].includes(owner) ||
          ![owner, 'execution-foundation'].includes(manifest.ownerScope)) throw new Error('Historical Owner mismatch.');
      return { manifest };
    },
  });
  if (registry.snapshot.length !== manifests.size || executionCatalogDigest(registry, policyRegistry) !== archive.catalogDigest) {
    throw new Error('Frozen historical Catalog reconstruction mismatch.');
  }
  const records = registry.snapshot.map(entry => ({ ...entry,
    previousContractDigest: entry.executionContractDigest, currentContractDigest: entry.executionContractDigest,
    previousSchemaDigest: canonicalDigest(schemaClosure(manifests.get(entry.capabilityRef), schemas)),
    currentSchemaDigest: canonicalDigest(schemaClosure(manifests.get(entry.capabilityRef), schemas)) }));
  const frozenWitness = { sourceCommit: witness.sourceCommit, policyDigest: policyRegistry.digest,
    previousCatalogDigest: archive.catalogDigest, currentCatalogDigest: archive.catalogDigest,
    capabilities: records, excludedActiveProcessTypes: [], preboundEvidenceSchemas: witness.preboundEvidenceSchemas };
  const proofs = new Map();
  const shared = { bindingProjectionRegistry: options.bindingProjectionRegistry, proofReader: options.proofReader,
    terminalEffectObserver: options.terminalEffectObserver, onRejected: options.onRejected,
    historicalProofResolver: digest => proofs.get(digest) };
  const prior = createTerminalCatalogHistory({ ...shared, archive: priorArchive, archiveDigest: priorArchiveDigest,
    witness, currentCatalogDigest: archive.catalogDigest, policyRegistry,
    onProofReady(proof) { proofs.set(witness.previousCatalogDigest, proof); proofs.set(witness.currentCatalogDigest, proof); } });
  const frozen = createBoundedCatalogTransition({ ...shared, witness: frozenWitness, registry, policyRegistry, schemas,
    contractValidator: createCapabilityContractValidator({ schemas: archive.schemas }), terminalOnly: true });
  proofs.set(archive.catalogDigest, frozen.proveTerminal);
  if (options.additionalArchives && (!Array.isArray(options.additionalArchives) || options.additionalArchives.length > 8))
    throw new Error('Additional terminal Catalog archive set exceeds its bound.');
  const additionalVerifiers = new Map();
  for (const extra of options.additionalArchives || []) {
    const value = extra.archive;
    if (canonicalDigest(value) !== extra.archiveDigest || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || proofs.has(value.catalogDigest))
      throw new Error('Additional terminal Catalog archive provenance mismatch.');
    const extraManifests = new Map(value.manifests.map(manifest => [manifest.capabilityRef, manifest]));
    const extraSchemas = new Map(value.schemas.map(schema => [schema.$id, schema]));
    if (extraManifests.size !== value.manifests.length || extraSchemas.size !== value.schemas.length)
      throw new Error('Duplicate additional historical schema or Capability.');
    for (const [ref, evidence] of Object.entries(value.preboundEvidenceSchemas || {})) {
      if (Object.hasOwn(frozenWitness.preboundEvidenceSchemas, ref) || evidence.fullResultRecord !== true || evidence.historicalNominalContract)
        throw new Error('Additional full Result witness cannot replace original nominal provenance.');
    }
    const extraPolicy = createExecutionPolicyRegistry(value.policy);
    const extraRegistry = {
      snapshot: value.policy.expectedCapabilityRefs.slice().sort().map(capabilityRef => {
        const manifest = extraManifests.get(capabilityRef);
        if (!manifest) throw new Error('Missing additional historical Capability.');
        return { capabilityRef, contractVersion: manifest.contractVersion, ownerScope: manifest.ownerScope,
          effectClass: manifest.effectClass, executorVersion: 1, executionContractDigest: canonicalDigest(manifest) };
      }),
      resolve(ref, owner) {
        const manifest = extraManifests.get(ref);
        if (!manifest || !['libra', 'arca', 'procurement', 'perception', 'people'].includes(owner) ||
            ![owner, 'execution-foundation'].includes(manifest.ownerScope)) throw new Error('Additional historical Owner mismatch.');
        return { manifest };
      },
    };
    if (extraRegistry.snapshot.length !== extraManifests.size || executionCatalogDigest(extraRegistry, extraPolicy) !== value.catalogDigest)
      throw new Error('Additional historical Catalog reconstruction mismatch.');
    const extraWitness = { ...frozenWitness, policyDigest: extraPolicy.digest,
      previousCatalogDigest: value.catalogDigest, currentCatalogDigest: value.catalogDigest,
      // Preserve the original producer/provenance witness; bind its current
      // schema side to this exact frozen release, never to live schemas.
      preboundEvidenceSchemas: Object.fromEntries(Object.entries(frozenWitness.preboundEvidenceSchemas).map(([ref, evidence]) =>
        [ref, { ...evidence, currentSchemaDigest: canonicalDigest(schemaClosure({ inputPorts: { evidence: { schemaRef: ref } } }, extraSchemas)) }])
        .concat(Object.entries(value.preboundEvidenceSchemas || {}))),
      capabilities: extraRegistry.snapshot.map(entry => ({ ...entry,
        previousContractDigest: entry.executionContractDigest, currentContractDigest: entry.executionContractDigest,
        previousSchemaDigest: canonicalDigest(schemaClosure(extraManifests.get(entry.capabilityRef), extraSchemas)),
        currentSchemaDigest: canonicalDigest(schemaClosure(extraManifests.get(entry.capabilityRef), extraSchemas)) })) };
    const history = createBoundedCatalogTransition({ ...shared, witness: extraWitness, registry: extraRegistry,
      policyRegistry: extraPolicy, schemas: extraSchemas,
      contractValidator: createCapabilityContractValidator({ schemas: value.schemas }), terminalOnly: true });
    proofs.set(value.catalogDigest, history.proveTerminal);
    additionalVerifiers.set(value.catalogDigest, snapshot => history.verify(snapshot));
  }
  const verify = snapshot => {
    const extra = additionalVerifiers.get(snapshot?.plan?.catalog_digest);
    return extra ? extra(snapshot) : snapshot?.plan?.catalog_digest === archive.catalogDigest ? frozen.verify(snapshot) : prior.verify(snapshot);
  };
  return Object.freeze({
    supports: digest => proofs.has(digest),
    verify,
    verifyBatch(snapshots) {
      if (!Array.isArray(snapshots) || snapshots.length > 100) throw new Error('Historical proof batch exceeds its bound.');
      const deferred = [];
      const results = options.proofReader.verify(reader => {
        reader.prefetch(snapshots.map(snapshot => snapshot.plan.plan_id));
        const proven = new Map();
        return snapshots.map((snapshot, index) => {
          const resolution = { proofs: new Map(), pending: null };
          try {
            const proof = proofs.get(snapshot.plan.catalog_digest);
            if (!proof) return false;
            const facts = proof(reader, snapshot.plan.plan_id, false, new Set(), proven, resolution);
            return facts.work.work_id === snapshot.work?.work_id && facts.workAttempt.attempt_id === snapshot.workAttempt?.attempt_id;
          } catch (error) {
            // Owner observations remain outside the Foundation transaction.
            // Their exact proof is re-read by the existing individual verifier.
            if (resolution.pending) deferred.push(index);
            else options.onRejected?.(error.message);
            return false;
          }
        });
      });
      for (const index of deferred) results[index] = verify(snapshots[index]);
      return results;
    },
  });
}

module.exports = Object.freeze({ createFrozenCatalogHistory });
