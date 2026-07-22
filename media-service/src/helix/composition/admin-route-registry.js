'use strict';
const manifest=require('../contracts/manifests/route-inventory.json');
const entries=Object.freeze(manifest.entries.map((entry)=>Object.freeze({...entry.contract,routeId:entry.id,owner:entry.owner})));
const byKey=new Map(entries.map((entry)=>[entry.method+' '+entry.path,entry]));
function match(method,path){const exact=byKey.get(method+' '+path);if(exact)return exact;for(const entry of entries){if(entry.method!==method)continue;const pattern='^'+entry.path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/:([A-Za-z][A-Za-z0-9]*)/g,'(?<$1>[^/]+)')+'$';const found=path.match(new RegExp(pattern));if(found)return Object.freeze({...entry,params:Object.freeze(found.groups||{})});}return null;}
module.exports=Object.freeze({entries,match});

