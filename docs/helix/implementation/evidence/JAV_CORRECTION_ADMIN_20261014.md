# JAV-CORRECTION-ADMIN 本地证据 / 2026-10-14

基线 commit `da23711dd` 上的未提交开发版本。不是发布标识、生产资格或 UI 负责人验收。

收藏交互区“核对影片”查询→新旧身份/封面及完整路径预览→保留视频/更新资料后果勾选→确认→读取持久纠正状态。Libra 过程详情保持只读；受理后的关闭不取消后台纠正，重新打开显示既有非终态，不能发布第二项。attention_required 目前只读取/刷新，不伪造重试或取消能力；完整异常恢复继续在当前 Phase。

- 真实隔离 Host：公开 GET 预览、POST 确认、指定/最近状态至原子 Commit；错字段/伪造 actor、异摘要同 key、其他 Entry 查询拒绝；重启清空预览缓存后精确确认仍重放原 Receipt。一个原 On-deck Commit，视频字节保持。
- 预览只读检查位于 Owner 原子事务之前；命令 Receipt 重放仍由事务内 Coordinator 决定。新受理在同 UOW 重新验证实际 Entry Basis 和 Material Control；未允许嵌套 SQLite 事务。
- 实际 A/B、单独 A、单独 B 的隔离 Host 分别通过。A/B 一包/有序 Remux/一次入藏；单独 A/B 为 stream_file，不检查缺段。用户 E:/jav_test 没有修改。
- Vitest：31 文件 / 164 项通过；TypeScript + Vite 构建通过。
- Playwright：JAV 初次确认、收藏纠正、Series 收藏，桌面 1440×900 与窄屏 390×844 共 6 条通过。纠正覆盖缺资料、预览/路径、后果勾选、提交失败同 key 重试、完成反馈；键盘焦点、窄屏无横溢出、Axe 新区域零 violation。页面响应受控，不代替真实网络/来源验证。
- 当前 144 routes（143 Admin + public health）、119/102/201/47；P2 golden `12cbd8f039bbdc8b9017d9ff933ef974e223964522e9e2efaa9db568f3554e58`。P2/P12/skeleton 16 项、P13 4 项、Correction 模型/预览/门禁 10 项通过。

浏览器核验的实际构建文件摘要（生成文件不入库）：

| 文件 | SHA-256 |
| --- | --- |
| assets/index-CatE80jF.js | `178f1f819a57a930e9b6bc018fa720fe1a815cb898c7a35d9d0d1c3b2248a435` |
| assets/index-CuO8ujry.css | `c180471c766762935170b739cd0afccb439752126bbb97dee8a65a8297c22891` |
| index.html | `9a84e78c1e1aa440c20e4011921febcbe9b9783685f43d8d44d5cad8322b26b5` |

截图及 trace 位于 ignored 的 media-service/web/test-results；桌面/窄屏截图已检查。无任务占用的 18181 server 留存。没有 NAS 部署、生产数据动作、用户材料移动/覆盖/删除。剩余资格：提交后清理、Perception 剩余连续性、完整异常恢复、UI 负责人具体版本验收、全部来源/媒体/跨平台及副本升级回退。
