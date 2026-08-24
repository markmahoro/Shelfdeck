'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolvePreparedOutput,
} = require('../../src/helix/domains/arca/planning/aftercare-projections');
const {
  projectActiveRepairProgress,
} = require('../../src/helix/domains/arca/application/aftercare-process-coordinator');

test('Aftercare media verification consumes its projected same-Work Result', () => {
  const projected = Object.freeze({
    schemaRef:'helix://contracts/types/WorkspaceMediaHandle/v1',
    workspaceMediaHandleId:'workspace-media-1',
  });
  const reader = Object.freeze({
    read() { throw new Error('same-Work projection must not query an undefined Work'); },
  });
  assert.equal(resolvePreparedOutput(projected, {}, reader), projected);
});

test('Aftercare commit-stage output resolves from its explicit preparation Work', () => {
  const artifact = Object.freeze({ artifactHandleId:'artifact-1' });
  const reader = Object.freeze({
    read(workId) {
      assert.equal(workId, 'prepare-work-1');
      return [{
        outcomeKind:'succeeded',
        capabilityRef:'arca.aftercare.text_artifact.render@1',
        result:{ artifactHandle:artifact },
      }];
    },
  });
  assert.equal(resolvePreparedOutput(null, {
    sourceWorkId:'prepare-work-1', outputKind:'nfo',
  }, reader), artifact);
});

test('Aftercare prepared output fails closed without either source authority', () => {
  assert.throws(() => resolvePreparedOutput(null, {}, { read() {} }),
    (error) => error?.code === 'ARCA_AFTERCARE_PREPARED_OUTPUT_SOURCE_MISSING');
});

test('Aftercare progress is scoped to the current preparation Work and clamps executing media below terminal', () => {
  const progress = projectActiveRepairProgress([
    { workId:'orphan-work', events:[{
      capabilityRef:'arca.aftercare.media.transcode@1', state:'executing',
      progress:{ mode:'determinate', currentValue:100, totalValue:100 },
    }] },
    { workId:'current-work', events:[{
      capabilityRef:'arca.aftercare.media.transcode@1', state:'executing',
      progress:{ mode:'determinate', currentValue:42, totalValue:100 },
    }] },
  ], 'current-work');
  assert.equal(progress.stage, 'preparing_media');
  assert.equal(progress.progressPercent, 42);

  const terminalSample = projectActiveRepairProgress([{
    workId:'current-work', events:[{
      capabilityRef:'arca.aftercare.media.transcode@1', state:'executing',
      progress:{ mode:'determinate', currentValue:100, totalValue:100 },
    }],
  }], 'current-work');
  assert.equal(terminalSample.progressPercent, 99);
});

test('Aftercare media success advances to verification without presenting a whole-Case percentage', () => {
  const progress = projectActiveRepairProgress([{
    workId:'current-work', events:[
      { capabilityRef:'arca.aftercare.media.transcode@1', state:'succeeded', progress:null },
      { capabilityRef:'arca.aftercare.media.verify@1', state:'executing', progress:null },
    ],
  }], 'current-work');
  assert.deepEqual(progress, {
    stage:'verifying_media', progressPercent:null, progress:null,
  });
});
