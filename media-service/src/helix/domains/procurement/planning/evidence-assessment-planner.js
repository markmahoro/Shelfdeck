'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { activeTriageRule } = require('../model/procurement-run-contracts');

const PROBE = 'shared.material.media.probe@1';
const PLAY = 'procurement.triage.playability.inspect@1';
const STRUCTURE = 'procurement.triage.structure.inspect@1';
const PROBE_BATCH_PROJECTION = 'helix://procurement/input-projections/TriageMaterialProbeBatch/v1';
const STRUCTURE_INPUT_PROJECTION = 'helix://procurement/input-projections/TriageStructureInspectionInput/v1';

function stableId(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function literal(portName, value) { return Object.freeze({ portName, bindingKind: 'literal', value }); }
function workResults(portName, sourceWorkId, resultSchemaRefs, projectionRef, parameters) { return Object.freeze({ portName, bindingKind:'projected_work_results', sourceWorkId, resultSchemaRefs:Object.freeze(resultSchemaRefs), projectionRef, parameters:Object.freeze(parameters) }); }
function bindingSet(bindings) { return Object.freeze({ schemaRef:'helix://foundation/types/EventInputBindingSet/v1', schemaVersion:1, bindings:Object.freeze(bindings) }); }
function demand(resourceKinds) { const value = { resourceKinds:Object.freeze(resourceKinds) }; return Object.freeze({ ...value, demandDigest:canonicalDigest(value) }); }
function relative(root, location) { const r = String(root).replace(/\\/g,'/').replace(/\/+$/,''); const l = String(location).replace(/\\/g,'/'); return l.startsWith(r + '/') ? l.slice(r.length + 1) : null; }
function memberContext(snapshot, material, ordinal) { const location = relative(snapshot.access.root_location, material.member.location); if (location === null) throw new Error('Run material is outside Field root.'); const baseName = path.posix.basename(location); return Object.freeze({ selectionOrdinal:ordinal, materialKey:material.member.material_key, fieldRelativeLocation:location, baseName, extension:path.posix.extname(baseName).toLowerCase() || '.unknown', parentSegments:path.posix.dirname(location).split('/').filter(Boolean) }); }
function selected(snapshot) {
  const members = snapshot.materials.map(({ member, identity }, ordinal) => Object.freeze({ ordinal, materialKey:member.material_key, selectionRole:member.selection_role, physicalIdentity:identity,
    sizeBytes:Number(member.size_bytes), bindingRevision:Number(member.binding_revision), eligibilityRevision:Number(member.eligibility_revision), eligibilityBasisDigest:member.eligibility_basis_digest,
    lastSnapshotDigest:member.last_snapshot_digest, lastObservationId:member.last_observation_id, endpointId:member.endpoint_id, location:member.location,
    realityDigest:member.reality_digest, provenanceDigest:member.provenance_digest, controlSnapshot:Object.freeze({ materialKey:member.material_key, resultKind:'available', controlRevision:Number(member.expected_control_revision), controlState:member.expected_control_state, regionProjection:member.expected_control_region_projection, evidenceDigest:member.expected_control_evidence_digest, projectionDigest:member.expected_control_projection_digest }),
    admissionControlAction:member.admission_control_action, basisMemberDigest:member.basis_member_digest }));
  const value = { procurementRunId:snapshot.run.procurement_run_id, fieldId:snapshot.run.field_id, members:Object.freeze(members) };
  return Object.freeze({ ...value, selectionDigest:canonicalDigest({ schema:'procurement.selected-field-material-set@1', ...value }) });
}
function node(options, ref, nodeId, eventId, bindings, dependsOn, resourceKinds) {
  const manifest = options.registry.resolve(ref, 'procurement').manifest; const policy = options.policyRegistry.bindingFor(ref, manifest.effectClass);
  const fence = { basisDigest:options.request.executionBasisDigest, inputSetDigest:canonicalDigest(bindings), eventFenceDigest:canonicalDigest({ schema:'procurement.triage-event-fence@2', eventId, runId:options.snapshot.run.procurement_run_id }), effectScopeDigest:canonicalDigest({ schema:'procurement.triage-event-scope@2', eventId, runId:options.snapshot.run.procurement_run_id }) };
  return Object.freeze({ nodeId, eventId, capabilityRef:ref, contractVersion:1, inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs'), inputBindings:bindingSet(bindings), parametersSchemaRef:manifest.parametersSchemaRef, parameters:Object.freeze({}), dependsOn:Object.freeze(dependsOn), whenSchemaRef:null, when:null, effectClass:manifest.effectClass, resourceDemandSchemaRef:manifest.resourceDemandSchemaRef, resourceDemand:demand(resourceKinds), approvalRequirementRef:null, authorizationRequirementRef:null, fenceSchemaRef:manifest.fenceSchemaRef, fenceBasis:Object.freeze(fence), retryPolicyRef:policy.retryPolicyRef, timeoutPolicyRef:policy.timeoutPolicyRef, outputContractRef:manifest.resultSchemaRef });
}

function createEvidenceAssessmentPlanner(options) {
  const catalogDigest = executionCatalogDigest(options.registry, options.policyRegistry);
  return Object.freeze({ plannerContractRef:'helix://procurement/planners/EvidenceAssessment/v2', plannerVersion:2,
    plan(request) {
      const snapshot = options.triageReader.read(request.processId);
      const empty = (resolution, diagnostic) => Object.freeze({ schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1', schemaVersion:1, planId:stableId('evidence-plan-', { attempt:request.workAttemptId }), workAttemptId:request.workAttemptId, ownerDomain:'procurement', plannerContractRef:this.plannerContractRef, plannerVersion:2, workObjectiveTypeRef:'helix://procurement/work/EvidenceAssessment/v1', workObjectiveVersion:1, executionBasisDigest:request.executionBasisDigest, capabilityCatalogDigest:catalogDigest, resolution, diagnosticClassification:diagnostic, nodes:Object.freeze([]) });
      if (!snapshot || !['active','waiting'].includes(snapshot.run.state)) return empty('contract_unplannable', 'procurement_run_unavailable');
      const rule = activeTriageRule(options.triageRuleRegistry);
      if (rule.ruleRef !== snapshot.run.triage_rule_ref || rule.revision !== Number(snapshot.run.triage_rule_revision) || rule.authorityDigest !== snapshot.run.triage_rule_authority_digest) throw new Error('Run Triage Rule is no longer available.');
      const structureResultRef = options.registry.resolve(STRUCTURE, 'procurement').manifest.resultSchemaRef;
      const previous = options.workResultReader.read(request.workId).filter((item) => item.outcomeKind === 'succeeded' && item.resultSchemaRef === structureResultRef).sort((a,b) => a.result.pageOrdinal - b.result.pageOrdinal).at(-1)?.result;
      if (previous?.cursorOut === null) throw new Error('Terminal Evidence Assessment Work must not be replanned.');
      if (previous) {
        const eventId = stableId('triage-structure-event-', { attempt:request.workAttemptId, page:previous.pageOrdinal + 1 });
        const refs = [PROBE, PLAY, STRUCTURE].map((ref) => options.registry.resolve(ref, 'procurement').manifest.resultSchemaRef);
        const structure = node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, STRUCTURE, 'structure-' + (previous.pageOrdinal + 1), eventId,
          [workResults('triageStructureInspectionInput', request.workId, refs, STRUCTURE_INPUT_PROJECTION, { runId:request.processId, pageOrdinal:previous.pageOrdinal + 1, cursorIn:previous.cursorOut, maxUnits:32 }), literal('procurementTriageRuleSnapshot', rule)], [], ['cpu']);
        return Object.freeze({ ...empty('planned', null), planId:stableId('evidence-plan-', { attempt:request.workAttemptId }), resolution:'planned', nodes:Object.freeze([structure]) });
      }
      const selection = selected(snapshot); const nodes = []; const probeRefs = [];
      snapshot.materials.forEach((material, ordinal) => { const eventId = stableId('triage-probe-event-', { attempt:request.workAttemptId, ordinal }); nodes.push(node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, PROBE, 'probe-' + ordinal, eventId, [literal('physicalMaterialReadHandleOrWorkspaceMaterialHandle', material.readHandle)], [], ['cpu','disk_io'])); probeRefs.push(Object.freeze({ eventId, resultSchemaRef:options.registry.resolve(PROBE, 'procurement').manifest.resultSchemaRef })); });
      const playRefs = [];
      for (let offset = 0, batchOrdinal = 0; offset < probeRefs.length; offset += 100, batchOrdinal++) { const refs = probeRefs.slice(offset, offset + 100); const eventId = stableId('triage-playability-event-', { attempt:request.workAttemptId, batchOrdinal }); playRefs.push(Object.freeze({ eventId, resultSchemaRef:options.registry.resolve(PLAY, 'procurement').manifest.resultSchemaRef })); nodes.push(node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, PLAY, 'playability-' + batchOrdinal, eventId, [workResults('triageMaterialProbeBatch', request.workId, [options.registry.resolve(PROBE, 'procurement').manifest.resultSchemaRef], PROBE_BATCH_PROJECTION, { runId:request.processId, startOrdinal:offset, batchSize:refs.length, batchOrdinal, runBasisDigest:snapshot.run.run_basis_digest }), literal('procurementTriageRuleSnapshot', rule)], refs.map((ref) => ({ eventId:ref.eventId, satisfaction:'success' })), ['cpu','disk_io'])); }
      const structureEventId = stableId('triage-structure-event-', { attempt:request.workAttemptId, page:0 }); const refs = [PROBE, PLAY].map((ref) => options.registry.resolve(ref, 'procurement').manifest.resultSchemaRef);
      nodes.push(node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, STRUCTURE, 'structure-0', structureEventId, [workResults('triageStructureInspectionInput', request.workId, refs, STRUCTURE_INPUT_PROJECTION, { runId:request.processId, pageOrdinal:0, cursorIn:null, maxUnits:32 }), literal('procurementTriageRuleSnapshot', rule)], [...probeRefs, ...playRefs].map((ref) => ({ eventId:ref.eventId, satisfaction:'success' })), ['cpu']));
      return Object.freeze({ ...empty('planned', null), planId:stableId('evidence-plan-', { attempt:request.workAttemptId }), resolution:'planned', nodes:Object.freeze(nodes) });
    } });
}

function createProbeBatchProjection(options) { return Object.freeze({ project({ sourceResults, parameters }) { const snapshot = options.triageReader.read(parameters.runId); const selection = selected(snapshot); const probeByHandle = new Map(sourceResults.map((source) => [source.result?.sourceHandleDigest, source.result])); const members = []; for (let index=0; index<parameters.batchSize; index++) { const ordinal = parameters.startOrdinal + index; const material = snapshot.materials[ordinal]; const probe = probeByHandle.get(canonicalDigest(material.readHandle)); if (!probe) throw new Error('Probe Batch projection is missing a durable Media Probe Result.'); const value = { selectionOrdinal:ordinal, materialKey:selection.members[ordinal].materialKey, bindingRevision:selection.members[ordinal].bindingRevision, admittedControlRevision:Number(material.member.admitted_control_revision), admittedControlProjectionDigest:material.member.admitted_control_projection_digest, readHandle:material.readHandle, mediaProbe:probe }; members.push(Object.freeze({ ...value, memberDigest:canonicalDigest(value) })); } const value = { procurementRunId:selection.procurementRunId, runBasisDigest:parameters.runBasisDigest, selectionDigest:selection.selectionDigest, batchOrdinal:parameters.batchOrdinal, members:Object.freeze(members) }; return Object.freeze({ ...value, batchDigest:canonicalDigest(value) }); } }); }

function normalizedLocation(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function parentLocation(value) {
  const normalized = normalizedLocation(value);
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '.' : normalized.slice(0, separator);
}

function bdmvRootLocation(value) {
  const parts = normalizedLocation(value).split('/');
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index].toUpperCase() === 'BDMV') return parts.slice(0, index + 1).join('/');
  }
  return null;
}

