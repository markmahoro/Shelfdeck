import { useState, useEffect } from 'react';

interface Settings {
  serviceUrl: string;
  serviceApiKey: string;
  playerExePath: string;
  localPathMapFrom: string;
  localPathMapTo: string;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const PANEL: React.CSSProperties = {
  background: '#fff',
  borderRadius: '12px',
  padding: '24px',
  width: '400px',
  maxHeight: '80vh',
  overflowY: 'auto',
};

const INPUT: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  fontSize: '14px',
  width: '100%',
  boxSizing: 'border-box',
};

const LABEL: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  color: '#666',
  marginBottom: '4px',
  marginTop: '12px',
};

const BTN: React.CSSProperties = {
  padding: '8px 20px',
  background: '#4a90d9',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  marginTop: '16px',
};

declare global {
  interface Window {
    shelfdeckSettings?: {
      get: () => Promise<Settings>;
      set: (key: string, value: any) => Promise<boolean>;
      getKey: (key: string) => Promise<any>;
    };
  }
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>({
    serviceUrl: 'http://127.0.0.1:18080',
    serviceApiKey: '',
    playerExePath: '',
    localPathMapFrom: '',
    localPathMapTo: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (window.shelfdeckSettings) {
      window.shelfdeckSettings.get().then(s => setSettings(s));
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    if (window.shelfdeckSettings) {
      for (const [k, v] of Object.entries(settings)) {
        await window.shelfdeckSettings.set(k, v);
      }
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={PANEL} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0 }}>设置</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>

        <label style={LABEL}>媒体服务地址</label>
        <input style={INPUT} value={settings.serviceUrl} onChange={e => setSettings(s => ({ ...s, serviceUrl: e.target.value }))} />

        <label style={LABEL}>服务 API Key</label>
        <input style={INPUT} type="password" value={settings.serviceApiKey} onChange={e => setSettings(s => ({ ...s, serviceApiKey: e.target.value }))} />

        <label style={LABEL}>播放器路径（PotPlayer）</label>
        <input style={INPUT} value={settings.playerExePath} onChange={e => setSettings(s => ({ ...s, playerExePath: e.target.value }))} />

        <label style={LABEL}>本地路径映射（源）</label>
        <input style={INPUT} value={settings.localPathMapFrom} onChange={e => setSettings(s => ({ ...s, localPathMapFrom: e.target.value }))} placeholder="D:\\media" />

        <label style={LABEL}>本地路径映射（目标）</label>
        <input style={INPUT} value={settings.localPathMapTo} onChange={e => setSettings(s => ({ ...s, localPathMapTo: e.target.value }))} placeholder="\\NAS\media" />

        <button style={BTN} onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
        {saved && <span style={{ marginLeft: '12px', color: '#27ae60', fontSize: '13px' }}>已保存</span>}
      </div>
    </div>
  );
}