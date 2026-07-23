'use strict';

const { createFieldRoutingPolicyStore } = require('../persistence/field-routing-policy-store');

class LibraRoutingAdminError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LibraRoutingAdminError';
    this.code = code;
    this.details = details;
  }
}

function createLibraRoutingAdminApplication(options) {
  if (typeof options?.readArcaRoutingTargets !== 'function') {
    throw new TypeError('Libra Routing requires the formal Arca projection port.');
  }
  const store = createFieldRoutingPolicyStore(options);

  function invoke(operation) {
    try {
      return operation();
    } catch (error) {
      if (error.code === 'P3_COMMAND_IDEMPOTENCY_CONFLICT') {
        throw new LibraRoutingAdminError(
          'ADMIN_ROUTING_IDEMPOTENCY_CONFLICT',
          '同一幂等键不能用于不同Routing请求。',
        );
      }
      throw new LibraRoutingAdminError(
        'ADMIN_ROUTING_COMMAND_REJECTED',
        'Routing请求未通过Libra合同校验。',
        { reasonCode: error.code || 'ROUTING_REJECTED' },
      );
    }
  }

  function command(fieldId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.fieldId !== fieldId) {
      throw new LibraRoutingAdminError(
        'ADMIN_ROUTING_TARGET_MISMATCH',
        'URL Field与请求体目标必须一致。',
        { pathFieldId: fieldId, bodyFieldId: body?.fieldId },
      );
    }
    const { idempotencyKey, ...input } = body;
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      throw new LibraRoutingAdminError('IDEMPOTENCY_KEY_REQUIRED', 'Routing Command要求幂等键。');
    }
    return Object.freeze({ idempotencyKey, input });
  }

  return Object.freeze({
    get(fieldId) {
      return Object.freeze({ policy: store.current(fieldId) });
    },
    history(fieldId) {
      return Object.freeze({ items: store.history(fieldId) });
    },
    preview(fieldId, body) {
      return invoke(() => store.preview(
        command(fieldId, body),
        options.readArcaRoutingTargets(),
      ));
    },
    publish(fieldId, body) {
      return invoke(() => store.publish(
        command(fieldId, body),
        options.readArcaRoutingTargets(),
      ));
    },
  });
}

module.exports = Object.freeze({
  LibraRoutingAdminError,
  createLibraRoutingAdminApplication,
});
