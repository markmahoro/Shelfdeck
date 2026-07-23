'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const {
  createCanonicalTransactionRegistry,
  createDomainCommitCoordinator,
  createDomainCommitRegistry,
} = require('../../../foundation/persistence/domain-commit-registry');
const {
  PAGE_SCHEMA,
  requestBasis,
} = require('../model/field-observation-contracts');
const {
  FACT_SCHEMA,
  RESULT_SCHEMA,
  createFieldObservationCommitRegistration,
  createFieldObservationStore,
} = require('../persistence/field-observation-store');
const observationTransaction = require(
  '../../../contracts/transaction-contracts/helix.transaction.field-observation-page-commit/v1/contract.json'
);

const CAPABILITY_REF = 'procurement.field.observation.commit@1';
const CAPABILITY_INPUTS =
  'helix://contracts/capabilities/procurement.field.observation.commit/v1/inputs';
const CAPABILITY_PARAMETERS =
  'helix://contracts/capabilities/procurement.field.observation.commit/v1/parameters';
const CAPABILITY_FENCE =
  'helix://contracts/capabilities/procurement.field.observation.commit/v1/fence';
const CAPABILITY_DEMAND =
  'helix://contracts/capabilities/procurement.field.observation.commit/v1/resource-demand';
const MAX_PAGES = 10_001;

class FieldObservationAdminServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldObservationAdminServiceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldObservationAdminServiceError(code, message, details);
}

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function validateInput(input) {
  const keys = [
    'fieldId',
    'idempotencyKey',
    'expectedAccessRevision',
    'expectedObservationRevision',
    'pageBudget',
  ];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(input, key)) ||
      typeof input.fieldId !== 'string' || input.fieldId.length === 0 ||
      typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0 ||
      !Number.isSafeInteger(input.expectedAccessRevision) || input.expectedAccessRevision < 1 ||
      !Number.isSafeInteger(input.expectedObservationRevision) ||
      input.expectedObservationRevision < 0 ||
      !Number.isSafeInteger(input.pageBudget) || input.pageBudget < 1 ||
      input.pageBudget > 100) {
    fail('FIELD_OBSERVATION_ADMIN_INPUT_INVALID', '显式观察请求不符合closed input合同。');
  }
}

function createAccessHandle(field, workId, nowMs) {
  const access = field.access;
  const containmentDigest = canonicalDigest({
    schema: 'procurement.field-access-containment@1',
    fieldId: field.fieldId,
    accessRevision: access.revision,
    endpointId: access.endpointId,
    rootLocation: access.rootLocation,
    mountScopeId: access.mountScopeId,
    mountScopeRevision: access.mountScopeRevision,
  });
  return Object.freeze({
    schemaRef: 'helix://contracts/types/FieldAccessHandle/v1',
    schemaVersion: 1,
    handleId: stableId('field-access-handle-', {
      workId,
      accessDigest: access.accessDigest,
      containmentDigest,
    }),
    fieldId: field.fieldId,
    accessRevision: access.revision,
    accessDigest: access.accessDigest,
    endpointId: access.endpointId,
    rootLocation: access.rootLocation,
    mountScopeId: access.mountScopeId,
    mountScopeRevision: access.mountScopeRevision,
    allowedOperations: Object.freeze(['read', 'list', 'stat', 'hash']),
    containmentDigest,
    expiresAtMs: nowMs + 3_600_000,
  });
}

function pageRequest(workId, ordinal, expectedRevision, cursorIn, pageBudget) {
  const value = {
    schemaRef: 'helix://contracts/types/FieldObservationPageRequest/v1',
    schemaVersion: 1,
    fieldObservationWorkId: workId,
    observationId: stableId('field-observation-', { workId, ordinal }),
    pageOrdinal: ordinal,
    expectedObservationRevision: expectedRevision,
    cursorIn,
    pageBudget,
    requestDigest: '',
  };
  value.requestDigest = canonicalDigest(requestBasis(value));
  return Object.freeze(value);
}