function observationProjectionEntry(item, context, ordinal) {
  const location = item?.location || context.fieldRelativeLocation;
  const relativeLocation = item?.relativeLocation || context.fieldRelativeLocation;
  const parentRelativeLocation = parentLocation(relativeLocation);
  return {
    entryOrdinal: ordinal,
    materialKey: item?.materialKey || context.materialKey,
    relativeLocation,
    currentLocation: location,
    parentRelativeLocation,
    baseName: context.baseName,
    extension: context.extension,
    identity: item?.identity || null,
    endpointId: item?.endpointId || null,
    sizeBytes: Number(item?.sizeBytes ?? context.sizeBytes ?? 0),
    entryDigest: item?.entryDigest || canonicalDigest({ materialKey: context.materialKey, location }),
  };
}

function createStructureInputProjection(options) {
  return Object.freeze({
    project({ sourceResults, parameters }) {
      const snapshot = options.triageReader.read(parameters.runId);
      const selection = selected(snapshot);
      const contexts = snapshot.materials.map((material, ordinal) => memberContext(snapshot, material, ordinal));
      const probes = sourceResults.filter((source) => source.resultSchemaRef.includes('media.probe')).map((source) => source.result);
      const plays = sourceResults.filter((source) => source.resultSchemaRef.includes('playability.inspect')).map((source) => source.result);
      const probeByHandle = new Map(probes.map((item) => [item.sourceHandleDigest, item]));
      const orderedProbes = snapshot.materials.map((material) => probeByHandle.get(canonicalDigest(material.readHandle)));
      if (orderedProbes.some((item) => !item)) throw new Error('Structure input projection is missing a durable Media Probe Result.');

      // Observation is the durable source of both selected material and nearby sidecar
      // candidates.  The Run selection remains immutable; this projection merely adds
      // already-observed entries from the exact scopes that Related Material may use.
      const observed = typeof options.triageReader.listObservedMaterials === 'function'
        ? options.triageReader.listObservedMaterials(parameters.runId) : [];
      const observedByKey = new Map(observed.map((item) => [item.materialKey, item]));
      const selectedKeys = new Set(selection.members.map((member) => member.materialKey));
      const relatedScopes = new Set();
      const bdmvScopes = new Set();
      for (const context of contexts) {
        const location = observedByKey.get(context.materialKey)?.location || context.fieldRelativeLocation;
        const root = bdmvRootLocation(location);
        if (root) {
          bdmvScopes.add(root);
          relatedScopes.add(parentLocation(root));
        } else relatedScopes.add(parentLocation(location));
      }
      const projectionCandidates = [];
      for (const item of observed) {
        const location = item.location || item.relativeLocation;
        const root = bdmvRootLocation(location);
        const scope = root ? root : parentLocation(location);
        if (selectedKeys.has(item.materialKey) || bdmvScopes.has(root) || relatedScopes.has(scope)) {
          const context = contexts.find((candidate) => candidate.materialKey === item.materialKey) || {
            materialKey: item.materialKey,
            fieldRelativeLocation: item.relativeLocation,
            baseName: String(item.relativeLocation || item.location || '').split('/').at(-1) || item.materialKey.slice(0, 12),
            extension: (() => { const base = String(item.relativeLocation || item.location || '').split('/').at(-1) || ''; const index = base.lastIndexOf('.'); return index >= 0 ? base.slice(index).toLowerCase() : '.unknown'; })(),
            sizeBytes: item.sizeBytes,
          };
          projectionCandidates.push(observationProjectionEntry(item, context, 0));
        }
      }
      // A selected material is always represented, even if a legacy fixture does not
      // expose its observation row.  This keeps the immutable Run fence intact.
      for (const [ordinal, member] of selection.members.entries()) {
        if (projectionCandidates.some((entry) => entry.materialKey === member.materialKey)) continue;
        projectionCandidates.push(observationProjectionEntry(observedByKey.get(member.materialKey), contexts[ordinal], 0));
      }
      const entries = projectionCandidates
        .sort((left, right) => normalizedLocation(left.currentLocation).localeCompare(normalizedLocation(right.currentLocation), 'en-US') ||
          Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)))
        .map((entry, ordinal) => Object.freeze({ ...entry, entryOrdinal: ordinal }));
      if (entries.length > 4096) throw new Error('Observation Scope Projection exceeds its 4096-entry bounded scope.');
      const projectionBase = {
        projectionRevision: Number(snapshot.run.terminal_observation_revision),
        scopeDigest: canonicalDigest({ schema: 'procurement.observation-scope-projection@2', runId: parameters.runId, entries }),
        entriesDigest: canonicalDigest({ schema: 'procurement.observation-scope-entries@2', entries }),
        entryCount: entries.length,
        entries,
      };
      const observationScopeProjection = Object.freeze(projectionBase);
      const materialFieldContextValue = {
        fieldId: snapshot.run.field_id,
        accessRevision: Number(snapshot.run.access_revision),
        accessDigest: snapshot.run.access_digest,
        profileHintSnapshot: Object.freeze({ fieldId: snapshot.run.field_id, revision: Number(snapshot.run.profile_hint_revision),
          contentProfileHint: snapshot.run.content_profile_hint, hintDigest: snapshot.run.profile_hint_digest }),
        memberContexts: Object.freeze(contexts.map((context) => Object.freeze({ ...context, layoutEvidenceRefs: Object.freeze([]) }))),
      };
      const materialFieldContext = Object.freeze({ ...materialFieldContextValue, contextDigest: canonicalDigest(materialFieldContextValue) });
      const pageRequest = Object.freeze({ pageOrdinal: parameters.pageOrdinal, cursorIn: parameters.cursorIn, maxUnits: parameters.maxUnits,
        requestDigest: canonicalDigest({ pageOrdinal: parameters.pageOrdinal, cursorIn: parameters.cursorIn, maxUnits: parameters.maxUnits }) });
      const probeBatches = [];
      for (let offset = 0, batchOrdinal = 0; offset < selection.members.length; offset += 100, batchOrdinal++) {
        const members = selection.members.slice(offset, offset + 100).map((selectedMember, index) => {
          const material = snapshot.materials[offset + index]; const probe = orderedProbes[offset + index];
          const value = { selectionOrdinal: selectedMember.ordinal, materialKey: selectedMember.materialKey, bindingRevision: selectedMember.bindingRevision,
            admittedControlRevision: Number(material.member.admitted_control_revision), admittedControlProjectionDigest: material.member.admitted_control_projection_digest,
            readHandle: material.readHandle, mediaProbe: probe };
          return Object.freeze({ ...value, memberDigest: canonicalDigest(value) });
        });
        const batch = { procurementRunId: selection.procurementRunId, runBasisDigest: snapshot.run.run_basis_digest, selectionDigest: selection.selectionDigest,
          batchOrdinal, members: Object.freeze(members) };
        probeBatches.push(Object.freeze({ ...batch, batchDigest: canonicalDigest(batch) }));
      }
      const basis = { schema: 'procurement.triage-structure-input@1', selectionDigest: selection.selectionDigest,
        probeBatchDigests: probeBatches.map((item) => item.batchDigest), playabilityPayloadDigests: plays.map((item) => item.payloadDigest),
        contextDigest: materialFieldContext.contextDigest, observationScopeProjectionDigest: observationScopeProjection.scopeDigest, pageRequest };
      return Object.freeze({ selectedFieldMaterialSet: selection, probeBatches: Object.freeze(probeBatches), playabilityPages: Object.freeze(plays),
        materialFieldContext, observationScopeProjection, pageRequest, inputDigest: canonicalDigest(basis) });
    },
  });
}

module.exports = Object.freeze({ PROBE_BATCH_PROJECTION, STRUCTURE_INPUT_PROJECTION, createEvidenceAssessmentPlanner, createProbeBatchProjection, createStructureInputProjection, selectedFieldMaterialSet:selected });
