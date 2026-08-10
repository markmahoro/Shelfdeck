'use strict';

// BDMV scope resolution is deliberately pure and profile-neutral.  It is used
// before Triage knows whether the contents are a Movie or anything else.
function normalized(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function parts(value) { return normalized(value).split('/').filter(Boolean); }

function containerCandidateForBdmv(value) {
  const segments = parts(value);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].toUpperCase() === 'BDMV') {
      const container = segments.slice(0, index).join('/');
      return {
        containerRelativeLocation: container || '.',
        bdmvRootRelativeLocation: [...segments.slice(0, index), 'BDMV'].join('/'),
      };
    }
  }
  return null;
}

function knownLocation(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.fieldRelativeLocation || value.relativeLocation || value.location || value.currentLocation || '';
}

function hasBdmvSibling(container, locations) {
  const expected = (normalized(container) + '/BDMV').toLocaleLowerCase('en-US');
  return locations.some((item) => {
    const value = normalized(knownLocation(item)).toLocaleLowerCase('en-US');
    return value === expected || value.startsWith(expected + '/');
  });
}

/**
 * Resolve a file (or directory member) to its BDMV container.  CERTIFICATE is
 * accepted only when the same frozen Observation scope also contains a sibling
 * BDMV directory, preventing ordinary certificate folders from being treated
 * as discs.
 */
function resolveBdmvContainerScope(location, knownLocations = []) {
  const direct = containerCandidateForBdmv(location);
  if (direct) return Object.freeze({
    ...direct,
    groupKey: 'bdmv:' + direct.containerRelativeLocation,
    sourceKind: 'bdmv',
  });
  const segments = parts(location);
  const certificateIndex = segments.findIndex((segment) => segment.toUpperCase() === 'CERTIFICATE');
  if (certificateIndex >= 0) {
    const container = segments.slice(0, certificateIndex).join('/') || '.';
    if (hasBdmvSibling(container, knownLocations)) return Object.freeze({
      containerRelativeLocation: container,
      bdmvRootRelativeLocation: (container === '.' ? 'BDMV' : container + '/BDMV'),
      groupKey: 'bdmv:' + container,
      sourceKind: 'certificate',
    });
  }
  return null;
}

function relativeToBdmvRoot(location, scope) {
  const root = typeof scope === 'string' ? normalized(scope) : normalized(scope?.bdmvRootRelativeLocation);
  const value = normalized(location);
  const foldedRoot = root.toLocaleLowerCase('en-US');
  const foldedValue = value.toLocaleLowerCase('en-US');
  if (foldedValue === foldedRoot) return '';
  return foldedValue.startsWith(foldedRoot + '/') ? value.slice(root.length + 1) : null;
}

function relativeToBdmvContainer(location, scope) {
  const container = typeof scope === 'string' ? normalized(scope) : normalized(scope?.containerRelativeLocation);
  const value = normalized(location);
  const foldedContainer = container.toLocaleLowerCase('en-US');
  const foldedValue = value.toLocaleLowerCase('en-US');
  if (foldedValue === foldedContainer) return '';
  return foldedValue.startsWith(foldedContainer + '/') ? value.slice(container.length + 1) : null;
}

function parentRelativeLocation(location) {
  const value = normalized(location);
  const index = value.lastIndexOf('/');
  return index < 0 ? '.' : value.slice(0, index) || '.';
}

function isBdmvInternalRelative(value) {
  const relative = normalized(value).toUpperCase();
  const base = relative.split('/').at(-1) || '';
  return /^(PLAYLIST|STREAM|CLIPINF)(?:\/|$)/.test(relative) ||
    /^(INDEX|MOVIEOBJECT)\.BDMV$/.test(base) ||
    /\.(MPLS|CLPI|M2TS|BDMV)$/.test(base);
}

module.exports = Object.freeze({
  normalized,
  parentRelativeLocation,
  resolveBdmvContainerScope,
  relativeToBdmvRoot,
  relativeToBdmvContainer,
  isBdmvInternalRelative,
});
