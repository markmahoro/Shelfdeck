'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { POLICY_ID, defaultPolicy, normalizePolicy, highVolumeDecision, stable } = require('../model/offdeck-contract');

class OffdeckStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'OffdeckStoreError'; this.code = code; }
}
const fail = (code, message) => { throw new OffdeckStoreError(code, message); };
const number = (value) => value === null || value === undefined ? null : Number(value);
const candidateProjection = (row) => Object.freeze({ ...row,
  policy_revision:Number(row.policy_revision), created_at_ms:Number(row.created_at_ms) });
const duplicateMemberProjection = (row) => Object.freeze({ ...row,
  inventory_revision:Number(row.inventory_revision) });
const duplicateGroupProjection = (row, members) => Object.freeze({ ...row,
  detected_at_ms:Number(row.detected_at_ms), superseded_at_ms:number(row.superseded_at_ms),
  members:Object.freeze(members.map(duplicateMemberProjection)) });
const suppressionProjection = (row) => Object.freeze({ ...row,
  policy_revision:Number(row.policy_revision), effective_at_ms:Number(row.effective_at_ms),
  expires_at_ms:number(row.expires_at_ms), revoked_at_ms:number(row.revoked_at_ms) });
const whitelistProjection = (row) => Object.freeze({ ...row,
  created_at_ms:Number(row.created_at_ms), revoked_at_ms:number(row.revoked_at_ms) });
