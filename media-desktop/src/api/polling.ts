/**
 * [API_CLIENT] 通用轮询器。
 *
 * 用法：
 *   const poller = createPoller(() => apiClient.getTasks(), setTasks, 400);
 *   poller.start();  // 立即执行一次，之后每间隔轮询
 *   poller.stop();   // 停止轮询
 */

export type Poller = {
  start: () => void;
  stop: () => void;
};

export function createPoller<T>(
  fetchFn: () => Promise<T>,
  onData: (data: T) => void,
  intervalMs: number,
): Poller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const data = await fetchFn();
      onData(data);
    } catch {
      /* 静默重试 */
    } finally {
      running = false;
    }
  };

  return {
    start: () => {
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
