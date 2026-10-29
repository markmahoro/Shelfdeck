'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { canonicalJson } = require('../../../contracts/canonical-json');
const { PREVIEW_SCHEMA, INTENT_SCHEMA, validateBasis, assertCustomTargetPreview, assertCustomTargetIntent } = require('../model/custom-target-records');
const SHA256 = /^[a-f0-9]{64}$/;
const common = ['subject_id','libra_run_id','actor_id','idempotency_key','request_digest','record_schema_ref','record_json','record_digest','created_at_ms'];
const previewColumns = ['preview_id', ...common];
const intentColumns = ['intent_id','preview_id','product_scope_digest','target_revision', ...common];
const headColumns = ['subject_id','product_scope_digest','current_revision','intent_id','record_digest'];
function fail(code) { throw Object.assign(new Error(code), { code }); }
function commandIdentity(actorId, idempotencyKey, requestDigest) {
  if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 256 || typeof idempotencyKey !== 'string' ||
      !idempotencyKey.trim() || idempotencyKey.length > 128 || !SHA256.test(requestDigest || '')) fail('LIBRA_CUSTOM_TARGET_COMMAND_INVALID');
}
function assertCurrentTargetBaseline(intent,value) {
  if(!value||value.kind!=='ready')fail('LIBRA_CUSTOM_TARGET_BASELINE_UNAVAILABLE');
  const basis=intent.basis;
  if(value.subjectId!==intent.subjectId||value.productScopeDigest!==basis.productScopeDigest||
      value.standardSpecDigest!==basis.baseSpecDigest||value.shelfId!==basis.shelfId||
      value.shelfStandardRevision!==basis.shelfStandardRevision||value.shelfStandardDigest!==basis.shelfStandardDigest||
      value.identityDigest!==basis.identityDigest||!['no_offer','not_accepted'].includes(value.handoffState))
    fail('LIBRA_CUSTOM_TARGET_BASELINE_CHANGED');
}