function normalizedAbsoluteLocation(value) {
  const raw=String(value||'').replace(/\\/g,'/').replace(/\/+/g,'/');
  const drive=/^[A-Za-z]:\//.test(raw)?raw.slice(0,3):null;
  const absoluteRoot=drive||(raw.startsWith('/')?'/':null);
  if(!absoluteRoot)fail('ARCA_OFFDECK_SCOPE_CONTAINMENT_INVALID','Off-deck material location must be absolute.');
  const body=drive?raw.slice(3):raw.slice(1),parts=[];
  for(const part of body.split('/')){if(!part||part==='.')continue;if(part==='..'){if(parts.length===0)fail('ARCA_OFFDECK_SCOPE_CONTAINMENT_INVALID','Off-deck material escaped its Shelf Target.');parts.pop();}else parts.push(part);}
  return (drive||'/')+parts.join('/');
}
function locationComparisonKey(value){const normalized=normalizedAbsoluteLocation(value);return /^[A-Za-z]:\//.test(normalized)?normalized.toLowerCase():normalized;}
function relativeToShelfRoot(rootValue,locationValue){const root=normalizedAbsoluteLocation(rootValue).replace(/\/$/,'');const location=normalizedAbsoluteLocation(locationValue),rootKey=locationComparisonKey(root),locationKey=locationComparisonKey(location);if(locationKey===rootKey)return '';if(!locationKey.startsWith(rootKey+'/'))fail('ARCA_OFFDECK_SCOPE_CONTAINMENT_INVALID','Off-deck material escaped its Shelf Target.');return location.slice(root.length+1);}

function createOffdeckStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) throw new TypeError('Off-deck Store requires clean persistence dependencies.');
  const now = options.now || Date.now;
  const repo = createRepositoryDefinition({ repositoryId:'arca_offdeck_store', owner:'arca', schemaManifest:options.schemaManifest, statements:{
    find_policy_head:{kind:'select-one',tableId:'arca_offdeck_policy_heads',columns:['policy_id','current_revision','status','updated_at_ms'],keyColumns:['policy_id'],safeIntegers:true},
    find_policy_revision:{kind:'select-one',tableId:'arca_offdeck_policy_revisions',columns:['policy_id','revision','condition_group_schema_ref','condition_group_json','policy_digest','effective_at_ms'],keyColumns:['policy_id','revision'],safeIntegers:true},
    insert_policy_revision:{kind:'insert',tableId:'arca_offdeck_policy_revisions',columns:['policy_id','revision','condition_group_schema_ref','condition_group_json','policy_digest','effective_at_ms']},
    insert_policy_head:{kind:'insert',tableId:'arca_offdeck_policy_heads',columns:['policy_id','current_revision','status','updated_at_ms']},
    advance_policy_head:{kind:'update',tableId:'arca_offdeck_policy_heads',setColumns:['current_revision','status','updated_at_ms'],keyColumns:['policy_id'],compareColumns:[{column:'current_revision',parameter:'expected_current_revision'}]},
    list_entries:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
    find_entry:{kind:'select-one',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    list_shelves:{kind:'select-all',tableId:'arca_shelves',columns:['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','created_at_ms','updated_at_ms'],keyColumns:[],safeIntegers:true},
    find_shelf:{kind:'select-one',tableId:'arca_shelves',columns:['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','created_at_ms','updated_at_ms'],keyColumns:['shelf_id'],safeIntegers:true},
    list_materials:{kind:'select-all',tableId:'arca_inventory_materials',columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','endpoint_id','location','binding_revision','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','digest_hex','size_bytes'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
    clear_inventory_guards:{kind:'update',tableId:'arca_inventory_materials',setColumns:['active_guard'],keyColumns:['shelf_entry_id','inventory_revision']},
    list_all_materials:{kind:'select-all',tableId:'arca_inventory_materials',columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','endpoint_id','location','binding_revision','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint','digest_hex','size_bytes','active_guard'],keyColumns:[],safeIntegers:true},
    list_related:{kind:'select-all',tableId:'arca_inventory_related_references',columns:['shelf_entry_id','inventory_revision','reference_id','primary_ordinal','role','reference_kind','material_identity_hint','endpoint_id','location','checksum_hex'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
    list_all_related:{kind:'select-all',tableId:'arca_inventory_related_references',columns:['shelf_entry_id','inventory_revision','reference_id','primary_ordinal','role','reference_kind','material_identity_hint','endpoint_id','location','checksum_hex'],keyColumns:[],safeIntegers:true},
    list_identities:{kind:'select-all',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','structure_kind','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],keyColumns:[],safeIntegers:true},
    list_aftercare_cases:{kind:'select-all',tableId:'arca_aftercare_cases',columns:['aftercare_case_id','shelf_entry_id','state','created_at_ms','terminal_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    list_candidates:{kind:'select-all',tableId:'arca_offdeck_review_candidates',columns:['candidate_id','candidate_kind','shelf_entry_id','duplicate_group_id','target_digest','policy_id','policy_revision','condition_evidence_schema_ref','condition_evidence_json','condition_evidence_digest','reason_digest','state','created_at_ms'],keyColumns:[],safeIntegers:true},
    insert_candidate:{kind:'insert',tableId:'arca_offdeck_review_candidates',columns:['candidate_id','candidate_kind','shelf_entry_id','duplicate_group_id','target_digest','policy_id','policy_revision','condition_evidence_schema_ref','condition_evidence_json','condition_evidence_digest','reason_digest','state','created_at_ms']},
    update_candidate:{kind:'update',tableId:'arca_offdeck_review_candidates',setColumns:['state'],keyColumns:['candidate_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_duplicate_groups:{kind:'select-all',tableId:'arca_offdeck_duplicate_groups',columns:['duplicate_group_id','canonical_identity_digest','member_set_digest','state','detected_at_ms','superseded_at_ms'],keyColumns:[],safeIntegers:true},
    insert_duplicate_group:{kind:'insert',tableId:'arca_offdeck_duplicate_groups',columns:['duplicate_group_id','canonical_identity_digest','member_set_digest','state','detected_at_ms','superseded_at_ms']},
    update_duplicate_group:{kind:'update',tableId:'arca_offdeck_duplicate_groups',setColumns:['state','superseded_at_ms'],keyColumns:['duplicate_group_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_duplicate_members:{kind:'select-all',tableId:'arca_offdeck_duplicate_group_members',columns:['duplicate_group_id','shelf_entry_id','inventory_revision','member_digest'],keyColumns:[]},
    insert_duplicate_member:{kind:'insert',tableId:'arca_offdeck_duplicate_group_members',columns:['duplicate_group_id','shelf_entry_id','inventory_revision','member_digest']},
    list_suppressions:{kind:'select-all',tableId:'arca_offdeck_suppressions',columns:['suppression_id','shelf_entry_id','candidate_kind','policy_id','policy_revision','reason_digest','state','effective_at_ms','expires_at_ms','revoked_at_ms'],keyColumns:[],safeIntegers:true},
    insert_suppression:{kind:'insert',tableId:'arca_offdeck_suppressions',columns:['suppression_id','shelf_entry_id','candidate_kind','policy_id','policy_revision','reason_digest','state','effective_at_ms','expires_at_ms','revoked_at_ms']},
    update_suppression:{kind:'update',tableId:'arca_offdeck_suppressions',setColumns:['state','revoked_at_ms'],keyColumns:['suppression_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_whitelists:{kind:'select-all',tableId:'arca_offdeck_duplicate_whitelists',columns:['whitelist_id','duplicate_group_id','member_set_digest','state','actor_id','created_at_ms','revoked_at_ms'],keyColumns:[],safeIntegers:true},
    insert_whitelist:{kind:'insert',tableId:'arca_offdeck_duplicate_whitelists',columns:['whitelist_id','duplicate_group_id','member_set_digest','state','actor_id','created_at_ms','revoked_at_ms']},
    update_whitelist:{kind:'update',tableId:'arca_offdeck_duplicate_whitelists',setColumns:['state','revoked_at_ms'],keyColumns:['whitelist_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_reviews:{kind:'select-all',tableId:'arca_offdeck_reviews',columns:['review_id','origin_kind','origin_ref','state','actor_id','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
    find_review:{kind:'select-one',tableId:'arca_offdeck_reviews',columns:['review_id','origin_kind','origin_ref','state','actor_id','created_at_ms','terminal_at_ms'],keyColumns:['review_id'],safeIntegers:true},
    insert_review:{kind:'insert',tableId:'arca_offdeck_reviews',columns:['review_id','origin_kind','origin_ref','state','actor_id','created_at_ms','terminal_at_ms']},
    update_review:{kind:'update',tableId:'arca_offdeck_reviews',setColumns:['state','terminal_at_ms'],keyColumns:['review_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_reservations:{kind:'select-all',tableId:'arca_offdeck_reservations',columns:['reservation_id','review_id','shelf_entry_id','inventory_revision','control_scope_digest','state','created_at_ms','released_at_ms'],keyColumns:[],safeIntegers:true},
    insert_reservation:{kind:'insert',tableId:'arca_offdeck_reservations',columns:['reservation_id','review_id','shelf_entry_id','inventory_revision','control_scope_digest','state','created_at_ms','released_at_ms']},
    update_reservation:{kind:'update',tableId:'arca_offdeck_reservations',setColumns:['state','released_at_ms'],keyColumns:['reservation_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_scopes:{kind:'select-all',tableId:'arca_offdeck_scopes',columns:['destruction_scope_id','reservation_id','shelf_entry_id','inventory_revision','member_count','scope_digest','state','created_at_ms'],keyColumns:[],safeIntegers:true},
    find_scope:{kind:'select-one',tableId:'arca_offdeck_scopes',columns:['destruction_scope_id','reservation_id','shelf_entry_id','inventory_revision','member_count','scope_digest','state','created_at_ms'],keyColumns:['destruction_scope_id'],safeIntegers:true},
    insert_scope:{kind:'insert',tableId:'arca_offdeck_scopes',columns:['destruction_scope_id','reservation_id','shelf_entry_id','inventory_revision','member_count','scope_digest','state','created_at_ms']},
    update_scope:{kind:'update',tableId:'arca_offdeck_scopes',setColumns:['state'],keyColumns:['destruction_scope_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_scope_materials:{kind:'select-all',tableId:'arca_offdeck_scope_materials',columns:['destruction_scope_id','ordinal','material_key','material_role','physical_identity_schema_ref','physical_identity_json','physical_identity_digest','endpoint_id','endpoint_relative_location','size_bytes','related_reference_id','binding_revision','control_revision','control_projection_digest','delete_condition','member_digest'],keyColumns:['destruction_scope_id'],safeIntegers:true},
    insert_scope_material:{kind:'insert',tableId:'arca_offdeck_scope_materials',columns:['destruction_scope_id','ordinal','material_key','material_role','physical_identity_schema_ref','physical_identity_json','physical_identity_digest','endpoint_id','endpoint_relative_location','size_bytes','related_reference_id','binding_revision','control_revision','control_projection_digest','delete_condition','member_digest']},
    find_selection:{kind:'select-one',tableId:'arca_offdeck_selection_receipts',columns:['selection_receipt_id','review_id','scope_set_digest','entry_count','primary_count','total_bytes','shelf_coverage_digest','deck_coverage_ratio','high_volume','actor_id','confirmed_at_ms'],keyColumns:['review_id'],safeIntegers:true},
    insert_selection:{kind:'insert',tableId:'arca_offdeck_selection_receipts',columns:['selection_receipt_id','review_id','scope_set_digest','entry_count','primary_count','total_bytes','shelf_coverage_digest','deck_coverage_ratio','high_volume','actor_id','confirmed_at_ms']},
    find_escalation:{kind:'select-one',tableId:'arca_offdeck_escalation_receipts',columns:['escalation_receipt_id','selection_receipt_id','scope_set_digest','actor_id','confirmed_at_ms'],keyColumns:['selection_receipt_id'],safeIntegers:true},
    insert_escalation:{kind:'insert',tableId:'arca_offdeck_escalation_receipts',columns:['escalation_receipt_id','selection_receipt_id','scope_set_digest','actor_id','confirmed_at_ms']},
    find_batch:{kind:'select-one',tableId:'arca_offdeck_authorization_batches',columns:['batch_id','review_id','selection_receipt_id','escalation_receipt_id','scope_set_digest','actor_id','authorized_at_ms'],keyColumns:['review_id','scope_set_digest'],safeIntegers:true},
    insert_batch:{kind:'insert',tableId:'arca_offdeck_authorization_batches',columns:['batch_id','review_id','selection_receipt_id','escalation_receipt_id','scope_set_digest','actor_id','authorized_at_ms']},
    list_authorizations:{kind:'select-all',tableId:'arca_offdeck_authorizations',columns:['authorization_id','destruction_scope_id','scope_digest','actor_id','batch_id','authorized_at_ms','state'],keyColumns:[],safeIntegers:true},
    insert_authorization:{kind:'insert',tableId:'arca_offdeck_authorizations',columns:['authorization_id','destruction_scope_id','scope_digest','actor_id','batch_id','authorized_at_ms','state']},
    update_authorization:{kind:'update',tableId:'arca_offdeck_authorizations',setColumns:['state'],keyColumns:['authorization_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    list_cases:{kind:'select-all',tableId:'arca_offdeck_cases',columns:['offdeck_case_id','initial_authorization_id','current_authorization_id','shelf_entry_id','origin_kind','origin_ref','state','recovery_revision','retry_at_ms','blocked_reason','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
    find_case:{kind:'select-one',tableId:'arca_offdeck_cases',columns:['offdeck_case_id','initial_authorization_id','current_authorization_id','shelf_entry_id','origin_kind','origin_ref','state','recovery_revision','retry_at_ms','blocked_reason','created_at_ms','terminal_at_ms'],keyColumns:['offdeck_case_id'],safeIntegers:true},
    insert_case:{kind:'insert',tableId:'arca_offdeck_cases',columns:['offdeck_case_id','initial_authorization_id','current_authorization_id','shelf_entry_id','origin_kind','origin_ref','state','recovery_revision','retry_at_ms','blocked_reason','created_at_ms','terminal_at_ms']},
    update_case:{kind:'update',tableId:'arca_offdeck_cases',setColumns:['current_authorization_id','state','recovery_revision','retry_at_ms','blocked_reason','terminal_at_ms'],keyColumns:['offdeck_case_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    mark_entry:{kind:'update',tableId:'arca_shelf_entries',setColumns:['status'],keyColumns:['shelf_entry_id'],compareColumns:[{column:'status',parameter:'expected_status'}]},
    list_evidence:{kind:'select-all',tableId:'arca_offdeck_deletion_evidence',columns:['destruction_scope_id','material_key','effect_id','result','reality_digest','reference_release_result_digest','completed_at_ms'],keyColumns:['destruction_scope_id'],safeIntegers:true},
    insert_evidence:{kind:'insert',tableId:'arca_offdeck_deletion_evidence',columns:['destruction_scope_id','material_key','effect_id','result','reality_digest','reference_release_result_digest','completed_at_ms']},
    insert_deck_fact:{kind:'insert',tableId:'arca_deck_fact_revisions',columns:['shelf_entry_id','revision','state','inventory_revision','standard_revision','fact_digest','committed_at_ms']},
    advance_entry_terminal:{kind:'update',tableId:'arca_shelf_entries',setColumns:['status','current_deck_fact_revision','terminal_at_ms'],keyColumns:['shelf_entry_id'],compareColumns:[{column:'current_deck_fact_revision',parameter:'expected_current_deck_fact_revision'}]},
    insert_terminal:{kind:'insert',tableId:'arca_offdeck_terminal_receipts',columns:['receipt_id','offdeck_case_id','shelf_entry_id','terminal_deck_fact_revision','released_control_set_digest','committed_at_ms']},
    find_terminal:{kind:'select-one',tableId:'arca_offdeck_terminal_receipts',columns:['receipt_id','offdeck_case_id','shelf_entry_id','terminal_deck_fact_revision','released_control_set_digest','committed_at_ms'],keyColumns:['offdeck_case_id'],safeIntegers:true},
  }});

  const read = (fn) => options.unitOfWork.execute([{participantId:'arca_offdeck_read',owner:'arca',repositories:[repo],execute:fn}]).arca_offdeck_read;
  const write = (id, fn) => options.unitOfWork.execute([{participantId:id,owner:'arca',repositories:[repo],execute:fn}])[id];
  const parse = (value, code) => { try { return JSON.parse(value); } catch { fail(code, 'Stored Off-deck JSON is corrupt.'); } };

  function currentPolicy() {
    return read((ctx) => {
      const r = ctx.repository(repo.repositoryId);
      let head = r.invoke('find_policy_head', { policy_id:'arca-offdeck-system-policy' });
      if (!head) return null;
      const revision = r.invoke('find_policy_revision', { policy_id:head.policy_id, revision:Number(head.current_revision) });
      const value = parse(revision.condition_group_json, 'ARCA_OFFDECK_POLICY_CORRUPT');
      return Object.freeze({ ...value, status:head.status, revision:Number(head.current_revision), policyDigest:revision.policy_digest });
    });
  }

  function ensurePolicy() {
    const existing = currentPolicy();
    if (existing) return existing;
    const value = defaultPolicy(now());
    return write('arca_offdeck_policy_initialize', (ctx) => {
      const r = ctx.repository(repo.repositoryId);
      const found = r.invoke('find_policy_head', { policy_id:value.policyId });
      if (found) {
        const revision = r.invoke('find_policy_revision', { policy_id:found.policy_id, revision:Number(found.current_revision) });
        const stored = parse(revision.condition_group_json, 'ARCA_OFFDECK_POLICY_CORRUPT');
        return Object.freeze({ ...stored, status:found.status, revision:Number(found.current_revision), policyDigest:revision.policy_digest });
      }
      r.invoke('insert_policy_revision', { policy_id:value.policyId, revision:1, condition_group_schema_ref:value.schemaRef,
        condition_group_json:canonicalJson(value), policy_digest:value.policyDigest, effective_at_ms:value.effectiveAtMs });
      r.invoke('insert_policy_head', { policy_id:value.policyId, current_revision:1, status:'disabled', updated_at_ms:value.effectiveAtMs });
      return value;
    });
  }

  function publishPolicy(input) {
    const current = ensurePolicy();
    const value = normalizePolicy(input, current, now());
    return write('arca_offdeck_policy_publish', (ctx) => {
      const r = ctx.repository(repo.repositoryId);
      const head = r.invoke('find_policy_head', { policy_id:current.policyId });
      if (!head || Number(head.current_revision) !== current.revision) fail('ARCA_OFFDECK_POLICY_STALE', 'Off-deck Policy changed concurrently.');
      r.invoke('insert_policy_revision', { policy_id:value.policyId, revision:value.revision, condition_group_schema_ref:value.schemaRef,
        condition_group_json:canonicalJson(value), policy_digest:value.policyDigest, effective_at_ms:value.effectiveAtMs });
      if (r.invoke('advance_policy_head', { current_revision:value.revision, status:value.status, updated_at_ms:value.effectiveAtMs,
         policy_id:value.policyId, expected_current_revision:current.revision }).changes !== 1) fail('ARCA_OFFDECK_POLICY_STALE', 'Off-deck Policy changed concurrently.');
      for (const candidate of r.invoke('list_candidates', {}).filter((item) =>
        item.candidate_kind === 'entry' && item.state === 'open' && Number(item.policy_revision) !== value.revision)) {
        r.invoke('update_candidate', { state:'stale', candidate_id:candidate.candidate_id, expected_state:'open' });
      }
      return value;
    });
  }

  function entrySnapshot(shelfEntryId) {
    return read((ctx) => {
      const r = ctx.repository(repo.repositoryId), entry = r.invoke('find_entry', { shelf_entry_id:shelfEntryId });
      if (!entry) return null;
      const shelf = r.invoke('find_shelf', { shelf_id:entry.shelf_id });
      const materials = r.invoke('list_materials', { shelf_entry_id:shelfEntryId, inventory_revision:Number(entry.current_inventory_revision) });
      const related = r.invoke('list_related', { shelf_entry_id:shelfEntryId, inventory_revision:Number(entry.current_inventory_revision) });
      const activeCare = r.invoke('list_aftercare_cases', { shelf_entry_id:shelfEntryId }).some((item) => item.terminal_at_ms === null);
      return Object.freeze({ entry:Object.freeze(entry), shelf:Object.freeze(shelf), materials:Object.freeze(materials), related:Object.freeze(related), activeCare });
    });
  }

  function allEntryFacts() {
    return read((ctx) => {
      const r = ctx.repository(repo.repositoryId), identities = new Map(r.invoke('list_identities', {}).map((item) => [item.shelf_entry_id + ':' + item.revision, item]));
      return Object.freeze(r.invoke('list_entries', {}).filter((entry) => entry.status === 'active').map((entry) => Object.freeze({
        ...entry,
        identity: identities.get(entry.shelf_entry_id + ':' + entry.canonical_identity_revision) || null,
      })));
    });
  }

  function commitDuplicateGroups(groups, scopeIdentityDigests=groups.map((item)=>item.canonicalIdentityDigest)) {
    const at=now();
    return write('arca_offdeck_duplicate_groups_commit',(ctx)=>{const r=ctx.repository(repo.repositoryId),existing=r.invoke('list_duplicate_groups',{}),members=r.invoke('list_duplicate_members',{}),whitelists=r.invoke('list_whitelists',{}),candidates=r.invoke('list_candidates',{}),policyHead=r.invoke('find_policy_head',{policy_id:POLICY_ID}),incoming=new Set(groups.map((group)=>group.groupId)),written=[];
      for(const prior of existing.filter((item)=>item.state==='active'&&scopeIdentityDigests.includes(item.canonical_identity_digest)&&!incoming.has(item.duplicate_group_id))){r.invoke('update_duplicate_group',{state:'stale',superseded_at_ms:at,duplicate_group_id:prior.duplicate_group_id,expected_state:'active'});for(const candidate of candidates.filter((item)=>item.duplicate_group_id===prior.duplicate_group_id&&item.state==='open'))r.invoke('update_candidate',{state:'stale',candidate_id:candidate.candidate_id,expected_state:'open'});for(const whitelist of whitelists.filter((item)=>item.duplicate_group_id===prior.duplicate_group_id&&item.state==='active'))r.invoke('update_whitelist',{state:'stale',revoked_at_ms:at,whitelist_id:whitelist.whitelist_id,expected_state:'active'});}
      for(const group of groups){const current=existing.find((item)=>item.duplicate_group_id===group.groupId);
        if(current){if(current.member_set_digest!==group.memberSetDigest&&current.state==='active')r.invoke('update_duplicate_group',{state:'stale',superseded_at_ms:at,duplicate_group_id:current.duplicate_group_id,expected_state:'active'});else{written.push(current);continue;}}
        r.invoke('insert_duplicate_group',{duplicate_group_id:group.groupId,canonical_identity_digest:group.canonicalIdentityDigest,member_set_digest:group.memberSetDigest,state:'active',detected_at_ms:at,superseded_at_ms:null});
        for(const member of group.members)if(!members.some((x)=>x.duplicate_group_id===group.groupId&&x.shelf_entry_id===member.shelfEntryId))r.invoke('insert_duplicate_member',{duplicate_group_id:group.groupId,shelf_entry_id:member.shelfEntryId,inventory_revision:member.inventoryRevision,member_digest:member.memberDigest});
        const whitelisted=whitelists.some((item)=>item.duplicate_group_id===group.groupId&&item.member_set_digest===group.memberSetDigest&&item.state==='active');
        if(!whitelisted){const policyRevision=Number(policyHead?.current_revision||1),targetDigest=canonicalDigest({candidateKind:'duplicate_group',duplicateGroupId:group.groupId,memberSetDigest:group.memberSetDigest}),reasonDigest=canonicalDigest({reason:'strong_identity_duplicate',canonicalIdentityDigest:group.canonicalIdentityDigest,memberSetDigest:group.memberSetDigest}),conditionEvidence={schemaRef:'arca://types/OffdeckConditionEvidence/v1',schemaVersion:1,conditionKind:'collection_duplicate',canonicalIdentityDigest:group.canonicalIdentityDigest,memberSetDigest:group.memberSetDigest},conditionEvidenceDigest=canonicalDigest(conditionEvidence),candidateId=stable('arca-offdeck-candidate-',{targetDigest,policyRevision,reasonDigest});if(!candidates.some((item)=>item.candidate_id===candidateId))r.invoke('insert_candidate',{candidate_id:candidateId,candidate_kind:'duplicate_group',shelf_entry_id:null,duplicate_group_id:group.groupId,target_digest:targetDigest,policy_id:POLICY_ID,policy_revision:policyRevision,condition_evidence_schema_ref:conditionEvidence.schemaRef,condition_evidence_json:canonicalJson(conditionEvidence),condition_evidence_digest:conditionEvidenceDigest,reason_digest:reasonDigest,state:'open',created_at_ms:at});}
        written.push(group);
      }
      return Object.freeze(written);
    });
  }

  function commitCandidate(value) {
    return write('arca_offdeck_candidate_commit',(ctx)=>{const r=ctx.repository(repo.repositoryId),all=r.invoke('list_candidates',{}),existing=all.find((x)=>x.candidate_id===value.candidateId),at=now();if(existing)return existing;
      for(const candidate of all.filter((item)=>item.candidate_kind==='entry'&&item.shelf_entry_id===value.shelfEntryId&&item.state==='open'&&
        (Number(item.policy_revision)!==Number(value.policyRevision)||item.reason_digest!==value.reasonDigest)))r.invoke('update_candidate',{state:'stale',candidate_id:candidate.candidate_id,expected_state:'open'});
      const suppressions=r.invoke('list_suppressions',{});for(const item of suppressions.filter((suppression)=>suppression.state==='active'&&suppression.expires_at_ms!==null&&Number(suppression.expires_at_ms)<=at))r.invoke('update_suppression',{state:'expired',revoked_at_ms:at,suppression_id:item.suppression_id,expected_state:'active'});
      const suppressed=suppressions.some((item)=>item.state==='active'&&item.shelf_entry_id===value.shelfEntryId&&Number(item.policy_revision)===Number(value.policyRevision)&&item.reason_digest===value.reasonDigest&&(item.expires_at_ms===null||Number(item.expires_at_ms)>at));
      if(suppressed)fail('ARCA_OFFDECK_CANDIDATE_SUPPRESSED','Off-deck Candidate is suppressed by the exact current Policy and reason.');
      const duplicate=all.find((x)=>x.target_digest===value.targetDigest&&Number(x.policy_revision)===Number(value.policyRevision)&&x.reason_digest===value.reasonDigest&&x.state==='open');if(duplicate)return duplicate;
      r.invoke('insert_candidate',{candidate_id:value.candidateId,candidate_kind:value.candidateKind,shelf_entry_id:value.shelfEntryId||null,duplicate_group_id:value.duplicateGroupId||null,target_digest:value.targetDigest,policy_id:value.policyId,policy_revision:value.policyRevision,condition_evidence_schema_ref:value.conditionEvidence.schemaRef,condition_evidence_json:canonicalJson(value.conditionEvidence),condition_evidence_digest:value.conditionEvidenceDigest,reason_digest:value.reasonDigest,state:'open',created_at_ms:at});return value;});
  }

  function staleEntryCandidates(shelfEntryId) {
    return write('arca_offdeck_candidate_stale', (ctx) => {
      const r=ctx.repository(repo.repositoryId), stale=[];
      for(const candidate of r.invoke('list_candidates',{}).filter((item)=>item.candidate_kind==='entry'&&item.shelf_entry_id===shelfEntryId&&item.state==='open')){
        if(r.invoke('update_candidate',{state:'stale',candidate_id:candidate.candidate_id,expected_state:'open'}).changes===1)stale.push(candidate.candidate_id);
      }
      return Object.freeze(stale);
    });
  }

  function listCandidates() { return read((ctx)=>{const r=ctx.repository(repo.repositoryId),groups=r.invoke('list_duplicate_groups',{}),members=r.invoke('list_duplicate_members',{}),suppressions=r.invoke('list_suppressions',{}),whitelists=r.invoke('list_whitelists',{});return Object.freeze({candidates:Object.freeze(r.invoke('list_candidates',{}).map(candidateProjection)),duplicateGroups:Object.freeze(groups.map((group)=>duplicateGroupProjection(group,members.filter((x)=>x.duplicate_group_id===group.duplicate_group_id)))),suppressions:Object.freeze(suppressions.map(suppressionProjection)),whitelists:Object.freeze(whitelists.map(whitelistProjection))});}); }
  function suppressCandidate(candidateId,input={}) { return write('arca_offdeck_candidate_suppress',(ctx)=>{const r=ctx.repository(repo.repositoryId),candidate=r.invoke('list_candidates',{}).find((x)=>x.candidate_id===candidateId);if(!candidate||candidate.state!=='open')fail('ARCA_OFFDECK_CANDIDATE_NOT_OPEN','Off-deck Candidate is not open.');if(candidate.candidate_kind!=='entry'||!candidate.shelf_entry_id)fail('ARCA_OFFDECK_SUPPRESSION_TARGET_INVALID','Only Entry Candidate can be suppressed.');const id=stable('arca-offdeck-suppression-',{candidateId,policyRevision:candidate.policy_revision,reason:candidate.reason_digest});if(!r.invoke('list_suppressions',{}).some((x)=>x.suppression_id===id))r.invoke('insert_suppression',{suppression_id:id,shelf_entry_id:candidate.shelf_entry_id,candidate_kind:candidate.candidate_kind,policy_id:candidate.policy_id,policy_revision:Number(candidate.policy_revision),reason_digest:candidate.reason_digest,state:'active',effective_at_ms:now(),expires_at_ms:input.expiresAtMs||null,revoked_at_ms:null});r.invoke('update_candidate',{state:'dismissed',candidate_id:candidateId,expected_state:'open'});return Object.freeze({suppressionId:id,candidateId});}); }
  function revokeSuppression(suppressionId) { return write('arca_offdeck_suppression_revoke',(ctx)=>{const r=ctx.repository(repo.repositoryId),item=r.invoke('list_suppressions',{}).find((x)=>x.suppression_id===suppressionId);if(!item||item.state!=='active')fail('ARCA_OFFDECK_SUPPRESSION_NOT_ACTIVE','Off-deck Suppression is not active.');r.invoke('update_suppression',{state:'revoked',revoked_at_ms:now(),suppression_id:suppressionId,expected_state:'active'});return Object.freeze({suppressionId,state:'revoked'});}); }
  function whitelistDuplicate(groupId,input={}) { return write('arca_offdeck_duplicate_whitelist',(ctx)=>{const r=ctx.repository(repo.repositoryId),group=r.invoke('list_duplicate_groups',{}).find((x)=>x.duplicate_group_id===groupId);if(!group||group.state!=='active')fail('ARCA_OFFDECK_DUPLICATE_GROUP_NOT_ACTIVE','Duplicate Group is not active.');const id=stable('arca-offdeck-whitelist-',{groupId,memberSetDigest:group.member_set_digest});if(!r.invoke('list_whitelists',{}).some((x)=>x.whitelist_id===id))r.invoke('insert_whitelist',{whitelist_id:id,duplicate_group_id:groupId,member_set_digest:group.member_set_digest,state:'active',actor_id:input.actorId||'admin',created_at_ms:now(),revoked_at_ms:null});return Object.freeze({whitelistId:id,groupId});}); }
  function revokeWhitelist(whitelistId) { return write('arca_offdeck_whitelist_revoke',(ctx)=>{const r=ctx.repository(repo.repositoryId),item=r.invoke('list_whitelists',{}).find((x)=>x.whitelist_id===whitelistId);if(!item||item.state!=='active')fail('ARCA_OFFDECK_WHITELIST_NOT_ACTIVE','Duplicate Whitelist is not active.');r.invoke('update_whitelist',{state:'revoked',revoked_at_ms:now(),whitelist_id:whitelistId,expected_state:'active'});return Object.freeze({whitelistId,state:'revoked'});}); }

  function controlFor(material, controlByKey) {
    const control = controlByKey.get(material.material_key);
    if (!control || control.resultKind !== 'available' || control.controlState !== 'controlled' || control.ownerDomain !== 'arca' ||
        control.ownerScopeType!=='shelf_entry' || !control.ownerScopeId) {
      fail('ARCA_OFFDECK_CONTROL_SCOPE_INVALID', 'Off-deck material lacks exact Arca Material Control.');
    }
    return control;
  }

  function physicalIdentityFromMaterial(row) {
    return Object.freeze({
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
      schemaVersion: 2,
      materialKey: row.material_key,
      mountScopeId: row.mount_scope_id,
      inode: String(row.inode),
      sizeBytes: Number(row.size_bytes),
      fingerprintAlgorithm: row.fingerprint_algorithm,
      fingerprintVersion: Number(row.fingerprint_version),
      contentFingerprint: row.content_fingerprint,
    });
  }

  function parseRelatedIdentity(reference, allMaterials) {
    let parsed = null;
    try { parsed = JSON.parse(reference.material_identity_hint); } catch {}
    if (parsed?.schemaRef === 'helix://contracts/types/PhysicalMaterialIdentity/v2' &&
        typeof parsed.materialKey === 'string' && parsed.materialKey) {
      return Object.freeze(parsed);
    }
    const match = allMaterials.find((row) =>
      row.material_key === reference.material_identity_hint ||
      (row.endpoint_id === reference.endpoint_id &&
        locationComparisonKey(row.location) === locationComparisonKey(reference.location) &&
        row.digest_hex === reference.checksum_hex));
    if (!match) fail('ARCA_OFFDECK_RELATED_IDENTITY_UNRESOLVED',
      'Off-deck cannot freeze a Related Reference without an exact Physical Material Identity.');
    return physicalIdentityFromMaterial(match);
  }

  function buildScope(snapshot, reservationId, controlByKey, createdAtMs) {
    if (!snapshot.shelf || snapshot.shelf.status !== 'active' || snapshot.materials.length < 1) {
      fail('ARCA_OFFDECK_SCOPE_INVALID', 'Off-deck Scope is unavailable or exceeds 1024 materials.');
    }
    const relatedByLocation = new Map(snapshot.related.map((item) => [locationComparisonKey(item.location), item]));
    const root = normalizedAbsoluteLocation(snapshot.shelf.target_root_location);
    const allMaterials = read((ctx) => ctx.repository(repo.repositoryId).invoke('list_all_materials', {}));
    const inventoryMaterials = snapshot.materials.slice().sort((a,b) => Number(a.ordinal) - Number(b.ordinal)).map((item) => {
      const relative = relativeToShelfRoot(root,item.location);
      const identity = physicalIdentityFromMaterial(item);
      const related = relatedByLocation.get(locationComparisonKey(item.location)) || null;
      const control = controlFor(item, controlByKey);
      if(control.ownerScopeId!==snapshot.entry.shelf_entry_id)fail('ARCA_OFFDECK_CONTROL_SCOPE_INVALID','Off-deck material Control belongs to another Shelf Entry.');
      return Object.freeze({ materialKey:item.material_key, materialRole:item.role, physicalIdentity:identity,
        endpointId:item.endpoint_id, endpointRelativeLocation:relative, sizeBytes:Number(item.size_bytes),
        relatedReferenceId:related?.reference_id || null, bindingRevision:Number(item.binding_revision), controlRevision:Number(control.controlRevision),
        controlProjectionDigest:control.projectionDigest, deleteCondition:related
          ? 'release_related_then_delete_if_unreferenced' : 'exclusive_primary' });
    });
    const materialKeys = new Set(inventoryMaterials.map((item) => item.materialKey));
    const referencedOnly = snapshot.related.map((reference) => {
      const identity = parseRelatedIdentity(reference, allMaterials);
      if (materialKeys.has(identity.materialKey)) return null;
      const relative = relativeToShelfRoot(root,reference.location);
      const control = controlByKey.get(identity.materialKey);
      if (!control || control.resultKind !== 'available') fail('ARCA_OFFDECK_RELATED_CONTROL_PROJECTION_MISSING',
        'Off-deck Related material lacks a frozen Material Control projection.');
      return Object.freeze({ materialKey:identity.materialKey, materialRole:reference.role, physicalIdentity:identity,
        endpointId:reference.endpoint_id, endpointRelativeLocation:relative, sizeBytes:Number(identity.sizeBytes),
        relatedReferenceId:reference.reference_id, bindingRevision:1, controlRevision:Number(control.controlRevision),
        controlProjectionDigest:control.projectionDigest, deleteCondition:'release_related_then_delete_if_unreferenced' });
    }).filter(Boolean);
    const candidates = [...inventoryMaterials, ...referencedOnly].sort((a,b) =>
      Buffer.compare(Buffer.from(a.materialKey), Buffer.from(b.materialKey)));
    if (candidates.length < 1 || candidates.length > 1024 || new Set(candidates.map((item)=>item.materialKey)).size !== candidates.length) {
      fail('ARCA_OFFDECK_SCOPE_INVALID', 'Off-deck Scope is empty, duplicated, or exceeds 1024 materials.');
    }
    const materials = candidates.map((item, ordinal) => {
      const basis = { ordinal, ...item };
      return Object.freeze({ ...basis, physicalIdentityDigest:canonicalDigest(item.physicalIdentity), memberDigest:canonicalDigest(basis) });
    });
    const memberSetDigest = canonicalDigest({ schema:'arca.offdeck-scope-members@1', items:materials });
    const controlRevisionSetDigest = canonicalDigest(materials.map((item) => ({ materialKey:item.materialKey,
      controlRevision:item.controlRevision, controlProjectionDigest:item.controlProjectionDigest })));
    const scopeBasis = { shelfEntryId:snapshot.entry.shelf_entry_id, inventoryRevision:Number(snapshot.entry.current_inventory_revision),
      memberCount:materials.length, memberSetDigest, controlRevisionSetDigest };
    return Object.freeze({ destructionScopeId:stable('arca-offdeck-scope-', { reservationId, scopeBasis }), reservationId,
      ...scopeBasis, scopeDigest:canonicalDigest(scopeBasis), createdAtMs, materials:Object.freeze(materials) });
  }

  function createReview(input, controls) {
    const originKind=input.originKind||((input.shelfEntryIds||[]).length>1?'batch':'direct_intent'),candidateFacts=['candidate','duplicate_group'].includes(originKind)?listCandidates():null;
    let sourceCandidate=null,allowedDuplicateMembers=null;
    if(originKind==='candidate'){
      sourceCandidate=candidateFacts.candidates.find((item)=>item.candidate_id===input.originRef&&item.candidate_kind==='entry');
      if(!sourceCandidate||sourceCandidate.state!=='open')fail('ARCA_OFFDECK_CANDIDATE_NOT_OPEN','Off-deck Review Candidate is not open.');
      input={...input,shelfEntryId:sourceCandidate.shelf_entry_id};
    }else if(originKind==='duplicate_group'){
      const group=candidateFacts.duplicateGroups.find((item)=>item.duplicate_group_id===input.originRef&&item.state==='active');
      if(!group)fail('ARCA_OFFDECK_DUPLICATE_GROUP_NOT_ACTIVE','Off-deck Duplicate Group is not active.');
      allowedDuplicateMembers=new Set(group.members.map((item)=>item.shelf_entry_id));
    }
    const ids = [...new Set(input.shelfEntryIds || (input.shelfEntryId ? [input.shelfEntryId] : []))].sort();
    if (ids.length < 1 || ids.length > 1024 || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey) {
      fail('ARCA_OFFDECK_REVIEW_INPUT_INVALID', 'Off-deck Review requires 1..1024 Shelf Entries and an idempotency key.');
    }
    if(allowedDuplicateMembers&&ids.some((id)=>!allowedDuplicateMembers.has(id)))fail('ARCA_OFFDECK_DUPLICATE_SELECTION_INVALID','Off-deck Review selected an Entry outside the Duplicate Group.');
    const snapshots = ids.map(entrySnapshot);
    const reauthorization=input.originKind==='reauthorization';
    if (snapshots.some((item) => !item || (reauthorization?item.entry.status!=='offdeck_in_progress':item.entry.status!=='active'))) fail('ARCA_OFFDECK_REVIEW_ENTRY_INVALID', 'Off-deck Review contains an Entry outside the allowed lifecycle state.');
    const createdAtMs = now();
    const reviewId = stable('arca-offdeck-review-', { originKind, originRef:input.originRef || input.idempotencyKey, ids, idempotencyKey:input.idempotencyKey });
    const preparing = snapshots.some((item) => item.activeCare);
    const allMaterials = preparing ? [] : read((ctx) => ctx.repository(repo.repositoryId).invoke('list_all_materials', {}));
    const keys = preparing ? [] : [...new Set(snapshots.flatMap((item) => [
      ...item.materials.map((m) => m.material_key),
      ...item.related.map((reference) => parseRelatedIdentity(reference, allMaterials).materialKey),
    ]))].sort();
    const controlByKey = preparing ? new Map() : new Map(controls(keys).map((item) => [item.materialKey, item]));
    const records = snapshots.map((snapshot) => {
      const reservationId = stable('arca-offdeck-reservation-', { reviewId, shelfEntryId:snapshot.entry.shelf_entry_id });
      return Object.freeze({ snapshot, reservationId, scope:preparing ? null : buildScope(snapshot, reservationId, controlByKey, createdAtMs) });
    });
    const opened = write('arca_offdeck_review_open', (ctx) => {
      const r = ctx.repository(repo.repositoryId), existing = r.invoke('find_review', { review_id:reviewId });
      if (existing) return Object.freeze({ reviewId, replayed:true });
      const reservations = r.invoke('list_reservations', {});
      if (records.some((record) => reservations.some((item) => item.shelf_entry_id === record.snapshot.entry.shelf_entry_id && item.state === 'active'))) {
        fail('ARCA_OFFDECK_RESERVATION_CONFLICT', 'Shelf Entry already has an active Off-deck Reservation.');
      }
      const reviewPreparing = preparing || records.some((record) =>
        r.invoke('list_aftercare_cases', { shelf_entry_id:record.snapshot.entry.shelf_entry_id })
          .some((item) => item.terminal_at_ms === null));
      r.invoke('insert_review', { review_id:reviewId, origin_kind:originKind, origin_ref:input.originRef || input.idempotencyKey,
        state:reviewPreparing ? 'preparing' : 'open', actor_id:input.actorId || 'admin', created_at_ms:createdAtMs, terminal_at_ms:null });
      for (const record of records) {
        r.invoke('insert_reservation', { reservation_id:record.reservationId, review_id:reviewId, shelf_entry_id:record.snapshot.entry.shelf_entry_id,
          inventory_revision:Number(record.snapshot.entry.current_inventory_revision), control_scope_digest:reviewPreparing ? canonicalDigest({schema:'arca.offdeck-pending-scope@1',reviewId,shelfEntryId:record.snapshot.entry.shelf_entry_id,inventoryRevision:Number(record.snapshot.entry.current_inventory_revision)}) : record.scope.controlRevisionSetDigest,
          state:'active', created_at_ms:createdAtMs, released_at_ms:null });
        if (!reviewPreparing) insertScope(r, record.scope);
      }
      if(sourceCandidate&&r.invoke('update_candidate',{state:'selected',candidate_id:sourceCandidate.candidate_id,expected_state:'open'}).changes!==1)fail('ARCA_OFFDECK_CANDIDATE_STALE','Off-deck Review Candidate changed concurrently.');
      if(originKind==='duplicate_group')for(const candidate of r.invoke('list_candidates',{}).filter((item)=>item.duplicate_group_id===input.originRef&&item.state==='open'))r.invoke('update_candidate',{state:'selected',candidate_id:candidate.candidate_id,expected_state:'open'});
      return Object.freeze({ reviewId, state:reviewPreparing ? 'preparing' : 'open' });
    });
    return opened.replayed ? detail(reviewId) : opened;
  }

  function insertScope(r, scope) {
    r.invoke('insert_scope', { destruction_scope_id:scope.destructionScopeId, reservation_id:scope.reservationId,
      shelf_entry_id:scope.shelfEntryId, inventory_revision:scope.inventoryRevision, member_count:scope.memberCount,
      scope_digest:scope.scopeDigest, state:'draft', created_at_ms:scope.createdAtMs });
    for (const item of scope.materials) r.invoke('insert_scope_material', { destruction_scope_id:scope.destructionScopeId,
      ordinal:item.ordinal, material_key:item.materialKey, material_role:item.materialRole,
      physical_identity_schema_ref:item.physicalIdentity.schemaRef, physical_identity_json:canonicalJson(item.physicalIdentity),
      physical_identity_digest:item.physicalIdentityDigest, endpoint_id:item.endpointId, endpoint_relative_location:item.endpointRelativeLocation,
      size_bytes:item.sizeBytes, related_reference_id:item.relatedReferenceId, binding_revision:item.bindingRevision,
      control_revision:item.controlRevision, control_projection_digest:item.controlProjectionDigest, delete_condition:item.deleteCondition,
      member_digest:item.memberDigest });
  }

  function reviewRows(reviewId) {
    return read((ctx) => {
      const r = ctx.repository(repo.repositoryId), review = r.invoke('find_review', { review_id:reviewId });
      if (!review) return null;
      const reservations = r.invoke('list_reservations', {}).filter((item) => item.review_id === reviewId);
      const allScopes = r.invoke('list_scopes', {}), scopes = reservations.map((reservation) => allScopes.find((scope) => scope.reservation_id === reservation.reservation_id)).filter(Boolean)
        .map((scope) => Object.freeze({ ...scope, materials:Object.freeze(r.invoke('list_scope_materials', { destruction_scope_id:scope.destruction_scope_id })) }));
      return Object.freeze({ review, reservations:Object.freeze(reservations), scopes:Object.freeze(scopes) });
    });
  }

  function detail(reviewId) {
    const value = reviewRows(reviewId); if (!value) return null;
    const selection = read((ctx) => ctx.repository(repo.repositoryId).invoke('find_selection', { review_id:reviewId }));
    const escalation = selection ? read((ctx) => ctx.repository(repo.repositoryId).invoke('find_escalation', { selection_receipt_id:selection.selection_receipt_id })) : null;
    return Object.freeze({ reviewId, originKind:value.review.origin_kind, originRef:value.review.origin_ref, state:value.review.state,
      createdAtMs:Number(value.review.created_at_ms), reservations:Object.freeze(value.reservations.map((item) => Object.freeze({ reservationId:item.reservation_id,
        shelfEntryId:item.shelf_entry_id, inventoryRevision:Number(item.inventory_revision), state:item.state }))),
      scopes:Object.freeze(value.scopes.map((scope) => Object.freeze({ destructionScopeId:scope.destruction_scope_id,
        shelfEntryId:scope.shelf_entry_id, inventoryRevision:Number(scope.inventory_revision), memberCount:Number(scope.member_count),
        totalBytes:scope.materials.reduce((sum,item)=>sum+Number(item.size_bytes),0), scopeDigest:scope.scope_digest, state:scope.state,
        materials:Object.freeze(scope.materials.map((item)=>Object.freeze({ ordinal:Number(item.ordinal), materialKey:item.material_key,
          role:item.material_role, location:item.endpoint_relative_location, sizeBytes:Number(item.size_bytes), deleteCondition:item.delete_condition }))) }))),
      selection:selection ? Object.freeze({ selectionReceiptId:selection.selection_receipt_id, scopeSetDigest:selection.scope_set_digest,
        entryCount:Number(selection.entry_count), primaryCount:Number(selection.primary_count), totalBytes:Number(selection.total_bytes),
        deckCoverageRatio:Number(selection.deck_coverage_ratio), highVolume:Boolean(selection.high_volume) }) : null,
      escalation:escalation ? Object.freeze({ escalationReceiptId:escalation.escalation_receipt_id }) : null });
  }

  function tryOpenPreparedReview(reviewId, controls) {
    const value = reviewRows(reviewId);
    if (!value || value.review.state !== 'preparing') return detail(reviewId);
    const snapshots = value.reservations.map((reservation) => entrySnapshot(reservation.shelf_entry_id));
    if (snapshots.some((snapshot) => !snapshot || snapshot.activeCare)) return detail(reviewId);
    const stale = snapshots.some((snapshot, index) => {
      const reservation = value.reservations[index];
      return snapshot.entry.status !== 'active' ||
        Number(snapshot.entry.current_inventory_revision) !== Number(reservation.inventory_revision);
    });
    if (stale) {
      write('arca_offdeck_review_prepare_stale', (ctx) => {
        const r = ctx.repository(repo.repositoryId);
        if (r.invoke('update_review', { state:'stale', terminal_at_ms:now(), review_id:reviewId,
          expected_state:'preparing' }).changes !== 1) return Object.freeze({ replayed:true });
        for (const reservation of value.reservations) if (reservation.state === 'active') {
          r.invoke('update_reservation', { state:'released', released_at_ms:now(), reservation_id:reservation.reservation_id,
            expected_state:'active' });
        }
        return Object.freeze({ replayed:false });
      });
      return detail(reviewId);
    }
    const allMaterials = read((ctx) => ctx.repository(repo.repositoryId).invoke('list_all_materials', {}));
    const keys = [...new Set(snapshots.flatMap((snapshot) => [
      ...snapshot.materials.map((item) => item.material_key),
      ...snapshot.related.map((reference) => parseRelatedIdentity(reference, allMaterials).materialKey),
    ]))].sort();
    const controlByKey = new Map(controls(keys).map((item) => [item.materialKey, item]));
    const openedAtMs = now();
    const scopes = snapshots.map((snapshot, index) => buildScope(snapshot,
      value.reservations[index].reservation_id, controlByKey, openedAtMs));
    write('arca_offdeck_review_prepare_complete', (ctx) => {
      const r = ctx.repository(repo.repositoryId);
      const existingScopes = r.invoke('list_scopes', {});
      for (const scope of scopes) if (!existingScopes.some((item) => item.reservation_id === scope.reservationId)) insertScope(r, scope);
      if (r.invoke('update_review', { state:'open', terminal_at_ms:null, review_id:reviewId,
        expected_state:'preparing' }).changes !== 1) fail('ARCA_OFFDECK_REVIEW_STALE', 'Prepared Off-deck Review changed concurrently.');
      return Object.freeze({ reviewId });
    });
    return detail(reviewId);
  }

  function deferReviewUntilSafe(reviewId) {
    const value=detail(reviewId);
    if(!value||value.state==='preparing')return value;
    if(value.state!=='open')fail('ARCA_OFFDECK_REVIEW_NOT_OPEN','Only an open Off-deck Review can return to asynchronous preparation.');
    write('arca_offdeck_review_defer_for_safe_boundary',(ctx)=>{
      if(ctx.repository(repo.repositoryId).invoke('update_review',{state:'preparing',terminal_at_ms:null,
        review_id:reviewId,expected_state:'open'}).changes!==1)fail('ARCA_OFFDECK_REVIEW_STALE','Off-deck Review changed before its safety boundary was established.');
      return Object.freeze({reviewId});
    });
    return detail(reviewId);
  }

  function confirmSelection(reviewId, input) {
    const value = reviewRows(reviewId); if (!value || value.review.state !== 'open' || value.scopes.length !== value.reservations.length) {
      fail('ARCA_OFFDECK_REVIEW_NOT_OPEN', 'Off-deck Review is not ready for selection confirmation.');
    }
    const selectedIds = input.scopeIds ? [...new Set(input.scopeIds)].sort() : value.scopes.map((item) => item.destruction_scope_id).sort();
    if(selectedIds.length<1)fail('ARCA_OFFDECK_SELECTION_SCOPE_INVALID','Off-deck selection must retain at least one Scope.');
    const selected = selectedIds.map((id) => value.scopes.find((item) => item.destruction_scope_id === id));
    if (selected.some((item) => !item)) fail('ARCA_OFFDECK_SELECTION_SCOPE_INVALID', 'Off-deck selection contains an unknown Scope.');
    const entries = allEntryFacts(), shelves = new Map(entries.map((entry) => [entry.shelf_id, entries.filter((x) => x.shelf_id === entry.shelf_id).length]));
    const selectedByShelf = {}, materials = selected.flatMap((item) => item.materials);
    for (const scope of selected) { const entry = entries.find((x) => x.shelf_entry_id === scope.shelf_entry_id)||entrySnapshot(scope.shelf_entry_id)?.entry;if(!entry)fail('ARCA_OFFDECK_SELECTION_ENTRY_INVALID','Off-deck Scope Entry is unavailable.'); selectedByShelf[entry.shelf_id] = (selectedByShelf[entry.shelf_id] || 0) + 1; }
    const metrics = { entryCount:selected.length, primaryCount:materials.filter((item) => ['primary_payload','structural_dependency'].includes(item.material_role)).length,
      totalBytes:materials.reduce((sum,item)=>sum+Number(item.size_bytes),0), shelfCoverageRatios:Object.fromEntries(Object.entries(selectedByShelf).map(([id,count])=>[id,count/(shelves.get(id)||count)])),
      deckCoverageRatio:selected.length/Math.max(entries.length,1) };
    const high = highVolumeDecision(metrics), scopeSetDigest = canonicalDigest(selected.map((item) => ({ scopeId:item.destruction_scope_id, scopeDigest:item.scope_digest })).sort((a,b)=>a.scopeId.localeCompare(b.scopeId))),
      receiptId = stable('arca-offdeck-selection-', { reviewId, scopeSetDigest });
    write('arca_offdeck_selection_confirm', (ctx) => { const r=ctx.repository(repo.repositoryId), existing=r.invoke('find_selection',{review_id:reviewId});if(existing)return Object.freeze({replayed:true});
      r.invoke('insert_selection',{selection_receipt_id:receiptId,review_id:reviewId,scope_set_digest:scopeSetDigest,entry_count:metrics.entryCount,
        primary_count:metrics.primaryCount,total_bytes:metrics.totalBytes,shelf_coverage_digest:canonicalDigest(metrics.shelfCoverageRatios),deck_coverage_ratio:metrics.deckCoverageRatio,
        high_volume:high.highVolume?1:0,actor_id:input.actorId||'admin',confirmed_at_ms:now()});
      for(const scope of value.scopes){if(selectedIds.includes(scope.destruction_scope_id))r.invoke('update_scope',{state:'confirmed',destruction_scope_id:scope.destruction_scope_id,expected_state:'draft'});else{r.invoke('update_scope',{state:'stale',destruction_scope_id:scope.destruction_scope_id,expected_state:'draft'});const reservation=value.reservations.find((item)=>item.reservation_id===scope.reservation_id);if(reservation?.state==='active')r.invoke('update_reservation',{state:'released',released_at_ms:now(),reservation_id:reservation.reservation_id,expected_state:'active'});}}
      if(r.invoke('update_review',{state:high.highVolume?'awaiting_escalation':'selection_confirmed',terminal_at_ms:null,review_id:reviewId,expected_state:'open'}).changes!==1)fail('ARCA_OFFDECK_REVIEW_STALE','Off-deck Review changed concurrently.');
      return Object.freeze({replayed:false}); });
    return detail(reviewId);
  }

  function confirmEscalation(reviewId, input) {
    const d=detail(reviewId);if(!d||d.state!=='awaiting_escalation'||!d.selection?.highVolume)fail('ARCA_OFFDECK_ESCALATION_NOT_REQUIRED','Off-deck Review does not require High-volume confirmation.');
    const id=stable('arca-offdeck-escalation-',{reviewId,scopeSetDigest:d.selection.scopeSetDigest});write('arca_offdeck_escalation_confirm',(ctx)=>{const r=ctx.repository(repo.repositoryId),existing=r.invoke('find_escalation',{selection_receipt_id:d.selection.selectionReceiptId});if(existing)return Object.freeze({replayed:true});
      r.invoke('insert_escalation',{escalation_receipt_id:id,selection_receipt_id:d.selection.selectionReceiptId,scope_set_digest:d.selection.scopeSetDigest,actor_id:input.actorId||'admin',confirmed_at_ms:now()});
      if(r.invoke('update_review',{state:'selection_confirmed',terminal_at_ms:null,review_id:reviewId,expected_state:'awaiting_escalation'}).changes!==1)fail('ARCA_OFFDECK_REVIEW_STALE','Off-deck Review changed concurrently.');return Object.freeze({replayed:false});});
    return detail(reviewId);
  }

  function authorize(reviewId, input, controls) {
    const d=detail(reviewId);if(!d||!['selection_confirmed','authorized'].includes(d.state)||!d.selection||d.selection.highVolume&&!d.escalation)fail('ARCA_OFFDECK_AUTHORIZATION_NOT_READY','Off-deck Review is not ready for Authorization.');
    if(typeof controls!=='function')fail('ARCA_OFFDECK_CONTROL_PROJECTION_MISSING','Off-deck Authorization requires current Material Control projections.');
    const at=now(),batchId=stable('arca-offdeck-authorization-batch-',{reviewId,scopeSetDigest:d.selection.scopeSetDigest});
    const envelope=write('arca_offdeck_authorization_envelope',(ctx)=>{const r=ctx.repository(repo.repositoryId),existing=r.invoke('find_batch',{review_id:reviewId,scope_set_digest:d.selection.scopeSetDigest});if(existing)return Object.freeze({batchId:existing.batch_id,replayed:true});
      r.invoke('insert_batch',{batch_id:batchId,review_id:reviewId,selection_receipt_id:d.selection.selectionReceiptId,escalation_receipt_id:d.escalation?.escalationReceiptId||null,scope_set_digest:d.selection.scopeSetDigest,actor_id:input.actorId||'admin',authorized_at_ms:at});
      if(r.invoke('update_review',{state:'authorized',terminal_at_ms:at,review_id:reviewId,expected_state:'selection_confirmed'}).changes!==1)fail('ARCA_OFFDECK_REVIEW_STALE','Off-deck Review changed concurrently.');return Object.freeze({batchId,replayed:false});});
    const raw=reviewRows(reviewId),selected=raw.scopes.filter((scope)=>['confirmed','authorized','stale'].includes(scope.state)),cases=[],blocked=[];
    for(const scope of selected){
      const existingAuthorization=read((ctx)=>ctx.repository(repo.repositoryId).invoke('list_authorizations',{}).find((item)=>item.destruction_scope_id===scope.destruction_scope_id));
      if(existingAuthorization){const existingCase=listCases().find((item)=>item.currentAuthorizationId===existingAuthorization.authorization_id||item.initialAuthorizationId===existingAuthorization.authorization_id);if(existingCase)cases.push(existingCase.offdeckCaseId);continue;}
      if(scope.state==='stale'){blocked.push(Object.freeze({shelfEntryId:scope.shelf_entry_id,destructionScopeId:scope.destruction_scope_id,reasonCode:'destruction_scope_stale'}));continue;}
      const snapshot=entrySnapshot(scope.shelf_entry_id),reservation=raw.reservations.find((item)=>item.reservation_id===scope.reservation_id),reauthorization=d.originKind==='reauthorization';
      const projections=new Map(controls(scope.materials.map((item)=>item.material_key)).map((item)=>[item.materialKey,item]));
      const stale=!snapshot||snapshot.entry.status!==(reauthorization?'offdeck_in_progress':'active')||Number(snapshot.entry.current_inventory_revision)!==Number(scope.inventory_revision)||reservation?.state!=='active'||scope.materials.some((item)=>{const projection=projections.get(item.material_key);return !projection||projection.resultKind!=='available'||Number(projection.controlRevision)!==Number(item.control_revision)||projection.projectionDigest!==item.control_projection_digest;});
      if(stale){write('arca_offdeck_authorization_scope_stale',(ctx)=>{const r=ctx.repository(repo.repositoryId);if(scope.state==='confirmed')r.invoke('update_scope',{state:'stale',destruction_scope_id:scope.destruction_scope_id,expected_state:'confirmed'});if(reservation?.state==='active')r.invoke('update_reservation',{state:'released',released_at_ms:now(),reservation_id:reservation.reservation_id,expected_state:'active'});return Object.freeze({stale:true});});blocked.push(Object.freeze({shelfEntryId:scope.shelf_entry_id,destructionScopeId:scope.destruction_scope_id,reasonCode:'destruction_scope_stale'}));continue;}
      const authorizationId=stable('arca-offdeck-authorization-',{scopeId:scope.destruction_scope_id,scopeDigest:scope.scope_digest}),caseId=reauthorization?d.originRef:stable('arca-offdeck-case-',{shelfEntryId:scope.shelf_entry_id,originReviewId:reviewId});
      write('arca_offdeck_entry_authorize',(ctx)=>{const r=ctx.repository(repo.repositoryId),existing=r.invoke('list_authorizations',{}).find((item)=>item.authorization_id===authorizationId);if(existing)return Object.freeze({caseId,replayed:true});
        const replacementCase=reauthorization?r.invoke('find_case',{offdeck_case_id:d.originRef}):null;r.invoke('insert_authorization',{authorization_id:authorizationId,destruction_scope_id:scope.destruction_scope_id,scope_digest:scope.scope_digest,actor_id:input.actorId||'admin',batch_id:envelope.batchId,authorized_at_ms:at,state:'active'});
        if(replacementCase){const oldAuth=r.invoke('list_authorizations',{}).find((item)=>item.authorization_id===replacementCase.current_authorization_id),oldScope=oldAuth&&r.invoke('find_scope',{destruction_scope_id:oldAuth.destruction_scope_id});if(!oldAuth||!oldScope||replacementCase.state!=='awaiting_reauthorization')fail('ARCA_OFFDECK_REAUTHORIZATION_STALE','Off-deck Case no longer awaits reauthorization.');r.invoke('update_authorization',{state:'stale',authorization_id:oldAuth.authorization_id,expected_state:'active'});r.invoke('update_scope',{state:'stale',destruction_scope_id:oldScope.destruction_scope_id,expected_state:'authorized'});r.invoke('update_case',{current_authorization_id:authorizationId,state:'executing',recovery_revision:Number(replacementCase.recovery_revision)+1,retry_at_ms:null,blocked_reason:null,terminal_at_ms:null,offdeck_case_id:caseId,expected_state:'awaiting_reauthorization'});}else{r.invoke('insert_case',{offdeck_case_id:caseId,initial_authorization_id:authorizationId,current_authorization_id:authorizationId,shelf_entry_id:scope.shelf_entry_id,origin_kind:d.originKind,origin_ref:reviewId,state:'executing',recovery_revision:1,retry_at_ms:null,blocked_reason:null,created_at_ms:at,terminal_at_ms:null});if(r.invoke('mark_entry',{status:'offdeck_in_progress',shelf_entry_id:scope.shelf_entry_id,expected_status:'active'}).changes!==1)fail('ARCA_OFFDECK_ENTRY_STALE','Shelf Entry changed before Authorization.');}
        if(r.invoke('update_scope',{state:'authorized',destruction_scope_id:scope.destruction_scope_id,expected_state:'confirmed'}).changes!==1||r.invoke('update_reservation',{state:'consumed',released_at_ms:at,reservation_id:reservation.reservation_id,expected_state:'active'}).changes!==1)fail('ARCA_OFFDECK_ENTRY_STALE','Off-deck Entry Authorization facts changed concurrently.');return Object.freeze({caseId,replayed:false});});cases.push(caseId);
    }
    return Object.freeze({batchId:envelope.batchId,cases:Object.freeze([...new Set(cases)]),blocked:Object.freeze(blocked),replayed:envelope.replayed&&blocked.length===0});
  }

  function cancel(reviewId) { const d=detail(reviewId);if(!d||!['preparing','open','selection_confirmed','awaiting_escalation'].includes(d.state))fail('ARCA_OFFDECK_REVIEW_NOT_CANCELLABLE','Authorized Off-deck Review cannot be cancelled.');write('arca_offdeck_review_cancel',(ctx)=>{const r=ctx.repository(repo.repositoryId),at=now();if(r.invoke('update_review',{state:'cancelled',terminal_at_ms:at,review_id:reviewId,expected_state:d.state}).changes!==1)fail('ARCA_OFFDECK_REVIEW_STALE','Off-deck Review changed concurrently.');for(const item of d.reservations)if(item.state==='active')r.invoke('update_reservation',{state:'released',released_at_ms:at,reservation_id:item.reservationId,expected_state:'active'});for(const scope of d.scopes)if(['draft','confirmed'].includes(scope.state))r.invoke('update_scope',{state:'stale',destruction_scope_id:scope.destructionScopeId,expected_state:scope.state});if(d.originKind==='candidate'){const candidate=r.invoke('list_candidates',{}).find((item)=>item.candidate_id===d.originRef);if(candidate?.state==='selected')r.invoke('update_candidate',{state:'open',candidate_id:candidate.candidate_id,expected_state:'selected'});}else if(d.originKind==='duplicate_group'){const group=r.invoke('list_duplicate_groups',{}).find((item)=>item.duplicate_group_id===d.originRef);if(group?.state==='active')for(const candidate of r.invoke('list_candidates',{}).filter((item)=>item.duplicate_group_id===d.originRef&&item.state==='selected'))r.invoke('update_candidate',{state:'open',candidate_id:candidate.candidate_id,expected_state:'selected'});}return Object.freeze({reviewId});});return detail(reviewId); }

  function listCases() { return read((ctx)=>Object.freeze(ctx.repository(repo.repositoryId).invoke('list_cases',{}).map((row)=>Object.freeze({offdeckCaseId:row.offdeck_case_id,initialAuthorizationId:row.initial_authorization_id,currentAuthorizationId:row.current_authorization_id,shelfEntryId:row.shelf_entry_id,originKind:row.origin_kind,originRef:row.origin_ref,state:row.state,recoveryRevision:Number(row.recovery_revision),retryAtMs:number(row.retry_at_ms),blockedReason:row.blocked_reason||null,createdAtMs:Number(row.created_at_ms),terminalAtMs:number(row.terminal_at_ms)})).sort((a,b)=>b.createdAtMs-a.createdAtMs))); }
  function caseContext(caseId){return read((ctx)=>{const r=ctx.repository(repo.repositoryId),c=r.invoke('find_case',{offdeck_case_id:caseId});if(!c)return null;const auth=r.invoke('list_authorizations',{}).find((x)=>x.authorization_id===c.current_authorization_id),scope=auth&&r.invoke('find_scope',{destruction_scope_id:auth.destruction_scope_id});if(!auth||!scope)return null;return Object.freeze({case:Object.freeze(c),authorization:Object.freeze(auth),scope:Object.freeze(scope),materials:Object.freeze(r.invoke('list_scope_materials',{destruction_scope_id:scope.destruction_scope_id})),evidence:Object.freeze(r.invoke('list_evidence',{destruction_scope_id:scope.destruction_scope_id}))});});}
  function recordEvidence(value){return write('arca_offdeck_evidence_commit',(ctx)=>{const r=ctx.repository(repo.repositoryId),existing=r.invoke('list_evidence',{destruction_scope_id:value.destructionScopeId}).find((x)=>x.material_key===value.materialKey);if(existing)return existing;r.invoke('insert_evidence',{destruction_scope_id:value.destructionScopeId,material_key:value.materialKey,effect_id:value.effectId,result:value.result,reality_digest:value.realityDigest,reference_release_result_digest:value.referenceReleaseResultDigest||null,completed_at_ms:now()});return value;});}
  function activeReferenceCount(materialKey, excludingShelfEntryId, releasedReferenceIds=new Set()) {
    return read((ctx) => {
      const r=ctx.repository(repo.repositoryId), entries=r.invoke('list_entries',{}), activeEntries=entries.filter((entry)=>
        entry.status==='active'||entry.status==='offdeck_in_progress'), active=new Map(activeEntries.map((entry)=>[entry.shelf_entry_id,Number(entry.current_inventory_revision)])),
        allMaterials=r.invoke('list_all_materials',{}), consumers=new Set();
      for(const item of allMaterials) if(item.material_key===materialKey&&active.get(item.shelf_entry_id)===Number(item.inventory_revision)&&
        item.shelf_entry_id!==excludingShelfEntryId)consumers.add(item.shelf_entry_id);
      for(const reference of r.invoke('list_all_related',{})){
        if(active.get(reference.shelf_entry_id)!==Number(reference.inventory_revision)||reference.shelf_entry_id===excludingShelfEntryId||
          releasedReferenceIds.has(reference.reference_id))continue;
        const identity=parseRelatedIdentity(reference,allMaterials);
        if(identity.materialKey===materialKey)consumers.add(reference.shelf_entry_id);
      }
      return consumers.size;
    });
  }
  function markBlocked(caseId, reason='environment_unavailable', retryDelayMs=30_000){const c=caseContext(caseId);if(c&&c.case.state==='executing')return write('arca_offdeck_case_block',(ctx)=>ctx.repository(repo.repositoryId).invoke('update_case',{current_authorization_id:c.case.current_authorization_id,state:'blocked',recovery_revision:Number(c.case.recovery_revision)+1,retry_at_ms:now()+retryDelayMs,blocked_reason:reason,terminal_at_ms:null,offdeck_case_id:caseId,expected_state:'executing'}));return null;}
  function resumeBlocked(caseId){const c=caseContext(caseId);if(!c||c.case.state!=='blocked'||Number(c.case.retry_at_ms)>now())return false;const result=write('arca_offdeck_case_resume',(ctx)=>ctx.repository(repo.repositoryId).invoke('update_case',{current_authorization_id:c.case.current_authorization_id,state:'executing',recovery_revision:Number(c.case.recovery_revision),retry_at_ms:null,blocked_reason:null,terminal_at_ms:null,offdeck_case_id:caseId,expected_state:'blocked'}));return result.changes===1;}
  function markAwaitingReauthorization(caseId){const c=caseContext(caseId);if(c&&['executing','blocked'].includes(c.case.state))write('arca_offdeck_case_reauthorization',(ctx)=>ctx.repository(repo.repositoryId).invoke('update_case',{current_authorization_id:c.case.current_authorization_id,state:'awaiting_reauthorization',recovery_revision:Number(c.case.recovery_revision),retry_at_ms:null,blocked_reason:'destruction_scope_stale',terminal_at_ms:null,offdeck_case_id:caseId,expected_state:c.case.state}));}
  function completeCase(value, controlParticipant) {
    const c=caseContext(value.caseId);
    if(!c||c.case.state==='completed')return c?read((ctx)=>ctx.repository(repo.repositoryId).invoke('find_terminal',{offdeck_case_id:value.caseId})):null;
    if(c.case.state!=='executing'||c.authorization.state!=='active'||c.scope.state!=='authorized')fail('ARCA_OFFDECK_TERMINAL_STATE_INVALID','Off-deck terminal commit requires one executing Case and its current active Authorization.');
    const materialByKey=new Map(c.materials.map((item)=>[item.material_key,item])),evidenceByKey=new Map(c.evidence.map((item)=>[item.material_key,item]));
    if(materialByKey.size!==c.materials.length||evidenceByKey.size!==c.evidence.length||evidenceByKey.size!==materialByKey.size||
      [...materialByKey.keys()].some((key)=>!evidenceByKey.has(key)))fail('ARCA_OFFDECK_DESTRUCTION_INCOMPLETE','Off-deck terminal commit requires one terminal Evidence row for every exact Scope member.');
    for(const [key,material] of materialByKey){const evidence=evidenceByKey.get(key),related=material.delete_condition==='release_related_then_delete_if_unreferenced';
      if(!['deleted','authorized_identity_already_absent',...(related?['retained_due_to_active_reference']:[])].includes(evidence.result)||
        related&&typeof evidence.reference_release_result_digest!=='string'||!related&&evidence.reference_release_result_digest!==null)fail('ARCA_OFFDECK_DELETION_EVIDENCE_INVALID','Off-deck Deletion Evidence disposition does not match its authorized member role.');}
    const snapshot=entrySnapshot(c.case.shelf_entry_id),entry=snapshot?.entry;
    if(!entry||entry.status!=='offdeck_in_progress'||Number(entry.current_inventory_revision)!==Number(c.scope.inventory_revision))fail('ARCA_OFFDECK_ENTRY_STALE','Shelf Entry changed before terminal commit.');
    const at=now(),next=Number(entry.current_deck_fact_revision)+1,factBasis={shelfEntryId:entry.shelf_entry_id,revision:next,state:'offdecked',inventoryRevision:Number(entry.current_inventory_revision)};
    return options.unitOfWork.execute([{participantId:'arca_offdeck_terminal',owner:'arca',repositories:[repo],execute(ctx){const r=ctx.repository(repo.repositoryId),receiptId=stable('arca-offdeck-terminal-',{caseId:value.caseId,scope:c.scope.scope_digest});r.invoke('insert_deck_fact',{shelf_entry_id:entry.shelf_entry_id,revision:next,state:'offdecked',inventory_revision:Number(entry.current_inventory_revision),standard_revision:value.standardRevision||1,fact_digest:canonicalDigest(factBasis),committed_at_ms:at});if(r.invoke('advance_entry_terminal',{status:'offdecked',current_deck_fact_revision:next,terminal_at_ms:at,shelf_entry_id:entry.shelf_entry_id,expected_current_deck_fact_revision:Number(entry.current_deck_fact_revision)}).changes!==1)fail('ARCA_OFFDECK_ENTRY_STALE','Shelf Entry changed before terminal commit.');r.invoke('clear_inventory_guards',{active_guard:0,shelf_entry_id:entry.shelf_entry_id,inventory_revision:Number(entry.current_inventory_revision)});if(r.invoke('update_scope',{state:'completed',destruction_scope_id:c.scope.destruction_scope_id,expected_state:'authorized'}).changes!==1||r.invoke('update_authorization',{state:'consumed',authorization_id:c.authorization.authorization_id,expected_state:'active'}).changes!==1||r.invoke('update_case',{current_authorization_id:c.case.current_authorization_id,state:'completed',recovery_revision:Number(c.case.recovery_revision),retry_at_ms:null,blocked_reason:null,terminal_at_ms:at,offdeck_case_id:value.caseId,expected_state:'executing'}).changes!==1)fail('ARCA_OFFDECK_TERMINAL_CAS_FAILED','Off-deck terminal facts changed concurrently.');r.invoke('insert_terminal',{receipt_id:receiptId,offdeck_case_id:value.caseId,shelf_entry_id:entry.shelf_entry_id,terminal_deck_fact_revision:next,released_control_set_digest:value.releasedControlSetDigest,committed_at_ms:at});return Object.freeze({receiptId,offdeckCaseId:value.caseId,shelfEntryId:entry.shelf_entry_id,terminalDeckFactRevision:next,releasedControlSetDigest:value.releasedControlSetDigest,committedAtMs:at});}},...(controlParticipant?[controlParticipant]:[])]).arca_offdeck_terminal;
  }

  return Object.freeze({ ensurePolicy, currentPolicy, publishPolicy, entrySnapshot, allEntryFacts, commitDuplicateGroups,commitCandidate,staleEntryCandidates,listCandidates,suppressCandidate,revokeSuppression,whitelistDuplicate,revokeWhitelist,createReview, detail, confirmSelection,
    confirmEscalation, authorize, cancel, listReviews:()=>read((ctx)=>ctx.repository(repo.repositoryId).invoke('list_reviews',{})), listCases,
    tryOpenPreparedReview,deferReviewUntilSafe, caseContext, recordEvidence, activeReferenceCount, markBlocked,resumeBlocked,markAwaitingReauthorization, completeCase });
}

module.exports = Object.freeze({ OffdeckStoreError, createOffdeckStore });
