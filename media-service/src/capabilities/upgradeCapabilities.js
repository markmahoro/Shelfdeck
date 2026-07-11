'use strict';

const fs = require('fs');
const path = require('path');
const moviepilotService = require('../services/moviepilotService');
const sourceAccessResolver = require('../sourceAccessResolver');

function sourcePathFor(task) {
  const canonical = task.itemInfo && (task.itemInfo.path || task.itemInfo.sourcePath)
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

function registerUpgradeCapabilities(register) {
  register({
    capability: 'source.upgrade.search',
    allowedTargetGates: ['optimize'],
    defaultResourceRequest: { resourceType: 'moviepilot' },
    execute: async ({ task, config }) => {
      const mp = config.moviepilot || {};
      if (!mp.baseUrl || !mp.apiKey) throw Object.assign(new Error('MoviePilot is not configured'), { code: 'MOVIEPILOT_NOT_CONFIGURED' });
      const title = task.itemInfo && (task.itemInfo.name || task.itemInfo.title) || '';
      if (!title) throw Object.assign(new Error('Upgrade search title is missing'), { code: 'UPGRADE_TITLE_MISSING' });
      const response = await moviepilotService.searchTorrents(mp, title);
      const raw = Array.isArray(response) ? response : response && response.data || [];
      const candidates = raw.map((entry, index) => ({
        index,
        title: entry.torrent_info && entry.torrent_info.title || entry.title || '',
        site: entry.torrent_info && entry.torrent_info.site_name || '',
        size: Number(entry.torrent_info && entry.torrent_info.size || 0),
        torrentInfo: entry.torrent_info || entry,
      }));
      if (!candidates.length) throw Object.assign(new Error('MoviePilot returned no upgrade candidate'), { code: 'UPGRADE_CANDIDATE_NOT_FOUND' });
      return { result: { candidates } };
    },
  });

  register({
    capability: 'source.upgrade.request',
    allowedTargetGates: ['optimize'],
    sideEffect: true,
    idempotency: 'commit_once',
    defaultResourceRequest: { resourceType: 'moviepilot' },
    execute: async (context) => {
      const search = context.input.candidates;
      const selectedIndex = Number(context.event.result && context.event.result.confirmData && context.event.result.confirmData.selectedIndex || 0);
      const candidate = search.candidates && search.candidates[selectedIndex];
      if (!candidate) throw Object.assign(new Error('Upgrade candidate selection is invalid'), { code: 'UPGRADE_CANDIDATE_SELECTION_INVALID' });
      const mp = context.config.moviepilot || {};
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
}

module.exports = { registerUpgradeCapabilities, mapTransferPath, findMediaFile };
