import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adult } from '../api/client';
import type { AdultImageCandidate, AdultPerson } from '../api/client';
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
  const [computeMode, setComputeMode] = useState('local');
  const [aiWorkerBaseUrl, setAiWorkerBaseUrl] = useState('');
  const [metadataApiBaseUrl, setMetadataApiBaseUrl] = useState('https://api.metadataapi.net');
  const [metadataApiKey, setMetadataApiKey] = useState('');
  const [stashBoxGraphqlUrl, setStashBoxGraphqlUrl] = useState('https://api.theporndb.net/graphql');
  const [stashBoxApiKey, setStashBoxApiKey] = useState('');
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [actorName, setActorName] = useState('');
  const [actorAliases, setActorAliases] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [manualImageUrl, setManualImageUrl] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<AdultImageCandidate | null>(null);
  const [uploadBase64, setUploadBase64] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['adult-config'],
    queryFn: adult.getConfig,
  });
  const { data: peopleData } = useQuery({
    queryKey: ['adult-people'],
    queryFn: adult.listPeople,
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
    const w = data.western || {};
    setComputeMode(String(w.computeMode || 'local'));
    setAiWorkerBaseUrl(String(w.aiWorkerBaseUrl || ''));
    setMetadataApiBaseUrl(String(w.metadataApiBaseUrl || 'https://api.metadataapi.net'));
    setMetadataApiKey(String(w.metadataApiKey || ''));
    setStashBoxGraphqlUrl(String(w.stashBoxGraphqlUrl || 'https://api.theporndb.net/graphql'));
    setStashBoxApiKey(String(w.stashBoxApiKey || w.tpdbApiKey || ''));
    setTmdbApiKey(String(w.tmdbApiKey || w.tmdbReadAccessToken || ''));
    setInitialized(true);
  }, [data, initialized]);

  const imageSearch = useMutation({
    mutationFn: () => adult.searchPersonImages(actorName),
    onSuccess: (res) => {
      setSelectedCandidate(res.candidates[0] || null);
      if (!res.candidates.length) {
        setAlert({ type: 'error', msg: res.message || '未找到候选头像，可以换关键词或粘贴手动图片 URL' });
        return;
      }
      const proxyText = res.proxyUsed ? '，已使用代理' : '';
      setAlert({ type: 'success', msg: `找到 ${res.candidates.length} 张候选图${proxyText}` });
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const savePerson = useMutation({
    mutationFn: () => adult.createPersonFromImage({
      name: actorName,
      aliases: csvList(actorAliases),
      personId: selectedPersonId || undefined,
      replaceReference: true,
      imageUrl: manualImageUrl || selectedCandidate?.originalUrl || selectedCandidate?.imageUrl,
      imageBase64: uploadBase64 || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adult-people'] });
      setAlert({ type: 'success', msg: selectedPersonId ? '演员 reference 已替换' : '演员已创建' });
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

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
      western: {
        ...(data?.western || {}),
        computeMode,
        aiWorkerBaseUrl,
        metadataApiBaseUrl,
        metadataApiKey,
        stashBoxGraphqlUrl,
        stashBoxApiKey,
        tmdbApiKey,
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

      <section style={card}>
        <h3 style={title}>欧美成人库</h3>
        <div style={grid}>
          <Field label="计算模式"><select style={inputWide} value={computeMode} onChange={(e) => setComputeMode(e.target.value)}>
            <option value="local">service 本地</option>
            <option value="worker">远端 worker</option>
          </select></Field>
          <Field label="AI Worker URL"><input style={inputWide} value={aiWorkerBaseUrl} onChange={(e) => setAiWorkerBaseUrl(e.target.value)} placeholder="仅 worker 模式需要" /></Field>
          <Field label="MetadataAPI / TPDB Base URL"><input style={inputWide} value={metadataApiBaseUrl} onChange={(e) => setMetadataApiBaseUrl(e.target.value)} /></Field>
          <Field label="MetadataAPI Key"><input style={inputWide} type="password" value={metadataApiKey} onChange={(e) => setMetadataApiKey(e.target.value)} placeholder="可选" /></Field>
          <Field label="Stash-box GraphQL URL"><input style={inputWide} value={stashBoxGraphqlUrl} onChange={(e) => setStashBoxGraphqlUrl(e.target.value)} placeholder="TPDB/FansDB endpoint" /></Field>
          <Field label="Stash-box API Key"><input style={inputWide} type="password" value={stashBoxApiKey} onChange={(e) => setStashBoxApiKey(e.target.value)} placeholder="可选，素人演员建议配置" /></Field>
          <Field label="TMDB API Key / Token"><input style={inputWide} type="password" value={tmdbApiKey} onChange={(e) => setTmdbApiKey(e.target.value)} placeholder="可选" /></Field>
        </div>
        <div style={{ marginTop: 18 }}>
          <button style={primaryBtn} onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? '保存中...' : '保存欧美配置'}</button>
        </div>
      </section>

      <section style={card}>
        <h3 style={title}>欧美演员库</h3>
        <div style={{ ...grid, alignItems: 'end' }}>
          <Field label="演员名称"><input style={inputWide} value={actorName} onChange={(e) => setActorName(e.target.value)} placeholder="例如 Tia Ling" /></Field>
          <Field label="别名"><input style={inputWide} value={actorAliases} onChange={(e) => setActorAliases(e.target.value)} placeholder="逗号分隔，可选" /></Field>
          <Field label="替换已有演员"><select style={inputWide} value={selectedPersonId} onChange={(e) => setSelectedPersonId(e.target.value)}>
            <option value="">创建新演员</option>
            {(peopleData?.people || []).filter((p: AdultPerson) => !p.dismissed).map((p) => <option key={p.personId} value={p.personId}>{p.name}</option>)}
          </select></Field>
          <button style={secondaryBtn} onClick={() => imageSearch.mutate()} disabled={!actorName || imageSearch.isPending}>{imageSearch.isPending ? '搜索中...' : '搜索候选头像'}</button>
        </div>

        <div style={{ marginTop: 14 }}>
          <Field label="手动图片 URL"><input style={inputWide} value={manualImageUrl} onChange={(e) => { setManualImageUrl(e.target.value); setSelectedCandidate(null); }} placeholder="搜索不到素人演员时粘贴高清正脸图 URL" /></Field>
        </div>
        <div style={{ marginTop: 10 }}>
          <input type="file" accept="image/*" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const text = String(reader.result || '');
              setUploadBase64(text.includes(',') ? text.split(',')[1] : text);
              setManualImageUrl('');
              setSelectedCandidate(null);
            };
            reader.readAsDataURL(file);
          }} />
        </div>

        {!!imageSearch.data?.candidates.length && (
          <div style={candidateGrid}>
            {imageSearch.data.candidates.map((c) => (
              <button key={`${c.source}:${c.imageUrl}`} style={selectedCandidate?.imageUrl === c.imageUrl ? candidateActive : candidateCard} onClick={() => { setSelectedCandidate(c); setManualImageUrl(''); setUploadBase64(''); }}>
                <img src={c.imageUrl} style={candidateImage} />
                <span style={candidateCaption}>{c.source} · {c.title}</span>
              </button>
            ))}
          </div>
        )}
        {imageSearch.data && !imageSearch.data.candidates.length && (
          <div style={emptySearch}>
            <div>{imageSearch.data.message || '未找到候选头像，可以换关键词或粘贴手动图片 URL。'}</div>
            {!!imageSearch.data.errors?.length && (
              <div style={searchErrors}>
                {imageSearch.data.errors.slice(0, 4).map((e) => (
                  <div key={`${e.source}:${e.message}`}>{e.source}: {e.message}</div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button style={primaryBtn} onClick={() => savePerson.mutate()} disabled={!actorName || savePerson.isPending || !(selectedCandidate || manualImageUrl || uploadBase64)}>
            {savePerson.isPending ? '生成 reference 中...' : selectedPersonId ? '替换 reference' : '创建演员'}
          </button>
        </div>

        <div style={{ marginTop: 18 }}>
          {(peopleData?.people || []).filter((p: AdultPerson) => !p.dismissed).map((p) => (
            <div key={p.personId} style={personRow}>
              {p.referenceFaces?.[0]?.sampleImageBase64 ? <img src={`data:image/jpeg;base64,${p.referenceFaces[0].sampleImageBase64}`} style={personThumb} /> : <div style={personThumb} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{p.name} <span style={{ color: '#999', fontWeight: 400 }}>{p.canonicalCode}</span></div>
                <div style={{ fontSize: 12, color: '#777' }}>{p.aliases?.join(', ') || '无别名'} · reference {p.referenceFaces?.length || 0}</div>
              </div>
            </div>
          ))}
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
const secondaryBtn: React.CSSProperties = { background: '#fff', color: '#1a1a2e', border: '1px solid #1a1a2e', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 };
const candidateGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12, marginTop: 16 };
const candidateCard: React.CSSProperties = { border: '1px solid #e0e0e0', background: '#fff', borderRadius: 8, padding: 8, cursor: 'pointer', textAlign: 'left' };
const candidateActive: React.CSSProperties = { ...candidateCard, border: '2px solid #1a1a2e', padding: 7 };
const candidateImage: React.CSSProperties = { width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 6, display: 'block' };
const candidateCaption: React.CSSProperties = { display: 'block', marginTop: 6, fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const emptySearch: React.CSSProperties = { marginTop: 16, padding: 12, border: '1px solid #f0c36d', background: '#fff8e6', borderRadius: 6, color: '#6b4e00', fontSize: 13, lineHeight: 1.5 };
const searchErrors: React.CSSProperties = { marginTop: 8, color: '#8a3b12', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' };
const personRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid #eee', padding: '10px 0' };
const personThumb: React.CSSProperties = { width: 48, height: 48, borderRadius: 6, objectFit: 'cover', background: '#eee' };
