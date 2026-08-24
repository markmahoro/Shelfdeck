'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { computeBoundedMaterialFingerprintSync } = require('../../src/helix/integrations/bounded-material-fingerprint');
const { createAftercareStore } = require('../../src/helix/domains/arca/persistence/aftercare-store');
const { createAftercareProcessCoordinator } = require('../../src/helix/domains/arca/application/aftercare-process-coordinator');
const { RETENTION_MS } = require('../../src/helix/domains/arca/persistence/aftercare-workspace-store');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const digest = (value) => canonicalDigest({ value });

function fixture(storeOptions={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aftercare-workspace-lifecycle-')),workspaceRoot=path.join(root,'aftercare'),databasePath=path.join(root,'shelfdeck.db');
  fs.mkdirSync(workspaceRoot,{recursive:true});let at=10_000;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>at}),database=new Database(databasePath);
  database.pragma('foreign_keys = OFF');
  const careBasis={schemaRef:'helix://contracts/domain-types/CareBasis/v1',schemaVersion:1,inventoryRevision:1,standardRevision:1,
    placementRevision:1,canonicalIdentityDigest:digest('identity'),sourcePackageId:'package-1',acceptedProductFactSetDigest:digest('facts'),
    decisionFactSetDigest:digest('decision')};careBasis.digest=canonicalDigest(careBasis);
  const requirement={schemaRef:'helix://contracts/domain-types/CareRequirement/v1',schemaVersion:1,requirementId:'requirement-1',revision:1,
    careBasisDigest:careBasis.digest,requiredEffects:[],acceptanceDigest:digest('acceptance'),typedParameters:[]};requirement.digest=canonicalDigest(requirement);
  database.prepare(`INSERT INTO arca_aftercare_cases
    (aftercare_case_id,shelf_entry_id,finding_set_digest,care_basis_schema_ref,care_basis_json,care_basis_digest,
     care_requirement_schema_ref,care_requirement_json,care_requirement_digest,case_generation,trigger_digest,state,
     terminal_reason_code,terminal_evidence_digest,created_at_ms,terminal_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL)`).run('case-1','entry-1',digest('findings'),careBasis.schemaRef,canonicalJson(careBasis),careBasis.digest,
      requirement.schemaRef,canonicalJson(requirement),requirement.digest,1,digest('trigger'),'active',at);
  const store=createAftercareStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),now:()=>at,
    aftercareWorkspaceRoot:workspaceRoot,aftercareWorkspaceEndpointId:'local-filesystem-win32',aftercareWorkspaceMountScopeId:'mount-f',
    aftercareWorkspaceMountScopeRevision:1,computeBoundedMaterialFingerprintSync,...storeOptions});
  function registerMember(relativePath, bytes=Buffer.from('aftercare workspace member')) {
    store.ensureAftercareWorkspace('case-1');const location=path.join(workspaceRoot,'case-1',...relativePath.split('/'));
    fs.mkdirSync(path.dirname(location),{recursive:true});fs.writeFileSync(location,bytes);
    const bounded=computeBoundedMaterialFingerprintSync(location),identity={mountScopeId:'mount-f',inode:String(bounded.stat.ino),
      sizeBytes:Number(bounded.stat.size),fingerprintAlgorithm:bounded.fingerprintAlgorithm,fingerprintVersion:bounded.fingerprintVersion,
      contentFingerprint:bounded.contentFingerprint},materialKey=canonicalDigest({schema:'physical-material-identity@2',...identity}),base={
      schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:'member-'+digest(relativePath).slice(0,24),
      workspaceId:'case-1',ownerDomain:'arca',processId:'entry-1',endpointId:'local-filesystem-win32',materialKey,
      physicalIdentity:Object.freeze(identity),rootHandleRef:store.aftercareWorkspaceRootSnapshot.rootHandleRef,relativePath,
      digestAlgorithm:'middle-256k-sha256',digestHex:bounded.contentFingerprint,sizeBytes:Number(bounded.stat.size),referenceRevision:1,
      accessScope:'workspace_material_read'},handle=Object.freeze({...base,fenceDigest:canonicalDigest(base)});
    store.registerAftercareWorkspaceMaterial(handle);return {location,handle};
  }
  function commitInventory(){database.prepare(`INSERT INTO arca_aftercare_inventory_commits
      (inventory_commit_id,aftercare_case_id,shelf_entry_id,previous_inventory_revision,new_inventory_revision,control_change_digest,commit_digest,committed_at_ms)
      VALUES (?,?,?,?,?,?,?,?)`).run('commit-1','case-1','entry-1',1,2,digest('control'),digest('commit'),20_000);}
  return {root,workspaceRoot,database,kernel,store,careBasis,registerMember,commitInventory,setTime(value){at=value;},close(){database.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('every terminal Aftercare Case schedules retention and reclaims Workspace without requiring an Inventory commit', async () => {
  for(const terminalState of ['unresolved','invalidated']){const value=fixture();try{const member=value.registerMember('artifacts/movie.nfo');value.store.terminateCase('case-1',terminalState,'test_'+terminalState,digest('terminal-'+terminalState));
    const state=value.store.inspectAftercareWorkspaceLifecycle('case-1');assert.equal(Number(state.registry.reclaim_after_ms),10_000+RETENTION_MS);
    value.setTime(10_000+RETENTION_MS-1);assert.equal((await value.store.reconcileAftercareWorkspaceLifecycle('case-1')).reasonCode,'retention_period_active');assert.equal(fs.existsSync(member.location),true);
    value.setTime(10_000+RETENTION_MS);const reclaimed=await value.store.reconcileAftercareWorkspaceLifecycle('case-1');assert.equal(reclaimed.kind,'reclaimed');assert.equal(fs.existsSync(member.location),false);
  } finally {value.close();}}
});

test('active Aftercare Case keeps its Workspace outside the reclaim lifecycle', async () => {
  const active=fixture();try{const member=active.registerMember('active.bin'),state=await active.store.reconcileAftercareWorkspaceLifecycle('case-1');
    assert.equal(state.reasonCode,'case_active');assert.equal(fs.existsSync(member.location),true);
  } finally {active.close();}
});

test('resolved Aftercare Workspace observes 24h retention, Inventory commit, exact members, and emits a durable receipt', async () => {
  const value=fixture();try{const member=value.registerMember('media/output.mkv',Buffer.alloc(4096,7));value.store.terminateCase('case-1','resolved','test_resolved',digest('terminal-resolved'));
    let state=value.store.inspectAftercareWorkspaceLifecycle('case-1');assert.equal(Number(state.registry.reclaim_after_ms),10_000+RETENTION_MS);
    value.setTime(10_000+RETENTION_MS-1);assert.equal((await value.store.reconcileAftercareWorkspaceLifecycle('case-1')).reasonCode,'retention_period_active');
    value.setTime(10_000+RETENTION_MS);value.commitInventory();
    const unknown=path.join(value.workspaceRoot,'case-1','unknown.bin');fs.writeFileSync(unknown,'unknown');
    await assert.rejects(value.store.reconcileAftercareWorkspaceLifecycle('case-1'),(error)=>error.code==='ARCA_AFTERCARE_WORKSPACE_UNKNOWN_MEMBER');
    assert.equal(fs.existsSync(member.location),true);fs.rmSync(unknown);
    const reclaimed=await value.store.reconcileAftercareWorkspaceLifecycle('case-1');assert.equal(reclaimed.kind,'reclaimed');assert.equal(fs.existsSync(member.location),false);
    assert.equal(reclaimed.receipt.receiptKind,'aftercare_workspace_reclaimed');assert.deepEqual(reclaimed.receipt.reclaimedHandleIds,[member.handle.handleId]);
    state=value.store.inspectAftercareWorkspaceLifecycle('case-1');assert.equal(state.registry.state,'reclaimed');assert.equal(state.materials[0].state,'reclaimed');
    assert.equal(value.database.prepare(`SELECT COUNT(*) AS count FROM fx_effect_journal WHERE effect_class='arca_aftercare_workspace_reclaim'`).get().count,0);
    const replay=await value.store.reconcileAftercareWorkspaceLifecycle('case-1');assert.equal(replay.kind,'reclaimed');assert.equal(replay.receipt.receiptId,reclaimed.receipt.receiptId);
  } finally {value.close();}
});

test('Foundation recovery decision resumes a partial Workspace delete without claiming premature completion', async () => {
  let failOnce=true;const value=fixture({unlinkWorkspaceFile:async (location)=>{if(failOnce&&path.basename(location)==='z-second.bin'){failOnce=false;throw Object.assign(new Error('busy'),{code:'EBUSY'});}return fs.promises.unlink(location);}});
  try{const first=value.registerMember('a-first.bin'),second=value.registerMember('z-second.bin');value.store.terminateCase('case-1','unresolved','test_unresolved',digest('terminal-unresolved'));value.setTime(10_000+RETENTION_MS);
    await assert.rejects(value.store.reconcileAftercareWorkspaceLifecycle('case-1'),(error)=>error.code==='EBUSY');
    assert.equal(fs.existsSync(first.location),false);assert.equal(fs.existsSync(second.location),true);
    let state=value.store.inspectAftercareWorkspaceLifecycle('case-1');assert.equal(state.registry.state,'active');assert.deepEqual(state.materials.map((row)=>row.state),['active','active']);
    const resumed=await value.store.reconcileAftercareWorkspaceLifecycle('case-1',{recoveryDecision:{kind:'resume'}});assert.equal(resumed.kind,'reclaimed');assert.equal(fs.existsSync(second.location),false);
    state=value.store.inspectAftercareWorkspaceLifecycle('case-1');assert.equal(state.registry.state,'reclaimed');assert.deepEqual(resumed.receipt.reclaimedHandleIds,[first.handle.handleId,second.handle.handleId].sort());
  } finally {value.close();}
});

test('live reclaim preflights every registered member before deleting any file, while recovery accepts a prior deletion', async () => {
  const value=fixture();try{
    const first=value.registerMember('a-existing.bin'),missing=value.registerMember('z-missing.bin');
    value.store.terminateCase('case-1','resolved','test_resolved',digest('terminal-resolved'));value.commitInventory();value.setTime(10_000+RETENTION_MS);fs.rmSync(missing.location);
    await assert.rejects(value.store.reconcileAftercareWorkspaceLifecycle('case-1'),(error)=>error.code==='ARCA_AFTERCARE_WORKSPACE_MEMBER_MISSING');
    assert.equal(fs.existsSync(first.location),true);assert.equal(value.store.inspectAftercareWorkspaceLifecycle('case-1').registry.state,'active');
    const recovered=await value.store.reconcileAftercareWorkspaceLifecycle('case-1',{recoveryDecision:{kind:'resume'}});
    assert.equal(recovered.kind,'reclaimed');assert.equal(fs.existsSync(first.location),false);
    assert.deepEqual(recovered.receipt.reclaimedHandleIds,[first.handle.handleId,missing.handle.handleId].sort());
  } finally {value.close();}
});

test('reclaim rejects same-size content drift through the injected bounded fingerprint verifier', async () => {
  const value=fixture();try{
    const member=value.registerMember('drift.bin',Buffer.from('original'));value.store.terminateCase('case-1','resolved','test_resolved',digest('terminal-resolved'));value.commitInventory();value.setTime(10_000+RETENTION_MS);
    fs.writeFileSync(member.location,Buffer.from('modified'));
    await assert.rejects(value.store.reconcileAftercareWorkspaceLifecycle('case-1'),(error)=>error.code==='ARCA_AFTERCARE_WORKSPACE_MEMBER_CHANGED');
    assert.equal(fs.existsSync(member.location),true);assert.equal(value.store.inspectAftercareWorkspaceLifecycle('case-1').registry.state,'active');
  } finally {value.close();}
});

test('eligible lifecycle is admitted as formal care_workspace_reclaim Work with its exact Handle scope', async () => {
  const value=fixture();try{
    const member=value.registerMember('cleanup.bin');value.store.terminateCase('case-1','unresolved','test_unresolved',digest('terminal-unresolved'));value.setTime(10_000+RETENTION_MS);
    const reader={store:value.store,read(){return Object.freeze({shelfEntryId:'entry-1',basis:Object.freeze({digest:value.careBasis.digest})});}};
    const coordinator=createAftercareProcessCoordinator({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel:value.kernel}),contextReader:reader,
      workResultReader:Object.freeze({status(){return null;},read(){return [];}}),now:()=>10_000+RETENTION_MS});
    const admitted=coordinator.reconcileWorkspaceLifecycle('case-1');assert.equal(admitted.kind,'workspace_reclaim_pending');
    const row=value.database.prepare(`SELECT work_kind,definition_json FROM fx_supporting_works WHERE work_id=?`).get(admitted.workId),definition=JSON.parse(row.definition_json);
    assert.equal(row.work_kind,'care_workspace_reclaim');assert.deepEqual(definition.workspaceMaterialScope,[{
      handleSchemaRef:member.handle.schemaRef,handleId:member.handle.handleId,accessScope:member.handle.accessScope,fenceDigest:member.handle.fenceDigest,
    }]);assert.equal(definition.outputContractRef,'helix://contracts/types/ReclamationReceipt/v1');
    const blocked=await value.store.reconcileAftercareWorkspaceLifecycle('case-1');assert.equal(blocked.reasonCode,'active_work_reference');assert.equal(fs.existsSync(member.location),true);
    const reclaimed=await value.store.reconcileAftercareWorkspaceLifecycle('case-1',{currentWorkId:admitted.workId});assert.equal(reclaimed.kind,'reclaimed');assert.equal(reclaimed.receipt.receiptKind,'aftercare_workspace_reclaimed');
  } finally {value.close();}
});
