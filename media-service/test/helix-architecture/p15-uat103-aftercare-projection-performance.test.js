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
const { createArcaCareApplication } = require('../../src/helix/domains/arca/application/care-query');
const { createArcaCollectionQuery } = require('../../src/helix/domains/arca/application/collection-query');
const { createAftercareStore } = require('../../src/helix/domains/arca/persistence/aftercare-store');
const { createAftercareContextReader } = require('../../src/helix/domains/arca/application/aftercare-context-reader');
const { createCircuitBreaker } = require('../../src/helix/foundation/diagnostics/pressure-guard');
const { createExecutorIncidentRegistry } = require('../../src/helix/foundation/execution/executor-incident-registry');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const sourceRoot = path.resolve(__dirname, '../../src/helix');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const digest = (value) => canonicalDigest({ value });

function sqliteFixture(prefix, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(root, 'shelfdeck.db');
  const sqlTrace = [];
  function TracedDatabase(filename) {
    return new Database(filename, { verbose:(sql) => sqlTrace.push(sql) });
  }
  const kernel = openSqliteKernel({ Database:TracedDatabase, databasePath, schemaDdl, schemaManifest, now:() => 10_000 });
  try {
    const seed = new Database(databasePath);
    seed.pragma('foreign_keys = OFF');
    try { run({ root, databasePath, kernel, unitOfWork:createSqliteUnitOfWork({ kernel }), seed, sqlTrace }); }
    finally { seed.close(); }
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive:true, force:true });
  }
}

