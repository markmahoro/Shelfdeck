# UAT 联合发布接手审计

2026-09-12。本文件为交接与发布前检查 Evidence；唯一排程仍为 CURRENT_PLAN / CURRENT_PHASE，不建立第二份活动计划。当前结论：尚未形成联合发布候选，生产未变更。

## 用户决定与职责

用户明确要求部署任务了解并行工作、负责最终收口，并确认“全部就绪后，由本任务统一协调并部署”。此决定取代此前接收恢复任务中“部署等通知”的安排。统一部署任务为“收口并部署上线”，ID `01a091f4-c863-7d02-9eea-12614e18f7d0`；五个相关任务均已收到统一交付、不独立发布的通知。

同日后续指令指定本任务为部署负责人，明确负责代码合并、工作区清理、生产部署，顺序与节奏自主决定；不再将全部任务同时完成作为固定发布前提。用户进一步澄清“无需通知其他相关任务”仅指此次任命无需广播，不限制必要技术协调。该职责已写入AGENTS和Playbook §3.5；本次职责更新没有向其他任务发送通知。每批仍须完成其自身依赖及验证，未就绪的改动不混入发布。

授权包含必要的集成、验证、完整备份和标准 NAS 发布。生产 Reset、冲突文件移动、逐片 retry 仍须核对各任务中的精确授权及当前物理/持久事实，不能由镜像发布授权扩大。UI 第二轮扫描建议尚未获实施授权，不自动纳入本次发布。

## 已核实交付

| UAT / 范围 | 任务与工作区 | 接手时的事实 |
| --- | --- | --- |
| UAT-251：完整终局及自动授权瑕疵上架 | “增加自动授权瑕疵上架”；`01a091ee-2dee-7e00-8c00-7fb0e8189074`；`emby_third_party-helix-uat251` / `codex/uat-251-terminal-defects` | 实施中，基线144798953；UI方案已确认，实际实现截图尚待UI任务复查；未交付最终提交和验收。 |
| UAT-125/250相关接收恢复及三片剩余恢复范围 | “排查影片上架与席位占用”；`01a091e1-3ab5-7c83-968f-5581fb93f953`；`emby_third_party-helix-intake-recovery` / `codex/intake-recovery-20260912` | 新任务输入稳定与真实重启恢复已报告通过；旧席位精确工具及保护断言仍在验证，生产方案未执行。 |
| UAT-257扫描阻塞及后续普通选材 | “排查扫描与来源详情失败”；`01a091e5-2ad5-7a23-a1cb-9be53e1c6bca` | 已继续实施新轮次、幂等和失败后重扫修复，转入独立工作区；未交付最终验证，无生产扫描。 |
| UAT-258授权按钮 | “确认旧输入自动清理开关”；`01a091eb-5606-7393-a855-24b5636587cd` | 完整提交`38e89d14591592240820c1d1e05d3e472821daaa`已在集成分支；20文件90项Web测试、构建、本地真实Host1440/390px及授权/撤销/失败恢复/键盘验证通过，无后续未交付修改。待最终镜像生产只读页面验收。 |
| UAT-256及本轮UI协调 | “确认全页面 UI polish 需求”；`01a0912a-0086-74e2-88ab-536c59d3862a` | 已发布范围仍按原证据关闭；251/258及扫描修复需按新diff复查。第二轮八页清单、删除正常收藏架“可接收整理结果”标签均只是未实施建议。 |

UAT-251全局授权位于收藏架配置页头，与258保持相同按钮/对话框形态；新增决定进入现有详情，媒体整理九列、过滤、分页和查看过程入口保持。健康与已接受瑕疵各显示一次。旧256验收不能代替新增UI验收。

## 工作区与生产身份

