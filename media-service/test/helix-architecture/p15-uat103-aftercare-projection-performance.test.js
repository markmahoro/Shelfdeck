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
const { projectHealth } = require('../../src/helix/domains/arca/model/aftercare-contract');
const { LibraExecutionRegistration } = require('../../src/helix/domains/libra/public');
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

test('health reads exact live Care Basis, retains full history, and rejects changed Arca heads',()=>{
  sqliteFixture('uat318-current-care-basis-',({root,unitOfWork,seed,sqlTrace})=>{
    insertShelf(seed);const [id]=insertEntries(seed,1);
    seed.prepare('UPDATE arca_shelf_entries SET structure_kind=?').run('single');
    seed.prepare('UPDATE arca_canonical_identity_revisions SET identity_kind=?').run('tmdb_movie');
    seed.prepare('UPDATE arca_shelf_standard_revisions SET standard_json=?').run(JSON.stringify({profileRuleSets:[{contentProfile:'movie',decisionInputKinds:['rating']}]}));
    let ratingDigest=digest('first-rating');const returned=[];
    const measured={execute(parts){return unitOfWork.execute(parts.map(part=>({...part,execute(context){return part.execute({...context,
      repository(repositoryId){const repo=context.repository(repositoryId);return {...repo,invoke(name,params){const value=repo.invoke(name,params);
        if(['find_assessments','list_basis_assessments','find_findings'].includes(name))returned.push({name,count:value.length});return value;}};}});}})));}};
    const store=createAftercareStore({schemaManifest,unitOfWork:measured,aftercareWorkspaceRoot:path.join(root,'workspace')});
    const reader=createAftercareContextReader({aftercareStore:store,readPerceptionRatings:()=>new Map([[id,{state:'ready',resolutionDigest:ratingDigest}]])});
    const first=reader.healthProjectionInputs([id])[0],insert=seed.prepare(`INSERT INTO arca_aftercare_assessments
      (assessment_id,shelf_entry_id,inventory_revision,standard_revision,placement_revision,decision_fact_set_digest,care_basis_digest,assessment_kind,result,incident_key,evidence_digest,assessed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),finding=seed.prepare(`INSERT INTO arca_aftercare_findings
      (finding_id,assessment_id,finding_kind,severity,repairability,finding_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?)`);
    seed.transaction(()=>{
      for(let i=0;i<1000;i++){
        insert.run('old-'+i,id,1,1,1,digest('old-decision'),digest('old-basis-'+i),'presentation','degraded',null,digest('old-evidence'),i+1);
        finding.run('old-finding-'+i,'old-'+i,'presentation:poster_missing','warning','auto_repair',digest(i),'open',i+1);
      }
      for(const kind of ['custody','presentation','conformance'])insert.run(kind,id,1,1,1,first.basis.decisionFactSetDigest,first.basis.digest,kind,'healthy',null,digest(kind),10);
    })();
    returned.length=0;sqlTrace.length=0;
    const current=reader.healthProjectionInputs([id])[0];
    assert.equal(current.history.assessments.length,3);assert.equal(current.history.findings.length,0);
    assert.deepEqual(returned.filter(item=>item.name==='list_basis_assessments'),[{name:'list_basis_assessments',count:3}]);
    assert.ok(!returned.some(item=>item.name==='find_assessments'));
    assert.ok(sqlTrace.some(sql=>sql.includes('FROM "arca_aftercare_assessments"')&&sql.includes('"care_basis_digest"=')));
    const full=store.history(id);assert.equal(full.assessments.length,1003);assert.equal(full.findings.length,1000);
    assert.deepEqual(projectHealth(current,current.history,10000),projectHealth(current,full,10000));
    assert.equal(projectHealth(current,current.history,10000).state,'healthy');
    insert.run('custody-new',id,1,1,1,first.basis.decisionFactSetDigest,first.basis.digest,'custody','degraded',null,digest('new-evidence'),20);
    finding.run('custody-new-finding','custody-new','custody:primary_missing','warning','attention_required',digest('new-finding'),'open',20);
    const reassessed=reader.healthProjectionInputs([id])[0];
    assert.equal(reassessed.history.assessments.length,4);
    assert.equal(store.history(id).assessments.length,1004);
    assert.equal(projectHealth(reassessed,reassessed.history,10000).state,'attention_required');
    assert.deepEqual(projectHealth(reassessed,reassessed.history,10000),projectHealth(reassessed,store.history(id),10000));
    ratingDigest=digest('changed-rating');const changed=reader.healthProjectionInputs([id])[0];
    assert.notEqual(changed.basis.digest,current.basis.digest);assert.equal(changed.history.assessments.length,0);
    assert.deepEqual(projectHealth(changed,changed.history,10000),projectHealth(changed,full,10000));
    const scope={shelfEntryId:id,careBasisDigest:current.basis.digest,inventoryRevision:1,canonicalIdentityRevision:1,standardRevision:1,placementRevision:1};
    for(const [table,column] of [['arca_shelf_entries','current_inventory_revision'],['arca_shelf_entries','canonical_identity_revision'],['arca_shelves','current_standard_revision'],['arca_shelves','current_placement_revision']]){
      seed.prepare('UPDATE '+table+' SET '+column+'=2').run();
      assert.throws(()=>store.healthAssessmentHistory([scope]),{code:'ARCA_AFTERCARE_HEALTH_BASIS_STALE'});
      seed.prepare('UPDATE '+table+' SET '+column+'=1').run();
    }
    seed.prepare('UPDATE arca_shelf_entries SET status=?').run('offdecked');
    assert.throws(()=>store.healthAssessmentHistory([scope]),{code:'ARCA_AFTERCARE_HEALTH_BASIS_STALE'});
  });
});

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
    seed.prepare('UPDATE arca_shelf_entries SET structure_kind=? WHERE shelf_entry_id=?').run('season',ids[0]);
    seed.prepare(`INSERT INTO arca_inventory_product_facts
      (shelf_entry_id,inventory_revision,fact_kind,fact_revision,fact_schema_ref,fact_json,fact_digest,source_package_id,provenance_digest,committed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(ids[0],1,'product_metadata',1,'helix://test/metadata',
        JSON.stringify({descriptiveFacts:{entries:[{key:'series_title',value:'Demo Show'}]}}),digest('series-metadata'),'package-'+ids[0],digest('provenance'),1);

    const store = createAftercareStore({ schemaManifest, unitOfWork, now:() => 10_000,
      aftercareWorkspaceRoot:path.join(root, 'aftercare-workspaces') });
    const projected = store.healthProjectionInputs(ids);
    assert.equal(projected.length, ids.length);
    assert.equal(projected.find(item=>item.shelfEntryId===ids[0]).ratingTarget.title,'Demo Show');
    assert.deepEqual(projected.map((item) => item.shelfEntryId).sort(), [...ids].sort());
    for(const table of ['arca_shelf_entries','arca_canonical_identity_revisions','arca_inventory_representations',
      'arca_inventory_product_facts','arca_aftercare_assessments','arca_aftercare_cases']){
      const reads=sqlTrace.filter((sql)=>/^SELECT\b/i.test(sql.trim())&&sql.includes('FROM "'+table+'"'));
      assert.ok(reads.length>=1,table+' must be read for the health batch.');
      assert.ok(reads.every((sql)=>/\bIN\s*\(/i.test(sql)),table+' must not be loaded as an unbounded historical table.');
    }
    const scoped=store.healthAssessmentHistory(projected.map(item=>({shelfEntryId:item.shelfEntryId,
      careBasisDigest:digest(item.shelfEntryId),inventoryRevision:item.inventoryRevision,
      canonicalIdentityRevision:Number(item.canonicalIdentity.revision),standardRevision:item.standardRevision,
      placementRevision:item.placementRevision})));
    assert.equal(scoped.size,501);
    assert.ok([...scoped.values()].every(item=>item.assessments.length===0&&item.findings.length===0));
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

test('health projection reads only each active Entry current Inventory facts, representations and roles across bounded chunks', () => {
  sqliteFixture('uat318-current-inventory-facts-', ({ root, unitOfWork, seed, sqlTrace }) => {
    insertShelf(seed);
    const ids=insertEntries(seed,503),second=ids[501],inactive=ids[502];
    seed.prepare('INSERT INTO arca_inventory_representations SELECT shelf_entry_id,2,representation_digest,source_package_id,committed_at_ms FROM arca_inventory_representations WHERE shelf_entry_id=?').run(second);
    seed.prepare('UPDATE arca_shelf_entries SET current_inventory_revision=2 WHERE shelf_entry_id=?').run(second);
    seed.prepare('UPDATE arca_shelf_entries SET status=? WHERE shelf_entry_id=?').run('offdecked',inactive);
    const fact=seed.prepare(`INSERT INTO arca_inventory_product_facts
      (shelf_entry_id,inventory_revision,fact_kind,fact_revision,fact_schema_ref,fact_json,fact_digest,source_package_id,provenance_digest,committed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const material=seed.prepare(`INSERT INTO arca_inventory_materials
      (shelf_entry_id,inventory_revision,ordinal,material_key,role,active_guard) VALUES (?,?,?,?,?,0)`);
    for(const id of ids){
      seed.prepare('INSERT INTO arca_inventory_representations SELECT shelf_entry_id,9,representation_digest,source_package_id,committed_at_ms FROM arca_inventory_representations WHERE shelf_entry_id=? AND revision=1').run(id);
      material.run(id,1,0,digest(id+':primary'),'primary_payload');
      material.run(id,9,0,digest(id+':old-poster'),'poster');
      fact.run(id,1,'product_metadata',1,'helix://test/metadata',JSON.stringify({descriptiveFacts:{entries:[{key:'title',value:'current:'+id}]}}),digest(id),'package-'+id,digest('provenance'),1);
      fact.run(id,9,'product_metadata',1,'helix://test/metadata','{}',digest('historical:'+id),'package-'+id,digest('provenance'),1);
    }
    material.run(second,2,0,digest(second+':nfo'),'metadata_sidecar');
    fact.run(second,2,'product_metadata',1,'helix://test/metadata',JSON.stringify({descriptiveFacts:{entries:[{key:'title',value:'revision-two'}]}}),digest('revision-two'),'package-'+second,digest('provenance'),1);
    const returned=[];
    const measuredUnitOfWork={execute(parts){return unitOfWork.execute(parts.map(part=>({...part,execute(context){return part.execute({...context,
      repository(id){const repo=context.repository(id);return {...repo,invoke(name,parameters){const value=repo.invoke(name,parameters);
        if(['find_inventories','find_material_roles'].includes(name))returned.push({name,rows:value.length});return value;}};}});}})));}};
    const store=createAftercareStore({schemaManifest,unitOfWork:measuredUnitOfWork,now:()=>10_000,aftercareWorkspaceRoot:path.join(root,'aftercare-workspaces')});
    sqlTrace.length=0;
    const projected=store.healthProjectionInputs(ids);
    assert.equal(projected.length,502);
    assert.equal(projected.find(item=>item.shelfEntryId===second).ratingTarget.title,'revision-two');
    assert.equal(projected.find(item=>item.shelfEntryId===ids[500]).ratingTarget.title,'current:'+ids[500]);
    assert.deepEqual(projected.find(item=>item.shelfEntryId===second).materialRoles,['metadata_sidecar']);
    assert.deepEqual(projected.find(item=>item.shelfEntryId===ids[500]).materialRoles,['primary_payload']);
    for(const name of ['find_inventories','find_material_roles'])assert.equal(returned.filter(row=>row.name===name).reduce((sum,row)=>sum+row.rows,0),502);
    for(const [table,column] of [['arca_inventory_representations','revision'],['arca_inventory_materials','inventory_revision']]){
      const scoped=sqlTrace.filter(sql=>/^SELECT\b/i.test(sql.trim())&&sql.includes('FROM "'+table+'"'));
      assert.equal(scoped.length,3);assert.ok(scoped.every(sql=>sql.includes('"'+column+'"=')&&/\bIN\s*\(/i.test(sql)));
      assert.ok(scoped.every(sql=>!sql.includes("'"+inactive+"'")));
    }
    const reads=sqlTrace.filter(sql=>/^SELECT\b/i.test(sql.trim())&&sql.includes('FROM "arca_inventory_product_facts"'));
    assert.equal(reads.length,3);
    assert.ok(reads.every(sql=>/"inventory_revision"=/.test(sql)&&/\bIN\s*\(/i.test(sql)));
    assert.ok(reads.every(sql=>!sql.includes("'"+inactive+"'")));
    seed.prepare('DELETE FROM arca_inventory_product_facts WHERE shelf_entry_id=? AND inventory_revision=2').run(second);
    assert.equal(store.healthProjectionInputs([second])[0].ratingTarget.title,'502');
  });
});

test('Aftercare batch health passes frozen rating targets instead of triggering per-Entry target projection', () => {
  const items=Array.from({ length:501 },(_,index)=>{
    const shelfEntryId='entry-'+String(index).padStart(5,'0'),targetBase={targetType:'shelf_entry',targetId:shelfEntryId,
      targetRevision:1,title:'Movie '+index,year:2000+(index%20),providerIdentity:'tmdb:'+String(index+1),
      canonicalIdentityDigest:digest('identity:'+shelfEntryId)};
    return Object.freeze({shelfEntryId,structureKind:'single',canonicalIdentity:Object.freeze({identity_kind:'tmdb_movie'}),inventoryRevision:1,standardRevision:1,placementRevision:1,
      canonicalIdentityDigest:targetBase.canonicalIdentityDigest,sourcePackageId:'package-'+shelfEntryId,
      standardValue:Object.freeze({profileRuleSets:Object.freeze([Object.freeze({contentProfile:'movie',decisionInputKinds:Object.freeze(['rating'])})])}),
      ratingTarget:Object.freeze({...targetBase,targetDigest:canonicalDigest(targetBase)}),factDigests:Object.freeze([]),
      decisionFactDigests:Object.freeze([]),history:Object.freeze({assessments:Object.freeze([]),findings:Object.freeze([]),cases:Object.freeze([]),commits:Object.freeze([])})});
  });
  let calls=0;
  const reader=createAftercareContextReader({aftercareStore:{healthAssessmentHistory:scopes=>new Map(scopes.map(scope=>[scope.shelfEntryId,{assessments:[],findings:[]}])),defectStore:{currentMany:()=>new Map()},healthProjectionInputs:(ids)=>{
    assert.deepEqual(ids,items.map((item)=>item.shelfEntryId));return items;
  }},buildRatingTargetIdentity:LibraExecutionRegistration.buildRatingTargetIdentity,
  readPerceptionRatings:(targets)=>{calls+=1;assert.equal(targets.length,501);
    assert.ok(targets.every((target)=>typeof target==='object'&&target.targetType==='shelf_entry'&&target.targetId));
    assert.ok(targets.every((target)=>target.title===target.title.toLowerCase()));
    assert.ok(targets.every((target)=>target.targetDigest===canonicalDigest(Object.fromEntries(
      Object.entries(target).filter(([key])=>key!=='targetDigest')))));
    return new Map(targets.map((target)=>[target.targetId,Object.freeze({state:'pending',resolutionDigest:'a'.repeat(64)})]));}});
  const projected=reader.healthProjectionInputs(items.map((item)=>item.shelfEntryId));
  assert.equal(projected.length,501);
  assert.equal(calls,1);
  assert.ok(projected.every((item)=>item.basis.decisionFactSetDigest===canonicalDigest({
    schema:'arca.aftercare-decision-facts@1',shelfEntryId:item.shelfEntryId,facts:[],
  })));
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

test('Collection recent browse maps and assesses only the bounded first page', () => {
  sqliteFixture('uat103-collection-page-', ({ unitOfWork, seed }) => {
    insertShelf(seed);
    insertEntries(seed, 17);
    let requestedIds = [];
    const collection = createArcaCollectionQuery({ schemaManifest, unitOfWork,
      posterReader:() => null,
      healthReaderMany:(requested) => {
        requestedIds = [...requested];
        return new Map(requested.map((id) => [id, Object.freeze({ state:'healthy' })]));
      },
    });
    const result = collection.list({ status:'current', sort:'recent', limit:'5' });
    assert.equal(result.items.length, 5);
    assert.equal(result.resultCount, 17);
    assert.equal(result.nextCursor, '5');
    assert.equal(requestedIds.length, 5);
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
  assert.match(source, /reconcilerKey:'active-subject-rating-resolutions'[\s\S]*?ensureTargetResolutions\('subject',subjectId\)/);
  assert.match(source, /reconcilerKey:'active-shelf-entry-rating-resolutions'[\s\S]*?aftercareContextReader\.listPage\(cursor,limit\)[\s\S]*?ensureTargetResolutions\('shelf_entry',shelfEntryId\)/);
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
