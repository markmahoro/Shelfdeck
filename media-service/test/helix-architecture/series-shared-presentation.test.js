'use strict';

const assert=require('node:assert/strict'),test=require('node:test'),path=require('node:path'),os=require('node:os');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildSeriesPresentationSource,buildSeriesPresentationBasis,assertSeriesPresentationBasis,renderSeriesNfo}=require('../../src/helix/contracts/series-presentation-basis');
const {buildMetadataFetchIntent,buildMetadataObservation}=require('../../src/helix/domains/libra/model/product-fact-contracts');
const {analyzeNfoDocument,directText}=require('../../src/helix/contracts/movie-nfo-document');
const {selectTmdbImage}=require('../../src/helix/contracts/tmdb-image-selection');
const {seriesScopeId,buildSeriesScope,buildSharedManifest}=require('../../src/helix/domains/arca/model/series-presentation');
const D=value=>canonicalDigest({value});
function basis(seasonNumber=3,providerKey='1399'){
  const identity={provider:'tmdb',namespace:'tmdb_series',providerKey,seasonNumber};identity.identityAnchorDigest=canonicalDigest(identity);
  const intent=buildMetadataFetchIntent({libraRunId:'season-'+seasonNumber,runExecutionBasisDigest:D('run'),sourceKind:'provider',sourcePriority:0,
    contentProfile:'series',resolvedIdentityDigest:D(identity),requestedFields:['series_title'],providerKind:'tmdb',integrationId:'tmdb-main',
    configRevision:2,resolvedProviderIdentity:identity});
  const source=buildSeriesPresentationSource({provider:'tmdb',namespace:'tmdb_series',providerKey,seasonIdentityAnchorDigest:identity.identityAnchorDigest,
    integrationId:intent.integrationId,configRevision:2,language:'zh-CN',sourceRef:'tmdb:tv:'+providerKey,title:'A & B',originalTitle:'Original Show',
    firstAirDate:'2008-01-20',plot:'The whole show, not a Season synopsis.',genres:['Drama']});
  const observation=buildMetadataObservation({intent,descriptiveEntries:[{key:'series_title',value:source.title}],providerIdentities:[identity],
    seriesPresentationSource:source,observedAtMs:100});
  return {value:buildSeriesPresentationBasis(observation),identity,observation};
}

test('first S03 carries exact show facts and renders a real tvshow document independently from Season membership',()=>{
  const {value,identity,observation}=basis();assertSeriesPresentationBasis(value,identity);
  assert.equal(value.metadataObservationDigest,observation.payloadDigest);
  const bytes=renderSeriesNfo(value),document=analyzeNfoDocument(bytes,'tvshow');
  assert.equal(document.usable,true);assert.equal(directText(document,'title'),'A & B');
  assert.equal(directText(document,'uniqueid'),'1399');assert.equal(directText(document,'season'),null);
  assert.equal(directText(document,'year'),'2008');assert.equal(directText(document,'plot'),value.sourceObservation.plot);
  assert.equal(analyzeNfoDocument(bytes,'movie').usable,false);
  assert.throws(()=>assertSeriesPresentationBasis(value,{...identity,providerKey:'999'}),{code:'SERIES_PRESENTATION_BASIS_INVALID'});
  assert.throws(()=>assertSeriesPresentationBasis({...value,sourceObservation:{...value.sourceObservation,plot:'changed'}}));
});

test('shared identity follows Shelf and Provider show identity rather than first Season, title or year',()=>{
  const first=basis(3),next=basis(4);
  assert.notEqual(first.value.basisDigest,next.value.basisDigest);
  assert.equal(seriesScopeId('shelf',first.identity.providerKey),seriesScopeId('shelf',next.identity.providerKey));
  assert.notEqual(seriesScopeId('shelf','1399'),seriesScopeId('other-shelf','1399'));
  assert.notEqual(seriesScopeId('shelf','1399'),seriesScopeId('shelf','999'));
});

