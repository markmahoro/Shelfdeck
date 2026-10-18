'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buildJavCorrectionMetadata}=require('./jav-correction-metadata');
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionCastFact/v1';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const fail=()=>{throw Object.assign(new TypeError('Correction cast requires exact new-source hints and public People reference proofs.'),{code:'ARCA_JAV_CORRECTION_CAST_INVALID'});};
function castQueries(metadata) {
  const hints=metadata.peopleHints,queries=new Map();
  if(!Array.isArray(hints)||hints.length>64)fail();
  for(const hint of hints) {
    if(typeof hint.displayName!=='string'||!hint.displayName.trim()||typeof hint.role!=='string'||!hint.role||
        hint.role!=='actor'||!Array.isArray(hint.providerIdentities)||hint.providerIdentities.length!==0)fail();
    const seed={schema:'arca.jav-correction-person-hint@1',correctionId:metadata.correctionId,shelfEntryId:metadata.shelfEntryId,hint,
        sourceObservationDigest:metadata.sourceQualification.observation.observationDigest},
      input={libraryKind:'jav',providerIdentities:[],evidenceDigest:canonicalDigest(seed)},
      relationId='arca-jav-correction-cast-'+canonicalDigest(seed).slice(0,40);
    queries.set(relationId,{relationId,hint:structuredClone(hint),input,inputDigest:canonicalDigest(input)});
  }
  return [...queries.values()].sort((a,b)=>compare(a.relationId,b.relationId));
}
function buildJavCorrectionCast({correctionId,admissionDigest,basis,proposal,resolutions}) {
  const metadata=buildJavCorrectionMetadata({correctionId,admissionDigest,basis,proposal}),queries=castQueries(metadata);
  if(!Array.isArray(resolutions)||resolutions.length!==queries.length||new Set(resolutions.map(item=>item.relationId)).size!==queries.length)fail();
  const byId=new Map(resolutions.map(item=>[item.relationId,item])),proofs=[],relations=queries.map(query=>{
    const value=byId.get(query.relationId),result=value?.result;
    if(value?.inputDigest!==query.inputDigest||!result||!['resolved','unresolved'].includes(result.kind))fail();
    let personId=null,confidenceClass='provider_asserted';
    if(result.kind==='resolved') {
      const {proofDigest,...proof}=result;
      if(Object.keys(result).sort().join(',')!=='inputDigest,kind,personFactDigest,personId,personRevision,proofDigest,reasonCode,schema'||
          result.schema!=='people.media-cast-reference-proof@1'||result.inputDigest!==query.inputDigest||proofDigest!==canonicalDigest(proof)||
          typeof result.personId!=='string'||!result.personId||!Number.isSafeInteger(result.personRevision)||result.personRevision<1||
          !/^[a-f0-9]{64}$/.test(result.personFactDigest)||result.reasonCode!=='accepted_origin_evidence')fail();
      personId=result.personId;confidenceClass=result.reasonCode;
    } else if(typeof result.reasonCode!=='string'||!result.reasonCode||Object.keys(result).sort().join(',')!=='kind,reasonCode')fail();
    proofs.push({relationId:query.relationId,inputDigest:query.inputDigest,resultDigest:canonicalDigest(result),
      resolutionKind:result.kind,reasonCode:result.reasonCode,personId,personRevision:result.personRevision??null,
      personFactDigest:result.personFactDigest??null,proofDigest:result.proofDigest??null});
    const body={relationId:query.relationId,personId,displayName:query.hint.displayName,
      displayNameNormalized:query.hint.displayName.normalize('NFKC').toLowerCase(),role:query.hint.role,
      source:'jav:'+metadata.sourceQualification.observation.siteRef,providerIdentities:query.input.providerIdentities,
      originEvidenceDigest:query.input.evidenceDigest,confidenceClass};
    return {...body,relationDigest:canonicalDigest(body)};
  }).sort((a,b)=>compare(a.role,b.role)||compare(a.displayNameNormalized,b.displayNameNormalized)||compare(a.relationId,b.relationId));
  const body={schemaRef:SCHEMA,schemaVersion:1,correctionId,shelfEntryId:basis.shelfEntryId,admissionDigest,
    canonicalIdentityDigest:proposal.newIdentity.identityDigest,sourceObservationDigest:metadata.sourceQualification.observation.observationDigest,
    relations,relationCount:relations.length,relationsDigest:canonicalDigest(relations),referenceProofs:proofs};
  if(Buffer.byteLength(canonicalJson(body))>256*1024)fail();
  return Object.freeze({...body,factDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({SCHEMA,castQueries,buildJavCorrectionCast});
