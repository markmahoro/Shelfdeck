'use strict';
const {canonicalContentIdentity}=require('./canonical-content-identity');

function collectionSeriesProjection(entry, materials, facts) {
  if(entry.structure_kind!=='season')return null;
  const identities=facts.filter(item=>item.factKind==='resolved_identity')
    .map(item=>item.factValue.resolvedProductIdentity||item.factValue);
  if(!identities.length)throw new Error('Collection Season identity is absent.');
  const seasons=identities.map(identity=>{
    if(identity.structureKind!=='season'||canonicalContentIdentity(entry.shelf_id,identity).canonicalIdentityKey!==entry.canonical_identity_key)
      throw new Error('Collection Season identity does not match the current Entry.');
    return identity.providerIdentities.find(item=>item.namespace==='tmdb_series').seasonNumber;
  });
  if(new Set(seasons).size!==1)throw new Error('Collection Season identity is ambiguous.');
  const seasonNumber=seasons[0],episodes=new Map(),seen=new Set();
  for(const material of materials.filter(item=>item.role==='primary_payload')) {
    if(seen.has(material.material_key))throw new Error('Collection Primary is duplicated.');
    seen.add(material.material_key);
    const claims=JSON.parse(material.episode_claims_json).items;
    if(!Array.isArray(claims)||!claims.length||new Set(claims.map(claim=>claim.episodeKey)).size!==claims.length)
      throw new Error('Collection Primary Episode claims are invalid.');
    for(const claim of claims) {
      const episodeNumber=Number(String(claim.episodeKey).slice(1));
      if(!Number.isSafeInteger(episodeNumber)||episodeNumber<1||claim.episodeKey!=='E'+String(episodeNumber).padStart(3,'0'))
        throw new Error('Collection Episode key is invalid.');
      const episode=episodes.get(claim.episodeKey)||{episodeKey:claim.episodeKey,episodeNumber,files:[]};
      episode.files.push(Object.freeze({materialKey:material.material_key,
        name:String(material.location).split(/[\\/]/).pop(),sizeBytes:Number(material.size_bytes),
        coveredEpisodeCount:claims.length}));
      episodes.set(claim.episodeKey,episode);
    }
  }
  const metadata=facts.filter(item=>item.factKind==='product_metadata').flatMap(item=>item.factValue.episodeMetadata||[]);
  return Object.freeze({seasonNumber,episodeCount:episodes.size,physicalFileCount:seen.size,
    episodes:Object.freeze([...episodes.values()].sort((a,b)=>a.episodeNumber-b.episodeNumber).map(episode=>{
      const matching=metadata.filter(item=>item.episodeScope?.episodeKey===episode.episodeKey);
      if(matching.length>1||matching.some(item=>item.episodeScope.seasonNumber!==seasonNumber||item.episodeScope.episodeNumber!==episode.episodeNumber))
        throw new Error('Collection Episode metadata scope is ambiguous.');
      const title=matching[0]?.descriptiveFacts?.entries?.find(item=>item.key==='episode_title')?.value;
      return Object.freeze({...episode,title:typeof title==='string'?title:null,
        files:Object.freeze(episode.files.sort((a,b)=>a.materialKey.localeCompare(b.materialKey)))});
    }))});
}
module.exports=Object.freeze({collectionSeriesProjection});
