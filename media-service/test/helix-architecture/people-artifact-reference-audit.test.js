'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {createUsAdultAnalysisStore}=require('../../src/helix/domains/libra/persistence/us-adult-analysis-store');
const {createLibraArtifactAuditSource}=require('../../src/helix/domains/libra/persistence/reference-artifact-audit-source');
const {createPeopleArtifactAuditSource}=require('../../src/helix/domains/people/persistence/reference-artifact-audit-source');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
function lastAsset(pages){return pages.at(-1).items[0].referenceProjection.contributions[0].activeAssets[0];}
test('Owner reference audit persists opaque composite pagination and protects an Artifact in the last frozen page',()=>harness(({options,basis,pages})=>{
  createUsAdultAnalysisStore(options).freeze(basis,pages);const artifactHandle={artifactHandleId:lastAsset(pages).artifactHandleId},first=createLibraArtifactAuditSource(options),epoch=first.epoch();
  let cursor=null,found=false,steps=0;do{const source=steps%2?createLibraArtifactAuditSource(options):first,page=source.page({artifactHandle,cursor,atMs:1000});
    if(page.referenced){found=true;break;}cursor=page.nextCursor;steps++;assert.ok(steps<20);
  }while(cursor!==null);assert.equal(found,true);assert.ok(steps>=3);assert.equal(first.epoch(),epoch);
}));
test('complete negative reference scans remain bounded and refuse corrupt frozen JSON or changed source epochs',()=>harness(({options,basis,pages,db})=>{
  createUsAdultAnalysisStore(options).freeze(basis,pages);assert.throws(()=>createLibraArtifactAuditSource({...options,contractValidator:null}),/closed Owner schema validator/);const source=createLibraArtifactAuditSource(options),artifactHandle={artifactHandleId:'f'.repeat(64)},epoch=source.epoch();
  let cursor=null,steps=0;do{const page=source.page({artifactHandle,cursor,atMs:1000});assert.equal(page.referenced,false);cursor=page.nextCursor;steps++;assert.ok(steps<20);}while(cursor!==null);
  assert.ok(steps>pages.length);db.prepare('UPDATE libra_us_adult_reference_pages SET page_ordinal=99 WHERE analysis_id=? AND page_ordinal=2').run(basis.analysisId);
  assert.notEqual(source.epoch(),epoch);
  assert.throws(()=>options.unitOfWork.execute([source.participant(epoch)]),{code:'ARTIFACT_REFERENCE_SOURCE_INVALID'});
  db.prepare("UPDATE libra_us_adult_reference_pages SET page_json='null' WHERE analysis_id=? AND page_ordinal=0").run(basis.analysisId);
  const parent=source.page({artifactHandle,cursor:null,atMs:1000});assert.throws(()=>source.page({artifactHandle,cursor:parent.nextCursor,atMs:1000}),{code:'ARTIFACT_REFERENCE_SOURCE_INVALID'});
}));
test('People protects actual image/embedding and resolves retained Reference Asset IDs without crossing Owner tables',()=>harness(({options,pages})=>{
  const person=pages[0].items[0],contribution=person.referenceProjection.contributions[0],asset=contribution.activeAssets[0],face=contribution.activeFaces[0],source=createPeopleArtifactAuditSource(options),
    image={artifactHandleId:asset.artifactHandleId,artifactKind:'reference-image',ownerScope:{scopeType:'person',scopeId:person.personId}},
    embedding={artifactHandleId:face.embeddingHandleId,artifactKind:'reference-embedding',ownerScope:image.ownerScope};
  assert.equal(source.page({artifactHandle:image,atMs:9999999999}).referenced,true);
  assert.equal(source.page({artifactHandle:embedding,atMs:9999999999}).referenced,true);
  assert.equal(source.resolvesReferenceAssets([asset.referenceAssetId],image),true);assert.equal(source.resolvesReferenceAssets([asset.referenceAssetId],embedding),true);
  assert.equal(source.resolvesReferenceAssets([asset.referenceAssetId],{...image,artifactHandleId:D('foreign')}),false);
  assert.throws(()=>source.resolvesReferenceAssets(Array(4097).fill('id'),image));
}));

test('frozen reference audit fails closed on valid JSON digest drift and missing final or middle pages',()=>{
  for(const corruption of ['digest','middle','final'])harness(({options,basis,pages,db})=>{
    createUsAdultAnalysisStore(options).freeze(basis,pages);
    if(corruption==='digest'){
      const page=JSON.parse(canonicalJson(pages[0]));page.items[0].canonicalName='Changed actor';
      db.prepare('UPDATE libra_us_adult_reference_pages SET page_json=? WHERE analysis_id=? AND page_ordinal=0').run(canonicalJson(page),basis.analysisId);
    }else db.prepare('DELETE FROM libra_us_adult_reference_pages WHERE analysis_id=? AND page_ordinal=?').run(basis.analysisId,corruption==='middle'?1:pages.length-1);
    const source=createLibraArtifactAuditSource(options),artifactHandle={artifactHandleId:'f'.repeat(64)};
    assert.throws(()=>{let cursor=null,steps=0;do{const page=source.page({artifactHandle,cursor,atMs:1000});cursor=page.nextCursor;assert.ok(++steps<20);}while(cursor!==null);},
      {code:'ARTIFACT_REFERENCE_SOURCE_INVALID'});
  });
});

test('Arca frozen refresh references protect the last page and reject missing retained pages',t=>{
  const f=require('./fixtures/us-adult-actor-refresh-store-context').fixture(t),s=f.services(),
    {personId,expectedPersonRevision,expectedReferenceRevision,...request}=f.request,
    started=s.command.request('entry',{...request,mode:'automatic'},'admin'),
    source=require('../../src/helix/domains/arca/persistence/reference-artifact-audit-source').createArcaArtifactAuditSource(s.dependencies),
    pages=[0,1,2].map(ordinal=>s.store.page(started.intentId,ordinal)),artifactHandle={artifactHandleId:lastAsset(pages).artifactHandleId};
  let cursor=null,found=false;for(let i=0;i<8;i++){const page=source.page({artifactHandle,cursor,atMs:10000});if(page.referenced){found=true;break;}cursor=page.nextCursor;}
  assert.equal(found,true);
  f.db.prepare('DELETE FROM arca_us_actor_refresh_pages WHERE intent_id=? AND page_ordinal=2').run(started.intentId);
  assert.throws(()=>{let next=null;for(let i=0;i<8;i++){const page=source.page({artifactHandle:{artifactHandleId:'f'.repeat(64)},cursor:next,atMs:10000});next=page.nextCursor;}},
    {code:'ARTIFACT_REFERENCE_SOURCE_INVALID'});
});
