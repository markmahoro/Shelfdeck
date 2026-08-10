'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { activeTriageRule } = require('../model/procurement-run-contracts');
const { normalized: normalizeScopeLocation, parentRelativeLocation, resolveBdmvContainerScope } = require('../model/bdmv-scope');

const PROBE = 'shared.material.media.probe@1';
const BDMV_ASSESS = 'procurement.triage.bdmv.assess@1';
const PLAY = 'procurement.triage.playability.inspect@1';
const STRUCTURE = 'procurement.triage.structure.inspect@1';
const PROBE_BATCH_PROJECTION = 'helix://procurement/input-projections/TriageMaterialProbeBatch/v1';
const BDMV_ASSESS_INPUT_PROJECTION = 'helix://procurement/input-projections/BdmvAssessmentInput/v1';
const STRUCTURE_INPUT_PROJECTION = 'helix://procurement/input-projections/TriageStructureInspectionInput/v1';

function stableId(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function literal(portName, value) { return Object.freeze({ portName, bindingKind: 'literal', value }); }
function workResults(portName, sourceWorkId, resultSchemaRefs, projectionRef, parameters) { return Object.freeze({ portName, bindingKind:'projected_work_results', sourceWorkId, resultSchemaRefs:Object.freeze(resultSchemaRefs), projectionRef, parameters:Object.freeze(parameters) }); }
function ownerFacts(portName, ownerDomain, processType, processId, projectionRef, parameters) { return Object.freeze({ portName, bindingKind:'projected_owner_facts', ownerDomain, processType, processId, projectionRef, parameters:Object.freeze(parameters) }); }
function bindingSet(bindings) { return Object.freeze({ schemaRef:'helix://foundation/types/EventInputBindingSet/v1', schemaVersion:1, bindings:Object.freeze(bindings) }); }
function demand(resourceKinds) { const value = { resourceKinds:Object.freeze(resourceKinds) }; return Object.freeze({ ...value, demandDigest:canonicalDigest(value) }); }
function resultRef(options, capabilityRef) {
  const resolved = options.registry.resolve(capabilityRef, 'procurement');
  return resolved?.manifest?.resultSchemaRef || null;
}
function memberContext(snapshot, material, ordinal) {
  const location = material.member.field_relative_location;
  if (typeof location !== 'string' || !location) throw new Error('Run material has no frozen Field-relative location.');
  const baseName = path.posix.basename(location);
  return Object.freeze({ selectionOrdinal:ordinal, materialKey:material.member.material_key, fieldRelativeLocation:location,
    baseName, extension:path.posix.extname(baseName).toLowerCase() || '.unknown',
    parentSegments:path.posix.dirname(location).split('/').filter(Boolean),
    selectionScopeKind:material.member.selection_scope_kind, selectionScopeKey:material.member.selection_scope_key,
    selectionScopeRootRelativeLocation:material.member.selection_scope_root_relative_location,
    scopeOrdinal:Number(material.member.selection_scope_ordinal), scopeMemberOrdinal:Number(material.member.scope_member_ordinal) });
}
function controlSnapshotFromMember(member) {
  const value = { materialKey:member.material_key, resultKind:'available', controlRevision:Number(member.expected_control_revision),
    controlState:member.expected_control_state, regionProjection:member.expected_control_region_projection,
    evidenceDigest:member.expected_control_evidence_digest, projectionDigest:member.expected_control_projection_digest };
  if (member.expected_control_state === 'controlled') Object.assign(value, { ownerDomain:member.expected_control_owner_domain,
    ownerScopeType:member.expected_control_owner_scope_type, ownerScopeId:member.expected_control_owner_scope_id });
  return Object.freeze(value);
}
function selected(snapshot) {
  const members = snapshot.materials.map(({ member, identity }, ordinal) => Object.freeze({ ordinal, materialKey:member.material_key, selectionRole:member.selection_role,
    fieldRelativeLocation:member.field_relative_location, scopeOrdinal:Number(member.selection_scope_ordinal),
    scopeMemberOrdinal:Number(member.scope_member_ordinal), physicalIdentity:identity,
    sizeBytes:Number(member.size_bytes), bindingRevision:Number(member.binding_revision), eligibilityRevision:Number(member.eligibility_revision), eligibilityBasisDigest:member.eligibility_basis_digest,
    lastSnapshotDigest:member.last_snapshot_digest, lastObservationId:member.last_observation_id, endpointId:member.endpoint_id, location:member.location,
    realityDigest:member.reality_digest, provenanceDigest:member.provenance_digest, controlSnapshot:controlSnapshotFromMember(member),
    admissionControlAction:member.admission_control_action, basisMemberDigest:member.basis_member_digest }));
  const value = { procurementRunId:snapshot.run.procurement_run_id, fieldId:snapshot.run.field_id,
    physicalMemberCount:Number(snapshot.run.selected_material_count), selectionScopeCount:Number(snapshot.run.selection_scope_count),
    selectionScopes:snapshot.selectionScopes, scopeSetDigest:snapshot.run.selection_scope_set_digest, members:Object.freeze(members) };
  return Object.freeze({ ...value, selectionDigest:canonicalDigest({ schema:'procurement.selected-field-material-set@2', ...value }) });
}

function logicalItems(snapshot) {
  const contexts = snapshot.materials.map((material, ordinal) => memberContext(snapshot, material, ordinal));
  const groups = new Map();
  for (const context of contexts) {
    const bdmv = context.selectionScopeKind === 'bdmv_container';
    const key = bdmv ? context.selectionScopeKey : 'material:' + context.materialKey;
    if (!groups.has(key)) groups.set(key, { kind:bdmv ? 'bdmv_container' : 'material', groupKey:key,
      selectionScopeKind:context.selectionScopeKind, selectionScopeKey:context.selectionScopeKey,
      selectionScopeRootRelativeLocation:context.selectionScopeRootRelativeLocation, scopeOrdinal:context.scopeOrdinal, members:[] });
    groups.get(key).members.push(context);
  }
  return [...groups.values()].map((group) => Object.freeze({ ...group,
    members:Object.freeze([...group.members].sort((a,b) => a.selectionOrdinal - b.selectionOrdinal)),
    selectionOrdinal:group.members[0].selectionOrdinal,
  })).sort((a,b) => a.selectionOrdinal - b.selectionOrdinal || Buffer.compare(Buffer.from(a.groupKey), Buffer.from(b.groupKey)));
}

function bdmvScopeReference(snapshot, item) {
  if (item.selectionScopeKind !== 'bdmv_container') throw new Error('BDMV Scope Reference requires an admitted BDMV Selection Scope.');
  const members = item.members.map((context) => {
    const material = snapshot.materials[context.selectionOrdinal];
    return { materialKey:context.materialKey, relativeLocation:context.fieldRelativeLocation, sizeBytes:Number(material.member.size_bytes), readHandle:material.readHandle,
      identity:material.identity, bindingRevision:material.member.binding_revision, admittedControlRevision:Number(material.member.admitted_control_revision),
      admittedControlProjectionDigest:material.member.admitted_control_projection_digest };
  }).sort((a,b) => Buffer.compare(Buffer.from(a.relativeLocation), Buffer.from(b.relativeLocation)) || Buffer.compare(Buffer.from(a.materialKey), Buffer.from(b.materialKey)));
  const memberSetDigest = canonicalDigest({ schema:'procurement.bdmv-member-set@1', items:members.map(({ materialKey, relativeLocation, sizeBytes, identity }) => ({ materialKey, relativeLocation, sizeBytes, identity })) });
  const scopeDigest = canonicalDigest({ schema:'procurement.bdmv-scope@1', runId:snapshot.run.procurement_run_id, bdmvGroupKey:item.groupKey,
    accessRevision:Number(snapshot.run.access_revision), memberSetDigest });
  const selectedPayloadSetDigest = canonicalDigest({ schema:'procurement.bdmv-selected-payload-pending@1', scopeDigest });
  return Object.freeze({ scopeKind:'bdmv_container', procurementRunId:snapshot.run.procurement_run_id, bdmvGroupKey:item.groupKey,
    scopeDigest, memberSetDigest, memberCount:members.length, topologyDigest:canonicalDigest({ schema:'procurement.bdmv-topology-pending@1', scopeDigest }),
    selectedPayloadSetDigest,
    rootLocation:[snapshot.access.root_location, bdmvRootLocation(item.members[0].fieldRelativeLocation, item.members)].filter(Boolean).join('/'),
    members:Object.freeze(members) });
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
        const refs = [PROBE, BDMV_ASSESS, PLAY, STRUCTURE].map((ref) => resultRef(options, ref)).filter(Boolean);
        const structure = node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, STRUCTURE, 'structure-' + (previous.pageOrdinal + 1), eventId,
          [workResults('triageStructureInspectionInput', request.workId, refs, STRUCTURE_INPUT_PROJECTION, { runId:request.processId, pageOrdinal:previous.pageOrdinal + 1, cursorIn:previous.cursorOut, maxUnits:32 }), literal('procurementTriageRuleSnapshot', rule)], [], ['cpu']);
        return Object.freeze({ ...empty('planned', null), planId:stableId('evidence-plan-', { attempt:request.workAttemptId }), resolution:'planned', nodes:Object.freeze([structure]) });
      }
      const selection = selected(snapshot); const nodes = []; const logical = logicalItems(snapshot); const logicalRefs = [];
      for (const item of logical) {
        if (item.kind === 'material') {
          const material = snapshot.materials[item.selectionOrdinal];
          const eventId = stableId('triage-probe-event-', { attempt:request.workAttemptId, materialKey:item.members[0].materialKey });
          nodes.push(node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, PROBE, 'probe-' + item.selectionOrdinal, eventId,
            [literal('physicalMaterialReadHandleOrWorkspaceMaterialHandle', material.readHandle)], [], ['cpu','disk_io']));
          logicalRefs.push(Object.freeze({ kind:'material', selectionOrdinal:item.selectionOrdinal, eventId,
            resultSchemaRef:resultRef(options, PROBE) }));
        } else {
          const scope = bdmvScopeReference(snapshot, item);
          const eventId = stableId('triage-bdmv-assessment-event-', { attempt:request.workAttemptId, groupKey:item.groupKey });
          nodes.push(node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, BDMV_ASSESS, 'bdmv-assess-' + item.selectionOrdinal, eventId,
            [ownerFacts('bdmvAssessmentInput', 'procurement', 'procurement_run', request.processId, BDMV_ASSESS_INPUT_PROJECTION, {
              runId:request.processId, bdmvGroupKey:item.groupKey, scopeDigest:scope.scopeDigest, memberSetDigest:scope.memberSetDigest,
              accessRevision:Number(snapshot.run.access_revision), profileHint:snapshot.run.content_profile_hint,
            })], [], ['volume_read','cpu_heavy']));
          logicalRefs.push(Object.freeze({ kind:'bdmv_container', selectionOrdinal:item.selectionOrdinal, eventId,
            resultSchemaRef:resultRef(options, BDMV_ASSESS),
            groupKey:item.groupKey, scopeDigest:scope.scopeDigest }));
        }
      }
      const playRefs = [];
      for (let offset = 0, batchOrdinal = 0; offset < logicalRefs.length; offset += 100, batchOrdinal++) {
        const refs = logicalRefs.slice(offset, offset + 100); const eventId = stableId('triage-playability-event-', { attempt:request.workAttemptId, batchOrdinal });
        playRefs.push(Object.freeze({ eventId, resultSchemaRef:resultRef(options, PLAY) }));
        nodes.push(node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, PLAY, 'playability-' + batchOrdinal, eventId,
          [workResults('triageMaterialProbeBatch', request.workId,
            [resultRef(options, PROBE), resultRef(options, BDMV_ASSESS)].filter(Boolean),
            PROBE_BATCH_PROJECTION, { runId:request.processId, startOrdinal:offset, batchSize:refs.length, batchOrdinal, runBasisDigest:snapshot.run.run_basis_digest }),
          literal('procurementTriageRuleSnapshot', rule)], refs.map((ref) => ({ eventId:ref.eventId, satisfaction:'success' })), ['cpu']));
      }
      const structureEventId = stableId('triage-structure-event-', { attempt:request.workAttemptId, page:0 });
      const refs = [PROBE, BDMV_ASSESS, PLAY].map((ref) => resultRef(options, ref)).filter(Boolean);
      nodes.push(node({ registry:options.registry, policyRegistry:options.policyRegistry, request, snapshot }, STRUCTURE, 'structure-0', structureEventId,
        [workResults('triageStructureInspectionInput', request.workId, refs, STRUCTURE_INPUT_PROJECTION, { runId:request.processId, pageOrdinal:0, cursorIn:null, maxUnits:32 }), literal('procurementTriageRuleSnapshot', rule)],
        [...logicalRefs, ...playRefs].map((ref) => ({ eventId:ref.eventId, satisfaction:'success' })), ['cpu']));
      return Object.freeze({ ...empty('planned', null), planId:stableId('evidence-plan-', { attempt:request.workAttemptId }), resolution:'planned', nodes:Object.freeze(nodes) });
    } });
}

