'use strict';

const EXTERNAL_LANDING_OBSERVATION_TIMEOUT_MS = 30 * 60 * 1000;

const { canonicalDigest } = require('../../../contracts/canonical-json');
const contracts = require('../model/external-material-contracts');

const BASE = 'helix://contracts/capabilities/';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function requireNamed(context, names) {
  for (const name of names) {
    if (!context?.namedInputs || !Object.hasOwn(context.namedInputs, name)) {
      throw new TypeError('External Material Capability input is absent: ' + name);
    }
  }
}

function evidence(capabilityRef, basisDigest, result, observedAtMs) {
  return Object.freeze({
    evidenceId: stable('libra-external-material-evidence-', {
      capabilityRef,
      basisDigest,
      payloadDigest: canonicalDigest(result),
    }),
    evidenceKind: 'libra_external_material_capability_result',
    producerRef: capabilityRef,
    basisDigest,
    payloadDigest: canonicalDigest(result),
    observedAtMs,
  });
}

function succeeded(capabilityRef, result, observedAtMs, effectReceipt = null,
  suppliedEvidence = null) {
  const basisDigest = canonicalDigest({
    schema: 'libra.external-material-capability-result-basis@1',
    capabilityRef,
    result,
  });
  return Object.freeze({
    kind: 'succeeded',
    resultSchemaRef: BASE + capabilityRef.replace('@1', '/v1/result'),
    result,
    evidenceSchemaRef: BASE + capabilityRef.replace('@1', '/v1/evidence'),
    evidence: suppliedEvidence || evidence(capabilityRef, basisDigest, result,
      observedAtMs),
    ...(effectReceipt ? { effectReceipt } : {}),
  });
}

function exactEffectReceipt(context, effectClass, result, committedAtMs,
  externalReceiptRef = null, verificationEvidenceDigest = null) {
  const effectId = canonicalDigest([effectClass, context.idempotencyKey]);
  const outputDigest = canonicalDigest(result);
  return Object.freeze({
    schemaRef: 'helix://contracts/types/EffectReceipt/v1',
    schemaVersion: 1,
    effectReceiptId: canonicalDigest({
      schema: 'libra.external-material-effect-receipt-id@1',
      effectId,
      outputDigest,
    }),
    effectId,
    effectClass,
    idempotencyKey: context.idempotencyKey,
    commitMarker: stable('libra-external-material-effect-marker-', {
      effectId,
      outputDigest,
    }),
    externalReceiptRef,
    outputDigest,
    verificationEvidenceDigest: verificationEvidenceDigest || outputDigest,
    committedAtMs,
  });
}

function productStructure(context, explicit) {
  if (explicit) return explicit;
  throw new TypeError('External acquisition Product Structure is absent.');
}

