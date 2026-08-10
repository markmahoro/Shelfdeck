'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const MAX_RUN_PHYSICAL_MEMBERS = 1024;
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

class ProcurementRunTriageReaderError extends Error {
  constructor(code, message, details = {}) { super(message); this.name='ProcurementRunTriageReaderError'; this.code=code; this.details=details; }
}
function fail(code, message, details) { throw new ProcurementRunTriageReaderError(code, message, details); }

function normalizedLocation(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function locationKey(value) { return normalizedLocation(value).toLocaleLowerCase('en-US'); }
function parentLocation(value) {
  const normalized = normalizedLocation(value);
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '.' : normalized.slice(0, index) || '.';
}

function observedLayoutMaterial(snapshot, page) {
  const identity = Object.freeze({ ...snapshot.identity });
  return Object.freeze({
    materialKey: identity.materialKey,
    identity,
    endpointId: snapshot.endpointId,
    location: snapshot.location,
    sizeBytes: Number(snapshot.sizeBytes),
    mtimeNs: String(snapshot.mtimeNs),
    ctimeNs: String(snapshot.ctimeNs),
    observationId: page.observationId,
    fieldId: page.fieldId,
  });
}

function identityFromMember(member) {
  return Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
    materialKey:member.material_key, mountScopeId:member.mount_scope_id, inode:String(member.inode), sizeBytes:Number(member.size_bytes),
    fingerprintAlgorithm:member.fingerprint_algorithm, fingerprintVersion:Number(member.fingerprint_version), contentFingerprint:member.content_fingerprint });
}

function validatePersistedScopeBasis(run, members) {
  if (Number(run.selected_material_count) !== members.length ||
      !Number.isSafeInteger(Number(run.selection_scope_count)) || Number(run.selection_scope_count) < 1 ||
      typeof run.selection_scope_set_digest !== 'string') {
    fail('P7_TRIAGE_RUN_SCOPE_HEAD_CORRUPT', 'Run Scope head does not match its admitted members.');
  }
  const groups = new Map();
  let priorMaterialKey = null;
  for (const [ordinal, member] of members.entries()) {
    if (Number(member.ordinal) !== ordinal || priorMaterialKey !== null &&
        Buffer.compare(Buffer.from(priorMaterialKey), Buffer.from(member.material_key)) >= 0) {
      fail('P7_TRIAGE_RUN_MEMBER_ORDER_CORRUPT', 'Run members are not the immutable UTF-8 ordered Selection.');
    }
    priorMaterialKey = member.material_key;
    const scopeOrdinal = Number(member.selection_scope_ordinal);
    const scopeMemberOrdinal = Number(member.scope_member_ordinal);
    if (!Number.isSafeInteger(scopeOrdinal) || scopeOrdinal < 0 || !Number.isSafeInteger(scopeMemberOrdinal) || scopeMemberOrdinal < 0) {
      fail('P7_TRIAGE_RUN_SCOPE_ORDINAL_CORRUPT', 'Run member Scope ordinal is invalid.');
    }
    const key = String(scopeOrdinal);
    const scope = groups.get(key) || { scopeOrdinal, scopeKind:member.selection_scope_kind,
      scopeKey:member.selection_scope_key, scopeRootRelativeLocation:member.selection_scope_root_relative_location,
      memberCount:Number(member.selection_scope_member_count), memberSetDigest:member.selection_scope_member_set_digest,
      scopeDigest:member.selection_scope_digest, members:[] };
    if (scope.scopeKind !== member.selection_scope_kind || scope.scopeKey !== member.selection_scope_key ||
        scope.scopeRootRelativeLocation !== member.selection_scope_root_relative_location ||
        scope.memberCount !== Number(member.selection_scope_member_count) || scope.memberSetDigest !== member.selection_scope_member_set_digest ||
        scope.scopeDigest !== member.selection_scope_digest) {
      fail('P7_TRIAGE_RUN_SCOPE_ROW_CONFLICT', 'Run members disagree about their frozen Selection Scope.');
    }
    scope.members.push({ materialKey:member.material_key, fieldRelativeLocation:member.field_relative_location, scopeMemberOrdinal });
    groups.set(key, scope);
  }
  const scopes = [...groups.values()].sort((left, right) => left.scopeOrdinal - right.scopeOrdinal).map((scope, index) => {
    if (scope.scopeOrdinal !== index || scope.members.length !== scope.memberCount) {
      fail('P7_TRIAGE_RUN_SCOPE_COVERAGE_CORRUPT', 'Run Selection Scope coverage is incomplete.');
    }
    const orderedMembers = scope.members.sort((left, right) => left.scopeMemberOrdinal - right.scopeMemberOrdinal);
    if (orderedMembers.some((member, ordinal) => member.scopeMemberOrdinal !== ordinal)) {
      fail('P7_TRIAGE_RUN_SCOPE_MEMBER_ORDER_CORRUPT', 'Run Selection Scope member ordinals are not contiguous.');
    }
    const memberSetDigest = canonicalDigest({ schema:'procurement.selection-scope-members@1', items:orderedMembers });
    const scopeValue = { scopeOrdinal:scope.scopeOrdinal, scopeKind:scope.scopeKind, scopeKey:scope.scopeKey,
      scopeRootRelativeLocation:scope.scopeRootRelativeLocation, memberCount:scope.memberCount,
      memberSetDigest:scope.memberSetDigest, scopeDigest:scope.scopeDigest };
    const scopeDigest = canonicalDigest({ schema:'procurement.selection-scope@1', scopeKind:scope.scopeKind,
      scopeKey:scope.scopeKey, scopeRootRelativeLocation:scope.scopeRootRelativeLocation,
      memberCount:scope.memberCount, memberSetDigest:scope.memberSetDigest });
    if (scope.memberSetDigest !== memberSetDigest || scope.scopeDigest !== scopeDigest) {
      fail('P7_TRIAGE_RUN_SCOPE_DIGEST_CORRUPT', 'Run Selection Scope digest cannot be reconstructed.');
    }
    return Object.freeze(scopeValue);
  });
  if (scopes.length !== Number(run.selection_scope_count) ||
      canonicalDigest({ schema:'procurement.selection-scope-set@1', scopes }) !== run.selection_scope_set_digest) {
    fail('P7_TRIAGE_RUN_SCOPE_SET_CORRUPT', 'Run Selection Scope set digest cannot be reconstructed.');
  }
  return Object.freeze(scopes);
}

