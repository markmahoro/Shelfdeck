/** §5.1 / §7.4 编码资源池 — 与主进程 stableKey 约定一致 */

export type TranscodeEncodeBackend = 'nvenc' | 'qsv' | 'amf' | 'cpu';

export type TranscodeProbeDeviceRow = {
  stableKey: string;
  label: string;
  backend: TranscodeEncodeBackend;
  /** NVENC：CUDA 设备序号；其它常为0 或 -1 */
  gpuIndex: number;
};

export type TranscodeEncodePoolEntry = {
  stableKey: string;
  inPool: boolean;
  /** 该设备同时压制路数上限（§5.1.1） */
  maxSlots: number;
  /** 数值越小优先级越高（§5.1.2） */
  priority: number;
};

/** cpuParticipation：1 = CPU 与 GPU 同台按优先级；2 = CPU 仅 cpu_only（§5.1.2） */
export type TranscodeEncodePoolSettings = {
  cpuParticipation: 1 | 2;
  entries: TranscodeEncodePoolEntry[];
};

export function defaultTranscodeEncodePool(): TranscodeEncodePoolSettings {
  return { cpuParticipation: 1, entries: [] };
}

export function isCpuStableKey(stableKey: string): boolean {
  return stableKey.startsWith('cpu:');
}

export function parseStableKey(stableKey: string): { backend: TranscodeEncodeBackend; gpuIndex: number } {
  const s = String(stableKey || '');
  if (s.startsWith('cpu:')) return { backend: 'cpu', gpuIndex: -1 };
  if (s.startsWith('nvenc:')) {
    const n = Number(s.slice(7));
    return { backend: 'nvenc', gpuIndex: Number.isFinite(n) ? n : 0 };
  }
  if (s.startsWith('qsv:')) {
    const n = Number(s.slice(4));
    return { backend: 'qsv', gpuIndex: Number.isFinite(n) ? n : 0 };
  }
  if (s.startsWith('amf:')) {
    const n = Number(s.slice(4));
    return { backend: 'amf', gpuIndex: Number.isFinite(n) ? n : 0 };
  }
  throw new Error(`未知编码设备键：${stableKey}`);
}

/** 配置页展示顺序：priority 升序，同分按 stableKey */
export function sortEncodePoolEntriesForDisplay(entries: TranscodeEncodePoolEntry[]): TranscodeEncodePoolEntry[] {
  return [...entries].sort((a, b) => a.priority - b.priority || a.stableKey.localeCompare(b.stableKey));
}

/** 按当前数组下标写入 priority = 0,10,20…（持久化仍用数值，与 §5.1.2 一致） */
export function assignPrioritiesByOrder(entries: TranscodeEncodePoolEntry[]): TranscodeEncodePoolEntry[] {
  return entries.map((e, i) => ({ ...e, priority: i * 10 }));
}

/**
 * 将 fromStableKey 所在行拖到 toStableKey 行位置（插入在目标行之前），并重算 priority。
 */
export function reorderEncodePoolEntries(
  entries: TranscodeEncodePoolEntry[],
  fromStableKey: string,
  toStableKey: string,
): TranscodeEncodePoolEntry[] {
  if (fromStableKey === toStableKey) return entries;
  const sorted = sortEncodePoolEntriesForDisplay(entries);
  const moving = sorted.find((e) => e.stableKey === fromStableKey);
  if (!moving) return entries;
  const without = sorted.filter((e) => e.stableKey !== fromStableKey);
  const toIdx = without.findIndex((e) => e.stableKey === toStableKey);
  if (toIdx < 0) return entries;
  without.splice(toIdx, 0, moving);
  return assignPrioritiesByOrder(without);
}

/**
 * 配置页帮助摘要：容量、占槽顺序、CPU 策略（不含「已保存」类提示，由调用方拼接）。
 */
export function describeTranscodePoolForUser(pool: TranscodeEncodePoolSettings): string {
  const ordered = sortEncodePoolEntriesForDisplay(pool.entries.filter((e) => e.inPool));
  const deviceCount = ordered.length;
  const totalSlots = ordered.reduce((s, e) => s + Math.max(1, e.maxSlots | 0), 0);
  const capLine =
    deviceCount === 0
      ? '当前没有勾选入池的编码设备；转码任务进入压制前将无法占用编码子槽，请先探测并至少入池一台设备或 CPU 行。'
      : `当前资源池共有 ${deviceCount} 台入池设备，合计最多 ${totalSlots} 条设备子槽（各硬件并行路数相加；与类型任务槽 transcodeConcurrency 同时生效，取更紧的一层）。`;

  const orderLine =
    deviceCount === 0
      ? ''
      : '任务进入压制（executing）时，调度按上表从上到下的顺序依次尝试占槽：优先尝试更靠上的设备；若该设备子槽已满，则顺延至下一台，直至成功或全部不可用。';

  const cpuLine =
    pool.cpuParticipation === 2
      ? 'CPU 参与策略为「策略 2」：仅当任务只能走 CPU 压制（如杜比视界受控转码确认后）时，才会占用池中 CPU/libx265 子槽；普通可走 GPU 的任务只尝试 GPU 行。'
      : 'CPU 参与策略为「策略 1」：CPU 与 GPU 行按上表顺序同台竞争；排在前面的设备子槽占满后，可顺延到后面的 CPU 或 GPU。';

  return [capLine, orderLine, cpuLine].filter(Boolean).join('\n\n');
}

/** 按 §5.1.2 过滤并排序后的可尝试设备（仅元数据；实际占槽在主进程） */
export function orderedInPoolCandidates(
  pool: TranscodeEncodePoolSettings,
  opts: { cpuOnly: boolean; gpuOk: boolean },
): TranscodeEncodePoolEntry[] {
  const sorted = pool.entries.filter((e) => e.inPool).sort((a, b) => a.priority - b.priority);
  return sorted.filter((e) => {
    const cpu = isCpuStableKey(e.stableKey);
    if (opts.cpuOnly) return cpu;
    if (opts.gpuOk && pool.cpuParticipation === 2) return !cpu;
    return true;
  });
}

/** 将探测结果与用户已保存条目合并（保留 inPool/maxSlots/priority；新设备默认不入池） */
export function mergeProbeIntoPool(
  probeRows: TranscodeProbeDeviceRow[],
  prev: TranscodeEncodePoolSettings,
): TranscodeEncodePoolSettings {
  const byKey = new Map(prev.entries.map((e) => [e.stableKey, e]));
  const entries: TranscodeEncodePoolEntry[] = probeRows.map((row, index) => {
    const old = byKey.get(row.stableKey);
    if (old) {
      return {
        stableKey: row.stableKey,
        inPool: old.inPool,
        maxSlots: Math.max(1, old.maxSlots | 0),
        priority: old.priority,
      };
    }
    return {
      stableKey: row.stableKey,
      inPool: false,
      maxSlots: 1,
      priority: index * 10,
    };
  });
  return { ...prev, entries };
}

/** 将当前表格展示顺序下的 priority 规整为 0,10,20…（与拖拽落盘规则一致） */
export function suggestPoolPrioritiesFromProbeOrder(pool: TranscodeEncodePoolSettings): TranscodeEncodePoolSettings {
  return {
    ...pool,
    entries: assignPrioritiesByOrder(sortEncodePoolEntriesForDisplay(pool.entries)),
  };
}
