'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require(
  '../../src/helix/contracts/canonical-json',
);
const {
  createWorkAdmission,
} = require('../../src/helix/foundation/execution/work-admission');
const {
  createWorkLifecycle,
} = require('../../src/helix/foundation/execution/work-lifecycle');
const {
  createWorkflowPlanPublisher,
} = require('../../src/helix/foundation/execution/workflow-plan');
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  buildAuthorizedDefectManifest,
  buildDefectAdmissionCandidate,
} = require('../../src/helix/domains/libra/model/defect-admission-contracts');
const {
  productConformanceWork,
} = require('../../src/helix/domains/libra/planning/product-delivery-work');
const {
  CONFORMANCE_INPUT,
  createProductDeliveryPlanner,
  createProductDeliveryProjections,
} = require('../../src/helix/domains/libra/planning/product-delivery-planner');

const generatedRoot = path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated',
);
const schemaDdl = fs.readFileSync(
  path.join(generatedRoot, 'clean-schema.sql'),
  'utf8',
);
const schemaManifest = JSON.parse(fs.readFileSync(
  path.join(generatedRoot, 'clean-schema.manifest.json'),
  'utf8',
));
const conformanceManifest = require(
  '../../src/helix/contracts/capabilities/libra/product/conformance/verify/v1/manifest.json'
);

const RUN_ID = 'uat-131-product-delivery-run';
const RUN_BASIS = canonicalDigest({ fixture:'uat-131-run-basis' });
const SELECTED_MEDIA_WORK_ID = 'uat-131-selected-media-work';
const DIRECT_VERIFICATION = Object.freeze({
  candidateKind:'direct_input',
  result:'failed',
  libraRunId:RUN_ID,
  verificationId:canonicalDigest({ fixture:'uat-131-direct-verification' }),
  reasonCodes:Object.freeze(['video_codec_unmet']),
});
const ORIGINAL_SELECTION = Object.freeze({
  result:'not_selected',
  draftDigest:canonicalDigest({ fixture:'uat-131-original-selection-draft' }),
});

const registry = Object.freeze({
  snapshot:Object.freeze([Object.freeze({
    capabilityRef:conformanceManifest.capabilityRef,
    contractVersion:conformanceManifest.contractVersion,
    effectClass:conformanceManifest.effectClass,
  })]),
  resolve(capabilityRef, ownerDomain) {
    assert.equal(capabilityRef, conformanceManifest.capabilityRef);
    assert.equal(ownerDomain, 'libra');
    return Object.freeze({ manifest:conformanceManifest });
  },
});
const policyRegistry = Object.freeze({
  digest:canonicalDigest({ fixture:'uat-131-execution-policy' }),
  bindingFor(capabilityRef, effectClass) {
    assert.equal(capabilityRef, conformanceManifest.capabilityRef);
    assert.equal(effectClass, conformanceManifest.effectClass);
    return Object.freeze({
      retryPolicyRef:'helix://foundation/retry-policies/pure-observation/v1',
      timeoutPolicyRef:'helix://foundation/timeout-policies/uat-131/v1',
      compensationContractRefs:Object.freeze([]),
    });
  },
});
const contractValidator = Object.freeze({ validate(_schemaRef, value) {
  return value;
} });

function terminalEvidence(failureCode, capabilityRef) {
  const work = Object.freeze({
    workId:'uat-131-terminal-' + failureCode,
    failureCode,
    capabilityRef,
    failureClass:'business_unachievable',
    terminalEvidenceDigest:canonicalDigest({ failureCode, capabilityRef }),
  });
  const body = { blockedWorks:Object.freeze([work]) };
  return Object.freeze({ ...body, evidenceDigest:canonicalDigest(body) });
}

