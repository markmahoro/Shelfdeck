'use strict';

const { deriveTitleYearEvidence, normalizeAlias } = require('../model/perception-aliases');

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createAcquisition, createCursor, createRecord, createRelation, createResolution, createSource } = require('../model/perception-store-contracts');

const RECORD_COMMIT_RESULT_SCHEMA = 'helix://contracts/types/PerceptionRecordCommitResult/v1';
const RESOLUTION_DRAFT_SCHEMA = 'helix://contracts/types/PerceptionResolutionDraft/v1';
const RESOLUTION_RESULT_SCHEMA = 'helix://contracts/types/PerceptionResolutionRevision/v1';

class PerceptionStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PerceptionStoreError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new PerceptionStoreError(code, message, details); }
function exact(value, keys, code) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Perception Store input does not match its closed contract.'); }

function recordDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId: 'perception_record_repository', owner: 'perception', schemaManifest, statements: {
    insert_source: { kind: 'insert', tableId: 'perception_sources', columns: ['perception_source_id','source_kind','integration_id','status','config_revision','current_cursor_revision','created_at_ms','updated_at_ms'] },
    find_source: { kind: 'select-one', tableId: 'perception_sources', columns: ['perception_source_id','source_kind','integration_id','status','config_revision','current_cursor_revision','created_at_ms','updated_at_ms'], keyColumns: ['perception_source_id'] },
    revise_source: { kind: 'update', tableId: 'perception_sources', setColumns: ['source_kind','integration_id','status','config_revision','updated_at_ms'], keyColumns: ['perception_source_id'], compareColumns: [{ column: 'config_revision', parameter: 'expected_config_revision' }] },
    initialize_cursor_head: { kind: 'update', tableId: 'perception_sources', setColumns: ['current_cursor_revision','updated_at_ms'], keyColumns: ['perception_source_id'] },
    advance_cursor_head: { kind: 'update', tableId: 'perception_sources', setColumns: ['current_cursor_revision','updated_at_ms'], keyColumns: ['perception_source_id'], compareColumns: [{ column: 'current_cursor_revision', parameter: 'expected_cursor_revision' }] },
    insert_acquisition: { kind: 'insert', tableId: 'perception_acquisitions', columns: ['perception_acquisition_id','perception_source_id','source_config_revision','scope_schema_ref','scope_json','scope_digest','initial_cursor_revision','initial_cursor_value','state','created_at_ms','terminal_at_ms'] },
    find_acquisition: { kind: 'select-one', tableId: 'perception_acquisitions', columns: ['perception_acquisition_id','perception_source_id','source_config_revision','scope_schema_ref','scope_json','scope_digest','initial_cursor_revision','initial_cursor_value','state','created_at_ms','terminal_at_ms'], keyColumns: ['perception_acquisition_id'] },
    terminal_acquisition: { kind: 'update', tableId: 'perception_acquisitions', setColumns: ['state','terminal_at_ms'], keyColumns: ['perception_acquisition_id'], compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
    insert_cursor: { kind: 'insert', tableId: 'perception_source_cursors', columns: ['perception_source_id','revision','perception_acquisition_id','cursor_in','cursor_out','observation_page_digest','has_more','committed_at_ms'] },
    find_cursor: { kind: 'select-one', tableId: 'perception_source_cursors', columns: ['perception_source_id','revision','perception_acquisition_id','cursor_in','cursor_out','observation_page_digest','has_more','committed_at_ms'], keyColumns: ['perception_source_id','revision'] },
    insert_commit: { kind: 'insert', tableId: 'perception_acquisition_commits', columns: ['acquisition_commit_receipt_id','perception_acquisition_id','perception_source_id','page_ordinal','expected_cursor_revision','committed_cursor_revision','observation_page_digest','commit_marker','result_schema_ref','result_json','result_digest','committed_at_ms'] },
    find_commit: { kind: 'select-one', tableId: 'perception_acquisition_commits', columns: ['acquisition_commit_receipt_id','perception_acquisition_id','perception_source_id','page_ordinal','expected_cursor_revision','committed_cursor_revision','observation_page_digest','commit_marker','result_schema_ref','result_json','result_digest','committed_at_ms'], keyColumns: ['acquisition_commit_receipt_id'] },
    find_commit_marker: { kind: 'select-one', tableId: 'perception_acquisition_commits', columns: ['acquisition_commit_receipt_id','perception_acquisition_id','perception_source_id','page_ordinal','expected_cursor_revision','committed_cursor_revision','observation_page_digest','commit_marker','result_schema_ref','result_json','result_digest','committed_at_ms'], keyColumns: ['commit_marker'] },
    insert_record: { kind: 'insert', tableId: 'perception_records', columns: ['perception_id','perception_source_id','perception_acquisition_id','acquisition_commit_receipt_id','record_kind','source_kind','source_record_key','source_record_revision','source_record_digest','normalization_rule_ref','rating','watched_state','observed_title','provenance_ref','provenance_digest','record_digest','observed_at_ms','committed_at_ms'] },
    find_record: { kind: 'select-one', tableId: 'perception_records', columns: ['perception_id','perception_source_id','perception_acquisition_id','acquisition_commit_receipt_id','record_kind','source_kind','source_record_key','source_record_revision','source_record_digest','normalization_rule_ref','rating','watched_state','observed_title','provenance_ref','provenance_digest','record_digest','observed_at_ms','committed_at_ms'], keyColumns: ['perception_id'] },
    find_record_identity: { kind: 'select-one', tableId: 'perception_records', columns: ['perception_id'], keyColumns: ['perception_source_id','source_record_key','source_record_revision','source_record_digest'] },
    find_records_by_source_key: { kind: 'select-all', tableId: 'perception_records', columns: ['perception_id','perception_source_id','perception_acquisition_id','acquisition_commit_receipt_id','record_kind','source_kind','source_record_key','source_record_revision','source_record_digest','normalization_rule_ref','rating','watched_state','observed_title','provenance_ref','provenance_digest','record_digest','observed_at_ms','committed_at_ms'], keyColumns: ['perception_source_id','source_record_key'] },
    list_records: { kind: 'select-all', tableId: 'perception_records', columns: ['perception_id','perception_source_id','perception_acquisition_id','acquisition_commit_receipt_id','record_kind','source_kind','source_record_key','source_record_revision','source_record_digest','normalization_rule_ref','rating','watched_state','observed_title','provenance_ref','provenance_digest','record_digest','observed_at_ms','committed_at_ms'], keyColumns: [] },
    list_acquisitions: { kind: 'select-all', tableId: 'perception_acquisitions', columns: ['perception_acquisition_id','perception_source_id','source_config_revision','scope_schema_ref','scope_json','scope_digest','initial_cursor_revision','initial_cursor_value','state','created_at_ms','terminal_at_ms'], keyColumns: [] },
    insert_anchor: { kind: 'insert', tableId: 'perception_identity_anchors', columns: ['perception_id','anchor_kind','anchor_value','confidence_class','evidence_digest'] },
    find_anchors: { kind: 'select-all', tableId: 'perception_identity_anchors', columns: ['perception_id','anchor_kind','anchor_value','confidence_class','evidence_digest'], keyColumns: ['perception_id'] },
    find_anchors_by_kind: { kind: 'select-all', tableId: 'perception_identity_anchors', columns: ['perception_id','anchor_kind','anchor_value','confidence_class','evidence_digest'], keyColumns: ['anchor_kind'] },
    list_anchors: { kind: 'select-all', tableId: 'perception_identity_anchors', columns: ['perception_id','anchor_kind','anchor_value','confidence_class','evidence_digest'], keyColumns: [] },
    insert_relation: { kind: 'insert', tableId: 'perception_record_relations', columns: ['relation_id','relation_kind','source_perception_id','target_perception_id','rule_revision','evidence_digest','committed_at_ms'] },
    find_relation: { kind: 'select-one', tableId: 'perception_record_relations', columns: ['relation_id','relation_kind','source_perception_id','target_perception_id','rule_revision','evidence_digest','committed_at_ms'], keyColumns: ['relation_kind','source_perception_id','target_perception_id'] },
    list_relations: { kind: 'select-all', tableId: 'perception_record_relations', columns: ['relation_id','relation_kind','source_perception_id','target_perception_id','rule_revision','evidence_digest','committed_at_ms'], keyColumns: [] }
  }});
}

