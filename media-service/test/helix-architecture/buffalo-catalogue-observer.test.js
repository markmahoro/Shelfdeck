'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {fixture}=require('./fixtures/us-adult-catalogue-basis');
const {buildCatalogueAnalysisBasis}=require('../../src/helix/domains/libra/model/us-adult-catalogue-analysis-basis');
const {catalogueFrameBatch}=require('../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {frameEvidence}=require('../../src/helix/contracts/buffalo-frame-evidence');
const {encodeBuffaloEmbeddingSet}=require('../../src/helix/contracts/buffalo-frame-artifact');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {clusterFaces}=require('../../src/helix/integrations/buffalo-video-evidence');
const {createBuffaloCatalogueObserver}=require('../../src/helix/integrations/buffalo-catalogue-observer');
const {catalogueAssessmentGroups,assertCatalogueObservation}=require('../../src/helix/contracts/buffalo-catalogue-observation');
const {assessCatalogueActors}=require('../../src/helix/domains/libra/model/us-adult-catalogue-assessment');
function batch(basis,stage,hasFace,isolated=false){
  const compiled=catalogueFrameBatch(basis,stage),source={basisDigest:basis.basisDigest,batchDigest:compiled.batchDigest,
    frameArtifactSetDigest:D('frames-'+stage),frameMemberSetDigest:D('members-'+stage),frameArtifactBytes:1000,points:compiled.points},vector=Array(512).fill(0);vector[0]=1;
  const frames=compiled.points.map(point=>{const {compositeOrdinal,...frame}=point,feature=isolated?Array(512).fill(0):vector;
    if(isolated)feature[point.ordinal]=1;return frameEvidence({basisDigest:basis.basisDigest,
    frame:{...frame,imageDigest:D(stage+'-'+point.ordinal)},analysis:{coordinateSpace:{kind:'corrected_canvas',sourceWidth:1280,sourceHeight:720,width:1280,height:720,
      rotationDegrees:0,pixelDigest:D('pixels-'+point.ordinal)},faces:hasFace(point)?[{rectangle:[40,40,140,140],landmarks:[[60,60],[100,60],[80,80],[60,110],[100,110]],
      confidence:0.95,vector:feature,rotationApplied:0}]:[]}});}),embeddingSet=encodeBuffaloEmbeddingSet({source,frames});
  return {stage,batchDigest:compiled.batchDigest,frameArtifactSetDigest:source.frameArtifactSetDigest,embeddingSet,
    embeddingDigest:createHash('sha256').update(canonicalJson(embeddingSet)).digest('hex')};
}
function harness(overrides={}){
  const args=fixture(),basis=buildCatalogueAnalysisBasis(args),counters={group:0,load:0,query:0,stop:0},clock={active:true},
    result=()=>({generationDigest:basis.catalogueGeneration.generationDigest,searchPolicyDigest:basis.catalogueSearchPolicy.policyDigest,
      raw:[{key:1,distance:0.1}],matches:[{key:1,uid:'catalogue:1',identityKey:'catalogue:1',name:'Example Performer',distance:0.1,
        combinedDistance:0.1,aliases:['Example Alias']}],retiredSlots:[]}),
    cpuSession={faceModelRef:basis.faceModelRef,async groupFaces(faces,parameters){counters.group++;return clusterFaces(faces,parameters);},
      async loadCatalogue(){counters.load++;return {generationDigest:overrides.wrongGeneration?D('other'):basis.catalogueGeneration.generationDigest,
        policyDigest:basis.catalogueSearchPolicy.policyDigest,dimension:512,size:100,verificationDigest:D('verified')};},
      async searchCatalogue(){counters.query++;if(overrides.queryError)throw Object.assign(Error('Catalogue changed'),{code:'FACE_CATALOGUE_FILES_CHANGED'});
        if(overrides.late)clock.active=false;const value=result();if(overrides.noMatch)value.matches=[];if(overrides.emptyRaw)value.raw=[];
        if(overrides.large){value.raw=Array.from({length:5},(_,i)=>({key:i+1,distance:0.1+i*0.01}));
          value.matches=value.raw.map(item=>({...value.matches[0],...item,combinedDistance:item.distance,uid:'catalogue:'+item.key,identityKey:'catalogue:'+item.key,
            aliases:Array(256).fill('a'.repeat(256))}));}return value;},async stop(){counters.stop++;}},
    observer=createBuffaloCatalogueObserver({cpuSession,context:{assertExecutionActive(){if(!clock.active)throw Object.assign(Error('Stopped'),{code:'STOPPED'});}},
      deadlineAtMs:100000,operationDeadlineMs:60000,now:()=>1000}),request=(mode,batches)=>({basisDigest:basis.basisDigest,mode,
        catalogueGeneration:basis.catalogueGeneration,searchPolicy:basis.catalogueSearchPolicy,clusterParameters:basis.clusterParameters,batches});
  return {basis,counters,clock,observer,request};
}
test('supplementary Evidence is regrouped with the initial frames before catalogue qualification',async()=>{
  const h=harness(),initial=batch(h.basis,'initial',point=>point.stratum<2),supplement=batch(h.basis,'supplement',point=>point.stratum===2),
    first=await h.observer.observe(h.request('initial',[initial])),firstAssessment=assessCatalogueActors({groups:catalogueAssessmentGroups(first),policy:h.basis.selectionPolicy});
  assert.equal(firstAssessment.status,'insufficient_evidence');assert.equal(first.frameEvidenceRefs.length,20);assert.equal(first.groups.length,1);
  const combined=await h.observer.observe(h.request('initial_and_supplement',[initial,supplement])),
    assessment=assessCatalogueActors({groups:catalogueAssessmentGroups(combined),policy:h.basis.selectionPolicy});
  assert.equal(combined.frameEvidenceRefs.length,40);assert.equal(combined.groups.length,1);assert.deepEqual(combined.groups[0].memberKeys,['0:0','1:0','22:0']);
  assert.equal(assessment.status,'qualified_candidate');assert.equal(assessment.winner.name,'Example Performer');assert.deepEqual(assessment.winner.coverageStrata,[0,1,2]);
  assert.equal(Object.hasOwn(assessment.winner,'personId'),false);assert.equal(Object.isFrozen(combined.queries[0].result.matches[0].aliases),true);
});
test('complete no-face Evidence preserves empty sampled frames without claiming catalogue lookup',async()=>{
  const h=harness(),value=await h.observer.observe(h.request('initial',[batch(h.basis,'initial',()=>false)]));
  assert.equal(value.resultKind,'no_faces');assert.equal(value.catalogueReadProof,null);assert.equal(value.frameEvidenceRefs.length,20);
  assert.deepEqual(value.queries,[]);assert.deepEqual(h.counters,{group:0,load:0,query:0,stop:0});
  assert.equal(assessCatalogueActors({groups:catalogueAssessmentGroups(value),policy:h.basis.selectionPolicy}).status,'no_faces');
});
test('a successful search with real neighbors and no eligible candidate is different from an empty invalid response',async()=>{
  const h=harness({noMatch:true}),value=await h.observer.observe(h.request('initial',[batch(h.basis,'initial',point=>point.stratum<3)]));
  assert.equal(value.resultKind,'observed');assert.equal(value.queries.length,3);
  assert.equal(assessCatalogueActors({groups:catalogueAssessmentGroups(value),policy:h.basis.selectionPolicy}).status,'no_match');
  const invalid=harness({emptyRaw:true});await assert.rejects(()=>invalid.observer.observe(invalid.request('initial',[
    batch(invalid.basis,'initial',()=>true)])),{code:'BUFFALO_CATALOGUE_OBSERVATION_INVALID'});
});
test('foreign generations, changed bytes and duplicate source batches fail instead of creating actor candidates',async()=>{
  const h=harness({wrongGeneration:true});await assert.rejects(()=>h.observer.observe(h.request('initial',[batch(h.basis,'initial',()=>true)])),
    {code:'BUFFALO_CATALOGUE_OBSERVER_INVALID'});assert.equal(h.counters.query,0);
  const valid=harness(),source=batch(valid.basis,'initial',()=>true),corrupt=JSON.parse(canonicalJson(source));corrupt.embeddingSet.vectors[0][0]=0.5;
  await assert.rejects(()=>valid.observer.observe(valid.request('initial',[corrupt])),{code:'BUFFALO_CATALOGUE_OBSERVER_INVALID'});
  await assert.rejects(()=>valid.observer.observe(valid.request('initial_and_supplement',[source,source])),{code:'BUFFALO_CATALOGUE_OBSERVER_INVALID'});
});
test('resource changes and late CPU replies remain failures and never become a no-match success',async()=>{
  for(const [overrides,code]of [[{queryError:true},'FACE_CATALOGUE_FILES_CHANGED'],[{late:true},'STOPPED']]){
    const h=harness(overrides);await assert.rejects(()=>h.observer.observe(h.request('initial',[batch(h.basis,'initial',()=>true)])),{code});
    assert.equal(h.counters.stop,1);
  }
});
test('full raw candidate Evidence respects the Artifact budget without silently truncating aliases or queries',async()=>{
  const h=harness({large:true}),sources=['initial','supplement'].map(stage=>batch(h.basis,stage,()=>true,true));
  await assert.rejects(()=>h.observer.observe(h.request('initial_and_supplement',sources)),{code:'BUFFALO_CATALOGUE_OBSERVATION_BUDGET_EXCEEDED'});
  assert.ok(h.counters.query>20);assert.ok(h.counters.query<40);
});
test('persisted Observations reject a missing no-face frame or query even when a caller recomputes the outer digest',async()=>{
  const h=harness(),value=await h.observer.observe(h.request('initial',[batch(h.basis,'initial',point=>point.stratum<3)]));
  for(const mutate of [x=>x.frameEvidenceRefs.pop(),x=>x.queries.pop(),x=>x.queries[0].result.matches[0].combinedDistance=0.01]){
    const changed=JSON.parse(canonicalJson(value));mutate(changed);
    changed.queries.forEach(query=>query.resultDigest=D(query.result));const {observationDigest,...body}=changed;changed.observationDigest=D(body);
    assert.throws(()=>assertCatalogueObservation(changed),{code:'BUFFALO_CATALOGUE_OBSERVATION_INVALID'});
  }
});
