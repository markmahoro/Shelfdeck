# UAT-144 普通HTTP页面验收关闭

2026-09-08，原PROD-001。只关闭页面mount时生成ID导致白屏这一项，不承接保存digest问题UAT-145或来源状态问题UAT-146。

- 原记录明确来源/收藏架页在mount调用crypto.randomUUID，普通LAN HTTP不具备该API。历史修复ef8eec0dc；当前id.ts在randomUUID不存在时使用getRandomValues生成UUID。
- 当前Web id.test.ts显式移除randomUUID，保留getRandomValues，验证前缀、UUID版本及格式，通过；已包含在53项Web整合PASS中。
- 真实生产Edge，地址http://192.168.12.230:18080，部署镜像helix-beta-20260908-6e37bf5679（Docker image sha256:356c034aca554dc206d7c2050b38d9ba646c6c0c1f43f66d7a57aa1f86f3d976）。从整理页实际点击文件来源：正常显示标题、现有电影来源及956/883汇总；再点击收藏架配置：正常显示标题、新建收藏架按钮及电影收藏架。两页mount无白屏。
- 当前结果满足本项Oracle，关闭。没有改HTTPS、创建来源/收藏架或写生产数据；保存流程单独由UAT-145验收。当前来源文案与扫描异常仍归222/146等开放项，不因本项关闭而消失。
