import type { MediaTask } from './taskQueue';

/** 注入任务中心用于联调 UI（多种状态各一条）。 */
export function createDebugSeedTasks(): MediaTask[] {
  const t0 = new Date().toISOString();
  const hourLater = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const mk = (
    p: Pick<MediaTask, 'id' | 'itemId' | 'itemName' | 'actionType' | 'status'> &
      Partial<Omit<MediaTask, 'id' | 'itemId' | 'itemName' | 'actionType' | 'status'>>,
  ): MediaTask => ({
    createdAt: t0,
    updatedAt: t0,
    progress: 0,
    retryCount: 0,
    ...p,
  });

  return [
    mk({
      id: 'debug-seed:queued-x',
      itemId: 'mock-x-1',
      itemName: '[模拟] 压缩 · queued',
      actionType: 'transcode',
      status: 'queued',
    }),
    mk({
      id: 'debug-seed:precheck-u',
      itemId: 'mock-u-1',
      itemName: '[模拟] 补源 · precheck',
      actionType: 'upgrade',
      status: 'precheck',
      progress: 5,
    }),
    mk({
      id: 'debug-seed:exec-x',
      itemId: 'mock-x-2',
      itemName: '[模拟] 压缩 · executing',
      actionType: 'transcode',
      status: 'executing',
      progress: 42,
      transcodeOriginalSizeGb: 18.35,
    }),
    mk({
      id: 'debug-seed:verify-u',
      itemId: 'mock-u-2',
      itemName: '[模拟] 补源 · verify',
      actionType: 'upgrade',
      status: 'verify',
      progress: 88,
    }),
    mk({
      id: 'debug-seed:wait-u',
      itemId: 'mock-u-3',
      itemName: '[模拟] 补源 · waiting_media_source',
      actionType: 'upgrade',
      status: 'waiting_media_source',
      progress: 0,
      retryCount: 2,
      lastSearchAt: t0,
      nextSearchAt: hourLater,
    }),
    mk({
      id: 'debug-seed:interrupt-x',
      itemId: 'mock-x-3',
      itemName: '[模拟] 压缩 · interrupted',
      actionType: 'transcode',
      status: 'interrupted',
      progress: 30,
    }),
    mk({
      id: 'debug-seed:resume-u',
      itemId: 'mock-u-4',
      itemName: '[模拟] 补源 · resume_pending',
      actionType: 'upgrade',
      status: 'resume_pending',
      progress: 0,
    }),
    mk({
      id: 'debug-seed:done-x',
      itemId: 'mock-x-4',
      itemName: '[模拟] 压缩 · done',
      actionType: 'transcode',
      status: 'done',
      progress: 100,
      transcodeOriginalSizeGb: 22.4,
      transcodeResultSizeGb: 14.8,
    }),
    mk({
      id: 'debug-seed:fail-u',
      itemId: 'mock-u-5',
      itemName: '[模拟] 补源 · failed_hard',
      actionType: 'upgrade',
      status: 'failed_hard',
      progress: 0,
    }),
  ];
}
