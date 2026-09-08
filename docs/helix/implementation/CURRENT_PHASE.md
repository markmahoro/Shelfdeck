# 当前活动包：逐项关闭UAT

更新：2026-09-08。唯一顺序与工作区归属见[Master Plan](../CURRENT_PLAN.md)；稳定ID、旧编号映射、逐项结果边界见[UAT总表](../UAT_ITERATION_REGISTER.md)。不在此重复流水账。

## 执行与验收

- 当前接手审计基线为7c858523c。全量251行的状态类别与96行待实施/验收/承接事项已建立逐项Oracle及依赖，执行唯一Master Plan的B1–B5；不能以UAT-220历史文档关闭宣称本轮一致性/功能验收已完成。
- B1先传播已确认三终局模型；触发瑕疵修复、已接受瑕疵健康展示仍须具体合同。B2独立修正从UAT-211开始，不等待全部UAT-251。B3整合e6b7f0424并补后续需求，B4逐场景核查全部历史待验收，B5统一发布及精确存量治理。
- 每行验收包含：原问题场景、最新合同、当前实现、定向正/负路径、适用真实浏览器或真实媒体证据、部署身份及未测风险。被取代项保留旧证据及承接结果，不自动关闭；UI/后台独立部分可先交付。
- UAT-210/211：健康观察及有Evidence的记录更新不创建Case；Case仅代表有实际目标且获席位的维护。精确Settlement完成证据排除历史路径检查，仍检查当前Inventory及未完成义务。
- UAT-212/213：海报绿健康、红不健康（含queued）、黄已准入维护、灰未知；queued不进入整理区。真实Plan/Event详情和创建目标可解释；旧终态不冒充当前故障，旧Case目标不可倒填。
- UAT-214：NFO人物新观察→People Evidence→确定关联记录更新，不能以仅消费旧关系宣称完成。
- UAT-215：新上架主动旧目录收尾；空目录、非空残留、样片/其他版本保护、异常可见、重试及重启恢复分别验证。回收执行能力与完整收尾流程不能混同。
- UAT-216：Top Gun定向回收已完成；其余精确文件清单确认后处理。清理未完成与影片上架成功分开记录，普通杂物不自动生成健康红灯或维护Case。
- 发布前完成相关本地测试/架构Gate及真实浏览器两页操作。生产采用标准build/upload/checksum/dry-run/apply，记录镜像/commit/SHA256与回滚点；保护在飞处理，正常重评而非手改灯色。

## 交付证据

- [全链路审计](evidence/AFTERCARE_FULL_CHAIN_AUDIT_20260908.md)：AC旧ID仅为证据locator。
- [实施与生产取证](evidence/AFTERCARE_HEALTH_CASE_IMPLEMENTATION_20260908.md)：核心部署及后续开放项。
- [生产部署](evidence/USER_PAIN_DEPLOYMENT_20260907.md)、[后续证据](evidence/USER_PAIN_CONTINUATION_20260908.md)。
- [支线证据](evidence/USER_PAIN_ADDITIONAL_BRANCHES_20260908.md)：UAT-217/075。
- UAT-212独立任务e6b7f0424已整合为799433c65；[本地证据](evidence/FORMATION_CARE_CLARITY_20260908.md)。收藏/整理统一分页及实际动作已有本地回归和合成数据浏览器操作；真实生产性能与流程、详情解释完整性仍开放。
- [整理前活动包快照](archive/20260908_PRE_PROD_CONSOLIDATION/CURRENT_PHASE.md)仅为历史，不产生现行规则。