test('image policy normalizes language, is stable across response order and keeps poster and background roles separate',()=>{
  const images=[{file_path:'/fallback.jpg',iso_639_1:null,width:1000,height:1500,vote_average:9},
    {file_path:'/zh-b.jpg',iso_639_1:'zh',width:600,height:900,vote_average:8},
    {file_path:'/zh-a.jpg',iso_639_1:'zh',width:600,height:900,vote_average:8},
    {file_path:'/wide.jpg',iso_639_1:null,width:1920,height:1080,vote_average:10}];
  const policy={artifactKind:'poster',language:'zh-CN'};
  assert.equal(selectTmdbImage(images,policy).file_path,'/zh-a.jpg');
  assert.deepEqual(selectTmdbImage([...images].reverse(),policy),selectTmdbImage(images,policy));
  assert.equal(selectTmdbImage(images,{artifactKind:'fanart',language:'zh-CN'}).file_path,'/wide.jpg');
  assert.equal(selectTmdbImage([...images,{file_path:'/original.jpg',iso_639_1:'ja',width:600,height:900,vote_average:1}],
    {artifactKind:'poster',language:'fr-FR',originalLanguage:'ja'}).file_path,'/original.jpg');
});

test('a Season NFO renamed to tvshow.nfo cannot satisfy the shared Series document',()=>{
  const {nfoIdentity}=require('../../src/helix/integrations/series-presentation-io');
  assert.throws(()=>nfoIdentity(Buffer.from('<tvshow><title>Show</title><season>3</season><uniqueid type="tmdb">1399</uniqueid></tvshow>')),
    {code:'ARCA_SERIES_NFO_SCOPE_INVALID'});
  assert.throws(()=>nfoIdentity(Buffer.from('<tvshow><title>Show</title><episodedetails><title>Episode</title></episodedetails><uniqueid type="tmdb">1399</uniqueid></tvshow>')),
    {code:'ARCA_SERIES_NFO_SCOPE_INVALID'});
});

test('a tvshow NFO with -1 season and episode placeholders remains a shared Series document',()=>{
  const {nfoIdentity}=require('../../src/helix/integrations/series-presentation-io');
  assert.equal(nfoIdentity(Buffer.from('<tvshow><title>Show</title><season>-1</season><episode>-1</episode><uniqueid type="tmdb">1399</uniqueid></tvshow>')),'1399');
});

test('a shared Inventory requires all three exact root roles and rejects a Season poster or foreign NFO',()=>{
  const {value}=basis(),shelfRoot=path.join(os.tmpdir(),'shelfdeck-series-scope'),rootLocation=path.join(shelfRoot,'Show'),
    scope=buildSeriesScope({buildId:'build-1',scopeId:seriesScopeId('shelf','1399'),shelfId:'shelf',revision:1,expectedVersion:0,
      endpointId:'target',mountScopeId:'mount',shelfRoot,rootLocation,basis:value,existingMembers:[]});
  const members=['nfo','poster','fanart'].map((artifactKind,index)=>({artifactKind,endpointId:'target',
    location:path.join(rootLocation,artifactKind==='nfo'?'tvshow.nfo':artifactKind+'.jpg'),byteDigest:D(artifactKind),sizeBytes:100,
    physicalIdentity:{materialKey:D(index)},width:artifactKind==='nfo'?null:artifactKind==='poster'?600:1920,
    height:artifactKind==='nfo'?null:artifactKind==='poster'?900:1080,nfoProviderKey:artifactKind==='nfo'?'1399':null,sourceDigest:D('source')}));
  assert.equal(buildSharedManifest(scope,members).revision,1);
  assert.throws(()=>buildSharedManifest(scope,members.slice(0,2)),{code:'ARCA_SERIES_PRESENTATION_INCOMPLETE'});
  assert.throws(()=>buildSharedManifest(scope,members.map(member=>member.artifactKind==='poster'?{...member,location:path.join(rootLocation,'Season 03','poster.jpg')}:member)));
  assert.throws(()=>buildSharedManifest(scope,members.map(member=>member.artifactKind==='nfo'?{...member,nfoProviderKey:'999'}:member)));
});

