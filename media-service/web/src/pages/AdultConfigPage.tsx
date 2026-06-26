import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adult } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

function csv(values: unknown): string {
  return Array.isArray(values) ? values.join(', ') : '';
}

function csvList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function AdultConfigPage() {
  const qc = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [initialized, setInitialized] = useState(false);

  const [settleSeconds, setSettleSeconds] = useState(30);
  const [scanIntervalMinutes, setScanIntervalMinutes] = useState(10);
  const [autoScrape, setAutoScrape] = useState(true);
  const [proxyServer, setProxyServer] = useState('');
  const [retry, setRetry] = useState(2);
  const [timeout, setTimeoutValue] = useState('PT20S');
  const [crawlers, setCrawlers] = useState('jav321, javbus');
  const [highresCover, setHighresCover] = useState(true);
  const [writeNfo, setWriteNfo] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['adult-config'],
    queryFn: adult.getConfig,
  });

  useEffect(() => {
    if (!data || initialized) return;
    const j = data.japaneseJav || {};
    setSettleSeconds(data.settleSeconds ?? 30);
    setScanIntervalMinutes(data.scanIntervalMinutes ?? 10);
    setAutoScrape(data.autoScrape !== false);
    setProxyServer(String(j.proxyServer || ''));
    setRetry(Number(j.retry ?? 2));
    setTimeoutValue(String(j.timeout || 'PT20S'));
    setCrawlers(csv(j.crawlers) || 'jav321, javbus');
    setHighresCover(j.highresCover !== false);
    setWriteNfo(j.writeNfo !== false);
    setInitialized(true);
  }, [data, initialized]);

  const save = useMutation({
    mutationFn: () => adult.patchConfig({
      settleSeconds,
      scanIntervalMinutes,
      autoScrape,
      japaneseJav: {
        ...(data?.japaneseJav || {}),
        proxyServer,
        retry,
        timeout,
        crawlers: csvList(crawlers),
        highresCover,
        writeNfo,
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adult-config'] });
      setAlert({ type: 'success', msg: '成人库配置已保存' });
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} autoCloseMs={3000} />}
      <section style={card}>
        <h3 style={title}>成人库默认设置</h3>
        <div style={grid}>
          <Field label="稳定等待（秒）"><input style={input} type="number" value={settleSeconds} min={1} onChange={(e) => setSettleSeconds(Number(e.target.value) || 30)} /></Field>
          <Field label="定时扫描（分钟）"><input style={input} type="number" value={scanIntervalMinutes} min={1} onChange={(e) => setScanIntervalMinutes(Number(e.target.value) || 10)} /></Field>
          <label style={check}><input type="checkbox" checked={autoScrape} onChange={(e) => setAutoScrape(e.target.checked)} />自动刮削</label>
        </div>
      </section>

      <section style={card}>
        <h3 style={title}>JAV 刮削</h3>
        <div style={grid}>
          <Field label="代理服务器"><input style={inputWide} value={proxyServer} onChange={(e) => setProxyServer(e.target.value)} placeholder="http://127.0.0.1:7890" /></Field>
          <Field label="重试次数"><input style={input} type="number" value={retry} min={0} onChange={(e) => setRetry(Number(e.target.value) || 0)} /></Field>
          <Field label="超时"><input style={input} value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} /></Field>
          <Field label="Crawler 顺序"><input style={inputWide} value={crawlers} onChange={(e) => setCrawlers(e.target.value)} /></Field>
          <label style={check}><input type="checkbox" checked={highresCover} onChange={(e) => setHighresCover(e.target.checked)} />高清封面</label>
          <label style={check}><input type="checkbox" checked={writeNfo} onChange={(e) => setWriteNfo(e.target.checked)} />写入 NFO</label>
        </div>
        <div style={{ marginTop: 18 }}>
          <button style={primaryBtn} onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? '保存中...' : '保存配置'}</button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#666' }}><span>{label}</span>{children}</label>;
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 20 };
const title: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: '#1a1a2e', margin: '0 0 16px' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 };
const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 14, width: 160 };
const inputWide: React.CSSProperties = { ...input, width: '100%', boxSizing: 'border-box' };
const check: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#333', minHeight: 36 };
const primaryBtn: React.CSSProperties = { background: '#1a1a2e', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 };
