# Series外部候选合并与完整终检

日期：2026-10-08；基线 `de7381774cf90f79b00a0cac1e5193d1724d77b9`。实现当前Phase外部寻源工作项，沿已确认SSOT §3.2.6关联分量替换合同。

正式Series候选Reader现在消费成功Scope Import Work的完整受验证集合，移除整个原关联分量并加入实际Workspace成员，保留范围外原候选对象。外部成员使用接受的Episode Claims，携带原Scope和source-to-all-final映射；不伪造原Run Binding。候选集合摘要绑定映射摘要。

终检以保留候选及全部外部成品共同建立完整Run空间Basis，继续按覆盖集数均分并累加part。再次从冻结Run重建Scope/映射，检查实际媒体摘要、Claims、Handle以及完整成员键集合；拒绝漏掉范围外成员、漏外部成员、保留旧part、重叠范围、过期Run、篡改媒体和不合格外部集合。普通内部加工仍检查原源Handle摘要。

专项命令：`node --test media-service/test/helix-architecture/series-external-work-scope.test.js media-service/test/helix-architecture/series-source-media.test.js`，110项通过，0失败。完整P2基线通过；包边界452文件/1428依赖，语义2070文件通过。日志 `E:/my_project/helix-git-consolidation-20261008/series-external-candidate-merge-v2.log`。

外部集合为受控Reader/正式Projection与纯验收构造的fixture，不是实际Provider或完整外部Host。Coordinator尚未触发Series外部Works；媒体不合格集合仍拒绝参与替换，外部后处理需后续接线。多值Promotion/Offload及Arca所有目标现场验证和一次源结算尚未闭环，不能启用外部交付。未运行全架构、Linux、UI或发布验证，未部署NAS。整体Series可部署目标继续。

普通Series实际隔离Host两集Direct/Remux混合上架回归通过（37.2秒），精确筛选单用例，日志 `series-external-candidate-host.log`；该测试未请求外部Provider。
