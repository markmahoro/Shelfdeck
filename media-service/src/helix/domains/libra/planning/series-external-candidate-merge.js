'use strict';
const {canonicalDigest:d}=require('../../../contracts/canonical-json');
const {buildSeriesReplacementMapping}=require('../model/series-external-replacement');
const {buildSeriesMediaSpaceBasis}=require('../model/series-media-space');
const {replacementBasis}=require('./external-material-work');
function mergeSeriesExternalCandidates(snapshot,original,externalSets) {
  const basis=replacementBasis(snapshot),removed=new Set(),added=[];
  if(new Set(original.map(item=>item.member.materialKey)).size!==original.length||
      original.length!==basis.members.length||basis.members.some(member=>!original.some(item=>item.member.materialKey===member.materialKey)))
    throw new Error('External replacement requires the complete original candidate set.');
  for(const set of externalSets){
    if(!set.eligible||set.members.some(item=>!item.eligible))throw new Error('External replacement cannot select an ineligible import set.');
    const mapping=buildSeriesReplacementMapping({basis,scope:set.scope,finalMembers:set.members.map(item=>({
      materialKey:item.importRecord.result.materialKey,memberDigest:d({externalMember:item.externalMember,workspaceMediaHandle:item.workspaceMediaHandle}),
      episodeKeys:item.externalMember.episodeClaims.map(claim=>claim.episodeKey)}))});
    if(d(mapping)!==d(set.mapping))throw new Error('External replacement mapping differs from the complete imported set.');
    for(const source of set.scope.members){
      if(removed.has(source.materialKey))throw new Error('External replacement scopes overlap.');
      removed.add(source.materialKey);
    }
    for(const item of set.members){
      const handle=item.importRecord.result,keys=item.externalMember.episodeClaims.map(claim=>claim.episodeKey),
        claims=snapshot.episodeClaims.filter(claim=>keys.includes(claim.episodeKey));
      if(claims.length!==keys.length)throw new Error('Imported candidate lacks exact accepted Episode Claims.');
      // This is a Workspace candidate projection, never a fabricated original
      // Run Binding. Its predecessor set is carried separately by the mapping.
      const member=Object.freeze({materialKey:handle.materialKey,role:'primary_payload',physicalIdentity:handle.physicalIdentity,
        sizeBytes:handle.sizeBytes,episodeClaims:Object.freeze(claims)});
      added.push(Object.freeze({member,readHandle:handle,record:item.probeRecord,work:set.work,media:item.workspaceMediaHandle,
        mediaRecord:item.importRecord,probeRecord:item.probeRecord,verification:item.verificationRecord.result,selection:item.selectionRecord.result,
        verificationRecord:item.verificationRecord,selectionRecord:item.selectionRecord,eligible:true,
        externalReplacement:Object.freeze({scope:set.scope,mapping,externalMember:item.externalMember})}));
    }
  }
  const merged=[...original.filter(item=>!removed.has(item.member.materialKey)),...added];
  if(new Set(merged.map(item=>item.member.materialKey)).size!==merged.length)throw new Error('External replacement duplicates a retained material.');
  return Object.freeze(merged.sort((a,b)=>Buffer.from(a.member.materialKey).compare(Buffer.from(b.member.materialKey))));
}
function assertExternalCandidateSets(candidates) {
  const scopes=new Map();
  for(const item of candidates.filter(item=>item.externalReplacement)){
    const {scope,mapping}=item.externalReplacement;
    if(mapping.scopeDigest!==scope.scopeDigest)throw new Error('External candidate scope and mapping differ.');
    const previous=scopes.get(scope.scopeDigest);
    if(previous&&d(previous.mapping)!==d(mapping))throw new Error('External candidate mappings conflict.');
    scopes.set(scope.scopeDigest,{scope,mapping});
  }
  for(const {scope,mapping} of scopes.values()){
    const actual=candidates.filter(item=>item.externalReplacement?.scope.scopeDigest===scope.scopeDigest);
    if(actual.length!==mapping.finalMembers.length||mapping.finalMembers.some(member=>!actual.some(item=>item.member.materialKey===member.materialKey))||
        candidates.some(item=>scope.members.some(source=>source.materialKey===item.member.materialKey)))
      throw new Error('Final candidates omit an external member or retain a replaced original.');
  }
}
function completeSeriesCandidateSpace(snapshot,candidates) {
  assertExternalCandidateSets(candidates);
  const basis=replacementBasis(snapshot),expected=new Set(basis.members.map(item=>item.materialKey)),scopes=new Map();
  for(const item of candidates.filter(item=>item.externalReplacement)){
    const {scope,mapping}=item.externalReplacement;
    scopes.set(scope.scopeDigest,{scope,mapping});
  }
  for(const {scope,mapping} of scopes.values()){
    const imported=candidates.filter(item=>item.externalReplacement?.scope.scopeDigest===scope.scopeDigest);
    const rebuilt=buildSeriesReplacementMapping({basis,scope,finalMembers:imported.map(item=>({
      materialKey:item.member.materialKey,memberDigest:d({externalMember:item.externalReplacement.externalMember,workspaceMediaHandle:item.media}),
      episodeKeys:item.member.episodeClaims.map(claim=>claim.episodeKey)}))});
    if(d(rebuilt)!==d(mapping))throw new Error('Final external candidate differs from its frozen replacement mapping.');
    for(const item of imported){
      const claims=snapshot.episodeClaims.filter(claim=>item.member.episodeClaims.some(actual=>actual.episodeKey===claim.episodeKey));
      if(d(claims)!==d(item.member.episodeClaims)||d(item.readHandle)!==d(item.media.workspaceMaterialHandle))
        throw new Error('Final external candidate Claims or Workspace Handle drifted.');
    }
    for(const member of scope.members)expected.delete(member.materialKey);
    for(const member of mapping.finalMembers)expected.add(member.materialKey);
  }
  if(candidates.length!==expected.size||new Set(candidates.map(item=>item.member.materialKey)).size!==expected.size||
      candidates.some(item=>!expected.has(item.member.materialKey)))throw new Error('Final candidates do not cover the complete frozen Run.');
  for(const item of candidates.filter(item=>!item.externalReplacement&&item.media))
    if(item.media.sourceMaterialHandleDigest!==d(item.readHandle))throw new Error('Internal candidate source Handle drifted.');
  return buildSeriesMediaSpaceBasis({libraRunId:snapshot.run.libraRunId,runExecutionBasisDigest:snapshot.run.executionBasisDigest,
    episodeKeys:snapshot.spec.productScope.episodeKeys,members:candidates.map(item=>{
      const handle=item.media?.workspaceMaterialHandle||item.readHandle;
      return {materialKey:item.member.materialKey,memberDigest:d(item.member),handleDigest:d(handle),probeDigest:d(item.probeRecord.result),
        sizeBytes:handle.sizeBytes??handle.expectedSizeBytes,episodeKeys:item.member.episodeClaims.map(claim=>claim.episodeKey)};
    })});
}
module.exports=Object.freeze({mergeSeriesExternalCandidates,assertExternalCandidateSets,completeSeriesCandidateSpace});
