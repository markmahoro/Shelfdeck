# Series Provider搜索覆盖证据

日期：2026-10-08；实现基线 `93db4ce20d64afaf876f2e2c350855ac23875c22`。当前Phase外部寻源工作项，沿SSOT §3.2.6真实Evidence要求修复适配器；不新增Owner或副作用授权。

发现MoviePilot候选曾直接使用Query的requestedEpisodeKeys及期望seasonNumber，使缺集或错误季资源获得伪造匹配声明。现从Provider的meta_info明确begin_season/end_season、begin_episode/end_episode及total字段投影实际范围；缺失季号、跨季、未知/超界集范围、矛盾total/type不能成为可用候选。缺集候选保留实际Episode keys，不填补请求中的集。Series仅当Provider身份/季号及完整Episode集合匹配时可用。

下载提交前重读同一Provider候选，重新验证可用性、实际身份与冻结Selection覆盖；错季/缺集等变化在下载POST之前拒绝。Movie既有路径保持。此处是Provider搜索声明，仍不能替代Landing中每个实际文件的覆盖与Package Verification。

字段依据于2026-10-08读取的上游源码：[MetaBase](https://github.com/jxxghp/MoviePilot/blob/main/app/core/meta/metabase.py)的明确begin/end/total字段和to_dict输出；[MetaInfo](https://github.com/jxxghp/MoviePilot/blob/main/app/core/metainfo.py)的元数据构造。适配器不自行解析种子文件名补充未知季集，不把上游缺失季的默认S01当明确证据。

验证：正式隔离配置/Secret lease/P5 Provider端口使用受控HTTP响应，正确两集范围搜索/提交通过；缺集、无明确集号、错误季、跨季、257集、矛盾总集数/总季数/类型均不可提交，断言下载POST计数不增长。完整p14-h1-provider-integrations.test.js 21项通过，0失败（约26秒），覆盖原Movie请求恢复及其他Provider回归。日志 `E:/my_project/helix-git-consolidation-20261008/series-provider-regression-v2.log`。P2合同、包边界452文件/1428依赖和语义2070文件通过，diff检查通过。

未执行真实MoviePilot网络/下载。Landing仍需支持多文件和逐文件Claims、稳定性重验；整包大小不能直接替代逐集实际大小，后续Series搜索媒体空间评估亦需核对。Coordinator、多值交接/Arca结算、真实外部Host与发布Gate继续。未运行全架构/Linux/UI发布验证，未部署NAS。
