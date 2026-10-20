'use strict';
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const {buildJavQueryAnchor,buildJavSourceSelectionSnapshot}=require('../../../src/helix/contracts/jav-source-contracts');
const digest=value=>canonicalDigest({value});
function context() {
  const tuple={mountScopeId:'mount',inode:'1',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:digest('video')};
  const key=canonicalDigest({schema:'physical-material-identity@2',...tuple});
  return {shelfEntryId:'entry',raw:{entry:{shelf_entry_id:'entry',shelf_id:'shelf',status:'active',structure_kind:'single',canonical_identity_revision:1,
    canonical_identity_key:canonicalDigest({schema:'arca.canonical-jav-identity-key@1',shelfId:'shelf',provider:'jav',namespace:'jav_code',providerKey:'IPX-177'}),
    current_inventory_revision:1,current_deck_fact_revision:1},shelf:{shelf_id:'shelf',status:'active',current_standard_revision:1,current_placement_revision:1,
      target_endpoint_id:'target',target_root_location:'shelf',target_mount_scope_id:'mount',target_mount_scope_revision:1},
    identity:{identity_kind:'jav_code',provider:'jav',provider_key:'IPX-177',identity_digest:digest('original-identity')},
    inventory:{source_package_id:'original-package',representation_digest:digest('inventory')},standard:{standard_digest:digest('standard')},
    placement:{revision:1,policy_digest:digest('placement'),value:{}},onDeckCommit:{receipt_id:'original-commit',commit_digest:digest('commit')},
    materials:[{ordinal:0,role:'primary_payload',material_key:key,mount_scope_id:tuple.mountScopeId,inode:tuple.inode,size_bytes:tuple.sizeBytes,
      fingerprint_algorithm:tuple.fingerprintAlgorithm,fingerprint_version:tuple.fingerprintVersion,content_fingerprint:tuple.contentFingerprint,
      endpoint_id:'target',location:'shelf/IPX-177.mkv',binding_revision:1,episode_claims_json:'{"items":[]}',episode_claim_set_digest:canonicalDigest({schema:'libra.production-material-episode-claims@1',items:[]})}],
    facts:[{fact_kind:'product_metadata',fact_digest:digest('metadata'),value:{descriptiveFacts:{entries:[{key:'title',value:'Original film'}]}}}],people:[],related:[],reservations:[]}};
}
function handle(siteRef='javdb',configRevision=1) {
  return {integrationType:'jav_source',integrationId:'jav-'+siteRef,configRevision,siteRef,authMode:'anonymous',allowedOperation:'shared.integration.search@1',
    endpointProfileDigest:digest(siteRef+'-endpoint'),networkRouteDigest:digest('direct')};
}
function observation(siteRef='javdb',result='qualified',javCode='IPX-178') {
  const anchor=buildJavQueryAnchor('jav_code',javCode),source=handle(siteRef);
  let body={schema:'integration.jav-source-observation@1',siteRef,queryAnchorDigest:anchor.anchorDigest,endpointProfileDigest:source.endpointProfileDigest,
    networkRouteDigest:source.networkRouteDigest,result,pages:[]};
  if(result==='qualified') {
    const identity={provider:'jav',namespace:'jav_code',providerKey:javCode,seasonNumber:null};
    body={...body,resourceKey:'new-film',resourceUrl:'https://javdb.com/v/new-film',resolvedProviderIdentity:{...identity,identityAnchorDigest:canonicalDigest(identity)},
      descriptiveEntries:[{key:'title',value:'Correct film'},{key:'studio',value:'Only selected site'}],peopleHints:[],cover:{locator:'https://c0.jdbstatic.com/cover.jpg',
        byteDigest:digest('cover'),byteCount:100,width:800,height:600,format:'jpeg'}};
  } else body={...body,candidates:[],reasonCode:'no_exact_match'};
  return {...body,observationDigest:canonicalDigest(body)};
}
function source() {
  const sourceHandle=handle(),{integrationType,allowedOperation,...item}=sourceHandle;
  const sourceSnapshot=buildJavSourceSelectionSnapshot({ruleRef:'arca.jav-correction-single-source@1',ruleRevision:1,ruleDigest:digest('rule'),
    queryAnchor:buildJavQueryAnchor('jav_code','IPX-178'),sources:[{ordinal:0,queryKind:'jav_code',...item}]});
  return {sourceSnapshot,sourceOrdinal:0,observation:observation()};
}
function castResolutions(input) {
  const {castQueries}=require('../../../src/helix/domains/arca/model/jav-correction-cast');
  const {buildJavCorrectionMetadata}=require('../../../src/helix/domains/arca/model/jav-correction-metadata');
  const {createMediaCastReferenceQuery}=require('../../../src/helix/domains/people/application/media-cast-reference-query');
  const query=createMediaCastReferenceQuery({getPerson:personId=>personId==='person-jav-unknown-actor'?{
    personId,libraryKind:'jav',status:'active',currentRevision:1,revision:{factDigest:digest('reserved-person')}}:null,
    findActivePersonByProviderIdentity:()=>null,findUserAcceptedRegistrationPerson:()=>null});
  return castQueries(buildJavCorrectionMetadata(input)).map(item=>({relationId:item.relationId,inputDigest:item.inputDigest,result:query.resolve(item.input)}));
}
module.exports={context,handle,observation,source,digest,castResolutions};
