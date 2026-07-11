'use strict';

const PRIMITIVES = new Set(['string', 'number', 'boolean', 'object', 'array']);

function contract(type, version = 1, options = {}) {
  const value = String(type || '').trim();
  if (!value) throw new TypeError('Capability contract requires a nominal type');
  return Object.freeze({ type: value, version: Number(version) || 1, optional: !!options.optional, many: !!options.many });
}

function normalizePorts(ports = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(ports).map(([name, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new TypeError(`Invalid capability input port: ${name}`);
    return [name, contract(value.type, value.version, value)];
  })));
}

function normalizeDefinition(definition = {}) {
  const contractVersion = Number(definition.contractVersion);
  if (!Number.isInteger(contractVersion) || contractVersion < 1) throw new TypeError(`Capability ${definition.capability || ''} requires contractVersion`);
  if (!definition.outputContract || !definition.outputContract.type) throw new TypeError(`Capability ${definition.capability || ''} requires outputContract`);
  return {
    contractVersion,
    inputContract: normalizePorts(definition.inputContract || {}),
    outputContract: contract(definition.outputContract.type, definition.outputContract.version, definition.outputContract),
    effectKind: String(definition.effectKind || definition.idempotency || 'pure'),
    resourceContract: Object.freeze({ types: Object.freeze([...(definition.resourceContract && definition.resourceContract.types || [])]) }),
    approvalContract: Object.freeze({ actions: Object.freeze([...(definition.approvalContract && definition.approvalContract.actions || [])]) }),
    fencingContract: Object.freeze({ admission: definition.fencingContract ? definition.fencingContract.admission !== false : true }),
    parameterContract: Object.freeze(definition.parameterContract || {}),
  };
}

function assertParameters(contract = {}, parameters = {}, capability = '') {
  for (const [name, spec] of Object.entries(contract)) {
    const value = parameters[name];
    if (value == null && spec.required !== false) throw Object.assign(new Error(`Capability ${capability} requires parameter ${name}`), { code: 'KAIROX_CAPABILITY_PARAMETER_MISSING' });
    if (value != null && spec.type === 'enum' && !(spec.values || []).includes(value)) throw Object.assign(new Error(`Capability ${capability} parameter ${name} is invalid`), { code: 'KAIROX_CAPABILITY_PARAMETER_INVALID' });
  }
  for (const name of Object.keys(parameters || {})) if (!contract[name]) throw Object.assign(new Error(`Capability ${capability} received unknown parameter ${name}`), { code: 'KAIROX_CAPABILITY_PARAMETER_UNKNOWN' });
}

function compatible(expected, actual) {
  return !!expected && !!actual && expected.type === actual.type && Number(expected.version) === Number(actual.version);
}

function assertRuntimeValue(spec, value, label) {
  if (value == null) {
    if (!spec.optional) throw Object.assign(new Error(`Required capability input is missing: ${label}`), { code: 'KAIROX_CAPABILITY_INPUT_MISSING', input: label });
    return;
  }
  if (spec.many && !Array.isArray(value)) throw Object.assign(new Error(`Capability input must be an array: ${label}`), { code: 'KAIROX_CAPABILITY_INPUT_TYPE_VIOLATION', input: label });
  if (PRIMITIVES.has(spec.type)) {
    const candidate = spec.many ? value : [value];
    for (const entry of candidate) {
      const valid = spec.type === 'array' ? Array.isArray(entry)
        : spec.type === 'object' ? !!entry && typeof entry === 'object' && !Array.isArray(entry)
          : typeof entry === spec.type;
      if (!valid) throw Object.assign(new Error(`Capability input type violation: ${label}:${spec.type}`), { code: 'KAIROX_CAPABILITY_INPUT_TYPE_VIOLATION', input: label });
    }
  }
}

function assertOutput(spec, value, capability) {
  if (value == null) throw Object.assign(new Error(`Capability ${capability} did not return ${spec.type}@${spec.version}`), { code: 'KAIROX_CAPABILITY_OUTPUT_MISSING' });
  if (PRIMITIVES.has(spec.type)) assertRuntimeValue(spec, value, 'output');
}

module.exports = { contract, normalizeDefinition, compatible, assertRuntimeValue, assertOutput, assertParameters };
