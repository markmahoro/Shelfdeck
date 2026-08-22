'use strict';

const {
  createRepositoryDefinition,
} = require('../../../foundation/persistence/owner-repository');

const OPEN_WORK_STATES = new Set(['admitted', 'ready', 'running', 'blocked']);
const ROOT_FAILURE_CODES = new Set([
  'FIELD_OBSERVATION_ROOT_UNAVAILABLE',
  'FIELD_OBSERVATION_ROOT_NOT_DIRECTORY',
]);
const SCAN_FAILURE_MESSAGES = Object.freeze({
  FIELD_OBSERVATION_ROOT_UNAVAILABLE: '电影目录不存在或当前不可读取。',
  FIELD_OBSERVATION_ROOT_NOT_DIRECTORY: '电影目录必须是一个文件夹。',
});

function workCreatedAt(work) {
  return Number(work.created_at_ms) || 0;
}

function observationScan(field, pages, openWork, latestFailed) {
  const pageCount = pages.length;
  const latest = pages[pages.length - 1] || null;
  const observationRevision = field.current_observation_revision == null
    ? null
    : Number(field.current_observation_revision);
  if (openWork) {
    return Object.freeze({
      state: 'scanning',
      pageCount,
      observationRevision,
      inProgress: true,
      accessAvailable: true,
    });
  }
  if (latestFailed) {
    const failureCode = latestFailed.failureCode || 'FIELD_OBSERVATION_ROOT_UNAVAILABLE';
    return Object.freeze({
      state: 'failed',
      pageCount,
      observationRevision,
      inProgress: false,
      accessAvailable: !ROOT_FAILURE_CODES.has(failureCode),
      failureCode,
      failureMessage: SCAN_FAILURE_MESSAGES[failureCode] || '目录扫描失败。',
    });
  }
  if (latest && Number(latest.completed) === 1) {
    return Object.freeze({
      state: 'completed',
      pageCount,
      observationRevision,
      inProgress: false,
      accessAvailable: true,
    });
  }
  return Object.freeze({
    state: 'waiting',
    pageCount,
    observationRevision,
    inProgress: false,
    accessAvailable: true,
  });
}

