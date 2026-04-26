import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { douban, subLibraries } from '../api/client';
import type { SubLibrary } from '../types';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

export default function DoubanConfigPage() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [userId, setUserId] = useState('');
  const [cookieHeader, setCookieHeader] = useState('');
  const [interestsRssUrl, setInterestsRssUrl] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Queries
  const { isLoading: sessionLoading } = useQuery({
    queryKey: ['douban-session'],
    queryFn: async () => {
      const s = await douban.getSession();
      if (!initialized) {
        setUserId(s.userId || '');
        setCookieHeader(s.cookieHeader || '');
        setInterestsRssUrl(s.interestsRssUrl || '');
        setInitialized(true);
      }
      return s;
    },
  });

  const { data: subLibData } = useQuery({
    queryKey: ['sublibraries'],
    queryFn: subLibraries.list,
    refetchInterval: 10000,
  });

  // Mutations
  const saveSession = useMutation({
    mutationFn: () => douban.saveSession({ userId, cookieHeader, interestsRssUrl }),
    onSuccess: (data) => {
      setAlert({ type: 'success', msg: `已保存。用户: ${data.userId}` });
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const fetchRatings = useMutation({
    mutationFn: (subLibraryId: string) => douban.fetchRatings(subLibraryId),
    onSuccess: () => setAlert({ type: 'success', msg: '豆瓣同步已触发，请稍后查看媒体库变化' }),
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (sessionLoading) return <LoadingSpinner />;

  const subLibs: SubLibrary[] = subLibData?.subLibraries || [];

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: '#1a1a2e' }}>豆瓣设置</h2>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={4000} />}

      {/* Session config */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>豆瓣会话配置</h3>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          登录豆瓣后，在浏览器开发者工具 → Application → Cookies 中复制完整的 Cookie 字符串。
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>豆瓣用户 ID（people/ 与 /collect 之间的部分）</label>
            <input type="text" value={userId} onChange={(e) => setUserId(e.target.value)} style={inputStyle} placeholder="例如: ahbei" />
          </div>
          <div>
            <label style={labelStyle}>收藏 RSS URL（可选）</label>
            <input type="text" value={interestsRssUrl} onChange={(e) => setInterestsRssUrl(e.target.value)} style={inputStyle} placeholder="https://www.douban.com/feed/people/账号/interests" />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>Cookie Header</label>
          <textarea value={cookieHeader} onChange={(e) => setCookieHeader(e.target.value)} style={{ ...inputStyle, height: 80, resize: 'vertical' }} placeholder="粘贴完整的 Cookie 字符串" />
        </div>
        <div style={{ marginTop: 16 }}>
          <button onClick={() => saveSession.mutate()} disabled={saveSession.isPending} style={primaryBtn}>
            {saveSession.isPending ? '保存中...' : '保存会话配置'}
          </button>
        </div>
      </section>

      {/* Sync trigger per subLibrary */}
      <section style={cardStyle}>
        <h3 style={sectionTitle}>同步豆瓣评分</h3>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          选择开启了豆瓣同步的子库，点击同步按钮，从豆瓣「看过」列表抓取评分。
        </p>
        {subLibs.length === 0 ? (
          <p style={{ color: '#aaa', fontSize: 14 }}>暂无子库。请先在「媒体库」中添加子库并开启豆瓣同步。</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>子库名称</th>
                <th style={thStyle}>豆瓣同步</th>
                <th style={thStyle}>上次同步</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {subLibs.map((sl) => (
                <tr key={sl.uuid}>
                  <td style={tdStyle}>{sl.name}</td>
                  <td style={tdStyle}>{sl.doubanEnabled ? '✅' : '—'}</td>
                  <td style={tdStyle}>{sl.doubanSyncedAt ? new Date(sl.doubanSyncedAt).toLocaleString('zh-CN') : '从未同步'}</td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => fetchRatings.mutate(sl.uuid)}
                      disabled={fetchRatings.isPending || !sl.doubanEnabled}
                      style={{ ...secondaryBtn, opacity: sl.doubanEnabled ? 1 : 0.5 }}
                    >
                      {fetchRatings.isPending ? '同步中...' : '同步评分'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 600, marginBottom: 16, color: '#1a1a2e',
};

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', color: '#666',
};

const tdStyle: React.CSSProperties = {
  padding: '8px', borderBottom: '1px solid #f0f0f0',
};

const primaryBtn: React.CSSProperties = {
  background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};

const secondaryBtn: React.CSSProperties = {
  background: '#f0f0f0', color: '#333', border: 'none', padding: '8px 20px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14,
};
