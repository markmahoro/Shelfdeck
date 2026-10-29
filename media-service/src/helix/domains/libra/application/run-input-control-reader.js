'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {reconstructManifest}=require('../persistence/run-discard-store');
const pending=reasonCode=>Object.freeze({kind:'pending',reasonCode});
function fail(){throw Object.assign(new Error('Libra Run input evidence is inconsistent.'),{code:'LIBRA_RUN_INPUT_EVIDENCE_INVALID'});}

// This only compares Libra's immutable admitted inputs with current Bindings
// and Foundation's current Control projection. It does not prove files exist,
// replace other execution checks, or authorize dispatch on its own.
function createLibraRunInputControlReader(options){
  if(!options?.schemaManifest||typeof options.unitOfWork?.captureReadFence!=='function'||
      typeof options.unitOfWork?.execute!=='function'||typeof options.materialControlProjectionPort?.getMaterialControlProjections!=='function')
    throw new TypeError('Run input Control requires Libra persistence and Foundation projections.');
  const tableColumns=id=>{const table=options.schemaManifest.tables.find(item=>item.tableId===id);if(!table)throw new TypeError('Run input schema is incomplete.');return table.columns;};
  const repository=createRepositoryDefinition({repositoryId:'libra_run_input_control',owner:'libra',schemaManifest:options.schemaManifest,
    readOnly:true,statements:{
      find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','run_material_manifest_id',
        'execution_basis_digest','execution_basis_record_json'],keyColumns:['libra_run_id']},
      find_manifest:{kind:'select-one',tableId:'libra_run_material_manifests',columns:tableColumns('libra_run_material_manifests'),
        keyColumns:['run_material_manifest_id'],safeIntegers:true},
      list_manifest_members:{kind:'select-all',tableId:'libra_run_material_members',columns:tableColumns('libra_run_material_members'),
        keyColumns:['run_material_manifest_id'],safeIntegers:true},
      list_manifest_claims:{kind:'select-all',tableId:'libra_run_material_episode_claims',columns:tableColumns('libra_run_material_episode_claims'),
        keyColumns:['run_material_manifest_id'],safeIntegers:true},
      bindings:{kind:'select-all',tableId:'libra_material_bindings',columns:tableColumns('libra_material_bindings'),
        keyColumns:['subject_id'],safeIntegers:true},
    }});
  const read=(execute,readFence)=>options.unitOfWork.execute([{participantId:'libra_run_input_control_read',owner:'libra',
    repositories:[repository],execute}],{readFence}).libra_run_input_control_read;
  return Object.freeze({check(scope,{readFence=options.unitOfWork.captureReadFence(),allowSuspended=false}={}){
    if(!scope||typeof scope.subjectId!=='string'||!scope.subjectId||typeof scope.libraRunId!=='string'||!scope.libraRunId)fail();
    const inputs=read(context=>{
      const repo=context.repository(repository.repositoryId),run=repo.invoke('find_run',{libra_run_id:scope.libraRunId});
      if(!run||run.subject_id!==scope.subjectId)fail();
      if(run.state!=='active'&&!(allowSuspended===true&&run.state==='suspended'))return pending('run_not_active');
      let basis;try{basis=JSON.parse(run.execution_basis_record_json);}catch{fail();}
      const header=repo.invoke('find_manifest',{run_material_manifest_id:run.run_material_manifest_id}),
        reconstructed=reconstructManifest(repo,run),ref=basis?.productionMaterialManifestRef;
      if(!header||!reconstructed||!ref||canonicalJson(basis)!==run.execution_basis_record_json||
          basis.subjectSnapshot?.subjectId!==scope.subjectId||basis.subjectSnapshot?.contentProfile!=='movie'||
          basis.subjectSnapshot?.structureKind!=='single'||basis.executionBasisDigest!==run.execution_basis_digest||
          ref.manifestId!==run.run_material_manifest_id||ref.manifestDigest!==header.manifest_digest||
          ref.memberCount!==reconstructed.members.length||ref.memberSetDigest!==header.member_set_digest||
          ref.episodeScopeDigest!==header.episode_scope_digest)fail();
      const manifest={manifestId:header.run_material_manifest_id,manifestRole:header.manifest_role,
        manifestRevision:Number(header.manifest_revision),libraRunId:header.libra_run_id,scopeKind:header.scope_kind,
        members:reconstructed.members,memberSetDigest:header.member_set_digest,episodeScopeDigest:header.episode_scope_digest,
        manifestDigest:header.manifest_digest},
        full=Object.fromEntries(Object.entries(basis).filter(([key])=>!['productionMaterialManifestRef','executionBasisDigest'].includes(key)));
      full.productionMaterialManifest=manifest;
      if(canonicalDigest(full)!==run.execution_basis_digest||manifest.scopeKind!=='single'||
          reconstructed.members.some((item,index)=>index>0&&reconstructed.members[index-1].materialKey>=item.materialKey))fail();
      const bindings=repo.invoke('bindings',{subject_id:scope.subjectId}).filter(row=>Number(row.current)===1&&row.authority_kind==='primary_control');
      if(bindings.length!==reconstructed.members.length)return pending('input_binding_changed');
      const byKey=new Map(bindings.map(row=>[row.material_key,row]));
      if(byKey.size!==bindings.length)return pending('input_binding_changed');
      for(const member of reconstructed.members){
        const row=byKey.get(member.materialKey),origin=member.originCandidateDeliveryRef;
        if(!row||row.health_state!=='active'||row.role!==member.role||row.mount_scope_id!==member.physicalIdentity.mountScopeId||
            String(row.inode)!==member.physicalIdentity.inode||row.fingerprint_algorithm!==member.physicalIdentity.fingerprintAlgorithm||
            Number(row.fingerprint_version)!==member.physicalIdentity.fingerprintVersion||row.content_fingerprint!==member.physicalIdentity.contentFingerprint||
            Number(row.size_bytes)!==member.sizeBytes||row.endpoint_id!==member.location.endpointId||row.location!==member.location.location||
            Number(row.binding_revision)!==member.bindingRevision||row.evidence_digest!==member.bindingEvidenceDigest||
            row.origin_intake_decision_id!==origin.intakeDecisionId||row.origin_offer_id!==origin.offerId||
            row.origin_candidate_package_id!==origin.candidatePackageId||Number(row.origin_package_revision)!==origin.packageRevision||
            row.origin_package_digest!==origin.packageDigest||row.origin_candidate_delivery_snapshot_digest!==origin.candidateDeliverySnapshotDigest||
            row.origin_related_reference_set_digest!==origin.relatedReferenceSetDigest)return pending('input_binding_changed');
      }
      return {kind:'ready',members:reconstructed.members};
    },readFence);
    if(inputs.kind!=='ready')return inputs;
    const controls=[];
    for(let offset=0;offset<inputs.members.length;offset+=500){
      const expected=inputs.members.slice(offset,offset+500),batch=options.materialControlProjectionPort
        .getMaterialControlProjections(expected.map(member=>member.materialKey));
      if(!Array.isArray(batch)||batch.length!==expected.length)fail();
      for(const [index,control] of batch.entries()){
        if(!control||control.materialKey!==expected[index].materialKey||!['available','unavailable'].includes(control.resultKind))fail();
        controls.push(control);
      }
    }
    for(const [index,control] of controls.entries()){
      if(control.resultKind==='unavailable')return pending('input_control_unavailable');
      const member=inputs.members[index];
      if(control.controlState!=='controlled'||control.ownerDomain!=='libra'||control.ownerScopeType!=='subject'||
          control.ownerScopeId!==scope.subjectId||control.controlRevision!==member.admittedControlRevision||
          control.projectionDigest!==member.admittedControlProjectionDigest)return pending('input_control_changed');
    }
    read(()=>null,readFence);
    return Object.freeze({kind:'ready',readFence});
  }});
}
module.exports=Object.freeze({createLibraRunInputControlReader});