function domainHandle(page, eventId, idempotencyKey) {
  return Object.freeze({
    schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1',
    schemaVersion: 1,
    handleId: stableId('field-observation-handle-', { eventId, pageDigest: page.pageDigest }),
    ownerDomain: 'procurement',
    aggregateType: 'material_field_observation',
    aggregateId: page.fieldId,
    factType: 'FieldObservationPage',
    factSchemaRef: FACT_SCHEMA,
    resultSchemaRef: RESULT_SCHEMA,
    expectedRevision: page.expectedObservationRevision,
    payloadDigest: canonicalDigest(page),
    commitIdempotencyKey: idempotencyKey + ':page:' + page.pageOrdinal,
    eventFenceDigest: canonicalDigest({
      schema: 'procurement.field-observation-event-fence@1',
      eventId,
      fieldId: page.fieldId,
      expectedObservationRevision: page.expectedObservationRevision,
      pageDigest: page.pageDigest,
    }),
  });
}

function stepFor(page, idempotencyKey) {
  const eventId = stableId('field-observation-event-', {
    workId: page.fieldObservationWorkId,
    pageOrdinal: page.pageOrdinal,
  });
  const handle = domainHandle(page, eventId, idempotencyKey);
  const input = Object.freeze({
    fieldObservationPage: page,
    domainFactCommitHandle: handle,
  });
  const inputSetDigest = canonicalDigest(input);
  const resourceBasis = Object.freeze({
    resourceKinds: Object.freeze(['cpu']),
  });
  return Object.freeze({
    nodeId: 'field-observation-page-' + String(page.pageOrdinal).padStart(6, '0'),
    eventId,
    capabilityRef: CAPABILITY_REF,
    effectClass: 'domain_fact_commit',
    inputSchemaRef: CAPABILITY_INPUTS,
    input,
    parametersSchemaRef: CAPABILITY_PARAMETERS,
    parameters: Object.freeze({}),
    fenceSchemaRef: CAPABILITY_FENCE,
    fenceBasis: Object.freeze({
      basisDigest: page.basisDigest,
      inputSetDigest,
      eventFenceDigest: handle.eventFenceDigest,
      effectScopeDigest: canonicalDigest({
        schema: 'procurement.field-observation-effect-scope@1',
        fieldId: page.fieldId,
        expectedObservationRevision: page.expectedObservationRevision,
      }),
    }),
    resourceDemandSchemaRef: CAPABILITY_DEMAND,
    resourceDemand: Object.freeze({
      ...resourceBasis,
      demandDigest: canonicalDigest(resourceBasis),
    }),
  });
}

function workDefinition(field, input, workId, basisDigest) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId,
    ownerDomain: 'procurement',
    processType: 'material_field',
    processId: field.fieldId,
    workKind: 'field_observation',
    workObjectiveTypeRef: 'helix://procurement/work/FieldObservation/v1',
    workObjectiveVersion: 1,
    executionBasisId: stableId('field-observation-basis-', {
      fieldId: field.fieldId,
      accessRevision: field.access.revision,
      expectedObservationRevision: input.expectedObservationRevision,
    }),
    executionBasisDigest: basisDigest,
    dependencyRefs: Object.freeze([]),
    priorityClass: 'background_observation',
    priorityRevision: 1,
    capabilityCatalogScope: 'procurement',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: input.idempotencyKey,
    concurrencyScope: field.fieldId + '/field-observation',
    outputContractRef: 'helix://contracts/results/ObservationCommitResult/v1',
  });
}

function pageSummary(step, replayed) {
  const page = step.input.fieldObservationPage;
  return Object.freeze({
    observationId: page.observationId,
    pageOrdinal: page.pageOrdinal,
    committedObservationRevision: page.expectedObservationRevision + 1,
    pageDigest: page.pageDigest,
    acceptedMaterialCount: page.materialObservations.length,
    nextCursor: page.cursorOut,
    hasMore: page.hasMore,
    replayed,
  });
}