function resolutionDefinition(schemaManifest) {
  return createRepositoryDefinition({ repositoryId: 'perception_resolution_repository', owner: 'perception', schemaManifest, statements: {
    insert_resolution: { kind: 'insert', tableId: 'perception_resolution_revisions', columns: ['resolution_id','query_contract','query_schema_ref','query_input_digest','fact_kind','revision','record_set_digest','rule_revision','rule_digest','result_kind','winning_perception_id','reason_code','result_schema_ref','result_json','result_digest','resolved_at_ms'] },
    find_resolution: { kind: 'select-one', tableId: 'perception_resolution_revisions', columns: ['resolution_id','query_contract','query_schema_ref','query_input_digest','fact_kind','revision','record_set_digest','rule_revision','rule_digest','result_kind','winning_perception_id','reason_code','result_schema_ref','result_json','result_digest','resolved_at_ms'], keyColumns: ['resolution_id'] },
    insert_head: { kind: 'insert', tableId: 'perception_resolution_heads', columns: ['query_contract','query_input_digest','current_resolution_id','current_revision','updated_at_ms'] },
    find_head: { kind: 'select-one', tableId: 'perception_resolution_heads', columns: ['query_contract','query_input_digest','current_resolution_id','current_revision','updated_at_ms'], keyColumns: ['query_contract','query_input_digest'] },
    advance_head: { kind: 'update', tableId: 'perception_resolution_heads', setColumns: ['current_resolution_id','current_revision','updated_at_ms'], keyColumns: ['query_contract','query_input_digest'], compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }] },
    list_heads: { kind: 'select-all', tableId: 'perception_resolution_heads', columns: ['query_contract','query_input_digest','current_resolution_id','current_revision','updated_at_ms'], keyColumns: [] },
    list_resolutions: { kind: 'select-all', tableId: 'perception_resolution_revisions', columns: ['resolution_id','query_contract','query_schema_ref','query_input_digest','fact_kind','revision','record_set_digest','rule_revision','rule_digest','result_kind','winning_perception_id','reason_code','result_schema_ref','result_json','result_digest','resolved_at_ms'], keyColumns: [] }
  }});
}

function createPerceptionStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') fail('P6_PERCEPTION_STORE_DEPENDENCIES', 'Schema manifest and Unit of Work are required.');
  const records = recordDefinition(options.schemaManifest); const resolutions = resolutionDefinition(options.schemaManifest);
  const execute = (repositories, body) => options.unitOfWork.execute([{ participantId: 'perception_store', owner: 'perception', repositories, execute: body }]).perception_store;
  const repositoryManifest = Object.freeze({ components: Object.freeze([
    Object.freeze({ component: 'PerceptionRecordRepository', repositoryId: records.repositoryId, tableIds: records.tableIds }),
    Object.freeze({ component: 'PerceptionResolutionRepository', repositoryId: resolutions.repositoryId, tableIds: resolutions.tableIds })
  ]) });

  return Object.freeze({ repositoryManifest,
    registerSource(input) {
      exact(input, ['perceptionSourceId','sourceKind','integrationId','status','configRevision'], 'P6_PERCEPTION_SOURCE_INPUT');
      if (input.configRevision !== 1) fail('P6_PERCEPTION_SOURCE_INITIAL_REVISION', 'Source config starts at revision 1.');
      return execute([records], (context) => { const repo = context.repository(records.repositoryId); repo.invoke('insert_source', {
        perception_source_id: input.perceptionSourceId, source_kind: input.sourceKind, integration_id: input.integrationId, status: input.status,
        config_revision: 1, current_cursor_revision: null, created_at_ms: context.commitTimeMs, updated_at_ms: context.commitTimeMs
      }); return mapSource(repo.invoke('find_source', { perception_source_id: input.perceptionSourceId })); });
    },
    reviseSource(input, expectedConfigRevision) {
      exact(input, ['perceptionSourceId','sourceKind','integrationId','status','configRevision'], 'P6_PERCEPTION_SOURCE_INPUT');
      return execute([records], (context) => { const repo = context.repository(records.repositoryId); const current = repo.invoke('find_source', { perception_source_id: input.perceptionSourceId });
        if (!current || current.config_revision !== expectedConfigRevision || input.configRevision !== expectedConfigRevision + 1) fail('P6_PERCEPTION_SOURCE_REVISION_CONFLICT', 'Source config revision is stale or skipped.');
        const changed = repo.invoke('revise_source', { source_kind: input.sourceKind, integration_id: input.integrationId, status: input.status,
          config_revision: input.configRevision, updated_at_ms: context.commitTimeMs, perception_source_id: input.perceptionSourceId,
          expected_config_revision: expectedConfigRevision }); if (changed.changes !== 1) fail('P6_PERCEPTION_SOURCE_REVISION_CONFLICT', 'Source config CAS failed.');
        return mapSource(repo.invoke('find_source', { perception_source_id: input.perceptionSourceId })); });
    },
    getSource(id) { return execute([records], (context) => mapSource(context.repository(records.repositoryId).invoke('find_source', { perception_source_id: id }))); },
    startAcquisition(input) {
      exact(input, ['perceptionAcquisitionId','perceptionSourceId','sourceConfigRevision','scopeSchemaRef','scope','scopeDigest','initialCursorRevision','initialCursorValue'], 'P6_PERCEPTION_ACQUISITION_INPUT');
      const scopeJson = canonicalJson(input.scope); if (Buffer.byteLength(scopeJson, 'utf8') > 16384 || canonicalDigest(input.scope) !== input.scopeDigest) fail('P6_PERCEPTION_SCOPE_DIGEST_MISMATCH', 'Acquisition scope exceeds its bound or digest.');
      return execute([records], (context) => { const repo = context.repository(records.repositoryId); const source = repo.invoke('find_source', { perception_source_id: input.perceptionSourceId });
        if (!source || source.config_revision !== input.sourceConfigRevision || (source.current_cursor_revision || 0) !== input.initialCursorRevision) fail('P6_PERCEPTION_ACQUISITION_BASIS_STALE', 'Acquisition must freeze the current Source config and cursor head.');
        const item = createAcquisition({ perceptionAcquisitionId: input.perceptionAcquisitionId, perceptionSourceId: input.perceptionSourceId,
          sourceConfigRevision: input.sourceConfigRevision, scopeSchemaRef: input.scopeSchemaRef, scopeJson, scopeDigest: input.scopeDigest,
          initialCursorRevision: input.initialCursorRevision, initialCursorValue: input.initialCursorValue,
          state: 'active', createdAtMs: context.commitTimeMs, terminalAtMs: null });
        repo.invoke('insert_acquisition', acquisitionRow(item)); return item; });
    },
    getAcquisition(id) { return execute([records], (context) => mapAcquisition(context.repository(records.repositoryId).invoke('find_acquisition', { perception_acquisition_id: id }))); },
    getCursor(sourceId, revision) { return execute([records], (context) => { const row=context.repository(records.repositoryId).invoke('find_cursor',{perception_source_id:sourceId,revision});
      return row?createCursor({perceptionSourceId:row.perception_source_id,revision:row.revision,perceptionAcquisitionId:row.perception_acquisition_id,
        cursorIn:row.cursor_in,cursorOut:row.cursor_out,observationPageDigest:row.observation_page_digest,hasMore:Boolean(row.has_more),committedAtMs:row.committed_at_ms}):null; }); },
    commitPage(input) {
      exact(input, ['acquisitionCommitReceiptId','perceptionAcquisitionId','perceptionSourceId','pageOrdinal','expectedCursorRevision','cursorIn','cursorOut','observationPageDigest','hasMore','commitMarker','records','relations'], 'P6_PERCEPTION_PAGE_INPUT');
      if (!Array.isArray(input.records) || !Array.isArray(input.relations) || input.records.length > 4096 || input.relations.length > 4096) fail('P6_PERCEPTION_PAGE_BOUND', 'Page fact sets must be bounded arrays.');
      return execute([records], (context) => commitPage(context.repository(records.repositoryId), input, context.commitTimeMs));
    },
    createRecordCommitParticipant(handle, draft) {
      if (!handle || handle.ownerDomain !== 'perception' || handle.aggregateType !== 'perception-acquisition' ||
          handle.aggregateId !== draft?.perceptionAcquisitionId || handle.expectedRevision !== draft?.cursorTransition?.expectedCursorRevision ||
          handle.resultSchemaRef !== RECORD_COMMIT_RESULT_SCHEMA) {
        fail('P6_PERCEPTION_COMMIT_HANDLE_MISMATCH', 'Record Commit Handle does not fence the exact Acquisition draft.');
      }
      return Object.freeze({ participantId: 'perception_record_commit', owner: 'perception', repositories: [records],
        execute(context) { const repo = context.repository(records.repositoryId); return commitPage(repo, pageInputFromDraft(repo, handle, draft), context.commitTimeMs).commit.result; } });
    },
    getCommit(id) { return execute([records], (context) => mapCommit(context.repository(records.repositoryId).invoke('find_commit', { acquisition_commit_receipt_id: id }))); },
    getRecord(id) { return execute([records], (context) => mapRecord(context.repository(records.repositoryId), id)); },
    listAcquisitions() { return execute([records], (context) => context.repository(records.repositoryId).invoke('list_acquisitions').map(mapAcquisition)
      .sort((left,right)=>right.createdAtMs-left.createdAtMs||left.perceptionAcquisitionId.localeCompare(right.perceptionAcquisitionId))); },
    listRecords(query = {}) { return execute([records,resolutions], (context) => {
      const repo=context.repository(records.repositoryId),resolutionRepo=context.repository(resolutions.repositoryId);
      const anchors=repo.invoke('list_anchors'),relations=repo.invoke('list_relations');
      const currentResolutionIds=new Set(resolutionRepo.invoke('list_heads').map((row)=>row.current_resolution_id)),currentResolutions=resolutionRepo.invoke('list_resolutions').filter((row)=>currentResolutionIds.has(row.resolution_id)),winningResolutionByPerceptionId=new Map(currentResolutions.filter((row)=>row.result_kind==='found'&&row.winning_perception_id).map((row)=>[row.winning_perception_id,mapResolution(row)]));
      const winning=new Set(winningResolutionByPerceptionId.keys());
      const superseded=new Set(relations.filter((row)=>['supersedes','retracts'].includes(row.relation_kind)).map((row)=>row.target_perception_id));
      const currentRows=repo.invoke('list_records').filter((row)=>!superseded.has(row.perception_id));
      const anchorRank=new Map([['provider_identity',1],['subject_id',2],['shelf_entry_id',2],['title_year',3]]),groups=new Map();
      for(const row of currentRows){const owned=anchors.filter((anchor)=>anchor.perception_id===row.perception_id&&anchorRank.has(anchor.anchor_kind))
        .sort((left,right)=>anchorRank.get(left.anchor_kind)-anchorRank.get(right.anchor_kind)||left.anchor_kind.localeCompare(right.anchor_kind));
        if(owned.length===0||row.rating===null)continue;const rank=anchorRank.get(owned[0].anchor_kind);
        for(const anchor of owned.filter((item)=>anchorRank.get(item.anchor_kind)===rank)){const key=anchor.anchor_kind+'\0'+anchor.anchor_value;
          if(!groups.has(key))groups.set(key,[]);groups.get(key).push({id:row.perception_id,rating:row.rating});}}
      const ambiguous=new Set();for(const group of groups.values())if(new Set(group.map((item)=>item.rating)).size>1)group.forEach((item)=>ambiguous.add(item.id));
      const limit=Math.min(200,Math.max(1,Number(query.limit)||50));
      let values=repo.invoke('list_records').map((row)=>mapRecord(repo,row.perception_id)).map((record)=>{
        const owned=anchors.filter((anchor)=>anchor.perception_id===record.perceptionId);
        const target=owned.find((anchor)=>['subject_id','shelf_entry_id'].includes(anchor.anchor_kind));
        const status=superseded.has(record.perceptionId)?'superseded':winning.has(record.perceptionId)?'matched':ambiguous.has(record.perceptionId)?'ambiguous':'unmatched';
        return Object.freeze({perceptionId:record.perceptionId,sourceKind:record.sourceKind,recordKind:record.recordKind,
          rating:record.rating,watchedState:record.watchedState,observedTitle:record.observedTitle,observedAtMs:record.observedAtMs,
          committedAtMs:record.committedAtMs,targetType:target?.anchor_kind==='subject_id'?'subject':target?.anchor_kind==='shelf_entry_id'?'shelf_entry':null,
          targetId:target?.anchor_value||null,resolutionStatus:status,current:status!=='superseded',resolutionDigest:winningResolutionByPerceptionId.get(record.perceptionId)?.factDigest||null,resolutionRevision:winningResolutionByPerceptionId.get(record.perceptionId)?.revision||null,sourceRecordKey:record.sourceRecordKey,
          sourceRecordRevision:record.sourceRecordRevision,provenanceDigest:record.provenanceDigest,recordDigest:record.recordDigest});
      }).filter((item)=>!query.sourceKind||item.sourceKind===query.sourceKind)
        .filter((item)=>query.rating===undefined||query.rating===null||item.rating===Number(query.rating))
        .filter((item)=>!query.resolutionStatus||item.resolutionStatus===query.resolutionStatus)
        .filter((item)=>!query.targetType||item.targetType===query.targetType)
        .filter((item)=>!query.targetId||item.targetId===query.targetId)
        .sort((left,right)=>right.committedAtMs-left.committedAtMs||left.perceptionId.localeCompare(right.perceptionId));
      if(query.cursor){const separator=String(query.cursor).indexOf(':');const at=Number(String(query.cursor).slice(0,separator));const id=String(query.cursor).slice(separator+1);
        values=values.filter((item)=>item.committedAtMs<at||item.committedAtMs===at&&item.perceptionId>id);}
      const items=values.slice(0,limit),last=items.at(-1),nextCursor=values.length>limit&&last?last.committedAtMs+':'+last.perceptionId:null;
      return Object.freeze({items:Object.freeze(items),nextCursor});
    }); },
    findCurrentTargetRating(targetType,targetId) { return execute([records], (context) => {
      const repo=context.repository(records.repositoryId),anchorKind=targetType==='subject'?'subject_id':targetType==='shelf_entry'?'shelf_entry_id':null;
      if(!anchorKind)return null;const ids=new Set(repo.invoke('find_anchors_by_kind',{anchor_kind:anchorKind}).filter((row)=>row.anchor_value===targetId).map((row)=>row.perception_id));
      const terminal=new Set(repo.invoke('list_relations').filter((row)=>['supersedes','retracts'].includes(row.relation_kind)).map((row)=>row.target_perception_id));
      const candidates=[...ids].filter((id)=>!terminal.has(id)).map((id)=>mapRecord(repo,id)).filter((item)=>item.rating!==null)
        .sort((left,right)=>right.committedAtMs-left.committedAtMs||left.perceptionId.localeCompare(right.perceptionId));
      return candidates[0]||null;
    }); },
    findCurrentTargetRatings(targetType,targetIds) { return execute([records], (context) => {
      const repo=context.repository(records.repositoryId),anchorKind=targetType==='subject'?'subject_id':targetType==='shelf_entry'?'shelf_entry_id':null;
      const wanted=new Set(targetIds||[]),result=new Map();if(!anchorKind||!wanted.size)return result;
      const anchors=repo.invoke('find_anchors_by_kind',{anchor_kind:anchorKind}).filter((row)=>wanted.has(row.anchor_value));
      const terminal=new Set(repo.invoke('list_relations').filter((row)=>['supersedes','retracts'].includes(row.relation_kind)).map((row)=>row.target_perception_id));
      for(const targetId of wanted){const ids=anchors.filter((row)=>row.anchor_value===targetId&&!terminal.has(row.perception_id)).map((row)=>row.perception_id);
        const current=ids.map((id)=>mapRecord(repo,id)).filter((item)=>item.rating!==null)
          .sort((left,right)=>right.committedAtMs-left.committedAtMs||left.perceptionId.localeCompare(right.perceptionId))[0]||null;
        result.set(targetId,current);}
      return result;
    }); },
    readCurrentResolvedRatings(queryInputDigests) { return execute([records,resolutions], (context) => {
      const wanted=new Set(queryInputDigests),recordRepo=context.repository(records.repositoryId),resolutionRepo=context.repository(resolutions.repositoryId);
      if(!wanted.size)return Object.freeze([]);
      const heads=resolutionRepo.invoke('list_heads').filter((row)=>row.query_contract==='perception.rating.resolve@1'&&wanted.has(row.query_input_digest));
      const currentIds=new Set(heads.map((row)=>row.current_resolution_id));
      const current=resolutionRepo.invoke('list_resolutions').filter((row)=>currentIds.has(row.resolution_id));
      return Object.freeze(current.map((row)=>{
        const resolution=mapResolution(row),winner=resolution.resultKind==='found'?mapRecord(recordRepo,resolution.winningPerceptionId):null;
        return Object.freeze({queryInputDigest:resolution.queryInputDigest,resolution,winner});
      }));
    }); },
    readResolutionCandidates(query, ruleSnapshot) { return execute([records], (context) => {
      const repo=context.repository(records.repositoryId); const ids=new Set();
      for(const clause of ruleSnapshot.candidateRetrievalClauses){
        const evidence=query.identityEvidence.filter((item)=>item.anchorKind===clause.anchorKind);
        if(evidence.length===0) continue;
        const matches=repo.invoke('find_anchors_by_kind',{anchor_kind:clause.anchorKind}).filter((anchor)=>{
          if(clause.anchorKind!=='title_year')return evidence.some((item)=>anchorValuesMatch(item.anchorValue,anchor.anchor_value,clause.lookupMode,clause.normalizationProfileRef,clause.threshold));
          const aliases=deriveTitleYearEvidence(anchor.anchor_value,{providerDelimited:true});
          return evidence.some((item)=>aliases.some((alias)=>normalizeAlias(item.anchorValue)===normalizeAlias(alias.anchorValue)));
        });
        const clauseIds=[...new Set(matches.map((item)=>item.perception_id))].sort();
        if(clauseIds.length>clause.maxCandidates) fail('P6_PERCEPTION_CANDIDATE_CLAUSE_OVERFLOW','Candidate retrieval clause exceeded its declared bound.');
        clauseIds.forEach((id)=>ids.add(id));
      }
      if(ids.size>ruleSnapshot.maxCandidateRecords) fail('P6_PERCEPTION_CANDIDATE_SET_OVERFLOW','Candidate Record set exceeded the frozen Rule bound.');
      const values=[...ids].sort().map((id)=>mapRecord(repo,id));
      const related=repo.invoke('list_relations').filter((row)=>ids.has(row.source_perception_id)||ids.has(row.target_perception_id)).map(mapRelationRow);
      if(related.length>1024) fail('P6_PERCEPTION_RELATION_SET_OVERFLOW','Candidate relation set exceeded 1024.');
      return Object.freeze({ records:Object.freeze(values), relations:Object.freeze(related) });
    }); },
    createResolutionCommitParticipant(handle, draft) {
      validateResolutionCommit(handle, draft);
      return Object.freeze({ participantId:'perception_resolution_commit', owner:'perception', repositories:[records, resolutions],
        execute(context) {
          const relationIds = draft.duplicateRelationDrafts.map((relation) => 'relation-' + canonicalDigest({
            relationKind:'duplicate_of', sourcePerceptionId:relation.sourcePerceptionId,
            targetPerceptionId:relation.targetPerceptionId, ruleRevision:relation.ruleRevision,
            evidenceDigest:relation.evidenceDigest
          }));
          const revision = handle.expectedRevision + 1;
          const resultBody = { queryContract:draft.queryContract, querySchemaRef:draft.querySchemaRef,
            queryInputDigest:draft.queryInputDigest, factKind:draft.factKind, recordSetDigest:draft.recordSetDigest,
            ruleRevision:draft.ruleRevision, ruleDigest:draft.ruleDigest, resultKind:draft.resultKind,
            ...(draft.resultKind === 'found' ? { winningPerceptionId:draft.winningPerceptionId,
              resolvedValue:draft.resolvedValue, resolvedProvenance:draft.resolvedProvenance } : { reasonCode:draft.reasonCode }),
            committedRelationIds:relationIds };
          const result = Object.freeze({ schemaRef:RESOLUTION_RESULT_SCHEMA, schemaVersion:1,
            factId:handle.handleId, ownerDomain:'perception', aggregateType:'perception-resolution',
            aggregateId:handle.aggregateId, revision, factSchemaRef:RESOLUTION_RESULT_SCHEMA,
            factDigest:canonicalDigest(resultBody), commitMarker:handle.commitIdempotencyKey,
            committedAtMs:context.commitTimeMs, ...resultBody });
          const recordRepo = context.repository(records.repositoryId);
          for (let index = 0; index < draft.duplicateRelationDrafts.length; index += 1) {
            const relation = draft.duplicateRelationDrafts[index];
            insertRelation(recordRepo, createRelation({ relationId:relationIds[index], relationKind:'duplicate_of',
              sourcePerceptionId:relation.sourcePerceptionId, targetPerceptionId:relation.targetPerceptionId,
              ruleRevision:relation.ruleRevision, evidenceDigest:relation.evidenceDigest, committedAtMs:context.commitTimeMs }));
          }
          commitResolution(recordRepo, context.repository(resolutions.repositoryId), result, draft, handle.expectedRevision, context.commitTimeMs);
          return result;
        } });
    },
    getResolution(queryContract, queryInputDigest) { return execute([resolutions], (context) => { const repo = context.repository(resolutions.repositoryId); const head = repo.invoke('find_head', { query_contract: queryContract, query_input_digest: queryInputDigest }); return head ? mapResolution(repo.invoke('find_resolution', { resolution_id: head.current_resolution_id })) : undefined; }); }
  });
}

