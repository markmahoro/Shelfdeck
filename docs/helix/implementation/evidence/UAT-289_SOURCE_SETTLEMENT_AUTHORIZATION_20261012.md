# UAT-289 来源处理授权等待提示

日期：2026-10-12。范围：Formation 列表、过程详情与已有自动清理授权配置；不创建生产 Series Shelf/Field，不代用户批准来源删除，不操作 NAS 或 Reset。生产部署与现场验收由本轮升级主聊天负责。

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

实施与适用页面走查进行中。当前前端27文件141项通过、过程投影与UAT-289定向25项通过、Admin Web构建通过。精确实现提交、Host截图、数据保护及最终UI接受在完成后补充。代码/隔离测试不代替生产升级后的现场验收。

隔离Host复验入口：

```powershell
$env:HELIX_UAT289_BROWSER='1'
$env:HELIX_UAT289_OUTPUT='<absolute evidence directory>'
node --test test/uat289-settlement-browser.test.js
```

工作目录为 `media-service`，先执行 `npm run build:web`。来源、收藏架和规则由正式API准备；页面登录、等待原因、查看过程、进入配置、取消及明确授权均通过实际浏览器，不拦截前端API。Provider/媒体探测受控，不用于真实媒体质量或真实外部网络验收。
