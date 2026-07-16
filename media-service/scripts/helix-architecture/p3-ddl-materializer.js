'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileSchema } = require('../../src/helix/foundation/persistence/ddl-compiler');

function readFrozenTableContracts(contractsRoot) {
  const inventoryPath = path.join(contractsRoot, 'manifests', 'table-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const entries = inventory.entryFiles.flatMap((relativePath) => {
    const document = JSON.parse(fs.readFileSync(path.join(contractsRoot, 'manifests', relativePath), 'utf8'));
    return document.entries;
  });
  if (entries.length !== inventory.targetCount) throw new Error(`P3_DDL_INVENTORY_COUNT:${entries.length}:${inventory.targetCount}`);
  return entries.map((entry) => {
    const document = JSON.parse(fs.readFileSync(path.join(contractsRoot, entry.targetLocator.path), 'utf8'));
    if (document.contractId !== entry.contract.contractRef) throw new Error(`P3_DDL_CONTRACT_REF_MISMATCH:${entry.id}`);
    return document.contract;
  });
}

function materializeP3Ddl({ contractsRoot, outputRoot }) {
  const compiled = compileSchema(readFrozenTableContracts(contractsRoot));
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'clean-schema.sql'), compiled.ddl);
  fs.writeFileSync(path.join(outputRoot, 'clean-schema.manifest.json'), `${JSON.stringify(compiled.manifest, null, 2)}\n`);
  return compiled.manifest;
}

if (require.main === module) {
  const serviceRoot = path.resolve(__dirname, '../..');
  const manifest = materializeP3Ddl({
    contractsRoot: path.join(serviceRoot, 'src', 'helix', 'contracts'),
    outputRoot: path.join(serviceRoot, 'src', 'helix', 'foundation', 'persistence', 'generated')
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...manifest }, null, 2)}\n`);
}

module.exports = Object.freeze({ materializeP3Ddl, readFrozenTableContracts });
