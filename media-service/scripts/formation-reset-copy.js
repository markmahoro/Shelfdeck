'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { assertPeopleImageReclaimAllowed } = require('./people-process-reclaim');
const { initializeResetTarget } = require('./formation-reset-schema');
const { digestResetSnapshot } = require('./formation-reset-snapshot-digest');
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
function fail(code, details) { throw Object.assign(new Error(code), { code, details }); }
function quote(value) {
  if (!IDENTIFIER.test(value)) fail('RESET_COPY_IDENTIFIER_INVALID');
  return '"' + value + '"';
}
function encode(value) {
  return canonicalJson(JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? { sqliteInteger: item.toString() } : item)));
}
function decodeKey(value) {
  return JSON.parse(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) &&
    Object.keys(item).length === 1 && typeof item.sqliteInteger === 'string' ? BigInt(item.sqliteInteger) : item);
}

// Owner exports are explicit seeds plus child edges. FK traversal only follows
// a selected child's dependencies; selecting a Subject never selects all Runs.
// This module is offline Operator infrastructure, not a cross-domain Store.
function retainIntoSnapshot(source, target, policy, schemaTransition) {
  if (!source.readonly || !source.inTransaction) fail('RESET_COPY_SNAPSHOT_REQUIRED');
  assertPeopleImageReclaimAllowed(source);
  const tableRows = source.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const names = tableRows.map(t => t.name);
  const additions = schemaTransition?.addedTables || [];
  if (canonicalJson([...Object.keys(policy.tables)].sort()) !== canonicalJson([...names, ...additions].sort()) ||
      additions.some(name => !['clear','dependent'].includes(policy.tables[name]?.disposition))) fail('RESET_COPY_POLICY_INCOMPLETE');
  const tables = new Map();
  for (const name of [...names,...additions]) {
    const rule = policy.tables[name];
    const empty=additions.includes(name);
    if (rule.regenerate && (!schemaTransition || name !== 'platform_schema_marker' || rule.owner !== 'platform-settings' || rule.disposition !== 'clear'))
      fail('RESET_COPY_REGENERATION_INVALID');
    if (!rule || !['root', 'dependent', 'clear'].includes(rule.disposition) || typeof rule.owner !== 'string' || !rule.owner)
      fail('RESET_COPY_POLICY_INVALID', { table: name });
    const info = (empty?target:source).pragma('table_info(' + quote(name) + ')');
    const appended=schemaTransition?.addedNullableColumns?.[name]||[];
    const targetInfo=appended.length?target.pragma('table_info(' + quote(name) + ')'):info;
    if(appended.some(column=>info.some(c=>c.name===column)||!targetInfo.some(c=>c.name===column&&!c.notnull&&!c.pk&&c.dflt_value===null)))
      fail('RESET_COPY_PROJECTION_INVALID',{table:name});
    const columns = [...info.map(c => c.name),...appended], pk = info.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
    if (!pk.length) fail('RESET_COPY_PRIMARY_KEY_REQUIRED', { table: name });
    const resetColumns = rule.resetColumns || {};
    if (Object.entries(resetColumns).some(([column, value]) => value !== null || !columns.includes(column) ||
        pk.includes(column) || info.find(c => c.name === column).notnull)) fail('RESET_COPY_PROJECTION_INVALID', { table: name });
    const foreign = new Map();
    for (const fk of (empty?target:source).pragma('foreign_key_list(' + quote(name) + ')')) {
      let group = foreign.get(fk.id);
      if (!group) foreign.set(fk.id, group = { target: fk.table, columns: [] });
      group.columns.push({ from: fk.from, to: fk.to, seq: fk.seq });
    }
    tables.set(name, { name, rule, columns, pk, empty, project: row => ({ ...row,
      ...Object.fromEntries(appended.map(column=>[column,null])), ...resetColumns }), foreign: [...foreign.values()] });
  }
  // Keep the traversal queue on disk. Production databases contain multi-GB
  // execution evidence and must not be materialized in the Operator heap.
  target.exec('CREATE TEMP TABLE reset_pending(row_number INTEGER PRIMARY KEY, table_name TEXT NOT NULL, key_json TEXT NOT NULL)');
  const enqueue = target.prepare('INSERT INTO reset_pending(table_name,key_json) VALUES(?,?)');
  for (const table of tables.values()) {
    const predicate = table.pk.map(c => quote(c) + ' IS ?').join(' AND ');
    table.find = target.prepare('SELECT * FROM ' + quote(table.name) + ' WHERE ' + predicate).safeIntegers();
    table.original = table.empty?{get:()=>undefined}:source.prepare('SELECT * FROM ' + quote(table.name) + ' WHERE ' + predicate).safeIntegers();
    table.insert = target.prepare('INSERT INTO ' + quote(table.name) + '(' + table.columns.map(quote).join(',') +
      ') VALUES(' + table.columns.map(() => '?').join(',') + ')');
  }
  function add(name, row) {
    const table = tables.get(name);
    if (!table || !row) fail('RESET_COPY_REFERENCE_MISSING', { table: name });
    if (table.rule.disposition === 'clear') fail('RESET_COPY_PROTECTED_DEPENDENCY_CONFLICT', { table: name });
    row = table.project(row);
    const values = table.pk.map(c => row[c]);
    if (table.find.get(...values)) return;
    table.insert.run(...table.columns.map(c => row[c]));
    enqueue.run(name, encode(values));
  }
  for (const table of tables.values()) {
    if (table.rule.disposition === 'root') {
      for (const row of source.prepare('SELECT * FROM ' + quote(table.name)).safeIntegers().iterate()) add(table.name, row);
    }
  }
  // Owner-selected maintenance roots are exact primary keys, not executable
  // SQL or a rule that expands every process belonging to the same Subject.
  for (const seed of policy.seeds || []) {
    const table = tables.get(seed.table);
    if (!table || seed.owner !== table.rule.owner || !seed.key ||
        canonicalJson(Object.keys(seed.key).sort()) !== canonicalJson([...table.pk].sort()) ||
        Object.values(seed.key).some(value => typeof value !== 'string' && !Number.isSafeInteger(value)))
      fail('RESET_COPY_SEED_INVALID');
    const row = table.original.get(...table.pk.map(column => seed.key[column]));
    if (!row) fail('RESET_COPY_OWNER_SEED_MISSING', { table: seed.table });
    add(seed.table, row);
  }
  const edges = policy.edges || [];
  for (const edge of edges) {
    if (!tables.has(edge.parent) || !tables.has(edge.child) || !Array.isArray(edge.columns) || !edge.columns.length ||
        edge.columns.some(c => !tables.get(edge.parent).columns.includes(c.parent) || !tables.get(edge.child).columns.includes(c.child)) ||
        (edge.required !== undefined && typeof edge.required !== 'boolean') ||
        new Set([...edge.columns.map(c => c.child), ...Object.keys(edge.where || {})]).size !== edge.columns.length + Object.keys(edge.where || {}).length ||
        Object.entries(edge.where || {}).some(([c, value]) => !tables.get(edge.child).columns.includes(c) ||
          !(value === null || typeof value === 'string' || Number.isSafeInteger(value))))
      fail('RESET_COPY_EDGE_INVALID');
    if (edge.owner !== tables.get(edge.child).rule.owner) fail('RESET_COPY_EDGE_OWNER_INVALID');
  }
  const lookups = new Map(), foreignReads = new Map(), childEdges = new Map();
  for (const edge of edges) {
    if (!childEdges.has(edge.parent)) childEdges.set(edge.parent, []);
    childEdges.get(edge.parent).push(edge);
  }
  function lookup(name, columns) {
    const key = canonicalJson([name, columns]);
    if (lookups.has(key)) return lookups.get(key);
    const table = tables.get(name);
    if(table.empty)return function*(){};
    const indexes = [table.pk, ...source.pragma('index_list(' + quote(name) + ')')
      .filter(index => !index.partial).map(index => source.pragma('index_info(' + quote(index.name) + ')').map(c => c.name))];
    const indexed = indexes.some(index => index.length >= columns.length && index.slice(0, columns.length).every(c => columns.includes(c)));
    const predicate = columns.map(column => quote(column) + ' IS ?').join(' AND ');
    let read;
    if (indexed) {
      const statement = source.prepare('SELECT * FROM ' + quote(name) + ' WHERE ' + predicate).safeIntegers();
      read = values => statement.iterate(...values);
    } else {
      // Read-only sources cannot receive indexes. Build a disk-backed key index
      // once in the isolated Operator connection rather than scanning millions
      // of audit rows for every retained Work or Subject. It changes no policy.
      const scratch = 'reset_lookup_' + lookups.size;
      target.exec('CREATE TEMP TABLE ' + quote(scratch) + '(reset_lookup_row INTEGER PRIMARY KEY,' + columns.map(quote).join(',') + ',key_json TEXT NOT NULL)');
      const insert = target.prepare('INSERT INTO ' + quote(scratch) + '(' + [...columns, 'key_json'].map(quote).join(',') +
        ') VALUES(' + [...columns, 'key_json'].map(() => '?').join(',') + ')');
      const selected = [...new Set([...columns, ...table.pk])];
      for (const row of source.prepare('SELECT ' + selected.map(quote).join(',') + ' FROM ' + quote(name)).safeIntegers().iterate())
        insert.run(...columns.map(column => row[column]), encode(table.pk.map(column => row[column])));
      target.exec('CREATE INDEX ' + quote(scratch + '_index') + ' ON ' + quote(scratch) + '(' + columns.map(quote).join(',') + ')');
      const statement = target.prepare('SELECT reset_lookup_row,key_json FROM ' + quote(scratch) + ' WHERE ' + predicate +
        ' AND reset_lookup_row>? ORDER BY reset_lookup_row LIMIT 128');
      read = function* (values) {
        let cursor = 0, batch;
        // End the target SELECT before inserting retained rows on that same
        // connection; a live SQLite iterator forbids those writes.
        while ((batch = statement.all(...values, cursor)).length) {
          for (const row of batch) yield table.original.get(...decodeKey(row.key_json));
          cursor = batch.at(-1).reset_lookup_row;
        }
      };
    }
    lookups.set(key, read); return read;
  }
  const next = target.prepare('SELECT row_number,table_name,key_json FROM reset_pending WHERE row_number>? ORDER BY row_number LIMIT 1');
  let cursor = 0, pending;
  while ((pending = next.get(cursor))) {
    cursor = pending.row_number;
    const table = tables.get(pending.table_name);
    const row = table.find.get(...decodeKey(pending.key_json));
    for (const fk of table.foreign) {
      if (fk.columns.some(c => row[c.from] === null)) continue;
      const parent = tables.get(fk.target);
      if (!parent) fail('RESET_COPY_REFERENCE_MISSING', { table: fk.target });
      const columns = [...fk.columns].sort((a, b) => a.seq - b.seq);
      const where = columns.map((c, i) => quote(c.to || parent.pk[i]) + '=?').join(' AND ');
      const query = 'SELECT * FROM ' + quote(fk.target) + ' WHERE ' + where;
      if (!foreignReads.has(query)) foreignReads.set(query, source.prepare(query).safeIntegers());
      const matches = foreignReads.get(query).all(...columns.map(c => row[c.from]));
      if (matches.length !== 1) fail('RESET_COPY_REFERENCE_MISSING', { table: fk.target });
      add(fk.target, matches[0]);
    }
    for (const edge of childEdges.get(table.name) || []) {
      if (edge.columns.some(c => row[c.parent] === null)) continue;
      const conditions = Object.entries(edge.where || {});
      const parameters = new Map([...edge.columns.map(c => [c.child, row[c.parent]]), ...conditions]);
      const columns = [...parameters.keys()].sort();
      let matched = 0;
      for (const child of lookup(edge.child, columns)(columns.map(column => parameters.get(column)))) {
        matched++;
        add(edge.child, child);
      }
      if (edge.required && matched === 0)
        fail('RESET_COPY_OWNER_REFERENCE_MISSING', { parent: edge.parent, child: edge.child });
    }
  }
  const retained = [...tables.values()].map(t => {
    if(t.empty){
      if(target.prepare('SELECT count(*) n FROM '+quote(t.name)).get().n!==0)fail('RESET_COPY_FACTS_CHANGED',{table:t.name});
      return {table:t.name,owner:t.rule.owner,count:0,sourceCount:0,digest:canonicalDigest([]),resetColumns:{}};
    }
    if (t.rule.regenerate) return { table: t.name, owner: t.rule.owner, count: 1, sourceCount: 1,
      digest: canonicalDigest(target.prepare('SELECT * FROM platform_schema_marker').all()), regenerated: true, resetColumns: {} };
    const copiedHash = crypto.createHash('sha256'), originalHash = crypto.createHash('sha256');
    copiedHash.update('['); originalHash.update('[');
    let count = 0;
    const original = source.prepare('SELECT * FROM ' + quote(t.name) + ' WHERE ' + t.pk.map(c => quote(c) + ' IS ?').join(' AND ')).safeIntegers();
    for (const row of target.prepare('SELECT * FROM ' + quote(t.name) + ' ORDER BY ' + t.pk.map(quote).join(',')).safeIntegers().iterate()) {
      const sourceRow = original.get(...t.pk.map(c => row[c]));
      const before = sourceRow && t.project(sourceRow);
      if (!before || encode(before) !== encode(row)) fail('RESET_COPY_FACTS_CHANGED', { table: t.name });
      if (count++) { copiedHash.update(','); originalHash.update(','); }
      copiedHash.update(encode(row)); originalHash.update(encode(before));
    }
    copiedHash.update(']'); originalHash.update(']');
    const digest = copiedHash.digest('hex');
    if (digest !== originalHash.digest('hex')) fail('RESET_COPY_FACTS_CHANGED', { table: t.name });
    return { table: t.name, owner: t.rule.owner, count, digest, resetColumns: t.rule.resetColumns || {},
      sourceCount: source.prepare('SELECT count(*) n FROM ' + quote(t.name)).get().n };
  });
  target.exec('DROP TABLE reset_pending');
  return { retained, digest: canonicalDigest(retained.map(t => ({ table: t.table, digest: t.digest, count: t.count }))) };
}

