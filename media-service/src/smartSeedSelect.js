'use strict';

/**
 * Smart Seed Select — filter + rank upgrade torrent candidates.
 *
 * Matching: AND across categories, OR within each category.
 * Ranking: highest seeders first, then first to pass bitrate validation wins.
 */

// ── Category matchers ─────────────────────────────────────────────────────

const CODEC_MATCHERS = {
  h265: /H\.?265|HEVC|X\.?265|h265|x265|hevc/i,
  h264: /H\.?264|AVC|X\.?264|h264|x264|avc/i,
  dv:   /DOVI|DOLBY.?VISION|DV\b|dv|DOVI/i,
};

const RESOLUTION_MATCHERS = {
  '4K':    /2160[pi]|4k|2160|x2160|3840/i,
  '1080p': /1080[pi]|1080|x1080|1920/i,
  '720p':  /720[pi]|720|x720/i,
};

const AUDIO_MATCHERS = {
  DTS:    /DTS/i,
  TrueHD: /TrueHD/i,
  Atmos:  /Atmos/i,
  AC3:    /AC3/i,
  AAC:    /AAC/i,
  FLAC:   /FLAC/i,
};

// MoviePilot CNSUB equivalent regex — checks torrent title for Chinese subtitle keywords
const CNSUB_RE = /[一-龥繁簡](\/|\s|\\|\|)?[繁简英粤]|[英简繁](\/|\s|\\|\|)?[中繁简]|繁體|簡體|[中國][字配]|国语|國語|中文|中字|简日|繁日|简繁|繁体|([\s,.\-\[])(chs|cht)(|[\s,.\-\]])|(?<![a-z0-9])(gb|big5)(?![a-z0-9])/;

// ── Helpers ────────────────────────────────────────────────────────────────

function candidateMatchesCodec(candidate, preferences) {
  if (!preferences || preferences.length === 0) return true;
  const video = candidate.meta_info && candidate.meta_info.video_encode || '';
  const effect = candidate.meta_info && candidate.meta_info.resource_effect || '';
  for (const pref of preferences) {
    const re = CODEC_MATCHERS[pref];
    if (!re) continue;
    // dv checks resource_effect in addition to video_encode
    if (pref === 'dv') {
      if (re.test(effect)) return true;
    }
    if (re.test(video)) return true;
  }
  return false;
}

function candidateMatchesResolution(candidate, preferences) {
  if (!preferences || preferences.length === 0) return true;
  const pix = candidate.meta_info && candidate.meta_info.resource_pix || '';
  for (const pref of preferences) {
    const re = RESOLUTION_MATCHERS[pref];
    if (re && re.test(pix)) return true;
  }
  return false;
}

function candidateMatchesAudio(candidate, preferences) {
  if (!preferences || preferences.length === 0) return true;
  const audio = candidate.meta_info && candidate.meta_info.audio_encode || '';
  for (const pref of preferences) {
    const re = AUDIO_MATCHERS[pref];
    if (re && re.test(audio)) return true;
  }
  return false;
}

function candidateMatchesSite(candidate, preferences) {
  if (!preferences || preferences.length === 0) return true;
  const site = candidate.torrent_info && candidate.torrent_info.site_name || '';
  for (const pref of preferences) {
    if (site === pref || site.includes(pref) || pref.includes(site)) return true;
  }
  return false;
}

function candidateHasCNSub(candidate) {
  // Match MoviePilot's CNSUB rule: check title + description + labels
  const ti = candidate.torrent_info || {};
  const title = ti.title || '';
  const desc = ti.description || '';
  const labels = (ti.labels || []).join(' ');
  const content = title + ' ' + desc + ' ' + labels;
  return CNSUB_RE.test(content);
}

// ── Main API ────────────────────────────────────────────────────────────────

/**
 * @param {Array} candidates  raw searchCandidates from MoviePilot
 * @param {Object} subjectInfo   task.subjectInfo (must have resolution, doubanRating/userRating, duration)
 * @param {Object} config     full config object
 * @returns {number|null}     selected candidate index, or null if none passes
 */
function getSmartConfig(subjectInfo, config) {
  const subLibId = subjectInfo && subjectInfo.subLibraryId;
  const subLib = subLibId && (config.subLibraries || []).find((s) => s.uuid === subLibId);
  return (subLib && subLib.upgradeSmartSelect) || null;
}

