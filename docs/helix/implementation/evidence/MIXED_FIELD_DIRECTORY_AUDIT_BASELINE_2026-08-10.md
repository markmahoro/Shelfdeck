# 混乱 Material Field 全面审计基线

状态：Side baseline / non-canonical audit record
日期：2026-08-10
适用范围：Procurement、Observation、Run、Structure、Candidate、Related、Handoff A

本文件是对“乱目录”场景的全面审计结论，作为后续讨论和设计修订的基线。它不是新的 Architecture SSOT，也不是当前实施计划；如需改变已确认的业务合同，必须先修改唯一 SSOT。

## 先给结论

乱目录不需要推翻 Observation、Run 或 Execution Foundation。当前真正的问题集中在“语义分拣”这一层——有几处代码仍然把目录名、分组边界或副文件关联，当成了电影语义。

当前架构可以理解为：

    Observation：看见了哪些文件
    Run：哪些文件必须一起处理
    Structure：这些文件分别表达几个电影/剧集
    Candidate：一个候选作品是什么
    Related：哪些副文件属于哪个候选
    Handoff A：把候选作品交给 Libra

Run 不是电影，目录也不是电影。

## 已经正确的部分

| 部分 | 结论 |
|---|---|
| Observation | 扁平记录所有物理文件，不提前判断 Movie、Series、BDMV、Related，这是正确的 |
| Run Creator | 同一直接父目录作为不可拆分批次，是安全边界，不等于一个 Candidate |
| BDMV | BDMV 容器和 CERTIFICATE 作为一个 Scope，一个 Assessment，一个 Candidate，方向正确 |
| Structure | 普通可播放文件可以各自产生 Candidate，Series 再按规则合并，方向正确 |
| Related 时机 | 在 Candidate Assembly 根据冻结 Observation 重建 Related，不需要提前把所有副文件塞进 Structure |
| Foundation | 当前资源调度、Event Runtime、Permit、Retry 不需要因为乱目录而改变 |
| Handoff A | materialInputForm、Primary Manifest、Related References 的输出形态基本正确 |

Run Creator 的正式约定参见 [SSOT Run Creator 部分](E:/my_project/emby_third_party-helix-retake/docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md:4869)，当前实现参见 [procurement-run-creator.js](E:/my_project/emby_third_party-helix-retake/media-service/src/helix/domains/procurement/model/procurement-run-creator.js:61)。

## 必须修正的问题

### 1. 普通多电影目录的标题会错

例如：

    Z:\Film\未整理\
      电影A.mkv
      电影B.mkv
      电影A.nfo
      poster.jpg

当前代码优先使用父目录名：

    directoryTitle → parentSegments → baseName

因此两个 Candidate 可能都显示成“未整理”，而不是“电影A”和“电影B”。

当前规则在 [triage-contracts.js](E:/my_project/emby_third_party-helix-retake/media-service/src/helix/domains/procurement/model/triage-contracts.js:136)，SSOT 也明确写成了 directory_title → filename_title，参见 [SSOT Identity 规则](E:/my_project/emby_third_party-helix-retake/docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md:9999)。

这不会导致两个 Candidate 合并，但会导致：

- 用户看到重复标题；
- Candidate 的 Identity Claim 质量很差；
- Libra 收到的 Handoff A 标题不可靠；
- 后续 Provider 查询可能使用错误标题。

另外，Field 根目录下的单个文件可能把合成目录名“.”当成标题，这也是一个具体边界问题。

调整建议：

- BDMV：使用外层容器目录名；
- 普通 Movie/JAV/Western：同一直接父目录只有一个 Primary 时，可以使用目录名作为候选证据；
- 同一目录有多个 Primary 时，必须优先使用文件名；
- Series：使用文件名去掉 Episode 标记后的标题，父目录只参与分组；
- 根目录文件不能使用“.”作为标题；
- 目录名继续保留为 directory_title Evidence，但不再无条件成为最终显示名。

