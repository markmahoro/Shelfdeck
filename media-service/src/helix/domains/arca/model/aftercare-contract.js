'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');

const CAPABILITY_REFS = Object.freeze({
  custody:'arca.aftercare.custody.observe@1',
  presentation:'arca.aftercare.presentation.observe@1',
  conformance:'arca.aftercare.conformance.observe@1',
  assessmentCommit:'arca.aftercare.assessment.commit@1',
  textRender:'arca.aftercare.text_artifact.render@1',
  binaryAcquire:'arca.aftercare.binary_artifact.acquire@1',
  artifactMaterialize:'arca.aftercare.artifact.materialize@1',
  remux:'arca.aftercare.media.remux@1',
  transcode:'arca.aftercare.media.transcode@1',
  mediaVerify:'arca.aftercare.media.verify@1',
  settlement:'arca.aftercare.input_settlement.delete@1',
  inventoryCommit:'arca.aftercare.inventory.commit@1',
  caseCommit:'arca.aftercare.case.commit@1',
  workspaceReclaim:'arca.aftercare.workspace.reclaim@1',
});

const HEALTH_STATES = Object.freeze(['never_assessed','healthy','observing','repairing','attention_required']);
const CASE_STATES = Object.freeze(['active','resolved','invalidated','unresolved']);
const DISPOSITIONS = Object.freeze(['observe','auto_repair','attention_required']);
const ASSESSMENT_KINDS = Object.freeze(['custody','presentation','conformance']);
const PERIODS = Object.freeze({ custodyMs:24*60*60*1000, deepMs:7*24*60*60*1000, jitterMs:2*60*60*1000 });

function isAftercareArtifactMaterial(item, artifactKind) {
  const role=String(item?.role||'').toLowerCase(),location=String(item?.location||''),name=path.basename(location).toLowerCase();
  if(artifactKind==='nfo')return role.includes('nfo')||role==='metadata_sidecar'||path.extname(location).toLowerCase()==='.nfo';
  if(artifactKind==='poster')return role.includes('poster')||/(^|[-_. ])poster\.(jpg|jpeg|png|webp)$/.test(name);
  return false;
}

function physicalIdentityFromInventoryRow(row) {
  const tuple = {
    mountScopeId: row.mount_scope_id,
    inode: row.inode,
    sizeBytes: Number(row.size_bytes),
    fingerprintAlgorithm: row.fingerprint_algorithm,
    fingerprintVersion: Number(row.fingerprint_version),
    contentFingerprint: row.content_fingerprint,
  };
  const materialKey = canonicalDigest({
    schema: 'physical-material-identity@2',
    ...tuple,
  });
  if (materialKey !== row.material_key) {
    throw Object.assign(new Error('Arca Inventory Physical Material Identity is corrupt.'), {
      code: 'ARCA_INVENTORY_MATERIAL_IDENTITY_CORRUPT',
    });
  }
  return Object.freeze({
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
    schemaVersion: 2,
    materialKey,
    ...tuple,
  });
}

function deriveInventoryMaterialChanges(materials, receipts) {
  const canonicalLocation = (value) => String(value || '').replace(/\\/g, '/');
  const frozenMaterialKeys = new Set(materials.map((row) => row.material_key));
  const acquire = new Map();
  const release = new Map();
  for (const receipt of receipts) {
    acquire.set(receipt.finalMaterialIdentity.materialKey,
      receipt.finalMaterialIdentity);
    for (const retired of receipt.retiredMaterials || []) {
      release.set(retired.identity.materialKey, retired.identity);
    }
    if (receipt.supersededMaterialIdentity &&
        frozenMaterialKeys.has(receipt.supersededMaterialIdentity.materialKey)) {
      release.set(receipt.supersededMaterialIdentity.materialKey,
        receipt.supersededMaterialIdentity);
    }
    for (const row of materials) {
      if (canonicalLocation(row.location) !==
          canonicalLocation(receipt.targetLocation) ||
          row.material_key === receipt.finalMaterialIdentity.materialKey) {
        continue;
      }
      const identity = physicalIdentityFromInventoryRow(row);
      release.set(identity.materialKey, identity);
    }
  }
  for (const materialKey of acquire.keys()) {
    if (release.has(materialKey)) {
      throw Object.assign(new Error('Aftercare Inventory cannot acquire and release the same Material.'), {
        code: 'ARCA_AFTERCARE_CONTROL_SET_OVERLAP',
      });
    }
  }
  return Object.freeze([
    ...[...release.values()].map((identity) =>
      Object.freeze({ identity, action: 'release' })),
    ...[...acquire.values()].map((identity) =>
      Object.freeze({ identity, action: 'acquire' })),
  ].sort((left, right) => left.identity.materialKey.localeCompare(
    right.identity.materialKey)));
}

