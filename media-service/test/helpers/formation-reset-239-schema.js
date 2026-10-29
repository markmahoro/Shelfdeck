'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const root=path.join(__dirname,'../fixtures/formation-reset-239');
const schemaDdl=zlib.gunzipSync(fs.readFileSync(path.join(root,'schema.sql.gz'))).toString('utf8');
const schemaManifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'schema.manifest.json.gz'))));
const expected='906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a';
if(digest(schemaDdl)!==expected||schemaManifest.ddlDigest!==expected)throw new Error('RESET_239_SCHEMA_FIXTURE_DRIFT');
module.exports=Object.freeze({schemaDdl,schemaManifest});