function createFieldObservationAdminService(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.materialFieldStore ||
      !options.workRuntime || !options.enumerator ||
      typeof options.pageObserverFactory !== 'function' ||
      typeof options.now !== 'function') {
    fail('FIELD_OBSERVATION_ADMIN_DEPENDENCIES', 'Field Observation Admin service dependencies are required.');
  }
  const observationStore = createFieldObservationStore({
    schemaManifest: options.schemaManifest,
  });
  const registry = createDomainCommitRegistry({
    registrations: [createFieldObservationCommitRegistration(observationStore)],
  });
  const transactionRegistry = createCanonicalTransactionRegistry({
    contracts: [observationTransaction],
  });
  const coordinator = createDomainCommitCoordinator({
    schemaManifest: options.schemaManifest,
    registry,
    transactionRegistry,
    unitOfWork: options.unitOfWork,
  });

  async function buildSteps(field, input, workId) {
    const nowMs = options.now();
    const handle = createAccessHandle(field, workId, nowMs);
    const scan = await options.enumerator.scan(handle);
    const observer = options.pageObserverFactory({
      now: options.now,
      enumeratePage: async ({ pageRequest: request }) => {
        const items = scan.items.filter((item) =>
          request.cursorIn === null ||
          Buffer.compare(Buffer.from(item.cursor, 'utf8'), Buffer.from(request.cursorIn, 'utf8')) > 0
        );
        return Object.freeze({ items: Object.freeze(items), hasMore: false });
      },
      producerRef: 'procurement.field.page.observe@1',
    });
    const steps = [];
    let expectedRevision = input.expectedObservationRevision;
    let cursorIn = null;
    for (let ordinal = 0; ordinal < MAX_PAGES; ordinal += 1) {
      const request = pageRequest(
        workId,
        ordinal,
        expectedRevision,
        cursorIn,
        input.pageBudget,
      );
      const page = await observer.observe({
        fieldAccessHandle: handle,
        pageRequest: request,
      });
      steps.push(stepFor(page, input.idempotencyKey));
      if (!page.hasMore) {
        return Object.freeze({
          sourceFileCount: scan.sourceFileCount,
          steps: Object.freeze(steps),
        });
      }
      expectedRevision += 1;
      cursorIn = page.cursorOut;
    }
    fail('FIELD_OBSERVATION_PAGE_BUDGET_EXCEEDED', 'Field Observation页数超过有界执行预算。', {
      maximumPages: MAX_PAGES,
    });
  }

  async function observe(input) {
    validateInput(input);
    const field = options.materialFieldStore.getMaterialField(input.fieldId);
    if (!field) fail('P7_MATERIAL_FIELD_NOT_FOUND', 'Material Field does not exist.');
    const workId = stableId('field-observation-work-', {
      fieldId: input.fieldId,
      idempotencyKey: input.idempotencyKey,
    });
    const preexisting = options.workRuntime.snapshot(workId);
    if (!preexisting) {
      if (field.status !== 'active') {
        fail('P7_MATERIAL_FIELD_DEREGISTERED', 'Deregistered Material Field cannot be observed.');
      }
      if (field.currentAccessRevision !== input.expectedAccessRevision ||
          (field.currentObservationRevision || 0) !== input.expectedObservationRevision) {
        fail('FIELD_OBSERVATION_ADMIN_FENCE_CONFLICT', 'Field Access or Observation revision is stale.', {
          currentAccessRevision: field.currentAccessRevision,
          currentObservationRevision: field.currentObservationRevision || 0,
        });
      }
    }
    const basisDigest = canonicalDigest({
      schema: 'procurement.admin-field-observation-basis@1',
      fieldId: field.fieldId,
      access: field.access,
      expectedObservationRevision: input.expectedObservationRevision,
      pageBudget: input.pageBudget,
    });
    const admission = createWorkAdmission({
      schemaManifest: options.schemaManifest,
      unitOfWork: options.unitOfWork,
      eligibilityProvider: {
        check: (request) => Object.freeze({
          eligible: request.ownerDomain === 'procurement' &&
            request.processId === field.fieldId &&
            request.executionBasisDigest === basisDigest,
          basisDigest,
          reasonCode: 'FIELD_OBSERVATION_BASIS_STALE',
        }),
      },
      limits: Object.freeze({
        globalOpenWorks: 1_000,
        ownerOpenWorks: 500,
        openEvents: 100_000,
      }),
    });
    const admitted = admission.submit(workDefinition(field, input, workId, basisDigest));
    if (admitted.kind === 'deferred') {
      fail('FIELD_OBSERVATION_WORK_DEFERRED', 'Material Field已有未终结的Observation Work。', {
        reasonCode: admitted.reasonCode,
      });
    }
    if (admitted.kind !== 'admitted') {
      fail('FIELD_OBSERVATION_WORK_REJECTED', 'Field Observation Supporting Work未通过准入。', {
        reasonCode: admitted.reasonCode,
      });
    }

    let snapshot = preexisting || options.workRuntime.snapshot(workId);
    let sourceFileCount;
    if (!snapshot?.plan) {
      const constructed = await buildSteps(field, input, workId);
      sourceFileCount = constructed.sourceFileCount;
      snapshot = options.workRuntime.activate({
        workId,
        ownerDomain: 'procurement',
        basisDigest,
        plannerRef: 'procurement.field-observation.admin-coordinator@1',
        catalogDigest: canonicalDigest({
          schema: 'procurement.field-observation-capability-catalog@1',
          capabilityRefs: Object.freeze([
            'procurement.field.page.observe@1',
            CAPABILITY_REF,
          ]),
        }),
        steps: constructed.steps,
      }).snapshot;
    }
    const steps = snapshot.pages;
    const events = snapshot.events;
    if (steps.length !== events.length || steps.length < 1) {
      fail('FIELD_OBSERVATION_WORK_TOPOLOGY_CORRUPT', 'Frozen Observation Work topology is incomplete.');
    }

    const summaries = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const page = step.fieldObservationPage;
      const handle = step.domainFactCommitHandle;
      const event = events[index];
      if (event.event_id !== stableId('field-observation-event-', {
        workId,
        pageOrdinal: page.pageOrdinal,
      })) {
        fail('FIELD_OBSERVATION_WORK_TOPOLOGY_CORRUPT', 'Frozen Event does not match its page ordinal.');
      }
      const state = options.workRuntime.beginEvent(event.event_id);
      let replayed = state.state === 'succeeded';
      if (!replayed) {
        const commitMarker = stableId('field-observation-marker-', {
          eventId: event.event_id,
          pageDigest: page.pageDigest,
        });
        const committed = coordinator.execute({
          transactionId: 'helix.transaction.field-observation-page-commit',
          supportingWorkId: workId,
          handle,
          payload: page,
          commitMarker: {
            commitMarker,
            effectId: null,
            commitDigest: canonicalDigest({
              schema: 'procurement.field-observation-page-commit@1',
              handle,
              page,
              commitMarker,
            }),
          },
          resultBinding: {
            resultId: stableId('field-observation-result-', { eventId: event.event_id }),
            eventId: event.event_id,
            evidenceSchemaRef: PAGE_SCHEMA,
            evidence: page,
          },
          outboxMessages: Object.freeze([]),
        });
        replayed = committed.replayed;
        options.workRuntime.completeEvent(
          event.event_id,
          committed.resultBinding.resultId,
        );
      }
      summaries.push(pageSummary({ input: step }, replayed));
    }
    const completion = options.workRuntime.complete(workId);
    const terminalRevision = steps[steps.length - 1].fieldObservationPage
      .expectedObservationRevision + 1;
    return Object.freeze({
      observationWorkId: workId,
      fieldId: field.fieldId,
      accessRevision: field.access.revision,
      initialObservationRevision: input.expectedObservationRevision,
      terminalObservationRevision: terminalRevision,
      sourceFileCount: sourceFileCount ?? summaries.reduce(
        (total, page) => total + page.acceptedMaterialCount,
        0,
      ),
      pageCount: summaries.length,
      pages: Object.freeze(summaries),
      state: completion.state,
      replayed: admitted.replayed || completion.replayed,
    });
  }

  return Object.freeze({ observe });
}

module.exports = Object.freeze({
  FieldObservationAdminServiceError,
  createFieldObservationAdminService,
});
