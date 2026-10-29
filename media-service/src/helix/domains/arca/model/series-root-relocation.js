'use strict';

const path = require('node:path');
const {canonicalDigest, canonicalJson} = require('../../../contracts/canonical-json');
const {assertRootBinding} = require('./series-presentation');
const {physicalIdentityFromInventoryRow} = require('./aftercare-contract');

const SCHEMA = 'arca.series-root-relocation-plan@1';
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const inside = (root, location) => {
  const relative = path.relative(root, location);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function buildSeriesRootRelocationPlan({scope, shared, seasons, references, reservations, targetRoot, placementRevision}) {
  if (!scope || scope.active_build_id || scope.retirement_scope_id || !Number(scope.current_version) ||
      reservations.some(row => row.state === 'pending')) fail('ARCA_SERIES_RELOCATION_BUSY', 'Shared root still has another builder or collection obligation in progress.');
  if (!shared || shared.scopeId !== scope.scope_id || shared.revision !== Number(scope.current_version) ||
      shared.rootLocation !== scope.root_location || shared.members.length !== 3)
    fail('ARCA_SERIES_RELOCATION_SCOPE_INVALID', 'Relocation needs the exact current shared Inventory.');
  const oldRoot = assertRootBinding({shelfRoot:scope.shelf_root, rootLocation:scope.root_location});
  const newRoot = assertRootBinding({shelfRoot:scope.shelf_root, rootLocation:targetRoot});
  if (oldRoot === newRoot || inside(oldRoot,newRoot) || inside(newRoot,oldRoot) ||
      !Number.isSafeInteger(placementRevision) || placementRevision < Number(scope.placement_revision))
    fail('ARCA_SERIES_RELOCATION_TARGET_INVALID', 'Relocation requires disjoint old and new roots in the same Shelf.');
  const activeReferences = references.filter(row => row.state === 'active');
  if (!Array.isArray(seasons) || !seasons.length || seasons.length > 128 ||
      new Set(seasons.map(row=>row.entry.shelf_entry_id)).size !== seasons.length ||
      canonicalJson(activeReferences.map(row=>row.shelf_entry_id).sort()) !== canonicalJson(seasons.map(row=>row.entry.shelf_entry_id).sort()))
    fail('ARCA_SERIES_RELOCATION_MEMBER_SET_INVALID', 'Relocation must cover every active Season reference exactly once.');
  const files = [], heads = [];
  for (const season of seasons) {
    const {entry, identity, inventory, materials} = season;
    if (entry.status !== 'active' || entry.structure_kind !== 'season' || entry.shelf_id !== scope.shelf_id ||
        identity.provider !== scope.provider || String(identity.provider_key) !== scope.provider_key ||
        Number(entry.current_inventory_revision) !== Number(inventory.revision) ||
        !materials.length || season.reservations?.some(row=>row.state==='active') ||
        season.cases?.some(row=>['queued','active'].includes(row.state)) || season.correctionPending)
      fail('ARCA_SERIES_RELOCATION_MEMBER_BUSY', 'A Season has changed identity, custody or another modification in progress.');
    heads.push({shelfEntryId:entry.shelf_entry_id, inventoryRevision:Number(entry.current_inventory_revision),
      identityRevision:Number(entry.canonical_identity_revision), deckFactRevision:Number(entry.current_deck_fact_revision),
      snapshotDigest:canonicalDigest(season)});
    for (const material of materials) {
      if (material.endpoint_id !== scope.endpoint_id || material.mount_scope_id !== scope.mount_scope_id || !inside(oldRoot,material.location))
        fail('ARCA_SERIES_RELOCATION_MEMBER_OUTSIDE_ROOT', 'A current Season material is outside its shared root.');
      const relativePath = path.relative(oldRoot,material.location).split(path.sep).join('/');
      if (relativePath.split('/').length < 2) fail('ARCA_SERIES_RELOCATION_MEMBER_OUTSIDE_ROOT', 'Season material is not inside a Season directory.');
      files.push({relativePath, ownerScopeType:'shelf_entry', ownerScopeId:entry.shelf_entry_id,
        identity:physicalIdentityFromInventoryRow(material), byteDigest:null});
    }
  }
  for (const member of shared.members) {
    if (member.endpointId !== scope.endpoint_id || member.physicalIdentity.mountScopeId !== scope.mount_scope_id ||
        path.dirname(member.location) !== oldRoot)
      fail('ARCA_SERIES_RELOCATION_SCOPE_INVALID', 'Shared presentation has a foreign physical location.');
    files.push({relativePath:path.basename(member.location), ownerScopeType:'series_presentation', ownerScopeId:scope.scope_id,
      identity:member.physicalIdentity, byteDigest:member.byteDigest});
  }
  if (files.length > 8192 || new Set(files.map(row=>row.relativePath)).size !== files.length ||
      new Set(files.map(row=>row.identity.materialKey)).size !== files.length)
    fail('ARCA_SERIES_RELOCATION_MEMBER_SET_INVALID', 'Relocation cannot duplicate a path or physical material.');
  const value = {schema:SCHEMA, scopeId:scope.scope_id, shelfId:scope.shelf_id, provider:scope.provider, providerKey:scope.provider_key,
    endpointId:scope.endpoint_id, mountScopeId:scope.mount_scope_id, shelfRoot:path.resolve(scope.shelf_root),
    oldRoot, newRoot, placementRevision, expectedVersion:Number(scope.current_version), scopeDigest:canonicalDigest(scope),
    sharedManifestDigest:shared.digest, referencesDigest:canonicalDigest(activeReferences),
    seasons:heads.sort((a,b)=>a.shelfEntryId.localeCompare(b.shelfEntryId)), files:files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath))};
  if (Buffer.byteLength(canonicalJson(value)) > 4*1024*1024) fail('ARCA_SERIES_RELOCATION_PLAN_TOO_LARGE', 'Relocation plan exceeds its bounded command scope.');
  return Object.freeze({...value, digest:canonicalDigest(value)});
}