function validateResolutionCommit(handle, draft) {
  const requiredKeys = ['schemaRef','schemaVersion','draftId','draftKind','basisDigest','draftDigest','producedAtMs',
    'queryContract','querySchemaRef','queryInputDigest','factKind','recordSetDigest','ruleRevision','ruleDigest',
    'resultKind','duplicateRelationDrafts'];
  const optionalKeys = ['winningPerceptionId','resolvedValue','resolvedProvenance','reasonCode'];
  const body = draft && Object.fromEntries(Object.entries(draft).filter(([key]) => !['schemaRef','schemaVersion','draftId','draftKind','basisDigest','draftDigest','producedAtMs'].includes(key)));
  const found = draft?.resultKind === 'found';
  const foundFields = draft && ['winningPerceptionId','resolvedValue','resolvedProvenance'].every((key) => Object.hasOwn(draft,key));
  const notFoundFields = draft && Object.hasOwn(draft,'reasonCode');
  if (!handle || handle.ownerDomain !== 'perception' || handle.aggregateType !== 'perception-resolution' ||
      handle.factType !== 'PerceptionResolutionDraft' || handle.factSchemaRef !== RESOLUTION_DRAFT_SCHEMA ||
      handle.resultSchemaRef !== RESOLUTION_RESULT_SCHEMA || !draft || draft.schemaRef !== RESOLUTION_DRAFT_SCHEMA ||
      draft.schemaVersion !== 1 || draft.draftKind !== 'perception_resolution' ||
      requiredKeys.some((key) => !Object.hasOwn(draft, key)) || Object.keys(draft).some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key)) ||
      draft.draftDigest !== canonicalDigest(body) ||
      handle.aggregateId !== 'perception-resolution:' + canonicalDigest({
        queryContract:draft.queryContract, queryInputDigest:draft.queryInputDigest
      }) || handle.payloadDigest !== canonicalDigest(draft) || !Array.isArray(draft.duplicateRelationDrafts) ||
      draft.duplicateRelationDrafts.length > 1024 || !Number.isSafeInteger(draft.ruleRevision) || draft.ruleRevision < 1 ||
      !['rating','watched'].includes(draft.factKind) || !['found','not_found'].includes(draft.resultKind) ||
      (found ? (!foundFields || notFoundFields) : (foundFields || !notFoundFields || !['no_matching_record','requested_fact_absent','strongest_value_conflict'].includes(draft.reasonCode))) ||
      (found && (draft.resolvedValue?.factKind !== draft.factKind || draft.resolvedProvenance?.winningPerceptionId !== draft.winningPerceptionId))) {
    fail('P6_PERCEPTION_RESOLUTION_COMMIT_MISMATCH', 'Resolution Commit Handle does not fence the exact typed Resolution Draft.');
  }
  for (const relation of draft.duplicateRelationDrafts) {
    if (!relation || Object.keys(relation).length !== 4 ||
        ['sourcePerceptionId','targetPerceptionId','ruleRevision','evidenceDigest'].some((key) => !Object.hasOwn(relation, key)) ||
        relation.sourcePerceptionId >= relation.targetPerceptionId || relation.ruleRevision !== draft.ruleRevision) {
      fail('P6_PERCEPTION_DUPLICATE_RELATION_INVALID', 'Duplicate relation pairs must be normalized and use the frozen Resolution rule revision.');
    }
  }
}

