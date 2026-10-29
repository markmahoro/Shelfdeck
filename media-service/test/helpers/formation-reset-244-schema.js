'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const root=path.join(__dirname,'../fixtures/formation-reset-244');
const schemaDdl=zlib.gunzipSync(fs.readFileSync(path.join(root,'schema.sql.gz'))).toString('utf8');
const schemaManifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'schema.manifest.json.gz'))));
const expected='294bb8243aca2857729f70fa07fbc59b69efad5da5854a5db528386e19179bc6';
if(digest(schemaDdl)!==expected||schemaManifest.ddlDigest!==expected||schemaManifest.tables.length!==244)
  throw new Error('RESET_244_SCHEMA_FIXTURE_DRIFT');
module.exports=Object.freeze({schemaDdl,schemaManifest});
