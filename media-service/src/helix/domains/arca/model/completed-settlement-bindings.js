'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const CAPABILITY = 'arca.ondeck.input_settlement.delete@1';

function validCompletion(result, committedAtMs) {
  if (result?.schemaRef !== 'helix://contracts/types/SettlementDeletionEvidence/v1' ||
      result.producerRef !== CAPABILITY || result.evidenceKind !== 'input_settlement' ||
      !result.materialKey || !Number.isSafeInteger(result.observedAtMs) ||
      result.observedAtMs > committedAtMs) return false;
  const { payloadDigest, ...body } = result;
  if (payloadDigest !== canonicalDigest(body)) return false;
  const reality = result.postDeleteReality;
  if (reality?.schemaRef !== 'arca://types/PostDeleteReality/v1' || !Array.isArray(reality.entries)) return false;
  const { recordDigest, ...record } = reality;
  if (recordDigest !== canonicalDigest(record)) return false;
  const entries = new Map(reality.entries.map(item => [item.key, item.value]));
  if(entries.size!==reality.entries.length||entries.get('absent')!==true||
      entries.get('disposition')!=='settled_to_final'||entries.get('final_verified')!==true)return false;
  if(entries.has('final_targets')){
    const targets=entries.get('final_targets'),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
    return !entries.has('final_material_key')&&!entries.has('final_target_location')&&
      hash(entries.get('source_to_final_mapping_digest'))&&Array.isArray(targets)&&targets.length>=2&&targets.length<=1024&&
      targets.every((item,index)=>item&&Object.keys(item).sort().join(',')==='finalRealityDigest,materialKey,targetLocation'&&
        hash(item.materialKey)&&hash(item.finalRealityDigest)&&typeof item.targetLocation==='string'&&
        item.targetLocation.length>0&&item.targetLocation.length<=4096&&
        (index===0||Buffer.compare(Buffer.from(targets[index-1].materialKey),Buffer.from(item.materialKey))<0))&&
      entries.get('final_reality_digest')===canonicalDigest({schema:'arca.settlement-final-targets@1',members:targets});
  }
  return ['source_to_final_mapping_digest','final_material_key','final_target_location','final_reality_digest']
    .every(key=>typeof entries.get(key)==='string'&&entries.get(key).length>0);
}

function excludeCompletedSettlementBindings(raw, reader) {
  const commit = raw.onDeckCommit;
  if (!commit || !(raw.oldBindings || []).length) return raw;
  if (!reader?.listWorks || !reader?.read) {
    throw new TypeError('Historical Settlement qualification requires the Work Result Reader.');
  }
  const completed = new Set();
  for (const work of reader.listWorks({ ownerDomain:'arca', processType:'arca_ondeck_run',
    processId:commit.on_deck_run_id, workKind:'on_deck_execution' })) {
    for (const row of reader.read(work.work_id)) {
      if (row.capabilityRef === CAPABILITY && row.outcomeKind === 'succeeded' &&
          validCompletion(row.result, Number(commit.committed_at_ms))) completed.add(row.result.materialKey);
    }
  }
  return Object.freeze({ ...raw, oldBindings:Object.freeze(raw.oldBindings.filter(binding =>
    !String(binding.role || '').startsWith('offload:') || !completed.has(binding.material_key))) });
}

module.exports = Object.freeze({ excludeCompletedSettlementBindings });