async function interruptedPublication(t){
  const fs=require('node:fs'),sharp=require('sharp'),{createSeriesPresentationIo}=require('../../src/helix/integrations/series-presentation-io');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-alias-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-series-alias-'));fs.rmSync(root,{recursive:true,force:true});});
  const workspace=path.join(root,'workspace'),shelfRoot=path.join(root,'shelf');fs.mkdirSync(workspace);fs.mkdirSync(shelfRoot);
  const {value}=basis(),scope=buildSeriesScope({buildId:'arca-series-build-'+D('alias').slice(0,40),scopeId:seriesScopeId('shelf','1399'),
    shelfId:'shelf',revision:1,expectedVersion:0,endpointId:'target',mountScopeId:'mount',shelfRoot,rootLocation:path.join(shelfRoot,'Show'),basis:value,existingMembers:[]});
  const rootSnapshot={resolvedRoot:workspace,rootHandleRef:'root-ref',endpointId:'workspace',mountScopeId:'workspace-mount'},
    io=createSeriesPresentationIo({rootSnapshot}),execution={eventId:'alias-event',shouldContinue:()=>true},artifacts=[];
  for(const kind of ['nfo','poster','fanart']){
    const bytes=kind==='nfo'?renderSeriesNfo(value):await sharp({create:{width:kind==='poster'?600:1600,height:900,channels:3,background:'#123456'}}).jpeg().toBuffer();
    artifacts.push(io.writeWorkspace(scope,kind,bytes,execution));
  }
  await assert.rejects(createSeriesPresentationIo({rootSnapshot,afterPhysicalEffect(){throw new Error('interrupted after link');}}).publish(scope,artifacts,execution),/interrupted after link/);
  const target=path.join(scope.rootLocation,'tvshow.nfo'),temporary=target+'.shelfdeck-'+artifacts[0].workspaceMaterialHandle.digestHex+'.partial';
  return {fs,io,scope,execution,artifacts,target,temporary,bytes:fs.readFileSync(target),
    expectations:artifacts.map(item=>({artifactKind:item.artifactKind,byteDigest:item.workspaceMaterialHandle.digestHex,sizeBytes:item.workspaceMaterialHandle.sizeBytes}))};
}

function rejectAliasReads(t,fs,temporary){
  const open=fs.openSync;let blocked=0;
  t.mock.method(fs,'openSync',function(location,flags,...rest){
    if(String(location)===temporary&&flags==='r'){blocked++;throw Object.assign(new Error('SMB alias is not independently readable'),{code:'EINVAL'});}
    return open.call(this,location,flags,...rest);
  });
  return ()=>blocked;
}

test('Series recovery proves an unreadable redundant producer alias through the exact published inode and completes all roles',async t=>{
  const f=await interruptedPublication(t),reads=rejectAliasReads(t,f.fs,f.temporary),identity=f.fs.statSync(f.target,{bigint:true});
  assert.equal(f.fs.statSync(f.temporary,{bigint:true}).ino,identity.ino);
  assert.equal(f.io.observeWrites(f.scope,f.expectations,{formal:true}).status,'matching');
  const published=await f.io.publish(f.scope,f.artifacts,{...f.execution,recoveryDecision:'continue_forward'});
  assert.equal(published.members.length,3);assert.equal(reads(),0);
  assert.equal(f.fs.existsSync(f.temporary),false);assert.deepEqual(f.fs.readFileSync(f.target),f.bytes);
  assert.equal(f.fs.statSync(f.target,{bigint:true}).ino,identity.ino);
  assert.deepEqual(f.fs.readdirSync(f.scope.rootLocation).sort(),['fanart.jpg','poster.jpg','tvshow.nfo']);
});

test('Series recovery cannot infer an unreadable different inode from identical final bytes',async t=>{
  const f=await interruptedPublication(t);f.fs.unlinkSync(f.temporary);f.fs.writeFileSync(f.temporary,f.bytes);
  assert.notEqual(f.fs.statSync(f.target,{bigint:true}).ino,f.fs.statSync(f.temporary,{bigint:true}).ino);
  rejectAliasReads(t,f.fs,f.temporary);const before=f.fs.statSync(f.temporary,{bigint:true});
  assert.throws(()=>f.io.observeWrites(f.scope,f.expectations,{formal:true}),{code:'PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED'});
  await assert.rejects(f.io.publish(f.scope,f.artifacts,{...f.execution,recoveryDecision:'continue_forward'}),{code:'PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED'});
  assert.deepEqual(f.fs.statSync(f.temporary,{bigint:true}),before);assert.deepEqual(f.fs.readFileSync(f.target),f.bytes);
});