- 实际集成区：`E:/my_project/emby_third_party-helix-iteration`，`codex/user-pain-iteration`。主工作区main及其用户未提交规则/文档修改不作为构建来源，也不覆盖。
- 发布区：`E:/my_project/emby_third_party-helix-uat-release-20260908`。UI任务明确释放该区，交接时为clean detached `83235c9260fc4e2c1bc1c5d87fb193a265e1d8bb`；保留ignored镜像、日志和证据，最终只从审定的精确提交构建。
- 受保护的原Aftercare Evidence SHA256仍为`81729d8c6ec35bec5494929bb19b46e6c83412b769a2cb8cff6db859bad35a3c`，不夹带提交。
- 实时NAS：`303NAS`，SSH用户`gezhu`；Compose project/service均为`shelfdeck`，应用目录真实路径`/vol1/1000/docker/shelfdeck`，Docker私有根`/vol1/docker`。
- 实时镜像：`markmahoro/shelfdeck:helix-beta-20260912-83235c9260`；Config Image ID `sha256:ed54a889290e6e448e551af3ea823c1b32a8a00b8176adec1e4411d170789a2c`；StartedAt `2026-09-11T18:36:35.708195394Z`。当前tar存在；既有发布记录的tar SHA256为`5a2ba0cc1d86aa6fd6af5bdbef41d2ba0701c06b19a6408cdf78f8bffa8b9b94`，本次未重新计算整包hash。
- 旧发布/备份与验证细节见[83235c发布证据](UAT_RELEASE_83235C9260_20260912.md)，不能将其备份时间点当作下一次上线前的最新快照。

## 已执行的只读检查

通过项目统一`tools/nas-ssh-config.js`和`tools/ssh-exec.js`在NAS执行fnos-docker-deploy的`preflight.sh shelfdeck 18080`，另核验Compose、image、bind mounts、QSV及HTTP。

- NAS Docker 28.5.2、Compose v2.40.3；工作站Node v25.9.0、Docker Server29.4.1可用。
- `/`、`/home`为root:root755；应用目录gezhu:Users771；Compose644、secret.env600；`/vol1`约45GiB可用。未修改权限、配置或业务数据。
- 五项持久挂载`/app/data`、`/media`、`/adult_media`、`/upgrade`、`/transcode`及`/dev/dri`与当前正式部署合同一致；没有源码bind mount。
- `docker compose config --quiet`通过；NAS本机及LAN `/v1/health`均为`status=ok`、`generation=helix-clean-v3`、`normalSupplyAllowed=true`；NAS管理页HTTP200。其他运行容器状态已取得上线前参考。
- 本次没有执行build、upload、deploy apply、Reset、媒体移动或生产业务POST；没有重复已通过的UAT-258本地测试。

## 最终发布尚缺的证据

1. 三项开发完整交付及UI实际结果复查；在同一最终集成提交验证适用Windows/Linux真实流程、并发/重启/负向、Web构建和浏览器。生产只读页面核对258真实授权，避免为验证样式改变用户授权。
2. UAT-251新schema/typed合同、manifest、readiness及旧镜像回滚影响。上次扩展架构4个失败、121条drift虽在旧基线复现，本次涉及合同变更，必须重新区分相关/新增/无关失败，不继承纯UI发布的豁免结论。
3. 上线前重新核验当前生产与磁盘，创建并校验完整data一致快照、伴随文件、Compose及Secret备份。已读脚本确认`deploy-nas.js`本身不提供完整data备份，须在apply前单独完成；已有在线SQLite backup API方案可作为实现参考，不能直接复用旧目标路径或旧image断言。
4. 只使用`build-image.js` → `upload-nas-image.js` → SHA256 → `deploy-nas.js` dry-run/apply；新tag绑定最终clean commit，保留当前83235c镜像及tar。新schema如果不支持旧镜像，不宣称可以只回滚镜像。
5. 生产镜像/健康/挂载通过后继续验证各自用户结果：257完整新扫描及普通选材、接收恢复和席位持续周转、251终局与授权行为、258页面。精确历史数据治理按独立授权执行；未完成时对应UAT保持开放。

本任务已建立15分钟联合交付跟进；无变化时静默，重要交付、失败、待决定或发布完成时通知。联合发布及约定验收完成后停止跟进。自动化只承担唤醒，不替代上述发布证据或授权。

## 共享验证依赖恢复

同日接收恢复及扫描任务报告`better-sqlite3`不可用。只读核实：主工作区`media-service/node_modules`为实体目录且缺少该包，iteration通过Junction指向它，intake-recovery又通过Junction指向iteration；scan-repair和uat251此时已具有独立依赖。没有证据确定最初缺包的具体操作，不能归因于某个任务。

确认主区/集成区服务及Web的package/lock无差异，且没有共享npm安装进程后，在主服务已核验的精确实体路径执行`npm ci --no-audit --no-fund`，161包安装成功。主区、iteration、intake-recovery三条路径均通过SQLite内存`SELECT 1`及fastify/undici/sharp加载，跟踪的package/lock没有变化。已向受影响的接收恢复任务发送技术恢复结果；没有生产写入。该检查只证明本地验证依赖恢复，不代替业务回归或最终镜像验证。
