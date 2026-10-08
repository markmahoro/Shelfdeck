# Series多成品Offload合同与Promotion门禁

日期：2026-10-08；基线 `24b6577dccefdd5e15822db788dd90e7f911606f`。按用户已确认外部N:M source-to-all-final方案推进当前Phase交接工作项。

SSOT Offload目标字段现在明确按实际基数形成互斥union：单目标使用finalProductMaterialKey；2..1024目标使用finalProductMaterialKeys，UTF-8排序唯一。多目标只允许原Primary的original_input/replaced_and_settled/remove_after_place，Related、structural及carried仍是单目标语义。两种表示不能并存，多目标不能包含原source自身；不增加Owner、删除权或旧运行迁移。

正式Package与Promotion的schema生成器及生成合同同步；共享纯targets解释器校验互斥/排序/重复/基数及处置约束。Promotion对多目标逐项检查同Package中存在具备Episode Claims的Workspace Primary，拒绝缺目标、Artifact目标或Movie多目标。完整关联分量/source Claims映射仍由既有Libra替换模型及后续Assembler接线负责，不能凭schema就宣称N:M交接闭环。

15项专项通过：schema两端一致、单/多目标合法、双字段/缺字段/单元素多目标/重复/无序/Related/structural/carried/错误预期拒绝；正式Promotion拒绝缺失和非Primary目标及Movie；既有Promotion原子事务与attestation测试保持通过。日志 `E:/my_project/helix-git-consolidation-20261008/series-offload-targets.log`。P2检查首次提示SSOT sourceDocumentDigest漂移，已运行既有source-map生成器，最终完整P2通过；result-types/domain-inputs生成器已运行。包边界453文件/1429依赖、语义2071文件及diff检查通过。

持久化仍有单列final_product_material_key，Reader/Assembler和Arca仍有单目标消费点，本批未写入多目标记录或启用Coordinator外部交付。下一段补齐schema/table/完整列表写读、Assembler从全量替换映射生成交接，再让Arca逐目标现场验证且仅结算原source一次。未运行全架构、Linux/UI发布或完整外部Host，未部署NAS；Series可部署目标继续。
