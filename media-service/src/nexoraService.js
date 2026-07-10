'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const assetIdentity = require('./assetIdentity');
const nexoraStore = require('./nexoraStore');
const embyService = require('./services/embyService');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value == null ? null : value);
}

function hashStablePayload(payload) {
  return crypto.createHash('sha1').update(stableJson(payload)).digest('hex');
}

function sourceIdSegment(value, fallback) {
  const raw = String(value || fallback || '').trim();
  return encodeURIComponent(raw || fallback || 'unknown').replace(/%/g, '~');
}

function buildSourceId(input = {}) {
  const sourceAdapterId = sourceIdSegment(input.sourceAdapterId, 'unknown-adapter');
  const identityKind = sourceIdSegment(input.identityKind, 'source');
  const identityPayload = input.identityPayload && typeof input.identityPayload === 'object'
    ? input.identityPayload
    : {};
  return `${sourceAdapterId}:${identityKind}:${hashStablePayload(identityPayload)}`;
}

function normalizeRelativePath(rootPath, filePath) {
  const root = String(rootPath || '').trim();
  const file = String(filePath || '').trim();
  if (!file) return '';
  if (!root) return assetIdentity.normalizeMediaPath(file);
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return assetIdentity.normalizeMediaPath(file);
  return assetIdentity.normalizeMediaPath(rel);
}

function embyIdentity(input = {}) {
  const subLib = input.subLib || {};
  const sourceRefId = String(input.sourceRefId || input.sourceId || input.embyItemId || '').trim();
  const sourceAdapterId = String(input.sourceAdapterId || subLib.embyServerId || 'emby').trim();
  const identityPayload = {
    serverId: sourceAdapterId,
    sectionId: String(subLib.sectionId || input.sectionId || '').trim(),
    embyItemId: sourceRefId,
  };
  return {
    sourceAdapterId,
    identityKind: 'emby_item',
    identityPayload,
    sourceId: buildSourceId({ sourceAdapterId, identityKind: 'emby_item', identityPayload }),
  };
}

function adultFolderIdentity(input = {}) {
  const subLib = input.subLib || {};
  const filePath = String(input.filePath || input.path || '').trim();
  const sourceAdapterId = String(input.sourceAdapterId || 'adult-folder-local').trim();
  const identityPayload = {
    rootId: String(subLib.uuid || input.rootId || '').trim(),
    relativePath: normalizeRelativePath(subLib.watchRoot || input.rootPath || '', filePath),
  };
  return {
    sourceAdapterId,
    identityKind: 'adult_file',
    identityPayload,
    sourceId: buildSourceId({ sourceAdapterId, identityKind: 'adult_file', identityPayload }),
  };
}

function localAssetIdentity(input = {}) {
  const sourceAdapterId = String(input.sourceAdapterId || 'local-asset').trim();
  const identityPayload = {
    rootId: String(input.rootId || '').trim(),
    relativePath: input.assetKey ? '' : normalizeRelativePath(input.rootPath || '', input.path || ''),
    assetKey: String(input.assetKey || '').trim(),
  };
  return {
    sourceAdapterId,
    identityKind: 'local_asset',
    identityPayload,
    sourceId: buildSourceId({ sourceAdapterId, identityKind: 'local_asset', identityPayload }),
  };
}

function reasonForValidObservation(observationKind, previousBinding) {
  if (previousBinding && previousBinding.validity === 'invalid') return 'recovered';
  if (observationKind === 'new_source_observed') return 'accepted_source';
  if (observationKind === 'source_changed') return 'observed_present';
  return 'observed_present';
}

function bindingEvidenceRef(observationId) {
  return observationId ? `nexora_source_observations:${observationId}` : '';
}

