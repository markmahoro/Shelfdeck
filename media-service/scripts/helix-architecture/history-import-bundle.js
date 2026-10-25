'use strict';

// Frozen cutover input. Release-specific evidence is consulted only by this
// offline importer and never by normal startup or the background history audit.
const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createFrozenCatalogHistory } = require('../../scripts/helix-architecture/history-evidence/frozen-catalog-history');
const { createPausedReleaseBatchProof } = require('../../scripts/helix-architecture/history-evidence/paused-release-batches');
const { createExecutionPolicyRegistry } = require('../../src/helix/foundation/execution/execution-policy');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { executionCatalogDigest } = require('../../src/helix/foundation/execution/workflow-plan');

const ROOT = path.resolve(__dirname, '../../scripts/helix-architecture/history-evidence/catalog-transitions');
const SOURCES = Object.freeze([
  ['movie-terminal-contracts-20260930.json', '369f45ccf6fab87332162e90685a5cb87ceda248edfad0973df24c64fa8a0f8e'],
  ['published-terminal-contracts-20261015.json', '4547689c5e393cd4b3256ca98d55f45e8e18129db240308d2406217d828ece0d'],
  ['published-terminal-contracts-20261018.json', '02c61b170e4209eb07f6abb1172eece6e598ed06ab9ad9fa227a5fea32803a6c'],
  ['published-terminal-contracts-20261021.json', '214b8cf2272f740034ae8fe68d3b18e493c720bb7fd6dac7d5b692d58db03ed6'],
  ['published-terminal-contracts-20261022.json', '51dca4f218fdeae45ec2a72c53056afe3fb0486b056e5a794117658fa6c1046b'],
  ['import-source-b06b70ba10.json', '35b0bb78c6642bbffaeefd5d9607be2ef6662812950b93d228dacdbb6f86ea17'],
  ['import-source-999a94fa8.json', '9131d24fa982aef7b4491f28c7c7f28be2451f6eb8f0257950d8fcb6bb24e560'],
  ['import-source-04bf24190.json', '999a72c8866e3d9c5739b315844a79e219c6bfdffcaa00f709fd41f57c45838d'],
]);

function decodeArchive(archive) {
  const manifests = new Map(archive.manifests.map(value => [value.capabilityRef, value]));
  const registry = { snapshot: [...manifests].map(([capabilityRef, manifest]) => ({ capabilityRef, ownerScope: manifest.ownerScope,
    effectClass: manifest.effectClass, contractVersion: manifest.contractVersion, executorVersion: 1, executionContractDigest: canonicalDigest(manifest) })),
    resolve(ref, owner) {
      const manifest = manifests.get(ref);
      if (!manifest || ![owner, 'execution-foundation'].includes(manifest.ownerScope)) throw new Error('Archived contract Owner mismatch.');
      return { manifest, executor: { version: 1 } };
    } };
  const policyRegistry = createExecutionPolicyRegistry(archive.policy);
  if (executionCatalogDigest(registry, policyRegistry) !== archive.catalogDigest) throw new Error('Archived Catalog cannot be reproduced.');
  return { registry, policyRegistry, contractValidator: createCapabilityContractValidator({ schemas: archive.schemas }) };
}

function createHistoryImportBundle(options) {
  const entries = SOURCES.map(([file, archiveDigest]) => {
    const archive = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    if (canonicalDigest(archive) !== archiveDigest) throw new Error('Frozen import source digest mismatch.');
    return { archive, archiveDigest };
  });
  const witness = JSON.parse(fs.readFileSync(path.join(ROOT, 'intake-control-20260912.json'), 'utf8'));
  const priorArchive = JSON.parse(fs.readFileSync(path.join(ROOT, 'secondary-acceptance-history-20260928.json'), 'utf8'));
  const sources = new Map(entries.map(({ archive, archiveDigest }) => [archive.catalogDigest,
    { sourceCommit: archive.sourceCommit, archiveDigest }]));
  const olderDigest = canonicalDigest({ witness, priorArchive, movieArchiveDigest: entries[0].archiveDigest });
  for (const catalog of [witness.previousCatalogDigest, witness.currentCatalogDigest]) sources.set(catalog,
    { sourceCommit: witness.sourceCommit, archiveDigest: olderDigest });
  const pausedSource = entries[2], pausedContracts = decodeArchive(pausedSource.archive);
  const pausedScopes = new Set(['procurement:material_field:field_observation', 'perception:perception_acquisition:acquisition_page',
    'arca:arca_offdeck_automation:offdeck_duplicate_detection']);
  Object.assign(sources.get(pausedSource.archive.catalogDigest), { activeContracts: pausedContracts,
    allowActive: facts => pausedScopes.has([facts.work.owner_domain, facts.work.process_type, facts.work.work_kind].join(':')) });
  const verifierFiles = ['history-import-bundle.js', 'plan-contract-import.js'].map(file => path.join(__dirname, file)).concat(
    ['frozen-catalog-history.js', 'terminal-catalog-history.js', 'unchanged-paused-batch-proof.js', 'paused-release-batches.js']
      .map(file => path.join(__dirname, 'history-evidence', file)),
    ['bounded-catalog-transition.js', 'terminal-effect-proof.js', 'terminal-plan-attestation.js', 'plan-contract-evidence.js',
      'catalog-plan-proof-reader.js', 'catalog-schema-closure.js', 'workflow-plan.js', 'runtime-contracts.js']
      .map(file => path.resolve(__dirname, '../../src/helix/foundation/execution', file)));
  const verifierDigest = canonicalDigest(verifierFiles.map(file => ({ file: path.basename(file), bytes: fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') })));
  return { verifierDigest, sourceForCatalog: catalog => sources.get(catalog), createHistoricalVerifier(proofReader) {
    const shared = { ...options, proofReader };
    const history = createFrozenCatalogHistory({ ...shared, ...entries[0], additionalArchives: entries.slice(1), priorArchive,
      priorArchiveDigest: '1914bf6e798867be56b85bb541be0957cdc89cd0e173a48545d459f78dcca2b6', witness });
    const paused = createPausedReleaseBatchProof({ ...shared, ...options.currentContracts, schemas: options.schemas });
    return { verify(snapshot) {
      if (paused.supports(snapshot)) return paused.verify(snapshot);
      return history.supports(snapshot.plan.catalog_digest) && history.verify(snapshot);
    } };
  } };
}

module.exports = Object.freeze({ createHistoryImportBundle });
