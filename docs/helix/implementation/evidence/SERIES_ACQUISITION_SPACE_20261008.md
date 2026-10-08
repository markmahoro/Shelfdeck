# Series搜索逐集空间与获取准入

日期：2026-10-08；基线 `b3f1d3d563b24206a443d1b217109411ee463e1e`。当前Phase外部寻源工作项。

复核发现整包size被直接与单集上限比较，误判多集包逐集超限；缺失size又经Number(null)变为0。适配器现保留真实整包广告字节，null/undefined/空字符串/布尔值归unknown；多集整包超过单集上限只说明分配未知，不断言实际最大集份额超限。整包不超过单集上限是保守充分条件，不按集数简单平均以伪造成品结论。

用户在本轮明确确认：其他条件合格，仅逐集大小未知的Series候选可进入一次外部获取，导入后按实际Claims逐集验收，超限加工或明确失败。已回写SSOT §8.6外部获取Candidate Select段。共享acquisition-feasibility仅对season、多集、明确Series身份、已知有效整包大小及唯一size_unknown原因开放例外；缺总大小、其他unknown/gap、Movie、单集或缺身份不由此放行。原唯一候选/不轮换策略和最终Spec不变。

正式候选选择和下载前P5复验均消费相同准入解释。Provider受控网络测试通过：150字节两集包、每集100字节，保存整包150且assessment unknown，正式Libra Select选择后P5提交一次；100字节包compliant；缺大小不能选择；Movie/单集/缺身份/额外音轨或编码缺口不适用例外。非真实服务下载，未证明完整外部生产链路。

验证：p14 Provider与p9外部流水线33项通过/0失败（28.1秒），随后强化正式Select的专项通过。日志 `E:/my_project/helix-git-consolidation-20261008/series-provider-size-approved.log`、`series-size-selection.log`。P2基线通过，SSOT本次在原段落同行补充，无schema字段变化或生成合同定位漂移；包边界452文件/1428依赖和语义2070文件通过。

Coordinator/外部媒体后处理、多值Promotion及Arca结算、完整外部Host仍待闭环。未运行全架构、Linux/UI发布验证或真实MoviePilot，未部署NAS，整体Series可部署目标继续。
