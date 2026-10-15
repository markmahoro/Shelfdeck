'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {canonicalDigest:d}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createProductDeliveryReader}=require('../../src/helix/domains/libra/persistence/product-delivery-reader');
const {createAftercareContextReader}=require('../../src/helix/domains/arca/application/aftercare-context-reader');
const {acceptedFinding}=require('../../src/helix/domains/arca/model/accepted-gap-contracts');
const {acceptedProductRequirements}=require('../../src/helix/domains/arca/model/accepted-product-requirements');
const {automaticCaseTargetsAcceptedDefect}=require('../../src/helix/domains/arca/model/accepted-defect-maintenance');
const {projectHealth}=require('../../src/helix/domains/arca/model/aftercare-contract');
const {createAftercareCapabilityPorts}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json')));
function signed(body,key){return {...body,[key]:d(body)};}
function fixture(id='entry') {
 const requirements={mandatoryMedia:{videoCodec:'hevc',minimumRasterClass:'4k',acceptedPrimaryAudioClasses:['truehd']},space:{maxSizeBytes:14*1024**3,maxSizeGiB:14,unit:'product'},metadata:{requiredFieldCodes:[]}};
 const codes=['max_size_exceeded','video_codec_unmet','minimum_raster_unmet','primary_audio_unmet'];
 const manifest=signed({schemaRef:'helix://contracts/application-types/AuthorizedDefectManifest/v1',schemaVersion:1,
  manifestId:'decision-'+id,defectDecisionId:'decision-'+id,libraRunId:'run-'+id,defectCount:1,acknowledgement:'accept_listed_defects',
  waivedRequirementCodes:codes,defects:[{defectCode:'external_source_exhausted',waivedRequirementCodes:codes}]},'manifestDigest');
 const snapshot=signed({schemaRef:'helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1',schemaVersion:1,
  acceptanceSpecId:'spec-'+id,acceptanceSpecRecordDigest:d('spec-'+id),targetShelfId:'shelf',contentProfile:'movie',structureKind:'single',
  shelfStandardRevision:1,shelfStandardDigest:d('standard'),requirements},'snapshotDigest');
 const reference={onDeckPackageId:'package-'+id,expectedPackageDigest:d('package-'+id),shelfId:'shelf'};
 const delivery={resultKind:'found',onDeckPackageId:reference.onDeckPackageId,packageDigest:reference.expectedPackageDigest,
  libraRunId:manifest.libraRunId,shelfId:'shelf',authorizedDefectManifestDigest:manifest.manifestDigest,acceptanceRequirementSnapshot:snapshot};
 const standardValue={profileRuleSets:[{contentProfile:'movie',decisionInputKinds:['rating'],baseRequirements:{mandatoryMedia:{videoCodec:'any',minimumRasterClass:'none',acceptedPrimaryAudioClasses:[]},space:{maxSizeBytes:null}},decisionBranches:[{rating:3,requirements}]}]};
 const raw={entry:{structure_kind:'single',status:'active',current_inventory_revision:1},shelf:{shelf_id:'shelf',target_endpoint_id:'endpoint',current_standard_revision:1,current_placement_revision:1},
  standard:{value:standardValue,standard_digest:d('standard')},identity:{identity_kind:'tmdb_movie',identity_digest:d(id)},inventory:{source_package_id:reference.onDeckPackageId,representation_digest:d('inventory')},materials:[],oldBindings:[],
  placement:{policy_digest:d('placement')},acceptedPackageReference:reference,facts:[{fact_kind:'authorized_defect_manifest',fact_json:JSON.stringify(manifest),fact_digest:manifest.manifestDigest}]};
 const item={shelfEntryId:id,structureKind:'single',inventoryRevision:1,standardRevision:1,placementRevision:1,canonicalIdentity:raw.identity,canonicalIdentityDigest:d(id),sourcePackageId:reference.onDeckPackageId,
  acceptedPackageReference:reference,authorizedDefectManifest:manifest,standardValue,factDigests:[manifest.manifestDigest],decisionFactDigests:[],decisionFacts:[],
  ratingTarget:{targetType:'shelf_entry',targetId:id,targetRevision:1,title:id,year:2000,providerIdentity:'tmdb:1',canonicalIdentityDigest:d(id)},history:{assessments:[],findings:[],cases:[],commits:[]}};
 return {requirements,manifest,snapshot,reference,delivery,raw,item};
}
function readerFor(fixtures,read) {
 return createAftercareContextReader({aftercareStore:{currentContext:id=>fixtures.find(f=>f.item.shelfEntryId===id).raw,
  defectStore:{current:()=>null,currentMany:()=>new Map()},healthProjectionInputs:()=>fixtures.map(f=>f.item)},
  readPerceptionRating:()=>({state:'ready',rating:3,resolutionDigest:d('rating')}),
  readPerceptionRatings:targets=>new Map(targets.map(t=>[t.targetId,{state:'ready',rating:3,resolutionDigest:d('rating')}])),
  productDeliveryPort:{readAcceptedRequirements:read}});
}
test('detail and batch health use frozen rating requirements, preserve damage, and do not write or reread on warm lookup',()=>{
 const f=fixture();let calls=0;const reader=readerFor([f],q=>{calls++;assert.equal(q.packages.length,1);return {items:[f.delivery]};});
 const detail=reader.read('entry'),batch=reader.healthProjectionInputs(['entry'])[0];
 assert.deepEqual(detail.originalRequirements,f.requirements);assert.deepEqual(batch.originalRequirements,f.requirements);assert.equal(calls,1);
 for(const c of [detail,batch])for(const code of f.manifest.waivedRequirementCodes)assert.equal(acceptedFinding(c,{findingKind:'conformance:'+code}),true,code);
 for(const c of [detail,batch])assert.equal(acceptedFinding(c,{findingKind:'custody:primary_missing'}),false);
 const changed={...batch,effectiveRequirements:{...f.requirements,space:{maxSizeBytes:8*1024**3}}};assert.equal(acceptedFinding(changed,{findingKind:'conformance:max_size_exceeded'}),false);
 const history={cases:[],commits:[],assessments:['custody','presentation','conformance'].map(kind=>({assessmentKind:kind,assessmentId:kind,careBasisDigest:batch.basis.digest,result:kind==='conformance'?'degraded':'healthy',assessedAtMs:10})),findings:[{findingId:'size',findingKind:'conformance:max_size_exceeded',assessmentId:'conformance',state:'open',findingDigest:d('size'),repairability:'auto_repair'}]};
 assert.equal(projectHealth(batch,history,20).state,'healthy');assert.equal(projectHealth(batch,history,20).defectAdmission.defectCount,1);
 history.findings.push({findingKind:'custody:primary_missing',assessmentId:'custody',state:'open',repairability:'attention_required'});assert.equal(projectHealth(batch,history,20).state,'attention_required');
 const reopened=readerFor([f],()=>({items:[f.delivery]}));assert.deepEqual(reopened.read('entry').originalRequirements,f.requirements);
});
test('historical requirements reject missing, foreign and tampered evidence instead of granting a waiver',()=>{
 const f=fixture();assert.throws(()=>readerFor([f],()=>({items:[]})).read('entry'),{code:'ARCA_ACCEPTED_REQUIREMENTS_UNAVAILABLE'});
 for(const change of [{packageDigest:d('wrong')},{shelfId:'foreign'},{libraRunId:'foreign'},{authorizedDefectManifestDigest:d('wrong')},
  {acceptanceRequirementSnapshot:{...f.snapshot,requirements:{}}}])assert.throws(()=>acceptedProductRequirements(f.reference,{...f.delivery,...change},f.manifest),{code:'ARCA_ACCEPTED_REQUIREMENTS_INVALID'});
});
test('historical requirements are read in bounded batches for more than 500 entries',()=>{
 const fixtures=Array.from({length:501},(_,i)=>fixture('entry-'+i)),calls=[];
 const reader=readerFor(fixtures,q=>{calls.push(q.packages.length);return {items:q.packages.map(ref=>fixtures.find(f=>f.reference.onDeckPackageId===ref.onDeckPackageId).delivery)};});
 assert.equal(reader.healthProjectionInputs(fixtures.map(f=>f.item.shelfEntryId)).length,501);assert.deepEqual(calls,[500,1]);
});
test('automatic accepted-gap repair is fenced, but manual repair, new damage and committed settlement retain authority',()=>{
 const f=fixture(),context={shelfEntryId:'entry',originalRequirements:f.requirements,effectiveRequirements:f.requirements,authorizedDefectManifest:f.manifest};
 const finding={findingId:'size',findingDigest:d('size'),findingKind:'conformance:max_size_exceeded'};
 const history={findings:[finding],commits:[]};const care={aftercareCaseId:'case',careRequirement:{requiredEffects:[{objectId:'size',digest:d('size')}],typedParameters:[]}};
 assert.equal(automaticCaseTargetsAcceptedDefect(context,care,history),true);
 assert.equal(automaticCaseTargetsAcceptedDefect(context,{...care,careRequirement:{...care.careRequirement,typedParameters:[{parameter:'trigger.kind',value:'repair_accepted_defects'}]}},history),false);
 assert.equal(automaticCaseTargetsAcceptedDefect(context,care,{...history,commits:[{aftercareCaseId:'case'}]}),false);
 assert.equal(automaticCaseTargetsAcceptedDefect(context,care,{...history,findings:[{...finding,findingKind:'custody:primary_missing'}]}),false);
 assert.equal(automaticCaseTargetsAcceptedDefect(context,care,{...history,findings:[{...finding,findingDigest:d('foreign')}]}),false);
});
test('Libra published-requirements read is exact, bounded, historical and side-effect free',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'uat251-published-requirements-')),databasePath=path.join(root,'test.db');
 const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest}),db=new Database(databasePath),unitOfWork=createSqliteUnitOfWork({kernel});
 try {
  const f=fixture(),provenance=signed({libraRunId:f.manifest.libraRunId,acceptanceRequirementSnapshot:f.snapshot},'provenanceDigest'),attestation=signed({libraRunId:f.manifest.libraRunId,onDeckPackageId:f.reference.onDeckPackageId,authorizedDefectManifest:f.manifest},'attestationDigest');
  db.pragma('foreign_keys=OFF');db.prepare('INSERT INTO libra_product_packages (on_deck_package_id,package_digest,libra_run_id,shelf_id,acceptance_spec_id,acceptance_spec_record_digest,production_provenance_json,production_provenance_digest,attestation_json,attestation_digest) VALUES (?,?,?,?,?,?,?,?,?,?)').run(f.reference.onDeckPackageId,f.reference.expectedPackageDigest,f.manifest.libraRunId,'shelf',f.snapshot.acceptanceSpecId,f.snapshot.acceptanceSpecRecordDigest,JSON.stringify(provenance),provenance.provenanceDigest,JSON.stringify(attestation),attestation.attestationDigest);
  const reader=createProductDeliveryReader({schemaManifest,unitOfWork}),query={queryContract:'libra.accepted-product-requirements@1',packages:[{onDeckPackageId:f.reference.onDeckPackageId,expectedPackageDigest:f.reference.expectedPackageDigest}]};
  const before=db.prepare('select * from fx_command_receipts').all();assert.deepEqual(reader.readAcceptedRequirements(query),{items:[f.delivery]});assert.deepEqual(db.prepare('select * from fx_command_receipts').all(),before);
  assert.throws(()=>reader.readAcceptedRequirements({...query,packages:[{...query.packages[0],expectedPackageDigest:d('wrong')}]}),{code:'P9_PRODUCT_DELIVERY_INTEGRITY'});
  assert.deepEqual(reader.readAcceptedRequirements({...query,packages:[{onDeckPackageId:'absent',expectedPackageDigest:d('absent')}]}),{items:[{resultKind:'not_found',onDeckPackageId:'absent'}]});
  for(const packages of [[],Array.from({length:501},()=>query.packages[0]),[query.packages[0],query.packages[0]]])assert.throws(()=>reader.readAcceptedRequirements({...query,packages}),{code:'P9_ACCEPTED_REQUIREMENTS_QUERY'});
 } finally {db.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('already scheduled automatic transcode is rejected before probing or touching the Primary',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'uat251-effect-fence-'));
 const kernel=openSqliteKernel({Database,databasePath:path.join(root,'test.db'),schemaDdl,schemaManifest});
 try {
  const f=fixture(),finding={findingId:'size',findingDigest:d('size'),findingKind:'conformance:max_size_exceeded'};
  const context={shelfEntryId:'entry',originalRequirements:f.requirements,effectiveRequirements:f.requirements,authorizedDefectManifest:f.manifest};
  const care={aftercareCaseId:'case',state:'active',careRequirement:{requiredEffects:[{objectId:'size',digest:d('size')}],typedParameters:[]}};
  const untouched=()=>{throw Error('The media must not be touched.');};
  const ports=createAftercareCapabilityPorts({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),
   contextReader:{read:()=>context,store:{history:()=>({cases:[care],findings:[finding],commits:[]})}},
   computeBoundedMaterialFingerprintSync:untouched,mediaProbe:{probe:untouched},workResultReader:{}});
  for(const ref of ['arca.aftercare.media.transcode@1','arca.aftercare.media.remux@1','arca.aftercare.text_artifact.render@1','arca.aftercare.binary_artifact.acquire@1']){
   const port=ports[ref];
   for(const recoveryDecision of [null,'safe_retry','safe_retry_before_intent']){
    const execution={ownerScope:{processId:'entry'},namedInputs:{},recoveryDecision};
    const result=await port.execute(execution);
    assert.equal(result.kind,'failed');assert.equal(result.code,'ARCA_AFTERCARE_MANUAL_DEFECT_INTENT_REQUIRED');
    assert.equal(result.retryDirective,'never');assert.equal(result.evidence.stage,'before_workspace_write');
    port.validateResult(execution,result);
   }
   for(const recoveryDecision of ['continue_forward','already_committed'])await assert.rejects(
    Promise.resolve().then(()=>port.execute({ownerScope:{processId:'entry'},namedInputs:{},recoveryDecision})),
    {code:'ARCA_AFTERCARE_MANUAL_DEFECT_INTENT_REQUIRED'});
  }
 }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});