function settlementScopeDigest(handles) {
  return canonicalDigest((handles || []).map((handle) => {
    return Object.freeze({
    endpointId:handle.endpointId || null,
    location:String(handle.location || '').replace(/\\/g, '/'),
    identity:handle.identity,
    ownerDomain:handle.ownerDomain || null,
    ownerScope:handle.ownerScope || null,
    bindingRevision:Number(handle.bindingRevision),
    mountScopeRevision:Number(handle.mountScopeRevision),
    readScope:handle.readScope || null,
    fenceDigest:handle.fenceDigest || null,
  });
  }).sort((left, right) => (left.location + ':' + left.identity.materialKey)
    .localeCompare(right.location + ':' + right.identity.materialKey)));
}

function aftercareSettlementEventId(workAttemptId) {
  return 'care-settlement-' + canonicalDigest(workAttemptId).slice(0, 18);
}

function aftercareServiceCatalogRevision(registry) {
  const revision = registry?.resolve(CAPABILITY_REFS.settlement, 'arca')?.manifest?.contractVersion;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError('Aftercare Settlement requires the current Service Catalog revision.');
  }
  return revision;
}

function aftercareSettlementApprovalId(value) {
  return 'arca-care-settlement-approval-' + canonicalDigest({
    caseId:value.aftercareCaseId,
    scope:value.settlementScopeDigest,
    basis:value.careBasisDigest,
    eventId:value.settlementEventId,
  }).slice(0, 40);
}

function aftercareInventoryCommitId(value) {
  return 'arca-aftercare-inventory-' + canonicalDigest({
    caseId:value.aftercareCaseId,
    shelfEntryId:value.shelfEntryId,
    previous:Number(value.previousInventoryRevision),
    representationDigest:value.representationDigest,
  }).slice(0, 40);
}

function aftercareInventoryCommitDigest(value, resultDigest) {
  const previous = Number(value.previousInventoryRevision);
  return canonicalDigest({
    schema:'arca.aftercare-inventory-commit@1',
    commitId:aftercareInventoryCommitId(value),
    caseId:value.aftercareCaseId,
    shelfEntryId:value.shelfEntryId,
    previous,
    next:previous + 1,
    representationDigest:value.representationDigest,
    controlChangeDigest:value.controlChangeDigest,
    resultDigest,
  });
}

function buildAftercareSettlementHandles(input) {
  const handles = [];
  const context = input.context;
  const caseId = input.aftercareCaseId;
  const frozenMaterials = input.frozenMaterials || [];
  const add = (entry, values) => {
    const normalizedLocation = String(entry.location || '').replace(/\\/g, '/');
    if (handles.some((handle) => {
      return handle.identity.materialKey === entry.identity.materialKey &&
        String(handle.location).replace(/\\/g, '/') === normalizedLocation;
    })) return;
    const base = {
      schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', schemaVersion:1,
      handleId:'arca-care-settlement-' + canonicalDigest({ caseId, location:entry.location }).slice(0, 40),
      identity:entry.identity, ownerDomain:'arca',
      ownerScope:Object.freeze({ scopeType:'aftercare_case', scopeId:caseId }), bindingRevision:values.bindingRevision,
      endpointId:values.endpointId, location:normalizedLocation,
      mountScopeRevision:Number(context.raw.shelf.target_mount_scope_revision),
      expectedSizeBytes:entry.identity.sizeBytes, expectedMtimeNs:0, expectedCtimeNs:0,
      fingerprintVerifiedAtMs:values.fingerprintVerifiedAtMs, readScope:values.readScope,
      expiresAtMs:Number.MAX_SAFE_INTEGER,
    };
    const readHandle = Object.freeze({ ...base, fenceDigest:canonicalDigest(base) });
    handles.push(readHandle);
  };
  for (const receipt of input.receipts || []) {
    const retired = [
      ...(receipt.retiredMaterials || []).filter((entry) => entry.requiresSettlement),
      ...(receipt.supersededLocation && receipt.supersededMaterialIdentity ? [{
        identity:receipt.supersededMaterialIdentity, location:receipt.supersededLocation,
      }] : []),
    ];
    for (const entry of retired) add(entry, {
      bindingRevision:1,
      endpointId:frozenMaterials.find((row) => row.material_key === entry.identity.materialKey)?.endpoint_id ||
        context.raw.materials.find((row) => row.material_key === entry.identity.materialKey)?.endpoint_id ||
        receipt.targetEndpointId,
      fingerprintVerifiedAtMs:receipt.committedAtMs,
      readScope:'exact_aftercare_settlement',
    });
  }
  for (const observed of input.observedOldBindings || []) {
    let identity = observed.identity;
    let final = observed.final;
    if (observed.kind === 'absent') {
      identity = physicalIdentityFromInventoryRow(observed.binding);
      const matches = context.raw.materials.filter((item) =>
        Number(item.size_bytes) === identity.sizeBytes &&
        item.fingerprint_algorithm === identity.fingerprintAlgorithm &&
        Number(item.fingerprint_version) === identity.fingerprintVersion &&
        item.content_fingerprint === identity.contentFingerprint);
      final = matches.length === 1 ? matches[0] : null;
    }
    if (!identity || !final || !['duplicate_of_final','absent'].includes(observed.kind)) continue;
    add({ identity, location:observed.binding.location }, {
      bindingRevision:Number(observed.binding.binding_revision), endpointId:observed.binding.endpoint_id,
      fingerprintVerifiedAtMs:input.observedAtMs, readScope:'exact_known_old_binding_settlement',
    });
  }
  return Object.freeze(handles.sort((left, right) =>
    (left.location + ':' + left.identity.materialKey)
      .localeCompare(right.location + ':' + right.identity.materialKey)));
}

