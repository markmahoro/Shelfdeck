import { useMemo, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import NodesPage from './NodesPage';
import ResourceCapacityPage from './ResourceCapacityPage';
import ResourceViewPage from './ResourceViewPage';
import TranscodeConfigPage from './TranscodeConfigPage';

type AdvancedTab = 'resources' | 'scheduler' | 'diagnostics' | 'events';

const TABS: Array<{ key: AdvancedTab; label: string }> = [
  { key: 'resources', label: '资源与节点' },
  { key: 'scheduler', label: '任务调度高级项' },
  { key: 'diagnostics', label: '系统诊断' },
  { key: 'events', label: '日志与事件' },
];

export default function AdvancedPage() {
  const [params, setParams] = useSearchParams();
  const activeTab = useMemo<AdvancedTab>(() => {
    const tab = params.get('tab');
    return TABS.some((item) => item.key === tab) ? tab as AdvancedTab : 'resources';
  }, [params]);

  function setTab(tab: AdvancedTab) {
    setParams({ tab });
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>高级</h1>
          <p style={subtitleStyle}>资源、节点、诊断和运维排障入口。普通用户主路径不展示这些内部事实。</p>
        </div>
      </header>
      <div style={tabsStyle}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setTab(tab.key)}
            style={tab.key === activeTab ? activeTabStyle : tabStyle}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <section style={contentStyle}>
        {activeTab === 'resources' && (
          <>
            <ResourceCapacityPage />
            <NodesPage />
            <TranscodeConfigPage />
          </>
        )}
        {activeTab === 'scheduler' && <SchedulerAdvancedPlaceholder />}
        {activeTab === 'diagnostics' && <ResourceViewPage />}
        {activeTab === 'events' && <ResourceViewPage />}
      </section>
    </div>
  );
}

function SchedulerAdvancedPlaceholder() {
  return (
    <div style={placeholderStyle}>
      <h2 style={placeholderTitleStyle}>任务调度高级项</h2>
      <p style={placeholderTextStyle}>
        本切片先固定高级页面位置。后续 Slice 6 会把低频调度和诊断配置迁入这里。
      </p>
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: '100%', background: '#f5f7fb' };
const headerStyle: CSSProperties = { padding: '24px 24px 8px' };
const titleStyle: CSSProperties = { margin: 0, fontSize: 26, color: '#1a1a2e' };
const subtitleStyle: CSSProperties = { margin: '6px 0 0', color: '#64748b', fontSize: 14 };
const tabsStyle: CSSProperties = { display: 'flex', gap: 8, padding: '8px 24px 16px', flexWrap: 'wrap' };
const tabStyle: CSSProperties = {
  border: '1px solid #d8dee9',
  background: '#fff',
  color: '#334155',
  borderRadius: 6,
  padding: '8px 12px',
  cursor: 'pointer',
  fontWeight: 600,
};
const activeTabStyle: CSSProperties = {
  ...tabStyle,
  background: '#1a1a2e',
  borderColor: '#1a1a2e',
  color: '#fff',
};
const contentStyle: CSSProperties = { background: '#f5f7fb' };
const placeholderStyle: CSSProperties = {
  margin: 24,
  padding: 24,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
};
const placeholderTitleStyle: CSSProperties = { margin: '0 0 8px', color: '#1a1a2e' };
const placeholderTextStyle: CSSProperties = { margin: 0, color: '#64748b', lineHeight: 1.6 };