function commitResolution(recordRepo, resolutionRepo, result, draft, expectedRevision, now) {
  if (result.resultKind === 'found' && !recordRepo.invoke('find_record', { perception_id:result.winningPerceptionId })) {
    fail('P6_PERCEPTION_RESOLUTION_WINNER_MISSING', 'Resolution winner does not exist.');
  }
  const head = resolutionRepo.invoke('find_head', { query_contract:result.queryContract, query_input_digest:result.queryInputDigest });
  if (!head) {
    if (expectedRevision !== 0 || result.revision !== 1) fail('P6_PERCEPTION_RESOLUTION_REVISION_CONFLICT', 'First Resolution must start at revision 1.');
    resolutionRepo.invoke('insert_resolution', resolutionRow(result, draft, now));
    resolutionRepo.invoke('insert_head', headRow({ resolutionId:result.factId, queryContract:result.queryContract, queryInputDigest:result.queryInputDigest, revision:result.revision }, now));
  } else {
    if (head.current_revision !== expectedRevision || result.revision !== expectedRevision + 1) fail('P6_PERCEPTION_RESOLUTION_REVISION_CONFLICT', 'Resolution revision is stale or skipped.');
    resolutionRepo.invoke('insert_resolution', resolutionRow(result, draft, now));
    const changed = resolutionRepo.invoke('advance_head', { current_resolution_id:result.factId, current_revision:result.revision,
      updated_at_ms:now, query_contract:result.queryContract, query_input_digest:result.queryInputDigest,
      expected_current_revision:expectedRevision });
    if (changed.changes !== 1) fail('P6_PERCEPTION_RESOLUTION_REVISION_CONFLICT', 'Resolution head CAS failed.');
  }
  return result;
}