function createRetainedDatabase({ Database, sourcePath, targetPath, policy, targetSchema }) {
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(targetPath) ||
      path.resolve(sourcePath) === path.resolve(targetPath) || fs.existsSync(targetPath)) fail('RESET_COPY_TARGET_INVALID');
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  let target;
  try {
    source.pragma('query_only=ON'); source.exec('BEGIN');
    const schema = source.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").all();
    if (schema.some(s => !['table', 'index'].includes(s.type))) fail('RESET_COPY_SCHEMA_UNSUPPORTED');
    // Exclusive creation closes the check/create race; failed copies remain
    // identifiable artifacts and are never substituted for the source.
    fs.closeSync(fs.openSync(targetPath, 'wx', 0o600));
    const schemaTransition = targetSchema ? initializeResetTarget({ Database, targetPath, source, ...targetSchema }) : null;
    target = new Database(targetPath);
    target.pragma('foreign_keys=ON'); target.pragma('synchronous=FULL'); target.pragma('temp_store=FILE');
    target.exec('BEGIN IMMEDIATE'); target.pragma('defer_foreign_keys=ON');
    if (!targetSchema) for (const item of schema) target.exec(item.sql);
    const plan = retainIntoSnapshot(source, target, policy, schemaTransition);
    // The full source commitment is computed in the very same SQLite snapshot
    // as retention, including discarded inputs and unrelated historical rows.
    const sourceSnapshot = digestResetSnapshot(source);
    if (target.pragma('foreign_key_check').length) fail('RESET_COPY_FOREIGN_KEY_FAILED');
    if (target.pragma('integrity_check', { simple: true }) !== 'ok') fail('RESET_COPY_INTEGRITY_FAILED');
    target.exec('COMMIT');
    return { schemaRef: 'formation-reset-copy@1', retainedDigest: plan.digest, schemaTransition, sourceSnapshot,
      tables: plan.retained.map(t => ({ table: t.table, owner: t.owner, before: t.sourceCount, retained: t.count,
        removed: t.sourceCount - t.count, digest: t.digest, resetColumns: t.resetColumns, ...(t.regenerated ? { regenerated: true } : {}) })) };
  } finally {
    if (target?.inTransaction) target.exec('ROLLBACK');
    target?.close();
    if (source.inTransaction) source.exec('ROLLBACK');
    source.close();
  }
}

module.exports = Object.freeze({ createRetainedDatabase });
