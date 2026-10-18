'use strict';
const {fixture,schemaManifest,D,Database,createWorkspaceAdmissionStore}=require('./us-adult-analysis-basis-harness');
const {canonicalDigest,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {createUsAdultAnalysisStore}=require('../../../src/helix/domains/libra/persistence/us-adult-analysis-store');
const {buildUsAdultAnalysisBasis}=require('../../../src/helix/domains/libra/model/us-adult-analysis-basis');
const {buildResolvedProductIdentity}=require('../../../src/helix/domains/libra/model/product-fact-contracts');
const {createPeopleStore}=require('../../../src/helix/domains/people/persistence/people-store');
const {initialReference}=require('./us-adult-initial-reference');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
function harness(run){return fixture(input=>{
  createWorkspaceAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork}).admit({decision:input.decision,commitMarker:'workspace-marker',resultId:'workspace-result'});
  const identity=buildResolvedProductIdentity({subjectId:'subject-1',contentProfile:'western_adult',structureKind:'single',identityKind:'internal_identity',
    producerRef:'libra.product_identity.resolve@1',basisDigest:D('identity-basis'),observedAtMs:1,
    providerIdentities:[{provider:'internal',namespace:'internal_identity',providerKey:'us-adult:'+canonicalDigest({schema:'libra.us-adult-subject-identity@1',subjectId:'subject-1'})}],
    displayEntries:[{key:'title',value:'Original source'},{key:'original_file_name',value:'Original source.mkv'},
      {key:'original_file_name_digest',value:require('../../../src/helix/contracts/us-adult-presentation').originalNameProvenance('Original source.mkv').provenanceDigest}]}),db=new Database(input.databasePath);
  try{
    db.prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision) VALUES(?,?,?,?,?)').run('subject-1','single','western_adult','active',1);
    db.prepare('UPDATE libra_runs SET subject_id=? WHERE libra_run_id=?').run('subject-1','run-1');
    db.prepare('INSERT INTO libra_product_fact_revisions(product_fact_id,libra_run_id,fact_kind,fact_revision,schema_ref,fact_json,fact_digest,result_digest) VALUES(?,?,?,?,?,?,?,?)')
      .run('identity-fact','run-1','resolved_identity',1,identity.schemaRef,canonicalJson(identity),identity.identityDigest,canonicalDigest(identity));
    const people=createPeopleStore({schemaManifest,unitOfWork:input.unitOfWork});
    for(const personId of ['actor-1','actor-2','actor-3']){
      const decision={decisionId:'register-'+personId,newPersonId:personId,libraryKind:'us_adult',canonicalName:personId,aliases:[],providerIdentities:[],actorId:'admin',initialReference:initialReference(personId,'admin')};
      people.registerDirectPerson({...decision,decisionDigest:canonicalDigest(decision)});
    }
    const pages=[];let cursor=null,libraryDigest=null;
    do{const page=people.readUsAdultReferencePage({cursor,limit:1,expectedLibraryDigest:libraryDigest});pages.push(page);libraryDigest=page.libraryDigest;cursor=page.nextCursor;}while(cursor);
    const identityValue={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:'',mountScopeId:'mount-1',inode:'1',sizeBytes:100,
      fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('media')};
    identityValue.materialKey=canonicalDigest({schema:'physical-material-identity@2',...Object.fromEntries(Object.entries(identityValue).filter(([key])=>!['schemaRef','schemaVersion','materialKey'].includes(key)))});
    const sourceHandle={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,handleId:'source-handle',identity:identityValue,ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run-1'},
      bindingRevision:1,endpointId:'endpoint',location:'C:/fixture/Original source.mkv',mountScopeRevision:1,expectedSizeBytes:100,expectedMtimeNs:1,expectedCtimeNs:1,
      fingerprintVerifiedAtMs:1,readScope:'material_read',expiresAtMs:4102444800000,fenceDigest:D('source-read-fence')},
      sourceProbe={resultKind:'probed',sourceHandleDigest:canonicalDigest(sourceHandle),durationMs:2000},
      snapshot={spec:{contentProfile:'western_adult'},materialInputForm:'stream_file',members:[{role:'primary_payload'}],run:{libraRunId:'run-1',subjectId:'subject-1',stateRevision:1,executionBasisDigest:D('basis')},resolvedIdentityDigest:identity.identityDigest},
      sourceProbeRecord={workId:'probe-work',attemptId:'probe-attempt',planId:'probe-plan',eventId:'probe-event',resultId:'probe-result',inputBindingDigest:D('probe-inputs'),
        outcomeKind:'succeeded',capabilityRef:'shared.material.media.probe@1',result:sourceProbe,resultDigest:canonicalDigest(sourceProbe)},
      basis=buildUsAdultAnalysisBasis({snapshot,sourceHandle,sourceProbeRecord,workspaceId:input.id,referencePages:pages}),
      contracts='../../../src/helix/contracts/',contractValidator=createCapabilityContractValidator({schemas:[
        ...['UsAdultAnalysisBasis','FaceModelRef','ClusterParameters','SamplingPlan','PeopleReferenceLibraryPage','UsAdultPersonSnapshot','PersonReferenceProjection'].map(type=>require(contracts+'domain-types/'+type+'/v1/schema.json')),
        ...['PhysicalMaterialReadHandle','PhysicalMaterialIdentity'].map(type=>require(contracts+'types/'+type+'/'+(type==='PhysicalMaterialIdentity'?'v2':'v1')+'/schema.json'))]}),
      options={schemaManifest,unitOfWork:input.unitOfWork,contractValidator};
    return run({...input,db,pages,basis,options,snapshot,sourceHandle,sourceProbeRecord});
  }finally{db.close();}
});}
module.exports=Object.freeze({harness});
