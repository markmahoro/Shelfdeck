/**
 * [UI] 海报墙页面。
 *
 * 展示未观看内容，支持打分、标记已看、一键入队。
 */

import { useEffect, useState } from 'react';
import { apiClient, ApiConflictError } from '../api/client';
import { getBaseUrl } from '../connection/baseUrl';
import type { MediaTask } from '../models/task';
import { hasActiveTaskForItem, taskStatusLabelZh } from '../models/task';

export default function WallPage({ tasks, subLibraryId }: { tasks: MediaTask[]; subLibraryId: string }) {
  const [items, setItems] = useState<UnplayedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    // 加载可用媒体库列表
    const base = getBaseUrl();
    if (!base) return;
    // 海报墙依赖 preload 暴露的 embyApi
    if (!window.embyApi) return;
    // 此处通过 window.embyApi 获取数据，由 preload.js 桥接到 service
    setLoading(false);
  }, [sectionId]);

  if (loading) return <div className="page"><p>加载中...</p></div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;

  return (
    <div className="page">
      <div className="sidebar">
        {/* 媒体库选择 */}
      </div>
      <div className="main">
        {items.length === 0 ? (
          <p>暂未获取到未观看内容。请确保媒体管理服务正在运行且 Emby 连接已配置。</p>
        ) : (
          <div className="wallGrid">
            {items.map((item) => {
              const taskForItem = tasks.find((t) => t.itemId === item.id && !['done', 'failed_hard'].includes(t.status));
              return (
                <div key={item.id} className="wallCard">
                  <div className="wallCardTitle">{item.name}</div>
                  <div className="wallCardInfo">
                    {item.resolution} · {item.codec?.toUpperCase()} · {item.sizeGb?.toFixed(1)} GB
                  </div>
                  {taskForItem ? (
                    <div className="wallCardTask">{taskStatusLabelZh(taskForItem.status)}</div>
                  ) : (
                    <div className="wallCardActions">
                      <button type="button">码率压缩</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
