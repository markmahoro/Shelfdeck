'use strict';

const fs = require('fs');
const path = require('path');
const moviepilotService = require('../services/moviepilotService');
const sourceAccessResolver = require('../sourceAccessResolver');
const smartSeedSelect = require('../smartSeedSelect');

function sourcePathFor(task) {
  const canonical = task.subjectInfo && (task.subjectInfo.path || task.subjectInfo.sourcePath)
    || task.helixAdmission && task.helixAdmission.sourceAccessDescriptor
      && task.helixAdmission.sourceAccessDescriptor.locator
      && task.helixAdmission.sourceAccessDescriptor.locator.path;
  return sourceAccessResolver.resolve(canonical, { mustExist: true }).accessPath;
}

function mapTransferPath(remotePath, moviepilot, stagingRoot) {
  const remote = String(remotePath || '');
  const base = String(moviepilot.savePath || '');
  if (!remote || !base || !stagingRoot) return '';
  const normalizedRemote = remote.replace(/\\/g, '/');
  const normalizedBase = base.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalizedRemote !== normalizedBase && !normalizedRemote.startsWith(`${normalizedBase}/`)) return '';
  return path.join(stagingRoot, ...normalizedRemote.slice(normalizedBase.length).replace(/^\//, '').split('/').filter(Boolean));
}

function findMediaFile(root) {
  const extensions = new Set(['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov']);
  const candidates = [];
  const visit = (entry) => {
    const stat = fs.statSync(entry);
    if (stat.isFile() && extensions.has(path.extname(entry).toLowerCase())) candidates.push({ path: entry, size: stat.size });
    else if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
  };
  visit(root);
  return candidates.sort((a, b) => b.size - a.size)[0]?.path || '';
}

function retryable(message, code, details = {}) {
  return Object.assign(new Error(message), { code, retryable: true, details });
}
function newestMtime(root) {
  let newest = 0;
  const visit = (entry, depth) => {
    const stat = fs.statSync(entry); newest = Math.max(newest, stat.mtimeMs || 0);
    if (stat.isDirectory() && depth < 4) for (const name of fs.readdirSync(entry)) visit(path.join(entry, name), depth + 1);
  };
  visit(root, 0); return newest;
}

function registerUpgradeCapabilities(register) {
  register({ capability: 'integration.moviepilot.check', allowedTargetGates: ['optimize'], execute: async ({ config }) => {
    const mp = config.moviepilot || {};
    if (!mp.baseUrl || !mp.apiKey) throw Object.assign(new Error('MoviePilot is not configured'), { code: 'MOVIEPILOT_NOT_CONFIGURED' });
    const health = await moviepilotService.checkConnection(mp);
    if (!health || health.ok === false || health.success === false) throw Object.assign(new Error(health && health.message || 'MoviePilot connection check failed'), { code: 'MOVIEPILOT_UNAVAILABLE' });
    return { result: { available: true, baseUrl: mp.baseUrl } };
  } });

  register({ capability: 'media.upgrade.identity.resolve', allowedTargetGates: ['optimize'], execute: async ({ task, config, input }) => {
    if (!input.integration.available) throw Object.assign(new Error('MoviePilot integration is unavailable'), { code: 'MOVIEPILOT_UNAVAILABLE' });
    const title = task.subjectInfo && (task.subjectInfo.name || task.subjectInfo.title) || '';
    if (!title) throw Object.assign(new Error('Upgrade identity title is missing'), { code: 'UPGRADE_TITLE_MISSING' });
    let tmdbId = String(task.subjectInfo && task.subjectInfo.tmdbId || ''); let originalTitle = '';
    if (!tmdbId) {
      const first = await moviepilotService.searchMediaByTitle(config.moviepilot || {}, title);
      const rows = Array.isArray(first) ? first : [];
      let hit = rows.find((entry) => entry.tmdb_id);
      originalTitle = String(rows[0] && rows[0].original_title || '');
      if (!hit && originalTitle) {
        const fallback = await moviepilotService.searchMediaByTitle(config.moviepilot || {}, originalTitle);
        hit = (Array.isArray(fallback) ? fallback : []).find((entry) => entry.tmdb_id);
      }
      tmdbId = String(hit && hit.tmdb_id || '');
      originalTitle = String(hit && (hit.original_title || hit.title) || originalTitle);
    }
    const pathValue = task.subjectInfo && task.subjectInfo.path || '';
    const year = String(task.subjectInfo && task.subjectInfo.year || (pathValue.match(/\((\d{4})\)/) || [])[1] || '');
    return { result: { title, originalTitle, tmdbId, year, mediaKind: task.subjectInfo && task.subjectInfo.type || 'movie' } };
  } });

  register({
    capability: 'source.upgrade.search',
    allowedTargetGates: ['optimize'],
    defaultResourceRequest: { resourceType: 'moviepilot' },
    execute: async ({ task, config, input }) => {
      const mp = config.moviepilot || {};
      const identity = input.identity;
      const keyword = [identity.title, identity.year].filter(Boolean).join(' ');
      let response = await moviepilotService.searchTorrents(mp, keyword);
      const raw = Array.isArray(response) ? response : response && response.data || [];
      let sourceRows = raw;
      if (!sourceRows.length && identity.originalTitle) {
        response = await moviepilotService.searchTorrents(mp, [identity.originalTitle, identity.year].filter(Boolean).join(' '));
        sourceRows = Array.isArray(response) ? response : response && response.data || [];
      }
      const candidates = sourceRows.map((entry, index) => ({
        index,
        title: entry.torrent_info && entry.torrent_info.title || entry.title || '',
        site: entry.torrent_info && entry.torrent_info.site_name || '',
        size: Number(entry.torrent_info && entry.torrent_info.size || 0),
        torrentInfo: entry.torrent_info || entry,
      }));
      if (!candidates.length) throw Object.assign(new Error('MoviePilot returned no upgrade candidate'), { code: 'UPGRADE_CANDIDATE_NOT_FOUND' });
      const recommendedIndex = smartSeedSelect.filterAndSelect(sourceRows, task.subjectInfo || {}, config);
      const forceConfirmation = !sourceRows.some((entry) => entry && entry.meta_info != null) || recommendedIndex == null;
      return { result: { candidates, rawCandidates: sourceRows, identity, recommendedIndex, forceConfirmation } };
    },
  });

  register({
    capability: 'source.upgrade.request',
    allowedTargetGates: ['optimize'],
    sideEffect: true,
    idempotency: 'commit_once',
    defaultResourceRequest: { resourceType: 'moviepilot' },
    cancel: async ({ event, config }) => {
      const downloadId = event.result && event.result.downloadId;
      if (downloadId) await moviepilotService.deleteDownload(config.moviepilot || {}, downloadId);
    },
    execute: async (context) => {
      const search = context.input.candidates;
      const confirmed = context.event.result && context.event.result.confirmData && context.event.result.confirmData.selectedIndex;
      const selectedIndex = Number(confirmed == null ? search.recommendedIndex : confirmed);
      const candidate = search.candidates && search.candidates[selectedIndex];
      if (!candidate) throw Object.assign(new Error('Upgrade candidate selection is invalid'), { code: 'UPGRADE_CANDIDATE_SELECTION_INVALID' });
      const mp = context.config.moviepilot || {};
      context.assertFence('before_moviepilot_download_request');
      const added = await moviepilotService.addDownload(mp, { torrentInfo: candidate.torrentInfo, savePath: mp.savePath || undefined });
      if (!added || added.success === false) throw Object.assign(new Error(added && added.message || 'MoviePilot rejected the download'), { code: 'UPGRADE_DOWNLOAD_REJECTED' });
      const downloadId = added.data && added.data.download_id || '';
      if (!downloadId) throw Object.assign(new Error('MoviePilot did not return download_id'), { code: 'UPGRADE_DOWNLOAD_ID_MISSING' });
      return {
        result: { downloadId, candidate: { index: candidate.index, title: candidate.title, site: candidate.site } },
        commitMarker: `moviepilot-download:${downloadId}`,
      };
    },
  });

  register({
    capability: 'source.upgrade.observe-download',
    allowedTargetGates: ['optimize'],
    defaultResourceRequest: { resourceType: 'moviepilot' },
    cancel: async ({ event, config }) => {
      const downloadId = event.input && event.input.resolved && event.input.resolved.request && event.input.resolved.request.downloadId;
      if (downloadId) await moviepilotService.deleteDownload(config.moviepilot || {}, downloadId);
    },
    execute: async (context) => {
      const request = context.input.request;
      const active = await moviepilotService.listDownloads(context.config.moviepilot || {});
      const row = (Array.isArray(active) ? active : []).find((entry) => [entry.hash, entry.hashString, entry.download_hash].includes(request.downloadId));
      if (row) throw retryable('MoviePilot download is still active', 'UPGRADE_DOWNLOAD_IN_PROGRESS', { downloadId: request.downloadId });
      return { result: { downloadId: request.downloadId, completed: true } };
    },
  });

  register({
    capability: 'source.upgrade.observe-transfer',
    allowedTargetGates: ['optimize'],
    defaultResourceRequest: { resourceType: 'moviepilot' },
    execute: async (context) => {
      const request = context.input.request;
      const response = await moviepilotService.getTransferHistory(context.config.moviepilot || {}, 50);
      const rows = Array.isArray(response) ? response : response && response.data || [];
      const transfer = rows.find((entry) => [entry.download_hash, entry.downloadHash, entry.hash].includes(request.downloadId));
      if (!transfer) throw retryable('MoviePilot transfer is not visible yet', 'UPGRADE_TRANSFER_PENDING', { downloadId: request.downloadId });
      return { result: { downloadId: request.downloadId, transfer } };
    },
  });

  register({
    capability: 'source.upgrade.output.resolve',
    allowedTargetGates: ['optimize'],
    defaultResourceRequest: { resourceType: 'filesystem' },
    execute: async (context) => {
      const transfer = context.input.transfer.transfer || {};
      const remotePath = transfer.dest || transfer.target_path || transfer.transfer_path || transfer.path || '';
      const localRoot = mapTransferPath(remotePath, context.config.moviepilot || {}, context.config.upgradeStagingLocalPath || '');
      const outputPath = localRoot && fs.existsSync(localRoot) ? findMediaFile(localRoot) : '';
      if (!outputPath) throw retryable('MoviePilot transfer output cannot be resolved in upgrade staging', 'UPGRADE_STAGING_OUTPUT_PENDING', { remotePath });
      const sourcePath = sourcePathFor(context.task);
      return { result: { assetId: `staged:${context.event.eventId}`, path: outputPath, outputPath, sourcePath, originalSizeBytes: fs.statSync(sourcePath).size, workDir: path.dirname(outputPath), stagedRoot: localRoot, targetFolder: path.dirname(sourcePath), replacementScope: 'folder', transfer, producingEventId: context.event.eventId } };
    },
  });
  register({ capability: 'source.upgrade.output.settle', allowedTargetGates: ['optimize'], execute: async ({ config, input }) => {
    const stagedAsset = input.stagedAsset;
    const settleMs = Math.max(0, Number(config.upgradeScrapingSettleSeconds) || 30) * 1000;
    const ageMs = Date.now() - newestMtime(stagedAsset.stagedRoot || stagedAsset.workDir);
    if (ageMs < settleMs) throw retryable('MoviePilot staged output is still settling', 'UPGRADE_STAGING_STILL_CHANGING', { ageMs, settleMs });
    return { result: { ...stagedAsset, settledAt: new Date().toISOString(), settleEvidence: { ageMs, settleMs } } };
  } });
}

module.exports = { registerUpgradeCapabilities, mapTransferPath, findMediaFile, newestMtime };
