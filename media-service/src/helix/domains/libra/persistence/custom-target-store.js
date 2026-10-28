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
      'state_digest','execution_basis_digest','acceptance_spec_id','run_material_manifest_id']},
    subject:{kind:'select-one',tableId:'libra_subjects',keyColumns:['subject_id'],columns:['subject_id','status','content_profile','structure_kind']},
    spec:{kind:'select-one',tableId:'libra_acceptance_specs',keyColumns:['acceptance_spec_id'],columns:['acceptance_spec_id','subject_id',
      'shelf_id','shelf_standard_revision','shelf_standard_digest','product_scope_digest','spec_digest','record_digest','spec_json']},
    decision_head:{kind:'select-one',tableId:'libra_subject_decision_heads',keyColumns:['subject_id'],columns:['head_digest','current_acceptance_spec_id']},
    manifest:{kind:'select-one',tableId:'libra_run_material_manifests',keyColumns:['run_material_manifest_id'],columns:['libra_run_id','member_set_digest']},
    identity:{kind:'select-one',tableId:'libra_product_fact_revisions',keyColumns:['libra_run_id','fact_kind','fact_revision'],columns:['fact_digest']},
  });
  const repository = createRepositoryDefinition({ repositoryId:'libra_custom_targets',owner:'libra',schemaManifest:options.schemaManifest,statements });
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
  function assertOwnerBasis(repo, basis, preview) {
    const run = repo.invoke('run',{libra_run_id:basis.libraRunId}), subject = repo.invoke('subject',{subject_id:basis.subjectId}),
      spec = repo.invoke('spec',{acceptance_spec_id:basis.baseAcceptanceSpecId}), head = repo.invoke('decision_head',{subject_id:basis.subjectId});
    if (!run || !subject || subject.status !== 'active' || subject.content_profile !== basis.contentProfile || subject.structure_kind !== basis.structureKind ||
        run.subject_id !== basis.subjectId || run.state !== basis.runState || run.state_revision !== basis.runStateRevision ||
        run.state_digest !== basis.runStateDigest || run.execution_basis_digest !== basis.runExecutionBasisDigest ||
        run.acceptance_spec_id !== basis.baseAcceptanceSpecId || !spec || spec.subject_id !== basis.subjectId || spec.shelf_id !== basis.shelfId ||
        spec.shelf_standard_revision !== basis.shelfStandardRevision || spec.shelf_standard_digest !== basis.shelfStandardDigest ||
        spec.product_scope_digest !== basis.productScopeDigest || spec.record_digest !== basis.baseSpecRecordDigest || spec.spec_digest !== basis.baseSpecDigest ||
        !head || head.head_digest !== basis.decisionHeadDigest || head.current_acceptance_spec_id !== basis.baseAcceptanceSpecId)
      fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
    let storedSpec;try{storedSpec=JSON.parse(spec.spec_json);}catch{fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');}
    if(!storedSpec||typeof storedSpec!=='object'||Array.isArray(storedSpec)||!Object.hasOwn(storedSpec,'requirements'))
      fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID');
    if(canonicalJson(storedSpec.requirements)!==canonicalJson(preview.baseRequirements))fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
    const manifest = repo.invoke('manifest',{run_material_manifest_id:run.run_material_manifest_id}),
      identity = repo.invoke('identity',{libra_run_id:run.libra_run_id,fact_kind:'resolved_identity',fact_revision:1});
    if (!manifest || manifest.libra_run_id !== run.libra_run_id || manifest.member_set_digest !== basis.materialSetDigest ||
        !identity || identity.fact_digest !== basis.identityDigest) fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
    if ((current(repo,basis.subjectId,basis.productScopeDigest)?.revision || 0) !== basis.customTargetRevision)
      fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE');
  }
  return Object.freeze({
    preview:previewId=>read(repo=>getPreview(repo,previewId)),
    current:({subjectId,productScopeDigest})=>read(repo=>current(repo,subjectId,productScopeDigest)),
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
