'use strict';

const PORT_METHODS = Object.freeze({
  ArtifactQueryPort: Object.freeze(['query']),
  WorkSubmissionPort: Object.freeze(['submit']),
  WorkQueryPort: Object.freeze(['getWork', 'listActivity']),
  CanonicalQueryRegistryPort: Object.freeze(['registerProvider']),
  DomainCommitRegistryPort: Object.freeze(['registerProvider']),
  CommandReceiptPort: Object.freeze(['resolve']),
  MaterialControlPort: Object.freeze(['commit', 'assert']),
  FoundationHealthPort: Object.freeze(['getHealth'])
});

class FoundationPublicPortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FoundationPublicPortError';
    this.code = code;
    this.details = details;
  }
}

function bindPort(portName, implementation) {
  const methods = PORT_METHODS[portName];
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    throw new FoundationPublicPortError('P4_PUBLIC_PORT_IMPLEMENTATION_REQUIRED', 'A typed port implementation object is required.', { portName });
  }
  const provided = Object.keys(implementation).sort();
  const expected = [...methods].sort();
  if (JSON.stringify(provided) !== JSON.stringify(expected) || methods.some((method) => typeof implementation[method] !== 'function')) {
    throw new FoundationPublicPortError('P4_PUBLIC_PORT_SHAPE_MISMATCH', 'Public port methods must match the nominal contract exactly.', {
      portName, expected, provided
    });
  }
  return Object.freeze(Object.fromEntries(methods.map((method) => [method, (...args) => implementation[method](...args)])));
}

function WorkSubmissionPort(implementation) { return bindPort('WorkSubmissionPort', implementation); }
function ArtifactQueryPort(implementation) { return bindPort('ArtifactQueryPort', implementation); }
function WorkQueryPort(implementation) { return bindPort('WorkQueryPort', implementation); }
function CanonicalQueryRegistryPort(implementation) { return bindPort('CanonicalQueryRegistryPort', implementation); }
function DomainCommitRegistryPort(implementation) { return bindPort('DomainCommitRegistryPort', implementation); }
function CommandReceiptPort(implementation) { return bindPort('CommandReceiptPort', implementation); }
function MaterialControlPort(implementation) { return bindPort('MaterialControlPort', implementation); }
function FoundationHealthPort(implementation) { return bindPort('FoundationHealthPort', implementation); }

module.exports = Object.freeze({
  ArtifactQueryPort,
  CanonicalQueryRegistryPort,
  CommandReceiptPort,
  DomainCommitRegistryPort,
  FoundationHealthPort,
  MaterialControlPort,
  WorkQueryPort,
  WorkSubmissionPort
});
