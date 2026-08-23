'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyFormation, createFormationQuery, organizingSteps, relatedMaterialsSummary } = require('../../src/helix/domains/libra/application/formation-query');

function work(events) { return [{ workId:'work-1', processId:'run-1', workKind:'artifact_production', state:'succeeded', createdAtMs:1, events }]; }
function event(capabilityRef, result) { return { eventId:capabilityRef, capabilityRef, state:'succeeded', progress:null,
  result:{ outcomeKind:'succeeded', committedAtMs:10, result } }; }

test('Formation reports business failure as blocked even when the executor committed successfully', () => {
  const works = work([event('libra.product.conformance.verify@1', {
    schemaRef:'helix://contracts/types/ProductConformanceEvidence/v1', result:'failed',
    unmetRequirementCodes:['metadata_field_unmet'],
  })]);
  const steps = organizingSteps(works, null, {});
  assert.deepEqual(steps.map((item)=>({label:item.label,state:item.state})), [
    { label:'验证整理结果', state:'blocked' },
  ]);
  assert.equal(classifyFormation({run:{state:'active'},works,issue:null,recovery:null,arcaStatus:null,productPackage:null}),
    'attention_required');
});

test('Formation transmits exact NFO and related poster dispositions', () => {
  const steps = organizingSteps(work([
    event('libra.product_artifact.acquire@1', { resultKind:'acquired', artifactHandle:{
      artifactKind:'poster', provenanceRef:{objectType:'related_material_reference'},
    } }),
    event('libra.product_sidecar.render@1', { artifactKind:'nfo',
      provenanceRef:{objectType:'related_nfo_update'} }),
  ]), null, {});
  assert.deepEqual(steps.map((item)=>item.label), ['复用现有海报', '更新 NFO']);
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
