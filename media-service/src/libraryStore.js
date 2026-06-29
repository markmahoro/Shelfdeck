'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

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
  dbCache.set(dbPath, db);
  migrateJsonLibraryIfNeeded(db);
  backfillSpaceStatColumns(db);
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

function checkpointWal(db, reason) {
  try {
    return db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.warn(`[libraryStore] WAL checkpoint skipped${reason ? ` (${reason})` : ''}: ${err.message}`);
    return null;
  }
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
  return it;
}

function itemToRow(item, ordinal) {
  const it = normalizeItem(item);
  const adultMetadata = it.adultMetadata || {};
  const space = itemSpaceStatColumns(it);
  return {
    item_id: it.itemId,
    ordinal: Number.isInteger(ordinal) ? ordinal : 0,
    sub_library_id: String(it.subLibraryId || ''),
    source: String(it.source || ''),
    source_id: String(it.sourceId || ''),
    name: String(it.name || ''),
    type: String(it.type || ''),
    action: String(it.action || ''),
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
  return item;
}

const upsertSql = `
  INSERT INTO media_items
    (item_id, ordinal, sub_library_id, source, source_id, name, type, action, path,
     watched, scraped, scrape_status, adult_id, resolution, codec, user_rating,
     douban_stars, is_bluray_disc, updated_at, payload_json,
     size_bytes, bitrate, equivalent_bitrate, target_bitrate)
  VALUES
    (@item_id, @ordinal, @sub_library_id, @source, @source_id, @name, @type, @action, @path,
     @watched, @scraped, @scrape_status, @adult_id, @resolution, @codec, @user_rating,
     @douban_stars, @is_bluray_disc, @updated_at, @payload_json,
     @size_bytes, @bitrate, @equivalent_bitrate, @target_bitrate)
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
    target_bitrate = excluded.target_bitrate
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
  const rows = db.prepare('SELECT item_id, payload_json FROM media_items ORDER BY ordinal ASC, item_id ASC').all();
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
  const db = getDb();
  const upsert = db.prepare(upsertSql);
  const existingBase = db.prepare('SELECT MIN(ordinal) AS minOrdinal FROM media_items WHERE sub_library_id = ?')
    .get(String(subLibraryId || ''));
  const appendBase = db.prepare('SELECT COALESCE(MAX(ordinal), -1) + 1 AS nextOrdinal FROM media_items').get();
  const baseOrdinal = Number.isInteger(existingBase && existingBase.minOrdinal)
    ? existingBase.minOrdinal
    : (Number(appendBase && appendBase.nextOrdinal) || 0);
  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM media_items WHERE sub_library_id = ?').run(String(subLibraryId || ''));
    rows.forEach((item, index) => upsert.run(itemToRow(item, baseOrdinal + index)));
    if (meta.version !== undefined) setMeta(db, 'version', meta.version);
    if (meta.cachedAt !== undefined) setMeta(db, 'cachedAt', meta.cachedAt);
  });
  tx(Array.isArray(items) ? items : []);
  checkpointWal(db, 'replace_sub_library');
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
}

function getItem(itemId) {
  const row = getDb().prepare('SELECT item_id, payload_json FROM media_items WHERE item_id = ?').get(String(itemId || ''));
  return rowToItem(row);
}

function buildWhere(filter = {}) {
  const clauses = [];
  const params = {};
  if (filter.source) { clauses.push('source = @source'); params.source = String(filter.source); }
  if (filter.type) { clauses.push('type = @type'); params.type = String(filter.type); }
  if (filter.action) { clauses.push('action = @action'); params.action = String(filter.action); }
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
  const db = getDb();
  const { where, params } = buildWhere(filter);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM media_items ${where}`).get(params).count || 0;
  const hasLimit = Number.isInteger(opts.limit) && opts.limit > 0;
  const offset = Math.max(0, Number(opts.offset) || 0);
  const limitClause = hasLimit ? 'LIMIT @limit OFFSET @offset' : '';
  const rows = db.prepare(`
    SELECT item_id, payload_json
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
      action,
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
      updated_at,
      json_extract(payload_json, '$.reason') AS reason,
      json_extract(payload_json, '$.duration') AS duration,
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
      action: row.action || '',
      reason: row.reason || '',
      path: row.path || '',
      watched: row.watched === 1,
      scraped: row.scraped === 1,
      adultMetadata,
      resolution: row.resolution || '',
      codec: row.codec || '',
      userRating: row.user_rating,
      doubanStars: row.douban_stars,
      doubanRating: row.douban_rating == null ? row.douban_stars : row.douban_rating,
      doubanId: row.douban_id || undefined,
      isBluRayDisc: row.is_bluray_disc === 1,
      size: row.size_bytes == null ? undefined : Number(row.size_bytes),
      bitrate: row.bitrate == null ? undefined : Number(row.bitrate),
      equivalentBitrate: row.equivalent_bitrate == null ? undefined : Number(row.equivalent_bitrate),
      targetBitrate: row.target_bitrate == null ? undefined : Number(row.target_bitrate),
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

function querySpaceStatItems() {
  const rows = getDb().prepare(`
    SELECT
      item_id,
      sub_library_id,
      action,
      size_bytes,
      bitrate,
      equivalent_bitrate,
      target_bitrate
    FROM media_items
    ORDER BY ordinal ASC, item_id ASC
  `).all();

  return rows.map((row) => ({
    itemId: row.item_id,
    subLibraryId: row.sub_library_id || '',
    action: row.action || 'keep',
    size: Number(row.size_bytes) || 0,
    bitrate: Number(row.bitrate) || 0,
    equivalentBitrate: row.equivalent_bitrate == null ? undefined : Number(row.equivalent_bitrate),
    targetBitrate: row.target_bitrate == null ? undefined : Number(row.target_bitrate),
  }));
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
  querySmartTaskCandidateItems,
  querySpaceStatItems,
  countBySubLibrary,
  getHealth,
};
