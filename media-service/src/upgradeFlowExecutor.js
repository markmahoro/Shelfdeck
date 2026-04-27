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

function resolveEmbyPath(embyPath) {
  const cfg = configStore.loadConfig();
  const from = (cfg.pathMapFrom || '').trim();
  const to = (cfg.pathMapTo || '').trim();
  if (from && to && embyPath && embyPath.startsWith(from)) {
    const relative = embyPath.slice(from.length).replace(/^\//, '');
    return path.join(to, relative);
  }
  return embyPath;
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

// ── Hash acquisition loop ──────────────────────────────────────────────────────
// Polls listDownloads by title match until hash appears or user cancels.
// Honours pausingRequested — once hash arrives, pause is executed immediately.
// Honours pendingCancel — once hash arrives, delete is executed immediately.

async function tryMatchHash(mpConfig, searchTitle) {
  try {
    const downloads = await moviepilotService.listDownloads(mpConfig);
    const list = Array.isArray(downloads) ? downloads : [];
    const match = list.find((d) => {
      const dTitle = (d.title || d.name || '').replace(/[.\s]+/g, ' ').trim().toLowerCase();
      return d.hash && (dTitle.includes(searchTitle) || searchTitle.includes(dTitle));
    });
    return match ? match.hash : null;
  } catch (_) {
    return null;
  }
}

async function acquireHash(taskId, mpConfig, searchTitle) {
  while (true) {
    const task = taskStore.getTask(taskId);
    if (!task) return null;

    // Cancel during hash acquisition — keep hunting hash, delete once found
    if (task.pendingCancel) {
      const hash = await tryMatchHash(mpConfig, searchTitle);
      if (hash) {
        try { await moviepilotService.deleteDownload(mpConfig, hash); } catch (_) {}
        abortFlags.set(taskId, true);
        appendLog(taskId, 'info', 'Download cancelled (hash acquired during cancel wait)');
        scheduler.reportStatus(taskId, 'done');
      } else {
        // Still no hash — MP download may not have registered yet.
        // Delete won't work without hash, but user wants out. Mark done.
        abortFlags.set(taskId, true);
        appendLog(taskId, 'warn', 'Cancel without hash — MP download may remain');
        scheduler.reportStatus(taskId, 'done');
      }
      return null;
    }

    // Pause during hash acquisition — keep hunting hash, pause once found
    if (task.pausingRequested) {
      const hash = await tryMatchHash(mpConfig, searchTitle);
      if (hash) return hash; // caller will execute pause + MP stop
      await sleep(2000);
      continue;
    }

    const hash = await tryMatchHash(mpConfig, searchTitle);
    if (hash) return hash;

    await sleep(2000);
  }
}

function waitForDownload(taskId, mpConfig, hashString, maxWaitMs) {
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
      // Grace period for download to appear
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
      if (Date.now() - start > maxWaitMs) {
        throw new Error('Download timed out');
      }
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
    if (Date.now() - start > maxWaitMs) {
      throw new Error('Download timed out (state=' + (dl.state || 'unknown') + ')');
    }
    await sleep(pollInterval);
    return poll();
  }

  return poll();
}

// Wait for MoviePilot to finish scraping/transfer. MoviePilot moves the scraped
// folder into place within shelfdeck and records it in transfer history.
async function waitForScraping(taskId, mpConfig) {
  const start = Date.now();
  const maxWaitMs = 10 * 60 * 1000; // 10 min timeout
  const pollInterval = 5000;

  const task = taskStore.getTask(taskId);
  const baselineId = (task && task.itemInfo && task.itemInfo.baselineTransferId) || 0;

  appendLog(taskId, 'info', `Waiting for MoviePilot scraping (baseline transfer id=${baselineId})...`);

  while (Date.now() - start < maxWaitMs) {
    if (isAborted(taskId)) return;

    await sleep(pollInterval);

    try {
      const hist = await moviepilotService.getTransferHistory(mpConfig, 5);
      const list = (hist && hist.data && hist.data.list) || (hist && hist.list) || [];
      // Look for a newer entry whose src is within shelfdeck
      const match = list.find((t) => {
        const src = t.src || '';
        return src.includes('shelfdeck') && (t.id || 0) > baselineId;
      });

      if (match) {
        const tmdbId = match.tmdbid || null;
        if (tmdbId) {
          taskStore.updateTask(taskId, {
            itemInfo: { ...taskStore.getTask(taskId).itemInfo, mpTmdbId: tmdbId },
          });
        }
        appendLog(taskId, 'info', `Scraping complete (transfer id=${match.id}, tmdb=${tmdbId || '?'})`);
        return;
      }
    } catch (_) {
      // Keep polling
    }
  }

  appendLog(taskId, 'warn', 'Scraping timeout — proceeding anyway');
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
    scheduler.reportStatus(taskId, 'waiting_media_source');
    setPhase(taskId, 'waiting_media_source');
    return;
  }

  // Extract year from path for better search precision
  let searchKeyword = itemName;
  const itemPath = (task.itemInfo && task.itemInfo.path) || '';
  const yearMatch = itemPath.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';
  if (year) searchKeyword = itemName + ' ' + year;

  try {
    let result = await moviepilotService.searchTorrents(mpConfig, searchKeyword);
    let candidates = (result && result.data) || [];

    // If Chinese name + year finds nothing useful, try resolving English name via media search
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

    if (!Array.isArray(candidates) || candidates.length === 0) {
      appendLog(taskId, 'info', `No upgrade candidates found for "${itemName}"`);
      scheduler.reportStatus(taskId, 'waiting_media_source');
      setPhase(taskId, 'waiting_media_source');
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

// ── Shared hash-acquisition + continuation ─────────────────────────────────────

async function acquireHashAndContinue(taskId, task, mpConfig, torrentInfo) {
  const searchTitle = (torrentInfo.title || '').replace(/[.\s]+/g, ' ').trim().toLowerCase();

  const hashString = await acquireHash(taskId, mpConfig, searchTitle);
  if (!hashString) return; // cancelled during hash acquisition

  const tFresh = taskStore.getTask(taskId) || task;
  taskStore.updateTask(taskId, {
    itemInfo: { ...(tFresh.itemInfo || task.itemInfo), downloadHash: hashString },
  });
  appendLog(taskId, 'info', `Download hash: ${hashString}`);

  // If pause was requested during hash acquisition, execute it now with the hash
  const tAfterHash = taskStore.getTask(taskId);
  if (tAfterHash && tAfterHash.pausingRequested) {
    try {
      await moviepilotService.pauseDownload(mpConfig, hashString);
      appendLog(taskId, 'info', 'MoviePilot download paused (deferred from hash acquisition)');
    } catch (e) {
      appendLog(taskId, 'warn', `Failed to pause MP download: ${e.message}`);
    }
    abortFlags.set(taskId, true);
    taskStore.updateTask(taskId, { pausingRequested: false });
    scheduler.reportStatus(taskId, 'paused', task.progress || 5);
    return;
  }

  // Fall through to download polling
  await pollDownloadAndScrape(taskId, mpConfig);
}

async function recoverHashAndContinue(taskId, task, mpConfig) {
  const candidates = (task.itemInfo && task.itemInfo.searchCandidates) || [];
  const confirmData = task.confirmData || {};
  const selectedIndex = typeof confirmData.selectedIndex === 'number' ? confirmData.selectedIndex : 0;
  const selected = candidates[selectedIndex];
  const torrentInfo = (selected && selected.torrent_info) || null;

  const searchTitle = torrentInfo
    ? (torrentInfo.title || '').replace(/[.\s]+/g, ' ').trim().toLowerCase()
    : ((task.itemInfo && task.itemInfo.name) || '').toLowerCase();

  const hashString = await acquireHash(taskId, mpConfig, searchTitle);
  if (!hashString) return; // cancelled during hash acquisition

  taskStore.updateTask(taskId, {
    itemInfo: { ...(taskStore.getTask(taskId).itemInfo || task.itemInfo), downloadHash: hashString },
  });
  appendLog(taskId, 'info', `Download hash (recovery): ${hashString}`);

  const tAfterHash = taskStore.getTask(taskId);
  if (tAfterHash && tAfterHash.pausingRequested) {
    try {
      await moviepilotService.pauseDownload(mpConfig, hashString);
      appendLog(taskId, 'info', 'MoviePilot download paused');
    } catch (e) {
      appendLog(taskId, 'warn', `Failed to pause MP download: ${e.message}`);
    }
    abortFlags.set(taskId, true);
    taskStore.updateTask(taskId, { pausingRequested: false });
    scheduler.reportStatus(taskId, 'paused', task.progress || 5);
    return;
  }

  await pollDownloadAndScrape(taskId, mpConfig);
}

async function pollDownloadAndScrape(taskId, mpConfig) {
  try {
    const cfg = configStore.loadConfig();
    const maxWaitMs = 4 * 60 * 60 * 1000;
    const hash = (taskStore.getTask(taskId).itemInfo || {}).downloadHash;

    const pollResult = await waitForDownload(taskId, mpConfig, hash, maxWaitMs);
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
    // ── Recover: download was already submitted to MP, just need the hash ──
    appendLog(taskId, 'info', 'Download already submitted — waiting for hash');
    await recoverHashAndContinue(taskId, task, mpConfig);
    return;
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

    // Record baseline transfer history ID before adding download
    let baselineTransferId = 0;
    try {
      const baseline = await moviepilotService.getTransferHistory(mpConfig, 1);
      const baselineList = (baseline && baseline.data && baseline.data.list) || (baseline && baseline.list) || [];
      if (baselineList.length > 0) baselineTransferId = baselineList[0].id || 0;
      taskStore.updateTask(taskId, {
        itemInfo: { ...task.itemInfo, baselineTransferId },
      });
    } catch (_) {}

    scheduler.reportStatus(taskId, 'executing', 5);
    const dlResult = await moviepilotService.addDownload(mpConfig, {
      torrentInfo,
      savePath: mpConfig.savePath || undefined,
    });

    if (dlResult && dlResult.success === false) {
      appendLog(taskId, 'error', `Download add failed: ${dlResult.message || 'Unknown error'}`);
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
      return;
    }

    appendLog(taskId, 'info', 'Download task added to MoviePilot');

    // Mark that download was submitted — prevents double-add on recovery
    taskStore.updateTask(taskId, {
      itemInfo: { ...(taskStore.getTask(taskId).itemInfo || task.itemInfo), downloadAdded: true },
    });

    await acquireHashAndContinue(taskId, task, mpConfig, torrentInfo);
    return;
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

  // Find the scraped folder in staging
  let stagingFolder = null;
  let stagingMediaPath = null;
  try {
    const entries = fs.readdirSync(stagingRoot, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const fullPath = path.join(stagingRoot, e.name);
        const files = fs.readdirSync(fullPath, { withFileTypes: true });
        for (const f of files) {
          const ext = path.extname(f.name).toLowerCase();
          if (['.mkv', '.mp4', '.avi', '.ts', '.m2ts'].includes(ext)) {
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
    // TMDB ID validation
    const scrapeTmdbId = (task.itemInfo && task.itemInfo.mpTmdbId) || extractTmdbIdFromNfo(stagingFolder) || null;
    let expectedTmdbId = (task.itemInfo && task.itemInfo.tmdbId) || null;
    if (!expectedTmdbId) {
      const itemName = (task.itemInfo && (task.itemInfo.name || task.itemInfo.title)) || '';
      if (itemName) {
        try {
          const mpConfig = getMpConfig();
          if (mpConfig) {
            const mediaResults = await moviepilotService.searchMediaByTitle(mpConfig, itemName);
            if (Array.isArray(mediaResults) && mediaResults.length > 0) {
              const tmdbHit = mediaResults.find((r) => r.tmdb_id);
              if (tmdbHit) expectedTmdbId = tmdbHit.tmdb_id;
            }
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
        tmdbVerified: expectedTmdbId && scrapeTmdbId && expectedTmdbId === scrapeTmdbId,
        tmdbId: scrapeTmdbId || expectedTmdbId,
      },
      resumePoint: 'upgrade_replace',
      progress: 90,
    });

    if (config.transcodeReplaceConfirmRequired) {
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

  let targetFolder = resolveEmbyPath(rawEmbyPath);
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
    if (fs.existsSync(tmpFolder)) fs.rmSync(tmpFolder, { recursive: true, force: true });

    appendLog(taskId, 'info', 'Replace: copying staging → ' + tmpFolder);
    copyDirSync(stagingFolder, tmpFolder);

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
  const embyPath = resolveEmbyPath(rawEmbyPath);
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

  // Hash lookup stage — no hash yet, can't tell MP which download to pause.
  // Set flag so acquireHash honours the request once hash arrives.
  if (!downloadHash && phase === 'upgrade_executing') {
    taskStore.updateTask(taskId, { pausingRequested: true });
    appendLog(taskId, 'info', 'Pause requested — waiting for download to appear in MoviePilot');
    scheduler.reportStatus(taskId, 'pausing', task.progress || 0);
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

  // Hash lookup stage — no hash yet, can't tell MP which download to delete.
  // Set pendingCancel flag so acquireHash will delete once hash arrives.
  if (!downloadHash && phase === 'upgrade_executing') {
    taskStore.updateTask(taskId, { pendingCancel: true });
    appendLog(taskId, 'info', 'Cancel requested — waiting for download to appear in MoviePilot');
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
