'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');

const SAMPLE_INTERVAL_MS = 5000;
const MAX_SAMPLES_PER_ATTEMPT = 257;

class ProgressReporterError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ProgressReporterError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new ProgressReporterError(code, message, details); }

function exact(sample) {
  const keys = ['mode', 'currentValue', 'totalValue', 'unit', 'rate', 'etaMs', 'sourceSequence', 'progressBucket', 'terminal'];
  if (!sample || typeof sample !== 'object' || Array.isArray(sample) ||
      JSON.stringify(Object.keys(sample).sort()) !== JSON.stringify(keys.sort())) fail(
    'P4_PROGRESS_SAMPLE_SHAPE_MISMATCH', 'Progress sample shape is not exact.'
  );
}

function optionalNumber(value, integer = false) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value)));
}

function validate(sample) {
  exact(sample);
  if (!['determinate', 'indeterminate'].includes(sample.mode) || typeof sample.terminal !== 'boolean' ||
      (sample.sourceSequence !== null && (typeof sample.sourceSequence !== 'string' || !sample.sourceSequence)) ||
      typeof sample.progressBucket !== 'string' || !sample.progressBucket ||
      !optionalNumber(sample.currentValue) || !optionalNumber(sample.totalValue) || !optionalNumber(sample.rate) || !optionalNumber(sample.etaMs, true) ||
      (sample.unit !== null && (typeof sample.unit !== 'string' || !sample.unit))) fail(
    'P4_PROGRESS_SAMPLE_INVALID', 'Progress values must be finite, non-negative, and typed.'
  );
  if (sample.mode === 'determinate' && (sample.currentValue === null || sample.totalValue === null || sample.unit === null || sample.currentValue > sample.totalValue)) {
    fail('P4_PROGRESS_DETERMINATE_INVALID', 'Determinate progress requires current, total, unit, and current <= total.');
  }
  if (sample.mode === 'indeterminate' && (sample.currentValue !== null || sample.totalValue !== null)) fail(
    'P4_PROGRESS_INDETERMINATE_INVALID', 'Indeterminate progress cannot claim current or total.'
  );
  return Object.freeze({ ...sample });
}

function definitions(schemaManifest) {
  return Object.freeze({
    events: createRepositoryDefinition({ repositoryId: 'progress_events', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_workflow_events', columns: ['event_id', 'state', 'current_progress_revision'], keyColumns: ['event_id'] },
      point: { kind: 'update', tableId: 'fx_workflow_events', setColumns: ['current_progress_revision'], keyColumns: ['event_id'] }
    } }),
    attempts: createRepositoryDefinition({ repositoryId: 'progress_attempts', owner: 'execution-foundation', schemaManifest, statements: {
      find: { kind: 'select-one', tableId: 'fx_event_attempts', columns: ['event_attempt_id', 'event_id', 'state'], keyColumns: ['event_attempt_id'] }
    } }),
    samples: createRepositoryDefinition({ repositoryId: 'progress_samples', owner: 'execution-foundation', schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'fx_event_progress', keyColumns: ['event_attempt_id'], columns: [
        'event_id', 'event_attempt_id', 'revision', 'mode', 'current_value', 'total_value', 'unit', 'rate', 'eta_ms',
        'source_sequence', 'progress_bucket', 'sampled_at_ms'
      ] },
      insert: { kind: 'insert', tableId: 'fx_event_progress', columns: [
        'event_id', 'event_attempt_id', 'revision', 'mode', 'current_value', 'total_value', 'unit', 'rate', 'eta_ms',
        'source_sequence', 'progress_bucket', 'sampled_at_ms'
      ] }
    } })
  });
}

