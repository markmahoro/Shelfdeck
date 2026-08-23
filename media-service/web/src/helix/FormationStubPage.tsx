import { useEffect, useRef, useState } from 'react';
import { Button, PageHeader } from './chrome';

type StubFilter = 'all' | 'pending' | 'in_progress' | 'attention_required' | 'completed' | 'ended';
type StubRow = {
  id: string;
  title: string;
  rating: string;
  shelf: string;
  requirement: string;
  progress: string;
  progressDetail: string;
  classification: Exclude<StubFilter, 'all'>;
  action: string;
  expediteAvailable: boolean;
};

const rows: StubRow[] = [
  {
    id: 'ghost-story-2',
    title: '倩女幽魂2：人间道 (1990)',
    rating: '—',
    shelf: 'UAT-064 Canary Shelf',
    requirement: '保留现有品质；NFO、海报符合要求',
    progress: '收藏架验收失败',
    progressDetail: '目标目录不可用，尚未正式上架',
    classification: 'attention_required',
    action: '检查收藏架',
    expediteAvailable: false,
  },
  {
    id: 'spring-gala',
    title: '一场很（没）有必要的春晚 (2022)',
    rating: '—',
    shelf: 'UAT-064 Canary Shelf',
    requirement: '影片资料完整；NFO、海报符合要求',
    progress: '产品验证未通过',
    progressDetail: '缺少收藏要求中的演员资料',
    classification: 'attention_required',
    action: '—',
    expediteAvailable: true,
  },
  {
    id: 'skyfall',
    title: '007：大破天幕杀机 (2012)',
    rating: '—',
    shelf: 'UAT-064 Canary Shelf',
    requirement: '等待身份确认后形成媒体整理方案',
    progress: '等待确认影片身份',
    progressDetail: '现有 NFO 身份与其他证据冲突',
    classification: 'attention_required',
    action: '确认身份',
    expediteAvailable: true,
  },
  {
    id: 'venice',
    title: '威尼斯惊魂夜 (2023)',
    rating: '3 星 · 豆瓣',
    shelf: 'UAT-064 Canary Shelf',
    requirement: '保持原始画质；资料与图片符合要求',
    progress: '正在验证媒体产品',
    progressDetail: '已完成 4 项，正在检查 NFO 与海报',
    classification: 'in_progress',
    action: '—',
    expediteAvailable: true,
  },
  {
    id: 'silverton',
    title: '锡尔弗顿之围 (2022)',
    rating: '4 星 · 豆瓣',
    shelf: 'UAT-064 Canary Shelf',
    requirement: 'HEVC；NFO、海报符合要求',
    progress: '已正式上架',
    progressDetail: '2026年8月23日 14:36 完成',
    classification: 'completed',
    action: '—',
    expediteAvailable: false,
  },
  {
    id: 'ended-beekeeper',
    title: '养蜂人 (2024) · 旧整理记录',
    rating: '—',
    shelf: 'UAT-064 Canary Shelf',
    requirement: '五星收藏要求',
    progress: '整理已结束',
    progressDetail: '用户已结束本次整理；记录保留在同一张表中',
    classification: 'ended',
    action: '—',
    expediteAvailable: false,
  },
];

const filterLabels: Array<{ id: StubFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待整理' },
  { id: 'in_progress', label: '整理中' },
  { id: 'attention_required', label: '需要处理' },
  { id: 'completed', label: '已完成' },
  { id: 'ended', label: '已结束' },
];

function StageState({ state }: { state: 'completed' | 'attention' | 'pending' }) {
  const copy = state === 'completed' ? '已完成' : state === 'attention' ? '需要处理' : '尚未开始';
  return <span className="formation-stub-stage-state" data-state={state}>{copy}</span>;
}

function ResultLine({
  title,
  result,
  state = 'completed',
  progress,
}: {
  title: string;
  result: string;
  state?: 'completed' | 'attention' | 'pending';
  progress?: number;
}) {
  return <li className="formation-stub-result" data-state={state}>
    <span className="formation-stub-result-mark" aria-hidden="true">{state === 'completed' ? '✓' : state === 'attention' ? '×' : '○'}</span>
    <div>
      <strong>{title}</strong>
      <p>{result}</p>
      {progress !== undefined && <div className="formation-stub-progress">
        <progress max={100} value={progress} aria-label={`${title} ${progress}%`} />
        <small>{progress}%</small>
      </div>}
    </div>
  </li>;
}

