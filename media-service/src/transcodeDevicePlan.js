'use strict';

function parseStableKey(stableKey) {
  const value = String(stableKey || '');
  for (const backend of ['cpu', 'nvenc', 'qsv', 'amf']) if (value.startsWith(`${backend}:`)) return { backend };
  return null;
}
function buildDeviceSlots(config = {}) {
  const backupOnly = config.transcodeCpuParticipationStrategy === 'backup_only';
  return (config.transcodeEncodingDevices || []).filter((device) => device.inPool !== false).map((device) => ({ deviceId: device.stableKey, maxSlots: device.maxSlots || 1, priority: device.priority || 100, backend: parseStableKey(device.stableKey)?.backend || '', cpuBackupOnly: device.stableKey.startsWith('cpu:') && backupOnly })).sort((a, b) => a.priority - b.priority || (a.backend === 'cpu' ? 1 : -1));
}
function attemptsForBackend(backend) {
  if (backend === 'nvenc') return [{ strategy: 'nvenc_vbr', encoderKind: 'nvenc' }];
  if (backend === 'qsv') return [{ strategy: 'qsv_vbr', encoderKind: 'qsv' }, { strategy: 'qsv_cbr', encoderKind: 'qsv' }];
  if (backend === 'amf') return [{ strategy: 'amf_vbr', encoderKind: 'amf' }];
  if (backend === 'cpu') return [{ strategy: 'cpu_two_pass_abr', encoderKind: 'cpu' }, { strategy: 'cpu_strict_fallback', encoderKind: 'cpu' }];
  return [];
}
function buildRateControlPlan(slots = []) {
  const primary = [], backup = [], seen = new Set();
  for (const slot of slots) { if (!slot.backend || seen.has(slot.backend)) continue; seen.add(slot.backend); (slot.backend === 'cpu' && slot.cpuBackupOnly ? backup : primary).push(slot.backend); }
  return [...primary, ...backup].flatMap(attemptsForBackend);
}
module.exports = { buildDeviceSlots, buildRateControlPlan, parseStableKey };
