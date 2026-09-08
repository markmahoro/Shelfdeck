'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createAftercareStore}=require('../../src/helix/domains/arca/persistence/aftercare-store');
const {createInventoryRecordRefresh}=require('../../src/helix/domains/arca/application/inventory-record-refresh');
const {observedIdentity}=require('../../src/helix/domains/arca/model/known-old-binding');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const digest=value=>canonicalDigest({value});

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'inventory-record-refresh-')),databasePath=path.join(root,'test.db'),
    kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>10000}),db=new Database(databasePath),
    options={schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),aftercareWorkspaceRoot:path.join(root,'workspace'),now:()=>10000};
  db.pragma('foreign_keys = OFF');
  const insert=(table,row)=>db.prepare(`INSERT INTO "${table}" (${Object.keys(row).map(key=>`"${key}"`).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  insert('arca_shelves',{shelf_id:'shelf',status:'active',current_standard_revision:1,current_placement_revision:1});
  insert('arca_shelf_entries',{shelf_entry_id:'entry',shelf_id:'shelf',status:'active',structure_kind:'movie',canonical_identity_revision:1,current_inventory_revision:1,current_deck_fact_revision:1});
  insert('arca_inventory_representations',{shelf_entry_id:'entry',revision:1,representation_digest:digest('inventory'),source_package_id:'package',committed_at_ms:1});
  const locations=[path.join(root,'movie.mkv'),path.join(root,'movie.nfo')];
  locations.forEach((location,index)=>fs.writeFileSync(location,index?'old NFO':'original movie bytes'));
  const materials=locations.map((location,ordinal)=>{
    const identity=observedIdentity(location,'mount',computeBoundedMaterialFingerprintSync),role=ordinal?'metadata_sidecar':'primary_payload',
      row={shelf_entry_id:'entry',inventory_revision:1,ordinal,role,material_key:identity.materialKey,endpoint_id:'endpoint',location,
        binding_revision:1,mount_scope_id:'mount',inode:identity.inode,fingerprint_algorithm:identity.fingerprintAlgorithm,
        fingerprint_version:String(identity.fingerprintVersion),content_fingerprint:identity.contentFingerprint,size_bytes:identity.sizeBytes,
        digest_hex:digest('file-'+ordinal),episode_claims_schema_ref:'claims',episode_claims_json:'[]',episode_claim_set_digest:digest('claims'),active_guard:ordinal?0:1};
    insert('arca_inventory_materials',row);
    insert('fx_material_controls',{material_key:identity.materialKey,mount_scope_id:'mount',inode:identity.inode,size_bytes:identity.sizeBytes,
      fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:String(identity.fingerprintVersion),content_fingerprint:identity.contentFingerprint,
      owner_domain:'arca',owner_scope_type:'shelf_entry',owner_scope_id:'entry',control_revision:1,state:'controlled',updated_at_ms:1});
    return row;
  });
  fs.writeFileSync(locations[1],'externally updated NFO bytes');
  const store=createAftercareStore(options),contextReader={store},service=createInventoryRecordRefresh({...options,contextReader,computeBoundedMaterialFingerprintSync}),
    context=()=>({shelfEntryId:'entry',basis:{digest:digest('basis'),acceptedProductFactSetDigest:digest('facts')},raw:{
      entry:db.prepare('SELECT * FROM arca_shelf_entries WHERE shelf_entry_id=?').get('entry'),
      shelf:db.prepare('SELECT * FROM arca_shelves WHERE shelf_id=?').get('shelf'),
      inventory:db.prepare('SELECT * FROM arca_inventory_representations WHERE shelf_entry_id=? ORDER BY revision DESC').get('entry'),
      materials:db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=(SELECT current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?) ORDER BY ordinal').all('entry','entry'),reservations:[],
    }});
  return {db,store,service,context,materials,locations,insert,
    makeService:read=>createInventoryRecordRefresh({...options,contextReader,computeBoundedMaterialFingerprintSync:read}),
    close(){db.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('NFO record refresh atomically updates Inventory and Control without a Case, Work, or file write',()=>{
  const value=fixture();try{
    value.insert('arca_inventory_product_facts',{shelf_entry_id:'entry',inventory_revision:1,fact_kind:'media_cast',fact_revision:1,
      fact_schema_ref:'helix://contracts/types/MediaCast/v1',fact_json:'{"relations":[{"displayName":"Original Actor"}]}',
      fact_digest:digest('accepted-cast'),source_package_id:'package',provenance_digest:digest('accepted-origin'),committed_at_ms:1});
    value.insert('arca_inventory_person_relations',{shelf_entry_id:'entry',inventory_revision:1,relation_id:'original-relation',
      person_id:'original-person',display_name:'Original Actor',display_name_normalized:'original actor',role:'actor',
      relation_source:'accepted_product',provider_identity_schema_ref:'identities',provider_identity_json:'[]',
      provider_identity_digest:digest('identities'),origin_evidence_digest:digest('accepted-origin'),confidence_class:'confirmed',relation_digest:digest('relation')});
    const original=fs.readFileSync(value.locations[0]),nfo=fs.readFileSync(value.locations[1]),frozen=value.context(),result=value.service.refresh(frozen);
    assert.equal(result.kind,'inventory_records_refreshed');
    assert.equal(result.receipt.newInventoryRevision,2);
    for(const table of ['arca_inventory_product_facts','arca_inventory_person_relations']){
      const normalize=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['inventory_revision','committed_at_ms'].includes(key)));
      const before=value.db.prepare(`SELECT * FROM ${table} WHERE inventory_revision=1`).get();
      const after=value.db.prepare(`SELECT * FROM ${table} WHERE inventory_revision=2`).get();
      assert.deepEqual(normalize(after),normalize(before),table);
    }
    assert.equal(value.db.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,0);
    assert.equal(value.db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
    assert.equal(value.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,1);
    assert.equal(value.db.prepare('SELECT state FROM fx_material_controls WHERE material_key=?').get(value.materials[1].material_key).state,'released');
    assert.equal(value.db.prepare("SELECT count(*) n FROM fx_material_controls WHERE state='controlled'").get().n,2);
    assert.deepEqual(fs.readFileSync(value.locations[0]),original);
    assert.deepEqual(fs.readFileSync(value.locations[1]),nfo);
    const replay=value.service.refresh(frozen);
    assert.equal(replay.replayed,true);
    assert.deepEqual(replay.receipt,result.receipt);
    assert.equal(value.service.refresh(value.context()).kind,'records_unchanged');
    assert.equal(value.db.prepare('SELECT count(*) n FROM arca_inventory_representations').get().n,2);
  }finally{value.close();}
});

test('Control conflict rolls back the new Inventory, receipt, marker, and audit together',()=>{
  const value=fixture();try{
    value.db.prepare('UPDATE fx_material_controls SET owner_domain=? WHERE material_key=?').run('libra',value.materials[1].material_key);
    assert.throws(()=>value.service.refresh(value.context()),error=>error.code==='P3_CONTROL_FROM_SCOPE_MISMATCH');
    assert.equal(value.db.prepare('SELECT current_inventory_revision revision FROM arca_shelf_entries').get().revision,1);
    for(const table of ['fx_command_receipts','fx_commit_markers','fx_audit_records'])assert.equal(value.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
    assert.equal(value.db.prepare('SELECT count(*) n FROM arca_inventory_representations').get().n,1);
  }finally{value.close();}
});

test('an external write between observation and commit leaves no partial record refresh',()=>{
  const value=fixture();try{
    let reads=0;
    const service=value.makeService((location,limit)=>{
      if(++reads===2)fs.writeFileSync(location,'another external writer update');
      return computeBoundedMaterialFingerprintSync(location,limit);
    });
    assert.throws(()=>service.refresh(value.context()),error=>error.code==='ARCA_RECORD_REFRESH_OBSERVATION_STALE');
    assert.equal(value.db.prepare('SELECT current_inventory_revision revision FROM arca_shelf_entries').get().revision,1);
    assert.equal(value.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,0);
    assert.equal(value.db.prepare('SELECT state FROM fx_material_controls WHERE material_key=?').get(value.materials[1].material_key).state,'controlled');
  }finally{value.close();}
});

test('active Case and concurrent Off-deck reservation both prevent record refresh',()=>{
  const value=fixture();try{
    value.insert('arca_aftercare_cases',{aftercare_case_id:'case',shelf_entry_id:'entry',finding_set_digest:digest('findings'),
      care_basis_schema_ref:'basis',care_basis_json:'{}',care_basis_digest:digest('basis'),care_requirement_schema_ref:'requirement',
      care_requirement_json:'{}',care_requirement_digest:digest('requirement'),case_generation:1,trigger_digest:digest('trigger'),state:'active',created_at_ms:1});
    assert.deepEqual(value.service.refresh(value.context()),{kind:'records_deferred',reasonCode:'active_modification'});
    value.db.prepare("UPDATE arca_aftercare_cases SET state='resolved',terminal_at_ms=2 WHERE aftercare_case_id='case'").run();
    value.insert('arca_offdeck_reservations',{reservation_id:'reservation',shelf_entry_id:'entry',state:'active',inventory_revision:1,created_at_ms:1});
    assert.throws(()=>value.service.refresh(value.context()),error=>error.code==='ARCA_RECORD_REFRESH_FENCED');
    assert.equal(value.db.prepare('SELECT current_inventory_revision revision FROM arca_shelf_entries').get().revision,1);
    assert.equal(value.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,0);
  }finally{value.close();}
});

test('large readable NFO refresh stays within the fingerprint budget and never creates repair work',()=>{
  const value=fixture();try{
    const bytes=Buffer.from('<movie><plot>'+ 'x'.repeat(1024*1024) +'</plot></movie>');
    fs.writeFileSync(value.locations[1],bytes);
    const reads=[];
    const service=value.makeService((location,options)=>{
      let sampled=0;
      const result=computeBoundedMaterialFingerprintSync(location,{...options,onRead:read=>{sampled+=read.bytesRead;}});
      reads.push(sampled);return result;
    });
    assert.equal(service.refresh(value.context()).kind,'inventory_records_refreshed');
    assert.deepEqual(reads,[256*1024,256*1024]);
    assert.equal(value.service.refresh(value.context()).kind,'records_unchanged');
    assert.deepEqual(fs.readFileSync(value.locations[1]),bytes);
    for(const table of ['arca_aftercare_cases','fx_supporting_works'])assert.equal(value.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  }finally{value.close();}
});

test('same-size concurrent writes during bounded observation cannot commit records',()=>{
  const value=fixture();try{
    const service=value.makeService((location,options)=>computeBoundedMaterialFingerprintSync(location,{
      ...options,onRead(){const stat=fs.statSync(location);fs.utimesSync(location,stat.atime,new Date(stat.mtimeMs+10000));},
    }));
    assert.deepEqual(service.refresh(value.context()),{kind:'records_deferred',reasonCode:'PHYSICAL_MATERIAL_STAT_FENCE_CHANGED'});
    assert.equal(value.db.prepare('SELECT current_inventory_revision revision FROM arca_shelf_entries').get().revision,1);
    assert.equal(value.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,0);
  }finally{value.close();}
});