function authorizedManifests() {
  const candidateA = buildDefectAdmissionCandidate({
    run:Object.freeze({
      libraRunId:RUN_ID,
      state:'frozen',
      stateRevision:3,
      stateDigest:canonicalDigest({ fixture:'uat-131-frozen-a' }),
    }),
    terminalEvidence:terminalEvidence(
      'no_requirement_eligible_candidate',
      'libra.external_material.candidate.select@1',
    ),
    directMediaVerification:DIRECT_VERIFICATION,
  });
  const manifestA = buildAuthorizedDefectManifest({
    candidate:candidateA,
    actorId:'admin',
    idempotencyKey:'uat-131-manifest-a',
    acknowledged:true,
    decidedAtMs:131,
  });
  const candidateB = buildDefectAdmissionCandidate({
    run:Object.freeze({
      libraRunId:RUN_ID,
      state:'frozen',
      stateRevision:5,
      stateDigest:canonicalDigest({ fixture:'uat-131-frozen-b' }),
    }),
    terminalEvidence:terminalEvidence(
      'product_metadata_required_cast_missing',
      'libra.product_metadata.fetch@1',
    ),
    priorAuthorizedManifest:manifestA,
  });
  const manifestB = buildAuthorizedDefectManifest({
    candidate:candidateB,
    actorId:'admin',
    idempotencyKey:'uat-131-manifest-b',
    acknowledged:true,
    decidedAtMs:132,
  });
  return Object.freeze({ manifestA, manifestB });
}

function snapshot(manifest) {
  return Object.freeze({
    run:Object.freeze({
      libraRunId:RUN_ID,
      executionBasisDigest:RUN_BASIS,
      priorityClass:'normal',
      authorizedDefectManifest:manifest,
    }),
  });
}

function createReaders(currentSnapshot) {
  const selectedResults = Object.freeze([
    Object.freeze({
      outcomeKind:'succeeded',
      capabilityRef:'libra.product_output.select@1',
      result:ORIGINAL_SELECTION,
    }),
    Object.freeze({
      outcomeKind:'succeeded',
      capabilityRef:'libra.product_media.verify@1',
      result:DIRECT_VERIFICATION,
    }),
  ]);
  return Object.freeze({
    movieProductionReader:Object.freeze({
      readRunSnapshot(libraRunId) {
        assert.equal(libraRunId, RUN_ID);
        return currentSnapshot.value;
      },
    }),
    workResultReader:Object.freeze({
      listWorks(query) {
        assert.deepEqual(query, {
          ownerDomain:'libra',
          processType:'libra_run',
          processId:RUN_ID,
          workKind:'workspace_media_production',
        });
        return Object.freeze([Object.freeze({
          work_id:SELECTED_MEDIA_WORK_ID,
          state:'succeeded',
        })]);
      },
      read(workId) {
        return workId === SELECTED_MEDIA_WORK_ID
          ? selectedResults
          : Object.freeze([]);
      },
    }),
  });
}

function createFoundation(databasePath, clock) {
  const kernel = openSqliteKernel({
    Database,
    databasePath,
    schemaDdl,
    schemaManifest,
    now:() => clock.value++,
  });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  let attemptOrdinal = 0;
  return Object.freeze({
    kernel,
    admission:createWorkAdmission({
      schemaManifest,
      unitOfWork,
      eligibilityProvider:Object.freeze({
        check(request) {
          return Object.freeze({
            eligible:true,
            basisDigest:request.executionBasisDigest,
          });
        },
      }),
      limits:Object.freeze({
        globalOpenWorks:10,
        ownerOpenWorks:10,
        openEvents:20,
      }),
    }),
    lifecycle:createWorkLifecycle({
      schemaManifest,
      unitOfWork,
      nextWorkAttemptId(workId, ordinal) {
        attemptOrdinal += 1;
        assert.equal(attemptOrdinal, ordinal);
        return workId + ':attempt:' + ordinal;
      },
    }),
    publisher:createWorkflowPlanPublisher({
      schemaManifest,
      unitOfWork,
      registry,
      contractValidator,
      policyRegistry,
    }),
  });
}

function planningRequest(work, activation) {
  return Object.freeze({
    workId:work.workId,
    workAttemptId:activation.attempt.attempt_id,
    ownerDomain:work.ownerDomain,
    processType:work.processType,
    processId:work.processId,
    workKind:work.workKind,
    executionBasisDigest:work.executionBasisDigest,
    priorityClass:work.priorityClass,
  });
}

function readRows(databasePath, sql, ...parameters) {
  const database = new Database(databasePath, { readonly:true });
  try { return database.prepare(sql).all(...parameters); }
  finally { database.close(); }
}

