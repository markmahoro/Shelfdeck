'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { checkPersistenceBoundaries } = require('../../scripts/helix-architecture/p3-persistence-boundary-guard');

const cleanRoot = path.resolve(__dirname, '../../src/helix');

test('keeps SQLite driver, raw transaction access, and raw SQL inside the clean Persistence boundary', () => {
  const result = checkPersistenceBoundaries({ rootPath: cleanRoot });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.ok(result.filesChecked >= 10);
});

test('rejects direct driver imports, raw Kernel access, raw SQL, and Kernel imports outside Persistence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-persistence-guard-'));
  try {
    const domain = path.join(root, 'domains', 'libra', 'persistence');
    const diagnostics = path.join(root, 'foundation', 'diagnostics');
    fs.mkdirSync(domain, { recursive: true });
    fs.mkdirSync(diagnostics, { recursive: true });
    fs.writeFileSync(path.join(domain, 'escape.js'), "const Database=require('better-sqlite3'); const kernel=require('../../../foundation/persistence/sqlite-kernel'); kernel.runPrimitive(() => Database.prepare('DELETE FROM arca_shelves'));\n");
    fs.writeFileSync(path.join(diagnostics, 'escape.js'), "module.exports=(kernel)=>kernel.runPrimitive((tx)=>tx.prepare('SELECT * FROM libra_subjects'));\n");
    const result = checkPersistenceBoundaries({ rootPath: root });
    const codes = new Set(result.findings.map((finding) => finding.code));
    assert.equal(result.ok, false);
    assert.ok(codes.has('P3_DIRECT_SQLITE_DRIVER_IMPORT'));
    assert.ok(codes.has('P3_RAW_KERNEL_TRANSACTION_ACCESS'));
    assert.ok(codes.has('P3_KERNEL_IMPORT_OUTSIDE_PERSISTENCE'));
    assert.ok(codes.has('P3_RAW_SQL_OUTSIDE_KERNEL_COMPILER'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
