'use strict';

const { digest } = require('./ddl-compiler');

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const SCHEMA_NAME = 'shelfdeck';
const GENERATION = 'helix-clean-v1';

class SqliteKernelError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SqliteKernelError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SqliteKernelError(code, message, details);
}

function normalizedDdl(value) {
  return value.replaceAll('\r\n', '\n');
}

function catalogRows(database) {
  return database.prepare(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
  ).all().map((row) => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n', '\n') }));
}

function catalogDigest(database) {
  return digest(catalogRows(database));
}

function expectedCatalog(manifest) {
  const tables = manifest.tables.map((table) => table.tableId);
  const indexes = manifest.tables.flatMap((table) => table.indexes.map((index) => index.name));
  for (const name of [...tables, ...indexes]) {
    if (!IDENTIFIER.test(name)) fail('P3_SQLITE_INVALID_MANIFEST_IDENTIFIER', 'Schema manifest contains an invalid identifier.', { name });
  }
  return { tables: new Set(tables), indexes: new Set(indexes) };
}

function assertManifest(manifest, ddl) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.compilerContract !== 'helix-p3-deterministic-sqlite-ddl/v1' ||
      manifest.tableCount !== 177 || !Array.isArray(manifest.tables) || manifest.tables.length !== 177) {
    fail('P3_SQLITE_INVALID_SCHEMA_MANIFEST', 'The clean schema manifest is incomplete or unsupported.');
  }
  if (manifest.digestAlgorithm !== 'sha256' || digest(normalizedDdl(ddl)) !== manifest.ddlDigest) {
    fail('P3_SQLITE_DDL_DIGEST_MISMATCH', 'DDL bytes do not match the signed clean schema manifest.');
  }
  return expectedCatalog(manifest);
}

function assertPragmas(database) {
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('busy_timeout = 5000');
  const foreignKeys = database.pragma('foreign_keys', { simple: true });
  const journalMode = database.pragma('journal_mode', { simple: true });
  if (foreignKeys !== 1) fail('P3_SQLITE_FOREIGN_KEYS_DISABLED', 'PRAGMA foreign_keys=ON is a writable startup gate.');
  if (String(journalMode).toLowerCase() !== 'wal') fail('P3_SQLITE_WAL_REQUIRED', 'Clean writable storage requires WAL mode.', { journalMode });
}

function initialize(database, ddl, manifest, now) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const commitTimeMs = now();
    if (!Number.isSafeInteger(commitTimeMs) || commitTimeMs < 0) fail('P3_SQLITE_INVALID_COMMIT_TIME', 'Commit time must be a non-negative safe UTC epoch millisecond.');
    database.exec(normalizedDdl(ddl));
    const currentCatalogDigest = catalogDigest(database);
    database.prepare(
      'INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)'
    ).run(SCHEMA_NAME, GENERATION, manifest.ddlDigest, currentCatalogDigest, commitTimeMs);
    database.exec('COMMIT');
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

function marker(database) {
  const rows = database.prepare(
    'SELECT schema_name,generation,schema_digest,catalog_digest,applied_at_ms FROM platform_schema_marker'
  ).all();
  if (rows.length !== 1 || rows[0].schema_name !== SCHEMA_NAME) {
    fail('P3_SQLITE_SCHEMA_MARKER_INVALID', 'Exactly one clean ShelfDeck schema marker is required.', { markerCount: rows.length });
  }
  return rows[0];
}

function assertCatalog(database, manifest, expected) {
  const rows = catalogRows(database);
  const tables = new Set(rows.filter((row) => row.type === 'table').map((row) => row.name));
  const indexes = new Set(rows.filter((row) => row.type === 'index').map((row) => row.name));
  const forbidden = rows.filter((row) => !['table', 'index'].includes(row.type));
  const missingTables = [...expected.tables].filter((name) => !tables.has(name));
  const extraTables = [...tables].filter((name) => !expected.tables.has(name));
  const missingIndexes = [...expected.indexes].filter((name) => !indexes.has(name));
  const extraIndexes = [...indexes].filter((name) => !expected.indexes.has(name));
  if (forbidden.length || missingTables.length || extraTables.length || missingIndexes.length || extraIndexes.length) {
    fail('P3_SQLITE_CATALOG_SHAPE_MISMATCH', 'SQLite catalog differs from the clean generated schema.', {
      forbidden: forbidden.map((row) => row.name), missingTables, extraTables, missingIndexes, extraIndexes
    });
  }
  const partialExpected = manifest.tables.flatMap((table) => table.indexes
    .filter((index) => index.kind === 'partial-unique').map((index) => ({ tableId: table.tableId, name: index.name })));
  for (const item of partialExpected) {
    const index = database.pragma('index_list(' + item.tableId + ')').find((row) => row.name === item.name);
    if (!index || index.unique !== 1 || index.partial !== 1) {
      fail('P3_SQLITE_PARTIAL_UNIQUE_MISSING', 'A required partial unique index is absent or weakened.', item);
    }
  }
  if (partialExpected.length !== 21) fail('P3_SQLITE_PARTIAL_UNIQUE_COUNT', 'The clean schema requires exactly 21 partial unique indexes.');
}

