'use strict';

function json(value) { return JSON.stringify(value == null ? null : value); }
function text(value) { return value == null ? '' : String(value); }
function integer(value) { return value ? 1 : 0; }

function taskFacts(task = {}) {
  const itemInfo = task.itemInfo && typeof task.itemInfo === 'object' ? task.itemInfo : {};
  const taskTarget = task.taskTarget && typeof task.taskTarget === 'object' ? task.taskTarget : {
    object: { type: 'media_item', itemId: task.itemId || '', subLibraryId: itemInfo.subLibraryId || '' },
    targetGate: task.targetGate || (task.flowPlan && task.flowPlan.bridgeKind) || '',
    gateObjective: task.gateObjective && typeof task.gateObjective === 'object' ? task.gateObjective : {},
    source: task.source || '',
  };
  const bridge = task.taskBridge && typeof task.taskBridge === 'object' ? task.taskBridge : {};
  const flow = task.flowPlan && typeof task.flowPlan === 'object' ? task.flowPlan : {};
  const objective = taskTarget.gateObjective && typeof taskTarget.gateObjective === 'object' ? taskTarget.gateObjective : {};
  return {
    source: text(task.source),
    progress: Number.isFinite(Number(task.progress)) ? Number(task.progress) : null,
    phase: task.phase == null ? null : text(task.phase),
    resume_point: task.resumePoint == null ? null : text(task.resumePoint),
    manual_execute_requested: integer(task.manualExecuteRequested),
    priority_model_version: text(task.priorityModelVersion),
    retry_count: Number.isInteger(task.retryCount) ? task.retryCount : Number(task.retryCount || 0) || 0,
    pausing_requested: integer(task.pausingRequested),
    node_id: text(task.nodeId),
    sub_library_id: text(itemInfo.subLibraryId),
    item_path: text(itemInfo.path || itemInfo.sourcePath),
    bridge_kind: text(bridge.kind || flow.bridgeKind),
    bridge_from: text(bridge.from),
    bridge_to: text(bridge.to),
    bridge_reason: text(bridge.reason),
    flow_version: text(flow.version),
    flow_direction: text(flow.direction),
    flow_kind: text(flow.flowKind),
    flow_executor: text(flow.executor),
    primary_resource_type: text(flow.primaryResourceType),
    resource_types_json: json(Array.isArray(flow.resourceTypes) ? flow.resourceTypes : []),
    flow_steps_json: json(Array.isArray(flow.steps) ? flow.steps : []),
    target_gate: text(taskTarget.targetGate || bridge.kind || flow.bridgeKind),
    gate_objective_kind: text(objective.kind),
    gate_objective_json: json(objective),
  };
}

function taskEventFacts(event = {}) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return {
    bridge_kind: text(payload.bridgeKind || (payload.taskBridge && payload.taskBridge.kind)),
    flow_direction: text(payload.flowDirection || (payload.flowPlan && payload.flowPlan.direction)),
    flow_kind: text(payload.flowKind || (payload.flowPlan && payload.flowPlan.flowKind) || event.flowKind),
    resource_key: text(payload.resourceKey),
    resource_label: text(payload.resourceLabel),
  };
}

module.exports = { taskFacts, taskEventFacts };