function persistedPlan(databasePath, workId) {
  const rows = readRows(databasePath, `
    SELECT w.work_id,w.idempotency_key,w.state work_state,
           a.attempt_id,a.state attempt_state,
           p.plan_id,p.graph_digest,
           e.event_id,e.state event_state,
           n.input_bindings_json,n.fence_basis_json
      FROM fx_supporting_works w
      JOIN fx_work_attempts a ON a.work_id=w.work_id
      JOIN fx_workflow_plans p ON p.attempt_id=a.attempt_id
      JOIN fx_workflow_events e ON e.plan_id=p.plan_id
      JOIN fx_plan_nodes n ON n.plan_id=p.plan_id AND n.node_id=e.node_id
     WHERE w.work_id=?`, workId);
  assert.equal(rows.length, 1);
  const row = rows[0];
  const bindingSet = JSON.parse(row.input_bindings_json);
  const fence = JSON.parse(row.fence_basis_json);
  return Object.freeze({
    ...row,
    parameters:bindingSet.bindings[0].parameters,
    inputBindingDigest:canonicalDigest(bindingSet),
    eventFenceDigest:fence.eventFenceDigest,
  });
}

function conformanceProjection(options) {
  return createProductDeliveryProjections(options).find((item) =>
    item.projectionRef === CONFORMANCE_INPUT).projection;
}

