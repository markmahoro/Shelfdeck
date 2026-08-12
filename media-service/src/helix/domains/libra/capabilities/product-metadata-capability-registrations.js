'use strict';

const { CAPABILITY } = require('./product-metadata-capability-ports');

function createProductMetadataCapabilityRegistrations(options) {
  const manifest = options?.manifests?.[CAPABILITY];
  const port = options?.ports?.[CAPABILITY];
  if (!manifest || manifest.capabilityRef !== CAPABILITY || manifest.ownerScope !== 'libra' ||
      manifest.effectClass !== 'pure_observation' || manifest.contractVersion !== 1 ||
      !port || typeof port.execute !== 'function') {
    throw new TypeError('Product Metadata Capability binding is invalid.');
  }
  return Object.freeze([Object.freeze({
    manifest,
    executor: Object.freeze({ version:1, execute:(context) => port.execute(context) }),
    semanticValidator: Object.freeze({
      ref: manifest.semanticValidatorRef,
      validateInputs: (context) => port.validateInputs(context),
      validateResult: (context, outcome) => port.validateResult(context, outcome),
    }),
  })]);
}

module.exports = Object.freeze({ createProductMetadataCapabilityRegistrations });
