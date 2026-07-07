'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const diagnosticLog = require('./diagnosticLog');
const v3Model = require('./v3Model');
const metadataStatus = require('./metadataStatus');
const userPerceptionManagement = require('./userPerceptionManagement');

function resolveDataDir() {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  );
}

function libraryJsonFilePath() {
  return path.join(resolveDataDir(), 'library.json');
}

function libraryDbFilePath() {
  return path.join(resolveDataDir(), 'library.db');
}

function migrationMarkerPath() {
  return path.join(resolveDataDir(), 'library.json.migrated');
}

function ensureDataDir() {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const dbCache = new Map();
const DEFAULT_WAL_CHECKPOINT_MIN_BYTES = 64 * 1024 * 1024;

function jsonStringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function jsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function getDb() {
  ensureDataDir();
  const dbPath = libraryDbFilePath();
  let db = dbCache.get(dbPath);
  if (db) return db;

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_items (
      item_id TEXT PRIMARY KEY,
      ordinal INTEGER NOT NULL DEFAULT 0,
      sub_library_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      watched INTEGER NOT NULL DEFAULT 0,
      scraped INTEGER NOT NULL DEFAULT 0,
      scrape_status TEXT NOT NULL DEFAULT '',
      adult_id TEXT NOT NULL DEFAULT '',
      resolution TEXT NOT NULL DEFAULT '',
      codec TEXT NOT NULL DEFAULT '',
      user_rating REAL,
      douban_stars REAL,
      is_bluray_disc INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_items_ordinal ON media_items(ordinal);
    CREATE INDEX IF NOT EXISTS idx_media_items_sub_library ON media_items(sub_library_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source, ordinal);
    CREATE INDEX IF NOT EXISTS idx_media_items_action ON media_items(action, ordinal);
    CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type, ordinal);
    CREATE INDEX IF NOT EXISTS idx_media_items_updated_at ON media_items(updated_at);
    CREATE INDEX IF NOT EXISTS idx_media_items_scrape_status ON media_items(source, scraped, scrape_status);
  `);
  ensureSpaceStatColumns(db);
  ensureV3MediaItemColumns(db);
  dbCache.set(dbPath, db);
  migrateJsonLibraryIfNeeded(db);
  backfillSpaceStatColumns(db);
  backfillV3MediaItemColumns(db);
  backfillKairoxMetadataGateFields(db);
  checkpointWal(db, 'startup');
  return db;
}

function ensureSpaceStatColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(media_items)').all().map((row) => row.name));
  const columns = {
    size_bytes: 'REAL',
    bitrate: 'REAL',
    equivalent_bitrate: 'REAL',
    target_bitrate: 'REAL',
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE media_items ADD COLUMN ${name} ${type}`);
  }
}

