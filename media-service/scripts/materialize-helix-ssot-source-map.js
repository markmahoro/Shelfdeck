'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { materializeSsotSourceMap } = require('./helix-architecture/ssot-source-map-materializer');

const repositoryRoot = path.resolve(__dirname, '../..');
const result = materializeSsotSourceMap({
  sourcePath: process.env.HELIX_SSOT_PATH || path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'),
  sourceRelativePath: 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
  outputRoot: path.join(repositoryRoot, 'media-service', 'src', 'helix', 'contracts', 'manifests', 'ssot-source-map')
});
const registryPath = path.join(repositoryRoot, 'media-service', 'src', 'helix', 'contracts', 'manifests', 'manifest-registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
for (const [kind, category] of [['capability-inventory', 'capabilities'], ['result-family-inventory', 'resultFamilies'],
  ['table-inventory', 'tables'], ['transaction-inventory', 'transactions']]) {
  const registration = registry.manifests.find(entry => entry.kind === kind);
  if (!registration) throw new Error('Missing inventory registration: ' + kind);
  registration.targetCount = result.manifest.counts[category];
}
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
process.stdout.write(`${JSON.stringify({ ok: true, counts: result.manifest.counts, aggregateDigest: result.manifest.aggregateDigest }, null, 2)}\n`);
