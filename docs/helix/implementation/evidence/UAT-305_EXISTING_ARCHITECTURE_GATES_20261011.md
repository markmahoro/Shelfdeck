# UAT-305：Series既有架构门禁失败

2026-10-11 UAT-284最终验证发现实际全仓扫描未通过。用git archive导出修复前dc2dd653e的media-service/src/helix到仓库外，只读扫描后按相对路径/code/specifier比较，与当前8项package findings完全一致；manifest扫描也同为table-inventory的INVALID_MANIFEST_ENVELOPE。不是本轮新增，但必须保持开放，不能拿Guard自身单元测试通过替代实际仓库扫描。

8项导入问题：contracts/related-primary-mappings.js引用未允许的node:path；Arca capabilities/on-deck-capability-ports.js和persistence/on-deck-store.js引用application/read-control-projections；planning/aftercare-projections.js引用persistence的inventory-verification-store与staged-manifest-store；planning/on-deck-projections.js引用这两者及acceptance-check-evidence-store。应按原Owner/分层合同调整实际依赖，不能扩大policy白名单或把业务事实迁移到其他Owner。

另manifest-validator拒绝table-inventory envelope，P2完整typed/table合同检查通过；须核对通用manifest要求与当前表清单，不能直接降低校验。日志uat284-package-baseline/final.log、uat284-manifest-baseline/final.log保存在仓库外预览目录。本项只登记及证明基线，尚未实施修复，不改变UAT-284的隔离验收范围或关闭Series整体资格。
