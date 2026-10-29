'use strict';
// An Owner-local assessment, not a Person, ActorChoice, or permission to publish a Cast.
const {canonicalDigest}=require('../../../contracts/canonical-json');
const POLICY_SCHEMA='libra.us-adult-catalogue-assessment-policy@1';
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function fail(message){throw Object.assign(new TypeError(message),{code:'US_ADULT_CATALOGUE_ASSESSMENT_INVALID'});}
function order(a,b){return Buffer.compare(Buffer.from(a),Buffer.from(b));}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function policy(parameters){
  if(!parameters||Object.keys(parameters).sort().join(',')!=='maximumDistance,minimumCoverageStrata,minimumDistanceMargin,minimumRepresentativeStrata'||
    !Number.isFinite(parameters.maximumDistance)||parameters.maximumDistance<=0||parameters.maximumDistance>1||
    !Number.isFinite(parameters.minimumDistanceMargin)||parameters.minimumDistanceMargin<=0||parameters.minimumDistanceMargin>1||
    !integer(parameters.minimumRepresentativeStrata,2,3)||!integer(parameters.minimumCoverageStrata,3,20))
    fail('A closed, explicitly frozen identity policy is required.');
  const value={schema:POLICY_SCHEMA,...parameters};
  return Object.freeze({...value,policyDigest:canonicalDigest(value)});
}
function assertPolicy(value){
  const {schema,policyDigest,...parameters}=value||{};
  if(schema!==POLICY_SCHEMA||policy(parameters).policyDigest!==policyDigest)fail('The frozen identity policy changed.');
}
function assessCatalogueActors({groups,policy:frozenPolicy}){
  assertPolicy(frozenPolicy);
  if(!Array.isArray(groups)||groups.length>1280)fail('A bounded completed group set is required.');
  const allFaces=new Set(),groupIds=new Set(),identityNames=new Map(),identities=new Map();let ambiguousFaces=0,matchedRepresentatives=0;
  const counters={groupCount:groups.length,qualifiedGroupCount:0};
  for(const group of groups){
    if(typeof group.clusterId!=='string'||!group.clusterId||group.clusterId.length>256||groupIds.has(group.clusterId)||!Array.isArray(group.memberKeys)||!group.memberKeys.length||group.memberKeys.length>1280||
      !Array.isArray(group.coverageStrata)||group.coverageStrata.length>20||new Set(group.coverageStrata).size!==group.coverageStrata.length||
      group.coverageStrata.some(x=>!integer(x,0,19))||!Array.isArray(group.representativeKeys)||group.representativeKeys.length>3||
      new Set(group.representativeKeys).size!==group.representativeKeys.length||group.representativeKeys.some(key=>!group.memberKeys.includes(key))||
      !Array.isArray(group.candidates)||group.candidates.length>15)fail('A group lost its bounded face, coverage or representative evidence.');
    groupIds.add(group.clusterId);
    for(const key of group.memberKeys){
      if(typeof key!=='string'||!/^\d{1,2}:\d{1,2}$/.test(key)||!integer(Number(key.split(':')[0]),0,39)||
        !integer(Number(key.split(':')[1]),0,31)||key!==key.split(':').map(Number).join(':')||allFaces.has(key))fail('Group member proof must conserve unique bounded frame faces.');
      allFaces.add(key);
    }
    if(group.coverageStrata.length>new Set(group.memberKeys.map(key=>Number(key.split(':')[0]))).size)fail('Temporal coverage exceeds the actual member frames.');
    const byFace=new Map(),faceSources=new Map(),candidateIds=new Set();let observationCount=0;
    for(const candidate of group.candidates){
      if(typeof candidate.identity!=='string'||!candidate.identity||candidate.identity.length>256||candidateIds.has(candidate.identity)||
        !Array.isArray(candidate.observations)||candidate.observations.length<1||candidate.observations.length>15)
        fail('A catalogue identity lost its bounded observations.');
      candidateIds.add(candidate.identity);
      for(const item of candidate.observations){
        if(++observationCount>15||!group.representativeKeys.includes(item.faceKey)||!integer(item.stratum,0,19)||!group.coverageStrata.includes(item.stratum)||
          !/^[a-f0-9]{64}$/.test(item.imageDigest||'')||typeof item.uid!=='string'||!item.uid||item.uid.length>256||typeof item.name!=='string'||!item.name.trim()||item.name.length>256||
          !Number.isFinite(item.distance)||item.distance<0||item.distance>1)fail('A representative candidate lost its exact source or distance.');
        const source=item.stratum+':'+item.imageDigest;
        if(faceSources.has(item.faceKey)&&faceSources.get(item.faceKey)!==source||identityNames.has(item.uid)&&identityNames.get(item.uid)!==item.name)
          fail('One face or catalogue UID has contradictory evidence.');
        faceSources.set(item.faceKey,source);identityNames.set(item.uid,item.name);
        if(!byFace.has(item.faceKey))byFace.set(item.faceKey,new Map());
        const candidates=byFace.get(item.faceKey),previous=candidates.get(candidate.identity);
        if(previous&&(previous.stratum!==item.stratum||previous.imageDigest!==item.imageDigest))fail('One face has contradictory source evidence.');
        if(!previous||item.distance<previous.distance)candidates.set(candidate.identity,{...item,identity:candidate.identity});
        if(candidates.size>5)fail('A representative exceeds the bounded catalogue candidate set.');
      }
    }
    const decisive=[];
    for(const candidates of byFace.values()){
      const ranked=[...candidates.values()].sort((a,b)=>a.distance-b.distance||order(a.identity,b.identity));
      const best=ranked[0];
      if(best.distance>frozenPolicy.maximumDistance)continue;
      if(ranked[1]&&ranked[1].distance-best.distance<frozenPolicy.minimumDistanceMargin){ambiguousFaces++;continue;}
      decisive.push(best);matchedRepresentatives++;
    }
    const winners=new Set(decisive.map(x=>x.identity)),strata=new Set(decisive.map(x=>x.stratum)),images=new Set(decisive.map(x=>x.imageDigest));
    if(winners.size>1){ambiguousFaces+=decisive.length;continue;}
    if(winners.size!==1||strata.size<frozenPolicy.minimumRepresentativeStrata||images.size<frozenPolicy.minimumRepresentativeStrata||
      group.coverageStrata.length<frozenPolicy.minimumCoverageStrata)continue;
    counters.qualifiedGroupCount++;
    const identity=decisive[0].identity;
    if(!identities.has(identity))identities.set(identity,{identity,groups:[],strata:new Set(),memberKeys:new Set(),representatives:new Map()});
    const aggregate=identities.get(identity);aggregate.groups.push(group.clusterId);
    group.coverageStrata.forEach(x=>aggregate.strata.add(x));
    group.memberKeys.forEach(key=>aggregate.memberKeys.add(key));
    decisive.forEach(item=>aggregate.representatives.set(item.faceKey,item));
  }
  const candidates=[...identities.values()].map(item=>{
    const observations=[...item.representatives.values()].sort((a,b)=>order(a.faceKey,b.faceKey)),frames=new Map();let cooccurrenceConflict=false;
    for(const key of item.memberKeys){
      const frame=Number(key.split(':')[0]);
      if(frames.has(frame)&&frames.get(frame)!==key)cooccurrenceConflict=true;
      frames.set(frame,key);
    }
    const best=[...observations].sort((a,b)=>a.distance-b.distance||order(a.uid,b.uid))[0];
    return {identity:item.identity,name:best.name,uid:best.uid,groupIds:item.groups.sort(order),
      coverageStrata:[...item.strata].sort((a,b)=>a-b),supportingRepresentativeStrata:[...new Set(observations.map(x=>x.stratum))].sort((a,b)=>a-b),
      minimumDistance:best.distance,meanDistance:observations.reduce((sum,x)=>sum+x.distance,0)/observations.length,cooccurrenceConflict};
  }).sort((a,b)=>b.coverageStrata.length-a.coverageStrata.length||b.supportingRepresentativeStrata.length-a.supportingRepresentativeStrata.length||
    a.meanDistance-b.meanDistance||order(a.identity,b.identity));
  const eligible=candidates.filter(item=>!item.cooccurrenceConflict),winner=eligible[0]||null;
  // Raw metadata may carry gender. It is intentionally absent from eligibility and ranking.
  const status=winner?'qualified_candidate':!groups.length?'no_faces':ambiguousFaces||candidates.some(x=>x.cooccurrenceConflict)?'ambiguous_identity':
    matchedRepresentatives?'insufficient_evidence':'no_match';
  const value={schema:'libra.us-adult-catalogue-assessment@1',policyDigest:frozenPolicy.policyDigest,status,winner,candidates,
    ...counters,ambiguousRepresentativeCount:ambiguousFaces};
  return freeze({...value,assessmentDigest:canonicalDigest(value)});
}
module.exports=Object.freeze({policy,assessCatalogueActors});
