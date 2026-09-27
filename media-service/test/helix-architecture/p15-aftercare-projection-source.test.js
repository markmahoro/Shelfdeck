'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolvePreparedOutput,
  createAftercareProjections,
} = require('../../src/helix/domains/arca/planning/aftercare-projections');
const { P } = require('../../src/helix/domains/arca/planning/aftercare-planners');
const { CAPABILITY_REFS:C } = require('../../src/helix/domains/arca/model/aftercare-contract');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  projectActiveRepairProgress,
} = require('../../src/helix/domains/arca/application/aftercare-process-coordinator');

for (const projectionRef of [P.assessmentSet, P.commit]) {
  test(`assessment projection reads one consistent fresh context per call: ${projectionRef}`, () => {
    let reads = 0;
    const projections = createAftercareProjections({
      contextReader:{ read() { return { shelfEntryId:'entry', basis:{ digest:canonicalDigest(++reads) } }; } },
      materialControlProjectionPort:{ getMaterialControlProjections() { return []; } },
      controlScopeDigest:canonicalDigest,
      workResultReader:{ read(workId) {
        assert.equal(workId, 'assessment-work');
        return ['custody','presentation','conformance'].map(kind => ({
          outcomeKind:'succeeded', capabilityRef:C[kind],
          result:{ evidenceKind:'arca_aftercare_' + kind, evidenceId:kind,
            schemaRef:'helix://test/' + kind, payloadDigest:canonicalDigest(kind) },
        }));
      } },
    });
    const projection = projections.find(item => item.projectionRef === projectionRef).projection;
    const command = { ownerScope:{ processId:'entry' },
      parameters:{ workId:'assessment-work', eventId:'event', deep:true } };
    const first = projection.project(command);
    assert.equal(reads, 1);
    const second = projection.project(command);
    assert.equal(reads, 2, 'a later projection must read fresh business facts');
    if (projectionRef === P.assessmentSet) {
      assert.equal(first.careBasisDigest, canonicalDigest(1));
      assert.equal(second.careBasisDigest, canonicalDigest(2));
    } else {
      assert.equal(first.eventFenceDigest, canonicalDigest({
        schema:'arca.aftercare-assessment-fence@1', eventId:'event', basis:canonicalDigest(1),
      }));
      assert.notEqual(first.eventFenceDigest, second.eventFenceDigest);
    }
  });
}

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
      progress:{ mode:'determinate', currentValue:42, totalValue:100, sampledAtMs:Date.now() },
    }] },
  ], 'current-work');
  assert.equal(progress.stage, 'preparing_media');
  assert.equal(progress.progressPercent, 42);

  const terminalSample = projectActiveRepairProgress([{
    workId:'current-work', events:[{
      capabilityRef:'arca.aftercare.media.transcode@1', state:'executing',
      progress:{ mode:'determinate', currentValue:100, totalValue:100, sampledAtMs:Date.now() },
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

test('Aftercare exposes resource waiting and does not present stale progress as live', () => {
  const project=(state,progress)=>projectActiveRepairProgress([{workId:'work',events:[
    {capabilityRef:'arca.aftercare.media.transcode@1',state,progress},
  ]}],'work',200000);
  assert.equal(project('waiting_for_resource',null).stage,'waiting_for_resource');
  assert.deepEqual(project('executing',{mode:'determinate',currentValue:42,totalValue:100,sampledAtMs:1}),
    {stage:'awaiting_media_progress',progressPercent:null,progress:null});
  assert.equal(project('executing',{mode:'determinate',currentValue:43,totalValue:100,sampledAtMs:199999}).progressPercent,43);
});
