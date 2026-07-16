'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractSsotContracts } = require('./ssot-contract-extractor');

const MANIFEST_ID = 'helix.ssot-contract-source-map';
const CATEGORIES = Object.freeze([
  Object.freeze({ key: 'capabilities', fileKey: 'capabilities', chunkSize: 56 }),
  Object.freeze({ key: 'resultFamilies', fileKey: 'result-families', chunkSize: 48 }),
  Object.freeze({ key: 'tables', fileKey: 'tables', chunkSize: 13 }),
  Object.freeze({ key: 'transactions', fileKey: 'transactions', chunkSize: 18 })
]);

function padded(value) { return String(value).padStart(3, '0'); }

function materializeSsotSourceMap(options) {
  if (!options || typeof options.sourcePath !== 'string' || !options.sourcePath ||
      typeof options.sourceRelativePath !== 'string' || !options.sourceRelativePath ||
      typeof options.outputRoot !== 'string' || !options.outputRoot) throw new Error('P2_SSOT_SOURCE_MAP_OPTIONS_REQUIRED');
  const extracted = extractSsotContracts(fs.readFileSync(options.sourcePath, 'utf8'), { sourcePath: options.sourceRelativePath });
  fs.mkdirSync(options.outputRoot, { recursive: true });
  const entryFiles = [];
  for (const category of CATEGORIES) {
    const entries = extracted[category.key];
    for (let start = 0; start < entries.length; start += category.chunkSize) {
      const end = Math.min(start + category.chunkSize, entries.length);
      const fileName = `${category.fileKey}-${padded(start + 1)}-${padded(end)}.json`;
      entryFiles.push(`ssot-source-map/${fileName}`);
      fs.writeFileSync(path.join(options.outputRoot, fileName), `${JSON.stringify({
        schemaVersion: 1, mapId: MANIFEST_ID, category: category.key,
        startOrdinal: start + 1, endOrdinal: end, entries: entries.slice(start, end)
      }, null, 2)}\n`);
    }
  }
  const manifest = {
    schemaVersion: 1, manifestVersion: 1, manifestId: MANIFEST_ID, kind: 'ssot-source-map', owner: 'contracts', status: 'active',
    ssotRefs: ['8.5.4', '8.5.10', '8.5.11', '8.5.12', '8.5.13', '8.6.3', '8.6.17', '8.6.18', '8.6.19'],
    sourcePath: options.sourceRelativePath, sourceDocumentDigest: extracted.sourceDocumentDigest, counts: extracted.counts,
    categoryDigests: extracted.categoryDigests, aggregateDigest: extracted.aggregateDigest, entryFiles
  };
  fs.writeFileSync(path.join(path.dirname(options.outputRoot), 'ssot-source-map.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return Object.freeze({ manifest, extracted });
}

module.exports = Object.freeze({ materializeSsotSourceMap });