function createProgressReporter(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function' ||
      typeof options.now !== 'function' || typeof options.eventId !== 'string' || !options.eventId ||
      typeof options.eventAttemptId !== 'string' || !options.eventAttemptId) fail(
    'P4_PROGRESS_REPORTER_DEPENDENCIES_REQUIRED', 'ProgressReporter requires one exact Event Attempt, persistence, and clock.'
  );
  const repositories = definitions(options.schemaManifest);
  return Object.freeze({
    current() {
      return options.unitOfWork.execute([{
        participantId: 'progress_current_read', owner: 'execution-foundation', repositories: Object.values(repositories),
        execute(context) {
          const attempt = context.repository('progress_attempts').invoke('find', { event_attempt_id: options.eventAttemptId });
          const event = context.repository('progress_events').invoke('find', { event_id: options.eventId });
          if (!attempt || !event || attempt.event_id !== event.event_id) fail(
            'P4_PROGRESS_ATTEMPT_MISSING', 'Current progress requires the exact Event Attempt.'
          );
          const latest = context.repository('progress_samples').invoke('list', { event_attempt_id:options.eventAttemptId })
            .sort((left, right) => left.revision - right.revision).at(-1);
          return latest ? Object.freeze({
            revision:latest.revision, mode:latest.mode, currentValue:latest.current_value,
            totalValue:latest.total_value, unit:latest.unit, rate:latest.rate, etaMs:latest.eta_ms,
            sourceSequence:latest.source_sequence, progressBucket:latest.progress_bucket,
            sampledAtMs:latest.sampled_at_ms,
          }) : null;
        }
      }]).progress_current_read;
    },
    report(rawSample) {
      const sample = validate(rawSample);
      const sampledAtMs = options.now();
      if (!Number.isSafeInteger(sampledAtMs) || sampledAtMs < 0) fail('P4_PROGRESS_CLOCK_INVALID', 'Progress clock must return epoch milliseconds.');
      return options.unitOfWork.execute([{
        participantId: 'progress_report', owner: 'execution-foundation', repositories: Object.values(repositories),
        execute(context) {
          const attempt = context.repository('progress_attempts').invoke('find', { event_attempt_id: options.eventAttemptId });
          const event = context.repository('progress_events').invoke('find', { event_id: options.eventId });
          if (!attempt || !event || attempt.event_id !== event.event_id || attempt.state !== 'executing' || event.state !== 'executing') fail(
            'P4_PROGRESS_ATTEMPT_INACTIVE', 'Progress can only bind the current executing Event Attempt.'
          );
          const all = context.repository('progress_samples').invoke('list', { event_attempt_id:options.eventAttemptId })
            .sort((left, right) => left.revision - right.revision);
          if (sample.sourceSequence !== null) {
            const replay = all.find((row) => row.source_sequence === sample.sourceSequence);
            if (replay) {
              const same = replay.mode === sample.mode && replay.current_value === sample.currentValue && replay.total_value === sample.totalValue &&
                replay.unit === sample.unit && replay.rate === sample.rate && replay.eta_ms === sample.etaMs && replay.progress_bucket === sample.progressBucket;
              if (!same) fail('P4_PROGRESS_SOURCE_SEQUENCE_CONFLICT', 'A source sequence cannot identify different progress values.');
              return Object.freeze({ sampled: false, replayed: true, revision: replay.revision });
            }
          }
          const latest = all.at(-1);
          if (latest && sample.mode === 'determinate' && latest.mode === 'determinate' && sample.currentValue < latest.current_value) fail(
            'P4_PROGRESS_REGRESSION', 'Progress current value cannot regress within one Event Attempt.'
          );
          const changedBucket = !latest || latest.progress_bucket !== sample.progressBucket;
          if (latest && sampledAtMs - latest.sampled_at_ms < SAMPLE_INTERVAL_MS && !changedBucket && !sample.terminal) {
            return Object.freeze({ sampled: false, replayed: false, revision: latest.revision, reasonCode: 'SAMPLE_INTERVAL' });
          }
          if (all.length >= MAX_SAMPLES_PER_ATTEMPT - (sample.terminal ? 0 : 1)) {
            if (!sample.terminal) return Object.freeze({ sampled: false, replayed: false, revision: latest.revision, reasonCode: 'HISTORY_BOUND' });
            if (all.length >= MAX_SAMPLES_PER_ATTEMPT) fail('P4_PROGRESS_TERMINAL_ALREADY_BOUNDED', 'Progress history already contains its bounded terminal allowance.');
          }
          const revision = event.current_progress_revision === null ? 1 : event.current_progress_revision + 1;
          context.repository('progress_samples').invoke('insert', {
            event_id: options.eventId, event_attempt_id: options.eventAttemptId, revision, mode: sample.mode,
            current_value: sample.currentValue, total_value: sample.totalValue, unit: sample.unit, rate: sample.rate,
            eta_ms: sample.etaMs, source_sequence: sample.sourceSequence, progress_bucket: sample.progressBucket, sampled_at_ms: sampledAtMs
          });
          context.repository('progress_events').invoke('point', { event_id: options.eventId, current_progress_revision: revision });
          return Object.freeze({ sampled: true, replayed: false, revision });
        }
      }]).progress_report;
    }
  });
}

module.exports = Object.freeze({ MAX_SAMPLES_PER_ATTEMPT, ProgressReporterError, SAMPLE_INTERVAL_MS, createProgressReporter });