function ensureV3MediaItemColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(media_items)').all().map((row) => row.name));
  const columns = {
    lifecycle_stage: 'TEXT NOT NULL DEFAULT \'\'',
    lifecycle_done: 'INTEGER NOT NULL DEFAULT 0',
    lifecycle_next_task: 'TEXT NOT NULL DEFAULT \'\'',
    lifecycle_reason: 'TEXT NOT NULL DEFAULT \'\'',
    metadata_status: 'TEXT NOT NULL DEFAULT \'\'',
    metadata_kind: 'TEXT NOT NULL DEFAULT \'\'',
    metadata_complete: 'INTEGER NOT NULL DEFAULT 0',
    metadata_missing_reasons_json: 'TEXT NOT NULL DEFAULT \'[]\'',
    metadata_updated_at: 'TEXT NOT NULL DEFAULT \'\'',
    optimization_status: 'TEXT NOT NULL DEFAULT \'none\'',
    optimization_action: 'TEXT NOT NULL DEFAULT \'\'',
    optimization_done_at: 'TEXT NOT NULL DEFAULT \'\'',
    optimization_task_id: 'TEXT NOT NULL DEFAULT \'\'',
    archive_status: 'TEXT NOT NULL DEFAULT \'\'',
    archive_reason: 'TEXT NOT NULL DEFAULT \'\'',
    archive_done_at: 'TEXT NOT NULL DEFAULT \'\'',
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE media_items ADD COLUMN ${name} ${type}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_items_lifecycle ON media_items(lifecycle_stage, lifecycle_done, ordinal);
    CREATE INDEX IF NOT EXISTS idx_media_items_metadata ON media_items(metadata_status, metadata_complete, ordinal);
    CREATE INDEX IF NOT EXISTS idx_media_items_optimization ON media_items(optimization_status, optimization_action, ordinal);
    CREATE INDEX IF NOT EXISTS idx_media_items_archive ON media_items(archive_status, ordinal);
  `);
}

function backfillSpaceStatColumns(db) {
  const version = db.prepare('SELECT value FROM library_meta WHERE key = ?').get('space_stat_columns_backfilled');
  if (version && version.value === '1') return;
  db.prepare(`
    UPDATE media_items
    SET
      size_bytes = json_extract(payload_json, '$.size'),
      bitrate = json_extract(payload_json, '$.bitrate'),
      equivalent_bitrate = json_extract(payload_json, '$.equivalentBitrate'),
      target_bitrate = json_extract(payload_json, '$.targetBitrate')
  `).run();
  setMeta(db, 'space_stat_columns_backfilled', '1');
}

function backfillV3MediaItemColumns(db) {
  const version = db.prepare('SELECT value FROM library_meta WHERE key = ?').get('v3_media_item_columns_backfilled');
  if (version && version.value === '1') return;
  const rows = db.prepare('SELECT item_id, payload_json FROM media_items').all();
  const update = db.prepare(`
    UPDATE media_items SET
      lifecycle_stage = @lifecycle_stage,
      lifecycle_done = @lifecycle_done,
      lifecycle_next_task = @lifecycle_next_task,
      lifecycle_reason = @lifecycle_reason,
      metadata_status = @metadata_status,
      metadata_kind = @metadata_kind,
      metadata_complete = @metadata_complete,
      metadata_missing_reasons_json = @metadata_missing_reasons_json,
      metadata_updated_at = @metadata_updated_at,
      optimization_status = @optimization_status,
      optimization_action = @optimization_action,
      optimization_done_at = @optimization_done_at,
      optimization_task_id = @optimization_task_id,
      archive_status = @archive_status,
      archive_reason = @archive_reason,
      archive_done_at = @archive_done_at
    WHERE item_id = @item_id
  `);
  const tx = db.transaction((items) => {
    for (const row of items) {
      const item = normalizeItem(jsonParse(row.payload_json, {}));
      update.run({ item_id: row.item_id, ...v3Model.mediaItemFacts(item) });
    }
  });
  tx(rows);
  setMeta(db, 'v3_media_item_columns_backfilled', '1');
}

function backfillKairoxMetadataGateFields(db) {
  const version = db.prepare('SELECT value FROM library_meta WHERE key = ?').get('kairox_metadata_gate_fields_backfilled_v1');
  if (version && version.value === '1') return;
  const rows = db.prepare(`
    SELECT
      item_id,
      payload_json,
      metadata_status,
      metadata_complete,
      metadata_missing_reasons_json
    FROM media_items
    WHERE metadata_missing_reasons_json LIKE '%decision.%'
  `).all();
  if (rows.length > 0) {
    const update = db.prepare(`
      UPDATE media_items SET
        metadata_status = @metadata_status,
        metadata_kind = @metadata_kind,
        metadata_complete = @metadata_complete,
        metadata_missing_reasons_json = @metadata_missing_reasons_json,
        metadata_updated_at = @metadata_updated_at
      WHERE item_id = @item_id
    `);
    const tx = db.transaction((items) => {
      for (const row of items) {
        const item = normalizeItem(jsonParse(row.payload_json, {}));
        item.metadataStatus = row.metadata_status || item.metadataStatus;
        item.metadataComplete = row.metadata_complete === 1;
        item.metadataMissingReasons = jsonParse(row.metadata_missing_reasons_json, []);
        const facts = v3Model.mediaItemFacts(item);
        update.run({ item_id: row.item_id, ...facts });
      }
    });
    tx(rows);
  }
  setMeta(db, 'kairox_metadata_gate_fields_backfilled_v1', '1');
}

function walCheckpointMinBytes() {
  const value = Number(process.env.SHELFDECK_LIBRARY_WAL_CHECKPOINT_MIN_BYTES);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_WAL_CHECKPOINT_MIN_BYTES;
}

function checkpointWal(db, reason, opts = {}) {
  const before = getStorageMetrics();
  const startedAtMs = Date.now();
  const minWalSizeBytes = Number(opts.minWalSizeBytes) >= 0
    ? Number(opts.minWalSizeBytes)
    : walCheckpointMinBytes();
  const force = opts.force === true;
  const shouldRun = force || before.walSizeBytes >= minWalSizeBytes;
  if (!shouldRun) {
    const endedAtMs = Date.now();
    diagnosticLog.record({
      category: 'storage',
      scope: 'libraryStore.checkpointWal',
      operation: 'wal_checkpoint',
      component: 'libraryStore',
      resourceType: 'sqlite',
      resourceKey: 'library.db-wal',
      status: 'skipped',
      startedAtMs,
      endedAtMs,
      slowMs: 250,
      payload: {
        reason,
        trigger: 'wal_below_threshold',
        minWalSizeBytes,
        before,
      },
    });
    return { skipped: true, reason: 'wal_below_threshold', before, minWalSizeBytes };
  }
  if (!force) {
    const endedAtMs = Date.now();
    diagnosticLog.record({
      category: 'storage',
      scope: 'libraryStore.checkpointWal',
      operation: 'wal_checkpoint',
      component: 'libraryStore',
      resourceType: 'sqlite',
      resourceKey: 'library.db-wal',
      status: 'skipped',
      startedAtMs,
      endedAtMs,
      slowMs: 250,
      payload: {
        reason,
        trigger: 'routine_checkpoint_deferred',
        minWalSizeBytes,
        before,
      },
    });
    return { skipped: true, reason: 'routine_checkpoint_deferred', before, minWalSizeBytes };
  }
  try {
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    const endedAtMs = Date.now();
    const after = getStorageMetrics();
    diagnosticLog.record({
      category: 'storage',
      scope: 'libraryStore.checkpointWal',
      operation: 'wal_checkpoint',
      component: 'libraryStore',
      resourceType: 'sqlite',
      resourceKey: 'library.db-wal',
      startedAtMs,
      endedAtMs,
      slowMs: 250,
      payload: {
        reason,
        trigger: force ? 'forced' : 'wal_size_threshold',
        minWalSizeBytes,
        before,
        after,
        result,
      },
    });
    return result;
  } catch (err) {
    const endedAtMs = Date.now();
    diagnosticLog.record({
      category: 'storage',
      scope: 'libraryStore.checkpointWal',
      operation: 'wal_checkpoint',
      component: 'libraryStore',
      resourceType: 'sqlite',
      resourceKey: 'library.db-wal',
      status: 'failed',
      startedAtMs,
      endedAtMs,
      payload: { reason, before, error: err.message },
    });
    console.warn(`[libraryStore] WAL checkpoint skipped${reason ? ` (${reason})` : ''}: ${err.message}`);
    return null;
  }
}

function getStorageMetrics() {
  return diagnosticLog.storageSnapshot({
    store: 'library',
    dbName: 'library.db',
    resourceKey: 'library.db',
    dbPath: libraryDbFilePath(),
  });
}

function normalizePayloadFieldNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function payloadBucketFromRows(rows, totalPayloadBytes) {
  return rows.map((row) => {
    const payloadBytes = normalizePayloadFieldNumber(row.payloadBytes);
    const itemCount = normalizePayloadFieldNumber(row.itemCount);
    const key = String(row.key || 'unknown');
    return {
      key,
      itemCount,
      payloadBytes,
      payloadBytesAverage: itemCount > 0 ? Math.round(payloadBytes / itemCount) : 0,
      payloadBytesSharePercent: totalPayloadBytes > 0
        ? Number(((payloadBytes / totalPayloadBytes) * 100).toFixed(2))
        : 0,
    };
  });
}

function getLibraryPayloadHealthSummary(options = {}) {
  const includeBuckets = options.includeBuckets !== false;
  const includeFieldBreakdown = options.includeFieldBreakdown !== false;
  const includeAdultCache = options.includeAdultCache !== false;
  const adultSubLibraryIds = Array.isArray(options.adultSubLibraryIds)
    ? [...new Set(options.adultSubLibraryIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];
  const db = getDb();
  const storage = getStorageMetrics();

  const total = db.prepare(`
    SELECT
      COUNT(*) AS mediaItemCount,
      IFNULL(SUM(length(payload_json)), 0) AS payloadBytesTotal,
      IFNULL(AVG(length(payload_json)), 0) AS payloadBytesAverage,
      IFNULL(MAX(length(payload_json)), 0) AS payloadBytesMax,
      IFNULL(MIN(length(payload_json)), 0) AS payloadBytesMin
    FROM media_items
  `).get() || {};

  const mediaItemCount = normalizePayloadFieldNumber(total.mediaItemCount);
  const payloadBytesTotal = normalizePayloadFieldNumber(total.payloadBytesTotal);
  const payloadBytesAverage = normalizePayloadFieldNumber(total.payloadBytesAverage);
  const payloadBytesMax = normalizePayloadFieldNumber(total.payloadBytesMax);
  const payloadBytesMin = normalizePayloadFieldNumber(total.payloadBytesMin);

  const bySubLibrary = includeBuckets
    ? payloadBucketFromRows(db.prepare(`
      SELECT
        COALESCE(NULLIF(sub_library_id, ''), 'unknown') AS key,
        COUNT(*) AS itemCount,
        IFNULL(SUM(length(payload_json)), 0) AS payloadBytes
      FROM media_items
      GROUP BY COALESCE(NULLIF(sub_library_id, ''), 'unknown')
      ORDER BY payloadBytes DESC
    `).all(), payloadBytesTotal)
    : [];

  const bySource = includeBuckets
    ? payloadBucketFromRows(db.prepare(`
      SELECT
        COALESCE(NULLIF(source, ''), 'unknown') AS key,
        COUNT(*) AS itemCount,
        IFNULL(SUM(length(payload_json)), 0) AS payloadBytes
      FROM media_items
      GROUP BY COALESCE(NULLIF(source, ''), 'unknown')
      ORDER BY payloadBytes DESC
    `).all(), payloadBytesTotal)
    : [];

  const byType = includeBuckets
    ? payloadBucketFromRows(db.prepare(`
      SELECT
        COALESCE(NULLIF(type, ''), 'unknown') AS key,
        COUNT(*) AS itemCount,
        IFNULL(SUM(length(payload_json)), 0) AS payloadBytes
      FROM media_items
      GROUP BY COALESCE(NULLIF(type, ''), 'unknown')
      ORDER BY payloadBytes DESC
    `).all(), payloadBytesTotal)
    : [];

  const maxPayloadRow = includeFieldBreakdown
    ? db.prepare(`
      SELECT
        COALESCE(NULLIF(source, ''), 'unknown') AS source,
        COALESCE(NULLIF(sub_library_id, ''), 'unknown') AS subLibraryId,
        COALESCE(NULLIF(type, ''), 'unknown') AS type,
        IFNULL(length(payload_json), 0) AS payloadBytes,
        IFNULL(length(json_extract(payload_json, '$.adultMetadata.faceClusters')), 0) AS faceClustersBytes,
        IFNULL(length(json_extract(payload_json, '$.adultMetadata.unknownFaces')), 0) AS unknownFacesBytes,
        IFNULL(length(json_extract(payload_json, '$.adultMetadata.galleryImages')), 0) AS galleryImagesBytes,
        IFNULL(length(json_extract(payload_json, '$.adultMetadata.embedding')), 0) AS embeddingBytes,
        IFNULL(length(json_extract(payload_json, '$.adultMetadata.sampleImageBase64')), 0) AS sampleImageBase64Bytes
      FROM media_items
      ORDER BY payloadBytes DESC
      LIMIT 1
    `).get() || null
    : null;

  const maxPayloadFieldBreakdown = maxPayloadRow ? [
    { field: 'adultMetadata.faceClusters', bytes: normalizePayloadFieldNumber(maxPayloadRow.faceClustersBytes) },
    { field: 'adultMetadata.unknownFaces', bytes: normalizePayloadFieldNumber(maxPayloadRow.unknownFacesBytes) },
    { field: 'adultMetadata.galleryImages', bytes: normalizePayloadFieldNumber(maxPayloadRow.galleryImagesBytes) },
    { field: 'adultMetadata.embedding', bytes: normalizePayloadFieldNumber(maxPayloadRow.embeddingBytes) },
    { field: 'adultMetadata.sampleImageBase64', bytes: normalizePayloadFieldNumber(maxPayloadRow.sampleImageBase64Bytes) },
  ].filter((item) => item.bytes > 0).sort((a, b) => b.bytes - a.bytes) : [];

  const maxPayload = maxPayloadRow
    ? {
      payloadBytes: normalizePayloadFieldNumber(maxPayloadRow.payloadBytes),
      source: String(maxPayloadRow.source || ''),
      subLibraryId: String(maxPayloadRow.subLibraryId || ''),
      type: String(maxPayloadRow.type || ''),
      fieldBreakdown: maxPayloadFieldBreakdown,
    }
    : {
      payloadBytes: 0,
      source: '',
      subLibraryId: '',
      type: '',
      fieldBreakdown: [],
    };

  let adultCache = null;
  if (includeAdultCache && adultSubLibraryIds.length > 0) {
    const placeholders = adultSubLibraryIds.map(() => '?').join(', ');
    adultCache = db.prepare(`
      SELECT
        COUNT(*) AS totalAdultItems,
        SUM(CASE WHEN json_type(payload_json, '$.adultMetadata') IS NOT NULL THEN 1 ELSE 0 END) AS cachedAdultItems,
        SUM(CASE WHEN json_type(payload_json, '$.adultMetadata') IS NULL THEN 1 ELSE 0 END) AS missingAdultMetadataItems,
        SUM(CASE
          WHEN json_type(payload_json, '$.adultMetadata') IS NOT NULL
            AND (
              TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.adultId'), '')) = ''
              OR TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.region'), '')) = ''
              OR TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.scrapeStatus'), '')) = ''
            )
          THEN 1 ELSE 0 END) AS incompleteAdultMetadataItems,
        SUM(CASE WHEN TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.adultId'), '')) = '' THEN 1 ELSE 0 END) AS missingAdultMetadataAdultIdItems,
        SUM(CASE WHEN TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.region'), '')) = '' THEN 1 ELSE 0 END) AS missingAdultMetadataRegionItems,
        SUM(CASE WHEN TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.scrapeStatus'), '')) = '' THEN 1 ELSE 0 END) AS missingAdultMetadataScrapeStatusItems
      FROM media_items
      WHERE sub_library_id IN (${placeholders})
    `).get(...adultSubLibraryIds);
  } else if (includeAdultCache) {
    adultCache = db.prepare(`
      SELECT
        COUNT(*) AS totalAdultItems,
        SUM(CASE WHEN json_type(payload_json, '$.adultMetadata') IS NOT NULL THEN 1 ELSE 0 END) AS cachedAdultItems,
        SUM(CASE WHEN json_type(payload_json, '$.adultMetadata') IS NULL THEN 1 ELSE 0 END) AS missingAdultMetadataItems,
        SUM(CASE
          WHEN json_type(payload_json, '$.adultMetadata') IS NOT NULL
            AND (
              TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.adultId'), '')) = ''
              OR TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.region'), '')) = ''
              OR TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.scrapeStatus'), '')) = ''
            )
          THEN 1 ELSE 0 END) AS incompleteAdultMetadataItems,
        SUM(CASE WHEN TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.adultId'), '')) = '' THEN 1 ELSE 0 END) AS missingAdultMetadataAdultIdItems,
        SUM(CASE WHEN TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.region'), '')) = '' THEN 1 ELSE 0 END) AS missingAdultMetadataRegionItems,
        SUM(CASE WHEN TRIM(COALESCE(json_extract(payload_json, '$.adultMetadata.scrapeStatus'), '')) = '' THEN 1 ELSE 0 END) AS missingAdultMetadataScrapeStatusItems
      FROM media_items
      WHERE source = 'adult_folder'
    `).get();
  }

  const totalAdultItems = adultCache ? normalizePayloadFieldNumber(adultCache.totalAdultItems) : 0;
  const cachedAdultItems = adultCache ? normalizePayloadFieldNumber(adultCache.cachedAdultItems) : 0;
  const missingAdultMetadataItems = adultCache ? normalizePayloadFieldNumber(adultCache.missingAdultMetadataItems) : 0;
  const incompleteAdultMetadataItems = adultCache ? normalizePayloadFieldNumber(adultCache.incompleteAdultMetadataItems) : 0;
  const expectedAdultSubLibraryCount = adultSubLibraryIds.length;
  const adultLibraryCache = includeAdultCache
    ? {
      expectedAdultSubLibraryCount,
      totalAdultItems,
      cachedAdultItems,
      missingAdultMetadataItems,
      incompleteAdultMetadataItems,
      missingFieldCounts: adultCache ? {
        adultId: normalizePayloadFieldNumber(adultCache.missingAdultMetadataAdultIdItems),
        region: normalizePayloadFieldNumber(adultCache.missingAdultMetadataRegionItems),
        scrapeStatus: normalizePayloadFieldNumber(adultCache.missingAdultMetadataScrapeStatusItems),
      } : {},
      status: totalAdultItems > 0
        ? (cachedAdultItems === 0
          ? 'missing'
          : ((incompleteAdultMetadataItems + missingAdultMetadataItems) > 0 ? 'partial' : 'complete'))
        : (expectedAdultSubLibraryCount > 0 ? 'missing' : 'not_applicable'),
    }
    : {
      expectedAdultSubLibraryCount: 0,
      totalAdultItems: 0,
      cachedAdultItems: 0,
      missingAdultMetadataItems: 0,
      incompleteAdultMetadataItems: 0,
      missingFieldCounts: {},
      status: 'not_applicable',
    };

  return {
    generatedAt: new Date().toISOString(),
    dbSizeBytes: normalizePayloadFieldNumber(storage.dbSizeBytes),
    walSizeBytes: normalizePayloadFieldNumber(storage.walSizeBytes),
    totalSizeBytes: normalizePayloadFieldNumber(storage.totalSizeBytes),
    mediaItemCount,
    payloadBytesTotal,
    payloadBytesAverage,
    payloadBytesMax,
    payloadBytesMin,
    bySubLibrary,
    bySource,
    byType,
    maxPayload,
    adultLibraryCache,
  };
}

function readLegacyJsonLibrary(filePath) {
  if (!fs.existsSync(filePath)) return { version: 1, cachedAt: null, items: [] };
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw || !raw.trim()) return { version: 1, cachedAt: null, items: [] };
  const parsed = JSON.parse(raw);
  return {
    version: parsed && parsed.version ? parsed.version : 1,
    cachedAt: parsed && parsed.cachedAt ? parsed.cachedAt : null,
    items: Array.isArray(parsed && parsed.items) ? parsed.items : [],
  };
}

function migrateJsonLibraryIfNeeded(db) {
  const jsonPath = libraryJsonFilePath();
  const marker = migrationMarkerPath();
  if (!fs.existsSync(jsonPath) || fs.existsSync(marker)) return;

  const existing = db.prepare('SELECT COUNT(*) AS count FROM media_items').get().count || 0;
  if (existing > 0) {
    fs.writeFileSync(marker, JSON.stringify({
      migratedAt: new Date().toISOString(),
      skipped: true,
      reason: 'library.db already contains rows',
    }, null, 2), 'utf8');
    return;
  }

  try {
    const lib = readLegacyJsonLibrary(jsonPath);
    replaceAllItems(db, lib);
    fs.writeFileSync(marker, JSON.stringify({
      migratedAt: new Date().toISOString(),
      source: path.basename(jsonPath),
      target: path.basename(libraryDbFilePath()),
      count: lib.items.length,
    }, null, 2), 'utf8');
    console.log(`[libraryStore] migrated ${lib.items.length} item(s) from library.json to library.db`);
  } catch (err) {
    console.error('[libraryStore] failed to migrate library.json:', err.message);
    try {
      const bak = `${jsonPath}.bak.${Date.now()}`;
      fs.copyFileSync(jsonPath, bak);
      console.error('[libraryStore] migration source backed up to', bak);
    } catch (_) {}
    throw err;
  }
}

function normalizeItem(item) {
  const it = item && typeof item === 'object' ? { ...item } : {};
  it.itemId = String(it.itemId || crypto.randomUUID());
  delete it.action;
  return it;
}

function itemToRow(item, ordinal) {
  const it = normalizeItem(item);
  userPerceptionManagement.projectItem(it, { now: new Date().toISOString() });
  const adultMetadata = it.adultMetadata || {};
  const space = itemSpaceStatColumns(it);
  const facts = v3Model.mediaItemFacts(it);
  return {
    item_id: it.itemId,
    ordinal: Number.isInteger(ordinal) ? ordinal : 0,
    sub_library_id: String(it.subLibraryId || ''),
    source: String(it.source || ''),
    source_id: String(it.sourceId || ''),
    name: String(it.name || ''),
    type: String(it.type || ''),
    action: '',
    path: String(it.path || ''),
    watched: it.watched ? 1 : 0,
    scraped: it.scraped ? 1 : 0,
    scrape_status: String(adultMetadata.scrapeStatus || ''),
    adult_id: String(adultMetadata.adultId || ''),
    resolution: String(it.resolution || ''),
    codec: String(it.codec || it.videoCodec || ''),
    user_rating: it.userRating == null ? null : Number(it.userRating),
    douban_stars: it.doubanStars == null ? (it.doubanRating == null ? null : Number(it.doubanRating)) : Number(it.doubanStars),
    is_bluray_disc: it.isBluRayDisc ? 1 : 0,
    updated_at: String(it.lastRefreshedAt || it.userRatingUpdatedAt || it.doubanRatingUpdatedAt || ''),
    payload_json: jsonStringify(it),
    ...space,
    ...facts,
  };
}

function finiteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function itemSpaceStatColumns(item) {
  return {
    size_bytes: finiteNumberOrNull(item && item.size),
    bitrate: finiteNumberOrNull(item && item.bitrate),
    equivalent_bitrate: finiteNumberOrNull(item && item.equivalentBitrate),
    target_bitrate: finiteNumberOrNull(item && item.targetBitrate),
  };
}

function rowToItem(row) {
  if (!row) return null;
  const item = normalizeItem(jsonParse(row.payload_json, {}));
  item.itemId = row.item_id || item.itemId;
  if (row.lifecycle_stage !== undefined) {
    item.lifecycleStage = row.lifecycle_stage || item.lifecycleStage;
    item.lifecycleDone = row.lifecycle_done === 1 || item.lifecycleDone === true;
    item.lifecycleNextTask = row.lifecycle_next_task || item.lifecycleNextTask || null;
    item.lifecycleReason = row.lifecycle_reason || item.lifecycleReason;
    item.metadataStatus = row.metadata_status || item.metadataStatus;
    item.metadataKind = row.metadata_kind || item.metadataKind;
    const rawStoredMissingReasons = jsonParse(row.metadata_missing_reasons_json, item.metadataMissingReasons || []);
    const storedMissingReasons = metadataStatus.sanitizeMetadataMissingReasons(rawStoredMissingReasons);
    item.metadataComplete = row.metadata_complete === 1
      || (row.metadata_complete === 0 && rawStoredMissingReasons.length > 0 && storedMissingReasons.length === 0);
    item.metadataMissingReasons = storedMissingReasons;
    item.metadataUpdatedAt = row.metadata_updated_at || item.metadataUpdatedAt;
    item.optimizationStatus = row.optimization_status || item.optimizationStatus || 'none';
    item.optimizeFlowKind = row.optimization_action || item.optimizeFlowKind || null;
    item.optimizationDoneAt = row.optimization_done_at || item.optimizationDoneAt || null;
    item.optimizationTaskId = row.optimization_task_id || item.optimizationTaskId || null;
    item.archiveStatus = row.archive_status || item.archiveStatus;
    item.archiveReason = row.archive_reason || item.archiveReason;
    item.archiveDoneAt = row.archive_done_at || item.archiveDoneAt || null;
  }
  return item;
}

const upsertSql = `
  INSERT INTO media_items
    (item_id, ordinal, sub_library_id, source, source_id, name, type, action, path,
     watched, scraped, scrape_status, adult_id, resolution, codec, user_rating,
     douban_stars, is_bluray_disc, updated_at, payload_json,
     size_bytes, bitrate, equivalent_bitrate, target_bitrate,
     lifecycle_stage, lifecycle_done, lifecycle_next_task, lifecycle_reason,
     metadata_status, metadata_kind, metadata_complete, metadata_missing_reasons_json, metadata_updated_at,
     optimization_status, optimization_action, optimization_done_at, optimization_task_id,
     archive_status, archive_reason, archive_done_at)
  VALUES
    (@item_id, @ordinal, @sub_library_id, @source, @source_id, @name, @type, @action, @path,
     @watched, @scraped, @scrape_status, @adult_id, @resolution, @codec, @user_rating,
     @douban_stars, @is_bluray_disc, @updated_at, @payload_json,
     @size_bytes, @bitrate, @equivalent_bitrate, @target_bitrate,
     @lifecycle_stage, @lifecycle_done, @lifecycle_next_task, @lifecycle_reason,
     @metadata_status, @metadata_kind, @metadata_complete, @metadata_missing_reasons_json, @metadata_updated_at,
     @optimization_status, @optimization_action, @optimization_done_at, @optimization_task_id,
     @archive_status, @archive_reason, @archive_done_at)
  ON CONFLICT(item_id) DO UPDATE SET
    ordinal = excluded.ordinal,
    sub_library_id = excluded.sub_library_id,
    source = excluded.source,
    source_id = excluded.source_id,
    name = excluded.name,
    type = excluded.type,
    action = excluded.action,
    path = excluded.path,
    watched = excluded.watched,
    scraped = excluded.scraped,
    scrape_status = excluded.scrape_status,
    adult_id = excluded.adult_id,
    resolution = excluded.resolution,
    codec = excluded.codec,
    user_rating = excluded.user_rating,
    douban_stars = excluded.douban_stars,
    is_bluray_disc = excluded.is_bluray_disc,
    updated_at = excluded.updated_at,
    payload_json = excluded.payload_json,
    size_bytes = excluded.size_bytes,
    bitrate = excluded.bitrate,
    equivalent_bitrate = excluded.equivalent_bitrate,
    target_bitrate = excluded.target_bitrate,
    lifecycle_stage = excluded.lifecycle_stage,
    lifecycle_done = excluded.lifecycle_done,
    lifecycle_next_task = excluded.lifecycle_next_task,
    lifecycle_reason = excluded.lifecycle_reason,
    metadata_status = excluded.metadata_status,
    metadata_kind = excluded.metadata_kind,
    metadata_complete = excluded.metadata_complete,
    metadata_missing_reasons_json = excluded.metadata_missing_reasons_json,
    metadata_updated_at = excluded.metadata_updated_at,
    optimization_status = excluded.optimization_status,
    optimization_action = excluded.optimization_action,
    optimization_done_at = excluded.optimization_done_at,
    optimization_task_id = excluded.optimization_task_id,
    archive_status = excluded.archive_status,
    archive_reason = excluded.archive_reason,
    archive_done_at = excluded.archive_done_at
`;

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO library_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value == null ? '' : value));
}

function getMeta(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM library_meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function replaceAllItems(db, lib) {
  const items = Array.isArray(lib && lib.items) ? lib.items : [];
  const upsert = db.prepare(upsertSql);
  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM media_items').run();
    rows.forEach((item, index) => upsert.run(itemToRow(item, index)));
    setMeta(db, 'version', lib && lib.version ? lib.version : 1);
    setMeta(db, 'cachedAt', lib && lib.cachedAt ? lib.cachedAt : new Date().toISOString());
  });
  tx(items);
  checkpointWal(db, 'replace_all');
}

function loadLibrary() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM media_items ORDER BY ordinal ASC, item_id ASC').all();
  return {
    version: Number(getMeta(db, 'version', '1')) || 1,
    cachedAt: getMeta(db, 'cachedAt', null) || null,
    items: rows.map(rowToItem).filter(Boolean),
  };
}

function saveLibrary(lib) {
  replaceAllItems(getDb(), lib || { version: 1, items: [] });
}

function replaceSubLibraryItems(subLibraryId, items, meta = {}) {
  const rows = Array.isArray(items) ? items : [];
  return diagnosticLog.track({
    category: 'store',
    scope: 'libraryStore.replaceSubLibraryItems',
    operation: 'replace_sub_library',
    component: 'libraryStore',
    resourceType: 'sqlite',
    resourceKey: 'library.db',
    slowMs: 500,
    payload: { subLibraryId: String(subLibraryId || ''), inputRows: rows.length, before: getStorageMetrics() },
    successPayload: () => ({ writtenRows: rows.length, after: getStorageMetrics() }),
  }, () => {
    const db = getDb();
    const upsert = db.prepare(upsertSql);
    const existingBase = db.prepare('SELECT MIN(ordinal) AS minOrdinal FROM media_items WHERE sub_library_id = ?')
      .get(String(subLibraryId || ''));
    const appendBase = db.prepare('SELECT COALESCE(MAX(ordinal), -1) + 1 AS nextOrdinal FROM media_items').get();
    const baseOrdinal = Number.isInteger(existingBase && existingBase.minOrdinal)
      ? existingBase.minOrdinal
      : (Number(appendBase && appendBase.nextOrdinal) || 0);
    const tx = db.transaction((txRows) => {
      db.prepare('DELETE FROM media_items WHERE sub_library_id = ?').run(String(subLibraryId || ''));
      txRows.forEach((item, index) => upsert.run(itemToRow(item, baseOrdinal + index)));
      if (meta.version !== undefined) setMeta(db, 'version', meta.version);
      if (meta.cachedAt !== undefined) setMeta(db, 'cachedAt', meta.cachedAt);
    });
    tx(rows);
    checkpointWal(db, 'replace_sub_library');
  });
}

function deleteBySubLibrary(subLibraryId) {
  const db = getDb();
  const changes = db
    .prepare('DELETE FROM media_items WHERE sub_library_id = ?')
    .run(String(subLibraryId || '')).changes || 0;
  if (changes > 0) checkpointWal(db, 'delete_sub_library');
  return changes;
}

function updateItems(items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) return 0;
  return diagnosticLog.track({
    category: 'store',
    scope: 'libraryStore.updateItems',
    operation: 'update_items',
    component: 'libraryStore',
    resourceType: 'sqlite',
    resourceKey: 'library.db',
    slowMs: 250,
    payload: { inputRows: rows.length, before: getStorageMetrics() },
    successPayload: (changed) => ({ changedRows: changed, after: getStorageMetrics() }),
  }, () => {
    const db = getDb();
    const getOrdinal = db.prepare('SELECT ordinal FROM media_items WHERE item_id = ?');
    const upsert = db.prepare(upsertSql);
    const tx = db.transaction((changedItems) => {
      let changed = 0;
      for (const item of changedItems) {
        if (!item || !item.itemId) continue;
        const existing = getOrdinal.get(String(item.itemId));
        if (!existing) continue;
        upsert.run(itemToRow(item, existing.ordinal));
        changed++;
      }
      return changed;
    });
    return tx(rows);
  });
}

function getItem(itemId) {
  const row = getDb().prepare('SELECT * FROM media_items WHERE item_id = ?').get(String(itemId || ''));
  return rowToItem(row);
}

function buildWhere(filter = {}) {
  const clauses = [];
  const params = {};
  if (filter.source) { clauses.push('source = @source'); params.source = String(filter.source); }
  if (filter.type) { clauses.push('type = @type'); params.type = String(filter.type); }
  if (filter.lifecycle) {
    const lifecycle = String(filter.lifecycle || '').toLowerCase();
    if (lifecycle === 'done' || lifecycle === 'closed') clauses.push('lifecycle_done = 1');
    else if (lifecycle === 'open' || lifecycle === 'pending') clauses.push('lifecycle_done = 0');
    else if (lifecycle === 'archive_ready') {
      clauses.push('archive_status = @archiveReady');
      params.archiveReady = 'archived_like';
    } else {
      clauses.push('(lifecycle_stage = @lifecycle OR archive_status = @lifecycle OR lifecycle_next_task = @lifecycle)');
      params.lifecycle = lifecycle;
    }
  }
  if (filter.metadataStatus) {
    const metadataStatus = String(filter.metadataStatus || '').toLowerCase();
    if (metadataStatus === 'done') clauses.push('metadata_complete = 1');
    else if (metadataStatus === 'pending') clauses.push('metadata_complete = 0');
    else {
      clauses.push('metadata_status = @metadataStatus');
      params.metadataStatus = metadataStatus;
    }
  }
  if (filter.optimizationStatus) {
    clauses.push('optimization_status = @optimizationStatus');
    params.optimizationStatus = String(filter.optimizationStatus);
  }
  if (filter.archiveStatus) {
    clauses.push('archive_status = @archiveStatus');
    params.archiveStatus = String(filter.archiveStatus);
  }
  if (filter.subLibraryId) { clauses.push('sub_library_id = @subLibraryId'); params.subLibraryId = String(filter.subLibraryId); }
  if (Array.isArray(filter.itemIds)) {
    if (filter.itemIds.length === 0) {
      clauses.push('1 = 0');
    } else {
      const keys = filter.itemIds.map((_, i) => `@itemId${i}`);
      clauses.push(`item_id IN (${keys.join(', ')})`);
      filter.itemIds.forEach((id, i) => { params[`itemId${i}`] = String(id); });
    }
  }
  if (Array.isArray(filter.excludeItemIds) && filter.excludeItemIds.length > 0) {
    const keys = filter.excludeItemIds.map((_, i) => `@excludeItemId${i}`);
    clauses.push(`item_id NOT IN (${keys.join(', ')})`);
    filter.excludeItemIds.forEach((id, i) => { params[`excludeItemId${i}`] = String(id); });
  }
  if (filter.search) {
    const q = String(filter.search).trim();
    if (q) {
      clauses.push('(name LIKE @search COLLATE NOCASE OR source_id LIKE @search COLLATE NOCASE OR adult_id LIKE @search COLLATE NOCASE)');
      params.search = `%${q}%`;
    }
  }
  if (filter.resolution) { clauses.push('resolution LIKE @resolution'); params.resolution = `${String(filter.resolution)}%`; }
  if (filter.codec) { clauses.push('LOWER(codec) = LOWER(@codec)'); params.codec = String(filter.codec); }
  if (filter.watched !== undefined) { clauses.push('watched = @watched'); params.watched = filter.watched ? 1 : 0; }
  if (filter.isBluRayDisc !== undefined) { clauses.push('is_bluray_disc = @isBluRayDisc'); params.isBluRayDisc = filter.isBluRayDisc ? 1 : 0; }
  if (filter.doubanStars !== undefined) {
    if (filter.doubanStars === null) clauses.push('douban_stars IS NULL');
    else { clauses.push('douban_stars = @doubanStars'); params.doubanStars = Number(filter.doubanStars); }
  }
  if (filter.userRating !== undefined) {
    if (filter.userRating === null) clauses.push('user_rating IS NULL');
    else { clauses.push('user_rating = @userRating'); params.userRating = Number(filter.userRating); }
  }
  if (filter.scrapeStatus) {
    clauses.push('source = @scrapeSource');
    params.scrapeSource = 'adult_folder';
    if (filter.scrapeStatus === 'done') {
      clauses.push('(scraped = 1 OR scrape_status = @scrapeDone)');
      params.scrapeDone = 'done';
    } else if (filter.scrapeStatus === 'pending') {
      clauses.push('(scraped = 0 AND (scrape_status IN (@scrapePending, @scrapeAmbiguous) OR scrape_status = @scrapeEmpty))');
      params.scrapePending = 'pending';
      params.scrapeAmbiguous = 'ambiguous';
      params.scrapeEmpty = '';
    } else if (filter.scrapeStatus === 'failed') {
      clauses.push('scrape_status = @scrapeFailed');
      params.scrapeFailed = 'failed';
    }
  }
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function queryItems(filter = {}, opts = {}) {
  return diagnosticLog.track({
    category: 'store',
    scope: 'libraryStore.queryItems',
    operation: 'query_items',
    component: 'libraryStore',
    resourceType: 'sqlite',
    resourceKey: 'library.db',
    slowMs: 150,
    payload: {
      filter: {
        source: filter.source || '',
        type: filter.type || '',
        subLibraryId: filter.subLibraryId || '',
        hasSearch: !!filter.search,
        itemIds: Array.isArray(filter.itemIds) ? filter.itemIds.length : undefined,
      },
      limit: opts.limit || null,
      offset: opts.offset || 0,
    },
    successPayload: (result) => ({
      rowCount: result && Array.isArray(result.items) ? result.items.length : 0,
      total: result && typeof result.total === 'number' ? result.total : undefined,
    }),
  }, () => {
    const db = getDb();
    const { where, params } = buildWhere(filter);
    const total = db.prepare(`SELECT COUNT(*) AS count FROM media_items ${where}`).get(params).count || 0;
    const hasLimit = Number.isInteger(opts.limit) && opts.limit > 0;
    const offset = Math.max(0, Number(opts.offset) || 0);
    const limitClause = hasLimit ? 'LIMIT @limit OFFSET @offset' : '';
    const rows = db.prepare(`
      SELECT *
      FROM media_items
      ${where}
      ORDER BY ordinal ASC, item_id ASC
      ${limitClause}
    `).all({ ...params, limit: hasLimit ? Number(opts.limit) : undefined, offset });
    return {
      items: rows.map(rowToItem).filter(Boolean),
      total,
      offset,
      limit: hasLimit ? Number(opts.limit) : null,
    };
  });
}

function querySmartTaskCandidateItems() {
  const rows = getDb().prepare(`
    SELECT
      item_id,
      sub_library_id,
      source,
      source_id,
      name,
      type,
      path,
      watched,
      scraped,
      scrape_status,
      adult_id,
      resolution,
      codec,
      user_rating,
      douban_stars,
      is_bluray_disc,
      size_bytes,
      bitrate,
      equivalent_bitrate,
      target_bitrate,
      optimization_status,
      optimization_action,
      optimization_done_at,
      archive_status,
      archive_done_at,
      updated_at,
      json_extract(payload_json, '$.reason') AS reason,
      json_extract(payload_json, '$.bucket') AS bucket,
      json_extract(payload_json, '$.duration') AS duration,
      json_extract(payload_json, '$.audioCodecs') AS audio_codecs_json,
      json_extract(payload_json, '$.doubanRating') AS douban_rating,
      json_extract(payload_json, '$.doubanId') AS douban_id,
      json_extract(payload_json, '$.userRatingUpdatedAt') AS user_rating_updated_at,
      json_extract(payload_json, '$.doubanRatingUpdatedAt') AS douban_rating_updated_at,
      json_extract(payload_json, '$.lastRefreshedAt') AS last_refreshed_at,
      json_extract(payload_json, '$.tmdbId') AS tmdb_id,
      json_extract(payload_json, '$.providerIds') AS provider_ids_json,
      json_extract(payload_json, '$.seriesName') AS series_name,
      json_extract(payload_json, '$.seasonNumber') AS season_number,
      json_extract(payload_json, '$.targetCodec') AS target_codec,
      json_extract(payload_json, '$.targetMediaFacts') AS target_media_facts_json,
      json_extract(payload_json, '$.seedPreferences') AS seed_preferences_json,
      json_extract(payload_json, '$.maxSizeGB') AS max_size_gb,
      json_extract(payload_json, '$.assetKey') AS asset_key,
      json_extract(payload_json, '$.assetRootPath') AS asset_root_path,
      json_extract(payload_json, '$.externalRefs') AS external_refs_json,
      json_extract(payload_json, '$.adultMetadata.title') AS adult_title,
      json_extract(payload_json, '$.adultMetadata.region') AS adult_region,
      json_extract(payload_json, '$.adultMetadata.scrapedAt') AS adult_scraped_at,
      json_extract(payload_json, '$.adultMetadata.protagonist') AS adult_protagonist_json
    FROM media_items
    WHERE source IN ('emby', 'adult_folder')
      AND type != 'series'
    ORDER BY ordinal ASC, item_id ASC
  `).all();

  return rows.map((row) => {
    const adultMetadata = (row.adult_id || row.scrape_status || row.adult_title || row.adult_region || row.adult_scraped_at || row.adult_protagonist_json)
      ? {
        adultId: row.adult_id || undefined,
        scrapeStatus: row.scrape_status || undefined,
        title: row.adult_title || undefined,
        region: row.adult_region || undefined,
        scrapedAt: row.adult_scraped_at || undefined,
        protagonist: jsonParse(row.adult_protagonist_json, undefined),
      }
      : undefined;
    const item = {
      itemId: row.item_id || '',
      subLibraryId: row.sub_library_id || '',
      source: row.source || '',
      sourceId: row.source_id || '',
      name: row.name || '',
      type: row.type || '',
      reason: row.reason || '',
      path: row.path || '',
      watched: row.watched === 1,
      scraped: row.scraped === 1,
      adultMetadata,
      resolution: row.resolution || '',
      bucket: row.bucket || undefined,
      codec: row.codec || '',
      audioCodecs: jsonParse(row.audio_codecs_json, undefined),
      userRating: row.user_rating,
      doubanStars: row.douban_stars,
      doubanRating: row.douban_rating == null ? row.douban_stars : row.douban_rating,
      doubanId: row.douban_id || undefined,
      isBluRayDisc: row.is_bluray_disc === 1,
      size: row.size_bytes == null ? undefined : Number(row.size_bytes),
      bitrate: row.bitrate == null ? undefined : Number(row.bitrate),
      equivalentBitrate: row.equivalent_bitrate == null ? undefined : Number(row.equivalent_bitrate),
      targetBitrate: row.target_bitrate == null ? undefined : Number(row.target_bitrate),
      optimizationStatus: row.optimization_status || undefined,
      optimizeFlowKind: row.optimization_action || undefined,
      optimizationDoneAt: row.optimization_done_at || undefined,
      archiveStatus: row.archive_status || undefined,
      archiveDoneAt: row.archive_done_at || undefined,
      duration: row.duration == null ? undefined : Number(row.duration),
      updatedAt: row.updated_at || undefined,
      userRatingUpdatedAt: row.user_rating_updated_at || undefined,
      doubanRatingUpdatedAt: row.douban_rating_updated_at || undefined,
      lastRefreshedAt: row.last_refreshed_at || undefined,
      tmdbId: row.tmdb_id || undefined,
      providerIds: jsonParse(row.provider_ids_json, undefined),
      seriesName: row.series_name || undefined,
      seasonNumber: row.season_number,
      targetCodec: row.target_codec || undefined,
      targetMediaFacts: jsonParse(row.target_media_facts_json, undefined),
      seedPreferences: jsonParse(row.seed_preferences_json, undefined),
      maxSizeGB: jsonParse(row.max_size_gb, row.max_size_gb),
      assetKey: row.asset_key || undefined,
      assetRootPath: row.asset_root_path || undefined,
      externalRefs: jsonParse(row.external_refs_json, undefined),
    };
    Object.keys(item).forEach((key) => {
      if (item[key] === undefined || item[key] === null) delete item[key];
    });
    return item;
  });
}

function buildAdultReviewWhere(filter = {}) {
  const clauses = ["source = 'adult_folder'"];
  const params = {};
  const reviewStatuses = Array.isArray(filter.reviewStatuses) && filter.reviewStatuses.length > 0
    ? filter.reviewStatuses.map((status) => String(status || '').trim()).filter(Boolean)
    : ['ambiguous', 'needs_review'];

  if (reviewStatuses.length > 0) {
    const statusKeys = reviewStatuses.map((_, i) => `@reviewStatus${i}`);
    clauses.push(`(scrape_status IN (${statusKeys.join(', ')}) OR json_extract(payload_json, '$.adultMetadata.reviewStatus') IN (${statusKeys.join(', ')}))`);
    reviewStatuses.forEach((status, i) => { params[`reviewStatus${i}`] = status; });
  }
  if (filter.subLibraryId) {
    clauses.push('sub_library_id = @subLibraryId');
    params.subLibraryId = String(filter.subLibraryId);
  }
  if (filter.q) {
    const q = String(filter.q || '').trim();
    if (q) {
      clauses.push('(name LIKE @q COLLATE NOCASE OR source_id LIKE @q COLLATE NOCASE OR adult_id LIKE @q COLLATE NOCASE)');
      params.q = `%${q}%`;
    }
  }
  return {
    where: `WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

function queryAdultReviewSummaries(filter = {}, opts = {}) {
  return diagnosticLog.track({
    category: 'store',
    scope: 'libraryStore.queryAdultReviewSummaries',
    operation: 'query_adult_review_summaries',
    component: 'libraryStore',
    resourceType: 'sqlite',
    resourceKey: 'library.db',
    slowMs: 150,
    payload: {
      subLibraryId: filter.subLibraryId || '',
      hasSearch: !!filter.q,
      reviewStatuses: Array.isArray(filter.reviewStatuses) ? filter.reviewStatuses.length : undefined,
      includeAll: opts.includeAll === true,
    },
    successPayload: (result) => ({
      rowCount: result && Array.isArray(result.items) ? result.items.length : 0,
      total: result && typeof result.total === 'number' ? result.total : undefined,
    }),
  }, () => {
    const db = getDb();
    const { where, params } = buildAdultReviewWhere(filter);
    const page = Math.max(1, Number.parseInt(opts.page, 10) || 1);
    const maxPageSize = Math.max(1, Number.parseInt(opts.maxPageSize, 10) || 100);
    const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(opts.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;
    const includeAll = opts.includeAll === true;
    const limitClause = includeAll ? '' : 'LIMIT @limit OFFSET @offset';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM media_items ${where}`).get(params).count || 0;
    const rows = db.prepare(`
      SELECT
        item_id,
        sub_library_id,
        source,
        source_id,
        name,
        type,
        path,
        scraped,
        scrape_status,
        adult_id,
        updated_at,
        metadata_status,
        metadata_kind,
        metadata_complete,
        metadata_missing_reasons_json,
        lifecycle_stage,
        lifecycle_done,
        lifecycle_next_task,
        lifecycle_reason,
        optimization_status,
        optimization_action,
        archive_status,
        archive_reason,
        json_extract(payload_json, '$.adultMetadata.reviewStatus') AS review_status,
        json_extract(payload_json, '$.adultMetadata.idConfidence') AS id_confidence,
        json_extract(payload_json, '$.adultMetadata.region') AS adult_region,
        json_extract(payload_json, '$.adultMetadata.title') AS adult_title,
        json_extract(payload_json, '$.adultMetadata.originalTitle') AS adult_original_title,
        json_extract(payload_json, '$.adultMetadata.scrapeError') AS scrape_error,
        json_extract(payload_json, '$.adultMetadata.scrapeFailedAt') AS scrape_failed_at,
        json_extract(payload_json, '$.adultMetadata.protagonist') AS adult_protagonist_json
      FROM media_items
      ${where}
      ORDER BY updated_at DESC, ordinal ASC, item_id ASC
      ${limitClause}
    `).all({ ...params, limit: includeAll ? undefined : pageSize, offset: includeAll ? undefined : offset });
    return {
      items: rows.map((row) => {
        const rawMissingReasons = jsonParse(row.metadata_missing_reasons_json, []);
        const missingReasons = metadataStatus.sanitizeMetadataMissingReasons(rawMissingReasons);
        const metadataComplete = row.metadata_complete === 1
          || (row.metadata_complete === 0 && rawMissingReasons.length > 0 && missingReasons.length === 0);
        return {
          itemId: row.item_id || '',
          subLibraryId: row.sub_library_id || '',
          source: row.source || '',
          sourceId: row.source_id || '',
          name: row.name || row.adult_title || row.adult_id || '',
          type: row.type || '',
          path: row.path || '',
          scraped: row.scraped === 1,
          scrapeStatus: row.scrape_status || '',
          reviewStatus: row.review_status || '',
          adultId: row.adult_id || '',
          adultTitle: row.adult_title || '',
          adultOriginalTitle: row.adult_original_title || '',
          adultRegion: row.adult_region || '',
          idConfidence: row.id_confidence || '',
          scrapeError: row.scrape_error || '',
          scrapeFailedAt: row.scrape_failed_at || '',
          protagonist: jsonParse(row.adult_protagonist_json, undefined),
          updatedAt: row.updated_at || '',
          lifecycleStage: row.lifecycle_stage || '',
          lifecycleDone: row.lifecycle_done === 1,
          lifecycleNextTask: row.lifecycle_next_task || '',
          lifecycleReason: row.lifecycle_reason || '',
          metadataStatus: metadataComplete ? 'complete' : (row.metadata_status || ''),
          metadataKind: row.metadata_kind || '',
          metadataComplete,
          metadataMissingReasons: missingReasons,
          optimizationStatus: row.optimization_status || '',
          optimizeFlowKind: row.optimization_action || '',
          archiveStatus: row.archive_status || '',
          archiveReason: row.archive_reason || '',
        };
      }),
      total,
      page,
      pageSize,
    };
  });
}

function querySpaceStatItems() {
  const rows = getDb().prepare(`
    SELECT
      item_id,
      sub_library_id,
      size_bytes,
      bitrate,
      equivalent_bitrate,
      target_bitrate,
      json_extract(payload_json, '$.targetCodec') AS target_codec,
      json_extract(payload_json, '$.targetMediaFacts') AS target_media_facts_json
    FROM media_items
    ORDER BY ordinal ASC, item_id ASC
  `).all();

  return rows.map((row) => ({
    itemId: row.item_id,
    subLibraryId: row.sub_library_id || '',
    size: Number(row.size_bytes) || 0,
    bitrate: Number(row.bitrate) || 0,
    equivalentBitrate: row.equivalent_bitrate == null ? undefined : Number(row.equivalent_bitrate),
    targetBitrate: row.target_bitrate == null ? undefined : Number(row.target_bitrate),
    targetCodec: row.target_codec || undefined,
    targetMediaFacts: jsonParse(row.target_media_facts_json, undefined),
  }));
}

function countMap(rows, keyField = 'key') {
  const out = {};
  for (const row of rows || []) {
    const key = row && row[keyField] ? String(row[keyField]) : 'unknown';
    out[key] = Number(row.count) || 0;
  }
  return out;
}

function queryDashboardMediaStats() {
  return diagnosticLog.track({
    category: 'store',
    scope: 'libraryStore.queryDashboardMediaStats',
    operation: 'query_dashboard_media_stats',
    component: 'libraryStore',
    resourceType: 'sqlite',
    resourceKey: 'library.db',
    slowMs: 150,
  }, () => {
    const db = getDb();
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS totalItems,
        SUM(CASE WHEN lifecycle_done = 1 THEN 1 ELSE 0 END) AS closedItems,
        SUM(CASE WHEN lifecycle_done = 0 THEN 1 ELSE 0 END) AS openItems,
        SUM(CASE WHEN metadata_complete = 0 THEN 1 ELSE 0 END) AS metadataIncompleteItems,
        SUM(CASE WHEN lifecycle_next_task = 'optimize' AND lifecycle_done = 0 THEN 1 ELSE 0 END) AS pendingOptimizationItems,
        SUM(CASE WHEN archive_status = 'archived_like' THEN 1 ELSE 0 END) AS archiveReadyItems,
        SUM(CASE WHEN archive_status IN ('archived', 'archived_like') OR lifecycle_done = 1 THEN 1 ELSE 0 END) AS archiveLikeItems
      FROM media_items
    `).get() || {};
    const byLifecycleStage = countMap(db.prepare(`
      SELECT COALESCE(NULLIF(lifecycle_stage, ''), 'unknown') AS key, COUNT(*) AS count
      FROM media_items
      GROUP BY COALESCE(NULLIF(lifecycle_stage, ''), 'unknown')
      ORDER BY count DESC, key ASC
    `).all());
    const byMetadataStatus = countMap(db.prepare(`
      SELECT COALESCE(NULLIF(metadata_status, ''), 'unknown') AS key, COUNT(*) AS count
      FROM media_items
      GROUP BY COALESCE(NULLIF(metadata_status, ''), 'unknown')
      ORDER BY count DESC, key ASC
    `).all());
    const byRecommendedTargetGate = countMap(db.prepare(`
      SELECT COALESCE(NULLIF(lifecycle_next_task, ''), 'none') AS key, COUNT(*) AS count
      FROM media_items
      GROUP BY COALESCE(NULLIF(lifecycle_next_task, ''), 'none')
      ORDER BY count DESC, key ASC
    `).all());
    const bySource = countMap(db.prepare(`
      SELECT COALESCE(NULLIF(source, ''), 'unknown') AS key, COUNT(*) AS count
      FROM media_items
      GROUP BY COALESCE(NULLIF(source, ''), 'unknown')
      ORDER BY count DESC, key ASC
    `).all());
    const pendingBridges = countMap(db.prepare(`
      SELECT COALESCE(NULLIF(lifecycle_next_task, ''), 'none') AS key, COUNT(*) AS count
      FROM media_items
      WHERE lifecycle_done = 0
      GROUP BY COALESCE(NULLIF(lifecycle_next_task, ''), 'none')
      ORDER BY count DESC, key ASC
    `).all());
    const topMetadataMissingReasons = db.prepare(`
      SELECT json_each.value AS reason, COUNT(*) AS count
      FROM media_items,
        json_each(CASE
          WHEN json_valid(metadata_missing_reasons_json) THEN metadata_missing_reasons_json
          ELSE '[]'
        END)
      WHERE metadata_complete = 0
        AND json_each.value IS NOT NULL
        AND json_each.value != ''
      GROUP BY json_each.value
      ORDER BY count DESC, reason ASC
      LIMIT 8
    `).all().map((row) => ({ reason: String(row.reason || ''), count: Number(row.count) || 0 }));
    const subLibraryRows = db.prepare(`
      SELECT
        sub_library_id AS subLibraryId,
        COUNT(*) AS totalItems,
        SUM(CASE WHEN lifecycle_done = 1 THEN 1 ELSE 0 END) AS closedItems,
        SUM(CASE WHEN lifecycle_done = 0 THEN 1 ELSE 0 END) AS openItems,
        SUM(CASE WHEN metadata_complete = 0 THEN 1 ELSE 0 END) AS metadataIncompleteItems,
        SUM(CASE WHEN lifecycle_next_task = 'optimize' AND lifecycle_done = 0 THEN 1 ELSE 0 END) AS pendingOptimizationItems
      FROM media_items
      GROUP BY sub_library_id
      ORDER BY totalItems DESC, sub_library_id ASC
    `).all();
    const subLibraryStageRows = db.prepare(`
      SELECT
        sub_library_id AS subLibraryId,
        COALESCE(NULLIF(lifecycle_stage, ''), 'unknown') AS lifecycleStage,
        COUNT(*) AS count
      FROM media_items
      GROUP BY sub_library_id, COALESCE(NULLIF(lifecycle_stage, ''), 'unknown')
      ORDER BY sub_library_id ASC, count DESC, lifecycleStage ASC
    `).all();
    const bySubLibraryStage = new Map();
    for (const row of subLibraryStageRows) {
      const subLibraryId = row.subLibraryId || '';
      const current = bySubLibraryStage.get(subLibraryId) || {};
      current[row.lifecycleStage || 'unknown'] = Number(row.count) || 0;
      bySubLibraryStage.set(subLibraryId, current);
    }
    const bySubLibrary = subLibraryRows.map((row) => ({
      subLibraryId: row.subLibraryId || '',
      totalItems: Number(row.totalItems) || 0,
      closedItems: Number(row.closedItems) || 0,
      openItems: Number(row.openItems) || 0,
      metadataIncompleteItems: Number(row.metadataIncompleteItems) || 0,
      pendingOptimizationItems: Number(row.pendingOptimizationItems) || 0,
      byLifecycleStage: bySubLibraryStage.get(row.subLibraryId || '') || {},
    }));

    return {
      totalItems: Number(totals.totalItems) || 0,
      closedItems: Number(totals.closedItems) || 0,
      openItems: Number(totals.openItems) || 0,
      metadataIncompleteItems: Number(totals.metadataIncompleteItems) || 0,
      pendingOptimizationItems: Number(totals.pendingOptimizationItems) || 0,
      archiveReadyItems: Number(totals.archiveReadyItems) || 0,
      archiveLikeItems: Number(totals.archiveLikeItems) || 0,
      byLifecycleStage,
      byMetadataStatus,
      byRecommendedTargetGate,
      bySource,
      pendingBridges,
      topMetadataMissingReasons,
      bySubLibrary,
    };
  });
}

function countBySubLibrary(subLibraryId) {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM media_items WHERE sub_library_id = ?').get(String(subLibraryId || ''));
  return row.count || 0;
}

function getHealth() {
  try {
    getDb().prepare('SELECT COUNT(*) AS count FROM media_items').get();
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  libraryJsonFilePath,
  libraryDbFilePath,
  migrationMarkerPath,
  loadLibrary,
  saveLibrary,
  replaceSubLibraryItems,
  deleteBySubLibrary,
  updateItems,
  getItem,
  queryItems,
  getStorageMetrics,
  getLibraryPayloadHealthSummary,
  querySmartTaskCandidateItems,
  queryAdultReviewSummaries,
  querySpaceStatItems,
  queryDashboardMediaStats,
  countBySubLibrary,
  getHealth,
};
