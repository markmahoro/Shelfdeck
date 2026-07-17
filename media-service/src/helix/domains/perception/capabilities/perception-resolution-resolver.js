'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const DRAFT_SCHEMA='helix://contracts/types/PerceptionResolutionDraft/v1';

class PerceptionResolutionResolverError extends Error { constructor(code,message,details={}){super(message);this.name='PerceptionResolutionResolverError';this.code=code;this.details=details;} }
function fail(code,message,details){throw new PerceptionResolutionResolverError(code,message,details);}
function freeze(value){return Array.isArray(value)?Object.freeze(value.map(freeze)):value&&typeof value==='object'?Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,freeze(item)]))):value;}
function normalize(value,profile){if(!profile||profile==='identity')return value;if(profile==='unicode_nfkc_casefold')return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');if(profile==='alphanumeric_casefold')return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');fail('P6_PERCEPTION_NORMALIZATION_PROFILE_UNKNOWN','Unknown normalization profile.',{profile});}
function similarity(left,right){const a=[...left],b=[...right],row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i+=1){let diagonal=row[0];row[0]=i;for(let j=1;j<=b.length;j+=1){const prior=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=prior;}}return 1-row[b.length]/Math.max(a.length,b.length,1);}
function confidence(value){const ranks={low:1,medium:2,high:3,strong:4,exact:5};if(!Object.hasOwn(ranks,value))fail('P6_PERCEPTION_CONFIDENCE_CLASS_UNKNOWN','Unknown confidence class.',{value});return ranks[value];}
function matchValue(left,right,mode,profile,threshold){if(mode==='exact')return left===right;const a=normalize(left,profile),b=normalize(right,profile);if(mode==='normalized_exact')return a===b;if(mode==='fuzzy')return similarity(a,b)>=threshold;fail('P6_PERCEPTION_MATCH_MODE_UNKNOWN','Unknown anchor match mode.');}
function fact(record,kind){return kind==='rating'?record.facts.rating:record.facts.watchedState;}

function resolvePerception(inputs, options) {
  const {query,recordSet,ruleSnapshot}=inputs||{};
  if(!query||!recordSet||!ruleSnapshot||recordSet.queryInputDigest!==query.queryInputDigest||
      canonicalDigest(Object.fromEntries(Object.entries(recordSet).filter(([key])=>key!=='recordSetDigest')))!==recordSet.recordSetDigest||
      canonicalDigest(Object.fromEntries(Object.entries(ruleSnapshot).filter(([key])=>key!=='ruleDigest')))!==ruleSnapshot.ruleDigest) fail('P6_PERCEPTION_RESOLUTION_INPUT_DIGEST','Resolver inputs are not the three intact digest-bound values.');
  if(!options||typeof options.draftId!=='string'||!Number.isSafeInteger(options.producedAtMs)||options.producedAtMs<0) fail('P6_PERCEPTION_RESOLUTION_OUTPUT_CONTEXT','Draft identity and production time are required.');
  const terminalTargets=new Set(recordSet.relations.filter((item)=>['supersedes','retracts'].includes(item.relationKind)).map((item)=>item.targetPerceptionId));
  const active=recordSet.records.filter((record)=>record.recordKind!=='retraction'&&!terminalTargets.has(record.perceptionId));
  const matched=active.map((record)=>({record,matches:matchesFor(record,query,ruleSnapshot)})).filter((item)=>item.matches.length>0);
  let decision;
  if(matched.length===0) decision={resultKind:'not_found',reasonCode:'no_matching_record'};
  else {
    const strongest=Math.min(...matched.flatMap((item)=>item.matches.map((match)=>match.strengthRank)));
    const tier=matched.filter((item)=>item.matches.some((match)=>match.strengthRank===strongest));
    const withFacts=tier.filter((item)=>fact(item.record,query.factKind)!==undefined);
    if(withFacts.length===0) decision={resultKind:'not_found',reasonCode:'requested_fact_absent'};
    else {
      const values=new Set(withFacts.map((item)=>JSON.stringify(fact(item.record,query.factKind))));
      if(values.size!==1) decision={resultKind:'not_found',reasonCode:'strongest_value_conflict'};
      else {
        const winner=[...withFacts].sort((left,right)=>left.record.perceptionId.localeCompare(right.record.perceptionId))[0];
        decision={resultKind:'found',winningPerceptionId:winner.record.perceptionId,
          resolvedValue:{factKind:query.factKind,value:fact(winner.record,query.factKind)},
          resolvedProvenance:{winningPerceptionId:winner.record.perceptionId,sourceKind:winner.record.sourceKind,
            sourceRecordKey:winner.record.sourceRecordKey,sourceRecordRevision:winner.record.sourceRecordRevision,
            provenanceRef:winner.record.provenanceRef,provenanceDigest:winner.record.provenanceDigest,
            matchedAnchorEvidence:winner.matches.filter((item)=>item.strengthRank===strongest).map((item)=>({anchorKind:item.anchorKind,strengthRank:item.strengthRank,evidenceDigest:item.evidenceDigest})).sort((a,b)=>a.strengthRank-b.strengthRank||a.anchorKind.localeCompare(b.anchorKind)||a.evidenceDigest.localeCompare(b.evidenceDigest))}};
      }
    }
  }
  const duplicateRelationDrafts=duplicateProofs(active,query.factKind,ruleSnapshot);
  const body={queryContract:query.queryContract,querySchemaRef:query.querySchemaRef,queryInputDigest:query.queryInputDigest,
    factKind:query.factKind,recordSetDigest:recordSet.recordSetDigest,ruleRevision:ruleSnapshot.ruleVersion,
    ruleDigest:ruleSnapshot.ruleDigest,...decision,duplicateRelationDrafts};
  const draft=freeze({schemaRef:DRAFT_SCHEMA,schemaVersion:1,draftId:options.draftId,draftKind:'perception_resolution',
    basisDigest:canonicalDigest({queryInputDigest:query.queryInputDigest,recordSetDigest:recordSet.recordSetDigest,ruleDigest:ruleSnapshot.ruleDigest}),
    draftDigest:canonicalDigest(body),producedAtMs:options.producedAtMs,...body});
  if(Buffer.byteLength(canonicalJson(draft),'utf8')>16384)fail('P6_PERCEPTION_RESOLUTION_DRAFT_BOUND','Resolution Draft exceeds 16 KiB.');
  return draft;
}