这需要先修订 SSOT 的 Identity Rule，再改代码。

### 2. Series 可能跨目录错误合并

当前 Series 合并键主要是：

    claimedTitle + seasonClaim

见 [triage-contracts.js](E:/my_project/emby_third_party-helix-retake/media-service/src/helix/domains/procurement/model/triage-contracts.js:712)。

但 SSOT 要求 Series 还必须有稳定的父目录分组。当前实现没有把父目录纳入合并键，因此这种目录可能被错误合并：

    A/Show.S01E01.mkv
    B/Show.S01E02.mkv

如果标题和 Season 一样，它们可能被拼成一个 Season Candidate，但实际上来自两个不同的物理分组。

调整建议：

    Series Unit Key =
      fieldId
      + stable parent scope
      + claimed title
      + season claim

同一目录下的同一 Series Season 可以合并；不同目录下即使标题一样，也不能仅凭标题合并。后续 Libra 可以通过正式 Subject Continuity 继续判断是否属于同一个 Series Subject。

这是当前实现偏离 SSOT 的明确问题。

### 3. Generic Related 会被多个电影重复引用

例如：

    未整理/
      电影A.mkv
      电影B.mkv
      poster.jpg
      fanart.jpg

当前 Candidate Context 会把 poster.jpg、fanart.jpg、movie.nfo 这类通用名字视为标准 Sidecar。由于 A 和 B 都在同一个 Related Scope 中，这些文件可能同时被写入两个 Candidate Package。

当前逻辑在 [procurement-candidate-context-reader.js](E:/my_project/emby_third_party-helix-retake/media-service/src/helix/domains/procurement/persistence/procurement-candidate-context-reader.js:190)。

更严重的是，当前代码对 .srt、.ass、.mka 等扩展名也存在“没有同 stem 仍然可以关联”的路径。这会导致：

    电影A.mkv
    电影B.mkv
    字幕.chs.srt

这份字幕可能被两个 Candidate 都引用。

SSOT 允许 Related 歧义不阻塞 Candidate，但这不等于可以把一个无法确认归属的通用文件自动复制给所有 Candidate。

调整建议：

- 同 stem 的副文件确定性关联：
  - 电影A.mkv
  - 电影A.nfo
  - 电影A.zh.srt
  - 电影A-fanart.jpg
- 通用文件只在 Scope 内只有一个 Primary 时自动关联：
  - poster.jpg
  - fanart.jpg
  - movie.nfo
- 同一个 Scope 有多个 Primary 时，通用文件保持未确定，不关联到任何 Candidate；
- 字幕、外部音频、章节也必须优先要求同 stem；
- 歧义不阻塞 Candidate，但要保留可重建的关联 Evidence。

BDMV 也使用同样规则：

- 一个 BDMV 容器只有一个 Candidate 时，外部 poster.jpg 可以关联；
- 同一外层目录存在多个 BDMV 容器时，通用图片不能自动分配给所有容器；
- BDMV 内部 M2TS/MPLS/CLPI/index/MovieObject 永远不能成为 Related。

### 4. Primary 和 Related 的 Eligibility 边界还不够清楚

当前 ExtractionPolicy.allowedExtensions[] 允许用户配置任意扩展名。理论上如果用户配置：

    .mkv
    .nfo
    .jpg
    .srt

这些文件都可能进入 Eligibility，进而进入 Run。

当前默认 Canary 只允许视频和原盘结构扩展，所以问题没有在默认测试中暴露。但从合同看，.nfo、.jpg、.srt 仍可能被当成候选输入。

这会造成：

- 无意义的 Media Probe；
- Sidecar 被错误地取得 Control；
- Run 中混入本应只是引用的文件；
- 大量 probe_not_media 噪音；
- BDMV 结构成员是否能进 Run 依赖用户手动配置。

调整建议：

Observation 仍然观察全部文件，但角色分开：

    Observation Entry
    ├─ primary-capable：可能成为主视频
    ├─ structural-only：BDMV/DVD 必要结构文件
    └─ related-only：NFO、图片、字幕、外部音频、章节

