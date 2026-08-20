'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');

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
        columns: ['event_id','work_id','capability_ref','state','current_progress_revision'], safeIntegers: true },
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
        const r = context.repository(repository.repositoryId), works = [], events = [], samples = [], results = [];
        for (let offset = 0; offset < ids.length; offset += 500) works.push(...r.invoke('works', { values: ids.slice(offset, offset + 500) }));
        for (let offset = 0; offset < works.length; offset += 500) events.push(...r.invoke('events', { values: works.slice(offset, offset + 500).map((item) => item.work_id) }));
        for (let offset = 0; offset < events.length; offset += 500) { const eventIds=events.slice(offset, offset + 500).map((item) => item.event_id); samples.push(...r.invoke('progress', { values: eventIds })); results.push(...r.invoke('results', { values: eventIds })); }
        const latest = new Map();
        for (const sample of samples) if (!latest.has(sample.event_id) || latest.get(sample.event_id).revision < sample.revision) latest.set(sample.event_id, sample);
        const resultByEvent=new Map(results.map((row)=>{let value;try{value=JSON.parse(row.result_json);}catch{throw Object.assign(new Error('Durable execution Result is not valid JSON.'),{code:'EXECUTION_PROGRESS_RESULT_INVALID'});}if(canonicalJson(value)!==row.result_json||canonicalDigest(value)!==row.result_digest)throw Object.assign(new Error('Durable execution Result failed its digest fence.'),{code:'EXECUTION_PROGRESS_RESULT_INVALID'});return [row.event_id,Object.freeze({outcomeKind:row.outcome_kind,resultSchemaRef:row.result_schema_ref,result:value,resultDigest:row.result_digest,committedAtMs:Number(row.committed_at_ms)})];}));
        return Object.freeze(works.map((work) => Object.freeze({
          workId: work.work_id, processId: work.process_id, workKind: work.work_kind, state: work.state,
          createdAtMs: Number(work.created_at_ms), terminalAtMs: ['succeeded','failed','cancelled'].includes(work.state)?Number(work.updated_at_ms):null,
          events: Object.freeze(events.filter((event) => event.work_id === work.work_id).map((event) => Object.freeze({
            eventId: event.event_id, capabilityRef: event.capability_ref, state: event.state,
            progress: latest.has(event.event_id) ? Object.freeze({
              mode: latest.get(event.event_id).mode, currentValue: latest.get(event.event_id).current_value,
              totalValue: latest.get(event.event_id).total_value, unit: latest.get(event.event_id).unit,
              rate: latest.get(event.event_id).rate, etaMs: latest.get(event.event_id).eta_ms,
              bucket: latest.get(event.event_id).progress_bucket,
            }) : null, result: resultByEvent.get(event.event_id)||null,
          }))),
        })));
      } }]).execution_progress_projection;
    },
  });
}

module.exports = Object.freeze({ createExecutionProgressProjectionReader });
