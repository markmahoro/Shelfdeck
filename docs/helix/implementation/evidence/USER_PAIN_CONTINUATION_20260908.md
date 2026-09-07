# 用户痛点持续迭代证据

2026-09-08。用户要求持续迭代，5分钟自动化已暂停，并明确跳过Emby审查。本文是Evidence，不是第二份活动计划。

## 本地修复及验证

- Field Handle过期在任何来源I/O或领域提交前转为明确失败Outcome，恢复链路不再反复抛异常；19项定向测试通过。
- Formation先展示active工作，再读历史与配置；现有表格/详情形式不变。测试将次级请求永久悬置，当前工作与筛选仍可使用。
- 100个独立Entry同一轮Spec变化产生的Case，单席位FIFO准入、重启、终结释放测试通过。
- 历史Reset保留了6个superseded终态Delivery，但错误保留Offer发布，使Intake重建。工具现在只退役已证明superseded的精确发布，不伪造Receipt，不放宽接纳一致性。
- 完整Service：500 pass、18 skip、0 fail；Architecture runner 211 fixture files、ok=true、全部Gate无findings；Reset与NAS包装37项通过；Web 44项通过，构建通过。Desktop未改动，真实媒体端到端仍待新镜像运行验证。

## 生产副本精确演练

一致性副本SHA256：`30292a218c358128aaabea9fd323d9eed9cfb7f1384994df9af6d5e9912aa0cc`。
仅移除错误重建的Subject `libra-subject-ea7c330051599bbc27dc9e668238e70fbbe95c5b`、1 Run、13 Work，退役6条Offer发布。56个Arca表和4276个范围外Work逐行哈希不变；54个收藏保留，integrity=ok、FK=0，第二次应用全部零动作。工作区物理文件仍须生产包装精确处置，本地副本不替代该项证据。

## Top Gun物理结果

正式回收站记录`6a0a4882df3826991cabbb4fcaf0e7d76d311b32e71377dd58e9371e31a98f88`为archived。
旧目录11个文件、4,015,976字节全部大小与SHA256校验一致，原目录不存在；30天保留。当前电影和转码来源未移动。按用户要求跳过Emby索引审查。

## 未关闭项

275923039f已标准部署，tar SHA256 `2a94bbe5074d01aff45b0ae261b072a96fd7372e35d7a743cad5bed6b514b567`，NAS image `sha256:724bad65097988dbe3fe2f767f8dfeea2447c0cfc2d601a934ffd65954b4c3c4`。停服完整备份位于`/vol1/1000/docker/shelfdeck/backups/user-pain-20260908-continuation`，数据库SHA256 `cf3f55595a09862423bd5c3301c036522c8f9b1519119f91dade27e72aad69bb`，配套旧镜像fd8a8e6f35可回滚。

精确Reset已使用标准NAS包装执行，13 Work、1 Subject、1 Run及其1 Workspace已清理，6条superseded Offer发布已退役。integrity=ok、FK=0，重复plan无剩余动作；备份位于`/vol1/1000/docker/shelfdeck/backups/formation-reset-20260907T163348Z/data`。重启后旧Subject不存在，最近异常日志未再出现P7过期/P8接纳冲突循环。

3份可读NFO漂移通过正式check命令分别生成queued Case，未启动额外Work；保留的2个历史active Case中，实际1个FFmpeg执行、另1个等待资源。不能把排队宣称为NFO已同步完毕，也不提高并发绕过验收。

生产3轮首屏主API组合为1450/964/915毫秒（旧版全页3.2–3.7秒）；随后收藏页59/156/147毫秒。此为API组合耗时，不冒充浏览器绘制测量。历史/config请求仍约2秒，但已不阻塞主工作展示。

复验发现等待资源仍显示“准备改善”，且重启重做转码时旧进度样本暂未更新。追加只读展示修复：准确展示waiting_for_resource；带采样时间的进度超过120秒则隐藏旧百分比并显示“等待进度更新”，新样本恢复后正常显示。该规则不判断业务失败、不改Foundation进度单调性、不伪造转码进度。追加修复仍待最终镜像发布。
