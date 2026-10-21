'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {canonicalDigest}=require('../../../contracts/canonical-json');

function terminalPresentation(outcome,decision,receipt) {
  if(outcome?.outcome==='unable_to_on_deck'&&outcome.reason_code==='processing_failed')
    return {outcome:'unable_to_on_deck',label:'无法上架'};
  if(outcome?.outcome==='unable_to_on_deck'&&outcome.reason_code==='user_cancelled')
    return {outcome:'user_abandoned',label:'已取消整理任务'};
  // Previously committed explicit admin Discard decisions remain historical
  // facts. Verify their original evidence; never manufacture a new outcome.
  if(outcome===undefined && decision?.actorId==='admin' && receipt &&
      decision.libraRunId===receipt.libra_run_id && decision.discardDecisionId===receipt.discard_decision_id &&
      decision.expectedRunStateRevision+1===Number(receipt.committed_run_state_revision) &&
      canonicalDigest(Object.fromEntries(Object.entries(decision).filter(([key])=>key!=='decisionDigest')))===decision.decisionDigest)
    return {outcome:'user_abandoned',label:'已取消整理任务'};
  throw Object.assign(new Error('Terminal history lacks an explicit business outcome.'),{code:'FORMATION_DISCARD_HISTORY_INTEGRITY'});
}

function createFormationRunHistoryStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Formation Run history store requires clean persistence.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_formation_run_history', owner: 'libra', schemaManifest: options.schemaManifest,
    statements: {
      abandoned_count:{kind:'select-summary',tableId:'libra_subject_abandon_receipts',summaries:[{operator:'count',output:'total'}]},
      abandoned_page:{kind:'select-joined-page',tableId:'libra_subject_abandon_receipts',maxItems:101,
        joins:[{tableId:'libra_formation_projections',alias:'display',on:[{column:'subject_id',otherAlias:'base',otherColumn:'subject_id'}]}],
        filters:[{alias:'display',column:'target_shelf_id',kind:'equals',parameter:'shelf',optional:true},
          {alias:'display',column:'display_identity',kind:'contains',parameter:'query',optional:true}],
        orderBy:[{column:'committed_at_ms',direction:'desc'},{column:'receipt_id',direction:'asc'}],
        columns:['receipt_id','subject_id','commit_digest','committed_at_ms'],safeIntegers:true},
      counts:{kind:'count-grouped',tableId:'libra_run_discard_receipts',groupColumn:'committed_run_state_revision'},
      discarded_page: {
        kind: 'select-joined-page', tableId: 'libra_run_discard_receipts', maxItems: 101,
        joins:[{tableId:'libra_runs',alias:'run',on:[{column:'libra_run_id',otherAlias:'base',otherColumn:'libra_run_id'}]},
          {tableId:'libra_formation_projections',alias:'display',on:[{column:'subject_id',otherAlias:'run',otherColumn:'subject_id'}]}],
        filters:[{alias:'display',column:'target_shelf_id',kind:'equals',parameter:'shelf',optional:true},
          {alias:'display',column:'display_identity',kind:'contains',parameter:'query',optional:true}],
        orderBy: [{ column: 'committed_at_ms', direction: 'desc' }, { column: 'receipt_id', direction: 'asc' }],
        columns: ['receipt_id', 'discard_decision_id', 'libra_run_id', 'committed_run_state_revision', 'commit_digest', 'committed_at_ms'],
        safeIntegers: true,
      },
      runs: {
        kind: 'select-in', tableId: 'libra_runs', keyColumn: 'libra_run_id', maxItems: 101,
        columns: ['libra_run_id', 'subject_id', 'state', 'state_revision', 'state_digest'], safeIntegers: true,
      },
      outcomes:{kind:'select-in',tableId:'libra_run_outcomes',keyColumn:'libra_run_id',maxItems:101,
        columns:['libra_run_id','outcome','reason_code','outcome_digest'],safeIntegers:true},
      terminal_decision:{kind:'select-one',tableId:'libra_run_revisions',keyColumns:['libra_run_id','state_revision'],
        columns:['transition_kind','transition_evidence_json','transition_evidence_digest']},
    },
  });

  function listRunDiscarded(offset, limit, filters={}) {
    return options.unitOfWork.execute([{
      participantId: 'libra_formation_run_history_read', owner: 'libra', repositories: [repository], execute(context) {
        const repo = context.repository(repository.repositoryId);
        const receipts = repo.invoke('discarded_page', { offset, limit,shelf:filters.shelfId||'',query:String(filters.q||'').trim() });
        if (!receipts.length) return Object.freeze([]);
        const runs = new Map(repo.invoke('runs', { values: receipts.map((row) => row.libra_run_id) })
          .map((row) => [row.libra_run_id, row]));
        const outcomes=new Map(repo.invoke('outcomes',{values:receipts.map(row=>row.libra_run_id)}).map(row=>[row.libra_run_id,row]));
        return Object.freeze(receipts.map((receipt) => {
          const run = runs.get(receipt.libra_run_id);
          if (!run || run.state !== 'discarded' || Number(run.state_revision) !== Number(receipt.committed_run_state_revision)) {
            throw Object.assign(new Error('Discarded Formation history cannot be reconstructed.'), {
              code: 'FORMATION_DISCARD_HISTORY_INTEGRITY', libraRunId: receipt.libra_run_id,
            });
          }
          const outcome=outcomes.get(run.libra_run_id);
          let decision;
          if(!outcome) {
            const revision=repo.invoke('terminal_decision',{libra_run_id:run.libra_run_id,state_revision:Number(receipt.committed_run_state_revision)});
            if(revision?.transition_kind==='discarded') {
              decision=JSON.parse(revision.transition_evidence_json);
              if(decision.decisionDigest!==revision.transition_evidence_digest)decision=undefined;
            }
          }
          return Object.freeze({
            historyId: receipt.receipt_id, libraRunId: receipt.libra_run_id, subjectId: run.subject_id,
            ...terminalPresentation(outcome,decision,receipt),
            endedAtMs: Number(receipt.committed_at_ms),
            stateRevision: Number(run.state_revision), stateDigest: run.state_digest, evidenceDigest: receipt.commit_digest,
          });
        }));
      },
    }]).libra_formation_run_history_read;
  }

  function subjectPage(offset,limit,filters){return options.unitOfWork.execute([{participantId:'libra_subject_history',owner:'libra',repositories:[repository],
    execute:context=>context.repository(repository.repositoryId).invoke('abandoned_page',{offset,limit,shelf:filters.shelfId||'',query:String(filters.q||'').trim()})
      .map(row=>({historyId:row.receipt_id,libraRunId:null,subjectId:row.subject_id,outcome:'user_abandoned',label:'已取消整理任务',
        endedAtMs:Number(row.committed_at_ms),stateRevision:null,stateDigest:null,evidenceDigest:row.commit_digest}))}]).libra_subject_history;}
  function listDiscarded(offset,limit,filters={}) {
    const streams=[listRunDiscarded,subjectPage].map(read=>({read,offset:0,rows:[],done:false})),result=[];
    for(let index=0;index<offset+limit;index++){
      for(const stream of streams)if(!stream.rows.length&&!stream.done){
        stream.rows=[...stream.read(stream.offset,100,filters)];stream.offset+=stream.rows.length;stream.done=stream.rows.length<100;
      }
      const stream=streams.filter(item=>item.rows.length).sort((a,b)=>b.rows[0].endedAtMs-a.rows[0].endedAtMs||
        a.rows[0].historyId.localeCompare(b.rows[0].historyId))[0];
      if(!stream)break;
      const row=stream.rows.shift();if(index>=offset)result.push(row);
    }
    return Object.freeze(result);
  }
  function count(){return options.unitOfWork.execute([{participantId:'libra_history_count',owner:'libra',repositories:[repository],execute(context){
    const repo=context.repository(repository.repositoryId);
    return repo.invoke('counts',{}).reduce((sum,row)=>sum+Number(row.row_count),0)+Number(repo.invoke('abandoned_count',{}).total);
  }}]).libra_history_count;}
  return Object.freeze({ listDiscarded,count });
}

module.exports = Object.freeze({ createFormationRunHistoryStore, terminalPresentation });