function definition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId:'procurement_run_triage_reader', owner:'procurement', schemaManifest, statements:{
    find_run:{ kind:'select-one', tableId:'proc_procurement_runs', safeIntegers:true,
      columns:['procurement_run_id','field_id','access_revision','access_digest','content_profile_hint','profile_hint_revision',
        'profile_hint_digest','run_basis_digest','triage_rule_ref','triage_rule_revision','triage_rule_digest',
        'triage_rule_authority_digest','terminal_observation_revision','field_observation_work_id','selected_material_count',
        'selection_scope_count','selection_scope_set_digest','state','state_revision',
        'candidate_package_revision_head','created_at_ms'], keyColumns:['procurement_run_id'] },
    find_access:{ kind:'select-one', tableId:'proc_field_access_revisions', safeIntegers:true,
      columns:['field_id','revision','endpoint_id','root_location','mount_scope_id','mount_scope_revision','access_digest'],
      keyColumns:['field_id','revision'] },
    list_members:{ kind:'select-all', tableId:'proc_run_materials', safeIntegers:true,
      columns:['procurement_run_id','ordinal','material_key','field_relative_location','selection_scope_kind','selection_scope_key',
        'selection_scope_root_relative_location','selection_scope_ordinal','scope_member_ordinal','selection_scope_member_count',
        'selection_scope_member_set_digest','selection_scope_digest','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint',
        'selection_role','binding_revision','eligibility_revision','eligibility_basis_digest','last_snapshot_digest','last_observation_id',
        'admitted_control_revision','admitted_control_projection_digest','selection_state','candidate_package_id','endpoint_id','location',
        'reality_digest','provenance_digest','expected_control_revision','expected_control_state','expected_control_owner_domain',
        'expected_control_owner_scope_type','expected_control_owner_scope_id','expected_control_region_projection',
        'expected_control_evidence_digest','expected_control_projection_digest','admission_control_action','basis_member_digest',
        'terminal_disposition','terminal_evidence_digest'],
      keyColumns:['procurement_run_id'] },
    list_candidates:{kind:'select-all',tableId:'proc_candidate_packages',safeIntegers:true,
      columns:['candidate_package_id','procurement_run_id','package_revision','manifest_digest','package_digest','state'],keyColumns:['procurement_run_id']},
    find_field_materials:{ kind:'select-in', tableId:'proc_field_materials', keyColumn:'material_key', fixedKeyColumns:['field_id'], maxItems:100, safeIntegers:true,
      columns:['field_id','material_key','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','endpoint_id','access_revision',
        'mount_scope_revision','mtime_ns','ctime_ns','fingerprint_verified_at_ms','current_location','binding_revision','reality_digest'] },
    page_observed_entries:{ kind:'select-page-after', tableId:'proc_field_observation_entries', keyColumn:'material_observation_id', fixedKeyColumns:['field_id','field_observation_work_id'], maxItems:500, safeIntegers:true,
      columns:['field_id','field_observation_work_id','observation_id','observation_revision','page_ordinal','entry_ordinal','material_observation_id','material_key','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','endpoint_id','access_revision','mount_scope_revision','current_location','relative_location','mtime_ns','ctime_ns','fingerprint_verified_at_ms','observed_at_ms','containment_digest','reality_digest','provenance_digest','snapshot_digest','entry_digest'] },
    page_observed_scope:{ kind:'select-range', tableId:'proc_field_observation_entries', keyColumn:'relative_location', fixedKeyColumns:['field_id','field_observation_work_id'], maxItems:500, safeIntegers:true,
      columns:['field_id','field_observation_work_id','observation_id','observation_revision','page_ordinal','entry_ordinal','material_observation_id','material_key','mount_scope_id','inode','size_bytes','fingerprint_algorithm','fingerprint_version','content_fingerprint','endpoint_id','access_revision','mount_scope_revision','current_location','relative_location','mtime_ns','ctime_ns','fingerprint_verified_at_ms','observed_at_ms','containment_digest','reality_digest','provenance_digest','snapshot_digest','entry_digest'] },
    page_runs_by_state:{kind:'select-page-after',tableId:'proc_procurement_runs',keyColumn:'procurement_run_id',fixedKeyColumns:['state'],
      maxItems:100,columns:['procurement_run_id','state']},
  }});
}

