'use strict';

const fs = require('fs');
const path = require('path');
const moviepilotService = require('../services/moviepilotService');
const smartSeedSelect = require('../smartSeedSelect');
const { mapTransferPath } = require('./upgradeCapabilities');
const seasonReplacement = require('../seriesSeasonReplacementService');
const sourceAccessResolver = require('../sourceAccessResolver');
const { findNfoTmdbId } = require('./mediaAssetCapabilities');

function registerSeriesUpgradeCapabilities(register) {
  register({ capability: 'series.upgrade.identity.resolve', allowedTargetGates: ['optimize'], execute: async ({ task, input, parameters }) => {
    if (!input.integration.available) throw Object.assign(new Error('MoviePilot integration is unavailable'), { code: 'MOVIEPILOT_UNAVAILABLE' });
    const title = String(task.subjectInfo && (task.subjectInfo.name || task.subjectInfo.title) || '');
    const tmdbId = String(task.subjectInfo && task.subjectInfo.tmdbId || '');
    const seasonKey = String(parameters.seasonKey || '');
    if (!title || !seasonKey) throw Object.assign(new Error('Series Upgrade requires title and seasonKey'), { code: 'SERIES_UPGRADE_IDENTITY_INCOMPLETE' });
    return { result: { title, tmdbId, seasonKey, mediaKind: 'series' } };
  } });

  register({ capability: 'source.season-upgrade.search', allowedTargetGates: ['optimize'], execute: async ({ task, config, input }) => {
    const identity = input.identity;
    const response = await moviepilotService.searchTorrents(config.moviepilot || {}, `${identity.title} S${String(identity.seasonKey).padStart(2, '0')}`);
    const raw = Array.isArray(response) ? response : response && response.data || [];
    const matching = raw.filter((entry) => {
      const title = String(entry.torrent_info && entry.torrent_info.title || entry.title || '');
      return new RegExp(`(?:^|[ ._-])S0*${Number(identity.seasonKey)}(?:[^0-9]|$)`, 'i').test(title);
    });
    if (!matching.length) throw Object.assign(new Error('MoviePilot returned no exact Season candidate'), { code: 'SERIES_SEASON_UPGRADE_CANDIDATE_NOT_FOUND' });
    const candidates = matching.map((entry, index) => ({ index, title: entry.torrent_info && entry.torrent_info.title || entry.title || '', site: entry.torrent_info && entry.torrent_info.site_name || '', size: Number(entry.torrent_info && entry.torrent_info.size || 0), torrentInfo: entry.torrent_info || entry }));
    const recommendedIndex = smartSeedSelect.filterAndSelect(matching, task.subjectInfo || {}, config);
    return { result: { candidates, rawCandidates: matching, identity, recommendedIndex, forceConfirmation: recommendedIndex == null } };
  } });

  register({ capability: 'source.season-upgrade.output.resolve', allowedTargetGates: ['optimize'], execute: async ({ task, event, config, input, parameters }) => {
    const transfer = input.transfer.transfer || {};
    const remotePath = transfer.dest || transfer.target_path || transfer.transfer_path || transfer.path || '';
    const localRoot = mapTransferPath(remotePath, config.moviepilot || {}, config.upgradeStagingLocalPath || '');
    if (!localRoot || !fs.existsSync(localRoot)) throw Object.assign(new Error('Season package is not visible in upgrade staging'), { code: 'SERIES_SEASON_STAGING_PENDING', retryable: true });
    return { result: { assetId: `season-package:${event.eventId}`, sourcePath: localRoot, path: localRoot, outputPath: localRoot, workDir: localRoot, stagedRoot: localRoot, replacementScope: 'season', seasonKey: parameters.seasonKey, producingEventId: event.eventId } };
  } });

  register({ capability: 'series.season-package.verify', allowedTargetGates: ['optimize'], execute: async ({ task, input, parameters }) => {
    const stagedAsset = input.stagedAsset;
    const seasonKey = String(parameters.seasonKey || stagedAsset.seasonKey || '');
    const assets = task.helixAdmission && task.helixAdmission.assets || [];
    const inspection = seasonReplacement.inspectPackage(stagedAsset.stagedRoot, assets, seasonKey);
    const expectedTmdb = String(task.subjectInfo && task.subjectInfo.tmdbId || '');
    const explicitTmdb = findNfoTmdbId(stagedAsset.stagedRoot);
    if (expectedTmdb && explicitTmdb && expectedTmdb !== explicitTmdb) throw Object.assign(new Error('Season package TMDB identity mismatches the managed Series'), { code: 'SERIES_SEASON_TMDB_MISMATCH' });
    const strongIdentity = !!(expectedTmdb && explicitTmdb && expectedTmdb === explicitTmdb);
    return { result: { stagedAsset, objectiveSatisfied: true, valid: true, strongIdentity, inspection, seasonKey } };
  } });

  register({ capability: 'series.season.replace', allowedTargetGates: ['optimize'], execute: async (context) => {
    const verified = context.input.verifiedSeasonPackage;
    sourceAccessResolver.assertTaskRevision(context.task);
    context.assertFence('before_series_season_replace');
    const replacement = seasonReplacement.replaceSeason({ packageRoot: verified.stagedAsset.stagedRoot, currentAssets: context.task.helixAdmission && context.task.helixAdmission.assets || [], seasonKey: verified.seasonKey, operationId: context.event.eventId });
    const mutation = { mutationId: `mutation:${context.event.eventId}`, subjectId: context.task.subjectId, taskId: context.task.id, eventId: context.event.eventId,
      mutationKind: 'season_replace', oldSourceEvidence: { assets: context.task.helixAdmission && context.task.helixAdmission.assets || [] },
      newSourceEvidence: { path: replacement.targetPath, seasonKey: verified.seasonKey, assets: replacement.installedAssets }, admissionGeneration: context.task.helixAdmission && context.task.helixAdmission.admissionGeneration || 0,
      sourceRevision: context.task.helixAdmission && context.task.helixAdmission.sourceRevision || '', mappingRevision: sourceAccessResolver.getRevision(), committedAt: new Date().toISOString() };
    return { result: { sourceMutationResult: mutation }, commitMarker: mutation.mutationId };
  } });
}

module.exports = { registerSeriesUpgradeCapabilities };
