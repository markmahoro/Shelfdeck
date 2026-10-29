'use strict';

const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function catalog(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(row => ({ ...row, sql: row.sql?.replaceAll('\r\n', '\n') ?? null }));
}

// This cold-copy qualification accepts only reviewed full source/target
// schemas. It never alters a live database or rewrites historical origins.
function inspectCatalogueTransition({source, target, schemaManifest}) {
  const baseline239 = '906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a';
  const baseline244 = '294bb8243aca2857729f70fa07fbc59b69efad5da5854a5db528386e19179bc6';
  const reviewed246 = 'dec16821d5ab5fc67d29d3b8de7f9b6adc754a9dd2847f310b34f96165461e68';
  const oldPersonTable = '73cb1ea4f9300ced71ea69b7473e37d6af8173fdcf3e6560e7c4f984ced4148b';
  const newPersonTable = '090f580e53d1b60750d1711f77d1a91ef2ee658618a71b76186f36009c898b6f';
  const newActorTables = ['libra_us_adult_catalogue_actor_decisions','people_us_adult_catalogue_registration_origins'];
  const newFrom239 = ['arca_offer_withdrawal_receipts','libra_custom_target_heads','libra_custom_target_intents',
    'libra_custom_target_previews','libra_us_adult_catalogue_actor_decisions','libra_us_adult_catalogue_bases',
    'people_us_adult_catalogue_registration_origins'];
  if(schemaManifest.ddlDigest!==reviewed246)fail('RESET_SOURCE_SCHEMA_UNREVIEWED');
  const before=catalog(source),after=catalog(target),markers=source.prepare('SELECT * FROM platform_schema_marker').all();
  if(markers.length!==1||markers[0].schema_name!=='shelfdeck'||markers[0].generation!=='helix-clean-v3')
    fail('RESET_SOURCE_SCHEMA_MARKER_INVALID');
  if(markers[0].schema_digest==='6a5e8a3de408545fc01cef3d839607621f979a4d886c039fdddd8533b8a6527e')
    fail('RESET_SOURCE_SCHEMA_UNREVIEWED');
  if(![baseline239,baseline244,reviewed246].includes(markers[0].schema_digest))fail('RESET_SOURCE_SCHEMA_MARKER_INVALID');
  const sourceDigest=markers[0].schema_digest,byIdentity=new Map(after.map(row=>[row.type+':'+row.name,row])),changedTables=[];
  for(const row of before){
    const key=row.type+':'+row.name,next=byIdentity.get(key)||null;
    if(canonicalJson(row)!==canonicalJson(next)){
      if(sourceDigest===reviewed246||row.type!=='table'||row.name!=='people_person_revisions'||
        canonicalDigest(row)!==oldPersonTable||!next||canonicalDigest(next)!==newPersonTable)
        fail('RESET_SOURCE_SCHEMA_UNREVIEWED');
      changedTables.push(row.name);
    }
    byIdentity.delete(key);
  }
  const expectedAdded=sourceDigest===baseline239?newFrom239:sourceDigest===baseline244?newActorTables:[];
  if([...byIdentity.values()].some(row=>!expectedAdded.includes(row.tbl_name))||
    canonicalJson([...byIdentity.values()].filter(row=>row.type==='table').map(row=>row.name).sort())!==canonicalJson(expectedAdded)||
    canonicalJson(changedTables)!==canonicalJson(sourceDigest===reviewed246?[]:['people_person_revisions']))
    fail('RESET_SOURCE_SCHEMA_UNREVIEWED');
  if(markers[0].catalog_digest!==canonicalDigest(before))fail('RESET_SOURCE_SCHEMA_MARKER_INVALID');
  if(source.pragma('foreign_key_check').length||source.pragma('integrity_check',{simple:true})!=='ok')fail('RESET_SOURCE_DATABASE_INVALID');
  return {addedTables:expectedAdded,changedTables,addedNullableColumns:{},sourceCatalogDigest:canonicalDigest(before),
    targetCatalogDigest:canonicalDigest(after),targetSchemaDigest:schemaManifest.ddlDigest};
}

// This is a cold import qualification, not a business-runtime migration. Every
// existing table/index must have the exact target definition, except the one
// explicitly reviewed nullable mapping reference below. This single production
// cutover qualification is not loaded by business execution or a legacy reader.
function initializeResetTarget({ Database, targetPath, source, schemaManifest, schemaDdl }) {
  const baseline239 = '906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a';
  const reviewed244 = '294bb8243aca2857729f70fa07fbc59b69efad5da5854a5db528386e19179bc6';
  const added239To244 = ['arca_offer_withdrawal_receipts', 'libra_custom_target_heads',
    'libra_custom_target_intents', 'libra_custom_target_previews', 'libra_us_adult_catalogue_bases'];
  const allowedNewTables = new Set(schemaManifest.ddlDigest === reviewed244 ? added239To244 :
    ['proc_field_reset_barriers','libra_episode_metadata_reviews',
      'libra_episode_metadata_mapping_intents','libra_episode_metadata_mapping_heads']);
  const kernel = openSqliteKernel({ Database, databasePath: targetPath, schemaManifest, schemaDdl });
  kernel.close();
  const target = new Database(targetPath, { readonly: true });
  try {
    if(schemaManifest.ddlDigest==='dec16821d5ab5fc67d29d3b8de7f9b6adc754a9dd2847f310b34f96165461e68')
      return inspectCatalogueTransition({source,target,schemaManifest});
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
        ![schemaManifest.ddlDigest, '6a5e8a3de408545fc01cef3d839607621f979a4d886c039fdddd8533b8a6527e',
          ...(schemaManifest.ddlDigest === reviewed244 ? [baseline239] : [])].includes(markers[0].schema_digest) ||
        markers[0].catalog_digest !== canonicalDigest(before)) fail('RESET_SOURCE_SCHEMA_MARKER_INVALID');
    const addedTables = [...byIdentity.values()].filter(row => row.type === 'table').map(row => row.name).sort();
    if (schemaManifest.ddlDigest === reviewed244 &&
        !(markers[0].schema_digest === baseline239 && canonicalJson(addedTables) === canonicalJson(added239To244) ||
          markers[0].schema_digest === reviewed244 && addedTables.length === 0)) fail('RESET_SOURCE_SCHEMA_UNREVIEWED');
    if (source.pragma('foreign_key_check').length || source.pragma('integrity_check', { simple: true }) !== 'ok')
      fail('RESET_SOURCE_DATABASE_INVALID');
    return { addedTables,
      addedNullableColumns,
      sourceCatalogDigest: canonicalDigest(before), targetCatalogDigest: canonicalDigest(after), targetSchemaDigest: schemaManifest.ddlDigest };
  } finally { target.close(); }
}

module.exports = Object.freeze({ initializeResetTarget });
