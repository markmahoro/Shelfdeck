'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createCleanLocalFilesystemMountProbe } = require('../src/clean-local-filesystem-mount-probe');
const { createCifsMountProbeCorrection } = require('../src/helix/platform/application/cifs-mount-probe-correction');
const { createLocationRegistryRepository } = require('../src/helix/platform/persistence/location-registry-repository');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');

function main(args) {
  const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const dataDir = value('--data-dir');
  const request = { mountScopeId: value('--scope-id'), revision: Number(value('--revision')),
    rootLocation: value('--root'), legacyDeviceIdentity: value('--legacy-device') };
  if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('An explicit absolute data directory is required.');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) throw new Error('Existing database is required.');
  const apply = args.includes('--apply');
  if (apply && value('--confirm') !== 'CORRECT_CIFS_MOUNT_PROBE_V1') throw new Error('Explicit correction confirmation is required.');
  let kernel, db;
  try {
    let repository;
    if (apply) {
      const generated = path.join(__dirname, '../src/helix/foundation/persistence/generated');
      const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json')));
      kernel = openSqliteKernel({ Database, databasePath, schemaManifest,
        schemaDdl: fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8') });
      repository = createLocationRegistryRepository({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }) });
    } else {
      db = new Database(databasePath, { readonly: true, fileMustExist: true });
      const rows = db.prepare(`SELECT r.* FROM platform_mount_scopes h JOIN platform_mount_scope_revisions r
        ON r.mount_scope_id=h.mount_scope_id AND r.revision=h.current_revision WHERE h.status='active'`).all();
      const active = rows.map((r) => ({ mountScopeId:r.mount_scope_id, revision:r.revision, endpointId:r.endpoint_id,
        mountBoundary:r.mount_boundary, filesystemType:r.filesystem_type, stableMountFingerprint:r.stable_mount_fingerprint,
        inodeCapabilityDigest:r.inode_capability_digest, probeEvidenceDigest:r.probe_evidence_digest, effectiveAtMs:r.effective_at_ms }));
      repository = { getMountScope: (id) => active.find((r) => r.mountScopeId === id), listMountScopes: () => active };
    }
    const service = createCifsMountProbeCorrection({ repository, probe: createCleanLocalFilesystemMountProbe() });
    console.log(JSON.stringify(apply ? service.apply(request) : { ...service.inspect(request), applied:false }));
  } finally { kernel?.close(); db?.close(); }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ code:error.code || 'CIFS_PROBE_CORRECTION_FAILED', message:error.message })); process.exitCode=1; }
}
module.exports = Object.freeze({ main });
