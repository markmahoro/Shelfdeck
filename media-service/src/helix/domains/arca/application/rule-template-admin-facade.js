'use strict';

const { createRuleTemplateStore } = require('../persistence/rule-template-store');

const CONFLICT_CODES = new Set([
  'OPERATIONAL_SCALE_LIMIT',
  'P14_RULE_TEMPLATE_ARCHIVE_CAS',
  'P14_RULE_TEMPLATE_BIND_SHELF_CAS',
  'P14_RULE_TEMPLATE_BIND_TEMPLATE_CAS',
  'P14_RULE_TEMPLATE_BOUND',
  'P14_RULE_TEMPLATE_DRAFT_CAS',
  'P14_RULE_TEMPLATE_EXISTS',
  'P14_RULE_TEMPLATE_HEAD_CAS',
  'P14_RULE_TEMPLATE_PREVIEW_CAS',
  'P14_RULE_TEMPLATE_PREVIEW_STALE',
  'P14_RULE_TEMPLATE_PUBLISH_CAS',
  'P14_RULE_TEMPLATE_SHELF_CAS',
]);

class ArcaRuleTemplateAdminApplicationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArcaRuleTemplateAdminApplicationError';
    this.code = code;
    this.details = details;
  }
}

function target(templateId, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      body.templateId !== templateId) {
    throw new ArcaRuleTemplateAdminApplicationError(
      'ADMIN_RULE_TEMPLATE_TARGET_MISMATCH',
      'URL中的Rule Template与请求体目标必须一致。',
      { pathTemplateId: templateId, bodyTemplateId: body?.templateId },
    );
  }
  return body;
}

function createArcaRuleTemplateAdminApplication(options) {
  const store = createRuleTemplateStore(options);
  const expose = (result) => Object.freeze({
    ...result.value,
    replayed: result.replayed,
  });

  function invoke(operation) {
    try {
      return operation();
    } catch (error) {
      if (error instanceof ArcaRuleTemplateAdminApplicationError) throw error;
      if (error.code === 'P3_COMMAND_IDEMPOTENCY_CONFLICT') {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_RULE_TEMPLATE_IDEMPOTENCY_CONFLICT',
          '同一幂等键不能用于不同的Rule Template请求。',
        );
      }
      if (error.code === 'P14_RULE_TEMPLATE_NOT_FOUND') {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_RULE_TEMPLATE_NOT_FOUND',
          'Rule Template不存在。',
        );
      }
      if (error.code === 'P14_RULE_TEMPLATE_SHELF_NOT_FOUND') {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_SHELF_NOT_FOUND',
          'Shelf不存在。',
        );
      }
      if (error.code === 'SYSTEM_TEMPLATE_IMMUTABLE') {
        throw new ArcaRuleTemplateAdminApplicationError(
          'SYSTEM_TEMPLATE_IMMUTABLE',
          '系统Rule Template不可修改。',
        );
      }
      if (CONFLICT_CODES.has(error.code)) {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_RULE_TEMPLATE_CONFLICT',
          'Rule Template状态、revision或绑定关系已变化。',
          { reasonCode: error.code },
        );
      }
      throw new ArcaRuleTemplateAdminApplicationError(
        'ADMIN_RULE_TEMPLATE_COMMAND_REJECTED',
        'Rule Template请求未通过Arca Owner-local合同校验。',
        { reasonCode: error.code || 'ARCA_RULE_TEMPLATE_CONTRACT_REJECTED' },
      );
    }
  }

  function commandBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ArcaRuleTemplateAdminApplicationError(
        'ADMIN_RULE_TEMPLATE_COMMAND_REJECTED',
        'Rule Template请求体无效。',
      );
    }
    const { idempotencyKey, ...input } = body;
    return { idempotencyKey, input };
  }

  return Object.freeze({
    listTemplates() {
      return Object.freeze({ items: invoke(store.listTemplates) });
    },
    getTemplate(templateId) {
      const template = invoke(() => store.getTemplate(templateId));
      if (!template) {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_RULE_TEMPLATE_NOT_FOUND',
          'Rule Template不存在。',
          { templateId },
        );
      }
      return Object.freeze({ template });
    },
    getDraft(templateId) {
      const result = invoke(() => store.getDraft(templateId));
      if (!result) {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_RULE_TEMPLATE_NOT_FOUND',
          'Rule Template不存在。',
          { templateId },
        );
      }
      return result;
    },
    history(templateId) {
      const items = invoke(() => store.history(templateId));
      if (!items) {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_RULE_TEMPLATE_NOT_FOUND',
          'Rule Template不存在。',
          { templateId },
        );
      }
      return Object.freeze({ items });
    },
    copyTemplate(sourceTemplateId, body) {
      if (!body || body.sourceTemplateId !== sourceTemplateId) {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_RULE_TEMPLATE_TARGET_MISMATCH',
          'URL中的来源Template与请求体目标必须一致。',
          { pathTemplateId: sourceTemplateId, bodyTemplateId: body?.sourceTemplateId },
        );
      }
      return expose(invoke(() => store.copyTemplate(commandBody(body))));
    },
    reviseDraft(templateId, body) {
      return expose(invoke(() => store.reviseDraft(commandBody(target(templateId, body)))));
    },
    previewTemplate(templateId, body) {
      return invoke(() => store.previewTemplate(commandBody(target(templateId, body))));
    },
    publishTemplate(templateId, body) {
      return expose(invoke(() => store.publishTemplate(commandBody(target(templateId, body)))));
    },
    archiveTemplate(templateId, body) {
      return expose(invoke(() => store.archiveTemplate(commandBody(target(templateId, body)))));
    },
    bindShelf(shelfId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          body.shelfId !== shelfId) {
        throw new ArcaRuleTemplateAdminApplicationError(
          'ADMIN_SHELF_TARGET_MISMATCH',
          'URL中的Shelf与请求体目标必须一致。',
          { pathShelfId: shelfId, bodyShelfId: body?.shelfId },
        );
      }
      return expose(invoke(() => store.bindShelf(commandBody(body))));
    },
  });
}

module.exports = Object.freeze({
  ArcaRuleTemplateAdminApplicationError,
  createArcaRuleTemplateAdminApplication,
});
