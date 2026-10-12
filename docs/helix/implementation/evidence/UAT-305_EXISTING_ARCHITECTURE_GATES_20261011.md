# UAT-305：Series既有架构门禁失败

2026-10-12收口：实际package、语义、manifest及合同扫描均通过，本项原8处依赖及1处清单缺陷按自身条件关闭。第二轮全量fixture为2485通过、2失败、12skip；仅剩P7 Governor测试替身遗漏UAT-304新增abandonWaiters方法。补齐无waiter替身后，p7-field-observation完整文件14项通过。未再次运行全套，不将分段复验描述成一次全量PASS。Service601通过、0失败、28skip。日志architecture-v2与p7-final保留于忽略目录；生产仍因UAT-293不能升级。

2026-10-12后续修复：`relatedPrimaryName`的路径解释移入Arca model；Control批读移入Arca persistence；planning通过public composition注入的同Owner不可变Evidence Reader重建完整记录，移除反向层级依赖。table materializer同步生成registry的实际entryCount=200，未放宽package policy、Result上限或manifest校验。

首次全量实际扫描package/manifest/contracts均通过；fixture为2471通过、8失败、12skip。失败分别为伪造旧schema混入新表、容量旧断言、过时合同摘要/历史见证变更列表及Stage负向测试缺少冻结Slot。已改用有来源commit及SHA256的历史DDL快照，不为通过测试修改运行时迁移；保持历史见证字节不变并显式断言当前合同漂移。原8失败涉及的179项回归全部通过，实际全量门禁重跑中。Windows原专项86及Owner32项通过；Linux相关合同/Owner回归通过。不能以这些定向结果宣称全量门禁最终通过。

## 2026-10-12 生产升级前复验

用户已明确授权升级NAS生产；剧集Shelf及Material Field由用户升级后配置，本次不创建。待发布源码HEAD为`eb56ef6f1`，检查前工作区干净。实际执行`checkPackageBoundaries`及`validateManifestSet`：扫描467文件、1530依赖、47包，仍为下述8项依赖违规及`table-inventory.json`的`INVALID_MANIFEST_ENVELOPE`，进程退出1。没有运行完整架构fixture suite，不声明其他门禁通过。

按PRODUCTION_DEPLOYMENT的失败停止规则，本次停在发布前检查，未构建/上传/apply，未停服、Reset或修改生产数据；完整备份、生产副本Host升级及回退演练尚未执行。部署授权持续有效，但UAT-305未修复，不能绕过门禁发布。

fnOS技能只读preflight通过：SSH身份gezhu、主机303NAS，根目录root:root/755，Docker28.5.2、Compose2.40.3，`/vol1`剩余49G、使用72%。实时inspect确认生产仍为`markmahoro/shelfdeck:helix-beta-20260930-8e197b3c36`，Image ID `sha256:168be0bb2101b79424f7f978c32d3724852eb5267b2234a4c981c22fe075ac2b`，StartedAt `2026-09-30T08:26:54.92134126Z`、RestartCount0；health为`ok`且`normalSupplyAllowed=true`。本轮未核验业务计数、媒体盘容量或未完成任务范围。

2026-10-11 UAT-284最终验证发现实际全仓扫描未通过。用git archive导出修复前dc2dd653e的media-service/src/helix到仓库外，只读扫描后按相对路径/code/specifier比较，与当前8项package findings完全一致；manifest扫描也同为table-inventory的INVALID_MANIFEST_ENVELOPE。不是本轮新增，但必须保持开放，不能拿Guard自身单元测试通过替代实际仓库扫描。

8项导入问题：contracts/related-primary-mappings.js引用未允许的node:path；Arca capabilities/on-deck-capability-ports.js和persistence/on-deck-store.js引用application/read-control-projections；planning/aftercare-projections.js引用persistence的inventory-verification-store与staged-manifest-store；planning/on-deck-projections.js引用这两者及acceptance-check-evidence-store。应按原Owner/分层合同调整实际依赖，不能扩大policy白名单或把业务事实迁移到其他Owner。

另manifest-validator拒绝table-inventory envelope，P2完整typed/table合同检查通过；须核对通用manifest要求与当前表清单，不能直接降低校验。日志uat284-package-baseline/final.log、uat284-manifest-baseline/final.log保存在仓库外预览目录。本项只登记及证明基线，尚未实施修复，不改变UAT-284的隔离验收范围或关闭Series整体资格。