function insertShelf(seed) {
  seed.prepare(`INSERT INTO arca_shelf_standard_revisions
    (shelf_id,revision,rule_template_id,rule_template_revision,standard_schema_ref,standard_json,standard_digest,effective_at_ms)
    VALUES (?,?,?,?,?,?,?,?)`).run('shelf-1', 1, 'rule-1', 1,
    'helix://arca/types/ShelfStandard/v1', '{}', digest('standard'), 1);
  seed.prepare(`INSERT INTO arca_shelves
    (shelf_id,name,target_endpoint_id,target_root_location,target_mount_scope_id,target_mount_scope_revision,status,
     current_standard_revision,current_placement_revision,routing_projection_revision,routing_projection_digest,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('shelf-1', 'Shelf', 'endpoint-1', 'F:/uat103/shelf', 'mount-1', 1,
    'active', 1, 1, 1, digest('routing'), 1, 1);
}

function insertEntries(seed, count) {
  const identity = seed.prepare(`INSERT INTO arca_canonical_identity_revisions
    (shelf_entry_id,revision,structure_kind,identity_kind,provider,provider_key,identity_digest,committed_at_ms)
    VALUES (?,?,?,?,?,?,?,?)`);
  const inventory = seed.prepare(`INSERT INTO arca_inventory_representations
    (shelf_entry_id,revision,representation_digest,source_package_id,committed_at_ms) VALUES (?,?,?,?,?)`);
  const entry = seed.prepare(`INSERT INTO arca_shelf_entries
    (shelf_entry_id,shelf_id,structure_kind,status,canonical_identity_revision,canonical_identity_key,
     current_inventory_revision,current_deck_fact_revision,created_at_ms,terminal_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)`);
  const insert = seed.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const id = 'entry-' + String(index).padStart(5, '0');
      identity.run(id, 1, 'movie', 'provider_identity', 'tmdb', String(index + 1), digest('identity:' + id), 1);
      inventory.run(id, 1, digest('inventory:' + id), 'package-' + id, 1);
      entry.run(id, 'shelf-1', 'movie', 'active', 1, 'tmdb:' + String(index + 1), 1, 1, 1);
    }
  });
  insert();
  return Array.from({ length:count }, (_, index) => 'entry-' + String(index).padStart(5, '0'));
}

test('Care list and summaries use one batch projection without per-entry history reads', () => {
  const ids = ['entry-1', 'entry-2', 'entry-3'];
  let projectionCalls = 0;
  const history = () => { throw new Error('Care list must not read history per Shelf Entry.'); };
  const contextReader = {
    store:{ history },
    listPage(cursor) {
      if (cursor !== null) return [];
      return ids.map((shelfEntryId) => Object.freeze({ cursor:shelfEntryId, scope:Object.freeze({ shelfEntryId }) }));
    },
  };
  const coordinator = {
    projectMany(requested) {
      projectionCalls += 1;
      assert.deepEqual(requested, ids);
      return new Map(requested.map((shelfEntryId, index) => [shelfEntryId, Object.freeze({
        shelfEntryId,
        state:'observing',
        careBasisDigest:'basis-' + shelfEntryId,
        dimensions:Object.freeze({
          custody:Object.freeze({ incidentKey:index < 2 ? 'endpoint:shared' : null }),
          presentation:Object.freeze({ incidentKey:null }),
          conformance:Object.freeze({ incidentKey:null }),
        }),
      })]));
    },
  };
  const care = createArcaCareApplication({ contextReader, coordinator });
  const listed = care.list();
  assert.equal(projectionCalls, 1);
  assert.equal(listed.items.length, ids.length);
  assert.deepEqual(listed.incidents, [{ incidentKey:'endpoint:shared', affectedShelfEntryCount:2 }]);
  assert.equal(care.summaries(ids).size, ids.length);
  assert.equal(projectionCalls, 2);
});

test('Aftercare health projection preserves and scopes every requested Shelf Entry beyond the 500 item repository bound', () => {
  sqliteFixture('uat103-aftercare-501-', ({ root, unitOfWork, seed, sqlTrace }) => {
    insertShelf(seed);
    const ids = insertEntries(seed, 501);
    const store = createAftercareStore({ schemaManifest, unitOfWork, now:() => 10_000,
      aftercareWorkspaceRoot:path.join(root, 'aftercare-workspaces') });
    const projected = store.healthProjectionInputs(ids);
    assert.equal(projected.length, ids.length);
    assert.deepEqual(projected.map((item) => item.shelfEntryId).sort(), [...ids].sort());
    for(const table of ['arca_shelf_entries','arca_canonical_identity_revisions','arca_inventory_representations',
      'arca_inventory_product_facts','arca_aftercare_assessments','arca_aftercare_cases']){
      const reads=sqlTrace.filter((sql)=>/^SELECT\b/i.test(sql.trim())&&sql.includes('FROM "'+table+'"'));
      assert.ok(reads.length>=1,table+' must be read for the health batch.');
      assert.ok(reads.every((sql)=>/\bIN\s*\(/i.test(sql)),table+' must not be loaded as an unbounded historical table.');
    }
  });
});

test('single-Entry Aftercare history and terminal finding resolution never scan the global finding table', () => {
  sqliteFixture('uat103-aftercare-history-', ({ root, unitOfWork, seed, sqlTrace }) => {
    insertShelf(seed);
    const [entryId] = insertEntries(seed, 2);
    seed.prepare(`INSERT INTO arca_aftercare_assessments
      (assessment_id,shelf_entry_id,inventory_revision,standard_revision,placement_revision,
       decision_fact_set_digest,care_basis_digest,assessment_kind,result,incident_key,evidence_digest,assessed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('assessment-1', entryId, 1, 1, 1,
      digest('decision'), digest('basis'), 'presentation', 'degraded', null, digest('evidence'), 1);
    seed.prepare(`INSERT INTO arca_aftercare_findings
      (finding_id,assessment_id,finding_kind,severity,repairability,finding_digest,state,created_at_ms)
      VALUES (?,?,?,?,?,?,?,?)`).run('finding-1', 'assessment-1', 'presentation:nfo_missing',
      'warning', 'auto_repair', digest('finding'), 'open', 1);
    const store = createAftercareStore({ schemaManifest, unitOfWork, now:() => 10_000,
      aftercareWorkspaceRoot:path.join(root, 'aftercare-workspaces') });
    sqlTrace.length = 0;
    assert.equal(store.history(entryId).findings.length, 1);
    const reads = sqlTrace.filter((sql) => /^SELECT\b/i.test(sql.trim()) &&
      sql.includes('FROM "arca_aftercare_findings"'));
    assert.ok(reads.length >= 1);
    assert.ok(reads.every((sql) => /\bIN\s*\(/i.test(sql)),
      'Finding reads must be scoped to the selected Assessment ids.');
  });
});

