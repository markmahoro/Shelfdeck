'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
// Historical cutover qualification must stay on its accepted target, never the
// moving application schema. This fixture is not loaded by the service.
const root = path.join(__dirname, '../fixtures/plan-contract-target');
const schemaDdl = zlib.gunzipSync(fs.readFileSync(path.join(root, 'schema.sql.gz'))).toString('utf8');
const schemaManifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'schema.manifest.json.gz'))));
const expected = '6a5e8a3de408545fc01cef3d839607621f979a4d886c039fdddd8533b8a6527e';
if (digest(schemaDdl) !== expected || schemaManifest.ddlDigest !== expected) throw new Error('HISTORICAL_SCHEMA_FIXTURE_DRIFT');
module.exports = Object.freeze({ schemaDdl, schemaManifest });
