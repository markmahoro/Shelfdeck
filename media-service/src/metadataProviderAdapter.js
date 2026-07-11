'use strict';

const fs = require('fs');
const path = require('path');
const adultSourceIdentity = require('./adultSourceIdentity');
const embyService = require('./services/embyService');
const japaneseJavScraper = require('./services/japaneseJavScraper');

function cleanObject(input = {}) { return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== '')); }
function descriptorForTask(task = {}) { return task.helixAdmission?.sourceAccessDescriptor || {}; }
function embyMetadataFacts(item = {}, episodes = [], serverId = '') {
  return cleanObject({ title: item.name || '', name: item.name || '', type: item.type || '', premiereDate: item.premiereDate || '', genres: item.genres || [], providerIds: item.providerIds || {}, tmdbId: item.tmdbId || '', seriesName: item.seriesName || '', seriesId: item.seriesId || '', seasonNumber: item.parentIndexNumber, episodeNumber: item.indexNumber, episodeCount: episodes.length, people: (item.people || []).map((person) => ({ name: person.name, role: 'actor', providerIds: person.providerIds || {}, sourcePersonKey: person.embyPersonId ? `emby:${serverId}:person:${person.embyPersonId}` : '', source: 'emby', contentKinds: ['general'] })) });
}
function adultMetadataFacts(result = {}, item = {}, adultId = '', adultRegion = '') {
  return cleanObject({ title: result.title || result.generatedTitle || adultId || path.basename(item.path || '', path.extname(item.path || '')), name: result.title || result.generatedTitle || adultId || '', type: 'movie', adultId: result.adultId || adultId, adultRegion, originalTitle: result.originalTitle || '', plot: result.plot || result.overview || result.generatedDescription || '', actors: result.actors || [], matchedPeople: result.matchedPeople || [], actorThumbs: result.actorThumbs || {}, genres: result.genres || [], tags: result.tags || [], studio: result.studio || '', director: result.director || '', series: result.series || '', rating: result.rating, premiered: result.premiered || '', runtimeMinutes: result.runtimeMinutes, posterUrl: result.posterUrl || '', fanartUrl: result.fanartUrl || '', trailerUrl: result.trailerUrl || '', country: result.country || '', needsReview: !!result.needsReview, ai: result.ai || {}, faceClusters: Array.isArray(result.faceClusters) ? result.faceClusters : [], unknownFaces: Array.isArray(result.unknownFaces) ? result.unknownFaces : [], actorConfidence: result.actorConfidence || {}, protagonist: result.protagonist || null });
}
function assertMetadataFacts(facts) { if (!facts || !String(facts.title || '').trim()) throw Object.assign(new Error('Metadata title is missing'), { code: 'KAIROX_METADATA_TITLE_MISSING' }); }
async function observeEmbyMetadata(task, config, subLibrary) {
  const identity = descriptorForTask(task).identityPayload || {};
  const serverId = identity.serverId || subLibrary.embyServerId;
  const server = (config.embyServers || {})[serverId];
  if (!server) throw Object.assign(new Error('Emby server is not configured for Metadata'), { code: 'KAIROX_METADATA_EMBY_SERVER_MISSING' });
  const embyItemId = identity.embyItemId || descriptorForTask(task).locator?.sourceRefId;
  if (!embyItemId) throw Object.assign(new Error('Emby item id is missing from SourceBinding'), { code: 'KAIROX_METADATA_SOURCE_ID_MISSING' });
  const item = await embyService.getItemById(server, embyItemId);
  const episodes = item && item.type === 'season' ? await embyService.getSeasonEpisodes(server, embyItemId) : [];
  return { facts: embyMetadataFacts(item, episodes, serverId), evidence: { adapter: 'emby', embyItemId, serverId, episodeCount: episodes.length } };
}
async function observeFolderMetadata(task, config, subLibrary, resolvedIdentity = {}) {
  const filePath = descriptorForTask(task).locator?.path || task.itemInfo?.path || '';
  if (!filePath || !fs.existsSync(filePath)) throw Object.assign(new Error(`Media file does not exist: ${filePath}`), { code: 'KAIROX_SOURCE_INCIDENT' });
  const item = { ...(task.itemInfo || {}), itemId: task.itemId, path: filePath };
  const region = subLibrary.adultRegion || 'japanese_jav';
  if (region === 'western_adult') throw Object.assign(new Error('Western adult metadata must use the atomic analysis Capability graph'), { code: 'WESTERN_ATOMIC_WORKFLOW_REQUIRED' });
  const adultId = resolvedIdentity.adultId || item.adultMetadata?.adultId || adultSourceIdentity.extractAdultId(path.basename(filePath)) || adultSourceIdentity.extractAdultId(filePath);
  if (!adultId) throw Object.assign(new Error('Adult ID could not be detected from SourceBinding path'), { code: 'KAIROX_METADATA_ID_UNRESOLVED' });
  const result = await japaneseJavScraper.scrapeJapaneseJav({ taskId: task.id, subLib: subLibrary, adultId, onLog: () => {} });
  return { facts: adultMetadataFacts(result, item, adultId, region), evidence: { adapter: 'japanese_jav', region, adultId } };
}

module.exports = { embyMetadataFacts, adultMetadataFacts, assertMetadataFacts, observeEmbyMetadata, observeFolderMetadata };