test('Aftercare batch health passes frozen rating targets instead of triggering per-Entry target projection', () => {
  const items=Array.from({ length:501 },(_,index)=>{
    const shelfEntryId='entry-'+String(index).padStart(5,'0'),targetBase={targetType:'shelf_entry',targetId:shelfEntryId,
      targetRevision:1,title:'Movie '+index,year:2000+(index%20),providerIdentity:'tmdb:'+String(index+1),
      canonicalIdentityDigest:digest('identity:'+shelfEntryId)};
    return Object.freeze({shelfEntryId,structureKind:'movie',inventoryRevision:1,standardRevision:1,placementRevision:1,
      canonicalIdentityDigest:targetBase.canonicalIdentityDigest,sourcePackageId:'package-'+shelfEntryId,
      standardValue:Object.freeze({profileRuleSets:Object.freeze([Object.freeze({contentProfile:'movie',decisionInputKinds:Object.freeze(['rating'])})])}),
      ratingTarget:Object.freeze({...targetBase,targetDigest:canonicalDigest(targetBase)}),factDigests:Object.freeze([]),
      decisionFactDigests:Object.freeze([]),history:Object.freeze({assessments:Object.freeze([]),findings:Object.freeze([]),cases:Object.freeze([]),commits:Object.freeze([])})});
  });
  let calls=0;
  const reader=createAftercareContextReader({aftercareStore:{healthProjectionInputs:(ids)=>{
    assert.deepEqual(ids,items.map((item)=>item.shelfEntryId));return items;
  }},readPerceptionRatings:(targets)=>{calls+=1;assert.equal(targets.length,501);
    assert.ok(targets.every((target)=>typeof target==='object'&&target.targetType==='shelf_entry'&&target.targetId));
    return new Map(targets.map((target)=>[target.targetId,Object.freeze({state:'pending',resolutionDigest:null})]));}});
  const projected=reader.healthProjectionInputs(items.map((item)=>item.shelfEntryId));
  assert.equal(projected.length,501);
  assert.equal(calls,1);
});

