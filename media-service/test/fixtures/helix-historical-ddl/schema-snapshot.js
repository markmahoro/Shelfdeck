'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {digest}=require('../../../src/helix/foundation/persistence/ddl-compiler');
function historicalSchema(ddlDigest) {
  assert.match(ddlDigest,/^[a-f0-9]{64}$/);
  const schemaDdl=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,ddlDigest+'.sql.gz'))).toString('utf8'),
    schemaManifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,ddlDigest+'.manifest.json.gz'))));
  assert.equal(digest(schemaDdl),ddlDigest);assert.equal(schemaManifest.ddlDigest,ddlDigest);
  assert.equal(schemaManifest.tables.length,schemaManifest.tableCount);
  return Object.freeze({schemaDdl,schemaManifest});
}
module.exports=Object.freeze({historicalSchema});