function writeBindingObservation(input = {}) {
  const now = input.now || new Date().toISOString();
  const mediaItemId = String(input.mediaItemId || '').trim();
  const sourceId = String(input.sourceId || '').trim();
  const previousBinding = mediaItemId && sourceId
    ? nexoraStore.getSourceBinding(mediaItemId, sourceId)
    : null;
  const binding = nexoraStore.upsertSourceBinding({
    bindingId: input.bindingId,
    mediaItemId,
    sourceId,
    validity: input.validity,
    reason: input.reason,
    observedAt: input.observedAt || now,
    updatedAt: now,
  });
  const observation = nexoraStore.insertSourceObservation({
    bindingId: binding.bindingId,
    mediaItemId,
    sourceId,
    result: input.result,
    reason: input.reason,
    identityKind: input.identityKind,
    identityPayload: input.identityPayload,
    locator: input.locator,
    evidence: input.evidence,
    observedAt: input.observedAt || now,
    createdAt: now,
  });
  const updated = nexoraStore.upsertSourceBinding({
    bindingId: binding.bindingId,
    mediaItemId,
    sourceId,
    validity: input.validity,
    reason: input.reason,
    evidenceRef: bindingEvidenceRef(observation.observationId),
    observedAt: input.observedAt || now,
    updatedAt: now,
    createdAt: binding.createdAt,
  });
  const bindings = nexoraStore.getSourceBindingsForItem(mediaItemId);
  const activeBindings = bindings.filter((entry) => entry.validity === 'valid');
  const state = nexoraStore.bumpSourceState({
    mediaItemId,
    readiness: activeBindings.length > 0 ? 'ready' : 'missing',
    sourceAccessDescriptor: activeBindings.length > 0 ? {
      bindingId: updated.bindingId,
      sourceId,
      sourceRevisionHint: sourceId,
      sourceType: input.identityKind === 'emby_item' ? 'emby' : input.identityKind === 'adult_file' ? 'adult_folder' : input.identityKind,
      identityKind: input.identityKind || '',
      identityPayload: input.identityPayload || {},
      subLibraryId: input.evidence && input.evidence.subLibraryId || '',
      locator: input.locator || {},
      observedStructure: input.observedStructure || {},
    } : {},
    latestObservationId: observation.observationId,
    updatedAt: now,
  });
  return { binding: updated, observation, previousBinding, state };
}

function recordPreviousBindingInvalid(input = {}) {
  const previousSourceRefId = String(input.previousSourceRefId || '').trim();
  const nextSourceRefId = String(input.nextSourceRefId || '').trim();
  if (!previousSourceRefId) return null;
  const identity = input.adapter === 'adult_folder'
    ? adultFolderIdentity({ subLib: input.subLib, filePath: input.previousPath || previousSourceRefId })
    : embyIdentity({ subLib: input.subLib, sourceRefId: previousSourceRefId });
  const nextIdentity = input.adapter === 'adult_folder'
    ? adultFolderIdentity({ subLib: input.subLib, filePath: nextSourceRefId })
    : embyIdentity({ subLib: input.subLib, sourceRefId: nextSourceRefId });
  if (identity.sourceId === nextIdentity.sourceId) return null;
  return writeBindingObservation({
    now: input.now,
    mediaItemId: input.mediaItemId,
    sourceId: identity.sourceId,
    validity: 'invalid',
    reason: input.reason || 'identity_mismatch',
    result: 'identity_mismatch',
    identityKind: identity.identityKind,
    identityPayload: identity.identityPayload,
    locator: input.previousLocator || {},
    evidence: {
      ...(input.evidence || {}),
      previousSourceRefId,
      nextSourceRefId,
      observationKind: input.observationKind || 'rebind',
    },
  });
}

