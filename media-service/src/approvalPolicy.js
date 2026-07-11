'use strict';

const MODES = new Set(['auto', 'confirm', 'forceConfirm']);

const DEFAULT_APPROVAL_POLICY = Object.freeze({
  'transcode.dolbyVisionTonemap': 'auto',
  'transcode.beforeReplace': 'confirm',
  'upgrade.candidateSelect': 'confirm',
  'upgrade.identityMismatch': 'forceConfirm',
  'upgrade.beforeReplace': 'confirm',
  'source.beforeOrganize': 'confirm',
  'metadata.reviewResult': 'auto',
});

function normalizeMode(mode, fallback = 'confirm') {
  return MODES.has(mode) ? mode : fallback;
}

function getSubLibrary(subjectInfo, config) {
  const subLibraryId = subjectInfo && subjectInfo.subLibraryId;
  if (!subLibraryId) return null;
  return ((config && config.subLibraries) || []).find((sl) => sl && sl.uuid === subLibraryId) || null;
}

function policyValue(policy, gateId) {
  if (!policy || typeof policy !== 'object') return undefined;
  return policy[gateId];
}

function resolveGate(gateId, { subjectInfo = null, task = null, config = null } = {}) {
  const subLib = getSubLibrary(subjectInfo || (task && task.subjectInfo), config);
  const globalMode = policyValue(config && config.approvalPolicy, gateId);
  const subLibMode = policyValue(subLib && subLib.approvalPolicy, gateId);
  const taskMode = policyValue(task && task.approvalPolicy, gateId);
  const defaultMode = DEFAULT_APPROVAL_POLICY[gateId] || 'confirm';

  // forceConfirm is a safety ceiling: lower-level overrides may raise a gate to
  // forceConfirm, but cannot lower a built-in forceConfirm gate to auto.
  const resolved = normalizeMode(taskMode, normalizeMode(subLibMode, normalizeMode(globalMode, defaultMode)));
  const mustForce = defaultMode === 'forceConfirm' || globalMode === 'forceConfirm' || subLibMode === 'forceConfirm' || taskMode === 'forceConfirm';
  return mustForce ? 'forceConfirm' : resolved;
}

function requiresConfirmation(gateId, opts = {}) {
  const mode = resolveGate(gateId, opts);
  return mode === 'confirm' || mode === 'forceConfirm';
}

function makeApproval(gateId, opts = {}) {
  const mode = resolveGate(gateId, opts);
  return {
    gateId,
    mode,
    title: opts.title || titleForGate(gateId),
    message: opts.message || '',
    options: opts.options || ['approve'],
    payload: opts.payload || {},
  };
}

function titleForGate(gateId) {
  switch (gateId) {
    case 'transcode.dolbyVisionTonemap': return 'Confirm Dolby Vision tonemap';
    case 'transcode.beforeReplace': return 'Confirm transcode replacement';
    case 'upgrade.candidateSelect': return 'Select replacement source';
    case 'upgrade.identityMismatch': return 'Verify upgrade identity';
    case 'upgrade.beforeReplace': return 'Confirm upgrade replacement';
    case 'source.beforeOrganize': return 'Confirm folder organization';
    case 'metadata.reviewResult': return 'Review metadata result';
    default: return 'Confirm task step';
  }
}

module.exports = {
  DEFAULT_APPROVAL_POLICY,
  resolveGate,
  requiresConfirmation,
  makeApproval,
};
