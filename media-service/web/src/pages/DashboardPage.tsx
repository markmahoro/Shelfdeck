import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardHealth, spaceStats } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { toKairoxDashboardProjection } from '../kairox';

const STATUS_LABEL: Record<string, string> = {
  green: '正常',
  yellow: '需要关注',
  red: '异常',
};

const STATUS_COLOR: Record<string, string> = {
  green: '#047857',
  yellow: '#b45309',
  red: '#b91c1c',
};

function fmtBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export default function DashboardPage() {
  const { data: healthData, isLoading: healthLoading, error: healthError } = useQuery({
    queryKey: ['dashboard-health'],
    queryFn: dashboardHealth.get,
    refetchInterval: 30000,
  });
  const { data: spaceData } = useQuery({
    queryKey: ['space-stats'],
    queryFn: spaceStats.get,
    refetchInterval: 30000,
  });

  if (healthLoading) return <LoadingSpinner text="加载仪表盘..." />;

  if (healthError) {
    return (
      <main style={pageStyle}>
        <h1 style={titleStyle}>仪表盘</h1>
        <div style={errorCardStyle}>仪表盘加载失败：{(healthError as Error).message}</div>
      </main>
    );
  }

  const projection = toKairoxDashboardProjection(healthData, spaceData);
  const statusColor = STATUS_COLOR[projection.health.status] || STATUS_COLOR.yellow;

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>仪表盘</h1>
          <p style={subtitleStyle}>系统健康和媒体库管理成果。绿灯时无需处理。</p>
        </div>
        <div style={{ ...statusPillStyle, color: statusColor, borderColor: statusColor }}>
          {STATUS_LABEL[projection.health.status] || projection.health.status}
        </div>
      </header>

      <section style={gridStyle}>
        <OutcomeCard label="媒体总数" value={projection.outcomes.totalItems} hint="ShelfDeck 当前管理的媒体条目" />
        <OutcomeCard label="元数据就绪" value={projection.outcomes.metadataReadyItems} hint="可进入优化目标判断的条目" />
        <OutcomeCard label="维护完成" value={projection.outcomes.maintenanceCompleteItems} hint="Basedata、Metadata 与 Optimize 均满足当前目标" />
        <OutcomeCard label="退出建议" value={projection.outcomes.offboardingCandidateItems} hint="由 Kairox 建议、Libra 负责协调" to="/offboarding" />
        <OutcomeCard label="已节省空间" value={fmtBytes(projection.optimization.realizedReclaimedBytes)} hint={`潜在可回收 ${fmtBytes(projection.optimization.reclaimableBytes)}`} />
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>服务状态</h2>
          <span style={sectionHintStyle}>只展示用户需要知道的可用性信号</span>
        </div>
        {projection.health.checks.length === 0 ? (
          <div style={emptyStyle}>暂无健康检查结果</div>
        ) : (
          <div style={checkGridStyle}>
            {projection.health.checks.map((check) => (
              <div key={check.key} style={checkCardStyle}>
                <div style={checkTopStyle}>
                  <span style={checkNameStyle}>{check.label}</span>
                  <span style={{ ...checkStatusStyle, color: STATUS_COLOR[check.status] || STATUS_COLOR.yellow }}>
                    {STATUS_LABEL[check.status] || check.status}
                  </span>
                </div>
                {check.message && <div style={checkMessageStyle}>{check.message}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>需要关注</h2>
          <span style={sectionHintStyle}>只列出需要用户知道的风险摘要</span>
        </div>
        {projection.risks.length === 0 ? (
          <div style={greenStateStyle}>当前没有需要处理的事项。</div>
        ) : (
          <div style={riskListStyle}>
            {projection.risks.map((risk) => (
              <div key={risk.code} style={riskItemStyle}>
                <div>
                  <strong>{risk.label}</strong>
                  <div style={riskCodeStyle}>{risk.code}</div>
                </div>
                <div style={riskCountStyle}>{risk.count}</div>
                {risk.target && <Link to={risk.target} style={linkStyle}>查看</Link>}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function OutcomeCard({ label, value, hint, to }: { label: string; value: number | string; hint: string; to?: string }) {
  const body = (
    <div style={cardStyle}>
      <div style={cardLabelStyle}>{label}</div>
      <div style={cardValueStyle}>{value}</div>
      <div style={cardHintStyle}>{hint}</div>
    </div>
  );
  return to ? <Link to={to} style={cardLinkStyle}>{body}</Link> : body;
}

const pageStyle: CSSProperties = { padding: 24, background: '#f5f7fb', minHeight: '100%' };
const headerStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 16 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 28, color: '#1a1a2e' };
const subtitleStyle: CSSProperties = { margin: '6px 0 0', color: '#64748b', fontSize: 14 };
const statusPillStyle: CSSProperties = { border: '1px solid', borderRadius: 999, padding: '8px 14px', background: '#fff', fontWeight: 700 };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 };
const cardStyle: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, minHeight: 112 };
const cardLabelStyle: CSSProperties = { color: '#64748b', fontSize: 13, fontWeight: 700 };
const cardValueStyle: CSSProperties = { color: '#111827', fontSize: 28, fontWeight: 800, marginTop: 8, fontVariantNumeric: 'tabular-nums' };
const cardHintStyle: CSSProperties = { color: '#64748b', fontSize: 12, marginTop: 6, lineHeight: 1.4 };
const cardLinkStyle: CSSProperties = { color: 'inherit', textDecoration: 'none' };
const sectionStyle: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 18, marginTop: 16 };
const sectionHeaderStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 14 };
const sectionTitleStyle: CSSProperties = { margin: 0, color: '#1a1a2e', fontSize: 18 };
const sectionHintStyle: CSSProperties = { color: '#64748b', fontSize: 12 };
const checkGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 };
const checkCardStyle: CSSProperties = { border: '1px solid #eef2f7', borderRadius: 8, padding: 12, background: '#fbfdff' };
const checkTopStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10 };
const checkNameStyle: CSSProperties = { color: '#334155', fontWeight: 700 };
const checkStatusStyle: CSSProperties = { fontWeight: 800, whiteSpace: 'nowrap' };
const checkMessageStyle: CSSProperties = { color: '#64748b', fontSize: 12, marginTop: 6, lineHeight: 1.4 };
const emptyStyle: CSSProperties = { color: '#64748b', fontSize: 14 };
const greenStateStyle: CSSProperties = { color: '#047857', background: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12, fontWeight: 700 };
const riskListStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const riskItemStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 12, border: '1px solid #fee2e2', background: '#fff7f7', borderRadius: 8, padding: 12 };
const riskCodeStyle: CSSProperties = { color: '#991b1b', fontSize: 12, marginTop: 2 };
const riskCountStyle: CSSProperties = { color: '#b91c1c', fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' };
const linkStyle: CSSProperties = { color: '#1a1a2e', fontWeight: 700, textDecoration: 'none' };
const errorCardStyle: CSSProperties = { background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: 8, padding: 16, marginTop: 16 };
