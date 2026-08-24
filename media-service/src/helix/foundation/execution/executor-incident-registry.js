'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

const OPEN_THRESHOLD = 3;
const circuitEvidence=(incidentKey)=>canonicalDigest({schema:'foundation.executor-incident-circuit@1',incidentKey});

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
  const resourceKey = request.resourceKey === undefined ? null : request.resourceKey;
  if (resourceKey !== null && (typeof resourceKey !== 'string' || !resourceKey)) {
    throw new TypeError('Executor Incident resource identity is invalid.');
  }
  const value = {
    ownerDomain: request.ownerDomain,
    processType: request.processType,
    workKind: request.workKind,
    errorCode: request.errorCode,
  };
  if (Object.values(value).some((item) => typeof item !== 'string' || !item)) {
    throw new TypeError('Executor Incident identity is incomplete.');
  }
  const incidentKey = canonicalDigest({ schema:'foundation.executor-incident@1', ...value,
    ...(resourceKey === null ? {} : { resourceKey }) });
  const circuitKey = 'owner/' + value.ownerDomain + '/' + value.processType + '/' + value.workKind +
    (resourceKey === null ? '' : '/resource/' + canonicalDigest({ resourceKey }));
  const occurrenceId = request.occurrenceId === undefined ? null : request.occurrenceId;
  if (occurrenceId !== null && (typeof occurrenceId !== 'string' || !occurrenceId)) {
    throw new TypeError('Executor Incident occurrence identity is invalid.');
  }
  return Object.freeze({ ...value, resourceKey, incidentKey, circuitKey,
    occurrenceId,
    evidenceDigest:canonicalDigest({ schema:'foundation.executor-incident-evidence@1', incidentKey,
      ...(occurrenceId === null ? {} : { occurrenceId }) }) });
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
  function scopeIdentity(request) {
    const values = [request?.ownerDomain, request?.processType, request?.workKind];
    if (values.some((item)=>typeof item !== 'string' || !item)) throw new TypeError('Executor Incident scope is incomplete.');
    const resourceKey=request.resourceKey===undefined?null:request.resourceKey;
    if(resourceKey!==null&&(typeof resourceKey!=='string'||!resourceKey))throw new TypeError('Executor Incident resource scope is invalid.');
    return Object.freeze({ownerDomain:values[0],processType:values[1],workKind:values[2],resourceKey,
      circuitKey:'owner/'+values[0]+'/'+values[1]+'/'+values[2]+(resourceKey===null?'':'/resource/'+canonicalDigest({resourceKey}))});
  }
  function scopeStatuses(requests) {
    if(!Array.isArray(requests))throw new TypeError('Executor Incident scopes must be an Array.');
    const scopes=requests.map(scopeIdentity),rows=options.unitOfWork.execute([{ participantId:'executor_incident_scope', owner:'execution-foundation',
      repositories:[repository], execute:(context)=>context.repository(repository.repositoryId).invoke('list', {})
    }]).executor_incident_scope.filter((row)=>Number(row.occurrence_count)>=OPEN_THRESHOLD&&row.incident_state!=='resolved'),byCircuit=new Map();
    for(const row of rows.sort((a,b)=>a.incident_key.localeCompare(b.incident_key)))if(!byCircuit.has(row.circuit_key))byCircuit.set(row.circuit_key,Object.freeze(row));
    return new Map(scopes.map((scope)=>[scope.circuitKey,Object.freeze({blocked:byCircuit.has(scope.circuitKey),incident:byCircuit.get(scope.circuitKey)||null})]));
  }
  return Object.freeze({
    read,
    incidentKey:(request)=>identityOf(request).incidentKey,
    scopeKey:(request)=>scopeIdentity(request).circuitKey,
    scopeStatus(request) {
      const scope=scopeIdentity(request);return scopeStatuses([request]).get(scope.circuitKey);
    },
    scopeStatuses,
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
      } else if (identity.occurrenceId !== null && current.evidence_digest === identity.evidenceDigest) {
        row = current.incident_state === 'recovering' ? update(current, { occurrenceCount:Number(current.occurrence_count),
          incidentState:'open', evidenceDigest:current.evidence_digest, lastSeenAtMs:at, resolvedAtMs:null }) : current;
      } else {
        row = update(current, { occurrenceCount:Number(current.occurrence_count) + 1, incidentState:'open',
          evidenceDigest:identity.evidenceDigest, lastSeenAtMs:at, resolvedAtMs:null });
      }
      const circuitOpen=row.incident_state!=='resolved'&&Number(row.occurrence_count)>=OPEN_THRESHOLD;
      if (circuitOpen) options.circuitBreaker.open({
        circuitKey:identity.circuitKey, reasonCode:identity.errorCode, evidenceDigest:circuitEvidence(identity.incidentKey),
      });
      return Object.freeze({ incidentKey:identity.incidentKey, circuitKey:identity.circuitKey,
        occurrenceCount:Number(row.occurrence_count), circuitOpen });
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
        evidenceDigest:current.evidence_digest, lastSeenAtMs:now(), resolvedAtMs:now() });
    },
    resolveScope(request, invariantEvidenceDigest) {
      const circuitKey=scopeIdentity(request).circuitKey,rows=options.unitOfWork.execute([{participantId:'executor_incident_resolve_scope',owner:'execution-foundation',
        repositories:[repository],execute:(context)=>context.repository(repository.repositoryId).invoke('list',{})}]).executor_incident_resolve_scope
        .filter((row)=>row.circuit_key===circuitKey&&row.incident_state!=='resolved');
      return Object.freeze(rows.map((row)=>this.resolve(row.incident_key,invariantEvidenceDigest)).filter(Boolean));
    },
    prepareExecution(requests, workId) {
      if(!Array.isArray(requests)||typeof workId!=='string'||!workId)throw new TypeError('Executor Incident execution preparation is invalid.');
      const statuses=scopeStatuses(requests),blocked=[...statuses.values()].filter((status)=>status.blocked&&status.incident),checks=[];
      for(const status of blocked){const incident=status.incident,circuit=options.circuitBreaker.read(incident.circuit_key),evidenceDigest=canonicalDigest({schema:'foundation.executor-incident-recovery-work@1',circuitKey:incident.circuit_key,workId});
        if(circuit?.state==='recovering'&&circuit.evidence_digest!==evidenceDigest)return Object.freeze({allowed:false,circuitKey:incident.circuit_key,reason:'resource_recovery_in_progress'});
        checks.push(Object.freeze({incident,circuit,evidenceDigest}));}
      for(const check of checks)if(check.circuit?.state==='open'){
        options.circuitBreaker.beginRecovery({circuitKey:check.incident.circuit_key,evidenceDigest:check.evidenceDigest});
        const current=read(check.incident.incident_key);if(current&&current.incident_state==='open')update(current,{occurrenceCount:Number(current.occurrence_count),incidentState:'recovering',evidenceDigest:current.evidence_digest,lastSeenAtMs:now(),resolvedAtMs:null});
      }
      return Object.freeze({allowed:true,recoveryCircuits:Object.freeze(checks.map((item)=>item.incident.circuit_key).sort())});
    },
    abandonExecution(workId) {
      if(typeof workId!=='string'||!workId)throw new TypeError('Executor Incident recovery Work identity is invalid.');
      const rows=options.unitOfWork.execute([{participantId:'executor_incident_abandon_execution',owner:'execution-foundation',
        repositories:[repository],execute:(context)=>context.repository(repository.repositoryId).invoke('list',{})}]).executor_incident_abandon_execution;
      let reopened=0;
      for(const row of rows.filter((item)=>item.incident_state==='recovering')){
        const circuit=options.circuitBreaker.read(row.circuit_key),reservation=canonicalDigest({
          schema:'foundation.executor-incident-recovery-work@1',circuitKey:row.circuit_key,workId});
        if(circuit?.state!=='recovering'||circuit.evidence_digest!==reservation)continue;
        options.circuitBreaker.open({circuitKey:row.circuit_key,reasonCode:row.error_code,evidenceDigest:circuitEvidence(row.incident_key)});
        update(row,{occurrenceCount:Number(row.occurrence_count),incidentState:'open',evidenceDigest:row.evidence_digest,
          lastSeenAtMs:now(),resolvedAtMs:null});
        reopened+=1;
      }
      return reopened;
    },
    allows(request) {
      const identity = identityOf(request);
      return options.circuitBreaker.allows({ circuitKey:identity.circuitKey, mode:'normal', started:false,
        effectClass:'domain_fact_commit', priorityClass:'handoff_acceptance' });
    },
  });
}

module.exports = Object.freeze({ OPEN_THRESHOLD, createExecutorIncidentRegistry });
