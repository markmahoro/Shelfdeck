'use strict';

const { canonicalDigest, canonicalJson } = require('./canonical-json');
const RECORD_LIMIT = 64 * 1024;
const SET_LIMIT = 16 * 1024 * 1024;
function fail(message) { throw Object.assign(new Error(message), { code:'EPISODE_METADATA_RECORD_INTEGRITY' }); }

function metadataSetRef(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 256)
    fail('Episode metadata records must contain 1..256 members.');
  let previous = '';
  for (const record of records) {
    const key = record?.episodeScope?.episodeKey;
    if (typeof key !== 'string' || !key || (previous && Buffer.compare(Buffer.from(previous), Buffer.from(key)) >= 0))
      fail('Episode metadata records must be uniquely ordered.');
    if (Buffer.byteLength(canonicalJson(record)) > RECORD_LIMIT) fail('Episode metadata record exceeds its byte limit.');
    previous = key;
  }
  if (Buffer.byteLength(canonicalJson(records)) > SET_LIMIT) fail('Episode metadata set exceeds its byte limit.');
  return Object.freeze({ recordCount:records.length,
    recordsDigest:canonicalDigest({ schema:'series.episode-metadata-record-set@1', records }) });
}

function splitEpisodeMetadata(value) {
  if (value.episodeMetadataRef !== undefined) fail('Expected expanded metadata, not a stored reference.');
  if (value.episodeMetadata === undefined) return { value, recordsJson:null };
  const { episodeMetadata, ...common } = value;
  const record = { ...common, episodeMetadataRef:metadataSetRef(episodeMetadata) };
  if (Buffer.byteLength(canonicalJson(record)) > RECORD_LIMIT) fail('Common metadata record exceeds its byte limit.');
  return { value:Object.freeze(record), recordsJson:canonicalJson(episodeMetadata) };
}

function restoreEpisodeMetadata(value, recordsJson) {
  if (value.episodeMetadataRef === undefined) {
    if (recordsJson !== null && recordsJson !== undefined) fail('Episode records lack their owning metadata reference.');
    return value;
  }
  if (value.episodeMetadata !== undefined || typeof recordsJson !== 'string') fail('Episode metadata records are absent or ambiguous.');
  let records;
  try { records = JSON.parse(recordsJson); } catch { fail('Episode metadata records are invalid JSON.'); }
  if (canonicalJson(metadataSetRef(records)) !== canonicalJson(value.episodeMetadataRef)) fail('Episode metadata set reference does not match.');
  const { episodeMetadataRef, ...common } = value;
  return Object.freeze({ ...common, episodeMetadata:records });
}

function readStoredMetadataValue(row) {
  const schema = row.episode_metadata_schema_ref;
  const records = row.episode_metadata_json;
  if ((records != null) !== (schema != null) || (schema != null && schema !== 'helix://contracts/types/EpisodeMetadataRecordSet/v1'))
    fail('Episode metadata storage schema is inconsistent.');
  return restoreEpisodeMetadata(JSON.parse(row.fact_json), records);
}

module.exports = Object.freeze({ RECORD_LIMIT, SET_LIMIT, metadataSetRef, splitEpisodeMetadata, restoreEpisodeMetadata, readStoredMetadataValue });
