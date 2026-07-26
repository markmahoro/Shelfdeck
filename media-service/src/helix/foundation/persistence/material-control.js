'use strict';

const { digest } = require('./ddl-compiler');
const { createRepositoryDefinition } = require('./owner-repository');

const SHA256 = /^[0-9a-f]{64}$/;
const OPERATIONS = new Set(['acquire', 'transfer', 'release', 'replace_control_set']);

class MaterialControlError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MaterialControlError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MaterialControlError(code, message, details);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha(value, field) {
  if (!SHA256.test(value || '')) fail('P3_CONTROL_INVALID_DIGEST', 'Material Control digest must be lowercase SHA-256.', { field });
  return value;
}

function text(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail('P3_CONTROL_INVALID_FIELD', 'Material Control field is required.', { field });
  return value;
}

function materialKey(identity) {
  if (!identity || identity.schemaRef !== 'helix://contracts/types/PhysicalMaterialIdentity/v1' || identity.schemaVersion !== 1 ||
      identity.contentHashAlgorithm !== 'sha256') fail('P3_CONTROL_INVALID_IDENTITY', 'Physical Material Identity contract is invalid.');
  text(identity.mountScopeId, 'mountScopeId');
  if (!/^(0|[1-9][0-9]*)$/.test(text(identity.inode, 'inode'))) fail('P3_CONTROL_INVALID_IDENTITY', 'Physical Material inode must be an unsigned decimal string.');
  sha(identity.contentHash, 'contentHash');
  return digest(canonicalJson({
    schema: 'physical-material-identity@1',
    mountScopeId: identity.mountScopeId,
    inode: identity.inode,
    contentHashAlgorithm: identity.contentHashAlgorithm,
    contentHash: identity.contentHash
  }));
}

function scopeProjection(change) {
  return {
    action: change.action,
    materialKey: change.identity.materialKey,
    expectedRevision: change.expectedRevision,
    fromOwnerDomain: change.fromScope && change.fromScope.ownerDomain || null,
    fromScopeType: change.fromScope && change.fromScope.scopeType || null,
    fromScopeId: change.fromScope && change.fromScope.scopeId || null,
    toOwnerDomain: change.toScope && change.toScope.ownerDomain || null,
    toScopeType: change.toScope && change.toScope.scopeType || null,
    toScopeId: change.toScope && change.toScope.scopeId || null
  };
}

function controlScopeDigest(changes) {
  return digest(canonicalJson(changes.map(scopeProjection).sort((left, right) => left.materialKey.localeCompare(right.materialKey))));
}

function controlProjection(value) {
  const evidence = { schema:'foundation.material-control-evidence@1', materialKey:value.materialKey,
    resultKind:value.resultKind, ...(value.controlRevision === undefined ? {} : { controlRevision:value.controlRevision }),
    ...(value.controlState === undefined ? {} : { controlState:value.controlState }),
    ...(value.ownerDomain === undefined ? {} : { ownerDomain:value.ownerDomain }),
    ...(value.ownerScopeType === undefined ? {} : { ownerScopeType:value.ownerScopeType }),
    ...(value.ownerScopeId === undefined ? {} : { ownerScopeId:value.ownerScopeId }),
    ...(value.failureCode === undefined ? {} : { failureCode:value.failureCode }) };
  const withEvidence = { ...value, evidenceDigest:digest(canonicalJson(evidence)) };
  return Object.freeze({ ...withEvidence, projectionDigest:digest(canonicalJson(withEvidence)) });
}

