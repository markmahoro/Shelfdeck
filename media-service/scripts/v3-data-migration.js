'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dataDirArg = [...args].find((arg) => arg.startsWith('--data-dir='));
const dataDir = path.resolve(
  dataDirArg ? dataDirArg.slice('--data-dir='.length) : (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  ),
);

function fileInfo(name) {
  const filePath = path.join(dataDir, name);
  if (!fs.existsSync(filePath)) return { name, path: filePath, exists: false, sizeBytes: 0 };
  return { name, path: filePath, exists: true, sizeBytes: fs.statSync(filePath).size };
}

function tableColumns(dbPath, tableName) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
  } finally {
    db.close();
  }
}

function countRows(dbPath, tableName) {
  if (!fs.existsSync(dbPath)) return 0;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    if (!exists) return 0;
    return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count || 0;
  } finally {
    db.close();
  }
}

function backupFile(filePath, stamp) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.v2-backup-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function missingColumns(actual, expected) {
  const set = new Set(actual);
  return expected.filter((name) => !set.has(name));
}

const expectedLibraryColumns = [
  'lifecycle_stage',
  'lifecycle_done',
  'lifecycle_next_task',
  'lifecycle_reason',
  'metadata_status',
  'metadata_kind',
  'metadata_complete',
  'metadata_missing_reasons_json',
  'metadata_updated_at',
  'optimization_status',
  'optimization_action',
  'optimization_done_at',
  'optimization_task_id',
  'archive_status',
  'archive_reason',
  'archive_done_at',
];

const expectedTaskColumns = [
  'source',
  'progress',
  'phase',
  'resume_point',
  'manual_execute_requested',
  'priority_manually_adjusted',
  'priority_model_version',
  'retry_count',
  'pausing_requested',
  'node_id',
  'sub_library_id',
  'item_path',
  'bridge_kind',
  'bridge_from',
  'bridge_to',
  'bridge_reason',
  'flow_version',
  'flow_direction',
  'operation_kind',
  'flow_executor',
  'primary_resource_type',
  'resource_types_json',
  'flow_steps_json',
];

const expectedEventColumns = [
  'resource_key',
  'resource_label',
  'bridge_kind',
  'flow_direction',
  'operation_kind',
];

function buildPlan() {
  const libraryDb = path.join(dataDir, 'library.db');
  const tasksDb = path.join(dataDir, 'tasks.db');
  return {
    mode: apply ? 'apply' : 'dry-run',
    dataDir,
    files: [
      fileInfo('library.json'),
      fileInfo('library.db'),
      fileInfo('tasks.json'),
      fileInfo('tasks.db'),
    ],
    library: {
      rows: countRows(libraryDb, 'media_items'),
      missingColumns: missingColumns(tableColumns(libraryDb, 'media_items'), expectedLibraryColumns),
    },
    tasks: {
      rows: countRows(tasksDb, 'tasks'),
      missingColumns: missingColumns(tableColumns(tasksDb, 'tasks'), expectedTaskColumns),
    },
    events: {
      rows: countRows(tasksDb, 'task_events'),
      missingColumns: missingColumns(tableColumns(tasksDb, 'task_events'), expectedEventColumns),
    },
    actions: apply
      ? [
        'Back up existing library/tasks JSON and SQLite files.',
        'Open ShelfDeck stores to run JSON compatibility import, DDL, and v3 fact backfill.',
        'Leave original JSON files in place as source records.',
      ]
      : [
        'No files will be changed.',
        'Run again with --apply only after this plan is reviewed.',
      ],
  };
}

function runApply(plan) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backups = [];
  for (const file of plan.files) {
    const backup = backupFile(file.path, stamp);
    if (backup) backups.push(backup);
  }
  process.env.CONTROL_PLANE_DATA_DIR = dataDir;
  process.env.MEDIA_SERVICE_DATA_DIR = dataDir;
  const libraryStore = require('../src/libraryStore');
  const taskStore = require('../src/taskStore');
  const library = libraryStore.loadLibrary();
  const tasks = taskStore.getTasks();
  return {
    ...buildPlan(),
    applied: true,
    backups,
    imported: {
      mediaItems: library.items.length,
      tasks: tasks.length,
    },
  };
}

const plan = buildPlan();
const result = apply ? runApply(plan) : plan;
console.log(JSON.stringify(result, null, 2));