建议把 allowedExtensions 的语义明确为“Primary/结构候选范围”，并规定：

- Related-only 扩展永远不能单独进入 Run；
- BDMV 必要结构成员由容器 Scope 自动纳入，不要求用户手动把 .mpls/.clpi/.bdmv 加进策略；
- Related 只通过 Observation Scope 被引用，不取得独立 Procurement Control。

这属于 SSOT 合同补充，不一定需要新增表。

### 5. 路径大小写处理存在跨平台风险

当前多个位置对路径直接 toLowerCase()，例如：

- triage-contracts.js；
- procurement-candidate-context-reader.js；
- procurement-run-triage-reader.js。

而 SSOT 对 Linux 路径要求大小写敏感，只有扩展名和 BDMV 标记允许有限的 ASCII case-fold。

可能出现：

    A/Movie.mkv
    a/Movie.mkv

Run Creator 把它们视为两个目录，但 Structure/Related 查询又可能把它们合并到同一个 Scope。

调整建议：

- 普通目录路径保留原始大小写；
- Digest 使用大小写敏感的规范化路径；
- 只有 BDMV、CERTIFICATE、扩展名按合同做大小写不敏感匹配；
- Windows 文件系统不区分大小写，不能因此把长期业务 Identity 也统一小写。

这是中优先级，但应在正式封口前解决。

### 6. Observation Scope 的 4096 上限没有被 Run Creator 保证

当前 Planner 在一个 Structure Projection 中汇总多个 Scope，并硬性限制 entries.length <= 4096，见 [evidence-assessment-planner.js](E:/my_project/emby_third_party-helix-retake/media-service/src/helix/domains/procurement/planning/evidence-assessment-planner.js:305)。

但一个 Run 可以包含：

- 多个普通目录；
- 多个 BDMV 容器；
- 每个容器最多 1024 个结构成员；
- 每个目录还有大量 Related 文件。

当前 Run Creator 没有证明这一整批 Scope 一定小于 4096 条。因此一个业务上合法的 Run 可能只是因为投影太大而失败。

调整建议不是把上限无限调大，也不是任意按字节切片，而是：

- 按完整普通目录 Scope 分页；
- 按完整 BDMV 容器 Scope 分页；
- 不拆普通目录组；
- 不拆 BDMV 容器；
- 每个 Structure 输入只携带完整业务 Scope 的引用；
- Scope 内部成员从 Observation 事实重建。

也就是按业务边界分页，不是按 JSON 字节切碎。

### 7. BDMV 的多个上限目前没有完全统一

当前合同中同时出现过：

- 普通 Run：256；
- BDMV 容器：1024；
- Observation Scope：4096；
- 某些 Manifest/旧 Layout 合同：4096 或 256。

当前运行代码实际主要按 BDMV 1024 执行，但 SSOT 和历史合同还有残留不一致。

当时的清理建议是：

- 普通目录组：最多 256 个物理成员；
- BDMV 容器组：最多 1024 个物理成员；
- Structure 输入：按 Scope 分页，不再使用一个笼统的 4096 总量保证；
- 单个 Candidate Manifest 的 BDMV 成员上限与 BDMV Run 上限一致，统一为 1024。

这属于合同清理，不是运行时性能优化。

## 当前“乱目录”下建议的完整行为

例如：

    Z:\Film\未整理\
      电影A.mkv
      电影A.nfo
      电影A.zh.srt
      电影B.mkv
      poster.jpg
      fanart.jpg

    Z:\Film\未整理\电影C\
      BDMV\...
      CERTIFICATE\...
      fanart.jpg

正确链路应该是：

1. Observation 记录所有文件；
2. Eligibility 只把可作为 Primary 或 BDMV 结构成员的文件纳入处理；
3. Run Creator：未整理是一个普通目录批次；电影C 是一个 BDMV 容器批次；Run 批次不等于电影；
4. Structure：
   - 电影A.mkv → Candidate A；
   - 电影B.mkv → Candidate B；
   - BDMV 容器 → Candidate C；
