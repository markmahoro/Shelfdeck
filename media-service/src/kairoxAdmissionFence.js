'use strict';

const admissionStore = require('./kairoxAdmissionStore');

function taskAdmission(task = {}) {
  return task.helixAdmission && typeof task.helixAdmission === 'object'
    ? task.helixAdmission
    : null;
}

function checkTask(task = {}, checkpoint = '') {
  const expected = taskAdmission(task);
  if (!expected) return { allowed: true, legacy: true, checkpoint };
  const current = admissionStore.getAdmission(task.itemId);
  const expectedGeneration = Number(expected.admissionGeneration) || 0;
  if (!current) return { allowed: false, reason: 'admission_missing', expectedGeneration, checkpoint };
  if (current.status !== 'active') {
    return { allowed: false, reason: `admission_${current.status}`, expectedGeneration, currentGeneration: current.admissionGeneration, checkpoint };
  }
  if (current.admissionGeneration !== expectedGeneration) {
    return { allowed: false, reason: 'admission_generation_stale', expectedGeneration, currentGeneration: current.admissionGeneration, checkpoint };
  }
  return { allowed: true, expectedGeneration, currentGeneration: current.admissionGeneration, checkpoint };
}

function assertTask(task, checkpoint = '') {
  const result = checkTask(task, checkpoint);
  if (!result.allowed) {
    const error = new Error(`Kairox task fenced at ${checkpoint || 'checkpoint'}: ${result.reason}`);
    error.code = 'KAIROX_ADMISSION_FENCED';
    error.fence = result;
    throw error;
  }
  return result;
}

module.exports = { taskAdmission, checkTask, assertTask };
