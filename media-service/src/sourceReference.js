'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSourceReference(input = {}, defaults = {}) {
  const source = clean(input.source || defaults.source);
  const subLibraryId = clean(input.subLibraryId || defaults.subLibraryId);
  const sourceRefId = clean(
    input.sourceRefId
    || input.sourceId
    || input.embyItemId
    || input.path
    || defaults.sourceRefId
  );
  const locator = {
    ...((defaults.locator && typeof defaults.locator === 'object') ? defaults.locator : {}),
    ...((input.locator && typeof input.locator === 'object') ? input.locator : {}),
  };
  if (!locator.path && input.path) locator.path = input.path;
  if (!locator.parentRefId && (input.parentId || input.seriesId)) {
    locator.parentRefId = input.parentId || input.seriesId;
  }
  return {
    source,
    sourceRefId,
    subLibraryId,
    sourceAdapterId: clean(input.sourceAdapterId || defaults.sourceAdapterId),
    observedAt: clean(input.observedAt || input.sourceObservedAt || defaults.observedAt) || nowIso(),
    locator,
    evidenceRef: clean(input.evidenceRef || defaults.evidenceRef),
  };
}

function applySourceReference(itemInfo = {}, ref = {}) {
  const next = {
    ...itemInfo,
    source: ref.source || itemInfo.source,
    sourceRefId: ref.sourceRefId || itemInfo.sourceRefId,
    subLibraryId: ref.subLibraryId || itemInfo.subLibraryId,
    sourceAdapterId: ref.sourceAdapterId || itemInfo.sourceAdapterId,
    sourceObservedAt: ref.observedAt || itemInfo.sourceObservedAt,
    locator: ref.locator || itemInfo.locator,
  };
  if (ref.source === 'emby') {
    next.sourceId = next.sourceId || ref.sourceRefId;
    next.embyItemId = next.embyItemId || ref.sourceRefId;
  }
  if (ref.source === 'adult_folder') {
    next.path = next.path || (ref.locator && ref.locator.path) || ref.sourceRefId;
  }
  return next;
}

module.exports = {
  normalizeSourceReference,
  applySourceReference,
};
