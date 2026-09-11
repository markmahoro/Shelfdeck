import { useState } from 'react';
import { helixAdminApi, type CollectionEntry } from './api';
import { Button } from './chrome';
import RecyclePanel from './RecyclePanel';
import SourceCleanupChecks from './SourceCleanupChecks';
import { isUnauthorized, useSession } from './session';

export default function RecycleSettings() {
  const { expire } = useSession();
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function load(next?:string) {
    setLoading(true); setError('');
    try {
      const page = await helixAdminApi.listCollection({ status:'current', limit:100, cursor:next });
      setEntries(current => next ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor || null);
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError('收藏列表读取失败，请重试。');
    } finally { setLoading(false); }
  }
  return <div className="recycle-settings stack">
    <RecyclePanel />
    <SourceCleanupChecks onInspect={setSelected} />
    <section className="ui-card stack">
    <h3>检查影片旧目录</h3>
    <Button type="button" disabled={loading} onClick={()=>void load()}>读取收藏列表</Button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {entries.length>0 && <label>影片<select value={selected} onChange={event=>setSelected(event.target.value)}>
      <option value="">选择影片</option>
      {entries.map(entry=><option key={entry.shelfEntryId} value={entry.shelfEntryId}>{entry.displayIdentity || entry.shelfEntryId}</option>)}
    </select></label>}
    {cursor && <Button type="button" disabled={loading} onClick={()=>void load(cursor)}>加载更多收藏</Button>}
    {selected && <RecyclePanel key={selected} shelfEntryId={selected} />}
    </section>
  </div>;
}
