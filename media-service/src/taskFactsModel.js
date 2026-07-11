'use strict';

function json(value) { return JSON.stringify(value == null ? null : value); }
function text(value) { return value == null ? '' : String(value); }
function integer(value) { return value ? 1 : 0; }

function taskFacts(task = {}) {
  const subjectInfo = task.subjectInfo && typeof task.subjectInfo === 'object' ? task.subjectInfo : {};
  const taskTarget = task.taskTarget && typeof task.taskTarget === 'object' ? task.taskTarget : {
    object: { type: 'media_item', subjectId: task.subjectId || '', subLibraryId: subjectInfo.subLibraryId || '' },
    targetGate: task.targetGate || '',
    gateObjective: task.gateObjective && typeof task.gateObjective === 'object' ? task.gateObjective : {},
    source: task.source || '',
  };
  const objective = taskTarget.gateObjective && typeof taskTarget.gateObjective === 'object' ? taskTarget.gateObjective : {};
  return {
    source: text(task.source),
    progress: Number.isFinite(Number(task.progress)) ? Number(task.progress) : null,
    phase: task.phase == null ? null : text(task.phase),
    priority_model_version: text(task.priorityModelVersion),
    retry_count: Number.isInteger(task.retryCount) ? task.retryCount : Number(task.retryCount || 0) || 0,
    pausing_requested: integer(task.pausingRequested),
    node_id: text(task.nodeId),
    sub_library_id: text(subjectInfo.subLibraryId),
    item_path: text(subjectInfo.path || subjectInfo.sourcePath),
    target_gate: text(taskTarget.targetGate),
    gate_objective_kind: text(objective.kind),
    gate_objective_json: json(objective),
  };
}

function taskEventFacts(event = {}) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return {
    resource_key: text(payload.resourceKey),
    resource_label: text(payload.resourceLabel),
  };
}

module.exports = { taskFacts, taskEventFacts };