function matchesFor(record,query,rule){const result=[];for(const matcher of rule.anchorMatchers){for(const evidence of query.identityEvidence.filter((item)=>item.anchorKind===matcher.anchorKind)){for(const anchor of record.identityAnchors.filter((item)=>item.anchorKind===matcher.anchorKind)){if(confidence(anchor.confidenceClass)>=confidence(matcher.minConfidenceClass)&&matchValue(evidence.anchorValue,anchor.anchorValue,matcher.matchMode,matcher.normalizationProfileRef,matcher.threshold)){result.push({anchorKind:matcher.anchorKind,strengthRank:matcher.strengthRank,evidenceDigest:canonicalDigest({queryEvidenceDigest:evidence.evidenceDigest,recordEvidenceDigest:anchor.evidenceDigest,matcher})});}}}}return result;}
function duplicateProofs(records,factKind,rule){const drafts=[];const sorted=[...records].sort((a,b)=>a.perceptionId.localeCompare(b.perceptionId));for(let i=0;i<sorted.length;i+=1)for(let j=i+1;j<sorted.length;j+=1){const left=sorted[i],right=sorted[j],value=fact(left,factKind);if(value===undefined||JSON.stringify(value)!==JSON.stringify(fact(right,factKind)))continue;const proofs=rule.duplicateProofMatchers.filter((proof)=>left.identityAnchors.some((a)=>a.anchorKind===proof.anchorKind&&confidence(a.confidenceClass)>=confidence(proof.minConfidenceClass)&&right.identityAnchors.some((b)=>b.anchorKind===proof.anchorKind&&b.anchorValue===a.anchorValue&&confidence(b.confidenceClass)>=confidence(proof.minConfidenceClass))));if(proofs.length)drafts.push({sourcePerceptionId:left.perceptionId,targetPerceptionId:right.perceptionId,ruleRevision:rule.ruleVersion,evidenceDigest:canonicalDigest({left:left.recordDigest,right:right.recordDigest,factKind,value,proofs})});}return drafts;}

module.exports=Object.freeze({PerceptionResolutionResolverError,resolvePerception});
