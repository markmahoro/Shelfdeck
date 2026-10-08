# Series逐NFO生成与物化副作用

日期：2026-10-08。基线`10da88d3bcb841a8f094aa4952209d0cd8950e32`，从唯一Series Phase继续逐Artifact维修。无生产部署/数据处置。

## 实现

- TextRender验证精确ArtifactProfile、Case/Care Basis和已接受Fact集合，为每个NFO目标生成独立Workspace文件，并通过既有Workspace登记端口登记Artifact/Material Handle。仍拒绝无scope请求及已经恢复为可读的文件。
- Artifact provenance绑定原Inventory材料key/revision、Artifact scope及生成时现实Physical Identity；生成前后重新检查Case与源文件。Workspace重放必须字节一致，不能改变其他集的文件。
- Materialize按原Inventory目标位置落位，重新验证登记的Artifact、完整生成字节及来源Fence；只retire该成员，正常NFO和Primary不进入删除/替换集合。Inventory新材料row复制对应原成员Artifact scope。
- `continue_forward`可以用精确superseded原文件与新生成字节恢复rename/copy中断；来源或退役文件被外部改写时明确返回external_writer_conflict。没有显式恢复决定不能认领已出现的新文件。缺失文件仍需配对的Custody/Presentation Finding授权。
- Movie单NFO路径、Control/Inventory事务与已有Settlement所有权保持原边界。

## 证据

12项真实临时文件Capability专项通过：同时生成/物化两个目标、独立Artifact与Release/Acquire集合、其他NFO/Primary字节保护、Workspace重放、落位后重放、rename后forward恢复、来源新出现/被改写/退役文件改变拒绝、错误Profile/Fact输入和Workspace字节拒绝、缺失授权与恢复决定限制。Result、Evidence、EffectReceipt使用正式schema graph验证。

这些是正式Capability的真实文件Effect测试，Workspace登记端口使用内存fixture；没有据此声称完整SQLite Case、Inventory/Control原子Commit、Settlement或真正进程重启已验收。自动Series评估仍输出attention_required，待完整Case/事务/恢复Host通过后再启用。

专项与既有Effect安全42项通过。完整架构2,278项：2,269通过、9项既有skip、0失败，96.5秒。边界检查446文件/1387依赖、语义2064文件、diff检查通过。

首次专项有一个负向fixture直接修改frozen参数数组的错误，改为克隆输入后通过；首次相关回归322通过/1失败来自旧源码断言未涵盖新的额外Series Source Guard，已更新为仍要求缺失授权配对且同时要求Guard的断言并复验。原失败日志保留，不隐藏。

日志在`E:/my_project/helix-git-consolidation-20261008/`：`series-nfo-effects-focused.log`、`series-nfo-effects-aftercare.log`、`series-nfo-effects-focused-final.log`、`series-nfo-effects-schema.log`、`series-nfo-effects-full.log`。本批未跑Linux/Docker、浏览器/UI及生产升级；正式端到端维修事务、真实重启和其余Series发布条件仍开放。
