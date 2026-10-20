'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const {buildJavCorrectionScope,buildJavCorrectionSourceVerified}=require('../../src/helix/domains/arca/model/jav-correction-execution-contract');
const {buildJavCorrectionCast}=require('../../src/helix/domains/arca/model/jav-correction-cast');
const {buildJavCorrectionInventoryChange,buildJavCorrectionControlChanges}=require('../../src/helix/domains/arca/model/jav-correction-inventory-change');
const {physicalIdentityFromInventoryRow}=require('../../src/helix/domains/arca/model/aftercare-contract');
const fixture=require('./fixtures/jav-correction');
function input() {
  const {raw}=fixture.context(),root=path.resolve('correction-inventory-fixture');raw.shelf.target_root_location=root;
  const roles=['primary_payload','metadata_sidecar','poster','fanart'],names=['movie.mkv','movie.nfo','poster.jpg','fanart.jpg'];
  raw.materials=roles.map((role,ordinal)=>{
    const tuple={mountScopeId:'mount',inode:String(ordinal+1),sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('old-'+ordinal)};
    return {...raw.materials[0],ordinal,role,material_key:D({schema:'physical-material-identity@2',...tuple}),inode:tuple.inode,content_fingerprint:tuple.contentFingerprint,
      location:path.join(root,'old',names[ordinal]),digest_hex:tuple.contentFingerprint,artifact_scope_schema_ref:null,artifact_scope_json:null};
  });
  raw.facts=['resolved_identity','product_metadata','media_cast','product_media_verification','decision_fact'].map((fact_kind,index)=>({fact_kind,
    fact_revision:1,fact_schema_ref:'helix://test/'+fact_kind+'/v1',fact_json:canonicalJson({oldFact:fact_kind}),fact_digest:D({oldFact:fact_kind}),
    provenance_digest:D('old-'+index),source_package_id:'original-package',episode_metadata_schema_ref:null,episode_metadata_json:null}));
  raw.people=[{relation_id:'old-actor',display_name:'Old Actor',relation_digest:D('old-cast')}];
  raw.related=[{reference_id:'shared-original',location:'external-shared-file'}];
  const controlProjections=raw.materials.map(row=>({materialKey:row.material_key,resultKind:'available',controlState:'controlled',ownerDomain:'arca',
    ownerScopeType:'shelf_entry',ownerScopeId:'entry',controlRevision:1,projectionDigest:fixture.digest('control')})),basis=buildJavCorrectionBasis({raw,controlProjections}),
    qualification=fixture.source(),proposal=buildJavCorrectionProposal({basis,...qualification}),
    record={state:'active',stateRevision:2,correctionId:'arca-jav-correction-'+fixture.digest('case').slice(0,40),shelfEntryId:'entry',admissionDigest:D('admission'),proof:{basis,proposal,
      paths:raw.materials.map((row,index)=>({materialKey:row.material_key,role:row.role,previousLocation:row.location,targetEndpointId:'target',targetLocation:path.join(root,'new',names[index])}))}},
    scope=buildJavCorrectionScope(record,D('root')),verified=buildJavCorrectionSourceVerified(record,scope,qualification.observation,100,
      ['metadata','nfo','poster','fanart'].map(kind=>({kind,byteDigest:D('new-'+kind),sizeBytes:100}))),
    members=basis.materials.map((original,index)=>({ordinal:index,role:original.role,original,targetLocation:record.proof.paths[index].targetLocation,targetEndpointId:'target',
      source:index===0?{kind:'retained_inventory',workspaceMaterialHandle:null,artifactHandle:null}:
        {kind:'correction_artifact',workspaceMaterialHandle:{materialKey:D('workspace-'+index),digestHex:D('new-'+['','nfo','poster','fanart'][index])}}})),
    body={correctionId:record.correctionId,shelfEntryId:'entry',admissionDigest:record.admissionDigest,scopeDigest:scope.digest,verifiedSourcePayloadDigest:verified.payloadDigest,
      target:{rootLocation:root,endpointId:'target'},members},plan={...body,planDigest:D(body)},
    stagedMembers=members.map((member,index)=>{
      const tuple={mountScopeId:'mount',inode:String(index===0?1:100+index),sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,
        contentFingerprint:index===0?raw.materials[0].content_fingerprint:D('new-content-'+index)},
        physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,...tuple,materialKey:D({schema:'physical-material-identity@2',...tuple})};
      return {sourceMaterialKey:index===0?raw.materials[0].material_key:member.source.workspaceMaterialHandle.materialKey,role:member.role,endpointId:'target',
        physicalIdentity,location:path.join(root,'stage',names[index]),fullByteDigest:index===0?D('video-bytes'):member.source.workspaceMaterialHandle.digestHex};
    }),manifestBody={sourceProductManifestDigest:plan.planDigest,targetCommitSlotId:'slot',memberCount:4,stagedMembers,
      membersDigest:D({schema:'arca.staged-inventory-members@1',items:stagedMembers})},manifest={...manifestBody,manifestDigest:D(manifestBody)},
    bindings=stagedMembers.map((member,index)=>({materialKey:member.physicalIdentity.materialKey,endpointId:member.endpointId,location:members[index].targetLocation,bindingRevision:2})),
    publication={scopeType:'jav_identity_correction',scopeId:record.correctionId,scopeDigest:plan.planDigest,targetCommitSlotId:'slot',finalBindingSetDigest:D(bindings)},
    verification={result:'passed',verificationKind:'final_product',basisDigest:scope.digest,productManifestDigest:plan.planDigest,relatedDispositionSetDigest:basis.relatedSetDigest,
      finalBindingSetDigest:publication.finalBindingSetDigest,verifiedMaterialKeys:stagedMembers.map(item=>item.physicalIdentity.materialKey),
      memberEvidence:stagedMembers.map(item=>({sourceProductMaterialKey:item.sourceMaterialKey,role:item.role,actualPhysicalIdentity:item.physicalIdentity}))},
    cast=buildJavCorrectionCast({correctionId:record.correctionId,admissionDigest:record.admissionDigest,basis,proposal,
      resolutions:fixture.castResolutions({correctionId:record.correctionId,admissionDigest:record.admissionDigest,basis,proposal})});
  return {record,scope,raw,controlProjections,verified,plan,manifest,publication,verification,cast,committedAtMs:200};
}
test('correction Inventory advances both revisions, retains video and original admission, and replaces old identity metadata and cast only',()=>{
  const value=input(),before=canonicalJson(value),change=buildJavCorrectionInventoryChange(value),video=change.materials.find(row=>row.role==='primary_payload');
  assert.equal(change.previousCanonicalIdentityRevision,1);assert.equal(change.newCanonicalIdentityRevision,2);
  assert.equal(change.previousInventoryRevision,1);assert.equal(change.newInventoryRevision,2);assert.equal(change.shelfEntryId,'entry');
  assert.equal(video.material_key,value.raw.materials[0].material_key);assert.equal(video.location,value.record.proof.paths[0].targetLocation);
  assert.equal(physicalIdentityFromInventoryRow(video).contentFingerprint,value.raw.materials[0].content_fingerprint);
  assert.deepEqual(change.related,value.raw.related);
  assert.deepEqual(change.people.map(item=>({personId:item.person_id,name:item.display_name,role:item.role})),
    [{personId:'person-jav-unknown-actor',name:'未知演员',role:'actor'}]);
  for(const kind of ['resolved_identity','product_metadata','media_cast']) {
    const row=change.facts.find(row=>row.fact_kind===kind);assert.equal(row.fact_revision,2);assert.equal(row.source_package_id,'original-package');
    assert.doesNotMatch(row.fact_json,/Old Actor|oldFact|IPX-177/);
  }
  assert.deepEqual(change.facts.find(row=>row.fact_kind==='product_media_verification'),value.raw.facts.find(row=>row.fact_kind==='product_media_verification'));
  assert.deepEqual(change.facts.find(row=>row.fact_kind==='decision_fact'),value.raw.facts.find(row=>row.fact_kind==='decision_fact'));
  assert.equal(change.originalCommitDigest,value.record.proof.basis.originalCommitDigest);assert.equal(canonicalJson(value),before);
  assert.equal(change.changeDigest,D(Object.fromEntries(Object.entries(change).filter(([key])=>key!=='changeDigest'))));
});
test('correction Inventory refuses changed admission, current Control, proof, final binding, old cast and unapproved target',()=>{
  for(const mutate of [v=>{v.raw.entry.current_inventory_revision=2;},v=>{v.controlProjections[0].controlRevision=2;},
    v=>{v.verification.result='failed';},v=>{v.verification.memberEvidence[0].actualPhysicalIdentity.materialKey=D('foreign');},
    v=>{v.publication.finalBindingSetDigest=D('foreign');},v=>{v.cast.relations.push({displayName:'Old Actor'});},
    v=>{v.plan.members[0].targetLocation=path.resolve('unapproved.mkv');},v=>{v.activeCases=[{state:'active'}];}]) {
    const value=structuredClone(input());mutate(value);assert.throws(()=>buildJavCorrectionInventoryChange(value));
  }
});
test('Control change retains the exact original video revision, releases only replaced metadata and acquires only unowned new members',()=>{
  const value=input(),change=buildJavCorrectionInventoryChange(value),oldKeys=new Set(value.raw.materials.map(row=>row.material_key)),
    projections=[...value.controlProjections,...change.materials.filter(row=>!oldKeys.has(row.material_key)).map(row=>({materialKey:row.material_key,
      resultKind:'available',controlState:'uncontrolled',controlRevision:0,projectionDigest:D(row.material_key)}))],
    changes=buildJavCorrectionControlChanges(change,value.record.proof.basis,projections);
  assert.equal(changes.filter(item=>item.action==='assert_same_field').length,1);
  assert.equal(changes.filter(item=>item.action==='release').length,3);assert.equal(changes.filter(item=>item.action==='acquire').length,3);
  assert.ok(changes.every(item=>(item.fromScope||item.toScope).scopeId==='entry'));
  for(const mutate of [p=>{p[0].ownerScopeId='other-entry';},p=>{p[0].controlRevision=2;},p=>{p[4].controlState='controlled';},
    p=>{p[4].resultKind='unavailable';},p=>{p.pop();},p=>{p.push(p[0]);}]) {
    const changed=structuredClone(projections);mutate(changed);assert.throws(()=>buildJavCorrectionControlChanges(change,value.record.proof.basis,changed),
      {code:'ARCA_JAV_CORRECTION_INVENTORY_INVALID'});
  }
});

