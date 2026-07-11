'use strict';

const configStore = require('./configStore');
const priorityEngine = require('./priorityEngine');
const taskAdmission = require('./taskAdmission');
const taskStore = require('./taskStore');
const sourceAccessResolver = require('./sourceAccessResolver');

function createTargetGateTask(input = {}) {
  const config = input.config || configStore.loadConfig();
  const item = input.item || input.itemInfo || {};
  const itemInfo = input.itemInfo || item;
  const targetGate = String(input.targetGate || input.taskTarget && input.taskTarget.targetGate || '');
  const source = input.source || 'manual';
  return taskStore.admitAndCreateTask({
    itemId: itemInfo.itemId || item.itemId,
    targetGate,
  }, (tasks) => {
    const admissionInput = {
      item,
      itemInfo,
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
      itemInfo,
      config,
    });
    const taskData = {
      itemId: itemInfo.itemId || item.itemId,
      itemName: itemInfo.name || item.name || itemInfo.itemId || item.itemId,
      source,
      status: input.status || (source === 'auto' ? 'queued' : 'created'),
      priority: priorityBreakdown.priority,
      priorityModelVersion: priorityEngine.TASK_PRIORITY_MODEL_VERSION,
      priorityBreakdown,
      taskTarget: admission.taskTarget,
      requestedIntent: admission.requestedIntent || input.requestedIntent || input.intent,
      objectiveRevisionSnapshot: String(itemInfo.objectiveHash || item.objectiveHash || itemInfo.objectiveVersion || item.objectiveVersion || ''),
      capabilityPolicyRevision: String(((config.subLibraries || []).find((entry) => entry.uuid === itemInfo.subLibraryId) || {}).capabilityPolicyRevision || '1'),
      helixAdmission: input.helixAdmission || null,
      maintenanceRun: input.maintenanceRun || null,
      maintenancePrioritySnapshot: input.maintenancePrioritySnapshot || { class: 'normal', revision: 0, reason: '', runId: '' },
      sourceAccessMappingRevision: sourceAccessResolver.getRevision(),
      itemInfo,
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