function createProcurementRunTriageReader(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.now !== 'function') {
    fail('P7_TRIAGE_READER_DEPENDENCIES', 'Procurement Triage reader requires Owner persistence and clock.');
  }
  const repository = definition(options.schemaManifest);
  const observedMaterialCache = new Map();
  const runMemberIndexCache = new Map();

  function readObservedMaterials(run) {
    const workId = run?.field_observation_work_id;
    if (!workId) return Object.freeze([]);
    const cached = observedMaterialCache.get(workId);
    if (cached) return cached;
    const rows = [];
    let cursor = null;
    const pageSize = 500;
    do {
      const page = options.unitOfWork.execute([{ participantId:'procurement_observation_entries_read', owner:'procurement', repositories:[repository],
        execute(context) {
          return context.repository(repository.repositoryId).invoke('page_observed_entries', {
            field_id: run.field_id,
            field_observation_work_id: workId,
            cursor,
            limit: pageSize
          });
        } }]).procurement_observation_entries_read;
      rows.push(...page);
      cursor = page.length === pageSize ? page[page.length - 1].material_observation_id : null;
      if (page.length < pageSize) break;
    } while (cursor);
    const byMaterialKey = new Map();
    for (const row of rows) {
      const identity = Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
        materialKey:row.material_key, mountScopeId:row.mount_scope_id, inode:String(row.inode), sizeBytes:Number(row.size_bytes),
        fingerprintAlgorithm:row.fingerprint_algorithm, fingerprintVersion:Number(row.fingerprint_version), contentFingerprint:row.content_fingerprint });
      const material = Object.freeze({ materialKey:row.material_key, identity, endpointId:row.endpoint_id, location:row.current_location,
        sizeBytes:Number(row.size_bytes), mtimeNs:String(row.mtime_ns), ctimeNs:String(row.ctime_ns), observationId:row.observation_id, fieldId:row.field_id,
        relativeLocation:row.relative_location, entryDigest:row.entry_digest });
      const prior = byMaterialKey.get(material.materialKey);
      if (prior && (prior.location !== material.location || prior.endpointId !== material.endpointId || prior.identity.contentFingerprint !== material.identity.contentFingerprint)) {
        fail('P7_TRIAGE_OBSERVATION_MATERIAL_CONFLICT', 'Observation entries contain conflicting Material Reality.', { fieldId:run.field_id, materialKey:material.materialKey });
      }
      byMaterialKey.set(material.materialKey, material);
    }
    const materials = Object.freeze([...byMaterialKey.values()].sort((left, right) =>
      locationKey(left.location).localeCompare(locationKey(right.location), 'en-US') ||
      Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey))));
    observedMaterialCache.set(workId, materials);
    return materials;
  }

  function readObservedMaterialsInScope(run, scopeLocation, recursive = false) {
    const workId = run?.field_observation_work_id;
    if (!workId) return Object.freeze([]);
    const scope = normalizedLocation(scopeLocation || '.');
    const cacheKey = workId + ':scope:' + (recursive ? 'tree:' : 'direct:') + scope;
    const cached = observedMaterialCache.get(cacheKey);
    if (cached) return cached;
    const rangeStart = scope === '.' ? '' : scope + '/';
    const rangeEnd = rangeStart + '\uffff';
    const rows = [];
    let cursor = null;
    const pageSize = 500;
    do {
      const page = options.unitOfWork.execute([{ participantId:'procurement_observation_scope_read', owner:'procurement', repositories:[repository],
        execute(context) {
          return context.repository(repository.repositoryId).invoke('page_observed_scope', {
            field_id:run.field_id, field_observation_work_id:workId,
            rangeStart, rangeEnd, cursor, limit:pageSize
          });
        } }]).procurement_observation_scope_read;
      rows.push(...page);
      cursor = page.length === pageSize ? page[page.length - 1].relative_location : null;
      if (page.length < pageSize) break;
    } while (cursor);
    const materials = Object.freeze(rows.filter((row) => recursive || parentLocation(row.relative_location) === scope).map((row) => {
      const identity = Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
        materialKey:row.material_key, mountScopeId:row.mount_scope_id, inode:String(row.inode), sizeBytes:Number(row.size_bytes),
        fingerprintAlgorithm:row.fingerprint_algorithm, fingerprintVersion:Number(row.fingerprint_version), contentFingerprint:row.content_fingerprint });
      return Object.freeze({ materialKey:row.material_key, identity, endpointId:row.endpoint_id, location:row.current_location,
        sizeBytes:Number(row.size_bytes), mtimeNs:String(row.mtime_ns), ctimeNs:String(row.ctime_ns), observationId:row.observation_id, fieldId:row.field_id,
        relativeLocation:row.relative_location, entryDigest:row.entry_digest });
    }).sort((left, right) => locationKey(left.location).localeCompare(locationKey(right.location), 'en-US') ||
      Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey))));
    observedMaterialCache.set(cacheKey, materials);
    return materials;
  }

  function readObservedMaterialsInScopes(run, requests) {
    const workId = run?.field_observation_work_id;
    if (!workId) return new Map();
    const normalizedRequests = [...new Map((Array.isArray(requests) ? requests : []).map((request) => {
      const scope = normalizedLocation(typeof request === 'string' ? request : request?.scopeLocation || '.');
      const recursive = typeof request === 'object' && request?.recursive === true;
      return [workId + ':scope:' + (recursive ? 'tree:' : 'direct:') + scope, { scope, recursive }];
    })).values()];
    const result = new Map();
    const pending = normalizedRequests.filter(({ scope, recursive }) => {
      const key = workId + ':scope:' + (recursive ? 'tree:' : 'direct:') + scope;
      const cached = observedMaterialCache.get(key);
      if (cached) result.set(key, cached);
      return !cached;
    });
    if (pending.length === 0) return result;
    const rowsByKey = new Map(pending.map(({ scope, recursive }) => {
      const key = workId + ':scope:' + (recursive ? 'tree:' : 'direct:') + scope;
      return [key, []];
    }));
    options.unitOfWork.execute([{ participantId:'procurement_observation_scope_batch_read', owner:'procurement', repositories:[repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const pageSize = 500;
        for (const { scope, recursive } of pending) {
          const key = workId + ':scope:' + (recursive ? 'tree:' : 'direct:') + scope;
          const rangeStart = scope === '.' ? '' : scope + '/';
          const rangeEnd = rangeStart + '\uffff';
          let cursor = null;
          do {
            const page = repo.invoke('page_observed_scope', { field_id:run.field_id, field_observation_work_id:workId,
              rangeStart, rangeEnd, cursor, limit:pageSize });
            rowsByKey.get(key).push(...page);
            cursor = page.length === pageSize ? page[page.length - 1].relative_location : null;
            if (page.length < pageSize) break;
          } while (cursor);
        }
      } }]);
    for (const { scope, recursive } of pending) {
      const key = workId + ':scope:' + (recursive ? 'tree:' : 'direct:') + scope;
      const materials = Object.freeze(rowsByKey.get(key).filter((row) => recursive || parentLocation(row.relative_location) === scope).map((row) => {
        const identity = Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
          materialKey:row.material_key, mountScopeId:row.mount_scope_id, inode:String(row.inode), sizeBytes:Number(row.size_bytes),
          fingerprintAlgorithm:row.fingerprint_algorithm, fingerprintVersion:Number(row.fingerprint_version), contentFingerprint:row.content_fingerprint });
        return Object.freeze({ materialKey:row.material_key, identity, endpointId:row.endpoint_id, location:row.current_location,
          sizeBytes:Number(row.size_bytes), mtimeNs:String(row.mtime_ns), ctimeNs:String(row.ctime_ns), observationId:row.observation_id, fieldId:row.field_id,
          relativeLocation:row.relative_location, entryDigest:row.entry_digest });
      }).sort((left, right) => locationKey(left.location).localeCompare(locationKey(right.location), 'en-US') ||
        Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey))));
      observedMaterialCache.set(key, materials);
      result.set(key, materials);
    }
    return result;
  }

  return Object.freeze({
    readRunHeader(runId) {
      if (typeof runId !== 'string' || !runId) fail('P7_TRIAGE_RUN_ID', 'Procurement Run id is required.');
      return options.unitOfWork.execute([{ participantId:'procurement_run_header_read', owner:'procurement', repositories:[repository],
        execute(context) {
          const repo=context.repository(repository.repositoryId);
          const run=repo.invoke('find_run',{ procurement_run_id:runId });
          return run ? Object.freeze(run) : null;
        } }]).procurement_run_header_read;
    },
    listCandidatePackages(runId) {
      if (typeof runId !== 'string' || !runId) fail('P7_TRIAGE_RUN_ID', 'Procurement Run id is required.');
      return options.unitOfWork.execute([{ participantId:'procurement_candidate_packages_read', owner:'procurement', repositories:[repository],
        execute(context) {
          return Object.freeze(context.repository(repository.repositoryId).invoke('list_candidates',{procurement_run_id:runId})
            .sort((a,b)=>Buffer.compare(Buffer.from(a.candidate_package_id),Buffer.from(b.candidate_package_id)))
            .map((candidate)=>Object.freeze(candidate)));
        } }]).procurement_candidate_packages_read;
    },
    listActiveRunPage(cursor=null,limit=100){
      if((cursor!==null&&typeof cursor!=='string')||!Number.isSafeInteger(limit)||limit<1||limit>100){
        fail('P7_TRIAGE_ACTIVE_RUN_LIMIT_INVALID', 'Active Run reconcile limit is invalid.');
      }
      let decoded={state:'active',runId:null};
      if(cursor!==null){try{decoded=JSON.parse(cursor);}catch{fail('P7_TRIAGE_ACTIVE_RUN_CURSOR_INVALID','Active Run cursor is invalid.');}}
      if(!decoded||!['active','waiting'].includes(decoded.state)||(decoded.runId!==null&&typeof decoded.runId!=='string')){
        fail('P7_TRIAGE_ACTIVE_RUN_CURSOR_INVALID','Active Run cursor is invalid.');
      }
      return options.unitOfWork.execute([{participantId:'procurement_active_run_page',owner:'procurement',repositories:[repository],
        execute(context){const repo=context.repository(repository.repositoryId);const rows=[];let state=decoded.state,after=decoded.runId;
          while(rows.length<limit){const remaining=limit-rows.length;const selected=repo.invoke('page_runs_by_state',{state,cursor:after,limit:remaining});rows.push(...selected);
            if(selected.length===remaining)break;
            if(state==='active'){state='waiting';after=null;continue;}break;
          }
          return Object.freeze(rows.map((row)=>Object.freeze({scope:Object.freeze({procurementRunId:row.procurement_run_id}),
            cursor:JSON.stringify({state:row.state,runId:row.procurement_run_id})})));}
      }]).procurement_active_run_page;
    },
    listActiveRunIds(limit=16){return this.listActiveRunPage(null,Math.min(limit,100)).map((item)=>item.scope.procurementRunId);},
    listObservedMaterials(runId) {
      const run = this.readRunHeader(runId);
      return readObservedMaterials(run);
    },
    listObservedMaterialsInScope(runId, scopeLocation, options = {}) {
      const run = this.readRunHeader(runId);
      return readObservedMaterialsInScope(run, scopeLocation, options?.recursive === true);
    },
    listObservedMaterialsInScopes(runId, requests) {
      const run = this.readRunHeader(runId);
      const values = readObservedMaterialsInScopes(run, requests);
      return Object.freeze([...values.values()].flat());
    },
    clearObservedMaterialCache() { observedMaterialCache.clear(); },
    readRunBasis(runId) {
      if (typeof runId !== 'string' || !runId) fail('P7_TRIAGE_RUN_ID', 'Procurement Run id is required.');
      return options.unitOfWork.execute([{ participantId:'procurement_run_basis_read', owner:'procurement', repositories:[repository],
        execute(context) {
          const repo=context.repository(repository.repositoryId);
          const run=repo.invoke('find_run',{ procurement_run_id:runId });
          if (!run) return null;
          const access=repo.invoke('find_access',{ field_id:run.field_id, revision:Number(run.access_revision) });
          const members=repo.invoke('list_members',{ procurement_run_id:runId }).sort((a,b)=>Number(a.ordinal)-Number(b.ordinal));
          if (!access || access.access_digest !== run.access_digest || members.length < 1 || members.length > MAX_RUN_PHYSICAL_MEMBERS) {
            fail('P7_TRIAGE_RUN_BASIS_CORRUPT', 'Run cannot reconstruct its exact admitted Triage basis.');
          }
          const selectionScopes=validatePersistedScopeBasis(run,members);
          return Object.freeze({ run:Object.freeze(run), access:Object.freeze(access),
            selectionScopes, members:Object.freeze(members.map((member)=>Object.freeze(member))) });
        } }]).procurement_run_basis_read;
    },
    read(runId) {
      return options.unitOfWork.execute([{ participantId:'procurement_run_triage_snapshot', owner:'procurement', repositories:[repository],
        execute(context) {
          const repo=context.repository(repository.repositoryId);
          const run=repo.invoke('find_run',{ procurement_run_id:runId });
          if (!run) return null;
          const access=repo.invoke('find_access',{ field_id:run.field_id, revision:Number(run.access_revision) });
          const members=repo.invoke('list_members',{ procurement_run_id:runId }).sort((a,b)=>Number(a.ordinal)-Number(b.ordinal));
          const candidates=repo.invoke('list_candidates',{procurement_run_id:runId}).sort((a,b)=>Buffer.compare(Buffer.from(a.candidate_package_id),Buffer.from(b.candidate_package_id)));
          if (!access || access.access_digest !== run.access_digest || members.length < 1 || members.length > MAX_RUN_PHYSICAL_MEMBERS) {
            fail('P7_TRIAGE_RUN_BASIS_CORRUPT', 'Run cannot reconstruct its exact admitted Triage basis.');
          }
          const selectionScopes=validatePersistedScopeBasis(run,members);
          const currentRows=[];
          for(let offset=0;offset<members.length;offset+=100){
            currentRows.push(...repo.invoke('find_field_materials',{field_id:run.field_id,
              values:members.slice(offset,offset+100).map((member)=>member.material_key)}));
          }
          const current=new Map(currentRows.map((row)=>[row.material_key,row]));
          const materialContexts=members.map((member) => {
            const row=current.get(member.material_key);
            if (!row || row.mount_scope_id !== member.mount_scope_id || String(row.inode) !== String(member.inode) ||
                row.fingerprint_algorithm !== member.fingerprint_algorithm || Number(row.fingerprint_version) !== Number(member.fingerprint_version) ||
                row.content_fingerprint !== member.content_fingerprint ||
                Number(row.size_bytes) !== Number(member.size_bytes) || Number(row.binding_revision) !== Number(member.binding_revision) ||
                row.endpoint_id !== member.endpoint_id || row.current_location !== member.location ||
                Number(row.access_revision) !== Number(run.access_revision)) {
              fail('P7_TRIAGE_MATERIAL_FENCE_STALE', 'Current Field Material no longer matches immutable Run Selection.', { materialKey:member.material_key });
            }
            const identity=Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
              materialKey:member.material_key, mountScopeId:member.mount_scope_id, inode:String(member.inode), sizeBytes:Number(member.size_bytes),
              fingerprintAlgorithm:member.fingerprint_algorithm, fingerprintVersion:Number(member.fingerprint_version), contentFingerprint:member.content_fingerprint });
            const handleBasis={ identity, ownerDomain:'procurement', ownerScope:{ scopeType:'procurement_run', scopeId:runId },
              bindingRevision:Number(member.binding_revision), endpointId:member.endpoint_id, location:member.location,
              mountScopeRevision:Number(row.mount_scope_revision), expectedSizeBytes:Number(row.size_bytes),
              expectedMtimeNs:Number(row.mtime_ns), expectedCtimeNs:Number(row.ctime_ns),
              fingerprintVerifiedAtMs:Number(row.fingerprint_verified_at_ms), readScope:'bounded_read', expiresAtMs:Number(run.created_at_ms)+604_800_000 };
            const readHandle=Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', schemaVersion:1,
              handleId:'procurement-read-handle-' + canonicalDigest({ runId, materialKey:member.material_key,
                bindingRevision:Number(member.binding_revision), realityDigest:row.reality_digest }).slice(0,40),
              ...handleBasis, fenceDigest:canonicalDigest({ schema:'procurement.physical-read-fence@1', ...handleBasis }) });
            return Object.freeze({ member:Object.freeze(member), current:Object.freeze(row), identity, readHandle });
          });
          return Object.freeze({ run:Object.freeze(run), access:Object.freeze(access), selectionScopes,
            materials:Object.freeze(materialContexts),
            candidates:Object.freeze(candidates.map((candidate)=>Object.freeze(candidate))) });
        } }]).procurement_run_triage_snapshot;
    },
    readCandidate(runId, materialKeys, basis = null) {
      if (!Array.isArray(materialKeys) || materialKeys.length < 1 || materialKeys.length > MAX_RUN_PHYSICAL_MEMBERS ||
          materialKeys.some((key) => typeof key !== 'string') || new Set(materialKeys).size !== materialKeys.length) {
        fail('P7_TRIAGE_CANDIDATE_MEMBER_KEYS', 'Candidate Material keys must be a unique bounded set.');
      }
      return options.unitOfWork.execute([{ participantId:'procurement_candidate_context', owner:'procurement', repositories:[repository],
        execute(context) {
          const repo=context.repository(repository.repositoryId);
          const run=basis?.run || repo.invoke('find_run',{ procurement_run_id:runId });
          if (!run) return null;
          const access=basis?.access || repo.invoke('find_access',{ field_id:run.field_id, revision:Number(run.access_revision) });
          const members=basis?.members || repo.invoke('list_members',{ procurement_run_id:runId }).sort((a,b)=>Number(a.ordinal)-Number(b.ordinal));
          if (!access || access.access_digest !== run.access_digest || members.length < 1 || members.length > MAX_RUN_PHYSICAL_MEMBERS) {
            fail('P7_TRIAGE_RUN_BASIS_CORRUPT', 'Run cannot reconstruct its exact admitted Triage basis.');
          }
          const selectionScopes=basis?.selectionScopes || validatePersistedScopeBasis(run,members);
          const memberIndexKey=runId+'\0'+run.run_basis_digest;
          let memberMap=runMemberIndexCache.get(memberIndexKey);
          if(!memberMap){
            memberMap=new Map(members.map((member)=>[member.material_key,member]));
            runMemberIndexCache.set(memberIndexKey,memberMap);
          }
          const selectedMembers=materialKeys.map((key)=>memberMap.get(key));
          if (selectedMembers.some((member)=>!member)) {
            fail('P7_TRIAGE_CANDIDATE_MEMBER_MISSING', 'Candidate Unit references a Material outside the admitted Run Selection.');
          }
          const currentRows=[];
          for(let offset=0;offset<materialKeys.length;offset+=100){
            currentRows.push(...repo.invoke('find_field_materials',{field_id:run.field_id,values:materialKeys.slice(offset,offset+100)}));
          }
          const current=new Map(currentRows.map((row)=>[row.material_key,row]));
          function contextFor(member) {
            const row=current.get(member.material_key);
            if (!row || row.mount_scope_id !== member.mount_scope_id || String(row.inode) !== String(member.inode) ||
                row.fingerprint_algorithm !== member.fingerprint_algorithm || Number(row.fingerprint_version) !== Number(member.fingerprint_version) ||
                row.content_fingerprint !== member.content_fingerprint || Number(row.size_bytes) !== Number(member.size_bytes) ||
                Number(row.binding_revision) !== Number(member.binding_revision) || row.endpoint_id !== member.endpoint_id ||
                row.current_location !== member.location || Number(row.access_revision) !== Number(run.access_revision)) {
              fail('P7_TRIAGE_MATERIAL_FENCE_STALE', 'Current Candidate Material no longer matches immutable Run Selection.', { materialKey:member.material_key });
            }
            const identity=identityFromMember(member);
            const handleBasis={ identity, ownerDomain:'procurement', ownerScope:{ scopeType:'procurement_run', scopeId:runId },
              bindingRevision:Number(member.binding_revision), endpointId:member.endpoint_id, location:member.location,
              mountScopeRevision:Number(row.mount_scope_revision), expectedSizeBytes:Number(row.size_bytes),
              expectedMtimeNs:Number(row.mtime_ns), expectedCtimeNs:Number(row.ctime_ns),
              fingerprintVerifiedAtMs:Number(row.fingerprint_verified_at_ms), readScope:'bounded_read', expiresAtMs:Number(run.created_at_ms)+604_800_000 };
            const readHandle=Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', schemaVersion:1,
              handleId:'procurement-read-handle-' + canonicalDigest({ runId, materialKey:member.material_key,
                bindingRevision:Number(member.binding_revision), realityDigest:row.reality_digest }).slice(0,40),
              ...handleBasis, fenceDigest:canonicalDigest({ schema:'procurement.physical-read-fence@1', ...handleBasis }) });
            return Object.freeze({ member:Object.freeze(member), current:Object.freeze(row), identity, readHandle });
          }
          return Object.freeze({ run:Object.freeze(run), access:Object.freeze(access), selectionScopes,
            ...(basis ? {} : { runMembers:Object.freeze(members.map((member)=>Object.freeze(member))) }),
            candidateMaterials:Object.freeze(selectedMembers.map(contextFor)) });
        } }]).procurement_candidate_context;
    },
  });
}

module.exports=Object.freeze({ ProcurementRunTriageReaderError, createProcurementRunTriageReader, validatePersistedScopeBasis });
