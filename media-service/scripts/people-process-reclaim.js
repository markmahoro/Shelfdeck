'use strict';

const { STARTUP_ROOT_STATES } = require('../src/helix/foundation/execution/startup-responsibility-snapshot');

const REFERENCE_COMMIT_CAPABILITY = 'people.reference_fact.commit@1';
const IDENTIFIER = /^[a-z_]+$/;
const REGISTRATION_KINDS = new Set(['registration', 'catalogue_registration']);
const CHUNK = 400;

const PEOPLE_RECLAIMABLE_PROCESSES = Object.freeze([
  Object.freeze({
    ownerDomain: 'people',
    processType: 'people_image_preparation',
    operation: Object.freeze({
      table: 'people_image_operations',
      idColumn: 'operation_id',
      openState: 'preparing',
      retainedStates: Object.freeze(['completed', 'failed']),
    }),
    restrictors: Object.freeze([
      Object.freeze({
        table: 'people_us_adult_catalogue_registration_origins',
        column: 'operation_id',
      }),
    ]),
    retention: Object.freeze({
      parent: 'people_persons',
      pairs: Object.freeze([Object.freeze(['person_id', 'person_id'])]),
    }),
  }),
]);

for (const kind of PEOPLE_RECLAIMABLE_PROCESSES) {
  if (kind.operation.retainedStates.includes(kind.operation.openState)) throw new Error('PEOPLE_RECLAIM_STATE_OVERLAP');
  const names = [kind.operation.table, kind.operation.idColumn, kind.retention.parent,
    ...kind.restrictors.flatMap((restrictor) => [restrictor.table, restrictor.column]),
    ...kind.retention.pairs.flatMap((pair) => pair)];
  if (names.some((name) => !IDENTIFIER.test(name))) throw new Error('PEOPLE_RECLAIM_IDENTIFIER_INVALID');
}

function quote(name) {
  if (!IDENTIFIER.test(name)) throw new Error('PEOPLE_RECLAIM_IDENTIFIER_INVALID');
  return `"${name}"`;
}

