'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

if (process.argv.some((arg) => arg === '--apply' || arg.startsWith('--apply='))) {
  throw new Error('Helix data preflight is read-only and does not support --apply');
}

const dataDirArg = process.argv.find((arg) => arg.startsWith('--data-dir='));
const dataDir = path.resolve(dataDirArg
  ? dataDirArg.slice('--data-dir='.length)
  : process.env.MEDIA_SERVICE_DATA_DIR || path.join(__dirname, '..', 'data'));

function inspectDatabase(fileName, tableSpecs) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) return { fileName, exists: false, sizeBytes: 0, tables: {} };
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const tableNames = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const result = {};
    for (const [table, expectedColumns] of Object.entries(tableSpecs)) {
      const columns = tableNames.has(table)
        ? db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
        : [];
      result[table] = tableNames.has(table)
        ? {
          exists: true,
          rows: db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0,
          missingColumns: expectedColumns.filter((column) => !columns.includes(column)),
        }
        : { exists: false, rows: 0 };
    }
    return { fileName, exists: true, sizeBytes: fs.statSync(filePath).size, tables: result };
  } finally {
    db.close();
  }
}

const library = inspectDatabase('library.db', {
  media_items: ['item_id', 'sub_library_id', 'payload_json'],
  nexora_memberships: ['media_item_id', 'status'],
  libra_library_items: ['item_id', 'membership_status', 'phase', 'admission_generation'],
  libra_reconcile_operations: ['operation_id', 'item_id', 'idempotency_key', 'status'],
  libra_events: ['event_id', 'item_id', 'event_type', 'generation'],
  nexora_source_bindings: ['binding_id', 'media_item_id', 'source_id', 'validity', 'reason', 'observed_at'],
  nexora_source_state: ['media_item_id', 'revision', 'readiness', 'access_descriptor_json'],
});
const tasks = inspectDatabase('tasks.db', {
  tasks: ['id', 'item_id', 'status', 'payload_json'],
  task_events: ['id', 'task_id', 'event_type'],
  kairox_admissions: ['item_id', 'generation', 'status', 'source_context_json'],
});

if (!library.exists || !library.tables.media_items.exists) {
  throw new Error('library.db with media_items is required for Helix production migration');
}
if (!tasks.exists || !tasks.tables.tasks.exists) {
  throw new Error('tasks.db with tasks is required for Helix production migration');
}
for (const database of [library, tasks]) {
  for (const [table, detail] of Object.entries(database.tables)) {
    if (detail.exists && detail.missingColumns.length > 0) {
      throw new Error(`${database.fileName}:${table} is missing required columns: ${detail.missingColumns.join(', ')}`);
    }
  }
}

const alreadyInitialized = library.tables.libra_library_items.exists;
const report = {
  mode: 'read-only',
  dataDir,
  library,
  tasks,
  plannedStartupActions: alreadyInitialized
    ? ['Reuse existing Helix fact tables and reconcile durable operations.']
    : [
      'Create Helix fact tables in library.db and kairox_admissions in tasks.db.',
      'Backfill every media_items row as an active onboarding membership.',
      'Mark unresolved source identity as migration_source_unresolved; do not grant silent Kairox admission.',
      'Read legacy nexora_memberships only as migration input; do not write it at runtime.',
    ],
};

console.log(JSON.stringify(report, null, 2));