function stableJitterMs(shelfEntryId) {
  const prefix = canonicalDigest({ schema:'arca.aftercare-jitter@1', shelfEntryId }).slice(0, 12);
  return Number(BigInt('0x' + prefix) % BigInt(PERIODS.jitterMs + 1));
}

function latestForBasis(history, careBasisDigest) {
  const latest = new Map();
  for (const item of history.assessments || []) {
    if (item.careBasisDigest !== careBasisDigest || latest.has(item.assessmentKind)) continue;
    latest.set(item.assessmentKind, item);
  }
  return latest;
}

function hasIncompatibleRepairCombination(findings) {
  const kinds = (findings || []).filter((item) => item?.state === undefined || item.state === 'open')
    .map((item) => String(item.findingKind || ''));
  return kinds.includes('conformance:placement_unmet') && kinds.some((kind) =>
    kind.startsWith('presentation:') || (kind.startsWith('conformance:') && kind !== 'conformance:placement_unmet'));
}

function projectHealth(context, history, at = Date.now()) {
  if (!context) return null;
  const current = latestForBasis(history, context.basis.digest);
  const currentCases = (history.cases || []).filter((item) =>
    item.careBasisDigest === context.basis.digest);
  const activeCase = currentCases.find((item) => item.state === 'active') || null;
  const latestCase = currentCases[0] || null;
  const findingsByAssessment = new Map();
  for (const finding of history.findings || []) {
    if (finding.state !== 'open') continue;
    const list = findingsByAssessment.get(finding.assessmentId) || [];
    list.push(finding); findingsByAssessment.set(finding.assessmentId, list);
  }
  const dimensions = Object.fromEntries(ASSESSMENT_KINDS.map((kind) => {
    const assessment = current.get(kind) || null;
    return [kind, Object.freeze({
      state:assessment?.result || 'never_assessed',
      assessedAtMs:assessment?.assessedAtMs || null,
      evidenceDigest:assessment?.evidenceDigest || null,
      incidentKey:assessment?.incidentKey || null,
      findings:Object.freeze(assessment ? (findingsByAssessment.get(assessment.assessmentId) || []) : []),
    })];
  }));
  let state = 'never_assessed';
  const all = Object.values(dimensions);
  if (activeCase) state = 'repairing';
  else if (latestCase?.state === 'unresolved') state = 'attention_required';
  else if (hasIncompatibleRepairCombination(all.flatMap((item) => item.findings))) state = 'attention_required';
  else if (all.some((item) => item.findings.some((finding) => finding.repairability === 'attention_required'))) state = 'attention_required';
  else if (all.some((item) => item.state === 'not_assessable' || item.findings.some((finding) => finding.repairability === 'observe'))) state = 'observing';
  else if (all.every((item) => item.state === 'healthy')) state = 'healthy';
  const jitter = stableJitterMs(context.shelfEntryId), custody = dimensions.custody.assessedAtMs,
    deep = Math.min(...['presentation','conformance'].map((kind) => dimensions[kind].assessedAtMs || 0));
  return Object.freeze({ shelfEntryId:context.shelfEntryId, state, careBasisDigest:context.basis.digest,
    basisCurrent:true, dimensions:Object.freeze(dimensions), activeCase,
    nextCustodyDueAtMs:custody ? custody + PERIODS.custodyMs + jitter : at,
    nextDeepDueAtMs:deep ? deep + PERIODS.deepMs + jitter : at,
    updatedAtMs:Math.max(0,...all.map((item)=>item.assessedAtMs || 0),activeCase?.createdAtMs || 0) });
}

function dispositionFromAssessments(assessments) {
  const findings = assessments.flatMap((item) => item.findings || []);
  if (hasIncompatibleRepairCombination(findings)) return 'attention_required';
  if (findings.some((item) => item.repairability === 'attention_required')) return 'attention_required';
  if (findings.length && findings.every((item) => item.repairability === 'auto_repair')) return 'auto_repair';
  return findings.length ? 'observe' : 'observe';
}

module.exports = Object.freeze({ CAPABILITY_REFS, HEALTH_STATES, CASE_STATES, DISPOSITIONS,
  ASSESSMENT_KINDS, PERIODS, stableJitterMs, projectHealth, dispositionFromAssessments,
  hasIncompatibleRepairCombination,
  physicalIdentityFromInventoryRow, deriveInventoryMaterialChanges, settlementScopeDigest,
  isAftercareArtifactMaterial, aftercareSettlementEventId, aftercareServiceCatalogRevision, aftercareSettlementApprovalId,
  aftercareInventoryCommitId, aftercareInventoryCommitDigest,
  buildAftercareSettlementHandles });
