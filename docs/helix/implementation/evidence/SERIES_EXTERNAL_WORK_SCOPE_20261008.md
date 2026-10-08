# Series外部Work范围接线

日期：2026-10-08；基线 `5047a5d06c6512a709826575808ee22f07984919`。沿用户已确认的N:M替换范围和SSOT §3.2.6继续推进，不改变Owner或开启生产动作。

既有External Supporting Work构造现在对Series强制接收当前冻结Run重建的完整关联分量，Work ID、basis ID/digest、idempotency key、concurrency scope及search→acquire→import依赖均绑定scopeDigest。Movie仍使用原身份公式和Run execution basis，不能携带Series范围。Scope来自全部原Primary/Claims及Spec，不从文件名或Provider返回值推断。

正式External Planner已使用同一范围枚举识别请求，重建唯一匹配Work后才规划。Search ProductStructure和获取后Package Verification的EpisodeDelivery只使用范围内原始Claims，缺失/重复Claims拒绝；两个Projection的名义对象ID也绑定Scope。Acquire读取同范围Search Work，Query的Run、结构摘要及Episode集合必须精确匹配范围，不能把其他范围结果当作当前输入。模型已从纯叶子接入生产Planner；Run Coordinator何时触发外部替换、多成员Import/最终Selection及多值Offload/Arca结算尚待完整接线，本批不宣称可执行端到端外部Series旅程。

验证：新增4项Work/Planner测试验证阶段身份和依赖、跨范围及Spec漂移拒绝、Movie历史身份公式、原Claims投影和缺失拒绝、正式Search/Acquire Planner范围输入与错误Query拒绝。与模型及既有外部pipeline共21项通过；加入schema/manifest相关检查后34项通过（`series-external-work-final.log`，19.9秒）。正式隔离Series两集Host从Field到Direct On-deck Commit 36秒通过（`series-external-work-host.log`），检查现有Series流程未被Planner识别改动打断。该Host没有执行实际外部Provider请求；Planner专项使用受控Reader/registry fixture。

完整P2基线检查首次发现SSOT新段落导致source-map定位与派生合同摘要陈旧，包含上批模型提交尚未同步的生成数据。已依次运行既有source-map/shared-types/result-types/domain-inputs/capability-contracts/table-contracts/transaction-contracts生成器；P2合同检查通过（113 capabilities、99 result families、197 tables、45 transactions、31 shared types、120 domain inputs、0 unresolved refs）。独立逐JSON比较确认410个生成文件只改source/sourceLocator行号及派生摘要，不改字段或业务合同内容。包边界450文件/1413依赖、语义2068文件、Manifest检查通过；首次失败日志 `series-external-work-guards.log` 和最终基线 `series-external-work-contract-baseline.log` 保留于 `E:/my_project/helix-git-consolidation-20261008/`。

未运行本批全架构/Windows全构建/Linux/UI发布验证；未部署NAS。下一段继续多成员导入、真实Episode覆盖、完整混合终检及多成品交接/现场验证/结算与恢复，原Phase Gate保持开放。
