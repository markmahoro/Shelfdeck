# JAV演员完整性：本地实现与验证

日期：2026-10-21。所属唯一Phase工作项：`JAV-ACTOR-COMPLETENESS`。基线`1b7b683e0`，具体实现提交及冻结审核输入在本项后续记录中绑定。状态：本地实现/适用验证通过，UI负责人审核待回收；无生产操作，不关闭整个Phase或既有UAT。

## 用户确认与Owner合同

用户要求演员为JAV必要结果，但允许有一个真实演员叫“未知演员”；已确认统一档案方案，不采用只有页面占位文字的方案。SSOT同日“JAV演员完整性与统一未知演员”节为本项合同。

- People在服务初始化时用自身既有直接注册事务幂等建立JAV库保留Person `person-jav-unknown-actor`，固定名“未知演员”，无Provider Identity、无图片；已有冲突拒绝启动，不按同名/跨库合并，不在GET中写入。
- Libra保留已选同站原始peopleHints。无actor时由自己派生系统actor关系，读取People公开正式Reference Projection；Draft/Fact至少一条actor。来源有演员就不添加未知演员，原始Observation仍可为空。
- Arca新身份纠正通过People公开查询取得精确`system_unknown_actor`证明；无证明、错Person、错reason、伪造摘要均拒绝。当前Cast、NFO和相关作品一致；Arca不创建Person、不写People表。
- JavMenu只在主影片资料区标记为女優/女优/演員/演员/出演者的行提取姓名，去重；不读取推荐区，不编造JavDB Actor ID。JavDB既有可靠ID保持。
- Arca纠正NFO行为变化后Renderer标识升为`arca.jav-correction-nfo@2`；已冻结旧来源、已入藏历史不会被本项自动重写。未添加旧Run兼容、回填或生产修复。

## 适用验证

工作区：`C:/Users/markm/.codex/worktrees/37d3/emby_third_party-helix`。以下均在隔离数据/受控HTTP中完成，不把fixture成功表述为网站长期稳定。

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| Service `npm test` | 648 PASS / 29既有skip / 0fail，137.58秒 | 当前服务原有完整测试；后续仅改纠正Renderer标识/引用常量及加强Cast proof，受影响专项和实际恢复旅程另行复验 |
| People、Product Fact、纠正Cast/metadata/Inventory/stored facts及source resilience七文件 | 54 PASS / 0fail / 0skip，2.39秒 | 初始化幂等、正式Projection、空actor拒绝、保留raw空来源、真实演员不追加未知、跨库隔离 |
| source resilience/runtime/contracts、aftercare source、纠正Cast/Inventory六文件 | 48 PASS / 0fail / 0skip，12.68秒 | 最后一次Cast proof加强后的来源/纠正回归；与上一行有重叠，不求和 |
| 实际HEVC初次整理Host | 1 PASS，40.10秒 | 正式Workspace/NFO/最终媒体/唯一Arca Commit；人物页与相关作品API包含同一未知Person |
| 实际已知演员纠正与维护Host | 1 PASS，70.88秒 | Old Actor改New Actor，弱名称保留，不加入未知演员；维护窗口正式建档与关系刷新 |
| 实际写完纠正NFO后进程退出Host | 1 PASS，54.55秒 | 重启恢复原Effect与冻结来源；纠正后当前Inventory Cast及NFO仍为同一未知Person，相关作品不重复，视频和唯一Commit保持 |
| Web People/Collection现有组件 | 24 PASS / 0fail | 相关页面现有交互回归 |
| Playwright桌面1440×900/窄屏390×844 | 2 PASS，7.5秒 | 现有人物页JAV tab、姓名头像、相关作品键盘入口、作品跳转收藏详情与未知演员、Escape关闭；无写请求/页面异常；详情axe零violations |
| 静态检查 | 五项PASS | Package boundaries、forbidden semantics、manifest set、P2 baseline、SSOT source map；131 capabilities/110 families/224 tables/58 transactions不变 |

核心54项命令：`node --test test/helix-architecture/p6-people-store.test.js test/helix-architecture/p9-product-fact-contracts.test.js test/helix-architecture/jav-correction-cast.test.js test/helix-architecture/jav-correction-metadata.test.js test/helix-architecture/jav-source-resilience.test.js test/helix-architecture/jav-correction-inventory-change.test.js test/helix-architecture/jav-correction-stored-facts.test.js`。

来源/Cast48项命令：`node --test test/helix-architecture/jav-correction-cast.test.js test/helix-architecture/jav-correction-inventory-change.test.js test/helix-architecture/jav-source-resilience.test.js test/helix-architecture/jav-source-runtime.test.js test/helix-architecture/jav-source-contracts.test.js test/helix-architecture/jav-aftercare-source.test.js`。

浏览器：`npx playwright test e2e/jav-unknown-actor.spec.ts --project=desktop --project=narrow --workers=1`；由Playwright管理临时服务，结束后18181无监听。本测试mock公开API，仅证明UI呈现/交互，真实生产数据链另由Host旅程验证。截图在忽略目录`.codex/jav-actor-review-20261021/screenshots/`，冻结源码、实际dist和SHA256 manifest在同一审核包中；不提交生成资源。

## 原始失败与修复

首次专项及组合检查暴露旧“空Cast/零JAV人物”的fixture预期和缺正式People解析证明；按新明确合同调整fixture，未放松Owner/摘要/Proof验证。后续专项全部通过。US Adult原生人脸Host的JAV零人物预期同步改为精确保留身份；该opt-in整条人脸测试本轮未执行，不记PASS。

首次浏览器两项失败，trace为测试mock把`/v1/admin/care/:entry`误配成`.../care`，返回不完整Care导致详情异常；修正mock的精确路径和defect候选结构，产品代码未因此加fallback。保留初次日志`.codex/jav-actors-browser-first-failure.log`；最后两项通过并新增pageerror零异常断言。

首次P2/source-map检查发现本轮SSOT文字变更后的`SOURCE_MAP_DIGEST_DRIFT`；通过正式`materialize-helix-ssot-source-map.js`更新唯一文档摘要，合同分片/计数/aggregate未变，五项复验通过。

## 审核与发布边界

按Playbook §11.1/§12.3执行，属于后端影响用户可见Projection。本地页面走查不能替代UI负责人接受；用户已明确“发送审核”，准备提交具体冻结版本，尚未记录负责人PASS。

本机Docker Linux Engine未运行，`docker version`返回named pipe不存在；未自行启动或使用生产容器替代。未新增Linux实际Effect/镜像、Windows独立Service分发、Electron或完整Architecture Gate资格。没有部署、生产配置变更、历史收藏回填/重处理；生产保持af2257版本。UAT-322继续仅记录待修，UAT-323/324的来源长期稳定与已污染收藏处置范围保持各自开放。
