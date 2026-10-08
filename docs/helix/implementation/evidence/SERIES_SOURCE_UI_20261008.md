# Series 文件来源入口验证

2026-10-08；所属当前 Series Phase 节点1/4。基于 `0628266b3`，本文件随实现提交绑定精确版本；非 UI 负责人接受或部署资格声明。

## 交互及实现

沿 UI 负责人既有 Series 设计协调（任务 `01a0912a-0086-74e2-88ab-536c59d3862a`，2026-10-08 turn `01a117bd-5062-76a1-b73d-70e5b2986e77`）：用户从文件来源登记电影或剧集，默认电影，选择明确媒体类型后保存；卡片显示正式 Profile Snapshot 与扫描状态，提供扫描新文件。未另发跨任务消息。

`materialFieldRegistration` 必须显式接收 movie/series，提交正式 contentProfileHint；不从来源名称或路径推测。原 Extraction Policy 扩展名及 Platform 物理身份委托保持，不能由文件扩展名准入推导 Series 原盘加工已经支持。登记等待保留表单，拒绝重复提交；失败保留输入和同一请求身份，可直接重试。注销确认保留文件处置后果，改为媒体通用措辞。卡片标题改为 h2，修复空表单收起后 h1→h3 的无障碍层级缺口。

## 验证

- Web Vitest：25文件114项通过，含 Series 选择/失败保留/相同请求重试/重复提交保护/正式卡片类型。
- Web TypeScript/Vite 构建通过（123 modules）。
- Playwright：1920×1080、390×844 两视口通过；键盘选择与焦点、登记失败后重试、结果卡片、扫描按钮可用、无横向溢出、无页面异常；受影响区域 Axe 零违规。首次检查发现 heading-order，修复后两项复验通过。
- 浏览器使用受控 API Projection/响应，验证实际页面请求与交互，不冒充真实 Host E2E。真实正式观察与上架链路见 [上一批 Evidence](SERIES_PUBLIC_OBSERVATION_20261008.md)。
- Platform Mount Scope/旧 Movie 默认策略：5通过，1显式 skip（未提供本地 Movie test library）。
- 本地截图：`.codex/series-browser/series-material-field-regi-0ea8d-overy-and-keyboard-controls-{desktop,narrow}/series-{form,saved}.png`；已目视检查窄屏表单和桌面结果。截图及日志不进入源码库，可用 `npx playwright test --config series-playwright.config.ts` 重建。前端全量日志位于仓库外 `E:/my_project/helix-git-consolidation-20261008/series-source-ui-vitest.log`。

## 未关闭门禁

UI 负责人对本提交的验收待完成；Shelf 规则、Formation、Collection Series 旅程继续。用户要求暂保留 EpisodeDelivery Requirement digest 合同缺口，本批不改 SSOT 语义。未重跑整体架构、Linux/Docker、真实生产副本升级/回退；未操作 NAS，节点和目标均保持开放。
