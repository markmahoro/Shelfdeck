'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createCapabilityContractValidator } = require('../capability/contract-validator');
const { createBoundedCatalogTransition } = require('./bounded-catalog-transition');

// This view has no executors or semantic validators and never enters the live
// registry. The original transition proof remains authoritative for its older
// terminal records, including its explicitly witnessed nominal Evidence.
function createTerminalCatalogHistory({ archive, archiveDigest, witness, currentCatalogDigest,
  policyRegistry, bindingProjectionRegistry, proofReader, terminalEffectObserver, onRejected }) {
  const catalogs = new Set([witness.previousCatalogDigest, witness.currentCatalogDigest]);
  const rejected = Object.freeze({ supports: digest => catalogs.has(digest), verify: () => false });
  if (canonicalDigest(archive) !== archiveDigest || archive.targetCatalogDigest !== currentCatalogDigest ||
      archive.witnessDigest !== canonicalDigest(witness)) return rejected;
  const manifests = new Map(archive.manifests.map(manifest => [manifest.capabilityRef, manifest]));
  if (manifests.size !== archive.manifests.length || manifests.size !== witness.capabilities.length) return rejected;
  const registry = Object.freeze({
    snapshot: Object.freeze(witness.capabilities.map(record => {
      const manifest = manifests.get(record.capabilityRef);
      return Object.freeze({ capabilityRef: record.capabilityRef, contractVersion: manifest?.contractVersion,
        ownerScope: manifest?.ownerScope, effectClass: manifest?.effectClass, executorVersion: record.executorVersion,
        executionContractDigest: canonicalDigest(manifest || null) });
    })),
    resolve(ref, owner) {
      const manifest = manifests.get(ref);
      if (!manifest || !['libra', 'arca', 'procurement', 'perception'].includes(owner) ||
          (manifest.ownerScope !== owner && manifest.ownerScope !== 'execution-foundation')) {
        throw new Error('Historical Capability is outside the requesting Owner scope.');
      }
      return Object.freeze({ manifest });
    },
  });
  const proof = createBoundedCatalogTransition({ witness, registry, policyRegistry,
    schemas: new Map(archive.schemas.map(schema => [schema.$id, schema])),
    contractValidator: createCapabilityContractValidator({ schemas: archive.schemas }),
    bindingProjectionRegistry, proofReader, terminalEffectObserver, onRejected, terminalOnly: true });
  return Object.freeze({ supports: digest => catalogs.has(digest), verify: snapshot => proof.verify(snapshot) });
}

module.exports = Object.freeze({ createTerminalCatalogHistory });
