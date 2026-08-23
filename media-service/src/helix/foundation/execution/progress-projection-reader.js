'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');

const DEVICE_CLASSES = new Set([
  'software_cpu', 'intel_qsv', 'nvidia_nvenc', 'amd_vaapi', 'remote_worker',
]);

function plannedExecutionDeviceClass(node) {
  if (!node || node.capability_ref !== 'libra.media.transcode@1') return null;
  let inputBindings;
  try { inputBindings = JSON.parse(node.input_bindings_json); } catch {
    throw Object.assign(new Error('Durable execution input bindings are not valid JSON.'),
      { code:'EXECUTION_PROGRESS_INPUT_INVALID' });
  }
  if (canonicalJson(inputBindings) !== node.input_bindings_json ||
      inputBindings?.schemaRef !== 'helix://foundation/types/EventInputBindingSet/v1' ||
      !Array.isArray(inputBindings.bindings)) {
    throw Object.assign(new Error('Durable execution input bindings failed their canonical shape fence.'),
      { code:'EXECUTION_PROGRESS_INPUT_INVALID' });
  }
  const values = inputBindings.bindings
    .filter((binding) => binding?.bindingKind === 'literal' &&
      ['encodeIntent', 'mediaExecutionDeviceSnapshot'].includes(binding.portName))
    .map((binding) => binding.value?.deviceClass)
    .filter(Boolean);
  if (!values.length || values.some((deviceClass) => !DEVICE_CLASSES.has(deviceClass)) ||
      new Set(values).size !== 1) {
    throw Object.assign(new Error('Durable Transcode input bindings have no single valid device class.'),
      { code:'EXECUTION_PROGRESS_INPUT_INVALID' });
  }
  return values[0];
}

function projectedProgress(sample) {
  if (!sample) return null;
  return Object.freeze({
    mode: sample.mode,
    currentValue: sample.current_value === null ? null : Number(sample.current_value),
    totalValue: sample.total_value === null ? null : Number(sample.total_value),
    unit: sample.unit,
    rate: sample.rate === null ? null : Number(sample.rate),
    etaMs: sample.eta_ms === null ? null : Number(sample.eta_ms),
    bucket: sample.progress_bucket,
  });
}

function createExecutionProgressProjectionReader(options) {
  const repository = createRepositoryDefinition({
    repositoryId: 'execution_progress_projection_reader',
    owner: 'execution-foundation',
    readOnly: true,
    schemaManifest: options.schemaManifest,
    statements: {
      works: { kind: 'select-in', tableId: 'fx_supporting_works', keyColumn: 'process_id', maxItems: 500,
        columns: ['work_id','process_id','work_kind','state','created_at_ms','updated_at_ms'], safeIntegers: true },
      events: { kind: 'select-in', tableId: 'fx_workflow_events', keyColumn: 'work_id', maxItems: 500,
        columns: ['event_id','plan_id','node_id','work_id','capability_ref','state','current_progress_revision'], safeIntegers: true },
      nodes: { kind: 'select-in', tableId: 'fx_plan_nodes', keyColumn: 'plan_id', maxItems: 500,
        columns: ['plan_id','node_id','capability_ref','input_bindings_json'] },
      progress: { kind: 'select-in', tableId: 'fx_event_progress', keyColumn: 'event_id', maxItems: 500,
        columns: ['event_id','revision','mode','current_value','total_value','unit','rate','eta_ms','progress_bucket','sampled_at_ms'], safeIntegers: true },
      results: { kind: 'select-in', tableId: 'fx_event_result_bindings', keyColumn: 'event_id', maxItems: 500,
        columns: ['event_id','outcome_kind','result_schema_ref','result_json','result_digest','committed_at_ms'], safeIntegers: true },
    },
  });
  return Object.freeze({
    read(processIds) {
      const ids = [...new Set(processIds)].filter(Boolean).sort();
      if (!ids.length) return Object.freeze([]);
      return options.unitOfWork.execute([{ participantId: 'execution_progress_projection', owner: 'execution-foundation', repositories: [repository], execute(context) {
        const r = context.repository(repository.repositoryId), works = [], events = [], nodes = [], samples = [], results = [];
        for (let offset = 0; offset < ids.length; offset += 500) works.push(...r.invoke('works', { values: ids.slice(offset, offset + 500) }));
        for (let offset = 0; offset < works.length; offset += 500) events.push(...r.invoke('events', { values: works.slice(offset, offset + 500).map((item) => item.work_id) }));
        const planIds = [...new Set(events.map((event) => event.plan_id).filter(Boolean))].sort();
        for (let offset = 0; offset < planIds.length; offset += 500) nodes.push(...r.invoke('nodes', { values: planIds.slice(offset, offset + 500) }));
        for (let offset = 0; offset < events.length; offset += 500) { const eventIds=events.slice(offset, offset + 500).map((item) => item.event_id); samples.push(...r.invoke('progress', { values: eventIds })); results.push(...r.invoke('results', { values: eventIds })); }
        const latest = new Map();
        for (const sample of samples) if (!latest.has(sample.event_id) || latest.get(sample.event_id).revision < sample.revision) latest.set(sample.event_id, sample);
        const nodeByKey = new Map(nodes.map((node) => [`${node.plan_id}\0${node.node_id}`, node]));
        const resultByEvent=new Map(results.map((row)=>{let value;try{value=JSON.parse(row.result_json);}catch{throw Object.assign(new Error('Durable execution Result is not valid JSON.'),{code:'EXECUTION_PROGRESS_RESULT_INVALID'});}if(canonicalJson(value)!==row.result_json||canonicalDigest(value)!==row.result_digest)throw Object.assign(new Error('Durable execution Result failed its digest fence.'),{code:'EXECUTION_PROGRESS_RESULT_INVALID'});return [row.event_id,Object.freeze({outcomeKind:row.outcome_kind,resultSchemaRef:row.result_schema_ref,result:value,resultDigest:row.result_digest,committedAtMs:Number(row.committed_at_ms)})];}));
        return Object.freeze(works.map((work) => Object.freeze({
          workId: work.work_id, processId: work.process_id, workKind: work.work_kind, state: work.state,
          createdAtMs: Number(work.created_at_ms), terminalAtMs: ['succeeded','failed','cancelled'].includes(work.state)?Number(work.updated_at_ms):null,
          events: Object.freeze(events.filter((event) => event.work_id === work.work_id).map((event) => Object.freeze({
            eventId: event.event_id, capabilityRef: event.capability_ref, state: event.state,
            executionDeviceClass: plannedExecutionDeviceClass(nodeByKey.get(`${event.plan_id}\0${event.node_id}`)),
            progress: projectedProgress(latest.get(event.event_id)), result: resultByEvent.get(event.event_id)||null,
          }))),
        })));
      } }]).execution_progress_projection;
    },
  });
}

module.exports = Object.freeze({ createExecutionProgressProjectionReader, plannedExecutionDeviceClass, projectedProgress });
