'use strict';

function fail() { throw Object.assign(new Error('Retained Libra Workspace registry differs from its Owner.'),
  { code: 'LIBRA_RESET_WORKSPACE_OWNER_INVALID' }); }

function describeFreshResetWorkspaceRetention({ workspaces, registries }) {
  const byId = new Map(registries.map(row => [row.workspace_id, row]));
  if (byId.size !== registries.length) fail();
  const result = [];
  for (const row of workspaces) {
    if (!['active', 'reclaiming', 'reclaimed'].includes(row.state)) fail();
    const registry = byId.get(row.workspace_id);
    if (registry) {
      if (registry.owner_domain !== 'libra' || registry.process_type !== 'libra_run' ||
          registry.process_id !== row.libra_run_id || registry.root_handle_ref !== row.root_handle_ref ||
          registry.state !== (row.state === 'reclaimed' ? 'reclaimed' : 'active')) fail();
      byId.delete(row.workspace_id);
    }
    if (row.state === 'reclaimed') continue;
    if (!registry) fail();
    result.push(Object.freeze({ owner: 'libra', workspaceId: row.workspace_id, rootHandleRef: row.root_handle_ref,
      rootKind: 'production-workspace' }));
  }
  if (byId.size) fail();
  return Object.freeze(result);
}

module.exports = Object.freeze({ describeFreshResetWorkspaceRetention });
