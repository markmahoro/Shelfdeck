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
    ...(snapshot.materialInputForm==='jav_named_parts' ? { javPartSet:snapshot.candidatePackage.javPartSet } : {}),
  });
}

function workspaceReferenceFor(snapshot,handle){
  return buildProductionSourceScopeReference({libraRunId:snapshot.run.libraRunId,scopeKind:'stream_file',scopeId:handle.workspaceId,
    scopeDigest:canonicalDigest(handle),memberSetDigest:canonicalDigest([handle]),memberCount:1,
    selectedPayloadSetDigest:canonicalDigest([handle.materialKey]),workspaceMaterialHandle:handle});
}

function memberReference(snapshot, member) {
  return buildProductionSourceScopeReference({libraRunId:snapshot.run.libraRunId,scopeKind:'stream_file',
    scopeId:member.materialKey,scopeDigest:canonicalDigest({schema:'libra.production-primary-scope@1',
      runExecutionBasisDigest:snapshot.run.executionBasisDigest,runMaterialManifestDigest:snapshot.run.runMaterialManifestDigest,
      memberDigest:canonicalDigest(member)}),memberSetDigest:canonicalDigest([member]),memberCount:1,
    selectedPayloadSetDigest:selectedPayloadSetDigest([member])});
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
    if(reference.workspaceMaterialHandle){
      const handle=reference.workspaceMaterialHandle,expected=workspaceReferenceFor(snapshot,handle),
        workspace=options.movieProductionReader.readWorkspace(handle.workspaceId),
        works=options.workResultReader.listWorks({ownerDomain:'libra',processType:'libra_run',processId:reference.libraRunId,workKind:'workspace_media_production'});
      const imported=works.filter(work=>work.state==='succeeded').flatMap(work=>options.workResultReader.read(work.work_id))
        .some(item=>item.outcomeKind==='succeeded'&&item.capabilityRef==='libra.workspace.material.import@1'&&canonicalDigest(item.result)===canonicalDigest(handle));
      if(!workspace||workspace.state!=='active'||!imported||canonicalJson(expected)!==canonicalJson(reference))
        throw new Error('Workspace Remux input does not match the durable imported material.');
      const member={materialKey:handle.materialKey,role:'primary_payload',physicalIdentity:handle.physicalIdentity},item={member,readHandle:handle};
      return Object.freeze({reference:expected,primaryReadHandle:handle,primaryMembers:[item],structuralMembers:[],members:[item],sourceSetDigest:canonicalDigest([handle])});
    }
    if(snapshot.spec.contentProfile==='series') {
      const matches=seriesPrimaryMembers(snapshot).filter(member=>canonicalJson(memberReference(snapshot,member))===canonicalJson(reference));
      if(matches.length!==1) {
        const error=new Error('Production Source Scope does not bind one exact frozen Series Primary.');
        error.code='LIBRA_PRODUCTION_SOURCE_SCOPE_STALE';throw error;
      }
      const item=Object.freeze({member:matches[0],readHandle:readHandle(snapshot,matches[0])});
      return Object.freeze({reference:memberReference(snapshot,matches[0]),primaryReadHandle:item.readHandle,
        primaryMembers:Object.freeze([item]),structuralMembers:Object.freeze([]),members:Object.freeze([item]),
        sourceSetDigest:canonicalDigest({schema:'libra.production-source-handle-set@1',items:[{
          materialKey:item.member.materialKey,role:item.member.role,handleDigest:canonicalDigest(item.readHandle)}]})});
    }
    const expected = referenceFor(snapshot);
    if (canonicalJson(reference) !== canonicalJson(expected)) {
      const error = new Error('Production Source Scope reference is stale or forged.');
      error.code = 'LIBRA_PRODUCTION_SOURCE_SCOPE_STALE';
      throw error;
    }
    const order = snapshot.materialInputForm==='jav_named_parts'
      ? new Map(expected.javPartSet.parts.map(part=>[part.materialKey,part.ordinal])) : topologyOrder(snapshot);
    if(snapshot.materialInputForm==='jav_named_parts' && (snapshot.spec.contentProfile!=='jav'||snapshot.members.length!==2||
        snapshot.members.some(member=>member.role!=='primary_payload'||!order.has(member.materialKey))))
      throw new Error('Named-part source does not conserve its exact JAV Run members.');
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

  function seriesPrimaryMembers(snapshot) {
    const current = options.movieProductionReader.readRun(snapshot.run.libraRunId);
    if (current.run.executionBasisDigest !== snapshot.run.executionBasisDigest ||
        current.run.runMaterialManifestDigest !== snapshot.run.runMaterialManifestDigest ||
        current.spec.recordDigest !== snapshot.spec.recordDigest ||
        current.materialInputForm !== snapshot.materialInputForm ||
        canonicalJson(current.members) !== canonicalJson(snapshot.members)) {
      const error = new Error('Source Primary snapshot differs from the frozen Run.');
      error.code = 'LIBRA_PRODUCTION_SOURCE_MEMBER_STALE';
      throw error;
    }
    const primary = [...current.members].filter(item => item.role === 'primary_payload').sort(utf8);
    if (current.spec.contentProfile !== 'series' || current.spec.structureKind !== 'season' ||
        current.materialInputForm !== 'stream_file' || primary.length < 1 || primary.length > 1024 ||
        new Set(primary.map(item => item.materialKey)).size !== primary.length) {
      throw new Error('Series source probing requires a bounded frozen stream-file Primary set.');
    }
    // The exact Reader has already verified each bounded Claim Set against
    // Handoff A and the Run Manifest. Probe physical members, not claim rows.
    return Object.freeze(primary);
  }

  function primarySources(snapshot) {
    if(snapshot.materialInputForm==='jav_named_parts') return resolve(referenceFor(snapshot)).primaryMembers;
    if (snapshot.spec.contentProfile !== 'series') {
      // Disc probing keeps the frozen title/topology behavior of single products.
      return Object.freeze([resolve(referenceFor(snapshot)).primaryMembers[0]]);
    }
    return Object.freeze(seriesPrimaryMembers(snapshot).map(member =>
      Object.freeze({member, readHandle:readHandle(snapshot, member)})));
  }

  function primaryMember(snapshot, parameters) {
    const member = (snapshot.materialInputForm==='jav_named_parts' ? resolve(referenceFor(snapshot)).primaryMembers.map(item=>item.member)
      : seriesPrimaryMembers(snapshot)).find(item => item.materialKey === parameters.materialKey);
    if (Object.keys(parameters).length !== 2 || !Object.hasOwn(parameters, 'memberDigest') ||
        !member || canonicalDigest(member) !== parameters.memberDigest) {
      const error = new Error('Source Probe does not bind an exact frozen Series Primary.');
      error.code = 'LIBRA_PRODUCTION_SOURCE_MEMBER_STALE';
      throw error;
    }
    return member;
  }

  function primarySource(snapshot, parameters) {
    const member=primaryMember(snapshot,parameters);
    return Object.freeze({member,readHandle:readHandle(snapshot,member)});
  }

  function primaryReferenceFor(snapshot,parameters) {
    const member=primaryMember(snapshot,parameters);
    return memberReference(snapshot,member);
  }

  return Object.freeze({ referenceFor, resolve, primarySources, primarySource, primaryReferenceFor });
}

module.exports = Object.freeze({ createProductionSourceScopeResolver, referenceFor, workspaceReferenceFor, selectedPayloadSetDigest });