function assertSeriesRootRelocationPlan(plan) {
  const {digest, ...value} = plan || {};
  if (plan?.schema !== SCHEMA || canonicalDigest(value) !== digest || !Array.isArray(plan.files) || !plan.files.length || plan.files.length>8192 ||
      !Array.isArray(plan.seasons) || !plan.seasons.length || plan.seasons.length>128 || plan.oldRoot === plan.newRoot ||
      Buffer.byteLength(canonicalJson(plan))>4*1024*1024||inside(plan.oldRoot,plan.newRoot)||inside(plan.newRoot,plan.oldRoot)||
      !Number.isSafeInteger(plan.placementRevision)||plan.placementRevision<1||!Number.isSafeInteger(plan.expectedVersion)||plan.expectedVersion<1)
    fail('ARCA_SERIES_RELOCATION_PLAN_INVALID', 'Relocation plan is missing or changed.');
  assertRootBinding({shelfRoot:plan.shelfRoot, rootLocation:plan.oldRoot});
  assertRootBinding({shelfRoot:plan.shelfRoot, rootLocation:plan.newRoot});
  const ids=new Set(plan.seasons.map(row=>row.shelfEntryId)),paths=new Set(),keys=new Set();let sharedCount=0;
  if(ids.size!==plan.seasons.length||plan.seasons.some(row=>!row.shelfEntryId||!Number.isSafeInteger(row.inventoryRevision)||row.inventoryRevision<1||
      !Number.isSafeInteger(row.identityRevision)||row.identityRevision<1||!Number.isSafeInteger(row.deckFactRevision)||row.deckFactRevision<1||!/^[a-f0-9]{64}$/.test(row.snapshotDigest)))
    fail('ARCA_SERIES_RELOCATION_PLAN_INVALID','Relocation Season heads are not exact.');
  for (const file of plan.files) {
    const identity=file.identity,key=process.platform==='win32'?file.relativePath?.toLowerCase():file.relativePath;
    if (typeof file.relativePath !== 'string' || /[\\:\x00-\x1f]/.test(file.relativePath) ||
        file.relativePath.split('/').some(part=>!part || part==='.' || part==='..') || path.posix.isAbsolute(file.relativePath) ||
        !identity?.materialKey||identity.mountScopeId!==plan.mountScopeId||paths.has(key)||keys.has(identity.materialKey))
      fail('ARCA_SERIES_RELOCATION_PLAN_INVALID', 'Relocation has an unbounded or duplicated physical member.');
    paths.add(key);keys.add(identity.materialKey);
    physicalIdentityFromInventoryRow({material_key:identity.materialKey,mount_scope_id:identity.mountScopeId,inode:identity.inode,size_bytes:identity.sizeBytes,
      fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:identity.fingerprintVersion,content_fingerprint:identity.contentFingerprint});
    if(file.ownerScopeType==='series_presentation') {
      sharedCount++;
      if(file.ownerScopeId!==plan.scopeId||!['tvshow.nfo','poster.jpg','fanart.jpg'].includes(file.relativePath)||!/^[a-f0-9]{64}$/.test(file.byteDigest))
        fail('ARCA_SERIES_RELOCATION_PLAN_INVALID','Shared member does not belong to this exact Series.');
    }else if(file.ownerScopeType!=='shelf_entry'||!ids.has(file.ownerScopeId)||file.relativePath.split('/').length<2||file.byteDigest!==null)
      fail('ARCA_SERIES_RELOCATION_PLAN_INVALID','Season member does not belong to the frozen complete set.');
  }
  if(sharedCount!==3||[...ids].some(id=>!plan.files.some(file=>file.ownerScopeType==='shelf_entry'&&file.ownerScopeId===id)))
    fail('ARCA_SERIES_RELOCATION_PLAN_INVALID','Relocation is missing a Season or shared presentation member.');
  return plan;
}

module.exports = Object.freeze({SCHEMA, buildSeriesRootRelocationPlan, assertSeriesRootRelocationPlan});
