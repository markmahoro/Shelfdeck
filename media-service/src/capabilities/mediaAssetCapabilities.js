'use strict';

const fs = require('fs');
const path = require('path');

function findNfoTmdbId(root) {
  if (!root || !fs.existsSync(root)) return '';
  const queue = [{ path: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current.path, { withFileTypes: true })) {
      const target = path.join(current.path, entry.name);
      if (entry.isDirectory() && current.depth < 3) queue.push({ path: target, depth: current.depth + 1 });
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nfo')) {
        const body = fs.readFileSync(target, 'utf8');
        const match = body.match(/<(?:tmdbid|tmdb_id)>\s*(\d+)\s*<\//i) || body.match(/tmdb[^0-9]{0,20}(\d{2,})/i);
        if (match) return match[1];
      }
    }
  }
  return '';
}

function registerMediaAssetCapabilities(register) {
  register({ capability: 'media.identity.inspect', allowedTargetGates: ['optimize'], execute: async ({ task, input }) => {
    const stagedAsset = input.stagedAsset;
    const expectedTmdbId = String(task.itemInfo && (task.itemInfo.tmdbId || task.itemInfo.providerIds && (task.itemInfo.providerIds.Tmdb || task.itemInfo.providerIds.tmdb)) || '');
    const actualTmdbId = findNfoTmdbId(stagedAsset.stagedRoot || stagedAsset.workDir || path.dirname(stagedAsset.path));
    const matched = !!expectedTmdbId && !!actualTmdbId && expectedTmdbId === actualTmdbId;
    return { result: { stagedAsset, expectedTmdbId, actualTmdbId, matched, reason: matched ? 'strong_identity_match' : !expectedTmdbId ? 'expected_identity_missing' : !actualTmdbId ? 'staged_identity_missing' : 'identity_mismatch' } };
  } });
  register({ capability: 'media.identity.accept', allowedTargetGates: ['optimize'], execute: async ({ input }) => ({ result: input.inspection.stagedAsset }) });
}

module.exports = { registerMediaAssetCapabilities, findNfoTmdbId };
