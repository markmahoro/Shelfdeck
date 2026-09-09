'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {openSqliteKernel} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCleanWorkspaceProductPort} = require('../../src/clean-workspace-product-port');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
const config = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const mode = process.argv[3];
const kernel = openSqliteKernel({Database,databasePath:config.databasePath,schemaDdl,schemaManifest,now:Date.now});
const port = createCleanWorkspaceProductPort({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),rootPath:config.workspaceRoot,
  afterCleanupPhysicalEffect() { if(mode==='physical') process.exit(91); }});
const result = port.reclaimMaterial(config.intent);
fs.writeFileSync(config.resultPath,JSON.stringify(result));
if(mode==='committed') process.exit(92);
kernel.close();