function filterAndSelect(candidates, subjectInfo, config) {
  const approvalPolicy = require('./approvalPolicy');
  if (approvalPolicy.resolveGate('upgrade.candidateSelect', { subjectInfo, config }) !== 'auto') return null;

  const seedPrefs = subjectInfo && subjectInfo.seedPreferences;
  const smartCfg = (seedPrefs && Object.keys(seedPrefs).length > 0)
    ? seedPrefs
    : getSmartConfig(subjectInfo, config);

  if (!smartCfg) return null;

  const hasAnyPreference =
    (smartCfg.codecPreference && smartCfg.codecPreference.length > 0) ||
    (smartCfg.resolutionPreference && smartCfg.resolutionPreference.length > 0) ||
    (smartCfg.audioPreference && smartCfg.audioPreference.length > 0) ||
    (smartCfg.sitePreference && smartCfg.sitePreference.length > 0) ||
    smartCfg.preferCNSub ||
    (typeof smartCfg.maxSizeGB === 'number' && smartCfg.maxSizeGB > 0) ||
    (subjectInfo && typeof subjectInfo.maxSizeGB === 'number' && subjectInfo.maxSizeGB > 0);

  if (!hasAnyPreference) return null;

  // ── Filter ──────────────────────────────────────────────────────────
  const pool = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!candidateMatchesCodec(c, smartCfg.codecPreference)) continue;
    if (!candidateMatchesResolution(c, smartCfg.resolutionPreference)) continue;
    if (!candidateMatchesAudio(c, smartCfg.audioPreference)) continue;
    if (!candidateMatchesSite(c, smartCfg.sitePreference)) continue;
    if (smartCfg.preferCNSub && !candidateHasCNSub(c)) continue;

    // Size cap — prefer subjectInfo.maxSizeGB (from rule), fall back to smartCfg
    const sizeCap = (subjectInfo && typeof subjectInfo.maxSizeGB === 'number')
      ? subjectInfo.maxSizeGB
      : (typeof smartCfg.maxSizeGB === 'number' ? smartCfg.maxSizeGB : null);

    if (sizeCap) {
      const sz = c.torrent_info && c.torrent_info.size;
      if (typeof sz === 'number' && sz > sizeCap * 1024 * 1024 * 1024) continue;
    }
    pool.push({ candidate: c, originalIndex: i });
  }

  if (pool.length === 0) return null;

  // ── Sort by weighted score (50% seeders + 50% size) ─────────────────
  const scored = scorePool(pool);

  // ── Bitrate validation ─────────────────────────────────────────────
  const durationSec = subjectInfo && subjectInfo.duration;

  const target = subjectInfo && subjectInfo.targetBitrate;
  if (typeof durationSec === 'number' && durationSec > 0 && target != null) {
    for (const entry of scored) {
      const size = entry.candidate.torrent_info && entry.candidate.torrent_info.size;
      if (typeof size !== 'number' || size <= 0) continue;

      const estimatedMbps = (size * 8) / (durationSec * 1_000_000);
      if (estimatedMbps >= target) {
        return entry.originalIndex;
      }
    }
    return null;
  }

  return null;
}

function scorePool(pool) {
  let minSeeders = Infinity, maxSeeders = -Infinity, minSize = Infinity, maxSize = -Infinity;
  for (const entry of pool) {
    const s = entry.candidate.torrent_info && entry.candidate.torrent_info.seeders || 0;
    const z = entry.candidate.torrent_info && entry.candidate.torrent_info.size || 0;
    if (s < minSeeders) minSeeders = s;
    if (s > maxSeeders) maxSeeders = s;
    if (z < minSize) minSize = z;
    if (z > maxSize) maxSize = z;
  }
  const seedersRange = maxSeeders - minSeeders || 1;
  const sizeRange = maxSize - minSize || 1;

  return pool.map((entry) => {
    const s = entry.candidate.torrent_info && entry.candidate.torrent_info.seeders || 0;
    const z = entry.candidate.torrent_info && entry.candidate.torrent_info.size || 0;
    const score = 0.5 * ((s - minSeeders) / seedersRange) + 0.5 * ((z - minSize) / sizeRange);
    return { ...entry, score };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Returns the full ranked pool with scores, for download-failure retry.
 */
function getRankedPool(candidates, subjectInfo, config) {
  const approvalPolicy = require('./approvalPolicy');
  if (approvalPolicy.resolveGate('upgrade.candidateSelect', { subjectInfo, config }) !== 'auto') return [];

  const seedPrefs = subjectInfo && subjectInfo.seedPreferences;
  const smartCfg = (seedPrefs && Object.keys(seedPrefs).length > 0)
    ? seedPrefs
    : getSmartConfig(subjectInfo, config);

  if (!smartCfg) return [];

  const hasAnyPreference =
    (smartCfg.codecPreference && smartCfg.codecPreference.length > 0) ||
    (smartCfg.resolutionPreference && smartCfg.resolutionPreference.length > 0) ||
    (smartCfg.audioPreference && smartCfg.audioPreference.length > 0) ||
    (smartCfg.sitePreference && smartCfg.sitePreference.length > 0) ||
    smartCfg.preferCNSub ||
    (typeof smartCfg.maxSizeGB === 'number' && smartCfg.maxSizeGB > 0) ||
    (subjectInfo && typeof subjectInfo.maxSizeGB === 'number' && subjectInfo.maxSizeGB > 0);

  if (!hasAnyPreference) return [];

  const pool = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!candidateMatchesCodec(c, smartCfg.codecPreference)) continue;
    if (!candidateMatchesResolution(c, smartCfg.resolutionPreference)) continue;
    if (!candidateMatchesAudio(c, smartCfg.audioPreference)) continue;
    if (!candidateMatchesSite(c, smartCfg.sitePreference)) continue;
    if (smartCfg.preferCNSub && !candidateHasCNSub(c)) continue;

    const sizeCap = (subjectInfo && typeof subjectInfo.maxSizeGB === 'number')
      ? subjectInfo.maxSizeGB
      : (typeof smartCfg.maxSizeGB === 'number' ? smartCfg.maxSizeGB : null);

    if (sizeCap) {
      const sz = c.torrent_info && c.torrent_info.size;
      if (typeof sz === 'number' && sz > sizeCap * 1024 * 1024 * 1024) continue;
    }
    pool.push({ candidate: c, originalIndex: i });
  }

  return scorePool(pool);
}

module.exports = { filterAndSelect, getRankedPool, getSmartConfig };
