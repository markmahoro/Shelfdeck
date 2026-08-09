'use strict';

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

class CapabilityContractValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CapabilityContractValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CapabilityContractValidationError(code, message, details);
}

function createCapabilityContractValidator(options) {
  if (!options || !Array.isArray(options.schemas) || options.schemas.length === 0) {
    fail('P4_CAPABILITY_SCHEMA_SET_REQUIRED', 'A non-empty frozen schema set is required.');
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true, coerceTypes: false, useDefaults: false });
  addFormats(ajv);
  const ids = new Set();
  for (const schema of options.schemas) {
    if (!schema || typeof schema.$id !== 'string' || schema.$id.length === 0 || ids.has(schema.$id)) {
      fail('P4_CAPABILITY_SCHEMA_ID_INVALID', 'Every runtime schema requires one unique nominal $id.', { schemaId: schema && schema.$id });
    }
    ids.add(schema.$id);
    ajv.addSchema(schema);
  }
  return Object.freeze({
    schemaCount: ids.size,
    has(schemaRef) { return ids.has(schemaRef); },
    validate(schemaRef, value) {
      if (!ids.has(schemaRef)) fail('P4_CAPABILITY_UNKNOWN_SCHEMA', 'Runtime schema is not registered.', { schemaRef });
      let validate;
      try {
        validate = ajv.getSchema(schemaRef);
      } catch (error) {
        fail('P4_CAPABILITY_SCHEMA_COMPILE_FAILED', 'Runtime schema graph cannot be compiled.', { schemaRef, message: error.message });
      }
      if (!validate) fail('P4_CAPABILITY_UNKNOWN_SCHEMA', 'Runtime schema is not registered.', { schemaRef });
      if (!validate(value)) { const errors = (validate.errors || []).map((error) => ({ instancePath: error.instancePath, keyword: error.keyword, message: error.message })); fail('P4_CAPABILITY_SCHEMA_REJECTED', 'Runtime value violates its exact nominal schema: ' + JSON.stringify(errors), { schemaRef, errors }); }
      return value;
    }
  });
}

module.exports = Object.freeze({ CapabilityContractValidationError, createCapabilityContractValidator });