test('Series alias recovery preserves unknown neighboring partials and existing collection bytes',async t=>{
  const f=await interruptedPublication(t),unknown=f.target+'.shelfdeck-'+D('unowned').slice(0,64)+'.partial',
    retained=path.join(f.scope.rootLocation,'retained-collection.mkv'),bytes=Buffer.from('Existing collection bytes');
  f.fs.writeFileSync(unknown,f.bytes);f.fs.writeFileSync(retained,bytes);
  const unknownIdentity=f.fs.statSync(unknown,{bigint:true}),retainedIdentity=f.fs.statSync(retained,{bigint:true});
  rejectAliasReads(t,f.fs,f.temporary);
  await f.io.publish(f.scope,f.artifacts,{...f.execution,recoveryDecision:'continue_forward'});
  assert.equal(f.fs.existsSync(f.temporary),false);
  assert.deepEqual(f.fs.readFileSync(unknown),f.bytes);assert.deepEqual(f.fs.readFileSync(retained),bytes);
  for(const [location,identity] of [[unknown,unknownIdentity],[retained,retainedIdentity]])
    for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(f.fs.statSync(location,{bigint:true})[key],identity[key]);
});

test('Series published-alias cleanup requires an active execution fence and leaves the final file intact',async t=>{
  const f=await interruptedPublication(t);rejectAliasReads(t,f.fs,f.temporary);let checks=0;
  await assert.rejects(f.io.publish(f.scope,f.artifacts,{...f.execution,recoveryDecision:'continue_forward',shouldContinue:()=>++checks===1}),{code:'ARCA_SERIES_EXECUTION_FENCED'});
  assert.equal(f.fs.existsSync(f.temporary),true);assert.deepEqual(f.fs.readFileSync(f.target),f.bytes);
});

test('Series published-alias cleanup refuses a replacement between its proof and the final execution fence',async t=>{
  const f=await interruptedPublication(t);rejectAliasReads(t,f.fs,f.temporary);let checks=0;
  const foreign=Buffer.from('unrelated replacement');
  await assert.rejects(f.io.publish(f.scope,f.artifacts,{...f.execution,recoveryDecision:'continue_forward',shouldContinue:()=>{
    if(++checks===2){f.fs.unlinkSync(f.temporary);f.fs.writeFileSync(f.temporary,foreign);}return true;
  }}),{code:'ARCA_SERIES_TEMP_CONFLICT'});
  t.mock.restoreAll();assert.deepEqual(f.fs.readFileSync(f.temporary),foreign);assert.deepEqual(f.fs.readFileSync(f.target),f.bytes);
});

test('Series recovery preserves a different producer file whose readable bytes conflict with the frozen recipe',async t=>{
  const f=await interruptedPublication(t),foreign=Buffer.alloc(f.bytes.length,120);
  f.fs.unlinkSync(f.temporary);f.fs.writeFileSync(f.temporary,foreign);
  const observed=f.io.observeWrites(f.scope,f.expectations,{formal:true});assert.equal(observed.status,'conflict');assert.equal(observed.cleanupDeclared,false);
  await assert.rejects(f.io.publish(f.scope,f.artifacts,{...f.execution,recoveryDecision:'continue_forward'}),{code:'ARCA_SERIES_TEMP_CONFLICT'});
  assert.deepEqual(f.fs.readFileSync(f.temporary),foreign);assert.deepEqual(f.fs.readFileSync(f.target),f.bytes);
});