function GhostStoryDetail() {
  return <article className="formation-process-card" aria-label="倩女幽魂2：人间道的上架过程详情">
    <header className="formation-process-head">
      <div>
        <span className="formation-process-eyebrow">上架过程详情</span>
        <h3>倩女幽魂2：人间道 (1990)</h3>
        <p>产品已经整理完成并提交收藏架，但目标目录当前不可用，因此尚未正式上架。</p>
      </div>
      <span className="formation-process-status" data-state="attention">需要处理</span>
    </header>

    <dl className="formation-process-facts">
      <div><dt>目标收藏架</dt><dd>UAT-064 Canary Shelf</dd></div>
      <div><dt>收藏要求</dt><dd>保留现有品质；NFO、海报符合要求</dd></div>
      <div><dt>当前进展</dt><dd>收藏架验收失败</dd></div>
    </dl>

    <div className="formation-process-stages">
      <details className="formation-process-stage">
        <summary>
          <span className="formation-stage-index" aria-hidden="true">1</span>
          <span><strong>已接收的材料</strong><small>ISO 主媒体，以及现有 NFO、海报、图片和字幕</small></span>
          <StageState state="completed" />
        </summary>
        <div className="formation-stage-body">
          <ol>
            <ResultLine title="确认输入形态" result="识别为单部电影 ISO。" />
            <ResultLine title="确认主媒体" result="1 个 ISO 文件作为本次媒体整理的主媒体。" />
            <ResultLine title="确认相关材料" result="发现现有 NFO、poster、fanart、logo 和多份字幕。" />
            <ResultLine title="接收候选材料" result="材料范围完整，Libra Intake 已接受。" />
          </ol>
        </div>
      </details>

      <details className="formation-process-stage">
        <summary>
          <span className="formation-stage-index" aria-hidden="true">2</span>
          <span><strong>媒体整理</strong><small>复用并更新现有材料，形成标准媒体产品</small></span>
          <StageState state="completed" />
        </summary>
        <div className="formation-stage-body">
          <p className="formation-stage-plan"><strong>本段处理方案</strong>检查现有资料 → 核对影片身份 → 沿用海报 → 更新 NFO → 重新封装 ISO → 验证媒体产品</p>
          <ol>
            <ResultLine title="检查现有 NFO" result="文件可以正常读取。" />
            <ResultLine title="确定 NFO 处理方式" result="原 NFO 可以使用，本次采用更新而不是重建。" />
            <ResultLine title="核对 TMDB 影片身份" result="确认对应 TMDB 9050，并采用 TMDB 剧情简介。" />
            <ResultLine title="复用并验证现有海报" result="使用原始目录中的 poster.jpg；图片可以正常解码。" />
            <ResultLine title="更新并验证 NFO" result="把原 NFO 带入媒体整理工作区，保留原有字段并更新本次确需变化的内容；没有改写原始 NFO。" />
            <ResultLine title="从 ISO 重新封装视频" result="已经形成可上架的视频文件。" progress={100} />
            <ResultLine title="验证完整产品" result="视频、资料、NFO 和海报均符合当前收藏要求。" />
            <ResultLine title="提交收藏架" result="产品包已经提交给目标收藏架。" />
          </ol>
        </div>
      </details>

      <details className="formation-process-stage" open>
        <summary>
          <span className="formation-stage-index" aria-hidden="true">3</span>
          <span><strong>验收与上架</strong><small>五项检查通过；收藏架目录检查失败</small></span>
          <StageState state="attention" />
        </summary>
        <div className="formation-stage-body">
          <ol>
            <ResultLine title="检查影片身份" result="通过。" />
            <ResultLine title="检查主媒体" result="通过。" />
            <ResultLine title="检查资料和附属文件" result="通过。" />
            <ResultLine title="检查空间与产品结构" result="通过。" />
            <ResultLine title="检查收藏架目录" result="目标目录不可用，产品无法写入收藏位置。原始材料没有被修改。" state="attention" />
            <ResultLine title="写入收藏位置" result="等待收藏架目录恢复。" state="pending" />
            <ResultLine title="确认正式收藏" result="尚未建立收藏记录。" state="pending" />
          </ol>
          <div className="formation-process-attention">
            <div><strong>恢复目录或修改收藏位置后，可以重新发起收藏架验收。</strong><small>错误代码和执行证据保留在技术诊断中。</small></div>
            <Button type="button">检查收藏架配置</Button>
          </div>
          <details className="formation-diagnostic"><summary>技术诊断</summary><code>CLEAN_ARCA_TARGET_ROOT_UNAVAILABLE</code></details>
        </div>
      </details>
    </div>
  </article>;
}

function CompactDetail({ row }: { row: StubRow }) {
  return <article className="formation-process-card formation-process-card-compact" aria-label={`${row.title}的上架过程详情`}>
    <header className="formation-process-head">
      <div><span className="formation-process-eyebrow">上架过程详情</span><h3>{row.title}</h3><p>{row.progressDetail}</p></div>
      <span className="formation-process-status" data-state={row.classification === 'completed' ? 'completed' : 'attention'}>{row.classification === 'completed' ? '已完成' : '需要处理'}</span>
    </header>
    <p className="formation-stub-placeholder">此行用于确认统一表格和单一详情入口。完整步骤文案以“倩女幽魂2：人间道”示例为准。</p>
  </article>;
}

