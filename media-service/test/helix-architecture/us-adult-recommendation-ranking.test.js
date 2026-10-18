'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {setupSources}=require('./fixtures/us-adult-recommendation-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const model=require('../../src/helix/domains/people/model/us-adult-recommendations');
function fixture(input){
  const base=setupSources(input).query.listSources({schemaRef:'helix://contracts/domain-types/UsAdultRecommendationPageQuery/v1',schemaVersion:1,cursor:null,limit:32}).items[0];
  return (id,quality=0.5,vector=[1,...Array(127).fill(0)])=>{
    const {sourceDigest,...sourceBody}=structuredClone(base);sourceBody.sourceId=D(id);sourceBody.libraRunId='synthetic-run-'+id;sourceBody.subjectId='synthetic-subject-'+id;
    const source={...sourceBody,sourceDigest:D(sourceBody)},imageBody={schema:'people.us-adult-recommendation-image-evidence@1',sourceDigest:source.sourceDigest,
      modelRefDigest:source.faceEmbeddingSetHandle.faceModelRefDigest,analysisDigest:D('analysis'),clusterId:'cluster',clusterFaceCount:20,faceDigest:D(id+'-face'),
      frameOrdinal:0,imageDigest:D(id+'-image'),width:640,height:480,box:{x:10,y:10,width:100,height:100},qualityScore:quality,vector};
    return model.observation(source,{...imageBody,evidenceDigest:D(imageBody)});
  };
}
test('recommendation grouping resumes bounded comparison pages and deterministically breaks equal-score ties',()=>harness(input=>{
  const make=fixture(input),candidate=make('new'),groups=['a','b','c'].map(id=>model.addToGroup(null,make(id))),
    first=model.bestGroup(candidate,groups.slice(0,1)),all=model.bestGroup(candidate,groups.slice(1),first);
  assert.equal(all.groupId,groups.map(group=>group.groupId).sort()[0]);assert.equal(all.score,1);
  assert.deepEqual(model.bestGroup(candidate,[...groups].reverse()),all);
  const other=make('other',0.9,[0,1,...Array(126).fill(0)]);assert.equal(model.bestGroup(other,groups),null);
}));
test('recommendation ranking publishes at most five and prioritizes film coverage before photograph quality',()=>harness(input=>{
  const make=fixture(input),groups=Array.from({length:10},(_,index)=>model.addToGroup(null,make('film-'+index,index/10))),
    covered=model.addToGroup(groups[0],make('another-film',0.2)),ranked=model.rankGroups([covered,...groups.slice(1)]);
  assert.equal(ranked.length,5);assert.equal(ranked[0].groupId,covered.groupId);assert.equal(ranked[0].coverageCount,2);
  assert.equal(ranked[0].representative.image.qualityScore,0.2);assert.equal(ranked[1].representative.image.qualityScore,0.9);
  assert.deepEqual(model.rankGroups(groups.slice(5),model.rankGroups([covered,...groups.slice(1,5)])),ranked);
  assert.throws(()=>model.addToGroup(covered,covered.representative),{code:'PEOPLE_RECOMMENDATION_EVIDENCE_INVALID'});
}));
test('recommendations reject tampered models, features, source evidence and oversized maintenance pages',()=>harness(input=>{
  const make=fixture(input),value=make('source'),group=model.addToGroup(null,value);
  assert.throws(()=>model.bestGroup(value,Array(65).fill(group)),{code:'PEOPLE_RECOMMENDATION_EVIDENCE_INVALID'});
  assert.throws(()=>model.rankGroups(Array(65).fill(group)),{code:'PEOPLE_RECOMMENDATION_EVIDENCE_INVALID'});
  assert.throws(()=>model.rankGroups([group],[group]),{code:'PEOPLE_RECOMMENDATION_EVIDENCE_INVALID'});
  for(const change of [
    image=>{image.modelRefDigest=D('another-model');},image=>{image.vector[0]=0;},image=>{image.sourceDigest=D('another-source');},
  ]){const image=structuredClone(value.image);change(image);const {evidenceDigest,...body}=image;image.evidenceDigest=D(body);
    assert.throws(()=>model.observation(value.source,image),{code:'PEOPLE_RECOMMENDATION_EVIDENCE_INVALID'});}
  const altered=structuredClone(group);altered.coverageCount=2;
  assert.throws(()=>model.rankGroups([altered]),{code:'PEOPLE_RECOMMENDATION_EVIDENCE_INVALID'});
}));
