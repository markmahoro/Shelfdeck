'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

class PerceptionResolutionInputError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PerceptionResolutionInputError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new PerceptionResolutionInputError(code, message, details); }
function freeze(value) { return Array.isArray(value) ? Object.freeze(value.map(freeze)) : value && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,freeze(item)]))) : value; }
function digestWithout(value, field) { return canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!==field))); }
function bounded(value, bytes, code) { if(Buffer.byteLength(canonicalJson(value),'utf8')>bytes) fail(code,'Canonical typed value exceeds its SSOT byte bound.'); }

function createPerceptionResolutionInputAssembler(options) {
  if(!options?.store || typeof options.store.readResolutionCandidates!=='function') fail('P6_PERCEPTION_RESOLUTION_ASSEMBLER_DEPENDENCIES','Perception Repository reader is required.');
  return Object.freeze({
    assemble({ queryHandle, ruleSnapshot }) {
      const query=queryHandle?.typedInput;
      if(!queryHandle || queryHandle.providerDomain!=='perception' || !query || queryHandle.queryContract!==query.queryContract ||
          queryHandle.queryVersion!==query.queryVersion || queryHandle.typedInputSchemaRef!==query.querySchemaRef ||
          queryHandle.inputDigest!==query.queryInputDigest || !['rating','watched'].includes(query.factKind) ||
          !Array.isArray(query.identityEvidence) || query.identityEvidence.length>16 || digestWithout(query,'queryInputDigest')!==query.queryInputDigest) {
        fail('P6_PERCEPTION_QUERY_HANDLE_INVALID','Canonical Query Handle does not contain the exact digest-bound Perception query.');
      }
      bounded(query,16384,'P6_PERCEPTION_QUERY_BOUND');
      validateRule(ruleSnapshot,query.factKind);
      const snapshot=options.store.readResolutionCandidates(query,ruleSnapshot);
      const records=snapshot.records.map((record)=>{
        const facts={}; if(record.rating!==null)facts.rating=record.rating; if(record.watchedState!==null)facts.watchedState=record.watchedState;
        return { perceptionId:record.perceptionId, recordKind:record.recordKind, sourceKind:record.sourceKind,
          sourceRecordKey:record.sourceRecordKey, sourceRecordRevision:record.sourceRecordRevision, recordDigest:record.recordDigest,
          facts, observedTitle:record.observedTitle, observedAtMs:record.observedAtMs, identityAnchors:record.anchors,
          provenanceRef:record.provenanceRef, provenanceDigest:record.provenanceDigest };
      }).sort((left,right)=>left.perceptionId.localeCompare(right.perceptionId));
      const relations=[...snapshot.relations].sort((left,right)=>left.relationId.localeCompare(right.relationId));
      const basis={queryInputDigest:query.queryInputDigest,records,relations};
      const recordSet=freeze({...basis,recordSetDigest:canonicalDigest(basis)});
      bounded(recordSet,512*1024,'P6_PERCEPTION_RECORD_SET_BOUND');
      return freeze({ query, recordSet, ruleSnapshot });
    }
  });
}

function validateRule(rule,factKind){
  if(!rule || !Array.isArray(rule.supportedFactKinds)||!rule.supportedFactKinds.includes(factKind)||
      !Array.isArray(rule.candidateRetrievalClauses)||rule.candidateRetrievalClauses.length>32||
      !Array.isArray(rule.anchorMatchers)||rule.anchorMatchers.length>32||
      !Array.isArray(rule.duplicateProofMatchers)||rule.duplicateProofMatchers.length>32||
      rule.maxCandidateRecords!==256||rule.winnerOrder!=='strongest_anchor_then_value_consensus_then_perception_id'||
      rule.equalStrengthConflict!=='not_found'||digestWithout(rule,'ruleDigest')!==rule.ruleDigest) {
    fail('P6_PERCEPTION_RULE_SNAPSHOT_INVALID','Resolution Rule Snapshot is incomplete, unsupported, or has a mismatched digest.');
  }
  const ranks=rule.anchorMatchers.map((item)=>item.strengthRank);
  if(ranks.some((rank)=>!Number.isSafeInteger(rank)||rank<1)||new Set(rule.anchorMatchers.map((item)=>item.anchorKind)).size!==rule.anchorMatchers.length) fail('P6_PERCEPTION_RULE_STRENGTH_INVALID','Anchor matchers require unique kinds and positive strength ranks.');
  for(const item of [...rule.candidateRetrievalClauses,...rule.anchorMatchers]){
    const fuzzy=item.lookupMode==='bounded_fuzzy'||item.matchMode==='fuzzy';
    if(fuzzy !== Object.hasOwn(item,'threshold') || fuzzy && (typeof item.threshold!=='number'||item.threshold<0||item.threshold>1)) fail('P6_PERCEPTION_RULE_THRESHOLD_INVALID','Only fuzzy clauses require a bounded threshold.');
  }
  bounded(rule,65536,'P6_PERCEPTION_RULE_BOUND');
}

module.exports = Object.freeze({ PerceptionResolutionInputError, createPerceptionResolutionInputAssembler });
