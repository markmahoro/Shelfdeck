'use strict';

let timer = null;
let initialTimer = null;
let dependencies = null;
let health = { status: 'disabled', lastRunAt: '', lastError: '', observed: 0 };
let pollIntervalMs = 10 * 60000;

async function runOnce(overrides = {}) {
  const deps = { ...(dependencies || {}), ...overrides };
  if (!deps.configStore || !deps.mediaLibraryService || !deps.adultLibraryService) {
    throw new Error('NexoraObservationEngine dependencies are not configured');
  }
  const config = deps.configStore.loadConfig();
  const subLibraries = (config.subLibraries || []).filter((subLib) => subLib.enabled !== false);
  const byId = new Map(subLibraries.map((subLib) => [subLib.uuid, subLib]));
  let observed = 0;
  try {
    const adultCandidates = deps.adultLibraryService.listIngestCandidates(config) || [];
    for (const candidate of adultCandidates) {
      const itemInfo = candidate.itemInfo || candidate.item || candidate;
      const subLibraryId = itemInfo.subLibraryId || candidate.subLibraryId;
      const subLib = byId.get(subLibraryId);
      if (!subLib) continue;
      deps.adultLibraryService.commitAdultFolderSourceReference(subLib, itemInfo);
      observed += 1;
    }
    const embyCandidates = typeof deps.mediaLibraryService.listSourceObservationCandidates === 'function'
      ? await deps.mediaLibraryService.listSourceObservationCandidates(config)
      : [];
    for (const candidate of embyCandidates || []) {
      await deps.mediaLibraryService.commitEmbySourceCandidate(candidate.itemInfo || candidate, { config });
      observed += 1;
    }
    health = { status: 'green', lastRunAt: new Date().toISOString(), lastError: '', observed };
    return { ...health };
  } catch (error) {
    health = { status: 'red', lastRunAt: new Date().toISOString(), lastError: error.message, observed };
    throw error;
  }
}

function start(configStore, mediaLibraryService, adultLibraryService) {
  stop();
  dependencies = { configStore, mediaLibraryService, adultLibraryService };
  const config = configStore.loadConfig();
  pollIntervalMs = Math.max(1, Number(config.sourceObservationPollIntervalMinutes || config.smartTaskPollIntervalMinutes || 10)) * 60000;
  const delayMs = Math.max(0, Number(config.sourceObservationInitialDelaySeconds == null ? 60 : config.sourceObservationInitialDelaySeconds)) * 1000;
  const run = () => {
    runOnce().catch((error) => console.error('[nexoraObservationEngine] error:', error.message));
    if (!timer) {
      timer = setInterval(run, pollIntervalMs);
      timer.unref && timer.unref();
    }
  };
  initialTimer = setTimeout(() => {
    initialTimer = null;
    run();
  }, delayMs);
  initialTimer.unref && initialTimer.unref();
  health = { status: 'starting', lastRunAt: '', lastError: '', observed: 0 };
}

function wake() {
  if (!dependencies) return false;
  if (initialTimer) clearTimeout(initialTimer);
  initialTimer = setTimeout(() => {
    initialTimer = null;
    runOnce().catch((error) => console.error('[nexoraObservationEngine] error:', error.message));
    if (!timer) {
      timer = setInterval(() => {
        runOnce().catch((error) => console.error('[nexoraObservationEngine] error:', error.message));
      }, pollIntervalMs);
      timer.unref && timer.unref();
    }
  }, 0);
  initialTimer.unref && initialTimer.unref();
  health = { ...health, status: 'starting' };
  return true;
}

function stop() {
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  initialTimer = null;
  timer = null;
}

function getHealth() { return { ...health }; }

module.exports = { start, stop, wake, runOnce, getHealth };
