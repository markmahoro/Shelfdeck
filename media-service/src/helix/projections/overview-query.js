'use strict';

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function createOverviewQuery(options) {
  if (!options || typeof options.readMaterialFields !== 'function' ||
      typeof options.readShelves !== 'function' ||
      typeof options.readFormation !== 'function' ||
      (typeof options.readCollection !== 'function' && typeof options.readCollectionStats !== 'function') ||
      typeof options.readOffdeck !== 'function') {
    throw new TypeError('Overview projection readers are required.');
  }
  const now = options.now || Date.now;

  function collectionStats(nowMs) {
    if (typeof options.readCollectionStats === 'function') return options.readCollectionStats(nowMs);
    const monthStartMs = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), 1);
    const entries = (options.readCollection().items || []).filter((entry) => entry.status === 'active');
    return Object.freeze({
      currentCount: entries.length,
      monthNewCount: entries.filter((entry) => integer(entry.createdAtMs) >= monthStartMs).length,
      healthyCount: entries.filter((entry) => entry.health?.state === 'healthy').length,
      healthAttentionCount: entries.filter((entry) => entry.health?.state === 'attention_required').length,
      recentOnDeck: Object.freeze(entries.slice(0, 5).map((entry) => Object.freeze({
        shelfEntryId: entry.shelfEntryId, displayIdentity: entry.displayIdentity, createdAtMs: entry.createdAtMs,
      }))),
    });
  }

  function formationBundle() {
    const value = options.readFormation();
    if (value && value.summary) return value;
    const summary = value.summary || {};
    return Object.freeze({
      summary,
      attentionItems: value.items || [],
      inProgressItems: [],
      completedItems: [],
    });
  }

  function get() {
    const nowMs = now();
    const fields = options.readMaterialFields().items || [];
    const shelves = options.readShelves().items || [];
    const formation = formationBundle();
    const collection = collectionStats(nowMs);
    const offdeck = options.readOffdeck();
    const people = typeof options.readPeopleSummary === 'function' ? options.readPeopleSummary() : null;
    const activeFields = fields.filter((field) => field.status === 'active');
    const activeShelves = shelves.filter((shelf) => shelf.status === 'active');
    const offdeckAttentionCount = (offdeck.candidates || [])
      .filter((candidate) => !['suppressed', 'completed', 'terminal'].includes(candidate.state)).length;
    const formationAttention = integer(formation.summary?.attentionRequiredCount);
    const peopleAttention = integer(people?.openRegistrationCandidateCount);
    const healthKind = options.readHealth?.()?.kind || 'ready';
    let systemKind = 'running';
    let systemHref = '/';
    if (healthKind === 'faulted') {
      systemKind = 'faulted';
    } else if (!activeFields.length || !activeShelves.length) {
      systemKind = 'unconfigured';
      systemHref = !activeFields.length ? '/material-fields' : '/shelves';
    }
    const systemLabels = {
      unconfigured: '尚未配置',
      running: '正常运行',
      faulted: '系统故障',
    };
    const todos = [
      formationAttention ? Object.freeze({ key:'formation', label:'整理需要处理', count:formationAttention, href:'/formation' }) : null,
      collection.healthAttentionCount ? Object.freeze({ key:'health', label:'收藏健康需要处理', count:collection.healthAttentionCount, href:'/collection' }) : null,
      offdeckAttentionCount ? Object.freeze({ key:'offdeck', label:'退出收藏待审阅', count:offdeckAttentionCount, href:'/offdeck' }) : null,
      peopleAttention ? Object.freeze({ key:'people', label:'人物待确认', count:peopleAttention, href:'/people' }) : null,
      !activeFields.length ? Object.freeze({ key:'fields', label:'还没有文件来源', count:1, href:'/material-fields' }) : null,
      activeFields.length && !activeShelves.length ? Object.freeze({ key:'shelves', label:'还没有收藏架', count:1, href:'/shelves' }) : null,
    ].filter(Boolean);
    const ledger = [];
    for (const item of formation.completedItems || []) {
      ledger.push(Object.freeze({ key:'completed:'+item.subjectId, label:'已上架 · ' + item.displayIdentity, href:'/collection' }));
    }
    for (const item of collection.recentOnDeck || []) {
      if (ledger.some((row) => row.label.endsWith(item.displayIdentity))) continue;
      ledger.push(Object.freeze({ key:'ondeck:'+item.shelfEntryId, label:'新上架 · ' + item.displayIdentity, href:'/collection' }));
    }
    for (const item of formation.inProgressItems || []) {
      ledger.push(Object.freeze({ key:'progress:'+item.subjectId, label:'正在整理 · ' + item.displayIdentity, href:'/formation' }));
    }
    const inProgressCount = integer(formation.summary?.inProgressCount);

    return Object.freeze({
      generatedAt: new Date(nowMs).toISOString(),
      systemState: Object.freeze({
        kind: systemKind, label: systemLabels[systemKind], href: systemHref,
      }),
      metrics: Object.freeze([
        Object.freeze({ key:'active_collection', label:'正式收藏', value:collection.currentCount,
          note:'当前在收藏架上', href:'/collection' }),
        Object.freeze({ key:'new_this_month', label:'本月新上架',
          value:collection.monthNewCount, note:'本月完成上架', href:'/collection' }),
        Object.freeze({ key:'healthy_collection', label:'健康收藏', value:collection.healthyCount,
          note:'检查结果为健康', href:'/collection' }),
      ]),
      todos: Object.freeze(todos),
      inProgress: inProgressCount ? Object.freeze({
        count: inProgressCount, label:'正在整理', href:'/formation',
      }) : null,
      setup: Object.freeze({
        activeMaterialFieldCount: activeFields.length,
        activeShelfCount: activeShelves.length,
      }),
      ledger: Object.freeze(ledger.slice(0, 8)),
    });
  }

  return Object.freeze({ get });
}

module.exports = Object.freeze({ createOverviewQuery });