function createProcurementFieldStatusQuery(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Procurement Field status query requires clean persistence dependencies.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'procurement_field_status_query',
    owner: 'procurement',
    schemaManifest: options.schemaManifest,
    statements: {
      find_field: {
        kind: 'select-one',
        tableId: 'proc_material_fields',
        safeIntegers: true,
        columns: ['field_id', 'status', 'current_observation_revision'],
        keyColumns: ['field_id'],
      },
      list_observation_pages: {
        kind: 'select-all',
        tableId: 'proc_field_observations',
        safeIntegers: true,
        columns: [
          'field_id',
          'revision',
          'observation_id',
          'field_observation_work_id',
          'page_ordinal',
          'completed',
          'observed_at_ms',
        ],
        keyColumns: ['field_observation_work_id'],
      },
      find_observation: {
        kind: 'select-one',
        tableId: 'proc_field_observations',
        safeIntegers: true,
        columns: [
          'field_id',
          'revision',
          'observation_id',
          'field_observation_work_id',
          'page_ordinal',
          'completed',
          'observed_at_ms',
        ],
        keyColumns: ['field_id', 'revision'],
      },
      list_runs: {
        kind: 'select-all',
        tableId: 'proc_procurement_runs',
        safeIntegers: true,
        columns: [
          'procurement_run_id',
          'field_id',
          'state',
          'state_revision',
          'candidate_package_revision_head',
          'created_at_ms',
        ],
        keyColumns: ['field_id'],
      },
      list_candidates: {
        kind: 'select-all',
        tableId: 'proc_candidate_packages',
        safeIntegers: true,
        columns: [
          'candidate_package_id',
          'procurement_run_id',
          'field_id',
          'package_revision',
          'package_digest',
          'display_identity',
          'content_profile',
          'state',
          'published_at_ms',
        ],
        keyColumns: ['field_id'],
      },
      find_delivery: {
        kind: 'select-one',
        tableId: 'proc_candidate_deliveries',
        safeIntegers: true,
        columns: [
          'candidate_package_id',
          'package_revision',
          'package_digest',
          'offer_id',
          'state',
          'offered_at_ms',
          'closed_at_ms',
        ],
        keyColumns: ['candidate_package_id'],
      },
    },
  });

  function read(fieldId) {
    const observationWorks = options.workResultReader
      ? options.workResultReader.listWorks({
        ownerDomain: 'procurement',
        processType: 'material_field',
        processId: fieldId,
        workKind: 'field_observation',
      }).slice().sort((left, right) =>
        workCreatedAt(left) - workCreatedAt(right) ||
        left.work_id.localeCompare(right.work_id))
      : [];
    const openWork = observationWorks.find((work) => OPEN_WORK_STATES.has(work.state)) || null;
    const latestWork = observationWorks[observationWorks.length - 1] || null;
    let latestFailed = null;
    if (!openWork && latestWork?.state === 'failed' && options.workResultReader) {
      const status = options.workResultReader.status(latestWork.work_id);
      latestFailed = Object.freeze({
        workId: latestWork.work_id,
        failureCode: status?.latestAttempt?.failure_code || 'FIELD_OBSERVATION_ROOT_UNAVAILABLE',
      });
    }
    return options.unitOfWork.execute([{
      participantId: 'procurement_field_status',
      owner: 'procurement',
      repositories: [repository],
      execute(context) {
        const store = context.repository(repository.repositoryId);
        const field = store.invoke('find_field', { field_id: fieldId });
        const currentObservation = field?.current_observation_revision == null
          ? null
          : store.invoke('find_observation', {
            field_id: fieldId,
            revision: field.current_observation_revision,
          });
        const scanWorkId = openWork?.work_id || currentObservation?.field_observation_work_id || null;
        const pages = scanWorkId
          ? store.invoke('list_observation_pages', { field_observation_work_id: scanWorkId })
            .sort((left, right) => Number(left.page_ordinal) - Number(right.page_ordinal))
          : [];
        const scan = observationScan(field || { current_observation_revision: null }, pages, openWork, latestFailed);
        const runs = store.invoke('list_runs', { field_id: fieldId });
        const candidates = store.invoke('list_candidates', { field_id: fieldId })
          .sort((left, right) =>
            Number(right.published_at_ms) - Number(left.published_at_ms) ||
            Number(right.package_revision) - Number(left.package_revision) ||
            right.candidate_package_id.localeCompare(left.candidate_package_id));
        const runSummary = Object.freeze({
          observationScan: scan,
          runCount: runs.length,
          activeRunCount: runs.filter((run) => ['active', 'waiting'].includes(run.state)).length,
          sealedRunCount: runs.filter((run) => run.state === 'sealed').length,
          candidateCount: candidates.length,
          openOfferCount: candidates.reduce((count, candidate) => count +
            (store.invoke('find_delivery', { candidate_package_id: candidate.candidate_package_id })?.state === 'open' ? 1 : 0), 0),
        });
        if (candidates.length > 0) {
          const candidate = candidates[0];
          const delivery = store.invoke('find_delivery', {
            candidate_package_id: candidate.candidate_package_id,
          });
          const stage = delivery?.state === 'open'
            ? 'handoff_a_ready'
            : delivery?.state === 'accepted'
              ? 'handoff_a_accepted'
              : delivery?.state === 'rejected'
                ? 'handoff_a_rejected'
                : 'candidate_published';
          return Object.freeze({
            stage,
            ...runSummary,
            procurementRunId: candidate.procurement_run_id,
            candidatePackage: Object.freeze({
              candidatePackageId: candidate.candidate_package_id,
              packageRevision: Number(candidate.package_revision),
              packageDigest: candidate.package_digest,
              displayIdentity: candidate.display_identity,
              contentProfile: candidate.content_profile,
            }),
            ...(delivery ? {
              delivery: Object.freeze({
                offerId: delivery.offer_id,
                state: delivery.state,
              }),
            } : {}),
          });
        }
        const activeRun = runs
          .filter((run) => ['active', 'waiting'].includes(run.state))
          .sort((left, right) =>
            Number(right.created_at_ms) - Number(left.created_at_ms) ||
            right.procurement_run_id.localeCompare(left.procurement_run_id))[0];
        if (activeRun) {
          return Object.freeze({
            stage: 'procurement_run_active',
            ...runSummary,
            procurementRunId: activeRun.procurement_run_id,
          });
        }
        return Object.freeze({ stage: 'not_started', ...runSummary });
      },
    }]).procurement_field_status;
  }

  return Object.freeze({ read });
}

module.exports = Object.freeze({ createProcurementFieldStatusQuery });