function recordEmbySourceObservation(input = {}) {
  const now = input.now || new Date().toISOString();
  const item = input.item || {};
  const mediaItemId = String(input.mediaItemId || item.itemId || '').trim();
  const sourceRefId = String(input.sourceRefId || item.sourceRefId || item.sourceId || item.embyItemId || '').trim();
  if (!mediaItemId || !sourceRefId) return null;
  recordPreviousBindingInvalid({
    adapter: 'emby',
    mediaItemId,
    subLib: input.subLib,
    previousSourceRefId: input.previousSourceRefId,
    nextSourceRefId: sourceRefId,
    now,
    observationKind: input.observationKind,
    reason: 'identity_mismatch',
    evidence: { source: 'emby_inventory', subLibraryId: input.subLib && input.subLib.uuid || item.subLibraryId || '' },
  });

  const identity = embyIdentity({ subLib: input.subLib, sourceRefId });
  const previousBinding = nexoraStore.getSourceBinding(mediaItemId, identity.sourceId);
  const valid = input.sourceExists !== false && input.observationKind !== 'source_missing';
  const reason = valid
    ? reasonForValidObservation(input.observationKind, previousBinding)
    : 'source_missing';
  return writeBindingObservation({
    now,
    mediaItemId,
    sourceId: identity.sourceId,
    validity: valid ? 'valid' : 'invalid',
    reason,
    result: valid ? 'present' : 'missing',
    identityKind: identity.identityKind,
    identityPayload: identity.identityPayload,
    locator: input.locator || item.locator || { path: item.path || '' },
    observedStructure: {
      mediaKind: item.type || '',
      playable: ['movie', 'episode'].includes(String(item.type || '').toLowerCase()),
      parentSourceRefId: item.parentId || '',
      seriesSourceRefId: item.seriesId || '',
      displayName: item.name || '',
    },
    evidence: {
      source: 'emby_inventory',
      observationKind: input.observationKind || (valid ? 'source_observed' : 'source_missing'),
      subLibraryId: input.subLib && input.subLib.uuid || item.subLibraryId || '',
      sourceRefId,
    },
  });
}

function recordAdultFolderSourceObservation(input = {}) {
  const now = input.now || new Date().toISOString();
  const item = input.item || {};
  const mediaItemId = String(input.mediaItemId || item.itemId || '').trim();
  const filePath = String(input.filePath || item.path || item.sourceRefId || item.sourceId || '').trim();
  if (!mediaItemId || !filePath) return null;
  recordPreviousBindingInvalid({
    adapter: 'adult_folder',
    mediaItemId,
    subLib: input.subLib,
    previousSourceRefId: input.previousSourceRefId,
    previousPath: input.previousPath,
    nextSourceRefId: filePath,
    now,
    observationKind: input.observationKind,
    reason: 'path_changed',
    evidence: { source: 'adult_folder', subLibraryId: input.subLib && input.subLib.uuid || item.subLibraryId || '' },
  });

  const identity = adultFolderIdentity({ subLib: input.subLib, filePath });
  const previousBinding = nexoraStore.getSourceBinding(mediaItemId, identity.sourceId);
  const valid = input.sourceExists !== false && input.observationKind !== 'source_missing';
  const reason = valid
    ? reasonForValidObservation(input.observationKind, previousBinding)
    : 'source_missing';
  return writeBindingObservation({
    now,
    mediaItemId,
    sourceId: identity.sourceId,
    validity: valid ? 'valid' : 'invalid',
    reason,
    result: valid ? 'present' : 'missing',
    identityKind: identity.identityKind,
    identityPayload: identity.identityPayload,
    locator: input.locator || item.locator || { path: filePath },
    observedStructure: { mediaKind: 'adult_file', playable: true, parentSourceRefId: '', seriesSourceRefId: '', displayName: path.basename(filePath) },
    evidence: {
      source: 'adult_folder',
      observationKind: input.observationKind || (valid ? 'source_observed' : 'source_missing'),
      subLibraryId: input.subLib && input.subLib.uuid || item.subLibraryId || '',
      path: filePath,
    },
  });
}

function factsForItemId(mediaItemId) {
  const sourceBindings = nexoraStore.getSourceBindingsForItem(mediaItemId);
  const validSourceBindingCount = sourceBindings.filter((binding) => binding.validity === 'valid').length;
  return {
    sourceBindings,
    validSourceBindingCount,
    sourceProjection: getSourceProjection(mediaItemId),
  };
}

function decorateItem(item) {
  if (!item || !item.itemId) return item;
  return {
    ...item,
    nexora: getSourceProjection(item.itemId),
  };
}