function commitPage(repo, input, now) {
  const replay = repo.invoke('find_commit_marker', { commit_marker: input.commitMarker });
  if (replay) {
    const commit = mapCommit(replay);
    if (commit.acquisitionCommitReceiptId !== input.acquisitionCommitReceiptId || commit.perceptionAcquisitionId !== input.perceptionAcquisitionId ||
        commit.perceptionSourceId !== input.perceptionSourceId || commit.pageOrdinal !== input.pageOrdinal ||
        commit.expectedCursorRevision !== input.expectedCursorRevision || commit.observationPageDigest !== input.observationPageDigest) {
      fail('P6_PERCEPTION_COMMIT_REPLAY_DRIFT', 'Commit marker replay changed its signed page basis.');
    }
    const cursorRowValue = repo.invoke('find_cursor', { perception_source_id: input.perceptionSourceId, revision: commit.committedCursorRevision });
    if (!cursorRowValue) fail('P6_PERCEPTION_COMMIT_REPLAY_CORRUPT', 'Commit replay no longer resolves its cursor revision.');
    const cursor = createCursor({ perceptionSourceId:cursorRowValue.perception_source_id, revision:cursorRowValue.revision,
      perceptionAcquisitionId:cursorRowValue.perception_acquisition_id, cursorIn:cursorRowValue.cursor_in, cursorOut:cursorRowValue.cursor_out,
      observationPageDigest:cursorRowValue.observation_page_digest, hasMore:Boolean(cursorRowValue.has_more), committedAtMs:cursorRowValue.committed_at_ms });
    return Object.freeze({ commit, cursor, perceptionIds: commit.result.perceptionIds, relationIds: commit.result.relationIds, replayed: true });
  }
  const source = repo.invoke('find_source', { perception_source_id: input.perceptionSourceId }); const acquisition = repo.invoke('find_acquisition', { perception_acquisition_id: input.perceptionAcquisitionId });
  if (!source || !acquisition || acquisition.state !== 'active' || acquisition.perception_source_id !== source.perception_source_id || acquisition.source_config_revision !== source.config_revision) fail('P6_PERCEPTION_PAGE_BASIS_STALE', 'Page must commit against its active frozen Source acquisition.');
  if ((source.current_cursor_revision || 0) !== input.expectedCursorRevision) fail('P6_PERCEPTION_CURSOR_REVISION_CONFLICT', 'Cursor head CAS is stale.');
  if (input.expectedCursorRevision < acquisition.initial_cursor_revision) fail('P6_PERCEPTION_CURSOR_REVISION_CONFLICT', 'Page cursor precedes its Acquisition basis.');
  if (input.expectedCursorRevision === acquisition.initial_cursor_revision) {
    if (input.cursorIn !== acquisition.initial_cursor_value) fail('P6_PERCEPTION_CURSOR_INPUT_MISMATCH', 'First page cursor does not match the frozen Acquisition basis.');
  } else {
    const previous = repo.invoke('find_cursor', { perception_source_id: input.perceptionSourceId, revision: input.expectedCursorRevision });
    if (!previous || input.cursorIn !== previous.cursor_out) fail('P6_PERCEPTION_CURSOR_INPUT_MISMATCH', 'Next page cursor must continue the immutable cursor history.');
  }
  const nextRevision = input.expectedCursorRevision + 1;
  const candidates = input.records.map((value) => createRecordWithDigest({ ...value, perceptionSourceId: input.perceptionSourceId, perceptionAcquisitionId: input.perceptionAcquisitionId, acquisitionCommitReceiptId: input.acquisitionCommitReceiptId, committedAtMs: now }));
  const items = []; let duplicateCount = 0;
  for (const item of candidates) {
    const existing = repo.invoke('find_record_identity', { perception_source_id:item.perceptionSourceId, source_record_key:item.sourceRecordKey,
      source_record_revision:item.sourceRecordRevision, source_record_digest:item.sourceRecordDigest });
    if (existing) duplicateCount += 1; else items.push(item);
  }
  const relations = input.relations.map((value) => createRelation({ ...value, committedAtMs: now }));
  if (relations.some((relation) => relation.relationKind === 'duplicate_of')) fail('P6_PERCEPTION_PAGE_DUPLICATE_RELATION', 'Acquisition page may commit only explicit source-lineage relations.');
  for (const item of items.filter((record) => record.recordKind === 'correction' || record.recordKind === 'retraction')) {
    const expected = item.recordKind === 'correction' ? 'supersedes' : 'retracts';
    if (!relations.some((relation) => relation.sourcePerceptionId === item.perceptionId && relation.relationKind === expected)) fail('P6_PERCEPTION_LINEAGE_REQUIRED', 'Correction/retraction requires its matching outgoing lineage relation.');
  }
  const result = createCommitResult(input, acquisition, items, relations, duplicateCount, nextRevision, now);
  const resultJson = canonicalJson(result); const resultDigest = canonicalDigest(result);
  if (Buffer.byteLength(resultJson, 'utf8') > 65536) fail('P6_PERCEPTION_RESULT_BOUND', 'Page Result exceeds 64 KiB.');
  repo.invoke('insert_commit', { acquisition_commit_receipt_id: input.acquisitionCommitReceiptId, perception_acquisition_id: input.perceptionAcquisitionId,
    perception_source_id: input.perceptionSourceId, page_ordinal: input.pageOrdinal, expected_cursor_revision: input.expectedCursorRevision,
    committed_cursor_revision: nextRevision, observation_page_digest: input.observationPageDigest, commit_marker: input.commitMarker,
    result_schema_ref: RECORD_COMMIT_RESULT_SCHEMA, result_json: resultJson, result_digest: resultDigest, committed_at_ms: now });
  const pageRecords = new Set();
  for (const item of items) { pageRecords.add(item.perceptionId); repo.invoke('insert_record', recordRow(item)); for (const anchor of item.anchors) repo.invoke('insert_anchor', anchorRow(item.perceptionId, anchor)); }
  for (const relation of relations) insertRelation(repo, relation);
  const cursor = createCursor({ perceptionSourceId: input.perceptionSourceId, revision: nextRevision, perceptionAcquisitionId: input.perceptionAcquisitionId,
    cursorIn: input.cursorIn, cursorOut: input.cursorOut, observationPageDigest: input.observationPageDigest, hasMore: input.hasMore, committedAtMs: now }); repo.invoke('insert_cursor', cursorRow(cursor));
  const changed = input.expectedCursorRevision === 0 ? repo.invoke('initialize_cursor_head', { current_cursor_revision: nextRevision, updated_at_ms: now, perception_source_id: input.perceptionSourceId }) : repo.invoke('advance_cursor_head', { current_cursor_revision: nextRevision, updated_at_ms: now, perception_source_id: input.perceptionSourceId, expected_cursor_revision: input.expectedCursorRevision });
  if (changed.changes !== 1) fail('P6_PERCEPTION_CURSOR_REVISION_CONFLICT', 'Cursor head CAS failed.');
  if (!input.hasMore) { const terminal = repo.invoke('terminal_acquisition', { state: 'completed', terminal_at_ms: now, perception_acquisition_id: input.perceptionAcquisitionId, expected_state: 'active' }); if (terminal.changes !== 1) fail('P6_PERCEPTION_ACQUISITION_STATE_CONFLICT', 'Acquisition terminal CAS failed.'); }
  return Object.freeze({ commit: mapCommit(repo.invoke('find_commit', { acquisition_commit_receipt_id: input.acquisitionCommitReceiptId })), cursor, perceptionIds: Object.freeze([...pageRecords]), relationIds: Object.freeze(relations.map((item) => item.relationId)), replayed: false });
}