test('verified cross-volume video copy changes physical Control without replacing its bytes or original quality and admission facts',()=>{
  const value=structuredClone(input()),identity=value.manifest.stagedMembers[0].physicalIdentity,
    tuple={mountScopeId:'another-mount',inode:'300',sizeBytes:identity.sizeBytes,fingerprintAlgorithm:identity.fingerprintAlgorithm,
      fingerprintVersion:identity.fingerprintVersion,contentFingerprint:identity.contentFingerprint};
  value.manifest.stagedMembers[0].physicalIdentity={schemaRef:identity.schemaRef,schemaVersion:2,...tuple,materialKey:D({schema:'physical-material-identity@2',...tuple})};
  value.manifest.membersDigest=D({schema:'arca.staged-inventory-members@1',items:value.manifest.stagedMembers});
  const {manifestDigest,...body}=value.manifest;value.manifest.manifestDigest=D(body);
  value.verification.memberEvidence[0].actualPhysicalIdentity=value.manifest.stagedMembers[0].physicalIdentity;
  value.verification.verifiedMaterialKeys[0]=value.manifest.stagedMembers[0].physicalIdentity.materialKey;
  value.verification.finalBindingSetDigest=value.publication.finalBindingSetDigest=D(value.manifest.stagedMembers.map((member,index)=>({materialKey:member.physicalIdentity.materialKey,
    endpointId:member.endpointId,location:value.plan.members[index].targetLocation,bindingRevision:2})));
  const change=buildJavCorrectionInventoryChange(value),oldKeys=new Set(value.raw.materials.map(row=>row.material_key)),
    projections=[...value.controlProjections,...change.materials.filter(row=>!oldKeys.has(row.material_key)).map(row=>({materialKey:row.material_key,
      resultKind:'available',controlState:'uncontrolled',controlRevision:0,projectionDigest:D(row.material_key)}))],
    changes=buildJavCorrectionControlChanges(change,value.record.proof.basis,projections);
  assert.equal(changes.filter(item=>item.action==='release').length,4);assert.equal(changes.filter(item=>item.action==='acquire').length,4);
  assert.equal(change.materials[0].content_fingerprint,value.raw.materials[0].content_fingerprint);
  assert.equal(change.materials[0].digest_hex,value.manifest.stagedMembers[0].fullByteDigest);
  assert.equal(change.originalCommitDigest,value.record.proof.basis.originalCommitDigest);
  assert.deepEqual(change.facts.find(row=>row.fact_kind==='product_media_verification'),value.raw.facts.find(row=>row.fact_kind==='product_media_verification'));
});
