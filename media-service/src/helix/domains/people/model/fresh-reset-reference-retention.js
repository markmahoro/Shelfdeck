'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const dependencies = Object.freeze([
  Object.freeze({ table: 'people_reference_assets', column: 'artifact_handle_id', kind: 'reference-image' }),
  Object.freeze({ table: 'people_reference_faces', column: 'embedding_handle_id', kind: 'reference-embedding' }),
]);
function fail() { throw Object.assign(new Error('People reference dependencies are incomplete or inconsistent.'), { code: 'PEOPLE_RESET_REFERENCE_INVALID' }); }

// Both opaque handles are owned reference facts. An image alone cannot make
// the paired face feature usable; neither dependency has a SQLite FK.
function describeFreshResetReferenceRetention({ assets, faces }) {
  if (!Array.isArray(assets) || !Array.isArray(faces)) fail();
  const images = new Map(assets.map(row => [row.reference_asset_id, row]));
  if (images.size !== assets.length) fail();
  const artifacts = new Map();
  function add(row, handle, digest, kind) {
    if (!row.person_id || !/^[a-f0-9]{64}$/.test(handle || '') || !/^[a-f0-9]{64}$/.test(digest || '') ||
        !['active', 'released'].includes(row.state)) fail();
    const value = { personId: row.person_id, artifactHandleId: handle, artifactDigest: digest,
      artifactKind: kind, active: row.state === 'active' };
    const prior = artifacts.get(handle);
    if (prior && canonicalDigest({ ...prior, active: false }) !== canonicalDigest({ ...value, active: false })) fail();
    artifacts.set(handle, { ...value, active: value.active || prior?.active === true });
  }
  for (const row of assets) add(row, row.artifact_handle_id, row.artifact_digest, 'reference-image');
  for (const row of faces) {
    const image = images.get(row.reference_asset_id);
    if (!image || image.person_id !== row.person_id || row.state === 'active' && image.state !== 'active') fail();
    add(row, row.embedding_handle_id, row.embedding_digest, 'reference-embedding');
  }
  const value = { schemaRef: 'people.fresh-reset-reference-retention@1',
    referenceDigest: canonicalDigest({ assets, faces }),
    artifacts: [...artifacts.values()].sort((a, b) => a.artifactHandleId.localeCompare(b.artifactHandleId, 'en')) };
  return Object.freeze({ ...value, digest: canonicalDigest(value) });
}

module.exports = Object.freeze({ freshResetReferenceArtifactDependencies: () => dependencies, describeFreshResetReferenceRetention });