function insertRelation(repo, item) { if (!repo.invoke('find_record', { perception_id: item.sourcePerceptionId }) || !repo.invoke('find_record', { perception_id: item.targetPerceptionId })) fail('P6_PERCEPTION_RELATION_RECORD_MISSING', 'Relation endpoints must exist.'); repo.invoke('insert_relation', relationRow(item)); return item; }
function pageInputFromDraft(repo, handle, draft) {
  if (!draft || draft.schemaRef !== 'helix://contracts/types/PerceptionAcquisitionCommitDraft/v1' || draft.schemaVersion !== 1 ||
      !draft.source || !draft.cursorTransition || !Array.isArray(draft.records) || !Array.isArray(draft.sourceLineageRelations)) {
    fail('P6_PERCEPTION_COMMIT_DRAFT_INVALID', 'Record Commit requires the exact Perception Acquisition Commit Draft.');
  }
  const relations = draft.sourceLineageRelations.map((relation) => {
    const target = repo.invoke('find_record_identity', { perception_source_id:draft.source.sourceId,
      source_record_key:relation.targetSourceRecord.sourceRecordKey, source_record_revision:relation.targetSourceRecord.sourceRecordRevision,
      source_record_digest:relation.targetSourceRecord.sourceRecordDigest });
    if (!target) fail('P6_PERCEPTION_LINEAGE_TARGET_MISSING', 'Source-lineage target does not resolve to an immutable Record.');
    return { relationId:'relation-' + canonicalDigest({ acquisitionId:draft.perceptionAcquisitionId, relation }), relationKind:relation.relationKind,
      sourcePerceptionId:relation.sourceDraftId, targetPerceptionId:target.perception_id,
      ruleRevision:relation.ruleRevision, evidenceDigest:relation.evidenceDigest };
  });
  const explicitSources = new Set(relations.map((relation) => relation.sourcePerceptionId));
  const terminalTargets = new Set(repo.invoke('list_relations')
    .filter((relation) => ['supersedes','retracts'].includes(relation.relation_kind))
    .map((relation) => relation.target_perception_id));
  for (const item of draft.records) {
    if (explicitSources.has(item.draftId)) continue;
    const exactRecord = repo.invoke('find_record_identity', {
      perception_source_id:draft.source.sourceId,
      source_record_key:item.sourceRecordKey,
      source_record_revision:item.sourceRecordRevision,
      source_record_digest:item.sourceRecordDigest
    });
    if (exactRecord) continue;
    const prior = repo.invoke('find_records_by_source_key', {
      perception_source_id:draft.source.sourceId,
      source_record_key:item.sourceRecordKey
    }).filter((record) => !terminalTargets.has(record.perception_id))
      .sort((left,right) => right.committed_at_ms-left.committed_at_ms || right.perception_id.localeCompare(left.perception_id))[0];
    if (!prior) continue;
    const evidenceDigest = canonicalDigest({
      rule:'same-source-record-key-new-revision',
      perceptionSourceId:draft.source.sourceId,
      sourceRecordKey:item.sourceRecordKey,
      priorPerceptionId:prior.perception_id,
      priorSourceRecordRevision:prior.source_record_revision,
      priorSourceRecordDigest:prior.source_record_digest,
      nextPerceptionId:item.draftId,
      nextSourceRecordRevision:item.sourceRecordRevision,
      nextSourceRecordDigest:item.sourceRecordDigest
    });
    relations.push({
      relationId:'relation-' + canonicalDigest({
        relationKind:'supersedes',
        sourcePerceptionId:item.draftId,
        targetPerceptionId:prior.perception_id,
        ruleRevision:1,
        evidenceDigest
      }),
      relationKind:'supersedes',
      sourcePerceptionId:item.draftId,
      targetPerceptionId:prior.perception_id,
      ruleRevision:1,
      evidenceDigest
    });
  }
  return { acquisitionCommitReceiptId:handle.handleId, perceptionAcquisitionId:draft.perceptionAcquisitionId,
    perceptionSourceId:draft.source.sourceId, pageOrdinal:draft.cursorTransition.pageOrdinal,
    expectedCursorRevision:draft.cursorTransition.expectedCursorRevision, cursorIn:draft.cursorTransition.cursorIn,
    cursorOut:draft.cursorTransition.cursorOut, observationPageDigest:draft.cursorTransition.observationPageDigest,
    hasMore:draft.cursorTransition.hasMore, commitMarker:handle.commitIdempotencyKey,
    records:draft.records.map((item) => ({ perceptionId:item.draftId, recordKind:item.recordKind, sourceKind:draft.source.sourceKind,
      sourceRecordKey:item.sourceRecordKey, sourceRecordRevision:item.sourceRecordRevision, sourceRecordDigest:item.sourceRecordDigest,
      normalizationRuleRef:draft.normalizationRuleRef, rating:Object.hasOwn(item, 'rating') ? item.rating : null,
      watchedState:Object.hasOwn(item, 'watchedState') ? item.watchedState : null, observedTitle:item.observedTitle,
      provenanceRef:item.provenanceRef, provenanceDigest:item.provenanceDigest, observedAtMs:item.observedAtMs, anchors:item.identityAnchors })),
    relations };
}
function createCommitResult(input, acquisition, records, relations, duplicateCount, committedCursorRevision, committedAtMs) { return Object.freeze({
  schemaRef: RECORD_COMMIT_RESULT_SCHEMA, schemaVersion: 1, receiptId: input.acquisitionCommitReceiptId,
  receiptKind: 'perception_acquisition_page_commit', ownerDomain: 'perception', scopeType: 'perception_acquisition',
  scopeId: input.perceptionAcquisitionId, scopeDigest: acquisition.scope_digest, effectReceiptRef: null, committedAtMs,
  acquisitionCommitReceiptId: input.acquisitionCommitReceiptId, perceptionAcquisitionId: input.perceptionAcquisitionId,
  sourceId: input.perceptionSourceId, committedCursorRevision, perceptionIds: Object.freeze(records.map((item) => item.perceptionId)),
  relationIds: Object.freeze(relations.map((item) => item.relationId)), insertedCount: records.length, duplicateCount
}); }
const mapSource = (r) => r && createSource({ perceptionSourceId:r.perception_source_id,sourceKind:r.source_kind,integrationId:r.integration_id,status:r.status,configRevision:r.config_revision,currentCursorRevision:r.current_cursor_revision,createdAtMs:r.created_at_ms,updatedAtMs:r.updated_at_ms });
const acquisitionRow = (v) => ({ perception_acquisition_id:v.perceptionAcquisitionId,perception_source_id:v.perceptionSourceId,source_config_revision:v.sourceConfigRevision,scope_schema_ref:v.scopeSchemaRef,scope_json:v.scopeJson,scope_digest:v.scopeDigest,initial_cursor_revision:v.initialCursorRevision,initial_cursor_value:v.initialCursorValue,state:v.state,created_at_ms:v.createdAtMs,terminal_at_ms:v.terminalAtMs });
const mapAcquisition = (r) => r && createAcquisition({ perceptionAcquisitionId:r.perception_acquisition_id,perceptionSourceId:r.perception_source_id,sourceConfigRevision:r.source_config_revision,scopeSchemaRef:r.scope_schema_ref,scopeJson:r.scope_json,scopeDigest:r.scope_digest,initialCursorRevision:r.initial_cursor_revision,initialCursorValue:r.initial_cursor_value,state:r.state,createdAtMs:r.created_at_ms,terminalAtMs:r.terminal_at_ms });
const cursorRow = (v) => ({ perception_source_id:v.perceptionSourceId,revision:v.revision,perception_acquisition_id:v.perceptionAcquisitionId,cursor_in:v.cursorIn,cursor_out:v.cursorOut,observation_page_digest:v.observationPageDigest,has_more:v.hasMore?1:0,committed_at_ms:v.committedAtMs });
const recordRow = (v) => ({ perception_id:v.perceptionId,perception_source_id:v.perceptionSourceId,perception_acquisition_id:v.perceptionAcquisitionId,acquisition_commit_receipt_id:v.acquisitionCommitReceiptId,record_kind:v.recordKind,source_kind:v.sourceKind,source_record_key:v.sourceRecordKey,source_record_revision:v.sourceRecordRevision,source_record_digest:v.sourceRecordDigest,normalization_rule_ref:v.normalizationRuleRef,rating:v.rating,watched_state:v.watchedState===null?null:(v.watchedState?1:0),observed_title:v.observedTitle,provenance_ref:v.provenanceRef,provenance_digest:v.provenanceDigest,record_digest:v.recordDigest,observed_at_ms:v.observedAtMs,committed_at_ms:v.committedAtMs });
const anchorRow = (id,v) => ({ perception_id:id,anchor_kind:v.anchorKind,anchor_value:v.anchorValue,confidence_class:v.confidenceClass,evidence_digest:v.evidenceDigest });
const relationRow = (v) => ({ relation_id:v.relationId,relation_kind:v.relationKind,source_perception_id:v.sourcePerceptionId,target_perception_id:v.targetPerceptionId,rule_revision:v.ruleRevision,evidence_digest:v.evidenceDigest,committed_at_ms:v.committedAtMs });
function mapRecord(repo,id) { const r=repo.invoke('find_record',{perception_id:id}); if(!r)return undefined; const item=createRecord({perceptionId:r.perception_id,perceptionSourceId:r.perception_source_id,perceptionAcquisitionId:r.perception_acquisition_id,acquisitionCommitReceiptId:r.acquisition_commit_receipt_id,recordKind:r.record_kind,sourceKind:r.source_kind,sourceRecordKey:r.source_record_key,sourceRecordRevision:r.source_record_revision,sourceRecordDigest:r.source_record_digest,normalizationRuleRef:r.normalization_rule_ref,rating:r.rating,watchedState:r.watched_state===null?null:r.watched_state===1,observedTitle:r.observed_title,provenanceRef:r.provenance_ref,provenanceDigest:r.provenance_digest,recordDigest:r.record_digest,observedAtMs:r.observed_at_ms,committedAtMs:r.committed_at_ms,anchors:repo.invoke('find_anchors',{perception_id:id}).map(a=>({anchorKind:a.anchor_kind,anchorValue:a.anchor_value,confidenceClass:a.confidence_class,evidenceDigest:a.evidence_digest}))}); if(recordDigestFor(item)!==item.recordDigest) fail('P6_PERCEPTION_RECORD_DIGEST_MISMATCH','Stored immutable Record digest does not match its scalar and Anchor facts.'); return item; }