function mapControlProjection(materialKeyValue, row) {
  if (!row) return controlProjection({ materialKey:materialKeyValue, resultKind:'available', controlRevision:0,
    controlState:'uncontrolled', regionProjection:'uncontrolled' });
  const revision = Number(row.control_revision);
  if (!Number.isSafeInteger(revision) || revision < 1) return controlProjection({ materialKey:materialKeyValue,
    resultKind:'unavailable', failureCode:'control_row_invalid' });
  if (row.state === 'released' && row.owner_domain === null && row.owner_scope_type === null && row.owner_scope_id === null) {
    return controlProjection({ materialKey:materialKeyValue, resultKind:'available', controlRevision:revision,
      controlState:'uncontrolled', regionProjection:'uncontrolled' });
  }
  const regions = { procurement:'procurement', libra:'production', arca:'finished_goods' };
  if (row.state !== 'controlled' || !regions[row.owner_domain] || !row.owner_scope_type || !row.owner_scope_id) {
    return controlProjection({ materialKey:materialKeyValue, resultKind:'unavailable', failureCode:'control_row_invalid' });
  }
  return controlProjection({ materialKey:materialKeyValue, resultKind:'available', controlRevision:revision,
    controlState:'controlled', ownerDomain:row.owner_domain, ownerScopeType:row.owner_scope_type,
    ownerScopeId:row.owner_scope_id, regionProjection:regions[row.owner_domain] });
}

function createMaterialControlProjectionPort(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') fail('P3_CONTROL_QUERY_DATABASE_REQUIRED', 'Material Control Query requires scoped persistence dependencies.');
  const queryRepository = createRepositoryDefinition({ repositoryId:'material_control_query', owner:'material-control-authority', schemaManifest:options.schemaManifest,
    statements:{ find_many:{ kind:'select-in', tableId:'fx_material_controls', keyColumn:'material_key', maxItems:500, safeIntegers:true,
      columns:['material_key','owner_domain','owner_scope_type','owner_scope_id','control_revision','state'] } } });
  function getMaterialControlProjections(materialKeys) {
    if (!Array.isArray(materialKeys) || materialKeys.length > 500 || new Set(materialKeys).size !== materialKeys.length ||
        materialKeys.some((key, index) => !SHA256.test(key || '') || index > 0 && materialKeys[index - 1].localeCompare(key) >= 0)) {
      fail('P3_CONTROL_QUERY_KEYS_INVALID', 'Material Control Query keys must be unique, sorted, and bounded to 500.');
    }
    if (materialKeys.length === 0) return Object.freeze([]);
    try {
      const rows = options.unitOfWork.execute([{ participantId:'material_control_query', owner:'material-control-authority', repositories:[queryRepository],
        execute(context) { return context.repository('material_control_query').invoke('find_many', { values:materialKeys }); } }]).material_control_query;
      const byKey = new Map(rows.map((row) => [row.material_key, row]));
      return Object.freeze(materialKeys.map((key) => mapControlProjection(key, byKey.get(key))));
    } catch (error) {
      return Object.freeze(materialKeys.map((key) => controlProjection({ materialKey:key, resultKind:'unavailable', failureCode:'control_query_unavailable' })));
    }
  }
  return Object.freeze({
    getMaterialControlProjection(materialKeyValue) { return getMaterialControlProjections([materialKeyValue])[0]; },
    getMaterialControlProjections
  });
}

function createMaterialControlProjectionReadParticipant(options) {
  if (!options || !options.schemaManifest || !Array.isArray(options.materialKeys) || typeof options.accept !== 'function') {
    fail('P3_CONTROL_QUERY_PARTICIPANT_INVALID', 'Material Control projection participant dependencies are required.');
  }
  const keys = options.materialKeys;
  if (keys.length < 1 || keys.length > 500 || new Set(keys).size !== keys.length ||
      keys.some((key, index) => !SHA256.test(key || '') || index > 0 && keys[index - 1].localeCompare(key) >= 0)) {
    fail('P3_CONTROL_QUERY_KEYS_INVALID', 'Material Control Query keys must be unique, sorted, and bounded to 500.');
  }
  const queryRepository = createRepositoryDefinition({ repositoryId:'material_control_reconcile_query', owner:'material-control-authority', schemaManifest:options.schemaManifest,
    statements:{ find_many:{ kind:'select-in', tableId:'fx_material_controls', keyColumn:'material_key', maxItems:500, safeIntegers:true,
      columns:['material_key','owner_domain','owner_scope_type','owner_scope_id','control_revision','state'] } } });
  return Object.freeze({ participantId:options.participantId || 'material_control_reconcile_query', owner:'material-control-authority',
    boundBusinessOwner:'procurement', repositories:[queryRepository], execute(context) {
      const rows = context.repository(queryRepository.repositoryId).invoke('find_many', { values:keys });
      const byKey = new Map(rows.map((row) => [row.material_key, row]));
      const snapshots = Object.freeze(keys.map((key) => mapControlProjection(key, byKey.get(key))));
      options.accept(snapshots); return snapshots.length;
    } });
}

