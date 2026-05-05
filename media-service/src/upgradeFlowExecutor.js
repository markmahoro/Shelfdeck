'use strict';

/**
 * UpgradeFlowExecutor (UPGRADE_FLOW.md).
 *
 * Flow phases: precheck → planning → [pauseForConfirm] → executing → pre_replace_verify → replace → verify → done
 * Bidirectional API with TaskScheduler.
 */

const fs = require('fs');
const path = require('path');
const taskStore = require('./taskStore');
const configStore = require('./configStore');
const moviepilotService = require('./services/moviepilotService');
const smartSeedSelect = require('./smartSeedSelect');

let scheduler = null;
function setScheduler(s) { scheduler = s; }

// Per-task abort flags (set by pause/cancel, checked during polling)
const abortFlags = new Map();

function appendLog(taskId, level, msg) {
  const entry = { ts: new Date().toISOString(), level, msg };
  taskStore.updateTask(taskId, { logs: [entry] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

// ── Config helpers ────────────────────────────────────────────────────────────

function getMpConfig() {
  const cfg = configStore.loadConfig();
  const mp = cfg.moviepilot || {};
  if (!mp.baseUrl || !mp.apiKey) return null;
  return { baseUrl: mp.baseUrl, apiKey: mp.apiKey, savePath: mp.savePath || '' };
}

function resolveEmbyPath(embyPath, task) {
  const cfg = configStore.loadConfig();
  const subLibId = task && task.itemInfo && task.itemInfo.subLibraryId;
  const subLib = subLibId && (cfg.subLibraries || []).find((s) => s.uuid === subLibId);
  const from = (subLib && subLib.pathMapFrom || '').trim();
  const to = (subLib && subLib.pathMapTo || '').trim();
  if (from && to && embyPath && embyPath.startsWith(from)) {
    const relative = embyPath.slice(from.length).replace(/^\//, '');
    return path.join(to, relative);
  }
  return embyPath;
}

// Map MoviePilot transfer dest path to ShelfDeck staging path.
// Both containers bind-mount the same physical directory.
function resolveStagingFromTransfer(mpDest, mpSavePath, localStagingPath) {
  if (!mpDest || !localStagingPath) return null;
  const mpPrefix = mpSavePath.replace(/\/+$/, '');
  if (mpDest.startsWith(mpPrefix)) {
    return mpDest.replace(mpPrefix, localStagingPath);
  }
  return null;
}

// ── NFO parsing ───────────────────────────────────────────────────────────────

function extractTmdbIdFromNfo(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.nfo')) {
        const nfoPath = path.join(dirPath, e.name);
        const content = fs.readFileSync(nfoPath, 'utf8');
        const m = content.match(/<tmdbid>(\d+)<\/tmdbid>/i);
        if (m) return parseInt(m[1], 10);
      }
    }
  } catch (_) {}
  return null;
}

// ── Folder replace ────────────────────────────────────────────────────────────

function atomicReplaceFolder(sourceDir, targetDir, taskId) {
  if (!fs.existsSync(sourceDir)) throw new Error('Source folder not found: ' + sourceDir);
  if (!fs.existsSync(targetDir)) throw new Error('Target folder not found: ' + targetDir);

  const parent = path.dirname(targetDir);
  const base = path.basename(targetDir);
  const bakDir = path.join(parent, base + '.etp.bak');
  const newDir = path.join(parent, base + '.etp.new');

  // Clean up any leftover .etp.new from a previous failed attempt
  if (fs.existsSync(newDir)) {
    fs.rmSync(newDir, { recursive: true, force: true });
  }

  appendLog(taskId, 'info', `Replace: renaming old → ${bakDir}`);
  fs.renameSync(targetDir, bakDir);

  try {
    appendLog(taskId, 'info', `Replace: copying staging → ${newDir}`);
    copyDirSync(sourceDir, newDir);

    appendLog(taskId, 'info', `Replace: promoting ${newDir} → ${targetDir}`);
    fs.renameSync(newDir, targetDir);

    appendLog(taskId, 'info', 'Replace: cleaning up staging source');
    fs.rmSync(sourceDir, { recursive: true, force: true });
  } catch (e) {
    // Rollback: restore original
    appendLog(taskId, 'error', `Replace failed: ${e.message}. Rolling back.`);
    if (fs.existsSync(newDir)) {
      try { fs.rmSync(newDir, { recursive: true, force: true }); } catch (_) {}
    }
    if (fs.existsSync(bakDir) && !fs.existsSync(targetDir)) {
      fs.renameSync(bakDir, targetDir);
    }
    throw e;
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Polling helper ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAborted(taskId) {
  return abortFlags.get(taskId) === true;
}


function waitForDownload(taskId, mpConfig, hashString) {
  const start = Date.now();
  const pollInterval = 5000;
  let seenBefore = false; // tracks whether we've ever matched a download

  async function poll() {
    if (isAborted(taskId)) return { aborted: true };

    const downloads = await moviepilotService.listDownloads(mpConfig);
    const list = Array.isArray(downloads) ? downloads : [];

    const dl = hashString
      ? list.find((d) => d.hash === hashString || d.hashString === hashString || d.download_hash === hashString) || null
      : null;

    if (!dl) {
      // If we previously tracked a download and now it's gone, it was completed and auto-removed
      if (seenBefore) {
        return { aborted: false, done: true, autoRemoved: true };
      }
      // Grace period for download to appear in MP queue
      if (Date.now() - start > 120000) {
        throw new Error('Download not found in queue after 120s');
      }
      await sleep(pollInterval);
      return poll();
    }

    seenBefore = true;

    const pct = typeof dl.progress === 'number' ? dl.progress : 0;
    const mpTmdbId = (dl.media && dl.media.tmdbid) || null;
    const updates = { progress: pct };
    if (mpTmdbId) updates.itemInfo = taskStore.getTask(taskId)?.itemInfo;
    if (mpTmdbId && updates.itemInfo) updates.itemInfo = { ...updates.itemInfo, mpTmdbId };
    taskStore.updateTask(taskId, updates);

    if (dl.state === 'downloading' || dl.state === 'pending') {
      await sleep(pollInterval);
      return poll();
    }

    if (dl.state === 'completed' || dl.state === 'seeding' || dl.state === 'uploading' || String(dl.progress) === '100') {
      return { aborted: false, done: true, download: dl };
    }

    if (dl.state === 'error' || dl.state === 'failed' || dl.state === 'missingFiles') {
      throw new Error('Download failed: state=' + (dl.state || 'unknown'));
    }

    // Other states — keep polling
    await sleep(pollInterval);
    return poll();
  }

  return poll();
}

// Wait for MoviePilot to finish scraping/transfer. MoviePilot moves the scraped
// folder into place and records it in transfer history keyed by download_hash.
// Returns the matched transfer entry so the caller can locate the correct files.
async function waitForScraping(taskId, mpConfig) {
  const start = Date.now();
  const maxWaitMs = 10 * 60 * 1000; // 10 min timeout
  const pollInterval = 5000;

  const task = taskStore.getTask(taskId);
  const downloadHash = (task && task.itemInfo && task.itemInfo.downloadHash) || null;

  if (!downloadHash) {
    appendLog(taskId, 'warn', 'No download hash — cannot match transfer, falling through');
    return null;
  }

  appendLog(taskId, 'info', `Waiting for MoviePilot scraping (download_hash=${downloadHash.slice(0, 12)}...)`);

  while (Date.now() - start < maxWaitMs) {
    if (isAborted(taskId)) return null;

    await sleep(pollInterval);

    try {
      const hist = await moviepilotService.getTransferHistory(mpConfig, 20);
      const list = (hist && hist.data && hist.data.list) || (hist && hist.list) || [];
      // A single download can produce multiple transfers (video + subtitles).
      // Prefer the video file transfer — its dest path tells us where the media is.
      const mediaExts = ['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov'];
      const match = list.find((t) => {
        if (t.download_hash !== downloadHash) return false;
        const d = t.dest || '';
        return mediaExts.includes(path.extname(d).toLowerCase());
      }) || list.find((t) => t.download_hash === downloadHash); // fallback: any match

      if (match) {
        const tmdbId = match.tmdbid || null;
        const destPath = match.dest || '';
        const mpSeasons = match.seasons || null;

        // Store transfer metadata on task so pre_replace_verify can locate the correct files
        taskStore.updateTask(taskId, {
          itemInfo: {
            ...taskStore.getTask(taskId).itemInfo,
            mpTmdbId: tmdbId || taskStore.getTask(taskId).itemInfo.mpTmdbId,
            mpSeasons: mpSeasons || taskStore.getTask(taskId).itemInfo.mpSeasons,
            stagingTransferDest: destPath,
          },
        });

        appendLog(taskId, 'info', `Transfer detected (id=${match.id}, tmdb=${tmdbId || '?'}, seasons=${mpSeasons || '?'}), waiting for scraping to settle...`);

        // MoviePilot fires MetadataScrape asynchronously via event queue.
        // Wait for scraping to finish generating NFO/posters before proceeding.
        const cfg = configStore.loadConfig();
        const settleSec = cfg.upgradeScrapingSettleSeconds || 1800;
        appendLog(taskId, 'info', `Waiting ${settleSec}s for MoviePilot scraping to complete...`);
        await sleep(settleSec * 1000);

        appendLog(taskId, 'info', `Scraping settle wait complete (transfer id=${match.id}, tmdb=${tmdbId || '?'})`);
        return match;
      }
    } catch (_) {
      // Keep polling
    }
  }

  appendLog(taskId, 'warn', 'Scraping timeout — proceeding anyway');
  return null;
}

// ── Flow Executor API ─────────────────────────────────────────────────────────

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;

  abortFlags.delete(taskId);
  const rp = task.resumePoint || 'upgrade_precheck';

  if (rp === 'upgrade_precheck') {
    await runPrecheck(taskId, task);
  } else if (rp === 'upgrade_planning') {
    await runPlanning(taskId, task);
  } else if (rp === 'upgrade_executing') {
    await runExecuting(taskId, task);
  } else if (rp === 'upgrade_pre_replace_verify') {
    await runPreReplaceVerify(taskId, task);
  } else if (rp === 'upgrade_replace') {
    await runReplace(taskId, task, configStore.loadConfig());
  }
}

// ── Phase: precheck ───────────────────────────────────────────────────────────

async function runPrecheck(taskId, task) {
  setPhase(taskId, 'precheck');
  appendLog(taskId, 'info', 'Upgrade precheck started');

  const mpConfig = getMpConfig();
  if (!mpConfig) {
    appendLog(taskId, 'error', 'MoviePilot not configured (missing baseUrl or apiKey)');
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
    return;
  }

  try {
    const conn = await moviepilotService.checkConnection(mpConfig);
    if (!conn.ok) {
      appendLog(taskId, 'error', 'MoviePilot connection check failed');
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
      return;
    }
    appendLog(taskId, 'info', `MoviePilot connected: ${mpConfig.baseUrl}`);

    // Proceed to planning
    taskStore.updateTask(taskId, { resumePoint: 'upgrade_planning' });
    setImmediate(() => runPlanning(taskId, taskStore.getTask(taskId)));
  } catch (e) {
    appendLog(taskId, 'error', `Precheck failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

// ── Phase: planning ───────────────────────────────────────────────────────────

async function runPlanning(taskId, task) {
  setPhase(taskId, 'planning');
  appendLog(taskId, 'info', 'Searching for upgrade candidates');

  const mpConfig = getMpConfig();
  if (!mpConfig) {
    appendLog(taskId, 'error', 'MoviePilot config lost during planning');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  const itemName = (task.itemInfo && (task.itemInfo.name || task.itemInfo.title)) || '';
  if (!itemName) {
    appendLog(taskId, 'error', 'No item name available for search');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  const itemPath = (task.itemInfo && task.itemInfo.path) || '';
  const itemType = (task.itemInfo && task.itemInfo.type) || '';

  try {
    let candidates = [];

    if (itemType === 'season') {
      // ── Season: TMDB exact search with season filter ──
      const seriesName = (task.itemInfo && task.itemInfo.seriesName) || itemName;
      const snum = (task.itemInfo && task.itemInfo.seasonNumber) || null;
      appendLog(taskId, 'info', `Resolving TMDB ID for "${seriesName}"...`);

      const mediaResults = await moviepilotService.searchMediaByTitle(mpConfig, seriesName);
      const mediaList = Array.isArray(mediaResults) ? mediaResults : [];

      // Try TMDB exact search first (if TMDB ID is available)
      let tmdbHit = mediaList.find((r) => r.tmdb_id);
      // Chinese search may return douban-only results; retry with original_title in English
      if (!tmdbHit && mediaList.length > 0 && mediaList[0].original_title) {
        const enName = mediaList[0].original_title;
        appendLog(taskId, 'info', `Chinese search gave no TMDB ID, retrying with English: "${enName}"`);
        const enResults = await moviepilotService.searchMediaByTitle(mpConfig, enName);
        const enList = Array.isArray(enResults) ? enResults : [];
        tmdbHit = enList.find((r) => r.tmdb_id);
      }
      // Store resolved TMDB ID for later verification (both disk + local ref)
      if (tmdbHit) {
        task.itemInfo = { ...task.itemInfo, tmdbId: tmdbHit.tmdb_id };
        taskStore.updateTask(taskId, { itemInfo: { ...task.itemInfo } });
        appendLog(taskId, 'info', `TMDB ID: ${tmdbHit.tmdb_id}, searching season ${snum}`);
        const exactRes = await moviepilotService.searchMediaById(mpConfig, `tmdb:${tmdbHit.tmdb_id}`, snum);
        if (exactRes && exactRes.success && Array.isArray(exactRes.data)) {
          candidates = exactRes.data.map((t) => ({ torrent_info: t, meta_info: null }));
          appendLog(taskId, 'info', `Exact search returned ${candidates.length} candidates`);
        }
      }

      // Fallback: use media search title for fuzzy keyword
      if (candidates.length === 0 && seriesName) {
        // Try to find the specific season entry from media search for a better keyword
        const seasonHit = mediaList.find((r) => r.season === snum);
        const keyword = seasonHit ? seasonHit.title : (snum != null ? `${seriesName} 第${snum}季` : seriesName);
        appendLog(taskId, 'info', `Fuzzy search: "${keyword}"`);
        const fuzzyResult = await moviepilotService.searchTorrents(mpConfig, keyword);
        candidates = (fuzzyResult && fuzzyResult.data) || [];
      }
    } else {
      // ── Movie: fuzzy search with year ──
      let searchKeyword = itemName;
      const yearMatch = itemPath.match(/\((\d{4})\)/);
      const year = yearMatch ? yearMatch[1] : '';
      if (year) searchKeyword = itemName + ' ' + year;

      let result = await moviepilotService.searchTorrents(mpConfig, searchKeyword);
      candidates = (result && result.data) || [];

      // If Chinese name + year finds nothing, try English name via media search
      if ((!Array.isArray(candidates) || candidates.length === 0) && year) {
        try {
          const mediaResults = await moviepilotService.searchMediaByTitle(mpConfig, itemName);
          const tmdbHit = (Array.isArray(mediaResults) ? mediaResults : []).find((r) => r.tmdb_id && r.title);
          if (tmdbHit && tmdbHit.title) {
            const enKeyword = tmdbHit.title + ' ' + year;
            appendLog(taskId, 'info', `Chinese search found nothing, trying English: "${enKeyword}"`);
            result = await moviepilotService.searchTorrents(mpConfig, enKeyword);
            candidates = (result && result.data) || [];
          }
        } catch (_) {}
      }
    }

    if (!Array.isArray(candidates) || candidates.length === 0) {
      appendLog(taskId, 'error', `未找到任何可洗版的种子（"${itemName}"）`);
      scheduler.reportStatus(taskId, 'failed_hard');
      return;
    }

    // Store candidates for user selection
    const simplified = candidates.map((c) => ({
      title: (c.torrent_info && c.torrent_info.title) || (c.meta_info && c.meta_info.title) || '',
      site: (c.torrent_info && c.torrent_info.site_name) || '',
      size: (c.torrent_info && c.torrent_info.size) || 0,
      seeders: (c.torrent_info && c.torrent_info.seeders) || 0,
      resolution: (c.meta_info && c.meta_info.resource_pix) || '',
      codec: (c.meta_info && c.meta_info.video_encode) || '',
      edition: (c.meta_info && c.meta_info.edition) || '',
      index: 0,
    })).map((c, i) => ({ ...c, index: i }));

    appendLog(taskId, 'info', `Found ${simplified.length} upgrade candidates`);

    taskStore.updateTask(taskId, {
      itemInfo: {
        ...task.itemInfo,
        searchCandidates: candidates,
        searchCandidatesSimplified: simplified,
      },
    });

    // ── Smart seed selection ──────────────────────────────────────────
    const config = configStore.loadConfig();

    // Exact search results have no meta_info (codec/resolution not parsed).
    // Skip smartSelect and go to user confirmation for these candidates.
    const hasMetaInfo = candidates.some((c) => c.meta_info != null);
    if (!hasMetaInfo) {
      appendLog(taskId, 'info', 'Candidates from exact search (no meta_info) — skipping auto-select');
      taskStore.updateTask(taskId, {
        resumePoint: 'upgrade_executing',
      });
      scheduler.pauseForConfirm(taskId, 'upgrade_executing');
      return;
    }

    const selectedIndex = smartSeedSelect.filterAndSelect(candidates, task.itemInfo, config);
    if (selectedIndex !== null) {
      appendLog(taskId, 'info', `SmartSelect: auto-picked candidate #${selectedIndex} (${simplified[selectedIndex] && simplified[selectedIndex].title || 'unknown'})`);
      taskStore.updateTask(taskId, {
        confirmData: { selectedIndex },
        resumePoint: 'upgrade_executing',
      });
      // Re-read task with updated confirmData, then continue execution inline
      const updatedTask = taskStore.getTask(taskId);
      await runExecuting(taskId, updatedTask);
      return;
    }

    // Smart select enabled but no match → fail
    // Replicate filterAndSelect's enabled-check to avoid reading stale global config
    const schedule = configStore.resolveSubLibSchedule(task.itemInfo || {}, config);
    if (schedule.smartSelectEnabled) {
      const seedPrefs = task.itemInfo && task.itemInfo.seedPreferences;
      const smartCfg = (seedPrefs && Object.keys(seedPrefs).length > 0)
        ? seedPrefs
        : smartSeedSelect.getSmartConfig(task.itemInfo, config);
      const hasAnyPreference = smartCfg && (
        (smartCfg.codecPreference && smartCfg.codecPreference.length > 0) ||
        (smartCfg.resolutionPreference && smartCfg.resolutionPreference.length > 0) ||
        (smartCfg.audioPreference && smartCfg.audioPreference.length > 0) ||
        (smartCfg.sitePreference && smartCfg.sitePreference.length > 0) ||
        smartCfg.preferCNSub ||
        (typeof smartCfg.maxSizeGB === 'number' && smartCfg.maxSizeGB > 0) ||
        (task.itemInfo && typeof task.itemInfo.maxSizeGB === 'number' && task.itemInfo.maxSizeGB > 0)
      );
      if (hasAnyPreference) {
        appendLog(taskId, 'error', '未找到满足智能选种条件的种子');
        scheduler.reportStatus(taskId, 'failed_hard');
        return;
      }
    }

    taskStore.updateTask(taskId, {
      resumePoint: 'upgrade_executing',
    });
    scheduler.pauseForConfirm(taskId, 'upgrade_executing');
  } catch (e) {
    appendLog(taskId, 'error', `Planning failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

// ── Post-download continuation (shared by first-run and resume paths) ─────────

async function continueAfterDownload(taskId, mpConfig) {
  await waitForScraping(taskId, mpConfig);

  const task = taskStore.getTask(taskId);
  if (task && task.itemInfo && task.itemInfo.mpTmdbId) {
    appendLog(taskId, 'info', `MoviePilot scraped as TMDB ${task.itemInfo.mpTmdbId}`);
  }

  taskStore.updateTask(taskId, { resumePoint: 'upgrade_pre_replace_verify', progress: 80 });
  setImmediate(() => runPreReplaceVerify(taskId, taskStore.getTask(taskId)));
}

// ── Shared post-download continuation ─────────────────────────────────────────

async function pollDownloadAndScrape(taskId, mpConfig) {
  try {
    const hash = (taskStore.getTask(taskId).itemInfo || {}).downloadHash;

    const pollResult = await waitForDownload(taskId, mpConfig, hash);
    if (pollResult.aborted) return;

    appendLog(taskId, 'info', 'Download completed');
    await continueAfterDownload(taskId, mpConfig);
  } catch (e) {
    if (isAborted(taskId)) return;
    appendLog(taskId, 'error', `Executing failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

// ── Phase: executing ──────────────────────────────────────────────────────────

async function runExecuting(taskId, task) {
  setPhase(taskId, 'upgrade_executing');
  scheduler.reportStatus(taskId, 'executing', task.progress || 5);

  const mpConfig = getMpConfig();
  if (!mpConfig) {
    appendLog(taskId, 'error', 'MoviePilot config lost');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  const downloadHash = (task.itemInfo && task.itemInfo.downloadHash) || null;
  const downloadAdded = (task.itemInfo && task.itemInfo.downloadAdded) || false;

  if (downloadHash) {
    // ── Resume: check download state, handle completion-during-pause ──
    appendLog(taskId, 'info', `Resuming (hash=${downloadHash})`);

    let dlActive = false;
    try {
      const downloads = await moviepilotService.listDownloads(mpConfig);
      const list = Array.isArray(downloads) ? downloads : [];
      const dl = list.find((d) => d.hash === downloadHash || d.hashString === downloadHash || d.download_hash === downloadHash);
      if (dl) {
        dlActive = true;
        await moviepilotService.resumeDownload(mpConfig, downloadHash);
      }
    } catch (_) {}

    if (!dlActive) {
      // Download completed and auto-removed during pause → skip to scraping
      appendLog(taskId, 'info', 'Download already completed, proceeding to scraping wait');
      await continueAfterDownload(taskId, mpConfig);
      return;
    }
    // Fall through to common polling path
  } else if (downloadAdded) {
    // ── Recover: download was already submitted, but hash was lost (pre-v2 data) ──
    appendLog(taskId, 'warn', 'Download was previously submitted but hash is missing — falling through to poll');
    // Fall through to polling; if download is still active it will be found by listDownloads
  } else {
    // ── First run: validate selection + addDownload + persist hash ──
    appendLog(taskId, 'info', 'Starting download for upgrade');

    const candidates = (task.itemInfo && task.itemInfo.searchCandidates) || [];
    const confirmData = task.confirmData || {};
    const selectedIndex = typeof confirmData.selectedIndex === 'number' ? confirmData.selectedIndex : 0;

    if (selectedIndex < 0 || selectedIndex >= candidates.length) {
      appendLog(taskId, 'error', `Invalid selected index: ${selectedIndex} (candidates: ${candidates.length})`);
      scheduler.reportStatus(taskId, 'failed_hard');
      return;
    }

    const selected = candidates[selectedIndex];
    const torrentInfo = selected.torrent_info;
    if (!torrentInfo) {
      appendLog(taskId, 'error', 'Selected candidate has no torrent info');
      scheduler.reportStatus(taskId, 'failed_hard');
      return;
    }

    appendLog(taskId, 'info', `Selected: ${torrentInfo.title || 'Unknown'} from ${torrentInfo.site_name || 'Unknown'}`);

    const schedule = configStore.resolveSubLibSchedule(task.itemInfo || {}, configStore.loadConfig());

    // Download with retry: if MP rejects, try next seed with score >= 0.8 (auto mode only)
    let dlResult;
    const rankedPool = smartSeedSelect.getRankedPool(candidates, task.itemInfo, configStore.loadConfig());
    const highScorePool = rankedPool.filter((e) => e.score >= 0.8);
    const fallbackPool = highScorePool.length > 0 ? highScorePool : rankedPool;

    const retryPool = schedule.smartSelectEnabled ? fallbackPool : [{ candidate: candidates[selectedIndex], originalIndex: selectedIndex }];

    for (const entry of retryPool) {
      const tInfo = entry.candidate.torrent_info;
      if (!tInfo) continue;

      if (entry.originalIndex !== selectedIndex) {
        appendLog(taskId, 'info', `Retry with next candidate: ${tInfo.title || 'Unknown'}`);
      }

      dlResult = await moviepilotService.addDownload(mpConfig, {
        torrentInfo: tInfo,
        savePath: mpConfig.savePath || undefined,
      });

      if (dlResult && dlResult.success !== false) break; // success
      if (!dlResult) {
        appendLog(taskId, 'warn', `Download add returned empty response for "${tInfo.title}"`);
        continue;
      }
      appendLog(taskId, 'warn', `Download add failed for "${tInfo.title}": ${dlResult.message || 'Unknown error'}`);
    }

    if (!dlResult || dlResult.success === false) {
      appendLog(taskId, 'error', '所有候选种子下载失败，MoviePilot 均拒绝添加');
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
      return;
    }

    appendLog(taskId, 'info', 'Download task added to MoviePilot');

    // Extract download_id from MP response — this is the hash we use to track the download
    const downloadId = (dlResult && dlResult.data && dlResult.data.download_id) || null;
    if (downloadId) {
      taskStore.updateTask(taskId, {
        itemInfo: { ...(taskStore.getTask(taskId).itemInfo || task.itemInfo), downloadHash: downloadId, downloadAdded: true },
      });
      appendLog(taskId, 'info', `Download hash: ${downloadId}`);
    } else {
      appendLog(taskId, 'warn', 'MoviePilot did not return download_id — download tracking may be incomplete');
    }

    // Fall through to common polling path
  }

  // ── Common path: poll download + wait for scraping ──
  await pollDownloadAndScrape(taskId, mpConfig);
}

// ── Phase: pre_replace_verify ─────────────────────────────────────────────────
// Mirror of transcodeFlowExecutor.runVerify

async function runPreReplaceVerify(taskId, task) {
  setPhase(taskId, 'pre_replace_verify');
  scheduler.reportStatus(taskId, 'executing', 90);
  appendLog(taskId, 'info', 'Verifying MoviePilot scraping result');

  const config = configStore.loadConfig();
  const stagingRoot = config.upgradeStagingLocalPath;
  if (!stagingRoot) {
    appendLog(taskId, 'error', 'upgradeStagingLocalPath not configured');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  // Locate the staging folder. Prefer the exact path from transfer history
  // (matched by download_hash) over blind scanning — avoids picking up files
  // from concurrent tasks or stale folders when upgradeConcurrency > 1.
  const mpConfig = getMpConfig();
  const transferDest = (task.itemInfo && task.itemInfo.stagingTransferDest) || null;
  let stagingFolder = null;
  let stagingMediaPath = null;

  const mediaExts = ['.mkv', '.mp4', '.avi', '.ts', '.m2ts'];

  if (transferDest && mpConfig) {
    const localPath = resolveStagingFromTransfer(transferDest, mpConfig.savePath, stagingRoot);
    if (localPath) {
      appendLog(taskId, 'info', `Resolving staging from transfer dest: ${localPath}`);
      try {
        const st = fs.statSync(localPath);
        if (st.isFile() && mediaExts.includes(path.extname(localPath).toLowerCase())) {
          stagingFolder = path.dirname(localPath);
          stagingMediaPath = localPath;
        } else if (st.isDirectory()) {
          // Folder release (BDMV etc.) or season pack — find media file inside
          stagingFolder = localPath;
          const scanDir = (dir, depth) => {
            if (depth > 3) return null;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isFile() && mediaExts.includes(path.extname(e.name).toLowerCase())) {
                return path.join(dir, e.name);
              }
            }
            for (const e of entries) {
              if (e.isDirectory() && !e.name.startsWith('.')) {
                const found = scanDir(path.join(dir, e.name), depth + 1);
                if (found) return found;
              }
            }
            return null;
          };
          stagingMediaPath = scanDir(localPath, 0);
          if (!stagingMediaPath) {
            appendLog(taskId, 'warn', 'Transfer dest is a directory but no media file found inside');
          }
        }
      } catch (e) {
        appendLog(taskId, 'warn', `Transfer dest not accessible: ${e.message}. Falling back to blind scan.`);
      }
    }
  }

  // Fallback: blind scan of staging root (legacy path for tasks without download_hash)
  if (!stagingFolder || !stagingMediaPath) {
    if (!transferDest) {
      appendLog(taskId, 'info', 'No transfer dest on task — falling back to blind staging scan');
    }
    try {
      const entries = fs.readdirSync(stagingRoot, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          const fullPath = path.join(stagingRoot, e.name);
          const files = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const f of files) {
            const ext = path.extname(f.name).toLowerCase();
            if (mediaExts.includes(ext)) {
              stagingFolder = fullPath;
              stagingMediaPath = path.join(fullPath, f.name);
              break;
            }
          }
          if (stagingFolder) break;
        }
      }
    } catch (e) {
      if (isAborted(taskId)) return;
      appendLog(taskId, 'error', `Cannot read staging directory: ${e.message}`);
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
      return;
    }
  }

  if (!stagingFolder || !stagingMediaPath) {
    appendLog(taskId, 'error', 'No scraped folder found in staging');
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
    return;
  }

  appendLog(taskId, 'info', `Staging folder: ${stagingFolder}`);

  // Check if cancelled during scraping — clean up and exit
  const task2 = taskStore.getTask(taskId);
  if (task2 && task2.cancelAfterScraping) {
    appendLog(taskId, 'info', 'Cancelled — cleaning up scraped folder');
    if (stagingFolder && fs.existsSync(stagingFolder)) {
      try {
        fs.rmSync(stagingFolder, { recursive: true, force: true });
        appendLog(taskId, 'info', 'Scraped folder cleaned');
      } catch (e) {
        appendLog(taskId, 'warn', `Failed to clean scraped folder: ${e.message}`);
      }
    }
    scheduler.reportStatus(taskId, 'done');
    return;
  }

  try {
    // TMDB ID validation — use the actual NFO in staging folder as authoritative
    // mpTmdbId from transfer history is the series-level ID — use it first.
    // NFO contains episode-level ID which won't match series-level expectedTmdbId.
    const scrapeTmdbId = (task.itemInfo && task.itemInfo.mpTmdbId) || extractTmdbIdFromNfo(stagingFolder) || null;
    // Use tmdbId from planning phase (independently resolved via media search).
    // Falls back to mpTmdbId from transfer history only if planning didn't resolve one.
    let expectedTmdbId = (task.itemInfo && task.itemInfo.tmdbId) || (task.itemInfo && task.itemInfo.mpTmdbId) || null;
    if (!expectedTmdbId) {
      const info = task.itemInfo || {};
      const searchName = (info.type === 'season' && info.seriesName) ? info.seriesName : (info.name || info.title || '');
      if (searchName) {
        try {
          const mpConfig = getMpConfig();
          if (mpConfig) {
            let mediaResults = await moviepilotService.searchMediaByTitle(mpConfig, searchName);
            const list = Array.isArray(mediaResults) ? mediaResults : [];
            let tmdbHit = list.find((r) => r.tmdb_id);

            // Chinese search may return douban-only results; retry with original_title in English
            if (!tmdbHit && list.length > 0 && list[0].original_title) {
              const enName = list[0].original_title;
              appendLog(taskId, 'info', `Chinese search gave no TMDB ID, retrying with English: "${enName}"`);
              mediaResults = await moviepilotService.searchMediaByTitle(mpConfig, enName);
              const enList = Array.isArray(mediaResults) ? mediaResults : [];
              tmdbHit = enList.find((r) => r.tmdb_id);
            }

            if (tmdbHit) expectedTmdbId = tmdbHit.tmdb_id;
          }
        } catch (e) {
          appendLog(taskId, 'warn', `Could not resolve TMDB ID for verification: ${e.message}`);
        }
      }
    }

    appendLog(taskId, 'info', `TMDB check: expected=${expectedTmdbId || '?'} scraped=${scrapeTmdbId || '?'}`);

    if (expectedTmdbId && scrapeTmdbId) {
      if (expectedTmdbId !== scrapeTmdbId) {
        appendLog(taskId, 'error', `TMDB mismatch: expected ${expectedTmdbId}, got ${scrapeTmdbId}. MoviePilot scraped wrong media.`);
        scheduler.reportStatus(taskId, 'failed_hard');
        setPhase(taskId, 'failed_hard');
        return;
      }
      appendLog(taskId, 'info', `TMDB verified: ${scrapeTmdbId} matches expected`);

      // For seasons: also verify the season number matches
      const taskSeason = (task.itemInfo && task.itemInfo.seasonNumber) || null;
      const mpSeasons = (task.itemInfo && task.itemInfo.mpSeasons) || null;
      if (taskSeason != null && mpSeasons) {
        const mpSeasonNum = parseInt((mpSeasons.match(/S(\d+)/i) || [])[1], 10);
        if (!Number.isNaN(mpSeasonNum) && mpSeasonNum !== taskSeason) {
          appendLog(taskId, 'error', `Season mismatch: expected S${String(taskSeason).padStart(2,'0')}, got ${mpSeasons}. MoviePilot scraped wrong season.`);
          scheduler.reportStatus(taskId, 'failed_hard');
          setPhase(taskId, 'failed_hard');
          return;
        }
        appendLog(taskId, 'info', `Season verified: S${String(taskSeason).padStart(2,'0')} matches ${mpSeasons}`);
      }
    } else if (!scrapeTmdbId) {
      appendLog(taskId, 'warn', 'Could not extract TMDB ID from download metadata or NFO — skipping identity check');
    }

    // Probe the new file for technical info
    const fstat = fs.statSync(stagingMediaPath);
    const outSizeBytes = fstat.size;
    let outWidth = 0, outHeight = 0, outCodec = '', outDuration = 0, outBitrate = 0;
    try {
      const transcodeService = require('./services/transcodeService');
      const summary = await transcodeService.probeSummary(config, stagingMediaPath);
      outWidth = summary.width || 0;
      outHeight = summary.height || 0;
      outCodec = summary.videoCodec || '';
      outDuration = summary.durationSec || 0;
      outBitrate = outDuration > 0 ? Math.round((outSizeBytes * 8) / (outDuration * 1000)) : 0;
    } catch (e) {
      appendLog(taskId, 'warn', `Probe summary failed: ${e.message}`);
    }

    // Generate a preview clip from middle of the staging file
    let previewPath = null;
    try {
      const previewFile = path.join(path.dirname(stagingMediaPath), 'upgrade_preview.mp4');
      const previewResult = await require('./services/transcodeService').extractPreviewClip(config, stagingMediaPath, previewFile);
      appendLog(taskId, 'info', `Preview clip generated (${previewResult.method}, ${previewResult.duration}s from ${previewResult.startSec}s)`);
      previewPath = previewResult.previewPath;
    } catch (e) {
      appendLog(taskId, 'warn', `Preview clip generation failed: ${e.message}`);
    }

    // Store verify result and staging info on task
    const oldInfo = {
      name: (task.itemInfo && task.itemInfo.path || '').split('/').pop() || '',
      size: (task.itemInfo && task.itemInfo.size) || 0,
      resolution: (task.itemInfo && task.itemInfo.resolution) || '',
      bitrate: (task.itemInfo && task.itemInfo.bitrate) || 0,
    };

    taskStore.updateTask(taskId, {
      itemInfo: { ...task.itemInfo, stagingFolder, stagingMediaPath },
      verifyResult: {
        sizeBytes: outSizeBytes,
        videoCodec: outCodec,
        width: outWidth,
        height: outHeight,
        bitrate: outBitrate,
        durationSec: outDuration,
        previewPath,
      },
      upgradePreview: {
        oldFile: oldInfo,
        newFile: { name: path.basename(stagingMediaPath), size: outSizeBytes },
        bytesSaved: (oldInfo.size - outSizeBytes),
        tmdbVerified: expectedTmdbId && scrapeTmdbId && expectedTmdbId === scrapeTmdbId,
        tmdbId: scrapeTmdbId || expectedTmdbId,
      },
      resumePoint: 'upgrade_replace',
      progress: 90,
    });

    const sched = configStore.resolveSubLibSchedule(task.itemInfo || {}, config);
    if (!sched.autoReplaceUpgrade) {
      appendLog(taskId, 'info', 'Replace confirmation required — awaiting user');
      scheduler.pauseForConfirm(taskId, 'upgrade_replace');
      return;
    }

    await runReplace(taskId, taskStore.getTask(taskId), config);
  } catch (e) {
    if (isAborted(taskId)) return;
    appendLog(taskId, 'error', `Verify failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

// ── Phase: replace ────────────────────────────────────────────────────────────
// Mirror of transcodeFlowExecutor.runReplace

async function runReplace(taskId, task, config) {
  setPhase(taskId, 'upgrade_replace');
  appendLog(taskId, 'info', 'Replacing old media folder');

  const stagingFolder = (task.itemInfo && task.itemInfo.stagingFolder);
  const rawEmbyPath = (task.itemInfo && task.itemInfo.path) || '';

  if (!stagingFolder || !rawEmbyPath) {
    appendLog(taskId, 'error', 'Missing staging or emby path for replace');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  let targetFolder = resolveEmbyPath(rawEmbyPath, task);
  try {
    const stat = fs.statSync(targetFolder);
    if (stat.isFile()) targetFolder = path.dirname(targetFolder);
  } catch (_) {
    const parent = path.dirname(targetFolder);
    if (parent && parent !== targetFolder && fs.existsSync(parent)) targetFolder = parent;
  }

  if (!fs.existsSync(targetFolder)) {
    appendLog(taskId, 'error', `Target folder not found: ${targetFolder}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
    return;
  }

  appendLog(taskId, 'info', `Replacing: ${targetFolder}`);
  appendLog(taskId, 'info', `      with: ${stagingFolder}`);

  try {
    // Copy staging to a temp name first, then swap
    const tmpFolder = targetFolder + '.etp.tmp';
    let tmpReady = false;

    // Check if tmpFolder is a complete copy from a previous interrupted run
    if (fs.existsSync(tmpFolder)) {
      try {
        const tmpEntries = fs.readdirSync(tmpFolder, { withFileTypes: true });
        const hasMedia = tmpEntries.some((e) => {
          if (!e.isFile()) return false;
          const ext2 = path.extname(e.name).toLowerCase();
          return ['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov'].includes(ext2);
        });
        if (hasMedia) {
          appendLog(taskId, 'info', 'Replace: reusing complete .etp.tmp from previous run');
          tmpReady = true;
        } else {
          fs.rmSync(tmpFolder, { recursive: true, force: true });
        }
      } catch (_) {
        fs.rmSync(tmpFolder, { recursive: true, force: true });
      }
    }

    if (!tmpReady) {
      appendLog(taskId, 'info', 'Replace: copying staging → ' + tmpFolder);
      copyDirSync(stagingFolder, tmpFolder);
    }

    appendLog(taskId, 'info', 'Replace: removing old folder');
    fs.rmSync(targetFolder, { recursive: true, force: true });

    appendLog(taskId, 'info', 'Replace: promoting tmp → ' + targetFolder);
    fs.renameSync(tmpFolder, targetFolder);

    // Clean staging source
    fs.rmSync(stagingFolder, { recursive: true, force: true });

    appendLog(taskId, 'info', 'Replace complete');
    scheduler.reportStatus(taskId, 'done', 100);
    setPhase(taskId, 'done');
  } catch (e) {
    if (isAborted(taskId)) return;
    appendLog(taskId, 'error', `Replace failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

// ── Phase: verify ─────────────────────────────────────────────────────────────

async function runVerify(taskId, task) {
  setPhase(taskId, 'verify');
  appendLog(taskId, 'info', 'Verifying upgraded media');

  const rawEmbyPath = (task.itemInfo && task.itemInfo.path) || '';
  const embyPath = resolveEmbyPath(rawEmbyPath, task);
  let targetPath = embyPath;
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) targetPath = path.dirname(targetPath);
  } catch (_) {}

  // SMB shares may have delayed consistency — try to read the directory
  let verified = false;
  for (let i = 0; i < 10; i++) {
    try {
      const items = fs.readdirSync(targetPath);
      if (items.length > 0) { verified = true; break; }
    } catch (_) {}
    await sleep(3000);
  }
  if (!verified) {
    appendLog(taskId, 'error', 'Target folder missing or empty after replace');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  // Check there's at least a media file
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  const hasMedia = entries.some((e) => {
    if (!e.isFile()) return false;
    const ext = path.extname(e.name).toLowerCase();
    return ['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov'].includes(ext);
  });

  if (!hasMedia) {
    appendLog(taskId, 'error', 'No media file found after replace');
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }

  appendLog(taskId, 'info', 'Upgrade completed successfully');
  scheduler.reportStatus(taskId, 'done', 100);
  setPhase(taskId, 'done');

  // Clean up .etp.bak if needed (keep for safety by default)
}

// ── Flow controls ─────────────────────────────────────────────────────────────

async function pause(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;

  const downloadHash = (task.itemInfo && task.itemInfo.downloadHash) || null;
  const phase = task.phase || '';

  // No hash yet — download either not submitted or from old data. Can't tell MP to pause.
  if (!downloadHash && phase === 'upgrade_executing') {
    abortFlags.set(taskId, true);
    appendLog(taskId, 'warn', 'Paused without download hash — MP download may continue');
    scheduler.reportStatus(taskId, 'paused', task.progress || 0);
    return;
  }

  // Download polling / scraping stage — hash is known (or download already gone).
  abortFlags.set(taskId, true);

  if (downloadHash) {
    const mpConfig = getMpConfig();
    if (mpConfig) {
      try {
        await moviepilotService.pauseDownload(mpConfig, downloadHash);
        appendLog(taskId, 'info', 'MoviePilot download paused');
      } catch (e) {
        appendLog(taskId, 'warn', `Failed to pause MoviePilot download: ${e.message}`);
      }
    }
  }

  appendLog(taskId, 'info', 'Upgrade paused by user');
  scheduler.reportStatus(taskId, 'paused', task.progress || 0);
}

async function cancel(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;

  appendLog(taskId, 'info', 'Upgrade cancelled by user');

  const mpConfig = getMpConfig();
  const downloadHash = (task.itemInfo && task.itemInfo.downloadHash) || null;
  const phase = task.phase || '';
  const stagingFolder = (task.itemInfo && task.itemInfo.stagingFolder) || null;

  // Phase 3+: scraping completed, staging folder known → clean directly
  if (stagingFolder) {
    if (mpConfig && downloadHash) {
      try { await moviepilotService.deleteDownload(mpConfig, downloadHash); } catch (_) {}
    }
    if (fs.existsSync(stagingFolder)) {
      try {
        fs.rmSync(stagingFolder, { recursive: true, force: true });
        appendLog(taskId, 'info', 'Staging folder cleaned');
      } catch (e) {
        appendLog(taskId, 'warn', `Failed to clean staging: ${e.message}`);
      }
    }
    abortFlags.set(taskId, true);
    scheduler.reportStatus(taskId, 'done');
    return;
  }

  // No download started yet (precheck/planning)
  if (!downloadHash && phase !== 'upgrade_executing') {
    abortFlags.set(taskId, true);
    scheduler.reportStatus(taskId, 'done');
    return;
  }

  // No hash — download either not submitted yet or from old data. Mark done.
  if (!downloadHash && phase === 'upgrade_executing') {
    abortFlags.set(taskId, true);
    appendLog(taskId, 'warn', 'Cancelled without download hash — MP download may remain');
    scheduler.reportStatus(taskId, 'done');
    return;
  }

  // downloadHash exists, stagingFolder not set → Phase 1 or 2
  let inDownloadList = false;
  if (mpConfig) {
    try {
      const downloads = await moviepilotService.listDownloads(mpConfig);
      const list = Array.isArray(downloads) ? downloads : [];
      inDownloadList = list.some((d) =>
        d.hash === downloadHash || d.hashString === downloadHash || d.download_hash === downloadHash
      );
    } catch (_) {}
  }

  if (inDownloadList) {
    // Phase 1: download active → DELETE, MP downloader cleans files
    if (mpConfig) {
      try { await moviepilotService.deleteDownload(mpConfig, downloadHash); } catch (_) {}
    }
    abortFlags.set(taskId, true);
    appendLog(taskId, 'info', 'Download cancelled in MoviePilot');
    scheduler.reportStatus(taskId, 'done');
  } else {
    // Phase 2: download done, scraping not yet complete
    // Let scraping finish naturally, then clean in pre_replace_verify
    taskStore.updateTask(taskId, { cancelAfterScraping: true });
    appendLog(taskId, 'info', 'Waiting for scraping to finish — will clean up after');
    // Don't set abort flag — keep polling/scraping alive
  }
}

function confirmReceived(taskId) {
  // confirmData is stored on task by PATCH /v1/tasks/:id before calling this
  // Scheduler re-queues with resumePoint='upgrade_executing'
}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
