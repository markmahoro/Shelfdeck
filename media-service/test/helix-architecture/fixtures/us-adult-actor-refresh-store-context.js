'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {extractSsotContracts}=require('../../../scripts/helix-architecture/ssot-contract-extractor');
const {buildTableContracts}=require('../../../scripts/helix-architecture/table-contract-builder');
const {compileSchema}=require('../../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {buildDomainInputSchemas}=require('../../../scripts/helix-architecture/domain-input-schema-builder');
const {canonicalDigest:D,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {fixture:inventoryContext}=require('./us-adult-inventory-context');
const {initialReference}=require('./us-adult-initial-reference');
const compiled=compileSchema(buildTableContracts(extractSsotContracts(fs.readFileSync(
  path.resolve(__dirname,'../../../../docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'),'utf8')).tables));
const schemas=buildDomainInputSchemas(),contractValidator=createCapabilityContractValidator({schemas:
  ['UsAdultActorRefreshIntent','UsAdultPersonSnapshot','PersonReferenceProjection','PeopleReferenceLibraryPage','FaceModelRef','CareRequirement'].map(name=>schemas[name])});

// This is an Owner transaction fixture compiled from the current SSOT. It is
// neither an Arca media execution Host nor a production data upgrade proof.
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-actor-intent-store-')),databasePath=path.join(root,'shelfdeck.db'),
    context=inventoryContext(),options={Database,databasePath,schemaDdl:compiled.ddl,schemaManifest:compiled.manifest,now:()=>10000};
  let kernel=openSqliteKernel(options),unitOfWork=createSqliteUnitOfWork({kernel});
  const db=new Database(databasePath);db.pragma('foreign_keys=OFF');
  t.after(()=>{db.close();kernel.close();if(path.dirname(fs.realpathSync(root))!==fs.realpathSync(os.tmpdir()))throw new Error('Fixture escapes temp.');fs.rmSync(root,{recursive:true,force:true});});
  Object.assign(context.raw.entry,{shelf_id:'shelf',created_at_ms:10000,terminal_at_ms:null});
  Object.assign(context.raw.shelf,{shelf_id:'shelf',current_standard_revision:1,current_placement_revision:1});
  const tuple={mountScopeId:'mount',inode:'1',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('video')};
  context.raw.materials=[{role:'primary_payload',material_key:D({schema:'physical-material-identity@2',...tuple}),mount_scope_id:tuple.mountScopeId,inode:tuple.inode,
    size_bytes:tuple.sizeBytes,fingerprint_algorithm:tuple.fingerprintAlgorithm,fingerprint_version:tuple.fingerprintVersion,content_fingerprint:tuple.contentFingerprint,
    endpoint_id:'endpoint',location:path.join(root,'owned-video.mkv'),binding_revision:3}];
  const basis={schemaRef:'helix://contracts/domain-types/CareBasis/v1',schemaVersion:1,objectId:'entry:care-basis',revision:1,shelfEntryId:'entry',
    inventoryRevision:2,standardRevision:1,placementRevision:1,canonicalIdentityDigest:context.raw.identity.identity_digest,sourcePackageId:'package',
    acceptedProductFactSetDigest:D(context.raw.facts),decisionFactSetDigest:D('decisions'),assessments:[]};
  context.basis={...basis,digest:D(basis)};context.knownBindings={digest:D('known-bindings')};
  db.prepare('INSERT INTO arca_shelves VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('shelf','Shelf','endpoint',root,'mount',1,'active',1,1,1,D('route'),10000,10000);
  db.prepare('INSERT INTO arca_shelf_standard_revisions VALUES(?,?,?,?,?,?,?,?)').run('shelf',1,'fixture',1,'fixture-standard','{}',D('standard'),10000);
  db.prepare('INSERT INTO arca_placement_policy_revisions VALUES(?,?,?,?,?,?)').run('shelf',1,'fixture-placement','{}',D('placement'),10000);
  db.prepare('INSERT INTO arca_shelf_entries VALUES(?,?,?,?,?,?,?,?,?,?)').run('entry','shelf','single','active',1,context.raw.entry.canonical_identity_key,2,1,10000,null);
  db.prepare('INSERT INTO arca_inventory_representations VALUES(?,?,?,?,?)').run('entry',2,context.raw.inventory.representation_digest,'package',10000);
  db.prepare('INSERT INTO arca_canonical_identity_revisions VALUES(?,?,?,?,?,?,?,?)').run('entry',1,'single','internal_identity','internal','fixture-source',context.raw.identity.identity_digest,10000);
  db.prepare('INSERT INTO arca_deck_fact_revisions VALUES(?,?,?,?,?,?,?)').run('entry',1,'active',2,1,D('deck'),10000);
  const people=require('../../../src/helix/domains/people/persistence/people-store').createPeopleStore({schemaManifest:compiled.manifest,unitOfWork});
  for(const personId of ['actor-a','actor-b','actor-c']){
    const value={decisionId:'register-'+personId,newPersonId:personId,libraryKind:'us_adult',canonicalName:personId,aliases:[],providerIdentities:[],actorId:'admin',initialReference:initialReference(personId,'admin')};
    people.registerDirectPerson({...value,decisionDigest:D(value)});
  }
  function services(extra={}) {
    const dependencies={schemaManifest:compiled.manifest,unitOfWork,contractValidator,now:()=>10000,aftercareWorkspaceRoot:path.join(root,'aftercare')},
      queryPeople=require('../../../src/helix/domains/people/persistence/people-store').createPeopleStore(dependencies),
      care=require('../../../src/helix/domains/arca/persistence/aftercare-store').createAftercareStore(dependencies),
      store=require('../../../src/helix/domains/arca/persistence/us-adult-actor-refresh-store').createUsAdultActorRefreshStore(dependencies),
      reader={store:care,read:()=>context},
      query={readUsAdultPersonSnapshot:request=>queryPeople.readUsAdultPersonSnapshot(request),
        readUsAdultReferencePage:request=>queryPeople.readUsAdultReferencePage({...request,limit:1})},
      command=require('../../../src/helix/domains/arca/application/us-adult-actor-refresh-command').createUsAdultActorRefreshCommand({
        actorRefreshStore:store,aftercareContextReader:reader,peopleReferenceQuery:query,contractValidator,...extra});
    return {care,store,reader,query,command,dependencies};
  }
  const request={mode:'specified',idempotencyKey:'refresh',expectedInventoryRevision:2,expectedRepresentationDigest:context.raw.inventory.representation_digest,
    personId:'actor-a',expectedPersonRevision:1,expectedReferenceRevision:1};
  return {root,db,context,request,services,compiled,contractValidator,
    reopen(){kernel.close();kernel=openSqliteKernel(options);unitOfWork=createSqliteUnitOfWork({kernel});return services();}};
}
module.exports=Object.freeze({fixture});
