'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

const OPEN_THRESHOLD = 3;

function definition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'executor_incidents',
    owner: 'execution-foundation',
    schemaManifest,
    statements: {
      find: { kind:'select-one', tableId:'fx_executor_incidents', columns:[
        'incident_key','owner_domain','process_type','work_kind','error_code','occurrence_count',
        'circuit_key','incident_state','evidence_digest','first_seen_at_ms','last_seen_at_ms','resolved_at_ms',
      ], keyColumns:['incident_key'], safeIntegers:true },
      list: { kind:'select-all', tableId:'fx_executor_incidents', columns:[
        'incident_key','owner_domain','process_type','work_kind','error_code','occurrence_count',
        'circuit_key','incident_state','evidence_digest','first_seen_at_ms','last_seen_at_ms','resolved_at_ms',
      ], keyColumns:[], safeIntegers:true },
      insert: { kind:'insert', tableId:'fx_executor_incidents', columns:[
        'incident_key','owner_domain','process_type','work_kind','error_code','occurrence_count',
        'circuit_key','incident_state','evidence_digest','first_seen_at_ms','last_seen_at_ms','resolved_at_ms',
      ] },
      advance: { kind:'update', tableId:'fx_executor_incidents', setColumns:[
        'occurrence_count','incident_state','evidence_digest','last_seen_at_ms','resolved_at_ms',
      ], keyColumns:['incident_key'], compareColumns:[
        { column:'occurrence_count', parameter:'expected_occurrence_count' },
        { column:'incident_state', parameter:'expected_incident_state' },
      ] },
    },
  });
}

function identityOf(request) {
  const value = {
    ownerDomain: request.ownerDomain,
    processType: request.processType,
    workKind: request.workKind,
    errorCode: request.errorCode,
  };
  if (Object.values(value).some((item) => typeof item !== 'string' || !item)) {
    throw new TypeError('Executor Incident identity is incomplete.');
  }
  const incidentKey = canonicalDigest({ schema:'foundation.executor-incident@1', ...value });
  const circuitKey = 'owner/' + value.ownerDomain + '/' + value.processType + '/' + value.workKind;
  return Object.freeze({ ...value, incidentKey, circuitKey,
    evidenceDigest:canonicalDigest({ schema:'foundation.executor-incident-evidence@1', incidentKey }) });
}

