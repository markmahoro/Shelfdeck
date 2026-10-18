'use strict';

const { canonicalDigest } = require('./canonical-json');

const US_ADULT_PRESENTATION_VERSION = 'us-adult-presentation@1';

function fail(code, message) { throw Object.assign(new TypeError(message), { code }); }

function originalNameProvenance(originalFileName) {
  if (typeof originalFileName !== 'string' || !originalFileName || originalFileName !== originalFileName.trim() ||
      /[\x00-\x1f/\\]/.test(originalFileName) || ['.', '..'].includes(originalFileName)) {
    fail('US_ADULT_ORIGINAL_NAME_INVALID', 'The initial original filename must be an explicit leaf filename.');
  }
  const basis = { schema: 'us-adult-original-name@1', originalFileName };
  return Object.freeze({ ...basis, provenanceDigest: canonicalDigest(basis) });
}

function buildUsAdultTitle({ actorName, originalName }) {
  const expected = originalNameProvenance(originalName?.originalFileName);
  if (originalName?.schema !== expected.schema || originalName.provenanceDigest !== expected.provenanceDigest ||
      Object.keys(originalName).length !== 3) fail('US_ADULT_ORIGINAL_NAME_PROOF_INVALID', 'The original naming provenance is missing or changed.');
  if (typeof actorName !== 'string' || !actorName.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(actorName) || /[. ]$/.test(actorName)) {
    fail('US_ADULT_ACTOR_NAME_INVALID', 'The actor name cannot be represented safely in a filename.');
  }
  const finalDot = expected.originalFileName.lastIndexOf('.');
  const originalStem = finalDot > 0 ? expected.originalFileName.slice(0, finalDot) : expected.originalFileName;
  const title = actorName.trim() + ' ' + originalStem;
  if (/[<>:"/\\|?*]/.test(title)) fail('US_ADULT_ORIGINAL_NAME_UNSUPPORTED', 'The original name cannot be preserved on the target filesystem.');
  return Object.freeze({ version: US_ADULT_PRESENTATION_VERSION, title, originalStem,
    actorName: actorName.trim(), originalName: expected });
}

function buildUsAdultName({ actorName, originalName, outputExtension }) {
  const named = buildUsAdultTitle({ actorName, originalName });
  if (typeof outputExtension !== 'string' || !/^\.[a-z0-9]{1,8}$/.test(outputExtension)) {
    fail('US_ADULT_OUTPUT_EXTENSION_INVALID', 'An explicit output container extension is required.');
  }
  const fileName = named.title + outputExtension;
  if (/[<>:"/\\|?*]/.test(fileName) || /[. ]$/.test(fileName)) fail('US_ADULT_ORIGINAL_NAME_UNSUPPORTED', 'The original name cannot be preserved on the target filesystem.');
  if (Buffer.byteLength(fileName, 'utf8') > 255) fail('US_ADULT_NAME_TOO_LONG', 'The actor prefix and original name exceed the filename limit.');
  return Object.freeze({ ...named, fileName });
}

module.exports = Object.freeze({ US_ADULT_PRESENTATION_VERSION, originalNameProvenance, buildUsAdultTitle, buildUsAdultName });
