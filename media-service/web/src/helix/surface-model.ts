export type SurfacePage = {
  slug: string;
  path: string;
  label: string;
  title: string;
  description?: string;
  group?: 'ops' | 'config';
};

export const pages: SurfacePage[] = [
  { slug: 'overview', path: '/', label: '概览', title: '概览', group: 'ops' },
  { slug: 'collection', path: '/collection', label: '我的收藏', title: '我的收藏', group: 'ops' },
  { slug: 'formation', path: '/formation', label: '媒体整理工作区', title: '媒体整理工作区', group: 'ops' },
  { slug: 'offdeck', path: '/offdeck', label: '退出收藏', title: '退出收藏', group: 'ops' },
  { slug: 'people', path: '/people', label: '人物', title: '人物', group: 'ops' },
  { slug: 'material-fields', path: '/material-fields', label: '文件来源配置', title: '文件来源配置', group: 'config' },
  { slug: 'shelves', path: '/shelves', label: '收藏架配置', title: '收藏架配置', group: 'config' },
  { slug: 'settings', path: '/settings', label: '系统设置', title: '系统设置', group: 'config' },
];
