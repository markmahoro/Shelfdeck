'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { executionCatalogDigest, validateBindingSets, assertDag } = require('./workflow-plan');
const { schemaClosure } = require('./catalog-schema-closure');
const { PLAN_RESOLUTIONS } = require('./runtime-contracts');

const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const TERMINAL_EVENT = new Set([...TERMINAL, 'skipped']);
const EVENT_STATES = new Set([...TERMINAL_EVENT, 'pending', 'ready', 'executing', 'waiting_for_external', 'waiting_for_resource']);
const BINDING_SET = 'helix://foundation/types/EventInputBindingSet/v1';

function requireProof(value, reason) { if (!value) throw new Error(reason); }
function unique(rows, key) {
  const map = new Map(rows.map(row => [row[key], row]));
  requireProof(map.size === rows.length && !map.has(null) && !map.has(undefined), 'Duplicate or absent ' + key);
  return map;
}
function payload(json, digest) {
  requireProof(typeof json === 'string' && HASH.test(digest), 'Absent payload or digest.');
  const value = JSON.parse(json);
  requireProof(canonicalDigest(value) === digest, 'Noncanonical payload digest.');
  return value;
}

function createBoundedCatalogTransition({ witness, registry, policyRegistry, schemas, contractValidator,
  bindingProjectionRegistry, proofReader, terminalEffectObserver, onRejected, terminalOnly = false }) {
  const records = new Map(witness.capabilities.map(record => [record.capabilityRef, record]));
  const affected = new Set(witness.capabilities.filter(record =>
    record.previousContractDigest !== record.currentContractDigest ||
    record.previousSchemaDigest !== record.currentSchemaDigest).map(record => record.capabilityRef));
  function schemaAlias(expected, actual) {
    const seen = new Set();
    while (expected && !seen.has(expected)) {
      if (expected === actual) return true;
      seen.add(expected);
      expected = schemas.get(expected)?.$ref;
    }
    return false;
  }
  let witnessValid = false;
  try {
    requireProof(records.size === witness.capabilities.length && records.size === registry.snapshot.length, 'Catalog set mismatch.');
    requireProof(policyRegistry.digest === witness.policyDigest &&
      executionCatalogDigest(registry, policyRegistry) === witness.currentCatalogDigest, 'Current Catalog mismatch.');
    const previous = [];
    for (const entry of registry.snapshot) {
      const record = records.get(entry.capabilityRef);
      requireProof(record && ['contractVersion', 'ownerScope', 'effectClass', 'executorVersion'].every(key =>
        record[key] === entry[key]) && record.currentContractDigest === entry.executionContractDigest, 'Semantic snapshot mismatch.');
      const owner = entry.ownerScope === 'execution-foundation' ? 'libra' : entry.ownerScope;
      const manifest = registry.resolve(entry.capabilityRef, owner).manifest;
      requireProof(canonicalDigest(schemaClosure(manifest, schemas)) === record.currentSchemaDigest, 'Schema closure changed.');
      if (record.previousManifest) requireProof(canonicalDigest(record.previousManifest) === record.previousContractDigest,
        'Historical manifest witness mismatch.');
      else requireProof(record.previousContractDigest === record.currentContractDigest, 'Missing previous semantic witness.');
      previous.push({ capabilityRef: record.capabilityRef, contractVersion: record.contractVersion,
        ownerScope: record.ownerScope, effectClass: record.effectClass, executorVersion: record.executorVersion,
        contractDigest: record.previousContractDigest });
    }
    requireProof(executionCatalogDigest({ snapshot: previous }, policyRegistry) === witness.previousCatalogDigest,
      'Previous Catalog reconstruction mismatch.');
    for (const [schemaRef, evidence] of Object.entries(witness.preboundEvidenceSchemas || {})) {
      requireProof(Array.isArray(evidence.capabilityRefs) && evidence.capabilityRefs.length > 0 &&
        evidence.capabilityRefs.every(ref => records.has(ref)), 'Unproven Evidence producer set.');
      requireProof(canonicalDigest(schemaClosure({ inputPorts: { evidence: { schemaRef } } }, schemas)) === evidence.currentSchemaDigest,
        'Prebound Evidence schema closure changed.');
      if (evidence.historicalNominalContract) requireProof(evidence.previousSchemaDigest === null, 'Invented previous schema bytes.');
      if (evidence.previousSchemaDigest === null) {
        const source = evidence.historicalNominalContract;
        requireProof(source?.kind === 'ssot_only' && /^[a-f0-9]{40}$/.test(source.sourceCommit) && source.sourceCommit === witness.sourceCommit &&
          typeof source.sourcePath === 'string' && Number.isSafeInteger(source.lineNumber) && source.lineNumber > 0 &&
          typeof source.text === 'string' && canonicalDigest(source.text) === source.textDigest,
        'Missing historical nominal contract provenance.');
      } else requireProof(HASH.test(evidence.previousSchemaDigest), 'Invalid historical schema witness.');
    }
    witnessValid = true;
  } catch (error) { onRejected?.(error.message); }

  function prove(reader, planId, requireUnaffected, visiting, proven, resolution) {
    const key = planId + ':' + requireUnaffected;
    if (proven.has(key)) return proven.get(key);
    requireProof(!visiting.has(planId), 'Cyclic cross-Work Result dependency.');
    visiting.add(planId);
    const facts = reader.read(planId);
    requireProof(facts, 'Missing referenced Plan.');
    const { plan, workAttempt, work, nodes, events, edges, attempts, effects, results, markers } = facts;
    requireProof(plan.plan_id === planId && PLAN_RESOLUTIONS.includes(plan.state) && workAttempt && work &&
      plan.attempt_id === workAttempt.attempt_id && workAttempt.work_id === work.work_id &&
      HASH.test(plan.graph_digest) && HASH.test(plan.basis_digest) && plan.basis_digest === workAttempt.basis_digest,
    'Plan/Work/Attempt envelope mismatch.');
    const previous = plan.catalog_digest === witness.previousCatalogDigest;
    requireProof(previous || plan.catalog_digest === witness.currentCatalogDigest, 'Unknown referenced Catalog.');
    const terminal = TERMINAL.has(workAttempt.state);
    requireProof(!terminalOnly || terminal, 'Historical contract cannot authorize an active Attempt.');
    requireProof(terminal || ['ready', 'running', 'blocked'].includes(workAttempt.state), 'Unknown Work Attempt state.');
    const unaffected = requireUnaffected || !terminal;
    if (!terminal) requireProof(!witness.excludedActiveProcessTypes.includes(work.process_type), 'Excluded active process.');
    requireProof(nodes.length === events.length, 'Incomplete Plan graph.');
    if (nodes.length === 0) {
      requireProof(terminal && plan.state !== 'planned' &&
        edges.length === 0 && attempts.length === 0 && effects.length === 0 && results.length === 0 && markers.length === 0,
      'Unproven empty Plan.');
      visiting.delete(planId); proven.set(key, facts); return facts;
    }
    requireProof(plan.state === 'planned', 'Non-executable Plan has nodes.');
    const byNode = unique(nodes, 'node_id'), byEvent = unique(events, 'event_id');
    const eventsByNode = unique(events, 'node_id');
    const byAttempt = unique(attempts, 'event_attempt_id'), byResult = unique(results, 'event_id');
    unique(results, 'result_id'); unique(effects, 'effect_id');
    unique(markers, 'commit_marker');
    for (const marker of markers) requireProof(typeof marker.commit_marker === 'string' && marker.commit_marker.length > 0 &&
      HASH.test(marker.commit_digest) && (marker.result_id === null || results.some(result => result.result_id === marker.result_id)),
    'Unresolved Commit Marker reference.');
    const manifestFor = capabilityRef => {
      const current = registry.resolve(capabilityRef, work.owner_domain).manifest;
      const record = records.get(capabilityRef);
      requireProof(record, 'Unknown capability.');
      return previous && record.previousManifest ? record.previousManifest : current;
    };
    const normalized = nodes.map(node => {
      const event = eventsByNode.get(node.node_id), manifest = manifestFor(node.capability_ref);
      requireProof(node.plan_id === planId && event && event.plan_id === planId &&
        event.work_id === work.work_id && event.attempt_id === workAttempt.attempt_id &&
        event.owner_domain === work.owner_domain && event.capability_ref === node.capability_ref &&
        event.contract_version === node.contract_version && node.contract_version === manifest.contractVersion &&
        node.effect_class === manifest.effectClass && EVENT_STATES.has(event.state), 'Node/Event contract or scope mismatch.');
      requireProof(!terminal || TERMINAL_EVENT.has(event.state), 'Terminal Attempt has active Event.');
      requireProof(!unaffected || !affected.has(node.capability_ref), 'Changed executable dependency.');
      policyRegistry.bindingFor(node.capability_ref, node.effect_class);
      requireProof(node.input_binding_schema_ref === manifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs') &&
        node.parameter_schema_ref === manifest.parametersSchemaRef && node.fence_schema_ref === manifest.fenceSchemaRef &&
        node.resource_demand_schema_ref === manifest.resourceDemandSchemaRef, 'Stored schema binding mismatch.');
      const inputBindings = JSON.parse(node.input_bindings_json);
      requireProof(inputBindings.schemaRef === BINDING_SET && inputBindings.schemaVersion === 1, 'Unproven inline input.');
      for (const [ref, json] of [[node.parameter_schema_ref, node.parameters_json],
        [node.fence_schema_ref, node.fence_basis_json], [node.resource_demand_schema_ref, node.resource_demand_json]]) {
        contractValidator.validate(ref, JSON.parse(json));
      }
      requireProof((node.when_schema_ref === null) === (node.when_json === null), 'Incomplete conditional binding.');
      if (node.when_schema_ref !== null) contractValidator.validate(node.when_schema_ref, JSON.parse(node.when_json));
      return { nodeId: node.node_id, eventId: event.event_id, capabilityRef: node.capability_ref, inputBindings,
        dependsOn: edges.filter(edge => edge.to_node_id === node.node_id).map(edge => ({
          eventId: eventsByNode.get(edge.from_node_id)?.event_id, satisfaction: edge.dependency_kind,
        })) };
    });
    for (const edge of edges) requireProof(edge.plan_id === planId && byNode.has(edge.from_node_id) &&
      byNode.has(edge.to_node_id) && ['success', 'terminal'].includes(edge.dependency_kind), 'Foreign or invalid edge.');
    assertDag(normalized);
    validateBindingSets(normalized, { resolve: ref => ({ manifest: manifestFor(ref) }) }, contractValidator, work.owner_domain);
    for (const attempt of attempts) {
      requireProof(byEvent.has(attempt.event_id) && ['completed', 'executing'].includes(attempt.state) &&
        Number.isSafeInteger(attempt.ordinal) && attempt.ordinal >= 1 &&
        (!terminal || attempt.state === 'completed'), 'Invalid Event Attempt.');
      requireProof(attempt.evidence_digest === null || HASH.test(attempt.evidence_digest), 'Invalid Attempt Evidence digest.');
      requireProof(effects.filter(effect => effect.event_attempt_id === attempt.event_attempt_id).length <= 1,
        'Multiple Effects on one Event Attempt.');
    }
    for (const effect of effects) {
      const attempt = byAttempt.get(effect.event_attempt_id);
      const event = attempt && byEvent.get(attempt.event_id);
      requireProof(event && effect.effect_class === byNode.get(event.node_id).effect_class &&
        effect.effect_class !== 'pure_observation' && ['intended', 'effect_observed', 'reconcile_required', 'committed', 'failed'].includes(effect.state),
      'Effect ownership mismatch.');
      if (terminal && !['committed', 'failed'].includes(effect.state)) {
        const receipt = resolution.proofs.get(effect.effect_id);
        if (!receipt) {
          resolution.pending = facts;
          throw new Error('Unresolved terminal Effect.');
        }
        if (receipt.schemaRef === 'arca.terminal-stage-history-proof@1') {
          const keys = ['schemaRef','ownerDomain','disposition','effectId','eventId','inputDigest','slotEventId','slotResultId','slotResultDigest','observationDigest'];
          requireProof(!unaffected && work.owner_domain === 'arca' && receipt.ownerDomain === work.owner_domain &&
            receipt.disposition === 'no_remaining_material_effect' && effect.effect_class === 'material_commit' &&
            Object.keys(receipt).length === keys.length && keys.every(name=>Object.hasOwn(receipt,name)) &&
            receipt.effectId === effect.effect_id && receipt.eventId === event.event_id &&
            HASH.test(receipt.inputDigest) && HASH.test(receipt.observationDigest) && HASH.test(attempt.fence_snapshot_digest) && receipt.inputDigest === attempt.input_snapshot_digest &&
            effect.intent_digest === canonicalDigest({eventId:event.event_id,capabilityRef:event.capability_ref,contractVersion:event.contract_version,
              inputSnapshotDigest:receipt.inputDigest,fenceSnapshotDigest:attempt.fence_snapshot_digest}) &&
            events.some(source=>source.event_id===receipt.slotEventId && source.state==='succeeded') &&
            results.some(source=>source.event_id===receipt.slotEventId && source.result_id===receipt.slotResultId && source.result_digest===receipt.slotResultDigest),
          'Unproven empty stage responsibility.');
          continue;
        }
        const receiptKeys = ['schemaRef', 'ownerDomain', 'disposition', 'historicalAuthorization', 'effectId', 'eventId', 'inputDigest',
          'sourcePlanId', 'sourceEventId', 'sourceInputDigest', 'sourceResultId', 'sourceResultDigest', 'sourceCommitResultId', 'sourceCommitResultDigest'];
        requireProof(Object.keys(receipt).length === receiptKeys.length && receiptKeys.every(name => Object.hasOwn(receipt, name)),
          'Unknown Effect history proof field.');
        requireProof(!unaffected && work.owner_domain === 'arca' && receipt.schemaRef === 'arca.terminal-effect-history-proof@1' &&
          receipt.ownerDomain === work.owner_domain && receipt.disposition === 'fulfilled_by_successor' &&
          receipt.historicalAuthorization === 'unproven_system_policy' && receipt.eventId === event.event_id &&
          receipt.effectId === effect.effect_id && HASH.test(receipt.inputDigest) &&
          receipt.inputDigest === attempt.input_snapshot_digest && HASH.test(attempt.fence_snapshot_digest) &&
          effect.intent_digest === canonicalDigest({ eventId:event.event_id, capabilityRef:event.capability_ref,
            contractVersion:event.contract_version, inputSnapshotDigest:receipt.inputDigest, fenceSnapshotDigest:attempt.fence_snapshot_digest }),
        'Unproven original Effect input or intent.');
        const source = prove(reader, receipt.sourcePlanId, false, visiting, proven, resolution);
        const sourceEvent = source.events.find(item => item.event_id === receipt.sourceEventId);
        const sourceAttempts = source.attempts.filter(item => item.event_id === receipt.sourceEventId && item.outcome_kind === 'succeeded');
        const sourceEffect = sourceAttempts.length === 1 && source.effects.find(item => item.event_attempt_id === sourceAttempts[0].event_attempt_id);
        requireProof(source.work.owner_domain === work.owner_domain && source.work.process_type === work.process_type &&
          source.work.process_id === work.process_id && source.work.work_id !== work.work_id &&
          source.work.state === 'succeeded' && source.workAttempt.state === 'succeeded' && sourceEvent?.state === 'succeeded' &&
          sourceEvent.capability_ref === event.capability_ref && sourceEffect?.state === 'committed' &&
          Number.isSafeInteger(attempt.started_at_ms) && Number.isSafeInteger(sourceAttempts[0].started_at_ms) &&
          sourceAttempts[0].started_at_ms > attempt.started_at_ms &&
          sourceAttempts[0].input_snapshot_digest === receipt.sourceInputDigest && HASH.test(receipt.sourceInputDigest) &&
          sourceEffect.intent_digest === canonicalDigest({ eventId:sourceEvent.event_id, capabilityRef:sourceEvent.capability_ref,
            contractVersion:sourceEvent.contract_version, inputSnapshotDigest:receipt.sourceInputDigest,
            fenceSnapshotDigest:sourceAttempts[0].fence_snapshot_digest }) &&
          source.results.some(item => item.event_id === sourceEvent.event_id && item.result_id === receipt.sourceResultId && item.result_digest === receipt.sourceResultDigest) &&
          source.results.some(item => item.result_id === receipt.sourceCommitResultId && item.result_digest === receipt.sourceCommitResultDigest),
        'Unproven successor Effect commit chain.');
      }
    }
    for (const event of events) {
      const eventAttempts = attempts.filter(attempt => attempt.event_id === event.event_id);
      unique(eventAttempts, 'ordinal');
      const executing = eventAttempts.filter(attempt => attempt.state === 'executing');
      requireProof(executing.length === (event.state === 'executing' ? 1 : 0), 'Attempt execution cardinality mismatch.');
      const result = byResult.get(event.event_id);
      requireProof(event.state !== 'succeeded' || result, 'Succeeded Event has no Result.');
      requireProof(!event.result_id || result?.result_id === event.result_id, 'Event Result reference mismatch.');
      if (!result) continue;
      requireProof(result.result_id && result.outcome_kind === 'succeeded' &&
        (event.state === 'succeeded' || (!terminal && event.state === 'executing')), 'Unexpected Result state.');
      let successfulAttempt = null;
      if (event.state === 'succeeded') {
        const successes = eventAttempts.filter(attempt => attempt.state === 'completed' && attempt.outcome_kind === 'succeeded');
        requireProof(event.result_id === result.result_id && successes.length === 1 && HASH.test(successes[0].evidence_digest),
          'Successful Attempt/Result mismatch.');
        successfulAttempt = successes[0];
      }
      const manifest = manifestFor(event.capability_ref);
      requireProof(schemaAlias(manifest.resultSchemaRef, result.result_schema_ref), 'Result contract binding mismatch.');
      const resultValue = payload(result.result_json, result.result_digest);
      const evidenceValue = payload(result.evidence_json, result.evidence_digest);
      if (resultValue?.schemaRef) requireProof(schemaAlias(manifest.resultSchemaRef, resultValue.schemaRef), 'Result payload nominal identity mismatch.');
      const directEvidence = schemaAlias(manifest.evidenceSchemaRef, result.evidence_schema_ref) &&
        (!successfulAttempt || successfulAttempt.evidence_digest === result.evidence_digest);
      if (!directEvidence) {
        const frozen = witness.preboundEvidenceSchemas?.[result.evidence_schema_ref];
        requireProof(frozen && frozen.capabilityRefs.includes(event.capability_ref) && evidenceValue?.schemaRef === result.evidence_schema_ref &&
          schemaAlias(manifest.evidenceSchemaRef, 'helix://contracts/types/EvidenceEnvelope/v1') &&
          ['domain_fact_commit', 'responsibility_control_commit'].includes(manifest.effectClass), 'Unproven prebound Evidence contract.');
        requireProof(!unaffected || frozen.previousSchemaDigest === frozen.currentSchemaDigest, 'Changed prebound Evidence dependency.');
        requireProof(markers.filter(marker => marker.result_id === result.result_id).length === 1,
          'Prebound Evidence requires an exact Result Commit Marker.');
        // EventRuntime persists the inner domain Evidence and only the digest of
        // its outer envelope. The two digests are intentionally distinct. Prove
        // the canonical commit chain; never reconstruct a business envelope here.
      }
      if (manifest.effectClass !== 'pure_observation') {
        const committed = effects.filter(effect => effect.state === 'committed' &&
          byAttempt.get(effect.event_attempt_id)?.event_id === event.event_id);
        requireProof(typeof result.effect_receipt_id === 'string' && result.effect_receipt_id.length > 0 &&
          committed.length === 1 && committed[0].output_digest === result.result_digest, 'Result has no exact committed Effect.');
      } else requireProof(result.effect_receipt_id === null, 'Pure Result has an Effect Receipt.');
      // Changed terminal payloads are historical evidence, never executable input.
      if (unaffected || (terminalOnly && !previous)) {
        contractValidator.validate(result.result_schema_ref, resultValue);
        contractValidator.validate(result.evidence_schema_ref, evidenceValue);
      }
      for (const marker of markers.filter(item => item.result_id === result.result_id)) {
        requireProof(marker.owner_domain === work.owner_domain && marker.result_schema_ref === result.result_schema_ref &&
          marker.result_digest === result.result_digest && effects.some(effect => effect.effect_id === marker.effect_id &&
            byAttempt.get(effect.event_attempt_id)?.event_id === event.event_id), 'Commit marker Result scope mismatch.');
      }
      for (const marker of markers.filter(item => item.result_id === null)) requireProof(
        marker.result_schema_ref === null && marker.result_digest === null && marker.owner_domain === work.owner_domain &&
        effects.some(effect => effect.effect_id === marker.effect_id && effect.state === 'committed'), 'Invalid Effect-only Commit Marker.');
    }
    for (const node of normalized) {
      const event = byEvent.get(node.eventId);
      const consumes = event.state === 'succeeded' || event.state === 'executing';
      for (const binding of node.inputBindings.bindings) {
        if (binding.projectionRef) bindingProjectionRegistry.resolve(binding.projectionRef);
        const refs = binding.eventResults || (binding.eventId ? [{ eventId: binding.eventId, resultSchemaRef: binding.resultSchemaRef }] : []);
        for (const ref of refs) {
          const source = byEvent.get(ref.eventId), result = byResult.get(ref.eventId);
          requireProof(source && (!consumes || (source.state === 'succeeded' && result)), 'Unresolved consumed Event Result.');
          if (result) requireProof(schemaAlias(ref.resultSchemaRef, result.result_schema_ref), 'Referenced Result contract mismatch.');
        }
        if (binding.bindingKind !== 'projected_work_results') continue;
        if (binding.sourceWorkId === work.work_id) {
          const predecessorIds = new Set(node.dependsOn.filter(dependency => dependency.satisfaction === 'success').map(dependency => dependency.eventId));
          for (const sourceId of predecessorIds) {
            const source = byEvent.get(sourceId), result = byResult.get(sourceId);
            requireProof(source && binding.resultSchemaRefs.some(ref => schemaAlias(ref, manifestFor(source.capability_ref).resultSchemaRef)),
              'Work Result projection predecessor contract mismatch.');
            requireProof(!consumes || (source.state === 'succeeded' && result), 'Missing consumed Work predecessor Result.');
          }
          if (predecessorIds.size === 0) {
            requireProof(Number.isSafeInteger(workAttempt.ordinal) && workAttempt.ordinal > 1, 'Work Result projection lacks explicit predecessors.');
            const earlier = reader.workPlanIds(work.work_id).filter(id => id !== planId).filter(id => {
              const source = reader.read(id);
              requireProof(source?.workAttempt?.work_id === work.work_id, 'Foreign prior Attempt.');
              return Number.isSafeInteger(source.workAttempt.ordinal) && source.workAttempt.ordinal < workAttempt.ordinal;
            }).map(id => prove(reader, id, unaffected, visiting, proven, resolution));
            requireProof(earlier.length > 0 && earlier.every(source => TERMINAL.has(source.workAttempt.state)) &&
              earlier.some(source => source.results.some(result => binding.resultSchemaRefs.some(ref => schemaAlias(ref, result.result_schema_ref)))),
            'Missing typed earlier Attempt Result.');
          }
          continue;
        }
        const planIds = reader.workPlanIds(binding.sourceWorkId);
        requireProof(planIds.length > 0, 'Missing source Work graph.');
        const sources = planIds.map(id => prove(reader, id, unaffected, visiting, proven, resolution));
        requireProof(sources.every(source => source.work.work_id === binding.sourceWorkId &&
          source.work.owner_domain === work.owner_domain), 'Foreign source Work.');
        for (const ref of binding.resultSchemaRefs) requireProof(sources.some(source => source.results.some(result =>
          schemaAlias(ref, result.result_schema_ref) && source.events.some(item => item.event_id === result.event_id && item.state === 'succeeded'))),
        'Missing typed source Work Result.');
      }
    }
    visiting.delete(planId);
    proven.set(key, facts);
    return facts;
  }

  return Object.freeze({
    previousCatalogDigest: witness.previousCatalogDigest,
    verify(snapshot) {
      if (!witnessValid || (snapshot?.plan?.catalog_digest !== witness.previousCatalogDigest &&
          !(terminalOnly && snapshot?.plan?.catalog_digest === witness.currentCatalogDigest))) return false;
      const resolution = { proofs:new Map(), pending:null };
      const verify = () => proofReader.verify(reader => {
        const facts = prove(reader, snapshot.plan.plan_id, false, new Set(), new Map(), resolution);
        requireProof(facts.work.work_id === snapshot.work?.work_id &&
          facts.workAttempt.attempt_id === snapshot.workAttempt?.attempt_id, 'Startup snapshot changed.');
        return true;
      });
      try {
        try { return verify(); }
        catch (error) {
          if (!resolution.pending || !terminalEffectObserver) throw error;
          // Owner reads use separate public transactions. Revalidate the complete
          // technical graphs afterwards; never nest Owner transactions here.
          const observations = terminalEffectObserver.observe(resolution.pending);
          resolution.proofs = unique(observations, 'effectId');
          resolution.pending = null;
          return verify();
        }
      } catch (error) { onRejected?.(error.message); return false; }
    },
  });
}

module.exports = Object.freeze({ createBoundedCatalogTransition });
