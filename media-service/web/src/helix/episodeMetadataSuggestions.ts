import type{EpisodeMetadataChoice,EpisodeMetadataEvidence,EpisodeMetadataMember,EpisodeMetadataReview} from './api';

export type EpisodeMetadataSuggestion={
  confident:EpisodeMetadataChoice[];
  uncertain:EpisodeMetadataMember[];
};

function coordinateKey(seasonNumber:number,episodeNumber:number){return `${seasonNumber}:${episodeNumber}`;}

/** Exact unique SxxExx match only. Ambiguous or missing coordinates stay uncertain (fail-closed). */
export function suggestEpisodeMetadataChoices(review:EpisodeMetadataReview):EpisodeMetadataSuggestion{
  const evidenceByCoord=new Map<string,EpisodeMetadataEvidence[]>();
  for(const entry of review.evidence){
    const key=coordinateKey(entry.providerEpisode.seasonNumber,entry.providerEpisode.episodeNumber);
    const group=evidenceByCoord.get(key);if(group)group.push(entry);else evidenceByCoord.set(key,[entry]);
  }
  const confident:EpisodeMetadataChoice[]=[];
  const uncertain:EpisodeMetadataMember[]=[];
  const usedEvidence=new Set<string>();
  for(const member of review.members){
    const key=coordinateKey(member.localScope.seasonNumber,member.localScope.episodeNumber);
    const matches=evidenceByCoord.get(key)||[];
    if(matches.length===1&&!usedEvidence.has(matches[0].evidenceDigest)){
      usedEvidence.add(matches[0].evidenceDigest);
      confident.push({materialKey:member.materialKey,localScope:member.localScope,evidenceDigest:matches[0].evidenceDigest});
    }else uncertain.push(member);
  }
  return {confident,uncertain};
}

export function pendingConfidentChoices(confident:EpisodeMetadataChoice[],choices:EpisodeMetadataChoice[]){
  const selected=new Set(choices.map(choice=>choice.materialKey));
  const usedEvidence=new Set(choices.map(choice=>choice.evidenceDigest));
  return confident.filter(choice=>!selected.has(choice.materialKey)&&!usedEvidence.has(choice.evidenceDigest));
}

export function groupPendingBySeason(pending:EpisodeMetadataChoice[]){
  const seasons=new Map<number,EpisodeMetadataChoice[]>();
  for(const choice of pending){
    const list=seasons.get(choice.localScope.seasonNumber);if(list)list.push(choice);else seasons.set(choice.localScope.seasonNumber,[choice]);
  }
  return [...seasons.entries()].sort((a,b)=>a[0]-b[0]).map(([seasonNumber,items])=>({seasonNumber,items}));
}
