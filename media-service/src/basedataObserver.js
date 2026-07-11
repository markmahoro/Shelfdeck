'use strict';

const fs = require('fs');
const embyService = require('./services/embyService');
const transcodeService = require('./services/transcodeService');

function resolutionPixels(value) { const [width = 0, height = 0] = String(value || '').split('x').map((part) => Number(part) || 0); return width * height; }
function aggregateEmbyFacts(items = []) {
  const candidates = items.filter(Boolean);
  const technical = candidates.filter((item) => ['movie', 'episode'].includes(item.type));
  const rows = technical.length > 0 ? technical : candidates;
  const bestResolution = rows.reduce((selected, item) => resolutionPixels(item.resolution) > resolutionPixels(selected) ? item.resolution : selected, '');
  const bitrateValues = rows.map((item) => Number(item.bitrate) || 0).filter((value) => value > 0);
  return {
    path: rows.find((item) => item.path)?.path || '',
    size: rows.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
    duration: rows.reduce((sum, item) => sum + (Number(item.duration) || 0), 0),
    bitrate: bitrateValues.length ? Math.round(bitrateValues.reduce((sum, value) => sum + value, 0) / bitrateValues.length) : 0,
    resolution: bestResolution,
    codec: rows.find((item) => item.codec)?.codec || '',
    audioCodecs: [...new Set(rows.flatMap((item) => item.audioCodecs || []))],
    isDiscLike: rows.some((item) => item.isDiscLike),
    episodeCount: technical.filter((item) => item.type === 'episode').length,
  };
}
async function observeEmby(admission, config) {
  const descriptor = admission.sourceAccessDescriptor || {};
  const identity = descriptor.identityPayload || {};
  const server = (config.embyServers || {})[identity.serverId];
  if (!server) throw Object.assign(new Error('Emby server is not configured for Basedata'), { code: 'BASEDATA_EMBY_SERVER_MISSING' });
  if (!identity.embyItemId) throw Object.assign(new Error('Emby item id is missing from SourceBinding'), { code: 'BASEDATA_SOURCE_ID_MISSING' });
  const item = await embyService.getItemById(server, identity.embyItemId);
  const episodes = item && item.type === 'season' ? await embyService.getSeasonEpisodes(server, identity.embyItemId) : [];
  return { ...aggregateEmbyFacts([item, ...episodes]), sourceRefId: identity.embyItemId };
}
async function observeFile(admission, config) {
  const filePath = admission.sourceAccessDescriptor?.locator?.path || '';
  if (!filePath || !fs.existsSync(filePath)) throw Object.assign(new Error('Bound source file is unavailable'), { code: 'BASEDATA_SOURCE_UNAVAILABLE' });
  const stat = fs.statSync(filePath);
  const summary = await transcodeService.probeSummary(config, filePath, { timeoutMs: 5000 });
  return { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, duration: Math.round(summary.durationSec || 0), bitrate: summary.durationSec > 0 ? Math.round((stat.size * 8) / summary.durationSec) : 0, resolution: summary.width && summary.height ? `${summary.width}x${summary.height}` : '', codec: summary.videoCodec || '', audioCodecs: summary.audioCodec ? [String(summary.audioCodec).toLowerCase()] : [], isDiscLike: false };
}

module.exports = { aggregateEmbyFacts, observeEmby, observeFile };