test('real Series IO publishes and verifies three root files while preserving healthy bytes on reuse',async()=>{
  const fs=require('node:fs'),sharp=require('sharp'),{createSeriesPresentationIo}=require('../../src/helix/integrations/series-presentation-io');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-shared-'));
  try{
    const workspace=path.join(temporary,'workspace'),shelfRoot=path.join(temporary,'shelf');
    fs.mkdirSync(workspace);fs.mkdirSync(shelfRoot);
    const {value}=basis(),rootLocation=path.join(shelfRoot,'A & B (2008)'),scope=buildSeriesScope({buildId:'arca-series-build-'+D('build').slice(0,40),
      scopeId:seriesScopeId('shelf','1399'),shelfId:'shelf',revision:1,expectedVersion:0,endpointId:'target',mountScopeId:'mount',
      shelfRoot,rootLocation,basis:value,existingMembers:[]}),
      io=createSeriesPresentationIo({rootSnapshot:{resolvedRoot:workspace,rootHandleRef:'root-ref',endpointId:'workspace',mountScopeId:'workspace-mount'}}),
      execution={eventId:'publish',shouldContinue:()=>true},artifacts=[];
    for(const kind of ['nfo','poster','fanart']){
      const bytes=kind==='nfo'?renderSeriesNfo(value):await sharp({create:{width:kind==='poster'?600:1600,height:900,channels:3,background:'#123456'}}).jpeg().toBuffer();
      artifacts.push(io.writeWorkspace(scope,kind,bytes,execution));
    }
    const published=buildSharedManifest(scope,(await io.publish(scope,artifacts,execution)).members),before=new Map(published.members.map(member=>[member.location,fs.readFileSync(member.location)]));
    assert.equal(published.members.length,3);assert.equal(typeof await io.verifyManifest(scope,published),'string');
    const existing=await io.inspectRoot(scope,value,published);assert.equal(existing.length,3);
    assert.equal(buildSharedManifest(scope,(await io.publish(scope,artifacts,execution)).members).digest,published.digest);
    for(const [location,bytes] of before)assert.deepEqual(fs.readFileSync(location),bytes);
    const image=published.members.find(member=>member.artifactKind==='poster');
    fs.writeFileSync(image.location,await sharp({create:{width:600,height:900,channels:3,background:'#abcdef'}}).jpeg().toBuffer());
    await assert.rejects(io.verifyManifest(scope,published),{code:'ARCA_SERIES_EXTERNAL_CHANGE'});
    await assert.rejects(io.publish(scope,artifacts,execution),{code:'ARCA_SERIES_TARGET_CONFLICT'});
  }finally{assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('helix-series-shared-'));fs.rmSync(temporary,{recursive:true,force:true});}
});

test('actual loss after one publication resumes the frozen file recipe and never replaces another show NFO',async()=>{
  const fs=require('node:fs'),sharp=require('sharp'),{createSeriesPresentationIo}=require('../../src/helix/integrations/series-presentation-io');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-shared-'));
  try{
    const workspace=path.join(temporary,'workspace'),shelfRoot=path.join(temporary,'shelf');fs.mkdirSync(workspace);fs.mkdirSync(shelfRoot);
    const {value}=basis(),scope=buildSeriesScope({buildId:'arca-series-build-'+D('loss').slice(0,40),scopeId:seriesScopeId('shelf','1399'),
      shelfId:'shelf',revision:1,expectedVersion:0,endpointId:'target',mountScopeId:'mount',shelfRoot,rootLocation:path.join(shelfRoot,'Show'),basis:value,existingMembers:[]}),
      rootSnapshot={resolvedRoot:workspace,rootHandleRef:'root-ref',endpointId:'workspace',mountScopeId:'workspace-mount'},
      initial=createSeriesPresentationIo({rootSnapshot}),execution={eventId:'original-event',shouldContinue:()=>true},artifacts=[];
    for(const kind of ['nfo','poster','fanart']){
      const bytes=kind==='nfo'?renderSeriesNfo(value):await sharp({create:{width:kind==='poster'?600:1600,height:900,channels:3,background:'#123456'}}).jpeg().toBuffer();
      artifacts.push(initial.writeWorkspace(scope,kind,bytes,execution));
    }
    const interrupted=createSeriesPresentationIo({rootSnapshot,afterPhysicalEffect(){throw new Error('simulated process loss after link');}});
    await assert.rejects(interrupted.publish(scope,artifacts,execution),/process loss/);
    const recovered=createSeriesPresentationIo({rootSnapshot}),published=await recovered.publish(scope,artifacts,{...execution,recoveryDecision:'safe_retry'});
    assert.equal(published.members.length,3);
    assert.deepEqual(fs.readdirSync(scope.rootLocation).sort(),['fanart.jpg','poster.jpg','tvshow.nfo']);
    fs.writeFileSync(path.join(scope.rootLocation,'tvshow.nfo'),renderSeriesNfo(basis(3,'999').value));
    await assert.rejects(recovered.inspectRoot(scope,value),{code:'ARCA_SERIES_IDENTITY_CONFLICT'});
  }finally{assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('helix-series-shared-'));fs.rmSync(temporary,{recursive:true,force:true});}
});

