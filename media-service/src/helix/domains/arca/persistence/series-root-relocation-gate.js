'use strict';

const {seriesScopeId} = require('../model/series-presentation');
const columns = ['relocation_id','scope_id','shelf_id','state','plan_digest'];
const statements = Object.freeze({
  active_series_relocation:{kind:'select-one',tableId:'arca_series_root_relocations',columns,keyColumns:['scope_id','state']},
  shelf_series_relocations:{kind:'select-all',tableId:'arca_series_root_relocations',columns,keyColumns:['shelf_id','state']},
});
function assertNoSeriesRelocation(repo,scopeId) {
  if(repo.invoke('active_series_relocation',{scope_id:scopeId,state:'active'}))
    throw Object.assign(new Error('The complete Series root has an unresolved relocation.'),{code:'ARCA_SERIES_RELOCATION_BUSY'});
}
function assertNoEntrySeriesRelocation(repo,shelfEntryId) {
  const entry=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId});
  if(entry?.structure_kind!=='season')return;
  const identity=repo.invoke('find_identity',{shelf_entry_id:shelfEntryId,revision:Number(entry.canonical_identity_revision)});
  if(identity?.provider==='tmdb')assertNoSeriesRelocation(repo,seriesScopeId(entry.shelf_id,String(identity.provider_key)));
}
function assertNoShelfSeriesRelocation(repo,shelfId) {
  if(repo.invoke('shelf_series_relocations',{shelf_id:shelfId,state:'active'}).length)
    throw Object.assign(new Error('A Series root relocation must finish before changing this Shelf.'),{code:'ARCA_SERIES_RELOCATION_BUSY'});
}
module.exports=Object.freeze({statements,assertNoSeriesRelocation,assertNoEntrySeriesRelocation,assertNoShelfSeriesRelocation});
