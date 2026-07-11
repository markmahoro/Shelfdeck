'use strict';

const configStore = require('./configStore');
const priorityEngine = require('./priorityEngine');
const taskAdmission = require('./taskAdmission');
const taskStore = require('./taskStore');
const sourceAccessResolver = require('./sourceAccessResolver');

function createTargetGateTask(input = {}) {
  const config = input.config || configStore.loadConfig();
  const item = input.item || input.subjectInfo || {};
  const subjectInfo = input.subjectInfo || item;
  const targetGate = String(input.targetGate || input.taskTarget && input.taskTarget.targetGate || '');
  const source = input.source || 'manual';
  return taskStore.admitAndCreateTask({
    subjectId: subjectInfo.subjectId || item.subjectId,
    targetGate,
  }, (tasks) => {
    const admissionInput = {
      item,
      subjectInfo,
      targetGate,
      gateObjective: input.gateObjective,
      flowPreference: input.flowPreference,
      intent: input.requestedIntent || input.intent,
      config,
      tasks,
      helixAdmission: input.helixAdmission,
    };
    const admission = source === 'manual'
      ? taskAdmission.canCreateManualIntent(admissionInput)
      : taskAdmission.canCreateTask({ ...admissionInput, source });
    if (!admission.allowed) return { allowed: false, admission };

    const priorityBreakdown = priorityEngine.explainTaskPriority({
      source,
      taskTarget: admission.taskTarget,
      subjectInfo,
      config,
    });
    const taskData = {
      subjectId: subjectInfo.subjectId || item.subjectId,
      subjectName: subjectInfo.name || item.name || subjectInfo.subjectId || item.subjectId,
      source,
      status: input.status || (source === 'auto' ? 'queued' : 'created'),
      priority: priorityBreakdown.priority,
      priorityModelVersion: priorityEngine.TASK_PRIORITY_MODEL_VERSION,
      priorityBreakdown,
      taskTarget: admission.taskTarget,
      requestedIntent: admission.requestedIntent || input.requestedIntent || input.intent,
      objectiveRevisionSnapshot: String(subjectInfo.objectiveHash || item.objectiveHash || subjectInfo.objectiveVersion || item.objectiveVersion || ''),
      capabilityPolicyRevision: String(((config.subLibraries || []).find((entry) => entry.uuid === subjectInfo.subLibraryId) || {}).capabilityPolicyRevision || '1'),
      helixAdmission: input.helixAdmission || null,
      maintenanceRun: input.maintenanceRun || null,
      maintenancePrioritySnapshot: input.maintenancePrioritySnapshot || { class: 'normal', revision: 0, reason: '', runId: '' },
      sourceAccessMappingRevision: sourceAccessResolver.getRevision(),
      subjectInfo,
      logs: input.logs || [{
        ts: new Date().toISOString(),
        source: source === 'auto' ? 'kairox_automation' : 'manual_task_creator',
        event: 'target_gate_task_created',
      }],
    };
    return { allowed: true, admission, taskData };
  });
}

module.exports = { createTargetGateTask };
