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

生产仍为fd8a8e6f35；上述续修尚未部署。须部署后验证历史接纳冲突与过期访问异常不再循环、3份可读NFO的Inventory漂移收敛及整页主请求延迟。实际Top Gun转码此前持续推进，不能依据Case阶段不变声称卡死，也不能以HTTP健康宣称全部用户痛点解决。
