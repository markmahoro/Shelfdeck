'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const {
  createLibraRunAdminService,
} = require('../src/helix/domains/libra/application/libra-run-admin-service');

const D = (value) => canonicalDigest({ value });

for(const scenario of ['size','technical','identity','playback','requirement'])test('Defect preview preserves eligibility and evidence-specific copy: '+scenario, () => {
  const libraRunId = 'run-size-preview';
  const workId = 'work-size-preview';
  const stateDigest = D('frozen-run');
  const terminalBody = {
    blockedWorks:[Object.freeze({
      workId,
      failureCode:scenario==='technical'?'LIBRA_MEDIA_FFMPEG_FAILED':'size_cap_requires_admission',
      capabilityRef:'libra.product_media.verify@1',
      failureClass:'business_unachievable',
      terminalEvidenceDigest:D('terminal-work'),
    })],
  };
  const terminalEvidence = Object.freeze({
    ...terminalBody,
    evidenceDigest:canonicalDigest(terminalBody),
  });
  const verification = Object.freeze({
    libraRunId,
    candidateKind:scenario==='size'?'workspace_output':'direct_input',
    result:'failed',
    reasonCodes:Object.freeze([scenario==='size'?'max_size_exceeded':scenario==='identity'?'product_identity_mismatch':scenario==='playback'?'playback_decode_failed':'video_codec_unmet']),
    verificationId:D('verification'),
    candidateBasisDigest:D('candidate'),
    productMaterialHandleId:'workspace-product',
    productMaterialHandleDigest:D('workspace-product'),
    productMaterialFenceDigest:D('workspace-fence'),
    workspaceMediaHandleId:'workspace-media',
    spaceSummary:Object.freeze({
      actualSizeBytes:22,
      maxSizeBytes:14,
      withinLimit:false,
    }),
  });
  const run = Object.freeze({
    libra_run_id:libraRunId,
    subject_id:'subject-size-preview',
    state:'frozen',
    state_revision:3,
    state_digest:stateDigest,
    priority_class:'normal',
    priority_intent_digest:D('priority'),
    acceptance_spec_id:'spec-size-preview',
  });
  const head = Object.freeze({
    subject_id:run.subject_id,
    head_revision:1,
    active_scope_set_digest:D('active-scope'),
  });
  let lifecycleCalls = 0;
  const unitOfWork = Object.freeze({
    execute(participants) {
      if (participants.some((item) => item.participantId === 'run_lifecycle_preflight')) {
        lifecycleCalls += 1;
        throw new Error('lifecycle reached');
      }
      const values = {};
      for (const participant of participants) {
        values[participant.participantId] = participant.execute({
          repository(repositoryId) {
            assert.equal(repositoryId, 'libra_run_admin_read');
            return Object.freeze({
              invoke(statementId) {
                if (statementId === 'find_run') return run;
                if (statementId === 'find_head') return head;
                if (statementId === 'list_revisions') return [Object.freeze({
                  libra_run_id:libraRunId,
                  state_revision:3,
                  transition_kind:'frozen',
                  transition_evidence_json:JSON.stringify(terminalEvidence),
                })];
                if (statementId === 'find_spec') return Object.freeze({
                  acceptance_spec_id:run.acceptance_spec_id,
                  spec_json:JSON.stringify({
                    recordDigest:D('spec-record'),
                    requirements:{ space:{ maxSizeBytes:14 } },
                  }),
                });
                assert.fail('Unexpected statement: ' + statementId);
              },
            });
          },
        });
      }
      return values;
    },
  });
  const workResultReader = Object.freeze({
    listWorks({workKind}) { return workKind==='workspace_media_production'?[Object.freeze({ work_id:workId,work_kind:workKind,state:'succeeded' })]:[]; },
    read(requestedWorkId) {
      assert.equal(requestedWorkId, workId);
      return [Object.freeze({
        outcomeKind:'succeeded',
        capabilityRef:'libra.product_media.verify@1',
        result:verification,
      })];
    },
  });
  const service = createLibraRunAdminService({
    schemaManifest,
    unitOfWork,
    libraRunExecutionProjection:Object.freeze({ invalidate() {} }),
    workResultReader,
    now:() => 119,
  });

  const preview = service.previewDefects(libraRunId);
  if(scenario!=='size'){
    assert.equal(preview.eligibility,'ineligible');
    assert.deepEqual(preview.ineligibleReasons,['P9_DEFECT_ADMISSION_NONWAIVABLE']);
    assert.equal(preview.message,{technical:'视频处理失败，无法接受瑕疵。',identity:'当前成品身份核对不一致，无法接受瑕疵。',
      playback:'当前成品未通过播放验证，无法接受瑕疵。',requirement:'当前成品仍有必须满足的收藏要求。'}[scenario]);
    assert.equal(lifecycleCalls,0);return;
  }
  assert.deepEqual(preview.sizeForecast, {
    maxSizeBytes:14,
    predictedBytes:22,
    overshootBytes:8,
    measured:true,
    actualSizeBytes:22,
    withinLimit:false,
  });
  assert.throws(() => service.admitWithDefects(libraRunId, {
    idempotencyKey:'size-preview-admission',
    expectedRunStateRevision:preview.frozenRunStateRevision,
    expectedRunStateDigest:preview.frozenRunStateDigest,
    expectedDefectCandidateDigest:preview.candidateDigest,
    acknowledged:true,
  }), /lifecycle reached/);
  assert.equal(lifecycleCalls, 1);
});
