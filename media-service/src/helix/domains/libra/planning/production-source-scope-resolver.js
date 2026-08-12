'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildProductionSourceScopeReference } = require('../model/media-production-contracts');

function utf8(left, right) {
  return Buffer.from(left.materialKey).compare(Buffer.from(right.materialKey));
}

function selectedPayloadSetDigest(members) {
  return canonicalDigest({
    schema: 'libra.production-selected-payload-set@1',
    items: members.filter((item) => item.role === 'primary_payload')
      .map((item) => Object.freeze({ materialKey:item.materialKey, memberDigest:item.memberDigest ||
        canonicalDigest({ materialKey:item.materialKey, role:item.role, physicalIdentity:item.physicalIdentity }) })),
  });
}

function referenceFor(snapshot) {
  const structure = snapshot.candidatePackage?.structureEvidenceRef;
  const members = [...snapshot.members].sort(utf8);
  return buildProductionSourceScopeReference({
    libraRunId: snapshot.run.libraRunId,
    scopeKind: snapshot.materialInputForm,
    scopeId: structure?.unitId || snapshot.run.runMaterialManifestId,
    scopeDigest: structure?.unitDigest || snapshot.run.runScopeDigest,
    memberSetDigest: snapshot.run.runMaterialManifestDigest,
    memberCount: members.length,
    selectedPayloadSetDigest: selectedPayloadSetDigest(members),
  });
}

function topologyOrder(snapshot) {
  return new Map((snapshot.candidatePrimaryInputManifest?.members || [])
    .map((item, index) => [item.materialKey, Number.isSafeInteger(item.ordinal) ? item.ordinal : index]));
}

function createProductionSourceScopeResolver(options) {
  if (!options?.movieProductionReader || !options.productionPort ||
      typeof options.movieProductionReader.readRun !== 'function' ||
      typeof options.productionPort.issuePhysicalReadHandle !== 'function') {
    throw new TypeError('Production Source Scope Resolver requires exact Run and physical read ports.');
  }

  function readHandle(snapshot, member) {
    return options.productionPort.issuePhysicalReadHandle({
      libraRunId: snapshot.run.libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      runCreatedAtMs: snapshot.run.createdAtMs,
      physicalIdentity: member.physicalIdentity,
      sizeBytes: member.sizeBytes,
      endpointId: member.endpointId,
      location: member.location,
      bindingRevision: member.bindingRevision,
      mountScopeRevision: 1,
    });
  }

  function resolve(reference) {
    const snapshot = options.movieProductionReader.readRun(reference?.libraRunId);
    const expected = referenceFor(snapshot);
    if (canonicalJson(reference) !== canonicalJson(expected)) {
      const error = new Error('Production Source Scope reference is stale or forged.');
      error.code = 'LIBRA_PRODUCTION_SOURCE_SCOPE_STALE';
      throw error;
    }
    const order = topologyOrder(snapshot);
    const members = [...snapshot.members].sort((left, right) =>
      (order.get(left.materialKey) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.materialKey) ?? Number.MAX_SAFE_INTEGER) || utf8(left, right)).map((member) => Object.freeze({
      member,
      readHandle: readHandle(snapshot, member),
    }));
    const primary = members.filter((item) => item.member.role === 'primary_payload');
    if (!primary.length) throw new Error('Production Source Scope has no primary payload.');
    return Object.freeze({
      reference: expected,
      primaryReadHandle: primary[0].readHandle,
      primaryMembers: Object.freeze(primary),
      structuralMembers: Object.freeze(members.filter((item) => item.member.role === 'structural_dependency')),
      members: Object.freeze(members),
      sourceSetDigest: canonicalDigest({
        schema: 'libra.production-source-handle-set@1',
        items: members.map((item) => Object.freeze({
          materialKey: item.member.materialKey,
          role: item.member.role,
          handleDigest: canonicalDigest(item.readHandle),
        })),
      }),
    });
  }

  return Object.freeze({ referenceFor, resolve });
}

module.exports = Object.freeze({ createProductionSourceScopeResolver, referenceFor, selectedPayloadSetDigest });
