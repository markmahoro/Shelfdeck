export type SurfacePage = {
  slug: string;
  path: string;
  label: string;
  title: string;
  description: string;
};

export const pages: SurfacePage[] = [
  { slug: 'overview', path: '/', label: '概览', title: '概览', description: '看系统是否就绪、有没有要你处理的事，以及最近上架了什么。' },
  { slug: 'material-fields', path: '/material-fields', label: '文件来源', title: '文件来源', description: '指定本机电影目录。登记不会移动、改名或删除任何文件。' },
  { slug: 'shelves', path: '/shelves', label: '收藏架', title: '收藏架', description: '指定上架后的目录和命名规则。创建时不会写入媒体文件。' },
  { slug: 'collection', path: '/collection', label: '我的收藏', title: '我的收藏', description: '只显示已经上架的电影。' },
  { slug: 'formation', path: '/formation', label: '媒体整理工作区', title: '媒体整理工作区', description: '查看待整理、整理中、需要处理和已经上架的媒体。' },
  { slug: 'offdeck', path: '/offdeck', label: '退出收藏', title: '退出收藏', description: '先审阅建议，确认后再授权删除。没有授权不会删除文件。' },
  { slug: 'people', path: '/people', label: '人物', title: '人物名录', description: '只读查看已登记人物。本页不能注册、合并或修改演职员事实。' },
  { slug: 'settings', path: '/settings', label: '系统设置', title: '系统设置', description: '管理豆瓣、TMDB 与 MoviePilot 连接，并查阅评分日志。' },
];
