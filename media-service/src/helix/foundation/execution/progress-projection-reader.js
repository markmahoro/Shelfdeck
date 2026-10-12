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
    sampledAtMs: Number(sample.sampled_at_ms),
  });
}

function parseDurableJson(value, code, label) {
  let parsed;
  try { parsed = JSON.parse(value); } catch {
    throw Object.assign(new Error('Durable '+label+' is not valid JSON.'), { code });
  }
  if (canonicalJson(parsed) !== value) {
    throw Object.assign(new Error('Durable '+label+' failed its canonical shape fence.'), { code });
  }
  return parsed;
}

function createExecutionProgressProjectionReader(options) {
  const repository = createRepositoryDefinition({
    repositoryId: 'execution_progress_projection_reader',
    owner: 'execution-foundation',
    readOnly: true,
    schemaManifest: options.schemaManifest,
    statements: {
      works: { kind: 'select-in', tableId: 'fx_supporting_works', keyColumn: 'process_id', maxItems: 500,
        columns: ['work_id','owner_domain','process_type','process_id','work_kind','state','created_at_ms','updated_at_ms'], safeIntegers: true },
      exact_works: { kind: 'select-in', tableId: 'fx_supporting_works', keyColumn: 'work_id', maxItems: 500,
        columns: ['work_id','owner_domain','process_type','process_id','work_kind','state','created_at_ms','updated_at_ms'], safeIntegers: true },
      attempts: { kind: 'select-in', tableId: 'fx_work_attempts', keyColumn: 'work_id', maxItems: 500,
        columns: ['attempt_id','work_id','ordinal','state','failure_code'], safeIntegers: true },
      events: { kind: 'select-in', tableId: 'fx_workflow_events', keyColumn: 'work_id', maxItems: 500,
        columns: ['event_id','plan_id','node_id','work_id','capability_ref','state','current_progress_revision'], safeIntegers: true },
      event_attempts: { kind: 'select-in', tableId: 'fx_event_attempts', keyColumn: 'event_id', maxItems: 500,
        columns: ['event_attempt_id','event_id','ordinal','outcome_kind','failure_class','failure_code'], safeIntegers: true },
      plans: { kind: 'select-in', tableId: 'fx_workflow_plans', keyColumn: 'attempt_id', maxItems: 500,
        columns: ['plan_id','attempt_id','planner_ref','planner_version','state','created_at_ms'], safeIntegers: true },
      nodes: { kind: 'select-in', tableId: 'fx_plan_nodes', keyColumn: 'plan_id', maxItems: 500,
        columns: ['plan_id','node_id','capability_ref','input_bindings_json','parameters_json'] },
      edges: { kind: 'select-in', tableId: 'fx_plan_edges', keyColumn: 'plan_id', maxItems: 500,
        columns: ['plan_id','from_node_id','to_node_id','dependency_kind'] },
      progress: { kind: 'select-in', tableId: 'fx_event_progress', keyColumn: 'event_id', fixedKeyColumns:['revision'], maxItems: 500,
        columns: ['event_id','revision','mode','current_value','total_value','unit','rate','eta_ms','progress_bucket','sampled_at_ms'], safeIntegers: true },
      results: { kind: 'select-in', tableId: 'fx_event_result_bindings', keyColumn: 'event_id', maxItems: 500,
        columns: ['event_id','outcome_kind','result_schema_ref','result_json','result_digest','committed_at_ms'], safeIntegers: true },
      result_headers: { kind: 'select-in', tableId: 'fx_event_result_bindings', keyColumn: 'event_id', maxItems: 500,
        columns: ['event_id','outcome_kind','result_schema_ref','result_digest','committed_at_ms'], safeIntegers: true },
    },
  });
  return Object.freeze({
    read(processIds, readOptions = {}) {
      const ids = [...new Set(processIds)].filter(Boolean).sort();
      if (!ids.length) return Object.freeze([]);
      const includePlans = readOptions.includePlans === true;
      if (readOptions.resultCapabilityRefs !== undefined && (!Array.isArray(readOptions.resultCapabilityRefs) ||
          readOptions.resultCapabilityRefs.length > 256 || readOptions.resultCapabilityRefs.some(ref=>typeof ref!=='string'||!ref))) {
        throw new TypeError('Result projection capability scope must be a bounded array.');
      }
      const resultRefs = readOptions.resultCapabilityRefs === undefined ? null : new Set(readOptions.resultCapabilityRefs);
      return options.unitOfWork.execute([{ participantId: 'execution_progress_projection', owner: 'execution-foundation', repositories: [repository], execute(context) {
        const r = context.repository(repository.repositoryId), works = [], attempts = [], events = [], eventAttempts = [], plans = [], nodes = [], edges = [], samples = [], results = [], resultHeaders = [];
        const workIds=readOptions.workIds===undefined?null:[...new Set(readOptions.workIds)].filter(Boolean).sort();
        const selectedIds=workIds||ids,statement=workIds?'exact_works':'works';
        for (let offset = 0; offset < selectedIds.length; offset += 500) works.push(...r.invoke(statement,
          { values: selectedIds.slice(offset, offset + 500) }).filter(work=>ids.includes(work.process_id)));
        for (let offset = 0; offset < works.length; offset += 500) {
          const values=works.slice(offset, offset + 500).map((item) => item.work_id);
          if (includePlans) attempts.push(...r.invoke('attempts', { values }));
          events.push(...r.invoke('events', { values }));
        }
        for (let offset = 0; includePlans && offset < attempts.length; offset += 500) plans.push(...r.invoke('plans', {
          values:attempts.slice(offset, offset + 500).map((item)=>item.attempt_id),
        }));
        const planIds = [...new Set((includePlans ? plans : events).map((item) => item.plan_id).filter(Boolean))].sort();
        for (let offset = 0; offset < planIds.length; offset += 500) {
          const values = planIds.slice(offset, offset + 500);
          nodes.push(...r.invoke('nodes', { values }));
          if (includePlans) edges.push(...r.invoke('edges', { values }));
        }
        for (let offset = 0; offset < events.length; offset += 500) {
          const eventIds=events.slice(offset, offset + 500).map((item) => item.event_id);
          if (resultRefs === null) results.push(...r.invoke('results', { values: eventIds }));
          else {
            resultHeaders.push(...r.invoke('result_headers', { values: eventIds }));
            const values=events.slice(offset, offset + 500).filter(event=>resultRefs.has(event.capability_ref)).map(event=>event.event_id);
            if(values.length)results.push(...r.invoke('results', { values }));
          }
          if (includePlans) eventAttempts.push(...r.invoke('event_attempts', { values: eventIds }));
        }
        const progressHeads=new Map();
        for(const event of events){
          const revision=Number(event.current_progress_revision);if(!Number.isSafeInteger(revision)||revision<1)continue;
          if(!progressHeads.has(revision))progressHeads.set(revision,[]);
          progressHeads.get(revision).push(event.event_id);
        }
        for(const [revision,eventIds] of progressHeads)for(let offset=0;offset<eventIds.length;offset+=500)
          samples.push(...r.invoke('progress',{revision,values:eventIds.slice(offset,offset+500)}));
        const latest = new Map();
        for (const sample of samples) if (!latest.has(sample.event_id) || latest.get(sample.event_id).revision < sample.revision) latest.set(sample.event_id, sample);
        const latestAttemptByEvent = new Map();
        for (const attempt of eventAttempts) if (!latestAttemptByEvent.has(attempt.event_id) ||
          Number(latestAttemptByEvent.get(attempt.event_id).ordinal) < Number(attempt.ordinal)) {
          latestAttemptByEvent.set(attempt.event_id, attempt);
        }
        const nodeByKey = new Map(nodes.map((node) => [[node.plan_id,node.node_id].join('\0'), node]));
        const planById = new Map(plans.map((plan) => [plan.plan_id, plan]));
        const attemptById = new Map(attempts.map((attempt)=>[attempt.attempt_id,attempt]));
        const edgesByPlan = new Map(planIds.map((planId) => [planId, Object.freeze(edges.filter((edge) => edge.plan_id === planId)
          .map((edge) => Object.freeze({ fromNodeId:edge.from_node_id, toNodeId:edge.to_node_id,
            dependencyKind:edge.dependency_kind })))]));
        const resultByEvent=new Map(resultHeaders.map(row=>[row.event_id,Object.freeze({outcomeKind:row.outcome_kind,
          resultSchemaRef:row.result_schema_ref,result:null,resultDigest:row.result_digest,committedAtMs:Number(row.committed_at_ms)})]));
        for(const row of results){let value;try{value=JSON.parse(row.result_json);}catch{throw Object.assign(new Error('Durable execution Result is not valid JSON.'),{code:'EXECUTION_PROGRESS_RESULT_INVALID'});}if(canonicalJson(value)!==row.result_json||canonicalDigest(value)!==row.result_digest)throw Object.assign(new Error('Durable execution Result failed its digest fence.'),{code:'EXECUTION_PROGRESS_RESULT_INVALID'});resultByEvent.set(row.event_id,Object.freeze({outcomeKind:row.outcome_kind,resultSchemaRef:row.result_schema_ref,result:value,resultDigest:row.result_digest,committedAtMs:Number(row.committed_at_ms)}));}
        return Object.freeze(works.map((work) => Object.freeze({
          workId: work.work_id, ownerDomain:work.owner_domain, processType:work.process_type,
          processId: work.process_id, workKind: work.work_kind, state: work.state,
          createdAtMs: Number(work.created_at_ms), terminalAtMs: ['succeeded','failed','cancelled'].includes(work.state)?Number(work.updated_at_ms):null,
          ...(includePlans ? { plans:Object.freeze(plans.filter((plan)=>attemptById.get(plan.attempt_id)?.work_id===work.work_id)
            .sort((left,right)=>Number(left.created_at_ms)-Number(right.created_at_ms)||left.plan_id.localeCompare(right.plan_id))
            .map((plan)=>Object.freeze({ planId:plan.plan_id, plannerRef:plan.planner_ref,
              plannerVersion:Number(plan.planner_version), state:plan.state, createdAtMs:Number(plan.created_at_ms),
              edges:edgesByPlan.get(plan.plan_id)||Object.freeze([]) }))) } : {}),
          events: Object.freeze(events.filter((event) => event.work_id === work.work_id).map((event) => {
            const node = nodeByKey.get([event.plan_id,event.node_id].join('\0')), plan = planById.get(event.plan_id);
            if (!node || (includePlans && !plan)) throw Object.assign(new Error('Durable execution Plan envelope is incomplete.'),
              { code:'EXECUTION_PROGRESS_PLAN_INVALID' });
            const detail=includePlans ? {
              planId:event.plan_id, nodeId:event.node_id,
              plan:Object.freeze({ planId:plan.plan_id, plannerRef:plan.planner_ref,
              plannerVersion:Number(plan.planner_version), state:plan.state,
              createdAtMs:Number(plan.created_at_ms), edges:edgesByPlan.get(plan.plan_id) || Object.freeze([]) }),
              inputBindings:Object.freeze(parseDurableJson(node.input_bindings_json,
                'EXECUTION_PROGRESS_INPUT_INVALID', 'execution input bindings')),
              parameters:Object.freeze(parseDurableJson(node.parameters_json,
                'EXECUTION_PROGRESS_PARAMETERS_INVALID', 'execution parameters')),
            } : {};
            const latestAttempt=latestAttemptByEvent.get(event.event_id), failure=latestAttempt?.failure_code
              ? Object.freeze({ outcomeKind:latestAttempt.outcome_kind, failureClass:latestAttempt.failure_class,
                failureCode:latestAttempt.failure_code, attemptOrdinal:Number(latestAttempt.ordinal) }) : null;
            return Object.freeze({
            eventId: event.event_id, capabilityRef: event.capability_ref, state: event.state, ...detail,
            executionDeviceClass: plannedExecutionDeviceClass(node),
            progress: projectedProgress(latest.get(event.event_id)), result: resultByEvent.get(event.event_id)||null,
            ...(includePlans ? { failure } : {}),
          });})),
        })));
      } }]).execution_progress_projection;
    },
  });
}

module.exports = Object.freeze({ createExecutionProgressProjectionReader, plannedExecutionDeviceClass, projectedProgress });
