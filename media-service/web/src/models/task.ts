import type { MediaTask } from '../types';

export function taskStatusLabelZh(status: string): string {
  const m: Record<string, string> = {
    pending_manual: '待启动',
    queued: '排队中',
    precheck: '预检中',
    executing: '执行中',
    verify: '校验中',
    awaiting_user_confirm: '待信息确认',
    waiting_media_source: '等待媒体片源',
    paused: '已暂停',
    interrupted: '已中断',
    resume_pending: '待恢复',
    done: '已完成',
    failed_hard: '已失败',
  };
  return m[status] ?? status;
}
