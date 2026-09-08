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


## UAT-139 覆盖率快照与真实十部退出（接续）

- Arca Selection确认事务同时写入OffdeckShelfCoverage typed JSON及其schema ref，继续绑定原shelf_coverage_digest；GET只读该快照，摘要漂移拒绝读取。SSOT8.5.12、派生表/DDL及应用类型同步，未移动Owner或扩大删除范围。
- 精确生产前置schema 42281705d35e…通过既有标准升级通道添加两个nullable字段，旧Receipt保持NULL，未按当前数据回填；原在飞Run保留。新schema b8cbd25e773b61e1e9ecfe1b8aecb079f4c97eae02f38c117b4d4e8a08427821。
- UI展示确认选择时的Shelf覆盖率；排除/失效Scope单独提示，不混入将删除文件清单和Related数量。
- 13项schema升级/派生基线测试通过；14项Off-deck安全/摘要漂移/旧记录缺证测试通过；5项Web测试及build通过。Edge18195显示电影收藏架50.0%（确认选择时），fixture只验证UI，未触碰生产。
- 真实媒体十部链22.71秒PASS：分批准入、十部真实上架、取消未授权Review、batch Scope确认、高量级提前授权拒绝、独立二次确认、十部独立退出完成、零失败Work/Event、Control释放。Shelf及源目录范围外sentinel保留。
- 退出后关闭Host再启动，新会话GET仍返回原Shelf覆盖率100%和Deck覆盖率100%，当前十部已经全部退出；证明没有使用当前分母倒填。
- 旧测试两处前提过时：先等十部准入才配置路由与三席位限制相互等待；要求上架前源文件仍在与已生效Arca Settlement冲突。仅修正测试顺序及退出前后守恒边界，保留十部真实执行、原始样本及范围外文件保护；失败日志保留，不包装为产品失败或成功证据。
- 输出：.codex/uat139-schema.log、uat139-offdeck-unit.log、uat139-real-volume-v3.log；失败v1/v2保留。整项仍待统一发布、生产表面验收，未关闭；本增量不在241436b8da镜像中。

- 全架构1608项：1600通过、7项既有SKIP、1项固定JSON列数未同步；新增snapshot使63变64，同步该Oracle后该文件5项全部通过。未重复跑无关已通过文件。00:50生产只读仍70收藏/2条在飞，未部署。