test('real SQLite admits one shared builder for two Seasons and atomically pins references to a verified version',()=>{
  const fs=require('node:fs'),Database=require('better-sqlite3'),{openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel'),
    {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work'),
    {createSeriesPresentationStore}=require('../../src/helix/domains/arca/persistence/series-presentation-store'),
    {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator'),
    schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-store-')),databasePath=path.join(temporary,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl:fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')}),
    db=new Database(databasePath),unitOfWork=createSqliteUnitOfWork({kernel}),schemas=[
      require('../../src/helix/contracts/domain-types/SeriesPresentationScope/v1/schema.json'),
      require('../../src/helix/contracts/domain-types/SeriesPresentationManifest/v1/schema.json'),
      require('../../src/helix/contracts/types/PhysicalMaterialIdentity/v2/schema.json')],
    store=createSeriesPresentationStore({schemaManifest,unitOfWork,contractValidator:createCapabilityContractValidator({schemas})});
  try{
    const shelfRoot=path.join(temporary,'shelf'),targetLocation=path.join(shelfRoot,'Show','Season 03'),
      shelf={shelfId:'shelf',currentPlacementRevision:1,target:{endpointId:'target',mountScopeId:'mount',rootLocation:shelfRoot}};
    db.prepare('INSERT INTO arca_shelves(shelf_id) VALUES(?)').run('shelf');
    const requests=[3,4].map(season=>{
      const value=basis(season),onDeckRunId='run-'+season,custodyId='custody-'+season;
      db.prepare('INSERT INTO arca_ondeck_custodies(custody_id) VALUES(?)').run(custodyId);
      db.prepare('INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES(?,?,?)').run(onDeckRunId,custodyId,'ready');
      const request={shelf,onDeckRunId,custodyId,targetLocation:path.join(path.dirname(targetLocation),'Season '+String(season).padStart(2,'0')),
        package:{productStructureSnapshot:{structureKind:'season'},resolvedIdentitySnapshot:{factValue:{providerIdentities:[value.identity]}},
          productFactManifest:{items:[{factKind:'product_metadata',factValue:{seriesPresentationBasis:value.value}}]}}};
      unitOfWork.execute([store.reservationParticipant(request)]);return {...request,basis:value.value};
    });
    const scopeId=seriesScopeId('shelf','1399'),first=store.admitBuild({scopeId,basis:requests[0].basis,existingMembers:[]}),
      second=store.admitBuild({scopeId,basis:requests[1].basis,existingMembers:[]});
    assert.equal(first.objectId,second.objectId);assert.equal(db.prepare('SELECT count(*) n FROM arca_series_presentation_builds').get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM arca_series_presentation_reservations WHERE state='pending'").get().n,2);
    const members=['nfo','poster','fanart'].map((artifactKind,index)=>{
      const tuple={mountScopeId:'mount',inode:String(index+1),sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D(index)},
        identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
          materialKey:canonicalDigest({schema:'physical-material-identity@2',...tuple}),...tuple};
      return {artifactKind,endpointId:'target',location:path.join(first.rootLocation,artifactKind==='nfo'?'tvshow.nfo':artifactKind+'.jpg'),
        byteDigest:D(artifactKind),sizeBytes:100,physicalIdentity:identity,sourceDigest:first.basis.basisDigest,
        width:artifactKind==='nfo'?null:artifactKind==='poster'?600:1600,height:artifactKind==='nfo'?null:900,nfoProviderKey:artifactKind==='nfo'?'1399':null};
    }),manifest=buildSharedManifest(first,members),verificationDigest=D('verified'),crash={participantId:'after_series_write',owner:'arca',repositories:[store.repository],execute(){throw new Error('injected before COMMIT');}};
    assert.throws(()=>unitOfWork.execute([store.versionParticipant(first,manifest,verificationDigest),crash]),/injected/);
    assert.equal(store.readScope(scopeId).current_version,0n);assert.equal(db.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n,0);
    unitOfWork.execute([store.versionParticipant(first,manifest,verificationDigest)]);
    assert.equal(store.manifest(scopeId,1).value.digest,manifest.digest);
    db.prepare('INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id) VALUES(?,?)').run('season-3','shelf');
    const request={...requests[0],fulfillmentVerification:{seriesPresentationRef:{scopeId,sharedVersion:1,manifestDigest:manifest.digest,verificationDigest}}};
    assert.throws(()=>unitOfWork.execute([store.commitReferenceParticipant(request,'season-3'),crash]),/injected/);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_series_presentation_references').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_series_presentation_commit_links').get().n,0);
    assert.equal(store.read('run_reservation',{on_deck_run_id:request.onDeckRunId}).state,'pending');
    unitOfWork.execute([store.commitReferenceParticipant(request,'season-3')]);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_series_presentation_references').get().n,1);
    assert.equal(store.read('commit_link',{on_deck_run_id:request.onDeckRunId}).shared_version,1n);
    const repair=store.admitBuild({scopeId,basis:requests[1].basis,existingMembers:members});
    assert.notEqual(repair.objectId,first.objectId);
    assert.throws(()=>unitOfWork.execute([store.commitReferenceParticipant({...requests[1],fulfillmentVerification:request.fulfillmentVerification},'season-3')]),
      {code:'ARCA_SERIES_COMMIT_FENCE_STALE'});
    assert.equal(store.manifest(scopeId,1).value.digest,manifest.digest);
    const repaired=buildSharedManifest(repair,members);unitOfWork.execute([store.versionParticipant(repair,repaired,D('repair-verification'))]);
    assert.equal(store.lastReferenceMembers('season-3').length,0,'An accepted pending Season protects the common files.');
    db.prepare('INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id) VALUES(?,?)').run('season-4','shelf');
    const secondCommit={...requests[1],fulfillmentVerification:{seriesPresentationRef:{scopeId,sharedVersion:2,manifestDigest:repaired.digest,verificationDigest:D('repair-verification')}}};
    unitOfWork.execute([store.commitReferenceParticipant(secondCommit,'season-4')]);
    assert.equal(store.lastReferenceMembers('season-3').length,0,'Another committed Season protects the common files.');
    unitOfWork.execute([store.releaseReferencesParticipant(['season-4'])]);
    const last=store.lastReferenceMembers('season-3').map(member=>({...member,materialKey:member.physicalIdentity.materialKey,physicalIdentityDigest:canonicalDigest(member.physicalIdentity)}));
    assert.equal(last.length,3);db.prepare('INSERT INTO arca_offdeck_scopes(destruction_scope_id) VALUES(?)').run('destruction-last');
    assert.throws(()=>unitOfWork.execute([store.retirementParticipant({destructionScopeId:'destruction-last',shelfEntryId:'season-3',members:last.slice(0,2)})]),{code:'ARCA_SERIES_RETIREMENT_STALE'});
    unitOfWork.execute([store.retirementParticipant({destructionScopeId:'destruction-last',shelfEntryId:'season-3',members:last})]);
    assert.equal(store.readScope(scopeId).retirement_scope_id,'destruction-last');
    assert.throws(()=>store.admitBuild({scopeId,basis:requests[0].basis,existingMembers:members}),{code:'ARCA_SERIES_RETIREMENT_IN_PROGRESS'});
    db.prepare('INSERT INTO arca_ondeck_custodies(custody_id) VALUES(?)').run('custody-5');db.prepare('INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES(?,?,?)').run('run-5','custody-5','ready');
    assert.throws(()=>unitOfWork.execute([store.reservationParticipant({...requests[0],onDeckRunId:'run-5',custodyId:'custody-5'})]),{code:'ARCA_SERIES_RETIREMENT_IN_PROGRESS'});
    assert.equal(store.read('run_reservation',{on_deck_run_id:'run-5'}),undefined);
    assert.equal(store.assertRetirement({destructionScopeId:'destruction-last',shelfEntryId:'season-3',members:last}),true);
    unitOfWork.execute([store.releaseReferencesParticipant(['season-3']),store.retirementParticipant({destructionScopeId:'destruction-last',shelfEntryId:'season-3',members:last,complete:true})]);
    assert.equal(store.readScope(scopeId).retirement_scope_id,null);assert.equal(store.manifest(scopeId,1).value.digest,manifest.digest);
    assert.equal(store.read('commit_link',{on_deck_run_id:request.onDeckRunId}).shared_version,1n);

  }finally{db.close();kernel.close();assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('helix-series-store-'));fs.rmSync(temporary,{recursive:true,force:true});}
});