test('Collection list scopes identity, facts, people, and materials to the selected Entry batch', () => {
  sqliteFixture('uat103-collection-batch-', ({ unitOfWork, seed, sqlTrace }) => {
    insertShelf(seed);
    const ids = insertEntries(seed, 17);
    sqlTrace.length = 0;
    const collection = createArcaCollectionQuery({ schemaManifest, unitOfWork,
      posterReader:() => null,
      healthReaderMany:(requested) => {
        assert.deepEqual(requested.sort(), [...ids].sort());
        return new Map(requested.map((id) => [id, Object.freeze({ state:'healthy' })]));
      },
    });
    const result = collection.list({ status:'current' });
    assert.equal(result.items.length, ids.length);
    const tableReads = (table) => sqlTrace.filter((sql) =>
      /^SELECT\b/i.test(sql.trim()) && sql.includes('FROM "' + table + '"')).length;
    const tableSql = (table) => sqlTrace.filter((sql) =>
      /^SELECT\b/i.test(sql.trim()) && sql.includes('FROM "' + table + '"'));
    assert.equal(tableReads('arca_canonical_identity_revisions'), 1, 'Identity reads must not grow with Entry count.');
    assert.equal(tableReads('arca_inventory_product_facts'), 1, 'Fact reads must not grow with Entry count.');
    assert.equal(tableReads('arca_inventory_person_relations'), 1, 'People reads must not grow with Entry count.');
    assert.equal(tableReads('arca_inventory_materials'), 1, 'Material reads must not grow with Entry count.');
    for(const table of ['arca_canonical_identity_revisions','arca_inventory_product_facts','arca_inventory_person_relations','arca_inventory_materials']){
      assert.match(tableSql(table)[0],/\bIN\s*\(/i,table+' must use a bounded Entry-id set instead of loading the whole historical table.');
    }
  });
});

test('Douban terminal completion leaves fan-out to durable Subject and Shelf Entry reconcile cursors', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  const terminalStart = source.indexOf("if(request.ownerDomain==='perception'&&request.processType==='perception_acquisition')");
  const terminalEnd = source.indexOf("if(request.ownerDomain==='perception'&&request.processType==='perception_resolution')", terminalStart);
  assert.ok(terminalStart >= 0 && terminalEnd > terminalStart, 'Perception acquisition terminal handler is absent.');
  const terminalHandler = source.slice(terminalStart, terminalEnd);
  assert.doesNotMatch(terminalHandler, /reconcileImpactedSubjectResolutions\s*\(/,
    'Terminal completion must not synchronously scan every Subject.');
  assert.match(source, /reconcilerKey:'active-subject-rating-resolutions'[\s\S]*?ensureResolution\('subject',subjectId\)/);
  assert.match(source, /reconcilerKey:'active-shelf-entry-rating-resolutions'[\s\S]*?aftercareContextReader\.listPage\(cursor,limit\)[\s\S]*?ensureResolution\('shelf_entry',shelfEntryId\)/);
  const runnerStart = source.indexOf('createDomainReconcileRunner({cursorStore');
  const shelfRunner = source.indexOf("reconcilerKey:'active-shelf-entry-rating-resolutions'");
  assert.ok(runnerStart >= 0 && shelfRunner > runnerStart,
    'Shelf Entry rating fan-out must be registered behind the durable Foundation cursor store.');
});

test('Provider, Endpoint, and Workspace incidents isolate exact resource Circuits', () => {
  sqliteFixture('uat103-resource-incidents-',({unitOfWork})=>{
    const breaker=createCircuitBreaker({schemaManifest,unitOfWork}),incidents=createExecutorIncidentRegistry({schemaManifest,unitOfWork,
      circuitBreaker:breaker,now:()=>10_000}),base={ownerDomain:'arca',processType:'arca_shelf_entry',workKind:'care_repair_prepare',
      errorCode:'PLATFORM_INTEGRATION_NETWORK_FAILED'};
    const pairs=[
      ['provider','integration/tmdb-main@3','integration/tmdb-backup@1'],
      ['endpoint','endpoint/shelf-a/mount-a@1','endpoint/shelf-b/mount-b@4'],
      ['workspace','workspace/aftercare-a/workspace-a@2','workspace/aftercare-b/workspace-b@7'],
    ];
    for(const [kind,left,right] of pairs){
      const first={...base,resourceKey:left,occurrenceId:kind+'-left-1'};
      assert.equal(incidents.recordFailure(first).occurrenceCount,1);
      assert.equal(incidents.recordFailure(first).occurrenceCount,1);
      const second=incidents.recordFailure({...base,resourceKey:left,occurrenceId:kind+'-left-2'}),
        third=incidents.recordFailure({...base,resourceKey:left,occurrenceId:kind+'-left-3'});
      assert.equal(second.occurrenceCount,2);assert.equal(third.occurrenceCount,3);
      assert.equal(incidents.scopeStatus({...base,resourceKey:left}).blocked,true);
      assert.equal(incidents.scopeStatus({...base,resourceKey:right}).blocked,false);
      let rightIncident;for(let ordinal=1;ordinal<=3;ordinal+=1)rightIncident=incidents.recordFailure({...base,
        resourceKey:right,occurrenceId:kind+'-right-'+ordinal});
      assert.notEqual(third.circuitKey,rightIncident.circuitKey);
      incidents.beginRecovery(third.incidentKey);incidents.resolve(third.incidentKey,digest(kind+'-left-recovered'));
      assert.equal(incidents.scopeStatus({...base,resourceKey:left}).blocked,false);
      assert.equal(incidents.scopeStatus({...base,resourceKey:right}).blocked,true);
    }
  });
});
