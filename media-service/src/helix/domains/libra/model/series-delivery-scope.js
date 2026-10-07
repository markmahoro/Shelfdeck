"use strict";

function pendingSeriesBatch(bindings, scopes) {
  const delivered=new Set(scopes.filter(scope=>scope.accepted).flatMap(scope=>scope.materialKeys));
  const assigned=new Set(scopes.filter(scope=>['active','suspended','frozen'].includes(scope.state)).flatMap(scope=>scope.materialKeys));
  const primary=bindings.filter(row=>row.authority_kind==='primary_control'&&!delivered.has(row.material_key));
  const candidates=[...new Set(primary.map(row=>row.origin_candidate_package_id))].sort((a,b)=>Buffer.from(a).compare(Buffer.from(b)));
  const candidate=candidates.find(id=>primary.filter(row=>row.origin_candidate_package_id===id).every(row=>!assigned.has(row.material_key)))||candidates[0];
  return primary.filter(row=>row.origin_candidate_package_id===candidate);
}

function bindingsForEpisodeScope(bindings, claims, episodeKeys) {
  const wanted=new Set(episodeKeys);
  const primary=bindings.filter(row=>row.authority_kind==='primary_control'&&claims.some(claim=>
    claim.material_key===row.material_key&&Number(claim.binding_revision)===Number(row.binding_revision)&&wanted.has(claim.episode_key)));
  const keys=new Set(primary.map(row=>row.material_key));
  return bindings.filter(row=>keys.has(row.material_key)||row.authority_kind==='related_derived'&&keys.has(row.primary_material_key));
}

module.exports=Object.freeze({pendingSeriesBatch,bindingsForEpisodeScope});
