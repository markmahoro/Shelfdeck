'use strict';

function fail() { throw Object.assign(new Error('Retained Arca Workspace has no exact collection responsibility.'),
  { code: 'ARCA_RESET_WORKSPACE_OWNER_INVALID' }); }

// Input is the selected collection closure, not all source database processes.
// Reclaimed registries are evidence only; active maintenance still owns files.
function describeFreshResetWorkspaceRetention({ registries, aftercareCases, builds, corrections }) {
  const cases = new Set(aftercareCases.map(row => row.aftercare_case_id));
  const series = new Set(builds.map(row => row.build_id));
  const identities = new Set(corrections.map(row => row.correction_id));
  return Object.freeze(registries.map(row => {
    if (row.owner_domain !== 'arca' || !['active', 'reclaimed'].includes(row.state)) fail();
    const id = row.process_id;
    const expected = row.process_type === 'aftercare_case' && cases.has(id) ? id :
      row.process_type === 'series_presentation' && series.has(id) ? id + '-assets' :
      row.process_type === 'jav_identity_correction' && identities.has(id) ? id + '-assets' : null;
    if (!expected || row.workspace_id !== expected) fail();
    return row.state === 'reclaimed' ? null : Object.freeze({ owner: 'arca', workspaceId: row.workspace_id,
      rootHandleRef: row.root_handle_ref, rootKind: 'aftercare-workspace' });
  }).filter(Boolean));
}

module.exports = Object.freeze({ describeFreshResetWorkspaceRetention });
