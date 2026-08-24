'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createAftercareStore } = require('../../src/helix/domains/arca/persistence/aftercare-store');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const digest = (value) => canonicalDigest({ value });

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aftercare-case-generation-')),databasePath=path.join(root,'shelfdeck.db');
  let at=10_000;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>at}),seed=new Database(databasePath);
  seed.pragma('foreign_keys = OFF');
  seed.prepare(`INSERT INTO arca_shelves (shelf_id,name,target_endpoint_id,target_root_location,target_mount_scope_id,
    target_mount_scope_revision,status,current_standard_revision,current_placement_revision,routing_projection_revision,
    routing_projection_digest,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('shelf-1','Shelf','endpoint-1','F:/shelf','mount-f',1,'active',1,1,1,digest('routing'),at,at);
  seed.prepare(`INSERT INTO arca_shelf_entries (shelf_entry_id,shelf_id,structure_kind,status,canonical_identity_revision,
    canonical_identity_key,current_inventory_revision,current_deck_fact_revision,created_at_ms,terminal_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)`).run('entry-1','shelf-1','movie','active',1,'tmdb:1',1,1,at);
  seed.close();
  const store=createAftercareStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),now:()=>at,
    aftercareWorkspaceRoot:path.join(root,'aftercare')});
  const careBasis={schemaRef:'helix://contracts/domain-types/CareBasis/v1',schemaVersion:1,inventoryRevision:1,
    standardRevision:1,placementRevision:1,canonicalIdentityDigest:digest('identity'),sourcePackageId:'package-1',
    acceptedProductFactSetDigest:digest('facts'),decisionFactSetDigest:digest('decisions')};
  careBasis.digest=canonicalDigest(careBasis);
  const careRequirement={schemaRef:'helix://contracts/domain-types/CareRequirement/v1',schemaVersion:1,
    requirementId:'requirement-1',revision:1,careBasisDigest:careBasis.digest,requiredEffects:[],
    acceptanceDigest:digest('acceptance'),typedParameters:[]};
  careRequirement.digest=canonicalDigest(careRequirement);
  const request=(triggerLabel)=>({shelfEntryId:'entry-1',careBasis,findingSetDigest:digest('findings'),careRequirement,
    triggerDigest:digest(triggerLabel),basisInputs:[{inputKind:'health_assessment_work',ownerDomain:'arca',
      aggregateType:'supporting_work',aggregateId:'assessment-'+triggerLabel,revision:1,inputDigest:careBasis.digest}]});
  return {root,kernel,store,request,setTime(value){at=value;},close(){kernel.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('terminal Case preserves exact reason and Evidence and replays idempotently', () => {
  const value=fixture();
  try {
    const created=value.store.createCase(value.request('trigger-1'));
    assert.equal(created.caseGeneration,1);
    value.setTime(20_000);
    const evidence=digest('terminal-evidence');
    const terminal=value.store.terminateCase(created.aftercareCaseId,'unresolved','repair_preparation_exhausted',evidence);
    assert.equal(terminal.terminalReasonCode,'repair_preparation_exhausted');
    assert.equal(terminal.terminalEvidenceDigest,evidence);
    assert.deepEqual(value.store.terminateCase(created.aftercareCaseId,'unresolved','repair_preparation_exhausted',evidence),terminal);
    assert.throws(()=>value.store.terminateCase(created.aftercareCaseId,'unresolved','different_reason',evidence),
      (error)=>error.code==='ARCA_AFTERCARE_CASE_CAS');
    const replay=value.store.createCase(value.request('trigger-1'));
    assert.equal(replay.aftercareCaseId,created.aftercareCaseId);
    assert.equal(replay.state,'unresolved');
    assert.equal(value.store.history('entry-1').cases.length,1);
  } finally { value.close(); }
});

test('a new Assessment trigger creates the next Case generation on the same Care Basis', () => {
  const value=fixture();
  try {
    const first=value.store.createCase(value.request('trigger-1'));
    value.store.terminateCase(first.aftercareCaseId,'invalidated','care_basis_changed',digest('terminal-1'));
    const second=value.store.createCase(value.request('trigger-2'));
    assert.equal(second.state,'active');
    assert.equal(second.caseGeneration,2);
    assert.notEqual(second.aftercareCaseId,first.aftercareCaseId);
    assert.notEqual(second.triggerDigest,first.triggerDigest);
    assert.deepEqual(value.store.history('entry-1').cases.map((item)=>item.caseGeneration),[1,2]);
  } finally { value.close(); }
});

