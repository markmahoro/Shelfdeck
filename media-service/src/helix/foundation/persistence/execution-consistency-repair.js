'use strict';

const { digest } = require('./ddl-compiler');

const TERMINAL_EVENT_STATES = Object.freeze(['succeeded', 'skipped', 'failed', 'cancelled']);

class ExecutionConsistencyRepairError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExecutionConsistencyRepairError';
    this.code = code;
    this.details = details;
  }
}

function repairTerminalResourceDefers(options) {
  if (!options || typeof options.Database !== 'function' || typeof options.databasePath !== 'string') {
    throw new TypeError('Execution consistency repair requires a database driver and path.');
  }
  const now = options.now || Date.now;
  const appliedAtMs = now();
  if (!Number.isSafeInteger(appliedAtMs) || appliedAtMs < 0) {
    throw new ExecutionConsistencyRepairError('EXECUTION_CONSISTENCY_REPAIR_TIME_INVALID',
      'Execution consistency repair time must be a non-negative safe integer.');
  }
  const database = new options.Database(options.databasePath);
  try {
    const rows = database.prepare(`
      SELECT d.event_id,d.resource_key,e.work_id,e.owner_domain,e.state AS event_state,e.retry_at_ms
        FROM fx_resource_defer d
        JOIN fx_workflow_events e ON e.event_id=d.event_id
       WHERE d.state='waiting' AND e.state IN ('succeeded','skipped','failed','cancelled')
       ORDER BY d.event_id,d.resource_key
    `).all();
    if (rows.length === 0) return Object.freeze({ repairedEvents:0, repairedDefers:0 });
    const byEvent = new Map();
    for (const row of rows) {
      if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
      byEvent.get(row.event_id).push(row);
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      let repairedDefers = 0;
      for (const [eventId, eventRows] of byEvent) {
        const event = eventRows[0];
        if (!TERMINAL_EVENT_STATES.includes(event.event_state) ||
            eventRows.some((row) => row.work_id !== event.work_id || row.owner_domain !== event.owner_domain ||
              row.event_state !== event.event_state)) {
          throw new ExecutionConsistencyRepairError('EXECUTION_CONSISTENCY_REPAIR_SCOPE_DRIFT',
            'Terminal Resource Defer repair scope changed before mutation.', { eventId });
        }
        for (const row of eventRows) {
          const update = database.prepare(`UPDATE fx_resource_defer SET state='cancelled'
            WHERE event_id=? AND resource_key=? AND state='waiting'`).run(eventId, row.resource_key);
          if (update.changes !== 1) throw new ExecutionConsistencyRepairError(
            'EXECUTION_CONSISTENCY_REPAIR_DEFER_CAS_FAILED',
            'Terminal Resource Defer changed during repair.', { eventId, resourceKey:row.resource_key });
          repairedDefers += 1;
        }
        const eventUpdate = database.prepare(`UPDATE fx_workflow_events SET retry_at_ms=NULL
          WHERE event_id=? AND state=?`).run(eventId, event.event_state);
        if (eventUpdate.changes !== 1) throw new ExecutionConsistencyRepairError(
          'EXECUTION_CONSISTENCY_REPAIR_EVENT_CAS_FAILED',
          'Terminal Event changed during Resource Defer repair.', { eventId });
        const evidenceDigest = digest({
          schema:'helix.execution-terminal-resource-defer-repair-evidence@1',
          eventId,
          eventState:event.event_state,
          resourceKeys:eventRows.map((row) => row.resource_key),
        });
        database.prepare(`INSERT INTO fx_audit_records
          (audit_id,owner_domain,actor_type,actor_id,action,scope_type,scope_id,work_id,event_id,evidence_digest,occurred_at_ms)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
          `execution-terminal-defer-repair:${evidenceDigest}`,
          event.owner_domain,
          'system',
          'execution-consistency-repair@1',
          'terminal_resource_defers_cancelled',
          'workflow_event',
          eventId,
          event.work_id,
          eventId,
          evidenceDigest,
          appliedAtMs,
        );
      }
      database.exec('COMMIT');
      return Object.freeze({ repairedEvents:byEvent.size, repairedDefers });
    } catch (error) {
      if (database.inTransaction) database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

module.exports = Object.freeze({ ExecutionConsistencyRepairError, repairTerminalResourceDefers });