function createExternalMaterialCapabilityPorts(options) {
  const now = options?.now || Date.now;
  const executeExternalProvider = options?.executeExternalProvider ||
    (async () => { throw new TypeError('External Provider port is unavailable.'); });
  const importExternalMaterial = options?.workspaceProductPort
    ?.importExternalMaterial?.bind(options.workspaceProductPort) ||
    (async () => { throw new TypeError('Workspace external import port is unavailable.'); });

  async function provider(operationId, effectClass, integrationHandle, input,
    idempotencyKey, timeoutMs = 30_000) {
    const response = await executeExternalProvider({
      operationId,
      effectClass,
      integrationHandle,
      idempotencyKey,
      timeoutMs,
      input,
    });
    if (!response || response.operationId !== operationId ||
        response.effectClass !== effectClass ||
        response.integrationId !== integrationHandle.integrationId ||
        response.configRevision !== integrationHandle.configRevision ||
        response.idempotencyKey !== idempotencyKey) {
      throw new TypeError('External Provider response escaped its frozen Integration fence.');
    }
    return response;
  }

  const ports = {
    'libra.external_material.query.prepare@1': {
      validateInputs(context) {
        requireNamed(context, ['resolvedProductIdentity', 'productStructure','mediaRequirement','acquisitionPolicy']);
      },
      execute(context) {
        const result = contracts.buildAcquisitionQuery({
          resolvedProductIdentity: context.namedInputs.resolvedProductIdentity,
          productStructure: productStructure(context,
            context.namedInputs.productStructure),
          mediaRequirement:context.namedInputs.mediaRequirement,
          acquisitionPolicy:context.namedInputs.acquisitionPolicy,
          executionContext: {
            libraRunId: context.ownerScope.processId,
            runExecutionBasisDigest: context.basisRefs[0].digest,
          },
          producedAtMs: now(),
        });
        return succeeded(context.capabilityRef, result, now());
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.queryDigest) throw new TypeError('Acquisition Query is absent.');
      },
    },
    'libra.external_material.search@1': {
      validateInputs(context) {
        requireNamed(context, ['acquisitionQuery', 'integrationHandle']);
      },
      async execute(context) {
        const input = context.namedInputs;
        const response = await provider(context.capabilityRef,
          'pure_observation', input.integrationHandle,
          { acquisitionQuery:input.acquisitionQuery, limit:100 },
          context.idempotencyKey);
        const result = Object.freeze({
          schemaRef: 'helix://contracts/types/AcquisitionCandidates/v1',
          schemaVersion: 1,
          evidenceId: stable('libra-external-acquisition-candidates-', {
            requestDigest: response.requestDigest,
            responseDigest: response.responseDigest,
          }),
          evidenceKind: 'external_acquisition_candidates',
          producerRef: response.transportRequestId,
          basisDigest: response.requestDigest,
          payloadDigest: canonicalDigest(response.result),
          observedAtMs: now(),
          queryDigest: response.result.queryDigest,
          integrationId: response.integrationId,
          configRevision: response.configRevision,
          candidates: Object.freeze(response.result.candidates),
          candidateSetDigest: response.result.candidateSetDigest,
        });
        contracts.assertCandidates(result);
        return succeeded(context.capabilityRef, result, result.observedAtMs);
      },
      validateResult(_context, outcome) {
        contracts.assertCandidates(outcome?.result);
      },
    },
    'libra.external_material.candidate.select@1': {
      validateInputs(context) {
        requireNamed(context, ['candidates', 'selectionCriteria']);
      },
      execute(context) {
        const result = contracts.selectCandidate({
          candidates: context.namedInputs.candidates,
          selectionCriteria: context.namedInputs.selectionCriteria,
          producedAtMs: now(),
        });
        return succeeded(context.capabilityRef, result, now());
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.draftDigest) throw new TypeError('External Candidate selection is absent.');
      },
    },
    'libra.external_material.acquire.request@1': {
      validateInputs(context) {
        requireNamed(context, ['selectedCandidateSelected', 'acquisitionQuery',
          'integrationHandle']);
      },
      async execute(context) {
        const input = context.namedInputs;
        if (input.selectedCandidateSelected.result !== 'selected') {
          throw new TypeError('External acquisition requires a selected Candidate.');
        }
        const response = await provider(context.capabilityRef,
          'external_request', input.integrationHandle, {
            selectedCandidate: input.selectedCandidateSelected,
            acquisitionQuery: input.acquisitionQuery,
          }, context.idempotencyKey);
        const result = response.result.externalJobReceipt;
        const receipt = exactEffectReceipt(context, 'external_request', result,
          result.createdAtMs, result.receiptId, canonicalDigest(result));
        return succeeded(context.capabilityRef, result, result.createdAtMs,
          receipt);
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.receiptId) throw new TypeError('External Job Receipt is absent.');
      },
    },
    'libra.external_material.acquire.observe@1': {
      validateInputs(context) {
        requireNamed(context, ['externalJobReceipt', 'integrationHandle']);
      },
      async execute(context) {
        const input = context.namedInputs;
        const response = await provider(context.capabilityRef,
          'pure_observation', input.integrationHandle, {
            externalJobReceipt: input.externalJobReceipt,
            phase: 'download',
          }, context.idempotencyKey,
          EXTERNAL_LANDING_OBSERVATION_TIMEOUT_MS);
        if (response.result.state === 'pending') {
          return Object.freeze({
            kind: 'deferred',
            reasonCode: 'external_job_pending',
            retryAfterMs: 30_000,
            evidence: Object.freeze({
              externalJobReceiptId: input.externalJobReceipt.receiptId,
              providerObservationRevision:
                response.result.providerObservationRevision,
              snapshotDigest: response.result.snapshotDigest,
            }),
          });
        }
        if (response.result.state === 'failed') {
          return Object.freeze({
            kind: 'failed',
            failureClass: 'business',
            code: response.result.reasonCode,
            message: 'External acquisition failed terminally.',
            retryDirective: 'never',
            evidence: Object.freeze({
              externalJobReceiptId: input.externalJobReceipt.receiptId,
              snapshotDigest: response.result.snapshotDigest,
            }),
          });
        }
        const result = contracts.buildAcquisitionObservation({
          externalJobReceipt: input.externalJobReceipt,
          providerSnapshot: response.result,
          phase: 'download',
          producerRef: response.transportRequestId,
          observedAtMs: now(),
        });
        return succeeded(context.capabilityRef, result, result.observedAtMs);
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.observationDigest) throw new TypeError('Acquisition Observation is absent.');
      },
    },
    'libra.external_material.output.resolve@1': {
      validateInputs(context) {
        requireNamed(context, ['acquisitionObservation', 'productStructure']);
      },
      execute(context) {
        const result = contracts.buildExternalMaterialHandle({
          acquisitionObservation: context.namedInputs.acquisitionObservation,
          productStructure: context.namedInputs.productStructure,
        });
        return succeeded(context.capabilityRef, result, now());
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.handleId) throw new TypeError('External Material Handle is absent.');
      },
    },
    'libra.external_material.stability.observe@1': {
      validateInputs(context) {
        requireNamed(context, ['externalMaterialHandle', 'integrationHandle']);
      },
      async execute(context) {
        const input = context.namedInputs;
        const response = await provider(context.capabilityRef,
          'pure_observation', input.integrationHandle, {
            externalMaterialHandle: input.externalMaterialHandle,
            quietWindowMs: 60_000,
          }, context.idempotencyKey,
          EXTERNAL_LANDING_OBSERVATION_TIMEOUT_MS);
        let result;
        try {
          result = contracts.buildStableEvidence({
            externalMaterialHandle: input.externalMaterialHandle,
            providerSnapshot: response.result,
            quietWindowMs: 60_000,
            verifiedAtMs: now(),
          });
        } catch (error) {
          if (error?.code !== 'P9_EXTERNAL_STABILITY_DEFERRED') throw error;
          return Object.freeze({
            kind: 'deferred',
            reasonCode: 'quiet_window_not_reached',
            retryAfterMs: 30_000,
            evidence: Object.freeze({
              sourceExternalMaterialHandleId: input.externalMaterialHandle.handleId,
              providerObservationRevision:
                response.result.providerObservationRevision,
              snapshotDigest: response.result.snapshotDigest,
            }),
          });
        }
        return succeeded(context.capabilityRef, result, result.verifiedAtMs);
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.stableDigest) throw new TypeError('Stable External Material Evidence is absent.');
      },
    },
    'libra.external_material.identity.verify@1': {
      validateInputs(context) {
        requireNamed(context, ['stableEvidence', 'resolvedProductIdentity']);
      },
      execute(context) {
        const result = contracts.verifyIdentity({
          ...context.namedInputs,
          verifiedAtMs: now(),
        });
        return succeeded(context.capabilityRef, result, result.verifiedAtMs);
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.verificationId) throw new TypeError('External Identity verification is absent.');
      },
    },
    'libra.external_material.package.verify@1': {
      validateInputs(context) {
        requireNamed(context, ['stableEvidence', 'identityVerification',
          'episodeDeliveryManifest', 'identityRequirement']);
      },
      execute(context) {
        const result = contracts.verifyPackage({
          ...context.namedInputs,
          verifiedAtMs: now(),
        });
        return succeeded(context.capabilityRef, result, result.verifiedAtMs);
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.verificationId) throw new TypeError('External Package verification is absent.');
      },
    },
    'libra.workspace.material.import@1': {
      validateInputs(context) {
        requireNamed(context, ['stableEvidence', 'verifiedExternalPackage',
          'workspaceDeliveryContract']);
      },
      async execute(context) {
        const input = context.namedInputs;
        const contract = input.workspaceDeliveryContract;
        const verifiedDigest = canonicalDigest(input.verifiedExternalPackage);
        if (input.verifiedExternalPackage.result !== 'passed' ||
            contract.verifiedPackageDigest !== verifiedDigest ||
            contract.stableExternalMaterialHandleId !==
              input.stableEvidence.stableExternalMaterialHandle.handleId) {
          throw new TypeError('Workspace import inputs do not match the verified external package.');
        }
        const result = await importExternalMaterial({
          idempotencyKey: context.idempotencyKey,
          runtimeEffectAuthority:Object.freeze({
            effectClass:'workspace_write',
            eventAttemptId:context.eventAttemptId,
            idempotencyKey:context.idempotencyKey,
          }),
          stableEvidence: input.stableEvidence,
          verifiedExternalPackage: input.verifiedExternalPackage,
          workspaceDeliveryContract: contract,
          producingEventId: context.eventId,
        });
        const verificationDigest = canonicalDigest({
          schema: 'libra.external-import-effect-evidence@1',
          effectId: canonicalDigest(['workspace_write', context.idempotencyKey]),
          contractDigest: contract.digest,
          workspaceMaterialHandleDigest: canonicalDigest(result),
        });
        const receipt = exactEffectReceipt(context, 'workspace_write', result,
          now(), 'workspace://' + result.workspaceId + '/' + result.relativePath,
          verificationDigest);
        return succeeded(context.capabilityRef, result, now(), receipt);
      },
      validateResult(_context, outcome) {
        if (!outcome?.result?.handleId) throw new TypeError('Imported Workspace Material Handle is absent.');
      },
    },
  };

  return Object.freeze(Object.fromEntries(Object.entries(ports)
    .map(([key, value]) => [key, Object.freeze(value)])));
}

module.exports = Object.freeze({
  createExternalMaterialCapabilityPorts,
  exactEffectReceipt,
});
