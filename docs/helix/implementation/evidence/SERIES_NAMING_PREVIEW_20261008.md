# Series 命名示例与逐集空间展示（2026-10-08）

归属CURRENT_PHASE节点1–4的可见Series能力；基于`0eb3f0237`，交付SHA以本文件Git历史定位。

## 合同与设计

SSOT §5.5.8要求Series按Episode验收空间；Formation收藏要求和转码摘要现在明确“每集不超过”，Movie仍沿原单位。只改展示，不改准入、实际空间计算或Spec。

沿已有Series UI协调与Playbook §11.1，收藏架创建/目录布局编辑在现有命名预览位置增加“命名示例”选择，选项来自当前模板或Shelf的实际Profile；支持电影、单集文件、两集共文件、一集多个part。目录显示Season层，分别列出视频、Season/各集NFO及原有字幕/图片示例；模板修改即时反馈。示例不改变保存的Placement，不添加虚构Season/Episode模板token，不将示例作为真实媒体结果。

Arca当前`seriesMemberStem`为共文件生成S01E01-E02，同scope多个Primary按materialKey排序生成part01/part02；预览与该函数进行直接对照测试。不改变实际命名、落位、Collision或Related relation。

## 验证

- 后端Formation两文件55项通过，含Series 0.75 GiB每集提示及Movie提示保持；首次运行发现另一个转码摘要引用未定义变量，修复后完整复验通过。
- 前端26文件125项通过；新增命名示例与实际Arca函数的一集、共文件、两个part及自定义主视频模板对照，Movie回归。TypeScript/Vite构建123模块通过。
- Playwright桌面1920×1080/窄屏390×844两项通过：规则发布既有流程、新建表单示例选择、修改模板即时反馈、共文件/part显示；受影响表单Axe无问题。首次测试重复打开空Shelf下已自动展开的表单导致超时，修正测试路径后通过。
- 检视窄屏全页截图，无新增横向溢出。截图位于ignored `.codex/series-browser/series-shelf-rules-edits-p-b4cb6-ithout-changing-Movie-rules-{desktop,narrow}/series-naming.png`。
- P2、架构边界459文件/1455依赖、语义2078文件及diff whitespace检查通过。后端/P2日志在仓库外`E:/my_project/helix-git-consolidation-20261008/series-naming-{backend,p2}.log`。

## 边界

浏览器使用受控API，未执行真实Shelf发布/迁移。此次为展示变更，不重复实际媒体Host、Docker或Desktop构建；不据此声明跨平台或发布验收。UI负责人同版本验收、外部替换/后加工、Linux、升级回退和最终Movie回归仍待完成；EpisodeDelivery多part摘要缺口按用户要求保留。未操作NAS。
