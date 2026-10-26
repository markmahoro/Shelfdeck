'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const arca = require('../src/helix/domains/arca/public');
const libra = require('../src/helix/domains/libra/public');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function key(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Resolve only Owner-declared, selected Workspaces against exact Platform
// handles. Historical Artifact.state is deliberately not a file retention rule.
function readRetainedWorkspaceProtection(database) {
  if (!database.readonly || !database.inTransaction) fail('RESET_VERIFY_READONLY_REQUIRED');
  const registries = database.prepare('SELECT * FROM fx_workspace_registry ORDER BY workspace_id').all();
  if (registries.some(row => !['libra', 'arca'].includes(row.owner_domain))) fail('RESET_WORKSPACE_OWNER_UNREVIEWED');
  const declarations = [
    ...libra.describeFreshResetWorkspaceRetention({
      workspaces: database.prepare('SELECT * FROM libra_workspaces ORDER BY workspace_id').all(),
      registries: registries.filter(row => row.owner_domain === 'libra'),
    }),
    ...arca.describeFreshResetWorkspaceRetention({
      registries: registries.filter(row => row.owner_domain === 'arca'),
      aftercareCases: database.prepare('SELECT * FROM arca_aftercare_cases ORDER BY aftercare_case_id').all(),
      builds: database.prepare('SELECT * FROM arca_series_presentation_builds ORDER BY build_id').all(),
      corrections: database.prepare('SELECT * FROM arca_jav_identity_corrections ORDER BY correction_id').all(),
    }),
  ];
  const roots = database.prepare('SELECT * FROM platform_workspace_roots ORDER BY root_id').all();
  const workspaces = declarations.map(value => {
    const matches = roots.filter(row => row.root_handle_ref === value.rootHandleRef);
    const root = matches[0];
    if (matches.length !== 1 || root.state !== 'active' || root.owner_scope !== value.owner || root.root_kind !== value.rootKind)
      fail('RESET_WORKSPACE_ROOT_UNRESOLVED');
    if (typeof root.resolved_root !== 'string' || !path.isAbsolute(root.resolved_root) ||
        key(path.resolve(root.resolved_root)) !== key(root.resolved_root) ||
        typeof value.workspaceId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value.workspaceId))
      fail('RESET_WORKSPACE_LOCATION_UNSAFE');
    const location = path.join(root.resolved_root, value.workspaceId);
    return Object.freeze({ ...value, rootId: root.root_id, root: root.resolved_root, location });
  }).sort((a, b) => a.location.localeCompare(b.location));
  if (new Set(workspaces.map(row => key(row.location))).size !== workspaces.length) fail('RESET_WORKSPACE_LOCATION_AMBIGUOUS');
  return Object.freeze({ workspaces: Object.freeze(workspaces), digest: canonicalDigest(workspaces) });
}

function assertRetainedWorkspaceProtection(protection, storage) {
  for (const workspace of protection.workspaces) {
    // The private root must be classified even when the Workspace is empty.
    // A source/formal root is not an alternative to a missing private mapping.
    if (!storage.roots.some(root => key(path.resolve(root)) === key(workspace.root)))
      fail('RESET_WORKSPACE_ROOT_UNCLASSIFIED');
    if (!(storage.retainedPaths || []).some(location => key(path.resolve(location)) === key(workspace.location)))
      fail('RESET_WORKSPACE_RETENTION_MISSING');
  }
  for (const location of storage.retainedPaths || []) {
    if (!protection.workspaces.some(row => inside(row.location, path.resolve(location))))
      fail('RESET_WORKSPACE_RETENTION_UNPROVEN');
  }
  return protection;
}

function verifyWorkspaceStorage({ Database, targetPath, storage }) {
  const resolved = deriveWorkspaceStorage({ Database, targetPath, storage });
  const normalized = { ...storage, roots: [...storage.roots].sort(),
    protectedDirectories: [...storage.protectedDirectories].sort(), retainedPaths: storage.retainedPaths || [] };
  if (canonicalDigest(normalized) !== canonicalDigest(resolved.storage)) fail('RESET_STORAGE_OWNER_BOUNDARIES_CHANGED');
  return resolved.protection;
}

function deriveWorkspaceStorage({ Database, targetPath, storage }) {
  const database = new Database(targetPath, { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only=ON'); database.exec('BEGIN');
    const protection = readRetainedWorkspaceProtection(database);
    const registered = database.prepare('SELECT * FROM platform_workspace_roots ORDER BY root_id').all();
    const privateRoots = registered.filter(row => row.state === 'active' &&
      (row.owner_scope === 'libra' && row.root_kind === 'production-workspace' || row.owner_scope === 'arca' && row.root_kind === 'aftercare-workspace'));
    const protectedLocations = [
      ...database.prepare('SELECT root_location FROM proc_field_access_revisions').all().map(row => row.root_location),
      ...database.prepare('SELECT root_location FROM arca_shelf_target_bindings').all().map(row => row.root_location),
      ...database.prepare('SELECT target_root_location FROM arca_shelves').all().map(row => row.target_root_location),
      ...registered.filter(row => !privateRoots.includes(row)).map(row => row.resolved_root),
    ];
    function paths(values) {
      const result = new Map();
      for (const value of values) {
        if (typeof value !== 'string' || !path.isAbsolute(value) || key(path.resolve(value)) !== key(value))
          fail('RESET_STORAGE_OWNER_LOCATION_INVALID');
        result.set(key(value), value);
      }
      return [...result.values()].sort();
    }
    const resolved = { ...storage,
      roots: paths([...storage.roots, ...privateRoots.map(row => row.resolved_root)]),
      protectedDirectories: paths([...storage.protectedDirectories, ...protectedLocations]),
      retainedPaths: protection.workspaces.map(row => row.location) };
    // Callers may replay a frozen selection, but may not broaden it to keep an
    // entire old production root or hide omitted collection maintenance.
    if (storage.retainedPaths && canonicalDigest(storage.retainedPaths) !== canonicalDigest(resolved.retainedPaths))
      fail('RESET_WORKSPACE_RETENTION_CHANGED');
    assertRetainedWorkspaceProtection(protection, resolved);
    return { storage: resolved, protection };
  } finally { if (database.inTransaction) database.exec('ROLLBACK'); database.close(); }
}

module.exports = Object.freeze({ readRetainedWorkspaceProtection, assertRetainedWorkspaceProtection, verifyWorkspaceStorage, deriveWorkspaceStorage });
