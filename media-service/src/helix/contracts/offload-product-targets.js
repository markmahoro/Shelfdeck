'use strict';

// Cardinality is explicit, not a fallback between runtime generations.
function offloadProductKeys(source) {
  const single = Object.hasOwn(source,'finalProductMaterialKey'), multiple = Object.hasOwn(source,'finalProductMaterialKeys');
  if (single === multiple) throw new Error('Off-load mapping requires exactly one target representation.');
  const keys = single ? [source.finalProductMaterialKey] : source.finalProductMaterialKeys;
  if (!Array.isArray(keys) || keys.length < (multiple ? 2 : 1) || keys.length > 1024 ||
      keys.some((key,index) => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) ||
        index > 0 && Buffer.compare(Buffer.from(keys[index-1]),Buffer.from(key)) >= 0))
    throw new Error('Off-load targets must be complete, bounded, sorted and unique.');
  if (multiple && (source.contextRole !== 'original_input' || source.dispositionKind !== 'replaced_and_settled' ||
      source.settlementExpectation !== 'remove_after_place' || keys.includes(source.materialKey)))
    throw new Error('Multiple Off-load targets require a replaced original Primary.');
  return Object.freeze([...keys]);
}
module.exports = Object.freeze({offloadProductKeys});
