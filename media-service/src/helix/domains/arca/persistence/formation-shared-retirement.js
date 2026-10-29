'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createMaterialControlProjectionPort } = require('../../../foundation/persistence/material-control');
const { readControlProjections } = require('./read-control-projections');
const { createSeriesPresentationStore } = require('./series-presentation-store');
const { createSeriesRetainedRetirementStore } = require('./series-retained-retirement-store');
const fail = message => { throw Object.assign(new Error(message), {code:'ARCA_FORMATION_SHARED_STALE'}); };
const normalize = value => typeof value === 'bigint' ? Number(value) : Array.isArray(value) ? value.map(normalize) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)])) : value;

// Reuse Arca's retained-root retirement command. Formation owns neither the
// shared files nor the decision whether other Seasons still need this builder.
function createFormationSharedRetirement(options) {
  const contractValidator=options.contractValidator;
  if(!contractValidator)throw new TypeError('Shared retirement requires the composed contract validator.');
  const dependencies = {...options,contractValidator,materialControlProjectionPort:createMaterialControlProjectionPort(options)};
  const seriesStore = createSeriesPresentationStore(dependencies);
  const retirement = createSeriesRetainedRetirementStore({...dependencies,seriesStore});
  function inspect(scopeId, retiringOnDeckIds=[]) {
    const value = normalize(seriesStore.formationRetirementPreview(scopeId,retiringOnDeckIds));
    return {...value,snapshotDigest:canonicalDigest(value)};
  }
  function execute(request) {
    const {snapshotDigest,...frozen} = request;
    if(canonicalDigest(frozen)!==snapshotDigest)fail('Shared retirement snapshot changed.');
    const before=request.current;
    if(request.retire) {
      const prior=retirement.read(before.active_build_id || null,before.scope_id,before.state_digest);
      if(prior) {
        if(prior.headDigest!==before.state_digest)fail('Shared retirement receipt belongs to another head.');
        const current=seriesStore.readScope(before.scope_id);
        if(current.active_build_id || !seriesStore.unused(before.scope_id))fail('Retired shared scope gained responsibility.');
        return {disposition:'retained_root_retirement',receipt:prior};
      }
    }
    const current=inspect(before.scope_id);
    if(current.snapshotDigest!==snapshotDigest)fail('Shared obligations changed during Formation retirement.');
    if(!request.retire)return {disposition:'protected',scopeId:before.scope_id,headDigest:before.state_digest};
    const receipt=retirement.retire(before);
    if(receipt)return {disposition:'retained_root_retirement',receipt};
    if(before.active_build_id || !seriesStore.unused(before.scope_id))fail('Shared retirement did not finish.');
    return {disposition:'already_unoccupied',scopeId:before.scope_id,headDigest:before.state_digest};
  }
  function verify(request, result) {
    const {snapshotDigest,...frozen}=request;
    if(canonicalDigest(frozen)!==snapshotDigest)fail('Shared retirement snapshot changed.');
    if(!request.retire) {
      if(canonicalDigest(result)!==canonicalDigest({disposition:'protected',scopeId:request.current.scope_id,headDigest:request.current.state_digest}) ||
          inspect(request.current.scope_id).snapshotDigest!==snapshotDigest)fail('Protected shared scope changed.');
      return result;
    }
    const before=request.current,current=seriesStore.readScope(before.scope_id);
    if(current.active_build_id || !seriesStore.unused(before.scope_id))fail('Retired shared scope gained responsibility.');
    if(result.disposition==='retained_root_retirement') {
      const receipt=retirement.read(before.active_build_id || null,before.scope_id,before.state_digest);
      if(!receipt || canonicalDigest(receipt)!==canonicalDigest(result.receipt))fail('Shared retirement receipt changed.');
    } else if(result.disposition!=='already_unoccupied' || inspect(before.scope_id).snapshotDigest!==snapshotDigest) {
      fail('Shared retirement outcome is not proven.');
    }
    if(Number(current.current_version)) {
      const manifest=seriesStore.manifest(before.scope_id,Number(current.current_version)).value;
      const controls=readControlProjections(dependencies.materialControlProjectionPort,manifest.members.map(row=>row.physicalIdentity.materialKey));
      if(manifest.members.some(member=>controls.find(row=>row.materialKey===member.physicalIdentity.materialKey)?.controlState!=='released'))
        fail('Unused shared root still has Control.');
    }
    return result;
  }
  return Object.freeze({inspect,execute,verify});
}
module.exports=Object.freeze({createFormationSharedRetirement});