function assertGuardConsistency(database) {
  const checks = [
    {
      name: 'arca-active-inventory-material',
      sql: "SELECT COUNT(*) count FROM arca_inventory_materials m LEFT JOIN arca_shelf_entries e ON e.shelf_entry_id=m.shelf_entry_id WHERE m.active_guard <> CASE WHEN m.role='primary' AND e.status='active' AND e.current_inventory_revision=m.inventory_revision THEN 1 ELSE 0 END"
    },
    {
      name: 'people-active-provider-identity',
      sql: "SELECT COUNT(*) count FROM people_provider_identities i LEFT JOIN people_persons p ON p.person_id=i.person_id WHERE i.active_guard <> CASE WHEN p.status='active' AND p.current_revision=i.revision THEN 1 ELSE 0 END"
    }
  ];
  for (const check of checks) {
    const count = database.prepare(check.sql).get().count;
    if (count !== 0) fail('P3_SQLITE_GUARD_PROJECTION_DRIFT', 'A cross-table uniqueness guard is inconsistent.', { check: check.name, count });
  }
}

function assertMessageConsistency(database) {
  const messages = database.prepare(
    'SELECT message_id,consumer_set_digest,intended_consumer_count,payload_json,payload_digest,state,all_acked_at_ms FROM fx_outbox'
  ).all();
  const deliveryStatement = database.prepare(
    'SELECT consumer_domain,state FROM fx_outbox_deliveries WHERE message_id=? ORDER BY consumer_domain'
  );
  for (const message of messages) {
    const deliveries = deliveryStatement.all(message.message_id);
    const consumers = deliveries.map((delivery) => delivery.consumer_domain);
    let payload;
    try {
      payload = JSON.parse(message.payload_json);
    } catch (error) {
      fail('P3_SQLITE_OUTBOX_PAYLOAD_DRIFT', 'Outbox payload is not valid JSON.', { messageId: message.message_id });
    }
    const canonicalPayload = JSON.stringify(payload, Object.keys(payload).sort());
    const allAcked = deliveries.length > 0 && deliveries.every((delivery) => delivery.state === 'acked');
    if (deliveries.length !== message.intended_consumer_count ||
        digest(JSON.stringify(consumers)) !== message.consumer_set_digest ||
        digest(canonicalPayload) !== message.payload_digest ||
        (message.state === 'fully_acked') !== allAcked ||
        (message.state === 'fully_acked') !== (message.all_acked_at_ms !== null)) {
      fail('P3_SQLITE_OUTBOX_CONSISTENCY_DRIFT', 'Outbox payload, frozen consumer set, or ack projection is inconsistent.', {
        messageId: message.message_id
      });
    }
  }
  const ackWithoutInbox = database.prepare(
    "SELECT COUNT(*) count FROM fx_outbox_deliveries d LEFT JOIN fx_inbox i ON i.consumer_domain=d.consumer_domain AND i.message_id=d.message_id WHERE d.state='acked' AND i.message_id IS NULL"
  ).get().count;
  if (ackWithoutInbox !== 0) fail('P3_SQLITE_ACK_WITHOUT_INBOX', 'Acknowledged Delivery lacks durable Inbox consumption.', { count: ackWithoutInbox });
}

function assertMaterialControlConsistency(database) {
  const controls = database.prepare(
    'SELECT material_key,mount_scope_id,inode,content_hash_algorithm,content_hash,owner_domain,owner_scope_type,owner_scope_id,control_revision,state FROM fx_material_controls'
  ).all();
  const revisionsStatement = database.prepare(
    'SELECT revision,operation_kind,to_owner_domain,to_scope_type,to_scope_id FROM fx_material_control_revisions WHERE material_key=? ORDER BY revision'
  );
  for (const control of controls) {
    const identity = {
      schema: 'physical-material-identity@1',
      mountScopeId: control.mount_scope_id,
      inode: control.inode,
      contentHashAlgorithm: control.content_hash_algorithm,
      contentHash: control.content_hash
    };
    const identityJson = JSON.stringify(identity, Object.keys(identity).sort());
    const revisions = revisionsStatement.all(control.material_key);
    const latest = revisions[revisions.length - 1];
    const sequenceValid = revisions.length === control.control_revision &&
      revisions.every((revision, index) => revision.revision === index + 1);
    const targetValid = control.state === 'controlled'
      ? latest && latest.to_owner_domain === control.owner_domain && latest.to_scope_type === control.owner_scope_type && latest.to_scope_id === control.owner_scope_id
      : latest && latest.operation_kind === 'release' && control.owner_domain === null && control.owner_scope_type === null && control.owner_scope_id === null;
    if (control.content_hash_algorithm !== 'sha256' || digest(identityJson) !== control.material_key || !sequenceValid || !targetValid) {
      fail('P3_SQLITE_MATERIAL_CONTROL_DRIFT', 'Current Material Control and append-only revision history are inconsistent.', {
        materialKey: control.material_key
      });
    }
  }
}

