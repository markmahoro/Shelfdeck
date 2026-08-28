'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyFormation, createFormationQuery, nextAction, organizingSteps, relatedMaterialsSummary,
  waitsForExternalIntegration } = require('../../src/helix/domains/libra/application/formation-query');

function work(events) { return [{ workId:'work-1', processId:'run-1', workKind:'artifact_production', state:'succeeded', createdAtMs:1, events }]; }
function event(capabilityRef, result) { return { eventId:capabilityRef, capabilityRef, state:'succeeded', progress:null,
  result:{ outcomeKind:'succeeded', committedAtMs:10, result } }; }

test('Formation reports business failure as blocked even when the executor committed successfully', () => {
  const works = work([event('libra.product.conformance.verify@1', {
    schemaRef:'helix://contracts/types/ProductConformanceEvidence/v1', result:'failed',
    unmetRequirementCodes:['metadata_field_unmet'],
  })]);
  const steps = organizingSteps(works, null, {});
  assert.equal(steps.find((item)=>item.key==='verify')?.state, 'blocked');
  assert.equal(steps.find((item)=>item.key==='verify')?.label, '验证整理结果');
  assert.equal(classifyFormation({run:{state:'active'},works,issue:null,recovery:null,arcaStatus:null,productPackage:null}),
    'attention_required');
});

test('Formation explains a zero-cast business freeze without presenting an executor failure', () => {
  const works = [{ workId:'metadata-provider-work', processId:'run-1',
    workKind:'product_metadata_observation', state:'succeeded', createdAtMs:1,
    events:[event('libra.product_metadata.fetch@1', {
      sourceKind:'provider', peopleHints:[], descriptiveFacts:{entries:[]},
    })] }];
  const terminalEvidence = Object.freeze({ blockedWorks:Object.freeze([Object.freeze({
    failureClass:'business_unachievable',
    failureCode:'product_metadata_required_cast_missing',
  })]) });
  assert.equal(classifyFormation({run:{state:'frozen'},works,issue:null,recovery:null,
    arcaStatus:null,productPackage:null}), 'attention_required');
  const action = nextAction(works, 'attention_required', null, 'frozen', null, null,
    null, null, false, terminalEvidence);
  assert.equal(action.state, 'frozen');
  assert.equal(action.label, '媒体资料中缺少验收要求的演员信息，本次整理已冻结');
  assert.doesNotMatch(action.label, /执行失败/);
});

test('Formation keeps an active Run visibly waiting when external media is required but MoviePilot is absent', () => {
  const works = work([
    event('libra.product_media.verify@1', {
      schemaRef:'helix://contracts/types/ProductMediaVerification/v1', result:'failed',
      reasonCodes:['video_codec_unmet','minimum_raster_unmet','primary_audio_unmet'],
    }),
    event('libra.product_output.select@1', {
      schemaRef:'helix://contracts/types/SelectedProductOutput/v1', result:'not_selected',
      selectionReasonCode:'no_passed_candidate',
    }),
  ]);
  assert.equal(waitsForExternalIntegration(works, false), true);
  assert.equal(waitsForExternalIntegration(works, true), false);
  assert.equal(classifyFormation({ run:{state:'active'}, works, issue:null, recovery:null,
    arcaStatus:null, productPackage:null, waitingExternalIntegration:true }), 'pending');
  assert.deepEqual(nextAction(works, 'pending', null, 'active', null, null, null, 'active', true), {
    label:'等待配置外部获取服务后继续整理', state:'waiting_external', progress:null,
  });
});

test('Formation does not hide unrelated successful-executor business failures as integration waiting', () => {
  const works = work([event('libra.product.conformance.verify@1', {
    schemaRef:'helix://contracts/types/ProductConformanceEvidence/v1', result:'failed',
    unmetRequirementCodes:['metadata_field_unmet'],
  })]);
  assert.equal(waitsForExternalIntegration(works, false), false);
  assert.equal(classifyFormation({run:{state:'active'},works,issue:null,recovery:null,arcaStatus:null,
    productPackage:null,waitingExternalIntegration:false}), 'attention_required');
});

test('Formation transmits exact NFO and related poster dispositions', () => {
  const steps = organizingSteps(work([
    event('libra.product_artifact.acquire@1', { resultKind:'acquired', artifactHandle:{
      artifactKind:'poster', provenanceRef:{objectType:'related_material_reference'},
    } }),
    event('libra.product_sidecar.render@1', { artifactKind:'nfo',
      provenanceRef:{objectType:'related_nfo_update'} }),
  ]), null, {});
  assert.equal(steps.find((item)=>item.key==='poster')?.label, '复用现有海报');
  assert.equal(steps.find((item)=>item.key==='nfo')?.label, '更新 NFO');
});

test('Formation summarizes repeated Related Material roles without hiding their count', () => {
  assert.equal(relatedMaterialsSummary(1, ['fanart','nfo','poster','sidecar','subtitle','subtitle']),
    '已接收 1 个主媒体，以及 6 个相关材料（背景图 1、NFO 1、海报 1、附属资料 1、字幕 2）');
});

test('Formation explains an Arca target failure instead of showing a stalled handoff', () => {
  const query = createFormationQuery({
    store:{},
    detailSource:{ get:()=>({ subjectId:'subject-1', classification:'in_progress', handoffB:{offerId:'offer-1'},
      nextAction:{label:'等待收藏架验收',state:'running',progress:null} }) },
    readAcceptanceRecovery:()=>({ recoveryState:'attention_required', errorCode:'CLEAN_ARCA_TARGET_ROOT_UNAVAILABLE',
      failurePhase:'acceptance_assessment', terminalAttemptCount:1, ownerDomain:'arca', recoveryGeneration:1,
      automaticRecoveryUsed:false, offerId:'offer-1' }),
  });
  const item = query.get('subject-1');
  assert.equal(item.classification, 'attention_required');
  assert.equal(item.nextAction.label, '媒体整理完成，目标收藏架目录不可用，上架失败');
  assert.equal(item.executorIssue.canRetry, true);
});
