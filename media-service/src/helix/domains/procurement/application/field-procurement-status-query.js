'use strict';

const {
  createRepositoryDefinition,
} = require('../../../foundation/persistence/owner-repository');

function createProcurementFieldStatusQuery(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Procurement Field status query requires clean persistence dependencies.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'procurement_field_status_query',
    owner: 'procurement',
    schemaManifest: options.schemaManifest,
    statements: {
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
    return options.unitOfWork.execute([{
      participantId: 'procurement_field_status',
      owner: 'procurement',
      repositories: [repository],
      execute(context) {
        const store = context.repository(repository.repositoryId);
        const runs = store.invoke('list_runs', { field_id: fieldId });
        const candidates = store.invoke('list_candidates', { field_id: fieldId })
          .sort((left, right) =>
            Number(right.published_at_ms) - Number(left.published_at_ms) ||
            Number(right.package_revision) - Number(left.package_revision) ||
            right.candidate_package_id.localeCompare(left.candidate_package_id));
        const runSummary = Object.freeze({
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
