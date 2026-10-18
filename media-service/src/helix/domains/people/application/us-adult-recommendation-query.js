'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
function fail(code,message){throw Object.assign(new Error(message),{code});}
function recommendationId(windowKey,group){return canonicalDigest({schema:'people.us-adult-recommendation-id@1',windowKey,groupId:group.groupId,
  sourceDigest:group.representative.source.sourceDigest,evidenceDigest:group.representative.image.evidenceDigest});}
function createUsAdultRecommendationQuery(options){
  if(typeof options?.store?.readPublication!=='function'||typeof options.sources?.readSource!=='function'||typeof options.images?.readImage!=='function')
    throw new TypeError('Recommendation queries require published Owner snapshots and exact read-only Source/image ports.');
  const now=options.now||Date.now;
  function selected(id){
    if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('PEOPLE_RECOMMENDATION_INPUT_INVALID','推荐标识无效。');
    const publication=options.store.readPublication(now()),group=publication?.items.find(item=>recommendationId(publication.windowKey,item)===id);
    if(!group)fail('PEOPLE_RECOMMENDATION_NOT_FOUND','该推荐已不在当前快照中，请刷新演员页。');
    options.sources.readSource(group.representative.source);return Object.freeze({publication,group,recommendationId:id});
  }
  return Object.freeze({
    current(){
      const publication=options.store.readPublication(now());if(!publication)return Object.freeze({publication:null,items:Object.freeze([])});
      const items=[];
      for(const group of publication.items){
        try{options.sources.readSource(group.representative.source);}catch(error){if(error.code==='US_ADULT_RECOMMENDATION_SOURCE_STALE')continue;throw error;}
        const id=recommendationId(publication.windowKey,group),source=group.representative.source;
        items.push(Object.freeze({recommendationId:id,coverageCount:group.coverageCount,qualityScore:group.representative.image.qualityScore,
          source:Object.freeze({subjectId:source.subjectId,libraRunId:source.libraRunId,title:source.originalName.originalFileName}),
          imageUrl:'/v1/admin/people/recommendations/'+id+'/image'}));
      }
      return Object.freeze({publication:Object.freeze({windowKey:publication.windowKey,revision:publication.publicationRevision,snapshotDigest:publication.snapshotDigest}),items:Object.freeze(items)});
    },
    read:selected,
    async image(id){const {group}=selected(id);return options.images.readImage({source:group.representative.source,expectedEvidenceDigest:group.representative.image.evidenceDigest});},
  });
}
module.exports=Object.freeze({recommendationId,createUsAdultRecommendationQuery});
