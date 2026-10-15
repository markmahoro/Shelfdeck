'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavQueryAnchor,buildJavSourceSelectionSnapshot}=require('../../src/helix/contracts/jav-source-contracts');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const d=value=>canonicalDigest({value});
const oldKey=canonicalDigest({schema:'arca.canonical-jav-identity-key@1',shelfId:'shelf',provider:'jav',namespace:'jav_code',providerKey:'IPX-177'});
function current() {
  const primary={ordinal:0,role:'primary_payload',mount_scope_id:'mount',inode:'1',size_bytes:100,
    fingerprint_algorithm:'middle-256k-sha256',fingerprint_version:1,content_fingerprint:d('video'),endpoint_id:'endpoint',location:'shelf/IPX-177.mkv',binding_revision:1};
  primary.material_key=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:'mount',inode:'1',sizeBytes:100,
    fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:d('video')});
  const raw={entry:{shelf_entry_id:'entry',shelf_id:'shelf',status:'active',structure_kind:'single',canonical_identity_revision:1,
    canonical_identity_key:oldKey,current_inventory_revision:2,current_deck_fact_revision:2},
    shelf:{shelf_id:'shelf',status:'active',current_standard_revision:1,current_placement_revision:1,target_endpoint_id:'endpoint',target_root_location:'shelf',target_mount_scope_id:'mount',target_mount_scope_revision:1},
    identity:{identity_kind:'jav_code',provider:'jav',provider_key:'IPX-177',identity_digest:d('old-identity')},
    inventory:{source_package_id:'original-package',representation_digest:d('inventory')},standard:{standard_digest:d('standard')},
    placement:{policy_digest:d('placement')},onDeckCommit:{receipt_id:'original-commit',commit_digest:d('commit')},materials:[primary],facts:[],people:[],related:[],reservations:[]};
  const controlProjections=[{materialKey:primary.material_key,resultKind:'available',controlState:'controlled',ownerDomain:'arca',
    ownerScopeType:'shelf_entry',ownerScopeId:'entry',controlRevision:3,projectionDigest:d('control')}];
  return {raw,controlProjections};
}
function source() {
  const queryAnchor=buildJavQueryAnchor('jav_code','IPX-178'),sourceSnapshot=buildJavSourceSelectionSnapshot({ruleRef:'arca.jav-correction-single-source@1',
    ruleRevision:1,ruleDigest:d('rule'),queryAnchor,sources:[{ordinal:0,siteRef:'javdb',integrationId:'jav-javdb-main',configRevision:1,
      authMode:'anonymous',queryKind:'jav_code',endpointProfileDigest:d('endpoint-profile'),networkRouteDigest:d('direct')}]});
  const identity={provider:'jav',namespace:'jav_code',providerKey:'IPX-178',seasonNumber:null},body={schema:'integration.jav-source-observation@1',
    siteRef:'javdb',result:'qualified',pages:[],queryAnchorDigest:queryAnchor.anchorDigest,endpointProfileDigest:d('endpoint-profile'),networkRouteDigest:d('direct'),
    resourceKey:'new-native-film',resourceUrl:'https://javdb.com/v/new-native-film',resolvedProviderIdentity:{...identity,identityAnchorDigest:canonicalDigest(identity)},
    descriptiveEntries:[{key:'title',value:'Correct film'}],peopleHints:[],cover:{locator:'https://c0.jdbstatic.com/new.jpg',byteDigest:d('cover'),byteCount:100,width:800,height:600,format:'jpeg'}};
  return {sourceSnapshot,sourceOrdinal:0,observation:{...body,observationDigest:canonicalDigest(body)}};
}
test('Arca correction proposal changes canonical film identity while retaining Entry, Shelf, video and original admission provenance',()=>{
  const state=current(),before=canonicalDigest(state),basis=buildJavCorrectionBasis(state),proposal=buildJavCorrectionProposal({basis,...source()});
  assert.equal(proposal.shelfEntryId,'entry');assert.equal(proposal.shelfId,'shelf');assert.equal(proposal.oldJavCode,'IPX-177');assert.equal(proposal.newJavCode,'IPX-178');
  assert.equal(proposal.retainedPrimaryMaterialKey,state.raw.materials[0].material_key);assert.equal(basis.originalSourcePackageId,'original-package');
  assert.equal(proposal.newIdentity.subjectId,undefined);assert.equal(proposal.newIdentity.libraRunId,undefined);
  assert.equal(canonicalDigest(state),before);
});
test('Arca correction refuses foreign Control, busy Entry, missing Primary and unqualified or mismatched source',()=>{
  const state=current();
  assert.throws(()=>buildJavCorrectionBasis({...state,controlProjections:[{...state.controlProjections[0],ownerScopeId:'foreign'}]}),{code:'ARCA_JAV_CORRECTION_CONTROL_INVALID'});
  assert.throws(()=>buildJavCorrectionBasis({...state,activeCases:[{state:'active'}]}),{code:'ARCA_JAV_CORRECTION_BUSY'});
  assert.throws(()=>buildJavCorrectionBasis({...state,raw:{...state.raw,materials:[]}}),{code:'ARCA_JAV_CORRECTION_INELIGIBLE'});
  const basis=buildJavCorrectionBasis(state),qualified=source();
  assert.throws(()=>buildJavCorrectionProposal({basis,...qualified,observation:{...qualified.observation,result:'not_found'}}),{code:'ARCA_JAV_CORRECTION_SOURCE_INVALID'});
  assert.throws(()=>buildJavCorrectionProposal({basis,...qualified,sourceOrdinal:1}),{code:'ARCA_JAV_CORRECTION_SOURCE_INVALID'});
});
