'use strict';

const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function catalog(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(row => ({ ...row, sql: row.sql?.replaceAll('\r\n', '\n') ?? null }));
}

// This is a cold import qualification, not a business-runtime migration. Every
// existing table/index must have the exact target definition, except the one
// explicitly reviewed nullable mapping reference below. This single production
// cutover qualification is not loaded by business execution or a legacy reader.
function initializeResetTarget({ Database, targetPath, source, schemaManifest, schemaDdl }) {
  const allowedNewTables = new Set(['proc_field_reset_barriers','libra_episode_metadata_reviews',
    'libra_episode_metadata_mapping_intents','libra_episode_metadata_mapping_heads']);
  const kernel = openSqliteKernel({ Database, databasePath: targetPath, schemaManifest, schemaDdl });
  kernel.close();
  const target = new Database(targetPath, { readonly: true });
  try {
    const before = catalog(source), after = catalog(target), byIdentity = new Map(after.map(row => [row.type + ':' + row.name, row]));
    const addedNullableColumns={};
    for (const row of before) {
      const next=byIdentity.get(row.type + ':' + row.name)||null;
      if (canonicalJson(row) !== canonicalJson(next)) {
        if(row.type!=='table'||row.name!=='libra_runs'||
            canonicalDigest(row)!=='641ef2143a0c494b7791739145b2b173e2e04362d042afcda58e9426eb64aa45'||
            canonicalDigest(next)!=='fa6661dc4489f3127823d125b78706bbce27bf2cfc4c2fc164d118928c48af5f')fail('RESET_SOURCE_SCHEMA_UNREVIEWED');
        addedNullableColumns.libra_runs=['episode_metadata_mapping_intent_id'];
      }
      byIdentity.delete(row.type + ':' + row.name);
    }
    if ([...byIdentity.values()].some(row => !allowedNewTables.has(row.tbl_name))) fail('RESET_SOURCE_SCHEMA_UNREVIEWED');
    const markers = source.prepare('SELECT * FROM platform_schema_marker').all();
    if (markers.length !== 1 || markers[0].schema_name !== 'shelfdeck' || markers[0].generation !== 'helix-clean-v3' ||
        ![schemaManifest.ddlDigest, '6a5e8a3de408545fc01cef3d839607621f979a4d886c039fdddd8533b8a6527e'].includes(markers[0].schema_digest) ||
        markers[0].catalog_digest !== canonicalDigest(before)) fail('RESET_SOURCE_SCHEMA_MARKER_INVALID');
    if (source.pragma('foreign_key_check').length || source.pragma('integrity_check', { simple: true }) !== 'ok')
      fail('RESET_SOURCE_DATABASE_INVALID');
    return { addedTables: [...byIdentity.values()].filter(row => row.type === 'table').map(row => row.name).sort(),
      addedNullableColumns,
      sourceCatalogDigest: canonicalDigest(before), targetCatalogDigest: canonicalDigest(after), targetSchemaDigest: schemaManifest.ddlDigest };
  } finally { target.close(); }
}

module.exports = Object.freeze({ initializeResetTarget });
