# Series NFO Artifact目标映射

2026-10-08；当前Phase节点4逐集维修的基础，已进入节点2正式落位调用。

## 本批结果

Arca从Product Package的完整Metadata Fact集合获取唯一、精确Season/Episode scopes，以NFO Artifact Requirement摘要确定整季或具体Episode目标，再用Artifact媒体摘要关联其Workspace物理成员。形成按sourceMaterialKey排序的内部映射；现有Series placement消费同一解析逻辑，不用文件名推断身份。

修正原placement仅使用第一份Metadata Fact的问题；重复Episode、错季、非canonical scope、缺少对应Episode、重复物理材料、歧义Artifact摘要、同一Requirement被两个物理NFO占用和外部Requirement全部拒绝。NFO不获得Primary Episode Claim，不要求媒体必须一集一文件。该映射是Arca内部派生结构，不新增Public Contract或领域Owner。

## 验证

专项17项通过（新增12项及原落位5项）。架构边界和语义检查通过；完整隔离Host共文件两集、逐集上限、资料/Artifact/On-deck Commit通过（36.7秒，媒体Probe为受控端口）；架构回归2,199项，2,190通过、9既有skip、0失败（97.3秒）。本次Host不等于真实FFmpeg/维修闭环验证。

日志保存在仓库外 `E:/my_project/helix-git-consolidation-20261008/series-artifact-targets-host.log` 与 `series-artifact-targets-full.log`。

## 尚未完成

映射尚未作为正式Inventory关系持久化，未接通逐集Aftercare生成/修复/提交。当前Series TextRender的精确scope门禁仍存在。后续须将Artifact Requirement与当前物理NFO关系纳入Arca Inventory revision、表示摘要及Commit原子事务，并贯穿追加/维修/Placement变化；不把未持久化派生映射当成已完成的维修能力。未执行本版本UI负责人验收、Linux、生产升级/回退或NAS部署。