5. Candidate Context：
   - 电影A.nfo、电影A.zh.srt → A；
   - poster.jpg、fanart.jpg 如果同 Scope 有多个电影，则不自动分配；
   - BDMV 外部 fanart.jpg 如果该容器唯一，则关联 C；
   - BDMV 内部文件只能进入 C 的结构成员；
6. Handoff A：
   - 每个 Candidate 都有自己的 Display Identity；
   - materialInputForm 分别为 stream_file 或 bdmv；
   - Related 只包含确定性引用；
   - 不因为缺少或歧义的 Related 阻塞 Candidate。

## 建议的修复优先级

### P1：必须先修

1. Scope-aware Display Identity；
2. Series 合并键加入稳定父目录；
3. Generic Related 与任意 sidecar 的歧义处理；
4. Primary / Structural / Related Eligibility 边界。

### P2：随后修

1. 路径大小写规范；
2. Scope Projection 按业务边界分页；
3. 统一 256/1024/4096 合同上限；
4. Admin Web 明确区分 Run、Candidate、Unassigned、Ambiguous Related。

## 当前不需要改

- Execution Foundation；
- Event Runtime；
- Resource Governor；
- Observation 全量扫描模式；
- BDMV 专用 Assessment；
- Candidate Assembly 三事件结构；
- Handoff A 的总体边界。

本次审计只记录问题，没有继续修改代码或 SSOT。后续应先把上面四个 P1 项返回 Design，特别是标题规则和 Related 歧义规则确认后，再实施代码与混乱目录专项 Fixture。

## 后续讨论结论：Scope 类型与标题输入

日期：2026-08-10
状态：讨论结论，尚未写入 Architecture SSOT 或当前实现

在一个混乱的 Material Field 中，一个 Run 可以同时包含多种物理 Scope：

    Run
    ├─ single_material：Field 根目录下的单个裸文件
    ├─ ordinary_directory：一个普通子目录及其成员
    └─ bdmv_container：一个完整 BDMV 容器及其 CERTIFICATE/BDMV 成员

Run Creator 在形成不可拆分 Scope 时，应将 Scope 类型作为冻结输入的一部分。推荐的紧凑 Scope Reference 至少包含：

    scopeKind
    scopeKey
    scopeRelativeLocation
    memberCount
    memberSetDigest

这不是新的业务对象，也不是 Primary/Related 判断。它只是 Run Creator 对物理分组边界的正式记录，使下游 Structure 不必重新从路径猜测分组。

Structure 根据 scopeKind 选择标题证据，但普通目录 Scope 不能无条件使用目录名：

| Scope 类型 | 标题策略 |
|---|---|
| single_material | 使用文件名去扩展名 |
| ordinary_directory，最终只有一个 Primary | 可以使用目录名 |
| ordinary_directory，最终有多个 Primary | 每个 Primary 优先使用自己的文件名；目录名只作为分组 Evidence |
| bdmv_container | 使用外层容器目录名，不使用 BDMV/CERTIFICATE 名称 |
| BDMV 直接位于 Field 根目录 | 不得把 Field 根目录名作为标题，必须使用明确的 fallback |

因此，标题链路为：

    Run Creator：冻结 scopeKind 与 Scope Reference
    Structure：根据 Scope 类型及其中 Primary 数量确定标题证据
    Candidate Assembly：根据最终 Primary 重建 Related

例如，普通目录中同时存在 电影A.mkv 和 电影B.mkv 时，两者可以属于同一个 ordinary_directory Scope，但应产生两个 Candidate，并分别优先使用 电影A、电影B 作为标题；不能让两个 Candidate 都使用目录名。

该结论只记录为后续 Design 讨论基线。正式实施前仍需修订 SSOT、Run Selection/Execution Basis 输入和相关测试；当前代码尚未按本结论修改。
