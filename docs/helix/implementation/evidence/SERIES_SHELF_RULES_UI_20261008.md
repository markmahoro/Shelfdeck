# Series 收藏架规则编辑验证

2026-10-08；当前 Series Phase 节点1/4。基于 `cac3a0918`，本文件与实现同一提交；不是负责人 UI 接受或发布资格。

## 合同与交互

沿 SSOT §5.5.8 / 系统推荐规则既有 Series 每集空间合同（1–5星为0.75/1/1.5/2/3 GiB）及 UI 负责人既有 profile-aware Shelf 设计推进，不改变 Shelf 所有权、规则发布/绑定流程或 SSOT。Shelf 仍可携带多个 Profile，不新增虚构的单一 Shelf 类型。

创建页和 Shelf 卡片显示现有 Movie、Series 规则；Series 明示“每集”。复制/修改标准时通过媒体类型选择器切换，两个类型各自保存编辑态，预览和发布沿既有 API。空间输入允许合同定义的小数，拒绝非正数、非有限数、无法精确换算整数字节或超出安全范围的值。修改一个类型不丢弃其他 Profile；修改体积不把已有音轨子集等要求扩成默认值。分支身份不一致明确拒绝。

模板、发布和影响条数措辞改为媒体通用，保留实际后果确认。规则弹窗固定标题与操作区，内容独立滚动；窄屏修复96vw加外部padding导致的右侧越界。卡片标题使用h2。命名示例仍是原Movie示例，本批不声明Series落位可视化完整完成。

## 验证

- 新增7项：正式Arca合同验证Series小数限额及完整摘要、Movie/其他Profile和音轨保留、5种非法限额拒绝、类型切换保持编辑以及预览/发布请求。
- Web全量26文件121项通过。首次4项失败是Movie专属显示文案旧Oracle；更新为通用文案后全量通过，原发布/绑定行为断言保留。
- Playwright实际浏览器：文件来源与规则编辑共4项通过（1920×1080/390×844）；规则编辑受影响区域Axe零违规，键盘类型选择、跨类型保留、提交完整规则经正式Arca validator验证、发布后新每集限额回显、无页面异常。
- 目视截图发现窄屏弹窗越界；新增边界断言先复现，再修正尺寸后规则双视口2项复验通过。截图在仓库ignored的`.codex/series-browser/series-shelf-rules-edits-p-b4cb6-ithout-changing-Movie-rules-{desktop,narrow}/series-standard.png`。当前截图已检查。
- TypeScript/Vite Web构建通过（123 modules）。Vitest日志保存在仓库外`E:/my_project/helix-git-consolidation-20261008/series-shelf-ui-vitest-v2.log`。

浏览器API为受控响应，只有提交规则校验调用正式Arca合同；不冒充真实HTTP发布到持久Shelf或Aftercare E2E。Windows本地前端验证，未重跑Linux/Docker、整体架构及生产副本升级/回退。

## 剩余

同版本UI负责人验收、真实规则发布/现有条目重评、Series命名预览、Formation身份/批次、Collection逐集旅程及发布资格继续。用户暂保留EpisodeDelivery摘要合同缺口；本批不修改该合同，未操作NAS。
