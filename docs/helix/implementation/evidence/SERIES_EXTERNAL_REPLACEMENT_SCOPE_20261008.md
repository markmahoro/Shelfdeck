# Series外部替换范围与完整映射模型

日期：2026-10-08；基线 `b97505ca62c07a5b9213406cbef55803205fa6b8`。用户已明确确认按关联范围整体替换、各原文件记录全部对应新文件的方案。本批在SSOT §3.2.6记录该决定，并建立Libra内部纯模型；未启用新的外部获取、未增加跨Domain副作用，未部署NAS。

`series-external-replacement.js`从Owner提供的完整冻结Primary/Episode投影构造Basis，绑定Run、execution basis、Acceptance Spec和全部成员摘要。由待替换成员求完整二部图连通分量，同Episode的所有part及共文件关联的Episode递归收齐；不同分量分别返回，未关联成员保留。Scope身份与seed顺序或同分量内具体seed无关，源集合/Run/Spec变化均产生不同身份。

最终映射只接受精确、完整、未被改写的单个Scope；外部Workspace成品不能复用任何原集合materialKey，不允许重复、越界或漏集。每个原文件映射到全部与其Episode Claims相交的成品，包括分集、共文件或新part；完整最终成员摘要和全部source-to-final keys进入mappingDigest。该模型不自行读取Provider/文件，不生成Actual Episode Evidence，不授权删除，也不取代完整成品验收。

验证：新增7项覆盖多跳闭包、独立分量、64成员链、确定性、完整Basis漂移、单源多成品/多源共成品、伪造Scope（重算digest也拒绝）、漏集/额外集/重复物理成员/旧key复用及缺失源覆盖。与现有外部pipeline合同共17项通过，日志 `E:/my_project/helix-git-consolidation-20261008/series-external-scope-contracts.log`。架构450文件/1413依赖、47包和语义2068文件/42豁免均通过；无全量平台或真实Provider测试结论。

下一步仍是正式接线：把Scope绑定外部Work/Query及实际取得Episode Evidence；把目前单值OffloadContext映射传播为Series精确多值schema/持久化/Promotion/Arca最终现场校验/逐原文件结算，保留Movie单成品合同；然后完整混合候选终检和真实Host恢复。当前模型尚无生产调用方，不能宣称Series外部寻源已打通或可部署。UI精确版本负责人、Linux、升级回退等Phase Gate继续。
