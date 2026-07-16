'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RAW_SQL_FILES = new Set([
  'foundation/persistence/ddl-compiler.js',
  'foundation/persistence/owner-repository.js',
  'foundation/persistence/sqlite-kernel.js'
]);

function files(rootPath) {
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && entry.name.endsWith('.js')) result.push(filePath);
    }
  };
  visit(rootPath);
  return result.sort();
}

function checkPersistenceBoundaries(options) {
  const rootPath = path.resolve(options.rootPath);
  const findings = [];
  for (const filePath of files(rootPath)) {
    const relativePath = path.relative(rootPath, filePath).split(path.sep).join('/');
    const source = fs.readFileSync(filePath, 'utf8');
    if (/require\s*\(\s*['"]better-sqlite3['"]\s*\)/.test(source)) findings.push({
      code: 'P3_DIRECT_SQLITE_DRIVER_IMPORT', file: relativePath,
      message: 'Only the injected SqliteKernel construction path may instantiate the SQLite driver.'
    });
    if (relativePath !== 'foundation/persistence/sqlite-unit-of-work.js' && /\.runPrimitive\s*\(/.test(source)) findings.push({
      code: 'P3_RAW_KERNEL_TRANSACTION_ACCESS', file: relativePath,
      message: 'Only SqliteUnitOfWork may invoke the Kernel transaction primitive.'
    });
    if (!relativePath.startsWith('foundation/persistence/') && /require\s*\([^)]*sqlite-kernel[^)]*\)/.test(source)) findings.push({
      code: 'P3_KERNEL_IMPORT_OUTSIDE_PERSISTENCE', file: relativePath,
      message: 'Clean packages outside Foundation Persistence cannot import SqliteKernel.'
    });
    if (!RAW_SQL_FILES.has(relativePath) && /['"`]\s*(?:INSERT\s+INTO|UPDATE\s+["a-z]|DELETE\s+FROM|SELECT\s+[\s\S]{0,120}\s+FROM|CREATE\s+(?:TABLE|INDEX)|DROP\s+(?:TABLE|INDEX)|ALTER\s+TABLE|PRAGMA\s+)/i.test(source)) {
      findings.push({
        code: 'P3_RAW_SQL_OUTSIDE_KERNEL_COMPILER', file: relativePath,
        message: 'Raw SQL is restricted to the DDL compiler, Kernel integrity gate, and structured Repository compiler.'
      });
    }
  }
  return { ok: findings.length === 0, filesChecked: files(rootPath).length, findings };
}

module.exports = Object.freeze({ checkPersistenceBoundaries });