export default function FormationStubPage() {
  const [filter, setFilter] = useState<StubFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expeditedIds, setExpeditedIds] = useState(() => new Set(['venice']));
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const visibleRows = filter === 'all' ? rows : rows.filter((row) => row.classification === filter);
  const selectedRow = rows.find((row) => row.id === selectedId) || null;
  const count = (id: StubFilter) => id === 'all' ? rows.length : rows.filter((row) => row.classification === id).length;

  const closeDetail = () => {
    setSelectedId(null);
    window.setTimeout(() => detailTriggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!selectedRow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
    };
    document.body.classList.add('formation-process-modal-open');
    document.addEventListener('keydown', onKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.body.classList.remove('formation-process-modal-open');
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedRow]);

  return <section className="source-page workbench formation-page formation-stub-page">
    <PageHeader title="媒体整理工作区" description="一张表查看全部媒体；列表只显示当前进展，完整上架过程在屏幕中央查看。" />
    <p className="formation-stub-notice"><strong>界面 Stub</strong>静态数据仅用于确认信息结构和交互，不读取或修改当前 UAT 环境。</p>

    <section className="formation-ledger">
      <div className="source-registry-heading"><div><h2>全部媒体</h2></div><span>当前显示 {visibleRows.length} 条</span></div>
      <div className="formation-chips" role="group" aria-label="媒体整理状态">
        {filterLabels.map((item) => <Button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} {count(item.id)}</Button>)}
      </div>

      <div className="formation-table-wrap">
        <table className="formation-table formation-stub-table">
          <thead><tr>
            <th>媒体名称</th><th>评分</th><th>目标收藏架</th><th>整理要求</th><th>当前进展</th><th>详情</th><th>用户操作</th><th>加急</th>
          </tr></thead>
          <tbody>{visibleRows.map((row) => <MediaRow key={row.id} row={row} selected={selectedId === row.id} expedited={expeditedIds.has(row.id)} onToggleExpedite={() => {
            setExpeditedIds((current) => {
              const next = new Set(current);
              if (next.has(row.id)) next.delete(row.id);
              else next.add(row.id);
              return next;
            });
          }} onOpen={(trigger) => {
            detailTriggerRef.current = trigger;
            setSelectedId(row.id);
          }} />)}</tbody>
        </table>
      </div>
    </section>

    {selectedRow && <div className="formation-process-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeDetail();
    }}>
      <section className="formation-process-dialog" role="dialog" aria-modal="true" aria-labelledby="formation-process-dialog-title">
        <button ref={closeButtonRef} className="formation-process-dialog-close" type="button" aria-label="关闭上架过程详情" onClick={closeDetail}>×</button>
        <h2 id="formation-process-dialog-title" className="formation-process-dialog-title">{selectedRow.title}的上架过程详情</h2>
        {selectedRow.id === 'ghost-story-2' ? <GhostStoryDetail /> : <CompactDetail row={selectedRow} />}
      </section>
    </div>}
  </section>;
}

function MediaRow({ row, selected, expedited, onToggleExpedite, onOpen }: { row: StubRow; selected: boolean; expedited: boolean; onToggleExpedite: () => void; onOpen: (trigger: HTMLButtonElement) => void }) {
  const rowState = row.classification === 'completed' ? '已完成整理' : row.classification === 'ended' ? '已结束' : row.classification === 'attention_required' ? '需要处理' : row.classification === 'in_progress' ? '整理中' : '待整理';
  const expediteLabel = expedited ? `取消加急 ${row.title}` : `加急 ${row.title}`;
  return <tr className="formation-stub-media-row" data-classification={row.classification} data-selected={selected || undefined} data-expedited={expedited || undefined}>
      <td><strong>{row.title}</strong><small>{rowState}</small></td>
      <td><span className="formation-stub-rating">{row.rating}</span></td>
      <td>{row.shelf}</td>
      <td>{row.requirement}</td>
      <td><strong className="formation-stub-current" data-state={row.classification}>{row.progress}</strong><small>{row.progressDetail}</small></td>
      <td><Button type="button" variant="text" aria-haspopup="dialog" onClick={(event) => onOpen(event.currentTarget)}>查看过程</Button></td>
      <td>{row.action === '—' ? <span className="formation-stub-empty">—</span> : <Button type="button">{row.action}</Button>}</td>
      <td><button
        type="button"
        className="formation-expedite-toggle"
        aria-label={row.expediteAvailable ? expediteLabel : `${row.title}无需加急`}
        aria-pressed={row.expediteAvailable ? expedited : undefined}
        disabled={!row.expediteAvailable}
        title={row.expediteAvailable ? (expedited ? '取消加急' : '优先安排这部媒体') : '已完成或已结束，无需加急'}
        onClick={onToggleExpedite}
      >{expedited ? '已加急' : '加急'}</button></td>
    </tr>;
}
