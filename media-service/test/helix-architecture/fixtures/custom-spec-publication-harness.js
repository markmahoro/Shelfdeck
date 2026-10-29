'use strict';


const {fixture,schemaManifest,D,Database}=require('./us-adult-analysis-basis-harness');
const {fixture:specFixture}=require('./custom-acceptance-spec-harness');
const {canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {decisionHeadDigest}=require('../../../src/helix/domains/libra/model/decision-front-half-contracts');
const {createCommandCommitCoordinator}=require('../../../src/helix/foundation/persistence/commit-foundation');
const {createCustomTargetStore}=require('../../../src/helix/domains/libra/persistence/custom-target-store');
const {createCustomSpecPublicationStore}=require('../../../src/helix/domains/libra/persistence/custom-spec-publication-store');
function harness(callback,{failAfterPublication=false,prepareRun=null}={}){return fixture(input=>{
  const db=new Database(input.databasePath),data=specFixture('movie','run-1',{runStateRevision:1,runStateDigest:D('run-state'),
    runExecutionBasisDigest:D('basis'),materialSetDigest:D('member-set')}),base=data.baseSpec;
  let injected=false;
  const unitOfWork={...input.unitOfWork,execute(participants,...options){
    const domain=participants.find(row=>row.participantId==='custom_spec_publish');
    if(failAfterPublication&&domain&&!injected){injected=true;return input.unitOfWork.execute([...participants,
      {participantId:'publication_interruption',owner:'libra',repositories:domain.repositories,execute(){throw new Error('injected after publication');}}],...options);}
    return input.unitOfWork.execute(participants,...options);
  }};
  try{
    db.exec("INSERT INTO libra_subjects(subject_id,status,content_profile,structure_kind,intake_revision) VALUES('subject','active','movie','single',1)");
    db.prepare('INSERT INTO libra_routing_decisions(routing_decision_id,subject_id,decision,shelf_id) VALUES(?,?,?,?)').run(data.routing.routingDecisionId,'subject','resolved','shelf');
    db.prepare('INSERT INTO libra_decision_basis_revisions(decision_basis_id,subject_id,basis_kind,basis_revision,status,routing_decision_id,basis_digest) VALUES(?,?,?,?,?,?,?)')
      .run(base.decisionBasisId,'subject','acceptance_spec',2,'ready',data.routing.routingDecisionId,base.decisionBasisDigest);
    const columns=['acceptance_spec_id','subject_id','shelf_id','shelf_routing_projection_revision','shelf_projection_digest','shelf_standard_revision',
      'shelf_standard_digest','decision_basis_id','product_scope_digest','spec_revision','spec_schema_ref','spec_json','spec_digest','record_digest','structure_kind','content_profile','published_at_ms'];
    db.prepare('INSERT INTO libra_acceptance_specs('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')')
      .run(base.acceptanceSpecId,'subject','shelf',base.shelfRoutingProjectionRevision,base.shelfProjectionDigest,base.shelfStandardRevision,base.shelfStandardDigest,
        base.decisionBasisId,base.productScope.scopeDigest,base.specRevision,base.schemaRef,canonicalJson(base),base.specDigest,base.recordDigest,base.structureKind,base.contentProfile,base.publishedAtMs);
    db.prepare('UPDATE libra_runs SET subject_id=?,state=?,acceptance_spec_id=?').run('subject','frozen',base.acceptanceSpecId);
    data.targetBasis.decisionHeadDigest=decisionHeadDigest('subject',4,data.routing.routingDecisionId,base.decisionBasisId,base.acceptanceSpecId);
    db.prepare('INSERT INTO libra_subject_decision_heads(subject_id,head_revision,head_digest,current_routing_decision_id,current_decision_basis_id,current_acceptance_spec_id) VALUES(?,?,?,?,?,?)')
      .run('subject',4,data.targetBasis.decisionHeadDigest,data.routing.routingDecisionId,base.decisionBasisId,base.acceptanceSpecId);
    if(prepareRun)prepareRun({...input,db,data,base,schemaManifest,unitOfWork});
    db.prepare('INSERT INTO libra_product_fact_revisions(product_fact_id,libra_run_id,fact_kind,fact_revision,fact_json,fact_digest) VALUES(?,?,?,?,?,?)')
      .run('identity',data.targetBasis.libraRunId,'resolved_identity',1,'{}',data.targetBasis.identityDigest);
    const options={...input,schemaManifest,unitOfWork},targets=createCustomTargetStore(options),coordinator=createCommandCommitCoordinator(options),
      chosen=data.target([{requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'}]);
    for(const [kind,record]of[['preview',chosen.preview],['intent',chosen.intent]]){
      const key=kind==='preview'?'preview':record.idempotencyKey,requestDigest=kind==='preview'?D('preview'):record.requestDigest,
        readFence=unitOfWork.captureReadFence(),id=D(kind),participant=targets.participant({kind,record,idempotencyKey:key,requestDigest,readFence,currentBasis:record.basis});
      coordinator.execute({readFence,command:{commandReceiptId:id,ownerDomain:'libra',commandContract:'fixture.target.'+kind,callerScope:'admin',idempotencyKey:key,
        requestDigest,targetType:'subject',targetId:'subject'},domainParticipant:participant,commitMarker:{commitMarker:id,scopeType:'subject',scopeId:'subject',commitDigest:id},
        auditRecords:[{auditId:id,actorType:'admin',actorId:'admin',action:'target.'+kind,scopeType:'subject',scopeId:'subject'}],
        resultEnvelope:result=>({resultSchemaRef:'fixture.target-result@1',resultRef:result})});
    }
    const publisher=createCustomSpecPublicationStore(options),currentBasis={...chosen.intent.basis,customTargetRevision:chosen.intent.revision},
      publish=overrides=>publisher.publish({intentId:chosen.intent.intentId,intentDigest:chosen.intent.intentDigest,currentBasis,
        readFence:unitOfWork.captureReadFence(),producedAtMs:1200,...overrides}),
      counts=()=>['libra_acceptance_specs','libra_custom_target_intents','fx_command_receipts','fx_commit_markers','fx_audit_records']
        .map(table=>db.prepare('SELECT count(*) n FROM '+table).get().n);
    return callback({db,publisher,publish,base,chosen,currentBasis,unitOfWork,counts,options,data,targets});
  }finally{db.close();}
},{seedRun:!prepareRun});}

module.exports={harness};