function recordDigestFor(value) {
  const anchors = [...value.anchors].sort((left, right) => [left.anchorKind,left.anchorValue,left.confidenceClass,left.evidenceDigest].join('\0').localeCompare([right.anchorKind,right.anchorValue,right.confidenceClass,right.evidenceDigest].join('\0')));
  return canonicalDigest({ perceptionId:value.perceptionId, perceptionSourceId:value.perceptionSourceId,
    perceptionAcquisitionId:value.perceptionAcquisitionId, acquisitionCommitReceiptId:value.acquisitionCommitReceiptId,
    recordKind:value.recordKind, sourceKind:value.sourceKind, sourceRecordKey:value.sourceRecordKey,
    sourceRecordRevision:value.sourceRecordRevision, sourceRecordDigest:value.sourceRecordDigest,
    normalizationRuleRef:value.normalizationRuleRef, rating:value.rating, watchedState:value.watchedState,
    observedTitle:value.observedTitle, provenanceRef:value.provenanceRef, provenanceDigest:value.provenanceDigest,
    observedAtMs:value.observedAtMs, committedAtMs:value.committedAtMs, identityAnchors:anchors });
}
function createRecordWithDigest(value) { return createRecord({ ...value, recordDigest:recordDigestFor(value) }); }
function normalizeAnchor(value, profile) {
  if (!profile || profile === 'identity') return value;
  if (profile === 'unicode_nfkc_casefold') return value.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/\s+/g,' ');
  if (profile === 'alphanumeric_casefold') return value.normalize('NFKC').toLocaleLowerCase('und').replace(/[^\p{L}\p{N}]+/gu,'');
  fail('P6_PERCEPTION_NORMALIZATION_PROFILE_UNKNOWN','Rule references an unknown normalization profile.',{profile});
}
function similarity(left,right) { const a=[...left],b=[...right]; if(a.length===0&&b.length===0)return 1; const row=Array.from({length:b.length+1},(_,i)=>i); for(let i=1;i<=a.length;i+=1){let diagonal=row[0];row[0]=i;for(let j=1;j<=b.length;j+=1){const prior=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=prior;}} return 1-row[b.length]/Math.max(a.length,b.length,1); }
function anchorValuesMatch(left,right,mode,profile,threshold) { if(mode==='exact')return left===right; const a=normalizeAnchor(left,profile),b=normalizeAnchor(right,profile); if(mode==='normalized_exact')return a===b; if(mode==='bounded_fuzzy')return similarity(a,b)>=threshold; fail('P6_PERCEPTION_LOOKUP_MODE_UNKNOWN','Rule contains an unknown candidate lookup mode.'); }
const mapRelationRow=(r)=>Object.freeze({relationId:r.relation_id,relationKind:r.relation_kind,sourcePerceptionId:r.source_perception_id,targetPerceptionId:r.target_perception_id,ruleRevision:r.rule_revision,evidenceDigest:r.evidence_digest});
function mapCommit(r) { if (!r) return undefined; let result; try { result = JSON.parse(r.result_json); } catch { fail('P6_PERCEPTION_STORED_RESULT_INVALID', 'Stored page Result is not valid JSON.'); }
  if (r.result_schema_ref !== RECORD_COMMIT_RESULT_SCHEMA || result.schemaRef !== r.result_schema_ref || canonicalJson(result) !== r.result_json || canonicalDigest(result) !== r.result_digest) fail('P6_PERCEPTION_STORED_RESULT_INVALID', 'Stored page Result failed its nominal JCS integrity check.');
  return Object.freeze({ acquisitionCommitReceiptId:r.acquisition_commit_receipt_id,perceptionAcquisitionId:r.perception_acquisition_id,perceptionSourceId:r.perception_source_id,pageOrdinal:r.page_ordinal,expectedCursorRevision:r.expected_cursor_revision,committedCursorRevision:r.committed_cursor_revision,observationPageDigest:r.observation_page_digest,commitMarker:r.commit_marker,resultSchemaRef:r.result_schema_ref,result:Object.freeze(result),resultDigest:r.result_digest,committedAtMs:r.committed_at_ms }); }
const resolutionRow=(v,draft,now)=>({resolution_id:v.factId,query_contract:v.queryContract,query_schema_ref:v.querySchemaRef,query_input_digest:v.queryInputDigest,fact_kind:v.factKind,revision:v.revision,record_set_digest:v.recordSetDigest,rule_revision:v.ruleRevision,rule_digest:v.ruleDigest,result_kind:v.resultKind,winning_perception_id:v.resultKind==='found'?v.winningPerceptionId:null,reason_code:v.resultKind==='not_found'?v.reasonCode:null,result_schema_ref:RESOLUTION_RESULT_SCHEMA,result_json:canonicalJson(v),result_digest:canonicalDigest(v),resolved_at_ms:now});
const headRow=(v,t)=>({query_contract:v.queryContract,query_input_digest:v.queryInputDigest,current_resolution_id:v.resolutionId,current_revision:v.revision,updated_at_ms:t});
function mapResolution(r) { if(!r)return undefined; let result; try{result=JSON.parse(r.result_json);}catch{fail('P6_PERCEPTION_STORED_RESOLUTION_INVALID','Stored Resolution is not valid JSON.');} if(r.result_schema_ref!==RESOLUTION_RESULT_SCHEMA||result.schemaRef!==RESOLUTION_RESULT_SCHEMA||canonicalJson(result)!==r.result_json||canonicalDigest(result)!==r.result_digest||result.factId!==r.resolution_id||result.queryContract!==r.query_contract||result.querySchemaRef!==r.query_schema_ref||result.queryInputDigest!==r.query_input_digest||result.factKind!==r.fact_kind||result.revision!==r.revision||result.recordSetDigest!==r.record_set_digest||result.ruleRevision!==r.rule_revision||result.ruleDigest!==r.rule_digest||result.resultKind!==r.result_kind||(result.winningPerceptionId||null)!==r.winning_perception_id||(result.reasonCode||null)!==r.reason_code){fail('P6_PERCEPTION_STORED_RESOLUTION_INVALID','Stored Resolution failed typed JCS or scalar integrity checks.');} return Object.freeze(result); }

module.exports = Object.freeze({ PerceptionStoreError, createPerceptionStore });