function decorateItems(items = []) {
  const list = Array.isArray(items) ? items : [];
  const itemIds = list.map((item) => item && item.itemId).filter(Boolean);
  const projections = getSourceProjections(itemIds);
  return list.map((item) => {
    if (!item || !item.itemId) return item;
    return {
      ...item,
      nexora: projections[item.itemId],
    };
  });
}

function sourceProjectionForFacts(mediaItemId, sourceBindings = [], state = null) {
  const bindings = Array.isArray(sourceBindings) ? sourceBindings : [];
  const activeBindings = bindings.filter((binding) => binding.validity === 'valid');
  const latest = bindings.reduce((selected, binding) => {
    if (!selected) return binding;
    return String(binding.observedAt || binding.updatedAt || '') > String(selected.observedAt || selected.updatedAt || '')
      ? binding
      : selected;
  }, null);
  return {
    itemId: String(mediaItemId || ''),
    sourceRevision: state && state.sourceRevision || 0,
    readiness: state && state.readiness || (activeBindings.length > 0 ? 'ready' : (bindings.length > 0 ? 'missing' : 'unresolved')),
    activeBindings,
    sourceBindings: bindings,
    sourceAccessDescriptor: state && state.sourceAccessDescriptor || {},
    latestObservation: latest ? {
      bindingId: latest.bindingId || '',
      reason: latest.reason || '',
      observedAt: latest.observedAt || '',
    } : null,
  };
}

function getSourceProjection(mediaItemId) {
  return sourceProjectionForFacts(mediaItemId, nexoraStore.getSourceBindingsForItem(mediaItemId), nexoraStore.getSourceState(mediaItemId));
}

function getSourceProjections(mediaItemIds = []) {
  const ids = [...new Set((mediaItemIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const bindingsByItem = nexoraStore.getSourceBindingsForItems(ids);
  const statesByItem = nexoraStore.getSourceStates(ids);
  return ids.reduce((out, itemId) => {
    out[itemId] = sourceProjectionForFacts(itemId, bindingsByItem[itemId] || [], statesByItem[itemId] || null);
    return out;
  }, {});
}

function identityForSourceReference(sourceReference = {}) {
  const source = String(sourceReference.source || sourceReference.adapter || '').toLowerCase();
  if (source === 'emby') {
    return embyIdentity({
      subLib: sourceReference.subLib,
      sourceRefId: sourceReference.sourceRefId || sourceReference.embyItemId,
    });
  }
  if (source === 'folder' || source === 'adult_folder') {
    return adultFolderIdentity({
      subLib: sourceReference.subLib,
      filePath: sourceReference.filePath || sourceReference.path,
    });
  }
  return null;
}

function resolveBoundItemId(sourceReference = {}) {
  const identity = identityForSourceReference(sourceReference);
  if (!identity) return '';
  const binding = nexoraStore.findSourceBindingBySourceId(identity.sourceId);
  return binding && binding.mediaItemId || '';
}

function folderObservationPage(sourceDefinition = {}, cursor = {}, limit = 100, deadlineMs = Date.now() + 5000) {
  const rootPath = String(sourceDefinition.watchRoot || '').trim();
  if (!rootPath || !fs.existsSync(rootPath)) {
    throw Object.assign(new Error('Folder library watchRoot is unavailable'), { code: 'NEXORA_SOURCE_ROOT_UNAVAILABLE' });
  }
  const frames = Array.isArray(cursor.frames) && cursor.frames.length > 0
    ? cursor.frames.map((frame) => ({ dir: String(frame.dir || ''), offset: Math.max(0, Number(frame.offset) || 0) }))
    : [{ dir: '', offset: 0 }];
  const extensions = new Set(['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov', '.wmv']);
  const files = [];
  while (frames.length > 0 && files.length < limit && Date.now() < deadlineMs) {
    const frame = frames[frames.length - 1];
    const absoluteDir = path.join(rootPath, frame.dir);
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    if (frame.offset >= entries.length) {
      frames.pop();
      continue;
    }
    const entry = entries[frame.offset];
    frame.offset += 1;
    const relative = path.join(frame.dir, entry.name);
    if (entry.isDirectory()) {
      frames.push({ dir: relative, offset: 0 });
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(rootPath, relative));
    }
  }
  return { files, cursor: { frames }, done: frames.length === 0 };
}

async function observeLibraryPage(command = {}) {
  const sourceDefinition = command.sourceDefinition || {};
  const source = String(sourceDefinition.source || 'emby').toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(command.limit) || 100));
  if (source === 'emby') {
    const page = await embyService.getLibraryItemsPage(command.serverConfig || {}, sourceDefinition.sectionId, {
      startIndex: command.cursor && command.cursor.startIndex || 0,
      limit,
    });
    return {
      observations: page.items.map((item) => ({
        sourceReference: {
          source: 'emby',
          subLib: {
            uuid: sourceDefinition.uuid,
            embyServerId: sourceDefinition.embyServerId,
            sectionId: sourceDefinition.sectionId,
          },
          sourceRefId: item.itemId,
          item,
          observationKind: 'source_observed',
        },
      })),
      cursor: { startIndex: page.nextIndex },
      done: page.done,
      total: page.total,
    };
  }
  if (source === 'folder') {
    const page = folderObservationPage(sourceDefinition, command.cursor, limit, command.deadlineMs);
    return {
      observations: page.files.map((filePath) => ({
        sourceReference: {
          source: 'adult_folder',
          subLib: { uuid: sourceDefinition.uuid, watchRoot: sourceDefinition.watchRoot },
          path: filePath,
          observationKind: 'source_observed',
        },
      })),
      cursor: page.cursor,
      done: page.done,
      total: null,
    };
  }
  throw Object.assign(new Error(`Unsupported library source: ${source}`), { code: 'NEXORA_SOURCE_ADAPTER_UNSUPPORTED' });
}