function createMaterialControlAdmissionReadParticipant(options) {
  if (!options || !options.schemaManifest || (!Array.isArray(options.materialKeys) && typeof options.materialKeys !== 'function') || typeof options.accept !== 'function' ||
      typeof options.boundBusinessOwner !== 'string') fail('P3_CONTROL_ADMISSION_QUERY_INVALID', 'Atomic admission Control read dependencies are required.');
  const resolveKeys=()=>typeof options.materialKeys==='function'?options.materialKeys():options.materialKeys;
  if(Array.isArray(options.materialKeys))validateAdmissionKeys(options.materialKeys);
  const definition=repository(options.schemaManifest);
  return Object.freeze({participantId:options.participantId||'material_control_admission_query',owner:'material-control-authority',
    boundBusinessOwner:options.boundBusinessOwner,repositories:[definition],execute(context){const control=context.repository('material_control');
      const keys=resolveKeys();validateAdmissionKeys(keys);
      const snapshots=Object.freeze(keys.map((key)=>mapControlProjection(key,control.invoke('find_current',{material_key:key}))));options.accept(snapshots);return snapshots.length;}});
}

function validateAdmissionKeys(keys){
  if(!Array.isArray(keys)||keys.length<1||keys.length>1024||new Set(keys).size!==keys.length||keys.some((key,index)=>!SHA256.test(key||'')||index>0&&keys[index-1].localeCompare(key)>=0))
    fail('P3_CONTROL_ADMISSION_QUERY_KEYS_INVALID','Atomic admission Control keys must be unique, sorted, and bounded to 1024.');
}

function repository(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'material_control', owner: 'material-control-authority', schemaManifest,
    statements: {
      find_current: {
        kind: 'select-one', tableId: 'fx_material_controls',
        columns: ['material_key', 'mount_scope_id', 'inode', 'content_hash_algorithm', 'content_hash', 'owner_domain',
          'owner_scope_type', 'owner_scope_id', 'control_revision', 'state', 'updated_at_ms'],
        keyColumns: ['material_key']
      },
      insert_current: {
        kind: 'insert', tableId: 'fx_material_controls',
        columns: ['material_key', 'mount_scope_id', 'inode', 'content_hash_algorithm', 'content_hash', 'owner_domain',
          'owner_scope_type', 'owner_scope_id', 'control_revision', 'state', 'updated_at_ms']
      },
      cas_current: {
        kind: 'update', tableId: 'fx_material_controls',
        setColumns: ['owner_domain', 'owner_scope_type', 'owner_scope_id', 'control_revision', 'state', 'updated_at_ms'],
        keyColumns: ['material_key'],
        compareColumns: [{ column: 'control_revision', parameter: 'expected_control_revision' }]
      },
      insert_revision: {
        kind: 'insert', tableId: 'fx_material_control_revisions',
        columns: ['material_key', 'revision', 'operation_kind', 'from_owner_domain', 'from_scope_type', 'from_scope_id',
          'to_owner_domain', 'to_scope_type', 'to_scope_id', 'basis_digest', 'commit_marker', 'committed_at_ms']
      }
    }
  });
}

function assertScope(scope, field) {
  if (!scope) fail('P3_CONTROL_SCOPE_REQUIRED', 'Material Control scope is required.', { field });
  text(scope.ownerDomain, field + '.ownerDomain');
  text(scope.scopeType, field + '.scopeType');
  text(scope.scopeId, field + '.scopeId');
}

