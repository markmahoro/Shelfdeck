'use strict';

const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
function fail(code) { throw Object.assign(new Error(code), { code }); }

// A valid SQL FK graph is not enough: Control carries opaque Owner scopes.
// This post-copy guard never releases ownership. It refuses a retained current
// projection that would point back to a cleared intake or uncommitted custody.
function verifyRetainedControls(database) {
  if (!database.readonly || !database.inTransaction) fail('RESET_VERIFY_READONLY_REQUIRED');
  const entries = database.prepare('SELECT 1 FROM arca_shelf_entries WHERE shelf_entry_id=?');
  const scopes = database.prepare('SELECT 1 FROM arca_series_presentation_scopes WHERE scope_id=?');
  const summary = { released: 0, shelfEntry: 0, seriesPresentation: 0 };
  for (const control of database.prepare(`SELECT material_key,owner_domain,owner_scope_type,owner_scope_id,state
      FROM fx_material_controls ORDER BY material_key`).iterate()) {
    if (control.state === 'released') {
      if ([control.owner_domain, control.owner_scope_type, control.owner_scope_id].some(value => value !== null))
        fail('RESET_VERIFY_CONTROL_OWNER_INVALID');
      summary.released++; continue;
    }
    if (control.state !== 'controlled' || control.owner_domain !== 'arca') fail('RESET_VERIFY_UNCOMMITTED_CONTROL_RETAINED');
    if (control.owner_scope_type === 'shelf_entry' && entries.get(control.owner_scope_id)) summary.shelfEntry++;
    else if (control.owner_scope_type === 'series_presentation' && scopes.get(control.owner_scope_id)) summary.seriesPresentation++;
    else fail('RESET_VERIFY_CONTROL_OWNER_MISSING');
  }
  return Object.freeze({ ...summary, digest: canonicalDigest(summary) });
}

module.exports = Object.freeze({ verifyRetainedControls });
