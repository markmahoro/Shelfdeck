'use strict';

const {scopeFor,MAX_SELECTION_SCOPE_MEMBERS,MAX_RUN_PHYSICAL_MEMBERS}=require('./procurement-run-creator');

function selectionCapacityIssues({rootLocation,profileHint,materials,limit=100}){
  const root=rootLocation.replace(/\\/g,'/').replace(/\/+$/,'')+'/';
  const locations=materials.map(item=>item.current_location.replace(/\\/g,'/'))
    .filter(location=>location.startsWith(root)).map(location=>location.slice(root.length));
  const scopes=new Map(),maximum=Math.min(MAX_SELECTION_SCOPE_MEMBERS,MAX_RUN_PHYSICAL_MEMBERS);
  for(const location of locations){
    const scope=scopeFor(location,locations,profileHint);
    const current=scopes.get(scope.scopeKey)||{scopeKey:scope.scopeKey,location:scope.scopeRootRelativeLocation,memberCount:0,maximum};
    current.memberCount++;scopes.set(scope.scopeKey,current);
  }
  const all=[...scopes.values()].filter(item=>item.memberCount>maximum).sort((a,b)=>a.scopeKey.localeCompare(b.scopeKey));
  return {total:all.length,items:all.slice(0,limit).map(item=>({...item,reasonCode:'procurement_selection_scope_too_large'}))};
}
module.exports=Object.freeze({selectionCapacityIssues});
