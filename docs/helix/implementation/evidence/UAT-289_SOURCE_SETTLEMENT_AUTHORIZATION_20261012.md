# UAT-289 来源处理授权等待提示

日期：2026-10-12。范围：Formation 列表、过程详情与已有自动清理授权配置；不创建生产 Series Shelf/Field，不代用户批准来源删除，不操作 NAS 或 Reset。用户最新决定保留生产现状，本轮不升级、不 Reset 生产；只保存修复和本地验收证据。

## 合同与根因

SSOT §5.8.7 / §6.5.3规定 Arca 的 standing Input Settlement Authorization 和按 Run 精确派生的 Approval；没有授权必须等待，不能伪造来源结算成功。§9.4.6要求具体等待原因和可达用户动作；Playbook §11.1 / Beta baseline §7.1要求通过状态、结构、配置入口与必要后果确认完成操作。

现场原证据：20个 `arca.ondeck.input_settlement.delete@1` Event 等待、零 Attempt、授权 head 和记录为空。正式 Arca 输入投影将缺少授权或精确 Approval 转为 `owner_approval` 暂不可用；Foundation按已有合同保存 `waiting_for_external`，不创建执行 Attempt。过程投影仅按通用 Event 状态显示“等待外部服务”，遗漏了该 Arca Capability 的具体许可等待含义。

## 设计与实现范围

- 不改授权、执行、调度、恢复或删除合同。仅对正式来源结算 Capability 的 `waiting_for_external` 显示“等待自动清理授权”；实际 Provider 等待、正常执行和完成态保持原语义。
- 当前节点携带配置目标，列表与详情显示“清理设置”，直达既有收藏架配置中的自动清理确认弹窗。配置导航没有授权副作用；仍需明确点击授权按钮。
- 确认范围、保留文件与不包含退出收藏销毁的后果说明继续保留；取消和 Escape 不改变授权。
- 页面数量、媒体整理九列、筛选与分页不变，沿用现有按钮样式；不新增重复解释段落。
- `current-action-summary` 只传递已选节点的展示配置目标，不决定业务授权，不读取其他 Owner 表。

## 验证与状态

实现提交 `9edc2515c55de37ab03dbfb73020e4825f2d7696`；最终入口文字压缩提交 `b87a61bc84364691be81d5c149583be35eadc8e6`，按钮为“清理设置”，沿用既有Button，不换行、不增加列宽。UI负责人接受最终版本已验证的授权等待与配置路径，生产未部署。

为排除共享工作区同时进行的UAT-304/305/307改动，分别用 `git archive` 导出上述精确提交至仓库外冻结目录，仅复用安装依赖；没有新分支、工作树或生产数据副本。最终 `source-b87a61bc8.zip` SHA256：`48d856765f80291b89a3033bb969b1355f6cb077e20f2d7deddca93d76d6ee8a`。

- 最终冻结版：27个前端文件141项通过、Admin Web构建通过，生成JavaScript `index-Vt0yLBWn.js`。
- 原实现冻结版：38项过程投影/当前动作/UAT-289/Admin Web合同通过；8项桌面/窄屏Series浏览器回归通过。最终提交只压缩入口文字和对应测试，不改这些后端及原有页面路径。
- 最终真实Host浏览器35.93秒，1通过、0skip；原实现冻结版37.31秒通过。流程为页面登录→Formation等待原因→键盘打开/关闭过程并回焦→清理设置→既有确认弹窗→Escape及取消→明确授权→来源结算及两集Commit→收藏详情。没有拦截前端API。
- 未授权时两个正式结算Event为 `waiting_for_external`、零Event Attempt、零授权记录和零Commit；导航、Escape、取消后原媒体bytes/inode/mtime/ctime保持。明确授权后一个standing Authorization和唯一Commit，两集来源按正式许可处理，范围外文件字节保持；完成后配置入口消失。
- 已实际查看桌面列表/详情、窄屏等待节点、授权范围与后果、两集完成反馈；九列保留，当前状态可读，按钮使用同一组件。测试拥有的Host/Chromium/Vite已结束，成功走查的临时数据由测试清理，原生产和本地运行库未Reset。两个早期初始化失败fixture目录的限定TEMP递归清理被自动审批拒绝（仅返回blocked by policy），未重试或绕过，目录保留。

证据根：仓库外 `E:/my_project/helix-git-consolidation-20261008/uat289-20261012/`，最终日志 `host-frozen-b87a61bc8.log`，截图 `browser-frozen-b87a61bc8/01-list-desktop.png`、`02-detail-desktop.png`、`02-detail-step-{desktop,narrow}.png`、`03-authorization-narrow.png`、`04-committed-narrow.png`。早期fixture初始化/端口/默认Routing Operation/Profile接线失败记录和截图保留，未改记为通过；页面等待预算覆盖既有10秒轮询与30秒Projection cadence，必须先断言正式结算等待已经出现，没有延长业务超时或放宽安全条件。

本项本地UI验收通过，未将其他UAT、原20成员现场或生产升级记为通过。实际Provider网络、真实视频质量和Linux浏览器不在此受控两集走查范围；没有涉及平台特有逻辑或重新构建Docker/Desktop，整体发布检查由后续明确授权的交付负责。

## 变更文件

用户可见投影：`formation-process-projection.js`；已选节点展示传递：`current-action-summary.js`。前端：`App.tsx`、`FormationPage.tsx`、`InputSettlementAuthorization.tsx`、`ProcessStages.tsx`、`ShelvesPage.tsx`、`api.ts`。独立测试：`uat289-settlement-projection.test.js`、`uat289-settlement-browser.test.js`、`web/test/uat289-settlement.test.tsx`。没有提交主线程的CURRENT_STATUS/REGISTER或其他UAT改动。

隔离Host复验入口：

```powershell
$env:HELIX_UAT289_BROWSER='1'
$env:HELIX_UAT289_OUTPUT='<absolute evidence directory>'
node --test test/uat289-settlement-browser.test.js
```

工作目录为 `media-service`，先执行 `npm run build:web`。来源、收藏架和规则由正式API准备；页面登录、等待原因、查看过程、进入配置、取消及明确授权均通过实际浏览器，不拦截前端API。Provider/媒体探测受控，不用于真实媒体质量或真实外部网络验收。
