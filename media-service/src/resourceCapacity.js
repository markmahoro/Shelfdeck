'use strict';

const DEFAULT_RESOURCE_CAPACITY = {
  'filesystem:ingest': 1,
  'filesystem:mutation': 1,
  'scraper:metadata': 1,
  'emby:metadata': 1,
  'local:western-ai': 1,
  'local:ffmpeg': 1,
  'worker:*': 1,
  moviepilot: 1,
  'service:task': 1,
};

function positiveInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function resourceCapacityMap(config = {}) {
  return {
    ...DEFAULT_RESOURCE_CAPACITY,
    ...((config && config.resourceCapacity) || {}),
  };
}

function capacityForResource(resource, config = {}, fallback = 1) {
  const capacity = resourceCapacityMap(config);
  const resourceKey = resource && resource.resourceKey ? String(resource.resourceKey) : '';
  const resourceType = resource && resource.resourceType ? String(resource.resourceType) : '';
  const direct = positiveInteger(capacity[resourceKey]);
  if (direct !== null) return direct;
  if (resourceKey.startsWith('worker:')) {
    const worker = positiveInteger(capacity['worker:*']);
    if (worker !== null) return worker;
  }
  const byType = positiveInteger(capacity[resourceType]);
  if (byType !== null) return byType;
  const fallbackValue = positiveInteger(fallback);
  return fallbackValue !== null ? fallbackValue : 1;
}

module.exports = {
  DEFAULT_RESOURCE_CAPACITY,
  capacityForResource,
  resourceCapacityMap,
};