function ensureOnboarding(command = {}) {
  const sourceReference = command.sourceReference || {};
  const source = String(sourceReference.source || sourceReference.adapter || '').toLowerCase();
  const common = {
    mediaItemId: command.itemId,
    item: { ...(sourceReference.item || {}), itemId: command.itemId },
    subLib: sourceReference.subLib || {},
    sourceExists: sourceReference.sourceExists !== false,
    observationKind: sourceReference.observationKind || 'new_source_observed',
    now: sourceReference.observedAt || command.observedAt || new Date().toISOString(),
    previousSourceRefId: sourceReference.previousSourceRefId,
    previousPath: sourceReference.previousPath,
  };
  if (source === 'emby') {
    recordEmbySourceObservation({
      ...common,
      sourceRefId: sourceReference.sourceRefId || sourceReference.embyItemId,
      locator: sourceReference.locator || {
        sourceRefId: sourceReference.sourceRefId || sourceReference.embyItemId || '',
        serverId: sourceReference.subLib && sourceReference.subLib.embyServerId || '',
        sectionId: sourceReference.subLib && sourceReference.subLib.sectionId || '',
      },
    });
  } else if (source === 'adult_folder' || source === 'folder') {
    recordAdultFolderSourceObservation({
      ...common,
      filePath: sourceReference.filePath || sourceReference.path,
      locator: sourceReference.locator || {
        path: sourceReference.filePath || sourceReference.path || '',
        rootPath: sourceReference.subLib && sourceReference.subLib.watchRoot || '',
      },
    });
  } else {
    const error = new Error(`Unsupported Nexora source adapter: ${source || 'unknown'}`);
    error.code = 'NEXORA_SOURCE_ADAPTER_UNSUPPORTED';
    throw error;
  }
  return getSourceProjection(command.itemId);
}

