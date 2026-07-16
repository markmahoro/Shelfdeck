'use strict';

const path = require('node:path');
const { materializeSsotSourceMap } = require('./helix-architecture/ssot-source-map-materializer');

const repositoryRoot = path.resolve(__dirname, '../..');
const result = materializeSsotSourceMap({
  sourcePath: path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'),
  sourceRelativePath: 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
  outputRoot: path.join(repositoryRoot, 'media-service', 'src', 'helix', 'contracts', 'manifests', 'ssot-source-map')
});
process.stdout.write(`${JSON.stringify({ ok: true, counts: result.manifest.counts, aggregateDigest: result.manifest.aggregateDigest }, null, 2)}\n`);