function createProbeBatchProjection(options) {
  return Object.freeze({ project({ sourceResults, parameters }) {
    const snapshot = options.triageReader.read(parameters.runId); const selection = selected(snapshot);
    const items = logicalItems(snapshot);
    const probeByHandle = new Map(sourceResults.map((source) => [source.result?.sourceHandleDigest, source.result]));
    const assessmentByScope = new Map(sourceResults.map((source) => [source.result?.scopeDigest, source.result]));
    const members = [];
    for (let index = 0; index < parameters.batchSize; index += 1) {
      const item = items[parameters.startOrdinal + index];
      if (!item) throw new Error('Probe Batch projection references a missing logical item.');
      if (item.kind === 'material') {
        const material = snapshot.materials[item.selectionOrdinal]; const probe = probeByHandle.get(canonicalDigest(material.readHandle));
        if (!probe) throw new Error('Probe Batch projection is missing a durable Media Probe Result.');
        const member = selection.members[item.selectionOrdinal];
        const value = { inputKind:'material', selectionOrdinal:item.selectionOrdinal, materialKey:member.materialKey,
          bindingRevision:member.bindingRevision, admittedControlRevision:Number(material.member.admitted_control_revision),
          admittedControlProjectionDigest:material.member.admitted_control_projection_digest, readHandle:material.readHandle, mediaProbe:probe };
        members.push(Object.freeze({ ...value, memberDigest:canonicalDigest(value) }));
      } else {
        const scope = bdmvScopeReference(snapshot, item); const assessment = assessmentByScope.get(scope.scopeDigest);
        if (!assessment) throw new Error('Probe Batch projection is missing a durable BDMV Assessment Result.');
        const first = selection.members[item.selectionOrdinal]; const value = { inputKind:'bdmv_container', selectionOrdinal:item.selectionOrdinal,
          materialKey:canonicalDigest({ schema:'procurement.bdmv-logical-material@1', bdmvGroupKey:item.groupKey }), bindingRevision:first.bindingRevision,
          admittedControlRevision:Number(snapshot.materials[item.selectionOrdinal].member.admitted_control_revision),
          admittedControlProjectionDigest:first.controlSnapshot.projectionDigest, bdmvGroupKey:item.groupKey, scopeDigest:scope.scopeDigest,
          memberSetDigest:scope.memberSetDigest, memberCount:scope.memberCount, bdmvAssessment:assessment };
        members.push(Object.freeze({ ...value, memberDigest:canonicalDigest(value) }));
      }
    }
    const value = { procurementRunId:selection.procurementRunId, runBasisDigest:parameters.runBasisDigest, selectionDigest:selection.selectionDigest,
      batchOrdinal:parameters.batchOrdinal, members:Object.freeze(members) };
    return Object.freeze({ ...value, batchDigest:canonicalDigest(value) });
  } });
}