function assertHandle(handle, changes, authorizedScopeDigest) {
  if (!handle || handle.schemaRef !== 'helix://contracts/types/ResponsibilityControlCommitHandle/v1' || handle.schemaVersion !== 1 ||
      !OPERATIONS.has(handle.operationKind) || !Array.isArray(handle.expectedControlRevisions) || !Array.isArray(changes) ||
      changes.length === 0 || changes.length > 1024) {
    fail('P3_CONTROL_INVALID_HANDLE', 'Responsibility Control Commit Handle is invalid.');
  }
  for (const field of ['handleId', 'ownerDomain', 'processType', 'processId', 'receiptContract', 'eventFenceDigest']) text(handle[field], field);
  for (const field of ['basisDigest', 'canonicalFactSetDigest', 'bindingSetDigest', 'controlScopeDigest', 'eventFenceDigest']) sha(handle[field], field);
  if (!handle.basisRef || !Number.isSafeInteger(handle.basisRef.revision) || handle.basisRef.revision < 1) fail(
    'P3_CONTROL_INVALID_BASIS_REF', 'Control Handle requires a revisioned Basis reference.'
  );
  text(handle.basisRef.objectType, 'basisRef.objectType');
  text(handle.basisRef.objectId, 'basisRef.objectId');
  sha(handle.basisRef.digest, 'basisRef.digest');
  if (handle.operationKind === 'transfer') {
    text(handle.receivingDomain, 'receivingDomain');
    text(handle.transferPoint, 'transferPoint');
  } else if (handle.receivingDomain !== undefined || handle.transferPoint !== undefined) {
    fail('P3_CONTROL_ILLEGAL_TRANSFER_FIELDS', 'Only cross-Domain transfer may carry receivingDomain and transferPoint.');
  }
  for (const change of changes) {
    if (!change || !change.identity || !SHA256.test(change.identity.materialKey || '') ||
        !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0 || !['acquire', 'assert_same_field', 'transfer', 'release'].includes(change.action)) {
      fail('P3_CONTROL_INVALID_CHANGE', 'Control change identity, action, and expected revision are required.');
    }
    if (change.expectedProjectionDigest !== undefined) sha(change.expectedProjectionDigest, 'expectedProjectionDigest');
  }
  for (const item of handle.expectedControlRevisions) {
    if (!item || !SHA256.test(item.materialKey || '') || !Number.isSafeInteger(item.revision) || item.revision < 0) fail(
      'P3_CONTROL_INVALID_EXPECTED_REVISION', 'Expected Control revision entry is invalid.'
    );
  }
  const expected = [...handle.expectedControlRevisions].sort((left, right) => left.materialKey.localeCompare(right.materialKey));
  const projected = changes.map((change) => ({ materialKey: change.identity && change.identity.materialKey, revision: change.expectedRevision }))
    .sort((left, right) => left.materialKey.localeCompare(right.materialKey));
  if (expected.length !== changes.length || new Set(expected.map((item) => item.materialKey)).size !== expected.length ||
      canonicalJson(expected) !== canonicalJson(projected)) fail('P3_CONTROL_EXPECTED_SET_MISMATCH', 'Expected Control revisions do not exactly cover the change set.');
  const expectedScopeDigest = authorizedScopeDigest === undefined ? controlScopeDigest(changes) : sha(authorizedScopeDigest, 'authorizedScopeDigest');
  if (expectedScopeDigest !== handle.controlScopeDigest) fail('P3_CONTROL_SCOPE_DIGEST_MISMATCH', 'Control scope digest does not match the authorized exact scope.');
}