function diagnoseSource(command = {}) {
  return getSourceProjection(command.itemId);
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const root = path.resolve(String(rootPath || ''));
  const target = path.resolve(String(targetPath || ''));
  if (!rootPath || !targetPath || (target !== root && !target.startsWith(`${root}${path.sep}`))) {
    const error = new Error('Physical delete target is outside the configured source root');
    error.code = 'NEXORA_DELETE_OUTSIDE_SOURCE_ROOT';
    throw error;
  }
  return target;
}

function invalidateBindings(itemId, reason, readiness) {
  const projection = getSourceProjection(itemId);
  for (const binding of projection.activeBindings || []) {
    writeBindingObservation({
      mediaItemId: itemId,
      sourceId: binding.sourceId,
      bindingId: binding.bindingId,
      validity: 'invalid',
      reason,
      result: readiness,
      identityKind: 'offboarding',
      identityPayload: { sourceId: binding.sourceId },
      locator: projection.sourceAccessDescriptor && projection.sourceAccessDescriptor.locator || {},
      evidence: { cleanupMode: readiness === 'destroyed' ? 'delete_source' : 'detach_source' },
    });
  }
  return nexoraStore.bumpSourceState({
    mediaItemId: itemId,
    readiness,
    sourceAccessDescriptor: {},
    updatedAt: new Date().toISOString(),
  });
}

async function ensureOffboarding(command = {}) {
  const cleanupMode = String(command.cleanupMode || 'retain_source');
  const projection = getSourceProjection(command.itemId);
  if (cleanupMode === 'retain_source') {
    return { itemId: command.itemId, cleanupMode, completed: true, sourceProjection: projection, evidence: { sourceMutated: false } };
  }
  if (cleanupMode === 'delete_source' && command.destructiveAuthorization !== true) {
    const error = new Error('Physical delete requires explicit destructive authorization');
    error.code = 'NEXORA_DESTRUCTIVE_AUTHORIZATION_REQUIRED';
    throw error;
  }
  if (cleanupMode === 'delete_source') {
    const descriptor = projection.sourceAccessDescriptor || {};
    const locator = descriptor.locator || {};
    if (locator.path) {
      const target = ensurePathInsideRoot(locator.rootPath, locator.path);
      fs.rmSync(target, { recursive: true, force: true });
    } else if (locator.sourceRefId && locator.serverId) {
      const configStore = require('./configStore');
      const embyService = require('./services/embyService');
      const server = (configStore.loadConfig().embyServers || {})[locator.serverId];
      if (!server) {
        const error = new Error('Emby server for physical delete is not configured');
        error.code = 'NEXORA_EMBY_SERVER_NOT_FOUND';
        throw error;
      }
      await embyService.deleteLibraryItem(server, locator.sourceRefId);
    } else {
      const error = new Error('Source access descriptor cannot perform physical delete');
      error.code = 'NEXORA_DELETE_DESCRIPTOR_UNSUPPORTED';
      throw error;
    }
    invalidateBindings(command.itemId, 'source_destroyed', 'destroyed');
    return { itemId: command.itemId, cleanupMode, completed: true, sourceProjection: getSourceProjection(command.itemId), evidence: { sourceMutated: true, deleted: true } };
  }
  if (cleanupMode === 'detach_source') {
    invalidateBindings(command.itemId, 'detached_by_offboarding', 'detached');
    return { itemId: command.itemId, cleanupMode, completed: true, sourceProjection: getSourceProjection(command.itemId), evidence: { sourceMutated: true, deleted: false } };
  }
  const error = new Error(`Unsupported cleanup mode: ${cleanupMode}`);
  error.code = 'NEXORA_CLEANUP_MODE_UNSUPPORTED';
  throw error;
}

module.exports = {
  stableJson,
  buildSourceId,
  embyIdentity,
  adultFolderIdentity,
  localAssetIdentity,
  recordEmbySourceObservation,
  recordAdultFolderSourceObservation,
  factsForItemId,
  decorateItem,
  decorateItems,
  ensureOnboarding,
  diagnoseSource,
  ensureOffboarding,
  getSourceProjection,
  getSourceProjections,
  resolveBoundItemId,
  observeLibraryPage,
};