function chunks(values) {
  const result = [];
  for (let index = 0; index < values.length; index += CHUNK) result.push(values.slice(index, index + CHUNK));
  return result;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function tableExists(database, tableName) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function emptyPlan() {
  return Object.freeze({
    processScopes: Object.freeze([]),
    openOperations: Object.freeze([]),
    blockers: Object.freeze([]),
  });
}

function operationKind(payloadJson) {
  try {
    const payload = JSON.parse(payloadJson);
    return payload && typeof payload.operationKind === 'string' ? payload.operationKind : null;
  } catch {
    return null;
  }
}

function publishedOperationIds(database, kind, openRows) {
  const published = new Set();
  const ids = openRows.map((row) => row.operation_id);
  if (!ids.length) return published;
  if (tableExists(database, 'fx_effect_journal') && tableExists(database, 'fx_workflow_events') && tableExists(database, 'fx_event_attempts')) {
    for (const part of chunks(ids)) {
      for (const row of database.prepare(`
        SELECT DISTINCT work.process_id AS operation_id
          FROM fx_supporting_works work
          JOIN fx_workflow_events event ON event.work_id=work.work_id
          JOIN fx_event_attempts event_attempt ON event_attempt.event_id=event.event_id
          JOIN fx_effect_journal journal ON journal.event_attempt_id=event_attempt.event_attempt_id
         WHERE work.owner_domain=? AND work.process_type=?
           AND event.capability_ref=? AND journal.state='committed'
           AND work.process_id IN (${placeholders(part)})
      `).all(kind.ownerDomain, kind.processType, REFERENCE_COMMIT_CAPABILITY, ...part)) {
        published.add(row.operation_id);
      }
    }
  }
  const origin = kind.restrictors.find((restrictor) => restrictor.table === 'people_us_adult_catalogue_registration_origins');
  if (origin && tableExists(database, origin.table)) {
    for (const part of chunks(ids)) {
      for (const row of database.prepare(`
        SELECT ${quote(origin.column)} AS operation_id FROM ${quote(origin.table)}
         WHERE ${quote(origin.column)} IN (${placeholders(part)})
      `).all(...part)) published.add(row.operation_id);
    }
  }
  const registrationPersonIds = [...new Set(openRows
    .filter((row) => REGISTRATION_KINDS.has(operationKind(row.payload_json)) && row.person_id)
    .map((row) => row.person_id))];
  if (registrationPersonIds.length && tableExists(database, 'people_persons')) {
    const present = new Set();
    for (const part of chunks(registrationPersonIds)) {
      for (const row of database.prepare(`SELECT person_id FROM people_persons WHERE person_id IN (${placeholders(part)})`).all(...part)) {
        present.add(row.person_id);
      }
    }
    for (const row of openRows) {
      if (REGISTRATION_KINDS.has(operationKind(row.payload_json)) && present.has(row.person_id)) published.add(row.operation_id);
    }
  }
  return published;
}

function rootedProcessIds(database, kind) {
  const works = STARTUP_ROOT_STATES.works;
  const attempts = STARTUP_ROOT_STATES.workAttempts;
  const events = STARTUP_ROOT_STATES.events;
  const eventAttempts = STARTUP_ROOT_STATES.attempts;
  const effects = STARTUP_ROOT_STATES.effects;
  const defers = STARTUP_ROOT_STATES.defers;
  return database.prepare(`
    SELECT DISTINCT work.process_id AS process_id
      FROM fx_supporting_works work
     WHERE work.owner_domain=? AND work.process_type=?
       AND (
         work.state IN (${placeholders(works)})
         OR EXISTS (
           SELECT 1 FROM fx_work_attempts attempt
            WHERE attempt.work_id=work.work_id AND attempt.state IN (${placeholders(attempts)}))
         OR EXISTS (
           SELECT 1 FROM fx_workflow_events event
            WHERE event.work_id=work.work_id AND event.state IN (${placeholders(events)}))
         OR EXISTS (
           SELECT 1 FROM fx_event_attempts event_attempt
             JOIN fx_workflow_events event ON event.event_id=event_attempt.event_id
            WHERE event.work_id=work.work_id AND event_attempt.state IN (${placeholders(eventAttempts)}))
         OR EXISTS (
           SELECT 1 FROM fx_effect_journal journal
             JOIN fx_event_attempts event_attempt ON event_attempt.event_attempt_id=journal.event_attempt_id
             JOIN fx_workflow_events event ON event.event_id=event_attempt.event_id
            WHERE event.work_id=work.work_id AND journal.state IN (${placeholders(effects)}))
         OR EXISTS (
           SELECT 1 FROM fx_resource_defer deferral
             JOIN fx_workflow_events event ON event.event_id=deferral.event_id
            WHERE event.work_id=work.work_id AND deferral.state IN (${placeholders(defers)}))
       )
  `).all(kind.ownerDomain, kind.processType, ...works, ...attempts, ...events, ...eventAttempts, ...effects, ...defers)
    .map((row) => row.process_id);
}

function addScope(scopes, seen, kind, processId) {
  if (processId === null || processId === undefined) return;
  const key = `${kind.ownerDomain}\u0000${kind.processType}\u0000${processId}`;
  if (seen.has(key)) return;
  seen.add(key);
  scopes.push(Object.freeze({ ownerDomain: kind.ownerDomain, processType: kind.processType, processId: String(processId) }));
}

function planPeopleReclaim(database, options = {}) {
  if (options.enabled === false) return emptyPlan();
  const processScopes = [];
  const openOperations = [];
  const publishedRows = [];
  const seen = new Set();
  for (const kind of PEOPLE_RECLAIMABLE_PROCESSES) {
    if (!tableExists(database, kind.operation.table) || !tableExists(database, 'fx_supporting_works')) continue;
    const table = quote(kind.operation.table);
    const idColumn = quote(kind.operation.idColumn);
    const openRows = database.prepare(`
      SELECT ${idColumn} AS operation_id, person_id, payload_json
        FROM ${table} WHERE state=? ORDER BY ${idColumn}
    `).all(kind.operation.openState);
    const published = publishedOperationIds(database, kind, openRows);
    for (const row of openRows) {
      if (published.has(row.operation_id)) publishedRows.push(Object.freeze({ operation_id: row.operation_id }));
      else {
        openOperations.push(Object.freeze({
          table: kind.operation.table, idColumn: kind.operation.idColumn, operationId: row.operation_id,
        }));
        addScope(processScopes, seen, kind, row.operation_id);
      }
    }
    const orphanIds = database.prepare(`
      SELECT DISTINCT work.process_id AS process_id
        FROM fx_supporting_works work
        LEFT JOIN ${table} operation ON operation.${idColumn}=work.process_id
       WHERE work.owner_domain=? AND work.process_type=? AND operation.${idColumn} IS NULL
    `).all(kind.ownerDomain, kind.processType).map((row) => row.process_id);
    for (const processId of orphanIds) addScope(processScopes, seen, kind, processId);
    for (const processId of rootedProcessIds(database, kind)) addScope(processScopes, seen, kind, processId);
  }
  if (publishedRows.length) {
    return Object.freeze({
      processScopes: Object.freeze([]),
      openOperations: Object.freeze([]),
      blockers: Object.freeze([Object.freeze({
        code: 'RESET_PEOPLE_IMAGE_RESULT_ALREADY_PUBLISHED',
        rows: Object.freeze(publishedRows),
      })]),
    });
  }
  return Object.freeze({
    processScopes: Object.freeze(processScopes),
    openOperations: Object.freeze(openOperations),
    blockers: Object.freeze([]),
  });
}

function deleteByIds(database, sqlPrefix, ids, sqlSuffix = '', extra = []) {
  let changes = 0;
  for (const part of chunks(ids)) {
    changes += database.prepare(`${sqlPrefix} (${placeholders(part)}) ${sqlSuffix}`).run(...part, ...extra).changes;
  }
  return changes;
}

function deletePeopleReclaimRows(database, plan) {
  if (!plan || plan.blockers.length) {
    throw Object.assign(new Error('FORMATION_RESET_BLOCKED'), { details: plan ? plan.blockers : null });
  }
  const idsByKind = new Map();
  for (const operation of plan.openOperations) {
    const kind = PEOPLE_RECLAIMABLE_PROCESSES.find((item) => item.operation.table === operation.table
      && item.operation.idColumn === operation.idColumn);
    if (!kind || !tableExists(database, kind.operation.table)) continue;
    const row = database.prepare(`
      SELECT ${quote(kind.operation.idColumn)} AS operation_id FROM ${quote(kind.operation.table)}
       WHERE ${quote(kind.operation.idColumn)}=? AND state=?
    `).get(operation.operationId, kind.operation.openState);
    if (!row) continue;
    if (!idsByKind.has(kind)) idsByKind.set(kind, []);
    idsByKind.get(kind).push(operation.operationId);
  }
  let deletedRestrictors = 0;
  let deletedOperations = 0;
  for (const [kind, ids] of idsByKind) {
    for (const restrictor of kind.restrictors) {
      if (!tableExists(database, restrictor.table)) continue;
      deletedRestrictors += deleteByIds(database, `DELETE FROM ${quote(restrictor.table)} WHERE ${quote(restrictor.column)} IN`, ids);
    }
    deletedOperations += deleteByIds(database,
      `DELETE FROM ${quote(kind.operation.table)} WHERE ${quote(kind.operation.idColumn)} IN`, ids,
      'AND state=?', [kind.operation.openState]);
  }
  return { deletedRestrictors, deletedOperations };
}

function peopleOperationRetentionEdges() {
  const edges = [];
  for (const kind of PEOPLE_RECLAIMABLE_PROCESSES) {
    for (const state of kind.operation.retainedStates) {
      edges.push(Object.freeze({
        parent: kind.retention.parent,
        child: kind.operation.table,
        pairs: kind.retention.pairs,
        where: Object.freeze({ state }),
      }));
    }
  }
  return Object.freeze(edges);
}

function assertPeopleImageReclaimAllowed(database) {
  const plan = planPeopleReclaim(database, { enabled: true });
  if (plan.blockers.length) {
    const blocker = plan.blockers[0];
    throw Object.assign(new Error(blocker.code), { code: blocker.code, details: plan.blockers });
  }
}

module.exports = Object.freeze({
  PEOPLE_RECLAIMABLE_PROCESSES,
  planPeopleReclaim,
  deletePeopleReclaimRows,
  peopleOperationRetentionEdges,
  assertPeopleImageReclaimAllowed,
});