function createMaterialControlParticipant(options) {
  if (!options || !options.schemaManifest) fail('P3_CONTROL_INVALID_PARTICIPANT', 'Schema manifest is required.');
  assertHandle(options.handle, options.changes, options.authorizedScopeDigest);
  const handle = options.handle;
  const changes = options.changes;
  const definition = repository(options.schemaManifest);
  const boundBusinessOwner = handle.operationKind === 'transfer' ? handle.receivingDomain : handle.ownerDomain;
  return Object.freeze({
    participantId: options.participantId || 'material_control',
    owner: 'material-control-authority',
    boundBusinessOwner,
    repositories: [definition],
    execute(context) {
      const control = context.repository('material_control');
      const results = [];
      for (const change of [...changes].sort((left, right) => left.identity.materialKey.localeCompare(right.identity.materialKey))) {
        if (materialKey(change.identity) !== change.identity.materialKey) fail('P3_CONTROL_MATERIAL_KEY_MISMATCH', 'materialKey does not match the canonical Physical Material tuple.');
        if (!['acquire', 'assert_same_field', 'transfer', 'release'].includes(change.action) ||
            (handle.operationKind === 'acquire' ? !['acquire', 'assert_same_field'].includes(change.action) :
              handle.operationKind !== 'replace_control_set' && change.action !== handle.operationKind)) {
          fail('P3_CONTROL_OPERATION_MISMATCH', 'Control change action is incompatible with the Handle operation.');
        }
        const current = control.invoke('find_current', { material_key: change.identity.materialKey });
        if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0 ||
            (current ? current.control_revision : 0) !== change.expectedRevision) {
          fail('P3_CONTROL_CAS_CONFLICT', 'Material Control expected revision is stale.', { materialKey: change.identity.materialKey });
        }
        if (change.expectedProjectionDigest !== undefined &&
            mapControlProjection(change.identity.materialKey, current).projectionDigest !== change.expectedProjectionDigest) {
          fail('P3_CONTROL_PROJECTION_CONFLICT', 'Material Control expected projection digest is stale.', { materialKey:change.identity.materialKey });
        }
        let from = change.fromScope || null;
        let to = change.toScope || null;
        if (change.action === 'assert_same_field') {
          assertScope(from, 'fromScope');
          if (to || !current || current.state !== 'controlled' || from.ownerDomain !== handle.ownerDomain ||
              current.owner_domain !== from.ownerDomain || current.owner_scope_type !== from.scopeType || current.owner_scope_id !== from.scopeId) {
            fail('P3_CONTROL_ASSERT_SCOPE_MISMATCH', 'Assert requires the exact current Control scope owned by the Handle Domain.');
          }
          const projection = mapControlProjection(change.identity.materialKey, current);
          results.push(Object.freeze({ materialKey:change.identity.materialKey, revision:change.expectedRevision,
            state:'controlled', action:'assert_same_field', projection }));
          continue;
        } else if (change.action === 'acquire') {
          assertScope(to, 'toScope');
          if (from || to.ownerDomain !== handle.ownerDomain || current && current.state !== 'released') fail(
            'P3_CONTROL_ACQUIRE_PRECONDITION', 'Acquire requires no active Control and a target owned by the Handle Domain.'
          );
        } else {
          assertScope(from, 'fromScope');
          if (!current || current.state !== 'controlled' || current.owner_domain !== from.ownerDomain ||
              current.owner_scope_type !== from.scopeType || current.owner_scope_id !== from.scopeId || from.ownerDomain !== handle.ownerDomain) {
            fail('P3_CONTROL_FROM_SCOPE_MISMATCH', 'Current Control does not match the exact signed source scope.');
          }
          if (change.action === 'transfer') {
            assertScope(to, 'toScope');
            const expectedTarget = handle.operationKind === 'transfer' ? handle.receivingDomain : handle.ownerDomain;
            if (to.ownerDomain !== expectedTarget) fail('P3_CONTROL_TRANSFER_TARGET_MISMATCH', 'Transfer target is outside the signed receiving scope.');
          } else if (to) fail('P3_CONTROL_RELEASE_TARGET_FORBIDDEN', 'Release cannot carry a target scope.');
        }
        const revision = change.expectedRevision + 1;
        if (!current) {
          control.invoke('insert_current', {
            material_key: change.identity.materialKey,
            mount_scope_id: change.identity.mountScopeId,
            inode: change.identity.inode,
            content_hash_algorithm: change.identity.contentHashAlgorithm,
            content_hash: change.identity.contentHash,
            owner_domain: to.ownerDomain,
            owner_scope_type: to.scopeType,
            owner_scope_id: to.scopeId,
            control_revision: revision,
            state: 'controlled',
            updated_at_ms: context.commitTimeMs
          });
        } else {
          const update = control.invoke('cas_current', {
            owner_domain: to && to.ownerDomain || null,
            owner_scope_type: to && to.scopeType || null,
            owner_scope_id: to && to.scopeId || null,
            control_revision: revision,
            state: change.action === 'release' ? 'released' : 'controlled',
            updated_at_ms: context.commitTimeMs,
            material_key: change.identity.materialKey,
            expected_control_revision: change.expectedRevision
          });
          if (update.changes !== 1) fail('P3_CONTROL_CAS_CONFLICT', 'Material Control CAS update lost its expected revision.');
        }
        control.invoke('insert_revision', {
          material_key: change.identity.materialKey,
          revision,
          operation_kind: change.action,
          from_owner_domain: from && from.ownerDomain || null,
          from_scope_type: from && from.scopeType || null,
          from_scope_id: from && from.scopeId || null,
          to_owner_domain: to && to.ownerDomain || null,
          to_scope_type: to && to.scopeType || null,
          to_scope_id: to && to.scopeId || null,
          basis_digest: handle.basisDigest,
          commit_marker: text(options.commitMarker, 'commitMarker'),
          committed_at_ms: context.commitTimeMs
        });
        const projection = mapControlProjection(change.identity.materialKey, {
          control_revision:revision, state:change.action === 'release' ? 'released' : 'controlled',
          owner_domain:to && to.ownerDomain || null, owner_scope_type:to && to.scopeType || null, owner_scope_id:to && to.scopeId || null
        });
        results.push(Object.freeze({ materialKey:change.identity.materialKey, revision,
          state:change.action === 'release' ? 'released' : 'controlled', action:change.action, projection }));
      }
      return Object.freeze(results);
    }
  });
}