function assertIntegrity(database, manifest, expected) {
  const currentMarker = marker(database);
  if (currentMarker.generation !== GENERATION || currentMarker.schema_digest !== manifest.ddlDigest) {
    fail('P3_SQLITE_SCHEMA_GENERATION_MISMATCH', 'Schema generation or DDL digest does not match the clean runtime.', {
      generation: currentMarker.generation, schemaDigest: currentMarker.schema_digest
    });
  }
  assertCatalog(database, manifest, expected);
  const currentCatalogDigest = catalogDigest(database);
  if (currentMarker.catalog_digest !== currentCatalogDigest) {
    fail('P3_SQLITE_CATALOG_DIGEST_MISMATCH', 'Stored and actual SQLite catalog digests differ.');
  }
  const foreignKeyFindings = database.pragma('foreign_key_check');
  if (foreignKeyFindings.length > 0) fail('P3_SQLITE_FOREIGN_KEY_CHECK_FAILED', 'foreign_key_check found invalid rows.', { findings: foreignKeyFindings });
  const integrity = database.pragma('integrity_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    fail('P3_SQLITE_INTEGRITY_CHECK_FAILED', 'SQLite integrity_check failed.', { findings: integrity });
  }
  assertGuardConsistency(database);
  assertMessageConsistency(database);
  assertMaterialControlConsistency(database);
  return Object.freeze({
    generation: currentMarker.generation,
    schemaDigest: currentMarker.schema_digest,
    catalogDigest: currentMarker.catalog_digest,
    tableCount: expected.tables.size,
    indexCount: expected.indexes.size,
    partialUniqueCount: 21,
    appliedAtMs: currentMarker.applied_at_ms
  });
}

function openSqliteKernel(options) {
  if (!options || typeof options.Database !== 'function' || typeof options.databasePath !== 'string' ||
      typeof options.schemaDdl !== 'string' || !options.schemaManifest) {
    fail('P3_SQLITE_INVALID_OPEN_OPTIONS', 'Database driver, path, DDL, and manifest are required.');
  }
  const now = options.now || Date.now;
  const expected = assertManifest(options.schemaManifest, options.schemaDdl);
  let database;
  try {
    database = new options.Database(options.databasePath);
    assertPragmas(database);
    const existing = catalogRows(database);
    if (existing.length === 0) initialize(database, options.schemaDdl, options.schemaManifest, now);
    else if (!existing.some((row) => row.type === 'table' && row.name === 'platform_schema_marker')) {
      fail('P3_SQLITE_MIXED_OR_LEGACY_SCHEMA', 'A non-empty database without the clean schema marker cannot be opened writable.');
    }
    const generation = assertIntegrity(database, options.schemaManifest, expected);
    let closed = false;
    let transactionActive = false;
    const ensureOpen = () => {
      if (closed) fail('P3_SQLITE_KERNEL_CLOSED', 'SQLite Kernel is closed.');
    };
    return Object.freeze({
      generation,
      diagnostics() {
        ensureOpen();
        return Object.freeze({
          foreignKeys: database.pragma('foreign_keys', { simple: true }),
          journalMode: database.pragma('journal_mode', { simple: true }),
          synchronous: database.pragma('synchronous', { simple: true }),
          busyTimeout: database.pragma('busy_timeout', { simple: true })
        });
      },
      runPrimitive(operation) {
        ensureOpen();
        if (typeof operation !== 'function') fail('P3_SQLITE_INVALID_TRANSACTION_BODY', 'Transaction body must be a function.');
        if (transactionActive) fail('P3_SQLITE_NESTED_TRANSACTION', 'Nested SQLite Kernel transactions are forbidden.');
        transactionActive = true;
        database.exec('BEGIN IMMEDIATE');
        // Several clean aggregate roots have mutually dependent current-head
        // pointers and revision rows. SQLite's transaction-scoped deferral
        // preserves every declared FK at COMMIT while allowing the complete
        // aggregate to be inserted atomically.
        database.pragma('defer_foreign_keys = ON');
        try {
          const commitTimeMs = now();
          if (!Number.isSafeInteger(commitTimeMs) || commitTimeMs < 0) fail('P3_SQLITE_INVALID_COMMIT_TIME', 'Commit time must be a non-negative safe UTC epoch millisecond.');
          const result = operation(Object.freeze({
            commitTimeMs,
            prepare(statement) {
              if (typeof statement !== 'string' || statement.length === 0) fail('P3_SQLITE_INVALID_STATEMENT', 'A non-empty SQL statement is required.');
              return database.prepare(statement);
            }
          }));
          database.exec('COMMIT');
          return result;
        } catch (error) {
          if (database.inTransaction) database.exec('ROLLBACK');
          throw error;
        } finally {
          transactionActive = false;
        }
      },
      close() {
        if (closed) return;
        if (transactionActive) fail('P3_SQLITE_CLOSE_DURING_TRANSACTION', 'Cannot close SQLite Kernel during a transaction.');
        database.close();
        database = null;
        closed = true;
      }
    });
  } catch (error) {
    if (database && database.open) database.close();
    throw error;
  }
}

module.exports = Object.freeze({ GENERATION, SCHEMA_NAME, SqliteKernelError, openSqliteKernel });
