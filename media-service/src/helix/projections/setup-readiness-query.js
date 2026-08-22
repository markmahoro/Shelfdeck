'use strict';

const { buildProjection } = require('./projection-builder');

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function standingEnabled(authorization) {
  return authorization?.state === 'enabled';
}

function consequenceRows(productChoice) {
  if (productChoice === 'full_auto') {
    return Object.freeze([
      Object.freeze({
        owner: 'arca',
        topic: 'input_settlement',
        text: '上架时自动处理当前范围内的旧输入文件，且必须明确包含独占附属文件；目录、共享或歧义材料不在授权内。',
      }),
      Object.freeze({
        owner: 'arca',
        topic: 'aftercare',
        text: '安全、确定性的收藏健康自动修复会继续执行。',
      }),
      Object.freeze({
        owner: 'procurement',
        topic: 'accepted_automation',
        text: '文件来源发现与整理准备仍按已确认自动化推进。',
      }),
      Object.freeze({
        owner: 'libra',
        topic: 'accepted_automation',
        text: '去向、验收规格和生产仍按已确认自动化推进；上架接纳不能被跳过。',
      }),
      Object.freeze({
        owner: 'people',
        topic: 'weak_identity',
        text: '弱人物身份仍需你确认，全自动不会代为接受。',
      }),
      Object.freeze({
        owner: 'arca_offdeck',
        topic: 'offdeck_destruction',
        text: '退出收藏的物理销毁保持独立关闭。全自动不会授予删除权。',
      }),
    ]);
  }
  return Object.freeze([
    Object.freeze({
      owner: 'arca',
      topic: 'input_settlement',
      text: '其余自动化保持不变，但每次上架处理旧输入文件前都要确认当前冻结范围。',
    }),
    Object.freeze({
      owner: 'arca',
      topic: 'aftercare',
      text: '安全、确定性的收藏健康自动修复仍会执行。',
    }),
    Object.freeze({
      owner: 'procurement',
      topic: 'accepted_automation',
      text: '文件来源发现与整理准备仍按已确认自动化推进。',
    }),
    Object.freeze({
      owner: 'libra',
      topic: 'accepted_automation',
      text: '去向、验收规格和生产仍按已确认自动化推进。',
    }),
    Object.freeze({
      owner: 'people',
      topic: 'weak_identity',
      text: '弱人物身份仍需你确认。',
    }),
    Object.freeze({
      owner: 'arca_offdeck',
      topic: 'offdeck_destruction',
      text: '退出收藏的物理销毁保持独立关闭，与此选择无关。',
    }),
  ]);
}

function createSetupReadinessQuery(options) {
  if (!options || typeof options.readMaterialFields !== 'function'
      || typeof options.readShelves !== 'function'
      || typeof options.readStandingAuthorization !== 'function') {
    throw new TypeError('Setup Readiness readers are required.');
  }
  const now = options.now || Date.now;

  function get() {
    const nowMs = now();
    const fields = options.readMaterialFields()?.items || [];
    const shelves = options.readShelves()?.items || [];
    const authorization = options.readStandingAuthorization() || null;
    const activeFields = fields.filter((field) => field.status === 'active');
    const activeShelves = shelves.filter((shelf) => shelf.status === 'active');
    const routingMissing = activeFields.filter((field) => {
      if (typeof options.readRouting !== 'function') return true;
      const policy = options.readRouting(field.fieldId)?.policy;
      return !policy || !policy.revision;
    });
    let workspaceReady = false;
    if (typeof options.readWorkspace === 'function') {
      try {
        const workspace = options.readWorkspace();
        workspaceReady = workspace === true
          || workspace?.ready === true
          || (typeof workspace?.rootPath === 'string' && workspace.rootPath.length > 0);
      } catch {
        workspaceReady = false;
      }
    }
    let providerReady = false;
    if (typeof options.readIntegration === 'function') {
      try {
        providerReady = options.readIntegration('tmdb')?.configured === true;
      } catch {
        providerReady = false;
      }
    }
    const settlementReady = standingEnabled(authorization);
    const productChoice = settlementReady ? 'full_auto' : 'key_step_confirmation';
    const items = Object.freeze([
      Object.freeze({
        key: 'material_field',
        owner: 'procurement',
        ready: activeFields.length > 0,
        label: activeFields.length > 0 ? '已有活动文件来源' : '还没有活动文件来源',
        href: '/material-fields',
      }),
      Object.freeze({
        key: 'shelf',
        owner: 'arca',
        ready: activeShelves.length > 0,
        label: activeShelves.length > 0 ? '已有活动收藏架' : '还没有活动收藏架',
        href: '/shelves',
      }),
      Object.freeze({
        key: 'routing',
        owner: 'libra',
        ready: activeFields.length > 0 && routingMissing.length === 0,
        label: activeFields.length === 0
          ? '去向方案需先有文件来源'
          : routingMissing.length === 0 ? '活动文件来源都已设置去向' : '还有文件来源未设置去向',
        href: '/material-fields',
      }),
      Object.freeze({
        key: 'workspace',
        owner: 'platform',
        ready: workspaceReady,
        label: workspaceReady ? '生产工作区可用' : '生产工作区尚未就绪',
        href: '/settings',
      }),
      Object.freeze({
        key: 'provider',
        owner: 'platform',
        ready: providerReady,
        label: providerReady ? 'TMDB 已连接' : '电影身份需要连接 TMDB',
        href: '/settings',
      }),
      Object.freeze({
        key: 'standing_authorization',
        owner: 'arca',
        ready: settlementReady,
        label: settlementReady ? '已启用上架旧输入自动处理授权' : '上架旧输入仍需每次确认',
        href: '/settings',
      }),
    ]);
    const fullAutoReady = items.every((item) => item.ready);
    const expectedRevision = integer(authorization?.revision);
    return buildProjection({
      projectionVersion: 1,
      asOf: new Date(nowMs).toISOString(),
      freshness: 'fresh',
      sources: [
        { owner: 'procurement', revision: activeFields.length },
        { owner: 'arca', revision: expectedRevision || activeShelves.length },
        { owner: 'libra', revision: activeFields.length - routingMissing.length },
      ],
      data: {
        productChoice,
        fullAutoReady,
        productChoiceLabel: productChoice === 'full_auto' ? '全自动（推荐）' : '关键步骤确认',
        fullAutoReadyLabel: fullAutoReady ? '全自动已就绪' : '全自动尚未就绪',
        standingInputSettlement: authorization && Object.freeze({
          enabled: settlementReady,
          authorizationId: authorization.authorizationId,
          revision: authorization.revision,
          authorizationScopeKind: authorization.authorizationScopeKind,
          coversExclusiveRelatedInput: authorization.coversExclusiveRelatedInput === true,
        }),
        offdeckDestruction: Object.freeze({
          independentlyDisabled: true,
          grantedByFullAuto: false,
          label: '退出收藏销毁保持独立关闭',
        }),
        items,
        consequences: consequenceRows(productChoice),
      },
      availableActions: [
        Object.freeze({
          actionCode: 'enable_full_automatic_operation',
          label: '启用全自动',
          expectedRevision,
          requiresConfirmation: false,
        }),
        Object.freeze({
          actionCode: 'require_settlement_confirmation',
          label: '改为关键步骤确认',
          expectedRevision,
          requiresConfirmation: false,
        }),
      ],
    });
  }

  return Object.freeze({ get });
}

module.exports = Object.freeze({ createSetupReadinessQuery });
