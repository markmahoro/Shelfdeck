const { contextBridge, ipcRenderer } = require('electron');

function notConfigured(name) {
  throw new Error(`${name} is not connected yet. Electron backend API is pending implementation.`);
}

const embyApi = {
  async testConnection() {
    return { serverName: 'Debug Stub', version: 'v1.0.0-dev' };
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
    const base = sectionId || 'debug-section-1';
    const rt = (h) => Math.round(h * 3600 * 10_000_000);
    return [
      { id: `${base}:m1`, name: '[模拟] 未看长片 A', sectionId: base, posterTag: 'a', runTimeTicks: rt(2.1) },
      { id: `${base}:m2`, name: '[模拟] 未看长片 B', sectionId: base, posterTag: 'b', runTimeTicks: rt(1.5) },
      { id: `${base}:m3`, name: '[模拟] 未看长片 C', sectionId: base, posterTag: 'c', runTimeTicks: rt(2.8) },
      { id: `${base}:m4`, name: '[模拟] 未看短片 D', sectionId: base, posterTag: 'd', runTimeTicks: rt(0.9) },
    ];
  },
  async getPlayedItems(args = {}) {
    const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString();
    let rows = [
      {
        id: 'debug-ph-1',
        name: '[模拟] 已看电影 Alpha',
        sectionId: 'debug-section-1',
        sectionName: 'Movies',
        datePlayed: daysAgoIso(1),
        type: 'Movie',
      },
      {
        id: 'debug-ph-2',
        name: '[模拟] 已看剧集 S01E01',
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
        sectionId: 'debug-section-1',
        sectionName: 'Movies',
        datePlayed: daysAgoIso(9),
        type: 'Movie',
      },
    ];
    const sid = args.sectionId && String(args.sectionId).trim();
    if (sid) rows = rows.filter((r) => r.sectionId === sid);
    const typ = args.type;
    if (typ && typ !== 'all') rows = rows.filter((r) => r.type === typ);
    const days = args.days;
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
        originalPath: item?.name || 'unknown',
        mappedPath: item?.name || 'unknown',
      },
    };
  },
  async markPlayed() {
    return;
  },
  async markUnplayed() {
    return;
  },
  async taskControl(args) {
    await ipcRenderer.invoke('taskControl', args);
  },
};

contextBridge.exposeInMainWorld('embyApi', embyApi);

