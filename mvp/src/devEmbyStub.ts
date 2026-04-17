/**
 * 浏览器直连 Vite（无 Electron preload）时注入 window.embyApi，与 electron/preload.js 行为对齐便于调试。
 */
export function installDevEmbyStub() {
  if (typeof window === 'undefined' || typeof window.embyApi !== 'undefined') return;

  const daysAgoIso = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

  const mockPlayed: PlayedItem[] = [
    {
      id: 'debug-ph-1',
      name: '[模拟] 已看电影 Alpha',
      posterTag: 'p1',
      sectionId: 'debug-section-1',
      sectionName: 'Movies',
      datePlayed: daysAgoIso(1),
      type: 'Movie',
    },
    {
      id: 'debug-ph-2',
      name: '[模拟] 已看剧集 S01E01',
      posterTag: 'p2',
      sectionId: 'debug-section-2',
      sectionName: 'TV Shows',
      datePlayed: daysAgoIso(3),
      type: 'Episode',
      seriesName: '模拟连续剧',
      indexLabel: 'S01E01',
    },
    {
      id: 'debug-ph-3',
      name: '[模拟] 上周电影 Beta',
      posterTag: 'p3',
      sectionId: 'debug-section-1',
      sectionName: 'Movies',
      datePlayed: daysAgoIso(9),
      type: 'Movie',
    },
  ];

  const mockUnplayedForSection = (sectionId?: string): UnplayedItem[] => {
    const base = sectionId || 'debug-section-1';
    const rt = (h: number) => Math.round(h * 3600 * 10_000_000);
    return [
      {
        id: `${base}:m1`,
        name: '[模拟] 未看长片 A',
        sectionId: base,
        posterTag: 'a',
        runTimeTicks: rt(2.1),
        durationSec: Math.round(2.1 * 3600),
        sizeGb: 18.2,
        resolution: '4K' as const,
        codec: 'h264' as const,
        itemType: 'Movie' as const,
      },
      {
        id: `${base}:m2`,
        name: '[模拟] 未看长片 B（stub 标记为原盘，用于测入队拦截）',
        sectionId: base,
        posterTag: 'b',
        runTimeTicks: rt(1.5),
        durationSec: Math.round(1.5 * 3600),
        sizeGb: 6.4,
        resolution: '1080p' as const,
        codec: 'h265' as const,
        itemType: 'Movie' as const,
        isBluRayDisc: true,
      },
      {
        id: `${base}:m3`,
        name: '[模拟] 未看长片 C',
        sectionId: base,
        posterTag: 'c',
        runTimeTicks: rt(2.8),
        durationSec: Math.round(2.8 * 3600),
        sizeGb: 4.1,
        resolution: '1080p' as const,
        codec: 'h264' as const,
        itemType: 'Movie' as const,
      },
      {
        id: `${base}:m4`,
        name: '[模拟] 未看短片 D',
        sectionId: base,
        posterTag: 'd',
        runTimeTicks: rt(0.9),
        durationSec: Math.round(0.9 * 3600),
        sizeGb: 2.2,
        resolution: '1080p' as const,
        codec: 'av1' as const,
        itemType: 'Movie' as const,
      },
    ];
  };

  window.embyApi = {
    async testConnection() {
      return { serverName: 'Dev Stub (Vite)', version: 'browser-dev' };
    },
    async getUsers() {
      return [
        { id: 'debug-user-1', name: 'Debug User' },
        { id: 'debug-user-2', name: 'Guest User' },
      ];
    },
       async getMediaFolders() {
      return [
        { id: 'debug-section-1', name: 'Movies' },
        { id: 'debug-section-2', name: 'TV Shows' },
      ];
    },
    async getUnplayedItems({ sectionId }) {
      return mockUnplayedForSection(sectionId).map((x) => ({ ...x, embyPlayed: false }));
    },
    async getLibraryItemsForManage({ config }) {
      const sections =
        config.enabledSectionIds && config.enabledSectionIds.length > 0
          ? config.enabledSectionIds
          : ['debug-section-1', 'debug-section-2'];
      const byId = new Map<string, UnplayedItem>();
      for (const sid of sections) {
        for (const it of mockUnplayedForSection(sid)) {
          byId.set(it.id, { ...it, embyPlayed: false });
        }
      }
      for (const p of mockPlayed) {
        const sid = p.sectionId || 'debug-section-1';
        const existing = byId.get(p.id);
        if (existing) {
          byId.set(p.id, { ...existing, embyPlayed: true });
        } else {
          byId.set(p.id, {
            id: p.id,
            name: p.name,
            sectionId: sid,
            posterTag: p.posterTag,
            runTimeTicks: Math.round(1.85 * 3600 * 10_000_000),
            durationSec: Math.round(1.85 * 3600),
            sizeGb: 7.2,
            resolution: '1080p',
            codec: 'h265',
            embyPlayed: true,
            itemType: p.type === 'Episode' ? 'Episode' : 'Movie',
          });
        }
      }
      return Array.from(byId.values());
    },
    async getPlayedItems(args) {
      let rows = [...mockPlayed];
      const sid = args?.sectionId?.trim();
      if (sid) rows = rows.filter((r) => r.sectionId === sid);
      const typ = args?.type;
      if (typ && typ !== 'all') rows = rows.filter((r) => r.type === typ);
      const days = args?.days;
      if (days && days > 0) {
        const cutoff = Date.now() - days * 86400000;
        rows = rows.filter((r) => {
          const t = r.datePlayed ? new Date(r.datePlayed).getTime() : 0;
          return t >= cutoff;
        });
      }
      return rows;
    },
    async launchPlayer({ item }) {
      return {
        sessionStartedAtMs: Date.now(),
        runtimeSeconds: 7200,
        debug: {
          originalPath: item?.name ?? 'unknown',
          mappedPath: item?.name ?? 'unknown',
        },
      };
    },
    async markPlayed() {
      return;
    },
    async markUnplayed() {
      return;
    },
  };
}
