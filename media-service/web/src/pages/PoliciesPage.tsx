import { useMemo, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdultConfigPage from './AdultConfigPage';
import DoubanConfigPage from './DoubanConfigPage';
import DisposalPolicyPage from './DisposalPolicyPage';
import MoviePilotConfigPage from './MoviePilotConfigPage';
import RuleTemplatesPage from './RuleTemplatesPage';
import SystemConfigPage from './SystemConfigPage';

type PolicyTab = 'library' | 'perception' | 'objectives' | 'automation' | 'disposal';

const TABS: Array<{ key: PolicyTab; label: string }> = [
  { key: 'library', label: '媒体库配置' },
  { key: 'perception', label: '用户感知' },
  { key: 'objectives', label: '媒体优化目标' },
  { key: 'automation', label: '自动化策略' },
  { key: 'disposal', label: '处置策略' },
];

export default function PoliciesPage() {
  const [params, setParams] = useSearchParams();
  const activeTab = useMemo<PolicyTab>(() => {
    const tab = params.get('tab');
    return TABS.some((item) => item.key === tab) ? tab as PolicyTab : 'library';
  }, [params]);

  function setTab(tab: PolicyTab) {
    setParams({ tab });
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>管理策略</h1>
          <p style={subtitleStyle}>配置媒体库、用户感知、媒体优化目标、自动化和归档后处置。</p>
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
        {activeTab === 'library' && <AdultConfigPage />}
        {activeTab === 'perception' && <DoubanConfigPage />}
        {activeTab === 'objectives' && <RuleTemplatesPage />}
        {activeTab === 'automation' && (
          <>
            <SystemConfigPage />
            <MoviePilotConfigPage />
          </>
        )}
        {activeTab === 'disposal' && <DisposalPolicyPage />}
      </section>
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
