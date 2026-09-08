# UAT-143 / 139 / 224 / 232 退出审阅增量验收

2026-09-09；基线 fdbb921d8。状态：本地通过，未发布，相关整项保持开放。

## 已核实和修正

- 对照SSOT 9.4.8、9.5.5：规则设置Tab、系统建议、手动搜索、批量Review和独立二次确认均继续保留。
- API真实材料角色为 primary_payload / structural_dependency；此前UI判断 primary，导致主视频显示为附属文件。现按实际角色显示主视频、光盘结构文件及附属文件。
- 审阅增加收藏数量、Primary/结构文件数量、附属文件数量、文件总GiB、冻结Selection的Deck覆盖率；显示收藏架名称、具体位置及共享引用保留条件，不承诺全部空间都可释放。
- 大批量第二确认后才显示独立最终删除按钮；未合并为一次动作。

## 验证

- npm test -- --run test/offdeck.test.tsx：5 PASS；npm run build：PASS。
- 新测试使用120 GiB符合实际高量阈值；验证真实角色、Selection总量、共享条件，且二次确认前后 authorizeOffdeck 均未调用。
- Edge本地18195隔离HTTP fixture：查看大批量范围、点击二次确认、核对独立确认删除按钮；DOM与截图核查清晰且未露出AST/Reservation/原始ID。没有点击最终删除；fixture拒绝授权端点，无生产连接或媒体操作。
- 初次浏览器点击因fixture端点误写返回405；按实际confirm-high-volume路由修正后通过，不归为产品缺陷。请求记录 .codex/uat143-browser-requests.json。
- 00:34生产6个只读请求200；70收藏、2条活跃整理；无部署或生产数据修改。

## 明确剩余

- UAT-139：Arca Selection仅保存shelf_coverage_digest，未保存可还原的各收藏架覆盖率。需要在同一Owner事务内持久化实际确认时快照，补API/重启及变化后稳定性验证；不得拿当前收藏数量倒填历史值。
- 继续核对Scope子集确认后显示范围及真实执行安全链；上述UI fixture不是文件删除端到端证据。
- 143/224/232仍需统一发布及对应生产表面验收；246读全量收藏与历史的成本继续单独处理。
- 本增量晚于候选241436b8da，不在其镜像内；未因本地通过关闭任何UAT。