function createExecutorIncidentRegistry(options) {
  const repository = definition(options.schemaManifest), now = options.now || Date.now;
  function read(incidentKey) {
    return options.unitOfWork.execute([{ participantId:'executor_incident_read', owner:'execution-foundation',
      repositories:[repository], execute:(context)=>context.repository(repository.repositoryId).invoke('find', { incident_key:incidentKey })
    }]).executor_incident_read;
  }
  function update(row, next) {
    const result = options.unitOfWork.execute([{ participantId:'executor_incident_advance', owner:'execution-foundation',
      repositories:[repository], execute(context) { return context.repository(repository.repositoryId).invoke('advance', {
        incident_key:row.incident_key, expected_occurrence_count:Number(row.occurrence_count),
        expected_incident_state:row.incident_state, occurrence_count:next.occurrenceCount,
        incident_state:next.incidentState, evidence_digest:next.evidenceDigest,
        last_seen_at_ms:next.lastSeenAtMs, resolved_at_ms:next.resolvedAtMs,
      }); }
    }]).executor_incident_advance;
    if (result.changes !== 1) throw Object.assign(new Error('Executor Incident changed concurrently.'), { code:'EXECUTOR_INCIDENT_CAS_CONFLICT' });
    return read(row.incident_key);
  }
  return Object.freeze({
    read,
    scopeStatus(request) {
      const values = [request?.ownerDomain, request?.processType, request?.workKind];
      if (values.some((item)=>typeof item !== 'string' || !item)) throw new TypeError('Executor Incident scope is incomplete.');
      const rows = options.unitOfWork.execute([{ participantId:'executor_incident_scope', owner:'execution-foundation',
        repositories:[repository], execute:(context)=>context.repository(repository.repositoryId).invoke('list', {})
      }]).executor_incident_scope.filter((row)=>row.owner_domain === values[0] && row.process_type === values[1] &&
        row.work_kind === values[2] && Number(row.occurrence_count) >= OPEN_THRESHOLD &&
        row.incident_state !== 'resolved').sort((a,b)=>a.incident_key.localeCompare(b.incident_key));
      if (rows.length === 0) return Object.freeze({ blocked:false, incident:null });
      return Object.freeze({ blocked:true, incident:Object.freeze(rows[0]) });
    },
    recordFailure(request) {
      const identity = identityOf(request), current = read(identity.incidentKey), at = now();
      let row;
      if (!current) {
        row = options.unitOfWork.execute([{ participantId:'executor_incident_create', owner:'execution-foundation',
          repositories:[repository], execute(context) {
            context.repository(repository.repositoryId).invoke('insert', {
              incident_key:identity.incidentKey, owner_domain:identity.ownerDomain, process_type:identity.processType,
              work_kind:identity.workKind, error_code:identity.errorCode, occurrence_count:1,
              circuit_key:identity.circuitKey, incident_state:'open', evidence_digest:identity.evidenceDigest,
              first_seen_at_ms:at, last_seen_at_ms:at, resolved_at_ms:null,
            });
            return context.repository(repository.repositoryId).invoke('find', { incident_key:identity.incidentKey });
          }
        }]).executor_incident_create;
      } else {
        row = update(current, { occurrenceCount:Number(current.occurrence_count) + 1, incidentState:'open',
          evidenceDigest:identity.evidenceDigest, lastSeenAtMs:at, resolvedAtMs:null });
      }
      if (Number(row.occurrence_count) >= OPEN_THRESHOLD) options.circuitBreaker.open({
        circuitKey:identity.circuitKey, reasonCode:identity.errorCode, evidenceDigest:identity.evidenceDigest,
      });
      return Object.freeze({ incidentKey:identity.incidentKey, circuitKey:identity.circuitKey,
        occurrenceCount:Number(row.occurrence_count), circuitOpen:Number(row.occurrence_count) >= OPEN_THRESHOLD });
    },
    beginRecovery(incidentKey) {
      if (!incidentKey) return null;
      const current = read(incidentKey);
      if (!current || current.incident_state === 'resolved') return current;
      const circuit = options.circuitBreaker.read(current.circuit_key);
      if (circuit?.state === 'open') options.circuitBreaker.beginRecovery({
        circuitKey:current.circuit_key, evidenceDigest:current.evidence_digest,
      });
      if (current.incident_state === 'recovering') return current;
      return update(current, { occurrenceCount:Number(current.occurrence_count), incidentState:'recovering',
        evidenceDigest:current.evidence_digest, lastSeenAtMs:now(), resolvedAtMs:null });
    },
    resolve(incidentKey, invariantEvidenceDigest) {
      if (!incidentKey) return null;
      const current = read(incidentKey);
      if (!current || current.incident_state === 'resolved') return current;
      const circuit = options.circuitBreaker.read(current.circuit_key);
      if (circuit?.state === 'open') options.circuitBreaker.beginRecovery({
        circuitKey:current.circuit_key, evidenceDigest:current.evidence_digest,
      });
      if (options.circuitBreaker.read(current.circuit_key)?.state === 'recovering') {
        options.circuitBreaker.close({ circuitKey:current.circuit_key, invariantRestored:true,
          reconcileEvidenceDigest:invariantEvidenceDigest });
      }
      return update(current, { occurrenceCount:Number(current.occurrence_count), incidentState:'resolved',
        evidenceDigest:invariantEvidenceDigest, lastSeenAtMs:now(), resolvedAtMs:now() });
    },
    allows(request) {
      const identity = identityOf(request);
      return options.circuitBreaker.allows({ circuitKey:identity.circuitKey, mode:'normal', started:false,
        effectClass:'domain_fact_commit', priorityClass:'handoff_acceptance' });
    },
  });
}

module.exports = Object.freeze({ OPEN_THRESHOLD, createExecutorIncidentRegistry });
