# UAT-217 正式身份评分与Acceptance重算

2026-09-08。本地实施，尚未生产部署或关闭。关联UAT-060/079与历史BR-01。

## 根因及边界

clean-service-host的Subject评分Target始终从Candidate Claim取名称，即使Libra已有持久Product Identity，仍把带版本后缀的旧名交给Perception。正式身份生产完成后也没有在继续生产前等待当前评分/Acceptance重算。

Libra公开Target改为读取已提交Identity，校验display record及当前identity digest；Movie使用正式title、已有year及真实TMDB anchor。原Claim不改，没有Provider anchor时不伪造。查询与Admin Target继续共用同一Projection。

Product Identity提交后，Coordinator通过既有Acceptance Spec Coordinator等待Perception Resolution；只在semantic specDigest变化时交回既有Run Creator接续。身份revision变化但评分结果不变不触发重做。SSOT 5.6.3已补此约束，Owner和业务交接不变。

## 验证与剩余

- 17项定向测试PASS：弱到正式目标、真实Provider/year、摘要损坏拒绝；既有Spec输入测试证明身份变化不改变语义输入、同评分不同来源不改变要求、评分变化会改变输入。
- 首轮219个architecture fixture文件与全部Gate PASS；最终复跑全部静态Gate通过；219文件并行回归有1项service health timeout，单独复跑该入口文件14 PASS/3 SKIP（启动/认证/关闭通过）。未把超时隐藏为全套PASS。
- 未用生产Reset验证；旧冻结Run保持原状态。仍缺真实评分命中、具体Acceptance要求变化、合法Run replacement及最终上架全链路，不能据上述模型测试关闭。


后续服务全量回归识别并修复异步续跑缺口：正式身份触发的新Perception Resolution返回相同5星/相同Acceptance要求时，不生成新Spec Work，原Run等待缺少完成唤醒。Perception完成通知只针对该Subject调用既有Libra Acceptance/Run Creator/Run Coordinator；是否替换仍由Libra按合同决定。原外部寻源全链路用例独立重跑仍失败，修复后约4秒通过，验证100候选选择后的实际媒体拒绝保持原有限停止规则。未用延长超时或Reset掩盖问题，未移动评分/Spec归属。此前架构门禁不足以发现此跨事件缺口，发布必须包含本次修正。
