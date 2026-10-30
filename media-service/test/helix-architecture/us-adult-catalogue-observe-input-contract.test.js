'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { createValidator } = require('./fixtures/catalogue-nominal-schemas');
const { coordination } = require('./fixtures/us-adult-catalogue-coordination');
const { catalogueObservationTarget } = require('../../src/helix/domains/libra/model/us-adult-catalogue-observation-result');
const { createUsAdultCatalogueObservationProjections, PROJECTIONS } =
  require('../../src/helix/domains/libra/planning/us-adult-catalogue-observation-planner');
const { CAPABILITY } = require('../../src/helix/contracts/us-adult-catalogue-work-types');

const INPUTS = 'helix://contracts/capabilities/libra.us_adult.catalogue.observe/v1/inputs';
const TARGET = 'helix://contracts/domain-types/WorkspaceArtifactOutputTarget/v1';

function productionSchemas() {
  const root = path.resolve(__dirname, '../../src/helix/contracts');
  const schemas = [];
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.name === 'schema.json') schemas.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
  }
  collect(path.join(root, 'types'));
  collect(path.join(root, 'domain-types'));
  collect(path.join(root, 'application-types'));
  for (const name of ['inputs', 'parameters', 'resource-demand', 'fence', 'evidence', 'failure', 'result']) {
    schemas.push(JSON.parse(fs.readFileSync(path.join(root,
      'capabilities/libra/us_adult/catalogue/observe/v1', name + '.schema.json'), 'utf8')));
  }
  return schemas;
}

test('WorkspaceArtifactOutputTarget admits face_catalogue_observation and rejects unknown kinds', () => {
  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/contracts/domain-types/WorkspaceArtifactOutputTarget/v1/schema.json'), 'utf8'));
  assert.deepEqual(schema.properties.outputKind.enum,
    ['frame_set', 'western_analysis', 'face_catalogue_observation']);
  const validator = createCapabilityContractValidator({ schemas: productionSchemas() });
  const rootSnapshot = {
    rootId: 'root', ownerScope: 'libra', rootKind: 'libra_workspace', endpointId: 'endpoint',
    mountScopeId: 'mount', mountScopeRevision: 1, configRevision: 1, capabilityDigest: 'a'.repeat(64),
    state: 'active', rootHandleRef: 'b'.repeat(64), snapshotDigest: 'c'.repeat(64),
  };
  const body = {
    targetId: 'd'.repeat(64), libraRunId: 'run', executionBasisDigest: 'e'.repeat(64), workspaceId: 'workspace',
    expectedWorkspaceRevision: 1, expectedWorkspaceStateDigest: 'f'.repeat(64), rootSnapshot,
    workspaceScopeDigest: '1'.repeat(64), targetRelativePath: 'analysis/catalogue-observations/x.json',
    outputKind: 'face_catalogue_observation', sourceInputDigest: '2'.repeat(64),
    effectScopeDigest: '3'.repeat(64), targetDigest: '4'.repeat(64),
  };
  assert.equal(validator.validate(TARGET, body).outputKind, 'face_catalogue_observation');
  assert.throws(() => validator.validate(TARGET, { ...body, outputKind: 'western_analysis_extra' }),
    (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED');
});

test('observe Owner projections validate against production inputs schema without silent fallback', async (t) => {
  const f = coordination(t);
  f.reconcile();
  await f.completeFrames('initial');
  const observed = await f.completeObservation('initial');
  const validator = createValidator({
    includeProposed: true,
    includeApplicationTypes: true,
    capabilitySchemaRefs: [CAPABILITY],
  });
  const production = createCapabilityContractValidator({ schemas: productionSchemas() });
  const options = { ...f.options, contractValidator: validator, workspaceProductPort: f.workspace };
  const projections = new Map(createUsAdultCatalogueObservationProjections(options)
    .map((entry) => [entry.projectionRef, entry.projection]));
  const parameters = {
    analysisId: f.basis.analysisId,
    basisDigest: f.basis.basisDigest,
    mode: 'initial',
    completedBatchSetDigest: observed.completedBatches.setDigest,
  };
  const ownerScope = { ownerDomain: 'libra', processType: 'libra_run', processId: 'run' };
  const namedInputs = {
    usAdultCatalogueAnalysisBasis: projections.get(PROJECTIONS.basis).project({ ownerScope, parameters }),
    usAdultCatalogueCompletedBatchSet: projections.get(PROJECTIONS.batches).project({ ownerScope, parameters }),
    workspaceArtifactOutputTarget: projections.get(PROJECTIONS.target).project({ ownerScope, parameters }),
  };
  assert.equal(namedInputs.workspaceArtifactOutputTarget.outputKind, 'face_catalogue_observation');
  assert.deepEqual(
    namedInputs.workspaceArtifactOutputTarget,
    catalogueObservationTarget({
      basis: f.basis,
      completedBatches: observed.completedBatches,
      workspace: f.workspaceState,
      rootSnapshot: f.workspace.rootSnapshot(),
    }),
  );
  // This is the EventExecutionInputProvider gate that production failed with
  // P4_CAPABILITY_SCHEMA_REJECTED / failureClass=input_projection.
  assert.equal(production.validate(INPUTS, namedInputs).workspaceArtifactOutputTarget.outputKind,
    'face_catalogue_observation');
  assert.throws(
    () => production.validate(INPUTS, {
      ...namedInputs,
      workspaceArtifactOutputTarget: {
        ...namedInputs.workspaceArtifactOutputTarget,
        outputKind: 'unknown_catalogue_kind',
      },
    }),
    (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED',
  );
});
