'use strict';

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function createOverviewQuery(options) {
  if (!options || typeof options.readMaterialFields !== 'function' ||
      typeof options.readShelves !== 'function' ||
      typeof options.readFormation !== 'function' ||
      typeof options.readCollection !== 'function' ||
      typeof options.readOffdeck !== 'function') {
    throw new TypeError('Overview projection readers are required.');
  }
  const now = options.now || Date.now;

  function get() {
    const nowMs = now();
    const date = new Date(nowMs);
    const monthStartMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const fields = options.readMaterialFields().items || [];
    const shelves = options.readShelves().items || [];
    const formation = options.readFormation();
    const entries = (options.readCollection().items || [])
      .filter((entry) => entry.status === 'active');
    const offdeck = options.readOffdeck();
    const activeFields = fields.filter((field) => field.status === 'active');
    const activeShelves = shelves.filter((shelf) => shelf.status === 'active');
    const healthyCount = entries.filter((entry) => entry.health?.state === 'healthy').length;
    const healthAttentionCount = entries
      .filter((entry) => entry.health?.state === 'attention_required').length;
    const offdeckAttentionCount = (offdeck.candidates || [])
      .filter((candidate) => !['suppressed', 'completed', 'terminal'].includes(candidate.state)).length;
    const discoveredCount = activeFields.reduce(
      (total, field) => total + integer(field.procurementStatus?.candidateCount),
      0,
    );
    const formationSummary = formation.summary || {};
    const assessedCount = entries.filter(
      (entry) => entry.health?.state && entry.health.state !== 'never_assessed',
    ).length;

    return Object.freeze({
      generatedAt: new Date(nowMs).toISOString(),
      metrics: Object.freeze([
        Object.freeze({ key:'active_collection', label:'正式收藏', value:entries.length,
          note:'active Shelf Entry' }),
        Object.freeze({ key:'new_this_month', label:'本月新上架',
          value:entries.filter((entry) => integer(entry.createdAtMs) >= monthStartMs).length,
          note:'已完成 On-deck Commit' }),
        Object.freeze({ key:'healthy_collection', label:'健康收藏', value:healthyCount,
          note:'具有 fresh 健康结论' }),
        Object.freeze({ key:'attention', label:'需要处理',
          value:healthAttentionCount + offdeckAttentionCount,
          note:'健康或退出流程待处理' }),
      ]),
      setup: Object.freeze({
        activeMaterialFieldCount: activeFields.length,
        activeShelfCount: activeShelves.length,
      }),
      ledger: Object.freeze([
        Object.freeze({ key:'discovery', label:'发现新材料', value:discoveredCount }),
        Object.freeze({ key:'formation', label:'生产收藏成品', value:integer(formationSummary.totalCount) }),
        Object.freeze({ key:'ondeck', label:'验收并上架', value:entries.length }),
        Object.freeze({ key:'health', label:'持续证明健康', value:assessedCount }),
      ]),
    });
  }

  return Object.freeze({ get });
}

module.exports = Object.freeze({ createOverviewQuery });