// Exact Handoff payloads intentionally carry stable Material keys and Control
// fences, not a second copy of Physical Material Identity. The Control owner
// recovers that identity only from its own current row before applying CAS.
function createMaterialControlExactTransferParticipant(options) {
  if (!options || !options.schemaManifest || !options.handle || !Array.isArray(options.changes)) {
    fail('P3_CONTROL_TRANSFER_PARTICIPANT_INVALID', 'Exact transfer dependencies are required.');
  }
  const handle=options.handle, changes=options.changes;
  if (handle.schemaRef!=='helix://contracts/types/ResponsibilityControlCommitHandle/v1'||handle.schemaVersion!==1||
      handle.operationKind!=='transfer'||changes.length<1||changes.length>1024) {
    fail('P3_CONTROL_INVALID_HANDLE', 'Exact transfer requires a Responsibility Control transfer Handle and non-empty scope.');
  }
  for (const field of ['handleId','ownerDomain','processType','processId','receivingDomain','transferPoint']) text(handle[field],field);
  if (!handle.receiptContract || handle.receiptContract.receiptSchemaRef!=='SubjectAndTransferReceipt@1' ||
      handle.receiptContract.controlRevisionSetSchemaRef!=='libra.handoff-a-transferred-control-set@1' ||
      Object.keys(handle.receiptContract).length!==2) {
    fail('P3_CONTROL_TRANSFER_RECEIPT_CONTRACT_MISMATCH','Exact Handoff transfer requires its closed Receipt reconstruction contract.');
  }
  for (const field of ['basisDigest','canonicalFactSetDigest','bindingSetDigest','controlScopeDigest','eventFenceDigest']) sha(handle[field],field);
  if (handle.ownerDomain!==handle.receivingDomain) {
    fail('P3_CONTROL_TRANSFER_HANDLE_OWNER_MISMATCH','Exact Handoff transfer Handle must be owned by the receiving commit Domain.');
  }
  if (!handle.basisRef||!Number.isSafeInteger(handle.basisRef.revision)||handle.basisRef.revision<1) {
    fail('P3_CONTROL_INVALID_BASIS_REF', 'Control Handle requires a revisioned Basis reference.');
  }
  text(handle.basisRef.objectType,'basisRef.objectType');text(handle.basisRef.objectId,'basisRef.objectId');sha(handle.basisRef.digest,'basisRef.digest');
  if (options.authorizedScopeDigest!==handle.controlScopeDigest) fail('P3_CONTROL_SCOPE_DIGEST_MISMATCH','Control scope digest does not match the authorized exact scope.');
  const expected=[...handle.expectedControlRevisions].sort((a,b)=>a.materialKey.localeCompare(b.materialKey));
  const projected=changes.map((change)=>({materialKey:change.materialKey,revision:change.expectedRevision}))
    .sort((a,b)=>a.materialKey.localeCompare(b.materialKey));
  if (expected.length!==changes.length||new Set(expected.map((item)=>item.materialKey)).size!==expected.length||
      canonicalJson(expected)!==canonicalJson(projected)) fail('P3_CONTROL_EXPECTED_SET_MISMATCH','Expected Control revisions do not exactly cover the transfer set.');
  for (const change of changes) {
    if (!change||!SHA256.test(change.materialKey||'')||!Number.isSafeInteger(change.expectedRevision)||change.expectedRevision<1) {
      fail('P3_CONTROL_INVALID_CHANGE','Exact transfer Material key and positive expected revision are required.');
    }
    sha(change.expectedProjectionDigest,'expectedProjectionDigest');assertScope(change.fromScope,'fromScope');assertScope(change.toScope,'toScope');
    if (change.toScope.ownerDomain!==handle.receivingDomain) {
      fail('P3_CONTROL_TRANSFER_TARGET_MISMATCH','Transfer target does not match the receiving commit Domain.');
    }
  }
  const definition=repository(options.schemaManifest);
  return Object.freeze({participantId:options.participantId||'material_control',owner:'material-control-authority',
    boundBusinessOwner:handle.receivingDomain,repositories:[definition],execute(context){
      const repo=context.repository(definition.repositoryId),results=[];
      for (const change of [...changes].sort((a,b)=>a.materialKey.localeCompare(b.materialKey))) {
        const current=repo.invoke('find_current',{material_key:change.materialKey});
        if (!current||Number(current.control_revision)!==change.expectedRevision) fail('P3_CONTROL_CAS_CONFLICT','Material Control expected revision is stale.',{materialKey:change.materialKey});
        const identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,materialKey:current.material_key,
          mountScopeId:current.mount_scope_id,inode:String(current.inode),contentHashAlgorithm:current.content_hash_algorithm,contentHash:current.content_hash};
        if (materialKey(identity)!==change.materialKey) fail('P3_CONTROL_MATERIAL_KEY_MISMATCH','Stored Physical Material Identity does not match its Material key.');
        if (mapControlProjection(change.materialKey,current).projectionDigest!==change.expectedProjectionDigest) {
          fail('P3_CONTROL_PROJECTION_CONFLICT','Material Control expected projection digest is stale.',{materialKey:change.materialKey});
        }
        if (current.state!=='controlled'||current.owner_domain!==change.fromScope.ownerDomain||
            current.owner_scope_type!==change.fromScope.scopeType||current.owner_scope_id!==change.fromScope.scopeId) {
          fail('P3_CONTROL_FROM_SCOPE_MISMATCH','Current Control does not match the exact signed source scope.');
        }
        const revision=change.expectedRevision+1,update=repo.invoke('cas_current',{owner_domain:change.toScope.ownerDomain,
          owner_scope_type:change.toScope.scopeType,owner_scope_id:change.toScope.scopeId,control_revision:revision,state:'controlled',
          updated_at_ms:context.commitTimeMs,material_key:change.materialKey,expected_control_revision:change.expectedRevision});
        if (update.changes!==1) fail('P3_CONTROL_CAS_CONFLICT','Material Control CAS update lost its expected revision.');
        repo.invoke('insert_revision',{material_key:change.materialKey,revision,operation_kind:'transfer',
          from_owner_domain:change.fromScope.ownerDomain,from_scope_type:change.fromScope.scopeType,from_scope_id:change.fromScope.scopeId,
          to_owner_domain:change.toScope.ownerDomain,to_scope_type:change.toScope.scopeType,to_scope_id:change.toScope.scopeId,
          basis_digest:handle.basisDigest,commit_marker:text(options.commitMarker,'commitMarker'),committed_at_ms:context.commitTimeMs});
        const projection=mapControlProjection(change.materialKey,{control_revision:revision,state:'controlled',owner_domain:change.toScope.ownerDomain,
          owner_scope_type:change.toScope.scopeType,owner_scope_id:change.toScope.scopeId});
        results.push(Object.freeze({materialKey:change.materialKey,revision,state:'controlled',action:'transfer',projection}));
      }
      return Object.freeze(results);
    }});
}

module.exports = Object.freeze({ MaterialControlError, controlScopeDigest, createMaterialControlParticipant,
  createMaterialControlAdmissionReadParticipant, createMaterialControlExactTransferParticipant, createMaterialControlProjectionPort,
  createMaterialControlProjectionReadParticipant, materialKey,
  projectMaterialControlRow: mapControlProjection });
