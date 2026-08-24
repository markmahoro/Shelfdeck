'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertAftercareWorkspaceRootAvailable,
} = require('../../src/clean-service-host');

test('Aftercare Workspace startup gate rejects overlap with any owner-projected active root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aftercare-root-gate-'));
  try {
    const aftercare = path.join(root, 'workspaces', 'aftercare');
    assert.equal(assertAftercareWorkspaceRootAvailable(aftercare, [{
      kind:'libra-workspace', rootId:'libra-root', resolvedRoot:path.join(root, 'workspaces', 'libra'),
    }]), path.resolve(aftercare));
    for (const reservedRoot of [aftercare, path.dirname(aftercare), path.join(aftercare, 'field')]) {
      assert.throws(() => assertAftercareWorkspaceRootAvailable(aftercare, [{
        kind:'material-field', rootId:'field-1', resolvedRoot:reservedRoot,
      }]), (error) => error.code === 'ARCA_AFTERCARE_WORKSPACE_ROOT_OVERLAP' &&
        error.details.reservedKind === 'material-field' && error.details.reservedRootId === 'field-1');
    }
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('clean composition gathers Field, Shelf, Libra, and Platform roots without querying foreign tables from Arca', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/clean-service-host.js'), 'utf8');
  assert.match(source, /assertAftercareWorkspaceRootAvailable\(aftercareWorkspaceRoot/);
  assert.match(source, /materialFieldStore\.listMaterialFields\(\)/);
  assert.match(source, /arcaShelfAdmin\.listShelves\(\)\.items/);
  assert.match(source, /locationRegistryRepository\.listWorkspaceRoots\(\)/);
  const projection = source.indexOf('const aftercareReservedRoots = ['),
    firstGate = source.indexOf('assertAftercareWorkspaceRootAvailable(aftercareWorkspaceRoot, aftercareReservedRoots)', projection),
    mkdir = source.indexOf('fs.mkdirSync(aftercareWorkspaceRoot', firstGate),
    realpathGate = source.indexOf('assertAftercareWorkspaceRootAvailable(aftercareWorkspaceRoot, aftercareReservedRoots)', firstGate + 1);
  assert.ok(projection >= 0 && projection < firstGate && firstGate < mkdir && mkdir < realpathGate);
  const store = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/arca/persistence/aftercare-workspace-store.js'), 'utf8');
  assert.doesNotMatch(store, /procurement_material_fields|arca_shelves|libra_workspaces/);
});

test('Aftercare filesystem capabilities declare every workspace and target mount they touch', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  const render = source.slice(source.indexOf("if(['arca.aftercare.text_artifact.render@1'"),
    source.indexOf("if(capability==='arca.aftercare.binary_artifact.acquire@1')"));
  assert.match(render, /validatedVolumeKeys\.add\(workspaceMount\)/);
  assert.match(render, /volume_read:'\+targetMount/);
  assert.match(render, /volume_write:'\+workspaceMount/);
  const materialize = source.slice(source.indexOf("if(capability==='arca.aftercare.artifact.materialize@1')"),
    source.indexOf("if(capability==='arca.aftercare.media.verify@1')"));
  assert.match(materialize, /validatedVolumeKeys\.add\(workspaceMount\)/);
  assert.match(materialize, /volume_read:'\+workspaceMount/);
  assert.match(materialize, /volume_mutation:'\+targetMount/);
  const verify = source.slice(source.indexOf("if(capability==='arca.aftercare.media.verify@1')"),
    source.indexOf("if(capability==='arca.aftercare.input_settlement.delete@1')"));
  assert.match(verify, /validatedVolumeKeys\.add\(workspaceMount\)/);
  assert.match(verify, /volume_read:'\+targetMount/);
  assert.match(verify, /volume_read:'\+workspaceMount/);
  const reclaim = source.slice(source.indexOf("if(capability==='arca.aftercare.workspace.reclaim@1')"),
    source.indexOf("if(\['arca.aftercare.assessment.commit@1'"));
  assert.match(reclaim, /validatedVolumeKeys\.add\(workspaceMount\)/);
  assert.match(reclaim, /volume_mutation:'\+workspaceMount/);
});

test('Aftercare remux and transcode freeze the same twelve-hour deadline used by local FFmpeg', () => {
  const composition = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  assert.match(composition, /AFTERCARE_LONG_MEDIA_TIMEOUT_MS = 12 \* 60 \* 60 \* 1000/);
  assert.match(composition, /timeout\/aftercare-long-media\/v1/);
  const policy = composition.slice(composition.indexOf('const timeoutPolicyFor'),
    composition.indexOf('const policyRegistry'));
  assert.match(policy, /arca\.aftercare\.media\.remux@1/);
  assert.match(policy, /arca\.aftercare\.media\.transcode@1/);
  assert.match(policy, /timeoutPolicies\[3\]\.ref/);
  const capability = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/arca/capabilities/aftercare-capability-ports.js'), 'utf8');
  const ffmpeg = capability.slice(capability.indexOf('function runFfmpeg'),
    capability.indexOf('function resolveAftercareFfmpegPath'));
  const media = capability.slice(capability.indexOf('async function mediaEffect'),
    capability.indexOf('ports[C.remux]'));
  assert.match(ffmpeg, /deadlineAtMs/);
  assert.match(media, /execution\.deadlineAtMs/);
});