test('UAT-131 Manifest A to B fences durable Product Delivery identity and restart projection replay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-uat131-delivery-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const clock = { value:1_700_001_310_000 };
  const { manifestA, manifestB } = authorizedManifests();
  assert.notEqual(manifestA.manifestDigest, manifestB.manifestDigest);
  assert.deepEqual(manifestA.waivedRequirementCodes, ['video_codec_unmet']);
  assert.deepEqual(manifestB.waivedRequirementCodes, [
    'metadata_field_unmet',
    'video_codec_unmet',
  ]);

  const currentSnapshot = { value:snapshot(manifestA) };
  const readers = createReaders(currentSnapshot);
  let assemblerCalls = 0;
  const assembler = Object.freeze({
    conformanceInput(libraRunId, selectedMediaWorkId) {
      assemblerCalls += 1;
      return Object.freeze({ libraRunId, selectedMediaWorkId });
    },
  });
  const planner = createProductDeliveryPlanner({
    ...readers,
    registry,
    policyRegistry,
  });
  let foundation = createFoundation(databasePath, clock);
  try {
    const workA = productConformanceWork(
      currentSnapshot.value,
      Object.freeze({
        workId:SELECTED_MEDIA_WORK_ID,
        executionBasisDigest:RUN_BASIS,
      }),
    );
    assert.deepEqual(foundation.admission.submit(workA), {
      kind:'admitted', workId:workA.workId, state:'admitted', replayed:false,
    });
    assert.deepEqual(foundation.admission.submit(workA), {
      kind:'admitted', workId:workA.workId, state:'admitted', replayed:true,
    });
    const activationA = foundation.lifecycle.ensurePlanningAttempt(workA.workId);
    const activationAReplay = foundation.lifecycle.ensurePlanningAttempt(workA.workId);
    assert.equal(activationAReplay.replayed, true);
    assert.equal(
      activationAReplay.attempt.attempt_id,
      activationA.attempt.attempt_id,
    );
    const planA = planner.plan(planningRequest(workA, activationA));
    const planAReplay = planner.plan(planningRequest(workA, activationAReplay));
    assert.deepEqual(planAReplay, planA);
    assert.equal(foundation.publisher.publish(planA).replayed, false);
    assert.equal(foundation.publisher.publish(planAReplay).replayed, true);
    assert.equal(readRows(databasePath,
      'SELECT count(*) count FROM fx_supporting_works').at(0).count, 1);
    assert.equal(readRows(databasePath,
      'SELECT count(*) count FROM fx_work_attempts').at(0).count, 1);
    assert.equal(readRows(databasePath,
      'SELECT count(*) count FROM fx_workflow_plans').at(0).count, 1);
    assert.equal(readRows(databasePath,
      'SELECT count(*) count FROM fx_workflow_events').at(0).count, 1);
    const durableA = persistedPlan(databasePath, workA.workId);
    assert.equal(
      durableA.parameters.authorizedDefectManifestDigest,
      manifestA.manifestDigest,
    );

    currentSnapshot.value = snapshot(manifestB);
    const projectionBeforeRestart = conformanceProjection({
      ...readers,
      productDeliveryAssembler:assembler,
    });
    assert.throws(() => projectionBeforeRestart.project({
      ownerScope:Object.freeze({
        processType:'libra_run',
        processId:RUN_ID,
      }),
      parameters:durableA.parameters,
    }), /authorized-defect Manifest changed/);
    assert.equal(assemblerCalls, 0);

    const cancelled = foundation.lifecycle.cancelProcess({
      ownerDomain:'libra',
      processType:'libra_run',
      processId:RUN_ID,
      reasonCode:'AUTHORIZED_DEFECT_MANIFEST_CHANGED',
    });
    assert.equal(cancelled.selectedWorks, 1);
    assert.equal(cancelled.cancelledWorks, 1);
    assert.equal(cancelled.cancelledEvents, 1);
    assert.deepEqual(readRows(databasePath,
      'SELECT state FROM fx_supporting_works WHERE work_id=?',
      workA.workId), [{ state:'cancelled' }]);
    assert.deepEqual(readRows(databasePath,
      'SELECT state FROM fx_workflow_events WHERE event_id=?',
      durableA.event_id), [{ state:'cancelled' }]);
    const cancelledA = persistedPlan(databasePath, workA.workId);
    assert.equal(cancelledA.work_state, 'cancelled');
    assert.equal(cancelledA.attempt_state, 'cancelled');
    assert.equal(cancelledA.event_state, 'cancelled');

    foundation.kernel.close();
    foundation = createFoundation(databasePath, clock);
    const projectionAfterRestart = conformanceProjection({
      ...readers,
      productDeliveryAssembler:assembler,
    });
    assert.throws(() => projectionAfterRestart.project({
      ownerScope:Object.freeze({
        processType:'libra_run',
        processId:RUN_ID,
      }),
      parameters:durableA.parameters,
    }), /authorized-defect Manifest changed/);
    assert.equal(assemblerCalls, 0);

    const workB = productConformanceWork(
      currentSnapshot.value,
      Object.freeze({
        workId:SELECTED_MEDIA_WORK_ID,
        executionBasisDigest:RUN_BASIS,
      }),
    );
    assert.notEqual(workB.workId, workA.workId);
    assert.notEqual(workB.idempotencyKey, workA.idempotencyKey);
    assert.deepEqual(foundation.admission.submit(workB), {
      kind:'admitted', workId:workB.workId, state:'admitted', replayed:false,
    });
    const activationB = foundation.lifecycle.ensurePlanningAttempt(workB.workId);
    const planB = planner.plan(planningRequest(workB, activationB));
    assert.equal(foundation.publisher.publish(planB).replayed, false);
    const durableB = persistedPlan(databasePath, workB.workId);

    assert.notEqual(durableB.attempt_id, durableA.attempt_id);
    assert.notEqual(durableB.plan_id, durableA.plan_id);
    assert.notEqual(durableB.graph_digest, durableA.graph_digest);
    assert.notEqual(durableB.event_id, durableA.event_id);
    assert.notEqual(durableB.eventFenceDigest, durableA.eventFenceDigest);
    assert.notEqual(durableB.inputBindingDigest, durableA.inputBindingDigest);
    assert.equal(
      durableB.parameters.authorizedDefectManifestDigest,
      manifestB.manifestDigest,
    );
    assert.equal(cancelledA.event_state, 'cancelled');
    assert.equal(durableB.event_state, 'ready');
    assert.equal(readRows(databasePath,
      'SELECT count(*) count FROM fx_event_result_bindings WHERE event_id=?',
      durableA.event_id).at(0).count, 0);

    assert.deepEqual(projectionAfterRestart.project({
      ownerScope:Object.freeze({
        processType:'libra_run',
        processId:RUN_ID,
      }),
      parameters:durableB.parameters,
    }), {
      libraRunId:RUN_ID,
      selectedMediaWorkId:SELECTED_MEDIA_WORK_ID,
    });
    assert.equal(assemblerCalls, 1);
  } finally {
    foundation.kernel.close();
    fs.rmSync(root, { recursive:true, force:true });
  }
});