function normalizedLocation(value) { return normalizeScopeLocation(value); }
function parentLocation(value) { return parentRelativeLocation(value); }
function bdmvRootLocation(value, knownLocations = []) {
  return resolveBdmvContainerScope(value, knownLocations)?.bdmvRootRelativeLocation || null;
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

function createBdmvAssessmentInputProjection(options) {
  return Object.freeze({ project({ parameters }) {
    const snapshot = options.triageReader.read(parameters.runId);
    const items = logicalItems(snapshot);
    const item = items.find((candidate) => candidate.kind === 'bdmv_container' && candidate.groupKey === parameters.bdmvGroupKey);
    if (!item) throw new Error('BDMV Assessment input projection cannot resolve its frozen container scope.');
    const scope = bdmvScopeReference(snapshot, item);
    if (scope.scopeDigest !== parameters.scopeDigest || scope.memberSetDigest !== parameters.memberSetDigest ||
        Number(snapshot.run.access_revision) !== Number(parameters.accessRevision)) {
      throw new Error('BDMV Assessment input scope digest or access revision is stale.');
    }
    const mountScopeId = scope.members[0]?.readHandle?.identity?.mountScopeId;
    if (!mountScopeId) throw new Error('BDMV Assessment input projection cannot resolve its mount scope.');
    const value = { runId:parameters.runId, bdmvGroupKey:item.groupKey, scopeDigest:scope.scopeDigest, memberSetDigest:scope.memberSetDigest,
      accessRevision:Number(parameters.accessRevision), mountScopeId, profileHint:parameters.profileHint,
      inputDigest:canonicalDigest({ schema:'procurement.bdmv-assessment-input@1', runId:parameters.runId, bdmvGroupKey:item.groupKey,
        scopeDigest:scope.scopeDigest, memberSetDigest:scope.memberSetDigest, accessRevision:Number(parameters.accessRevision), mountScopeId, profileHint:parameters.profileHint }) };
    Object.defineProperty(value, '__bdmvScope', { enumerable:false, configurable:false, writable:false,
      value:Object.freeze({ ...scope, run:Object.freeze(snapshot.run), access:Object.freeze(snapshot.access) }) });
    return Object.freeze(value);
  } });
}

function createStructureInputProjection(options) {
  return Object.freeze({
    project({ sourceResults, parameters }) {
      const snapshot = options.triageReader.read(parameters.runId);
      const selection = selected(snapshot);
      const contexts = snapshot.materials.map((material, ordinal) => memberContext(snapshot, material, ordinal));
      const probes = sourceResults.filter((source) => source.resultSchemaRef.includes('media.probe')).map((source) => source.result);
      const assessments = sourceResults.filter((source) => source.resultSchemaRef.includes('bdmv.assess')).map((source) => source.result);
      const plays = sourceResults.filter((source) => source.resultSchemaRef.includes('playability.inspect')).map((source) => source.result);
      const probeByHandle = new Map(probes.map((item) => [item.sourceHandleDigest, item]));
      const assessmentByScope = new Map(assessments.map((item) => [item.scopeDigest, item]));
      const logical = logicalItems(snapshot);
      const orderedProbes = snapshot.materials.map((material) => probeByHandle.get(canonicalDigest(material.readHandle)));

      // Structure consumes only the immutable Run Selection. Related candidates are
      // reconstructed later by Candidate Context from the frozen Observation facts;
      // carrying them here would duplicate the scope query, inflate this Event input,
      // and revive the obsolete 4096-entry BDMV/Layout bound.
      const projectionCandidates = snapshot.materials.map((material, ordinal) => {
        const context = contexts[ordinal];
        const item = {
          materialKey: material.member.material_key,
          relativeLocation: context.fieldRelativeLocation,
          location: material.readHandle.location,
          identity: material.identity,
          endpointId: material.readHandle.endpointId,
          sizeBytes: material.identity.sizeBytes,
          entryDigest: material.current.last_snapshot_digest || canonicalDigest({
            schema:'procurement.selected-observation-projection-entry@1',
            procurementRunId:parameters.runId,
            materialKey:material.member.material_key,
            fieldRelativeLocation:context.fieldRelativeLocation,
          }),
        };
        return observationProjectionEntry(item, context, ordinal);
      });
      const entries = projectionCandidates
        .sort((left, right) => normalizedLocation(left.currentLocation).localeCompare(normalizedLocation(right.currentLocation), 'en-US') ||
          Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)))
        .map((entry, ordinal) => Object.freeze({ ...entry, entryOrdinal: ordinal }));
      if (entries.length > 1024) throw new Error('Observation Scope Projection exceeds the 1024-member Run bound.');
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
      for (let offset = 0, batchOrdinal = 0; offset < logical.length; offset += 100, batchOrdinal++) {
        const members = logical.slice(offset, offset + 100).map((item) => {
          if (item.kind === 'material') {
            const material = snapshot.materials[item.selectionOrdinal]; const selectedMember = selection.members[item.selectionOrdinal];
            const probe = orderedProbes[item.selectionOrdinal];
            if (!probe) throw new Error('Structure input projection is missing a durable Media Probe Result.');
            const value = { inputKind:'material', selectionOrdinal:item.selectionOrdinal, materialKey:selectedMember.materialKey, bindingRevision:selectedMember.bindingRevision,
              admittedControlRevision:Number(material.member.admitted_control_revision), admittedControlProjectionDigest:material.member.admitted_control_projection_digest,
              readHandle:material.readHandle, mediaProbe:probe };
            return Object.freeze({ ...value, memberDigest:canonicalDigest(value) });
          }
          const scope = bdmvScopeReference(snapshot, item); const assessment = assessmentByScope.get(scope.scopeDigest);
          if (!assessment) throw new Error('Structure input projection is missing a durable BDMV Assessment Result.');
          const first = selection.members[item.selectionOrdinal]; const value = { inputKind:'bdmv_container', selectionOrdinal:item.selectionOrdinal,
            materialKey:canonicalDigest({ schema:'procurement.bdmv-logical-material@1', bdmvGroupKey:item.groupKey }), bindingRevision:first.bindingRevision,
            admittedControlRevision:Number(snapshot.materials[item.selectionOrdinal].member.admitted_control_revision),
            admittedControlProjectionDigest:first.controlSnapshot.projectionDigest, bdmvGroupKey:item.groupKey, scopeDigest:scope.scopeDigest,
            memberSetDigest:scope.memberSetDigest, memberCount:scope.memberCount, bdmvAssessment:assessment };
          return Object.freeze({ ...value, memberDigest:canonicalDigest(value) });
        });
        const batch = { procurementRunId: selection.procurementRunId, runBasisDigest: snapshot.run.run_basis_digest, selectionDigest: selection.selectionDigest,
          batchOrdinal, members: Object.freeze(members) };
        probeBatches.push(Object.freeze({ ...batch, batchDigest: canonicalDigest(batch) }));
      }
      const bdmvAssessments = logical.filter((item) => item.kind === 'bdmv_container').map((item) => {
        const scope = bdmvScopeReference(snapshot, item); const assessment = assessmentByScope.get(scope.scopeDigest);
        if (!assessment) throw new Error('Structure input projection is missing a durable BDMV Assessment Result.');
        return Object.freeze({ scope:Object.freeze({ scopeKind:'bdmv_container', procurementRunId:selection.procurementRunId,
          bdmvGroupKey:item.groupKey, scopeDigest:scope.scopeDigest, memberSetDigest:scope.memberSetDigest, memberCount:scope.memberCount,
          topologyDigest:assessment.topologyDigest, selectedPayloadSetDigest:assessment.selectedPayloadSetDigest }), assessment });
      });
      const basis = { schema: 'procurement.triage-structure-input@1', selectionDigest: selection.selectionDigest,
        probeBatchDigests: probeBatches.map((item) => item.batchDigest), bdmvAssessmentPayloadDigests: bdmvAssessments.map((item) => item.assessment.payloadDigest),
        playabilityPayloadDigests: plays.map((item) => item.payloadDigest),
        contextDigest: materialFieldContext.contextDigest, observationScopeProjectionDigest: observationScopeProjection.scopeDigest, pageRequest };
      return Object.freeze({ selectedFieldMaterialSet: selection, probeBatches: Object.freeze(probeBatches), bdmvAssessments:Object.freeze(bdmvAssessments), playabilityPages: Object.freeze(plays),
        materialFieldContext, observationScopeProjection, pageRequest, inputDigest: canonicalDigest(basis) });
    },
  });
}

module.exports = Object.freeze({ PROBE_BATCH_PROJECTION, BDMV_ASSESS_INPUT_PROJECTION, STRUCTURE_INPUT_PROJECTION,
  createEvidenceAssessmentPlanner, createProbeBatchProjection, createBdmvAssessmentInputProjection, createStructureInputProjection,
  selectedFieldMaterialSet:selected });