function createCustomTargetStore(options) {
  const statements = {};
  for (const [kind, tableId, columns, key] of [
    ['preview','libra_custom_target_previews',previewColumns,'preview_id'],
    ['intent','libra_custom_target_intents',intentColumns,'intent_id'],
  ]) {
    statements[kind] = { kind:'select-one',tableId,columns,keyColumns:[key] };
    statements[kind + '_command'] = { kind:'select-one',tableId,columns,keyColumns:['actor_id','idempotency_key'] };
    statements['insert_' + kind] = { kind:'insert',tableId,columns };
  }
  Object.assign(statements, {
    head:{kind:'select-one',tableId:'libra_custom_target_heads',columns:headColumns,keyColumns:['subject_id','product_scope_digest']},
    insert_head:{kind:'insert',tableId:'libra_custom_target_heads',columns:headColumns},
    advance_head:{kind:'update',tableId:'libra_custom_target_heads',setColumns:['current_revision','intent_id','record_digest'],
      keyColumns:['subject_id','product_scope_digest'],compareColumns:[{column:'current_revision',parameter:'expected_revision'},
        {column:'intent_id',parameter:'expected_intent_id'},{column:'record_digest',parameter:'expected_digest'}]},
    run:{kind:'select-one',tableId:'libra_runs',keyColumns:['libra_run_id'],columns:['libra_run_id','subject_id','state','state_revision',
      'state_digest','package_revision_head','execution_basis_digest','execution_basis_record_json','acceptance_spec_id','run_material_manifest_id']},
    subject:{kind:'select-one',tableId:'libra_subjects',keyColumns:['subject_id'],columns:['subject_id','status','content_profile','structure_kind']},
    spec:{kind:'select-one',tableId:'libra_acceptance_specs',keyColumns:['acceptance_spec_id'],columns:['acceptance_spec_id','subject_id',
      'shelf_id','shelf_standard_revision','shelf_standard_digest','product_scope_digest','spec_digest','record_digest','spec_json']},
    decision_head:{kind:'select-one',tableId:'libra_subject_decision_heads',keyColumns:['subject_id'],columns:['head_digest','current_acceptance_spec_id']},
    manifest:{kind:'select-one',tableId:'libra_run_material_manifests',keyColumns:['run_material_manifest_id'],columns:['libra_run_id','member_set_digest']},
    identity:{kind:'select-one',tableId:'libra_product_fact_revisions',keyColumns:['libra_run_id','fact_kind','fact_revision'],columns:['fact_digest']},
    source_members:{kind:'select-all',tableId:'libra_run_material_members',keyColumns:['run_material_manifest_id'],
      columns:options.schemaManifest.tables.find(table=>table.tableId==='libra_run_material_members').columns,safeIntegers:true},
    source_claims:{kind:'select-all',tableId:'libra_run_material_episode_claims',keyColumns:['run_material_manifest_id'],
      columns:['member_ordinal','episode_key','season_claim_digest','claim_digest'],safeIntegers:true},
  });
  const repository = createRepositoryDefinition({ repositoryId:'libra_custom_targets',owner:'libra',schemaManifest:options.schemaManifest,statements });
  const validationRepository=createRepositoryDefinition({repositoryId:'libra_custom_target_publication_inputs',owner:'libra',schemaManifest:options.schemaManifest,
    statements:Object.fromEntries(Object.entries(statements).filter(([,statement])=>statement.kind.startsWith('select-')))});
  const read = callback => options.unitOfWork.execute([{participantId:'custom_target_read',owner:'libra',repositories:[repository],
    execute:context=>callback(context.repository(repository.repositoryId))}]).custom_target_read;
  function decode(repo, kind, row) {
    if (!row) return null;
    let value; try { value = JSON.parse(row.record_json); } catch { fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID'); }
    const record = kind === 'preview' ? assertCustomTargetPreview(value) : assertCustomTargetIntent(value, getPreview(repo,row.preview_id));
    const basis = record.basis;
    if (canonicalJson(record) !== row.record_json || row.record_schema_ref !== record.schemaRef || row.subject_id !== basis.subjectId ||
        row.libra_run_id !== basis.libraRunId || row.actor_id !== record.actorId || kind === 'preview' &&
        (row.preview_id !== record.previewDigest || row.record_digest !== record.previewDigest || row.created_at_ms !== record.createdAtMs) ||
        kind === 'intent' && (row.intent_id !== record.intentId || row.record_digest !== record.intentDigest ||
          row.preview_id !== record.previewDigest || row.product_scope_digest !== basis.productScopeDigest || row.target_revision !== record.revision ||
          row.idempotency_key !== record.idempotencyKey || row.request_digest !== record.requestDigest || row.created_at_ms !== record.confirmedAtMs))
      fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');
    commandIdentity(row.actor_id,row.idempotency_key,row.request_digest);
    return record;
  }
  function getPreview(repo, previewId) {
    const value = decode(repo,'preview',repo.invoke('preview',{preview_id:previewId}));
    if (!value) fail('LIBRA_CUSTOM_TARGET_PREVIEW_NOT_FOUND');
    return value;
  }
  function current(repo, subjectId, productScopeDigest) {
    const head = repo.invoke('head',{subject_id:subjectId,product_scope_digest:productScopeDigest});
    if (!head) return null;
    const intent = decode(repo,'intent',repo.invoke('intent',{intent_id:head.intent_id}));
    if (!intent || intent.subjectId !== subjectId || intent.basis.productScopeDigest !== productScopeDigest ||
        intent.revision !== head.current_revision || intent.intentDigest !== head.record_digest) fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');
    return intent;
  }
  function assertOwnerBasis(repo, basis, preview, expectedTargetRevision=basis.customTargetRevision) {
    const run = repo.invoke('run',{libra_run_id:basis.libraRunId}), subject = repo.invoke('subject',{subject_id:basis.subjectId}),
      spec = repo.invoke('spec',{acceptance_spec_id:basis.baseAcceptanceSpecId}),runSpec=repo.invoke('spec',{acceptance_spec_id:basis.runAcceptanceSpecId}),
      head = repo.invoke('decision_head',{subject_id:basis.subjectId});
    if (!run || !subject || subject.status !== 'active' || subject.content_profile !== basis.contentProfile || subject.structure_kind !== basis.structureKind ||
        run.subject_id !== basis.subjectId || run.state !== basis.runState || run.state_revision !== basis.runStateRevision ||
        run.state_digest !== basis.runStateDigest || run.execution_basis_digest !== basis.runExecutionBasisDigest ||
        run.package_revision_head!==basis.runPackageRevisionHead||
        run.acceptance_spec_id !== basis.runAcceptanceSpecId || !runSpec || runSpec.subject_id !== basis.subjectId ||
        runSpec.record_digest!==basis.runSpecRecordDigest || runSpec.spec_digest!==basis.runSpecDigest ||runSpec.product_scope_digest!==basis.productScopeDigest||
        !spec || spec.subject_id !== basis.subjectId || spec.shelf_id !== basis.shelfId ||
        spec.shelf_standard_revision !== basis.shelfStandardRevision || spec.shelf_standard_digest !== basis.shelfStandardDigest ||
        spec.product_scope_digest !== basis.productScopeDigest || spec.record_digest !== basis.baseSpecRecordDigest || spec.spec_digest !== basis.baseSpecDigest ||
        !head || head.head_digest !== basis.decisionHeadDigest || head.current_acceptance_spec_id !== basis.decisionHeadAcceptanceSpecId)
      fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
    let storedSpec;try{storedSpec=JSON.parse(spec.spec_json);}catch{fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');}
    if(!storedSpec||typeof storedSpec!=='object'||Array.isArray(storedSpec)||!Object.hasOwn(storedSpec,'requirements'))
      fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');
    if(canonicalJson(storedSpec.requirements)!==canonicalJson(preview.baseRequirements))fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
    const manifest = repo.invoke('manifest',{run_material_manifest_id:run.run_material_manifest_id}),
      identity = repo.invoke('identity',{libra_run_id:run.libra_run_id,fact_kind:'resolved_identity',fact_revision:1});
    if (!manifest || manifest.libra_run_id !== run.libra_run_id || manifest.member_set_digest !== basis.materialSetDigest ||
        !identity || identity.fact_digest !== basis.identityDigest) fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
    if ((current(repo,basis.subjectId,basis.productScopeDigest)?.revision || 0) !== expectedTargetRevision)
      fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
  }
  function intentEvidence(repo,intentId){
    const intent=decode(repo,'intent',repo.invoke('intent',{intent_id:intentId}));if(!intent)fail('LIBRA_CUSTOM_TARGET_INTENT_NOT_FOUND');
    const preview=getPreview(repo,intent.previewDigest),row=repo.invoke('spec',{acceptance_spec_id:intent.basis.baseAcceptanceSpecId});
    let baseSpec;try{baseSpec=row&&JSON.parse(row.spec_json);}catch{fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');}
    if(!baseSpec||baseSpec.acceptanceSpecId!==row.acceptance_spec_id||baseSpec.recordDigest!==row.record_digest||baseSpec.specDigest!==row.spec_digest)
      fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');
    return Object.freeze({intent,preview,baseSpec});
  }
  return Object.freeze({
    preview:previewId=>read(repo=>getPreview(repo,previewId)),
    current:({subjectId,productScopeDigest})=>read(repo=>current(repo,subjectId,productScopeDigest)),
    intentEvidence:intentId=>read(repo=>intentEvidence(repo,intentId)),
    admissionValidation(basis,replacementRunId,onValidated,currentTargetBaseline){
      return {participantId:'custom_target_run_admission_validation',owner:'libra',repositories:[validationRepository],execute(context){
        const repo=context.repository(validationRepository.repositoryId),row=repo.invoke('spec',{acceptance_spec_id:basis.acceptanceSpec.acceptanceSpecId});
        let spec;try{spec=row&&JSON.parse(row.spec_json);}catch{fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');}
        if(!spec)fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');
        const selected=current(repo,basis.subjectSnapshot.subjectId,basis.acceptanceSpec.productScopeDigest),reference=basis.collectionTargetRef;
        if(spec.targetKind!=='user_custom'){
          if(reference||selected)fail('LIBRA_COLLECTION_TARGET_NOT_CURRENT');
          return {targetKind:'standard'};
        }
        if(!reference||reference.targetKind!=='user_custom'||!selected||selected.intentId!==reference.intentId||
            selected.intentDigest!==reference.intentDigest||selected.revision!==reference.targetRevision)
          fail('LIBRA_COLLECTION_TARGET_NOT_CURRENT');
        const evidence=intentEvidence(repo,reference.intentId),{intent,preview,baseSpec}=evidence,
          validated=require('../model/custom-acceptance-spec').assertCustomAcceptanceSpec({spec,baseSpec,preview,intent});
        assertCurrentTargetBaseline(intent,currentTargetBaseline);
        if(validated.acceptanceSpecId!==row.acceptance_spec_id||validated.recordDigest!==row.record_digest||validated.specDigest!==row.spec_digest||
            intent.subjectId!==basis.subjectSnapshot.subjectId||intent.basis.productScopeDigest!==basis.acceptanceSpec.productScopeDigest||
            intent.basis.libraRunId!==replacementRunId||!replacementRunId||intent.basis.handoffState==='accepted')
          fail('LIBRA_CUSTOM_TARGET_ADMISSION_STALE');
        const old=repo.invoke('run',{libra_run_id:replacementRunId}),manifest=old&&repo.invoke('manifest',{run_material_manifest_id:old.run_material_manifest_id}),
          identity=repo.invoke('identity',{libra_run_id:replacementRunId,fact_kind:'resolved_identity',fact_revision:1});
        if(!old||old.subject_id!==intent.subjectId||!['active','suspended','frozen'].includes(old.state)||
            old.execution_basis_digest!==intent.basis.runExecutionBasisDigest||old.acceptance_spec_id!==intent.basis.runAcceptanceSpecId||
            old.package_revision_head!==intent.basis.runPackageRevisionHead||!manifest||manifest.libra_run_id!==replacementRunId||
            manifest.member_set_digest!==intent.basis.materialSetDigest||identity?.fact_digest!==intent.basis.identityDigest)
          fail('LIBRA_CUSTOM_TARGET_ADMISSION_STALE');
        let oldBasis;try{oldBasis=JSON.parse(old.execution_basis_record_json);}catch{fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');}
        if(!oldBasis||!oldBasis.relatedDispositionScope)fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');
        if(canonicalJson(oldBasis.relatedDispositionScope)!==canonicalJson(basis.relatedDispositionScope))
          fail('LIBRA_CUSTOM_TARGET_ADMISSION_MATERIAL_CHANGED');
        const members=repo.invoke('source_members',{run_material_manifest_id:old.run_material_manifest_id}),
          claims=repo.invoke('source_claims',{run_material_manifest_id:old.run_material_manifest_id});
        if(members.length!==basis.productionMaterialManifest.members.length)fail('LIBRA_CUSTOM_TARGET_ADMISSION_MATERIAL_CHANGED');
        for(const member of basis.productionMaterialManifest.members){
          const source=members.find(item=>item.material_key===member.materialKey);
          if(!source)fail('LIBRA_CUSTOM_TARGET_ADMISSION_MATERIAL_CHANGED');
          const expected={materialKey:source.material_key,role:source.role,physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',
            schemaVersion:2,materialKey:source.material_key,mountScopeId:source.mount_scope_id,inode:source.inode,
            fingerprintAlgorithm:source.fingerprint_algorithm,fingerprintVersion:Number(source.fingerprint_version),contentFingerprint:source.content_fingerprint,
            sizeBytes:Number(source.size_bytes)},sizeBytes:Number(source.size_bytes),location:{locationKind:source.location_kind,endpointId:source.endpoint_id,
            location:source.location},bindingKind:source.binding_kind,bindingRevision:Number(source.binding_revision),bindingEvidenceDigest:source.binding_evidence_digest,
            originCandidateDeliveryRef:{intakeDecisionId:source.origin_intake_decision_id,offerId:source.origin_offer_id,candidatePackageId:source.origin_candidate_package_id,
              packageRevision:Number(source.origin_package_revision),packageDigest:source.origin_package_digest,
              candidateDeliverySnapshotDigest:source.origin_candidate_delivery_snapshot_digest,relatedReferenceSetDigest:source.origin_related_reference_set_digest},
            episodeClaims:claims.filter(claim=>Number(claim.member_ordinal)===Number(source.ordinal)).sort((a,b)=>Buffer.compare(Buffer.from(a.episode_key),Buffer.from(b.episode_key)))
              .map(claim=>({episodeKey:claim.episode_key,seasonClaimDigest:claim.season_claim_digest,claimDigest:claim.claim_digest}))};
          // Control revisions may advance during legitimate package-to-Subject
          // reclamation. Input identity, binding, location and claims may not.
          const actual=Object.fromEntries(Object.keys(expected).map(key=>[key,member[key]]));
          if(canonicalJson(actual)!==canonicalJson(expected))fail('LIBRA_CUSTOM_TARGET_ADMISSION_MATERIAL_CHANGED');
        }
        onValidated(intent);return {intentId:intent.intentId,intentDigest:intent.intentDigest,targetRevision:intent.revision};
      }};
    },
    publicationValidation({intentId,intentDigest,currentBasis,currentTargetBaseline,baselineReadFailure},onValidated){
      if(typeof onValidated!=='function'||!SHA256.test(intentId||'')||!SHA256.test(intentDigest||''))fail('LIBRA_CUSTOM_TARGET_COMMAND_INVALID');
      return {participantId:'custom_target_publication_validation',owner:'libra',repositories:[validationRepository],execute(context){
        const repo=context.repository(validationRepository.repositoryId),evidence=intentEvidence(repo,intentId),{intent,preview}=evidence,
          basis=validateBasis(currentBasis),expected={...intent.basis,customTargetRevision:intent.revision,
            runState:basis.runState,runStateRevision:basis.runStateRevision,runStateDigest:basis.runStateDigest,gapEvidenceSetDigest:basis.gapEvidenceSetDigest};
        if(intent.intentDigest!==intentDigest||canonicalJson(basis)!==canonicalJson(expected))fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
        if(baselineReadFailure)throw baselineReadFailure;
        assertCurrentTargetBaseline(intent,currentTargetBaseline);
        if(currentTargetBaseline.handoffState!==basis.handoffState)fail('LIBRA_CUSTOM_TARGET_BASELINE_CHANGED');
        assertOwnerBasis(repo,basis,preview,intent.revision);
        const selected=current(repo,basis.subjectId,basis.productScopeDigest);
        if(selected?.intentId!==intentId||selected.intentDigest!==intentDigest)fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
        onValidated(evidence);return {intentId,intentDigest};
      }};
    },
    findCommand(kind,actorId,idempotencyKey) {
      if (!['preview','intent'].includes(kind)) fail('LIBRA_CUSTOM_TARGET_COMMAND_INVALID');
      commandIdentity(actorId,idempotencyKey,'0'.repeat(64));
      return read(repo=>{const row=repo.invoke(kind+'_command',{actor_id:actorId,idempotency_key:idempotencyKey});
        return row?Object.freeze({record:decode(repo,kind,row),requestDigest:row.request_digest}):null;});
    },
    participant({kind,record,idempotencyKey,requestDigest,currentBasis,readFence}) {
      if (!['preview','intent'].includes(kind) || !readFence || typeof options.unitOfWork.assertReadFence !== 'function')
        fail('LIBRA_CUSTOM_TARGET_READ_FENCE_REQUIRED');
      commandIdentity(record?.actorId,idempotencyKey,requestDigest);
      return {participantId:'custom_target_commit',owner:'libra',repositories:[repository],execute(context) {
        options.unitOfWork.assertReadFence(readFence);
        const repo=context.repository(repository.repositoryId),basis=validateBasis(currentBasis);
        if (canonicalJson(basis)!==canonicalJson(record.basis)) fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
        let preview;
        if(kind==='preview')preview=assertCustomTargetPreview(record);
        else{
          preview=getPreview(repo,record.previewDigest);assertCustomTargetIntent(record,preview);
          if(record.idempotencyKey!==idempotencyKey||record.requestDigest!==requestDigest)fail('LIBRA_CUSTOM_TARGET_COMMAND_INVALID');
        }
        assertOwnerBasis(repo,basis,preview);
        const values={subject_id:basis.subjectId,libra_run_id:basis.libraRunId,actor_id:record.actorId,idempotency_key:idempotencyKey,
          request_digest:requestDigest,record_schema_ref:kind==='preview'?PREVIEW_SCHEMA:INTENT_SCHEMA,record_json:canonicalJson(record),
          record_digest:kind==='preview'?record.previewDigest:record.intentDigest,created_at_ms:kind==='preview'?record.createdAtMs:record.confirmedAtMs};
        repo.invoke('insert_'+kind,kind==='preview'?{...values,preview_id:record.previewDigest}:{...values,intent_id:record.intentId,
          preview_id:record.previewDigest,product_scope_digest:basis.productScopeDigest,target_revision:record.revision});
        if(kind==='intent'){
          const previous=repo.invoke('head',{subject_id:basis.subjectId,product_scope_digest:basis.productScopeDigest}),
            next={subject_id:basis.subjectId,product_scope_digest:basis.productScopeDigest,current_revision:record.revision,
              intent_id:record.intentId,record_digest:record.intentDigest};
          if(!previous)repo.invoke('insert_head',next);
          else if(repo.invoke('advance_head',{...next,expected_revision:previous.current_revision,expected_intent_id:previous.intent_id,
            expected_digest:previous.record_digest}).changes!==1)fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
        }
        return {recordId:kind==='preview'?record.previewDigest:record.intentId,recordDigest:values.record_digest};
      }};
    },
  });
}

module.exports=Object.freeze({createCustomTargetStore});