test('Formation retirement preserves a shared builder for another Season then closes the final unused builder atomically',()=>{
  const fs=require('node:fs'),Database=require('better-sqlite3');
  const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
  const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
  const {createSeriesPresentationStore}=require('../../src/helix/domains/arca/persistence/series-presentation-store');
  const {createArcaFormationRetirementStore,createFormationSharedRetirement}=require('../../src/helix/domains/arca/public');
  const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'helix-shared-retirement-')),databasePath=path.join(temporary,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl:fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')});
  const db=new Database(databasePath),unitOfWork=createSqliteUnitOfWork({kernel}),deps={schemaManifest,unitOfWork,
    contractValidator:require('../../src/helix/foundation/capability/contract-validator').createCapabilityContractValidator({schemas:[
      require('../../src/helix/contracts/domain-types/SeriesPresentationScope/v1/schema.json'),
      require('../../src/helix/contracts/domain-types/SeriesPresentationManifest/v1/schema.json'),
      require('../../src/helix/contracts/types/PhysicalMaterialIdentity/v2/schema.json')]})};
  try {
    const store=createSeriesPresentationStore(deps),arca=createArcaFormationRetirementStore(deps),shared=createFormationSharedRetirement(deps);
    db.prepare("INSERT INTO arca_shelves(shelf_id) VALUES ('shelf')").run();
    const shelfRoot=path.join(temporary,'shelf'),shelf={shelfId:'shelf',currentPlacementRevision:1,target:{endpointId:'target',mountScopeId:'mount',rootLocation:shelfRoot}};
    const commands=[3,4].map(season=>{
      const onDeckRunId='run-'+season,custodyId='custody-'+season,packageId='package-'+season,offerId='offer-'+season,value=basis(season);
      db.prepare("INSERT INTO arca_ondeck_custodies(custody_id,on_deck_package_id,package_digest,state) VALUES (?,?,?,'active')").run(custodyId,packageId,D(packageId));
      db.prepare("INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES (?,?,'ready')").run(onDeckRunId,custodyId);
      const request={shelf,onDeckRunId,custodyId,targetLocation:path.join(shelfRoot,'Show','Season '+season),
        package:{productStructureSnapshot:{structureKind:'season'},resolvedIdentitySnapshot:{factValue:{providerIdentities:[value.identity]}},
          productFactManifest:{items:[{factKind:'product_metadata',factValue:{seriesPresentationBasis:value.value}}]}}};
      unitOfWork.execute([store.reservationParticipant(request)]);
      return {offerId,packageId,packageDigest:D(packageId),retirementId:'reset-'+season,backupDigest:D('backup'),manifestDigest:D('manifest')};
    });
    const scopeId=seriesScopeId('shelf','1399'),build=store.admitBuild({scopeId,basis:basis().value,existingMembers:[]});
    const protectedScope=shared.inspect(scopeId,['run-3']);assert.equal(protectedScope.retire,false);
    arca.commit({...commands[0],expectedSnapshotDigest:arca.inspect(commands[0].offerId,commands[0].packageId).snapshotDigest});
    const protectedResult=shared.execute(protectedScope);
    assert.equal(protectedResult.disposition,'protected');
    assert.deepEqual(shared.verify(protectedScope,protectedResult),protectedResult);
    assert.equal(store.readScope(scopeId).active_build_id,build.objectId);
    const orphan=shared.inspect(scopeId,['run-4']);assert.equal(orphan.retire,true);
    arca.commit({...commands[1],expectedSnapshotDigest:arca.inspect(commands[1].offerId,commands[1].packageId).snapshotDigest});
    db.exec("CREATE TRIGGER reject_shared_retirement BEFORE INSERT ON fx_command_receipts WHEN NEW.command_contract='arca.series-presentation.retained-retirement@1' BEGIN SELECT RAISE(ABORT, 'shared receipt crash'); END");
    assert.throws(()=>shared.execute(orphan),/shared receipt crash/);
    assert.equal(store.readScope(scopeId).active_build_id,build.objectId);
    db.exec('DROP TRIGGER reject_shared_retirement');
    const result=shared.execute(orphan);assert.equal(result.disposition,'retained_root_retirement');
    assert.deepEqual(shared.execute(orphan),result);
    const changesBefore=db.prepare('SELECT total_changes() n').get().n;
    assert.deepEqual(shared.verify(orphan,result),result);
    assert.equal(db.prepare('SELECT total_changes() n').get().n,changesBefore);
    assert.throws(()=>shared.verify(orphan,{...result,receipt:{...result.receipt,headDigest:D('wrong')}}),{code:'ARCA_FORMATION_SHARED_STALE'});
    assert.equal(store.readScope(scopeId).active_build_id,null);
    assert.equal(store.build(build.objectId).digest,build.digest,'Immutable shared build history survives');
    assert.equal(db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE command_contract='arca.series-presentation.retained-retirement@1'").get().n,1);
  } finally {db.close();kernel.close();fs.rmSync(temporary,{recursive:true,force:true});}
});
