'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const CAPABILITY_REFS = Object.freeze({
  verify: 'arca.shelf_deregistration.release_manifest.verify@1',
  commit: 'arca.shelf_deregistration.commit@1',
});

const PROCESS_TYPE = 'arca_shelf_deregistration';
const PAGE_SIZE = 100;
const stable = (prefix, value) => prefix + canonicalDigest(value).slice(0, 40);

module.exports = Object.freeze({ CAPABILITY_REFS, PROCESS_TYPE, PAGE_SIZE, stable });
