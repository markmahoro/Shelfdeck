/**
 * [SETTINGS] 本地设置面板（覆盖层组件）。
 */

import { useState, useEffect } from 'react';
import { getSettings, saveSetting, saveSubLibraryPathMaps, STORE_KEYS, type DesktopSettings, type SubLibraryPathMap } from './store';
import type { SubLibraryInfo } from '../App';

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
};
const PANEL: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 24, width: 480, maxHeight: '80vh', overflowY: 'auto',
};
const INPUT: React.CSSProperties = {
  padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: 13, color: '#666', marginBottom: 4, marginTop: 12,
};
const BTN: React.CSSProperties = {
  padding: '8px 20px', background: '#4a90d9', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginTop: 16,
};

export default function SettingsPanel({ onClose, subLibraries }: { onClose: () => void; subLibraries: SubLibraryInfo[] }) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => setSettings(s))
      .catch((e) => console.error('SettingsPanel load error:', e));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    const entries: [keyof typeof STORE_KEYS, string][] = [
      ['serviceUrl', settings.serviceUrl || 'http://127.0.0.1:18080'],
      ['serviceApiKey', settings.serviceApiKey || ''],
      ['playerExePath', settings.playerExePath || ''],
    ];
    let firstError: string | null = null;
    for (const [key, value] of entries) {
      const r = await saveSetting(key, value);
      if (!r.ok && !firstError) firstError = r.error || `保存 ${key} 失败`;
    }
    // Save per-subLibrary path maps
    const mapsResult = await saveSubLibraryPathMaps(settings.subLibraryPathMaps || {});
    if (!mapsResult.ok && !firstError) firstError = mapsResult.error || '保存媒体库路径映射失败';

    if (firstError) {
      setSaveError(firstError);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  const updateSubLibMap = (uuid: string, field: 'from' | 'to', value: string) => {
    setSettings((s) => {
      if (!s) return s;
      const maps = { ...(s.subLibraryPathMaps || {}) };
      maps[uuid] = { ...(maps[uuid] || { from: '', to: '' }), [field]: value };
      return { ...s, subLibraryPathMaps: maps };
    });
  };

  if (!settings) return null;

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={PANEL} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>设置</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        <label style={LABEL}>媒体服务地址</label>
        <input style={INPUT} value={settings.serviceUrl} onChange={(e) => setSettings((s) => s ? { ...s, serviceUrl: e.target.value } : s)} />

        <label style={LABEL}>服务 API Key</label>
        <input style={INPUT} type="password" value={settings.serviceApiKey} onChange={(e) => setSettings((s) => s ? { ...s, serviceApiKey: e.target.value } : s)} />

        <label style={LABEL}>播放器路径（PotPlayer）</label>
        <input style={INPUT} value={settings.playerExePath} onChange={(e) => setSettings((s) => s ? { ...s, playerExePath: e.target.value } : s)} />

        {/* ── 媒体库路径映射 ── */}
        {subLibraries.length > 0 && (
          <>
            <h4 style={{ marginTop: 20, marginBottom: 4, fontSize: 14, color: '#333' }}>媒体库目录映射</h4>
            <p style={{ margin: 0, fontSize: 11, color: '#999' }}>每个媒体库可单独配置 NAS 路径到本地的映射</p>
            {subLibraries.map((sl) => {
              const m = (settings.subLibraryPathMaps || {})[sl.uuid] || { from: '', to: '' };
              return (
                <div key={sl.uuid} style={{ marginTop: 10, padding: '10px 12px', background: '#f8f9fa', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#333' }}>{sl.name}</div>
                  <label style={{ ...LABEL, marginTop: 4, fontSize: 12 }}>源路径（NAS）</label>
                  <input style={INPUT} value={m.from} onChange={(e) => updateSubLibMap(sl.uuid, 'from', e.target.value)}
                    placeholder="/volume1/Media" />
                  <label style={{ ...LABEL, marginTop: 4, fontSize: 12 }}>目标路径（本地）</label>
                  <input style={INPUT} value={m.to} onChange={(e) => updateSubLibMap(sl.uuid, 'to', e.target.value)}
                    placeholder="Z:\\" />
                </div>
              );
            })}
          </>
        )}

        {saveError && <div style={{ marginTop: 12, color: '#e74c3c', fontSize: 13 }}>{saveError}</div>}
        <button style={BTN} onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
        {saved && <span style={{ marginLeft: 12, color: '#27ae60', fontSize: 13 }}>已保存</span>}
      </div>
    </div>
  );
}
