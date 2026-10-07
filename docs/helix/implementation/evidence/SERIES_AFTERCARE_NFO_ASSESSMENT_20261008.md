# Series Aftercare NFO完整性评估

2026-10-08；关联Series Phase节点4展示维护，未部署NAS。

## 已修正

Presentation原先只要求Inventory里任意一个NFO可读，Season NFO存在会掩盖后续Episode文件丢失或空文件。现在Series检查当前Inventory登记的全部NFO，分别归集缺失与不可读条件，Finding摘要绑定完整受影响物理成员与Binding，不以文件遍历顺序改变结果。沿既定存在、非空、可读口径，外部纯文本和超过生成器解析预算但可读的文件仍接纳，不把内容/XML差异当损坏。

Custody/Presentation不再为Series NFO缺陷声明现有单NFO renderer可自动修复。TextRender入口在已有Case准入后、Workspace创建前明确拒绝缺少精确Artifact目标的Series请求；Movie保持原选择和修复行为。这是防止错误文件被修复的实现中间门禁，不能算Series NFO维修交付，也不能用attention_required替代首版必需的逐集维护能力。

## 验证

新增11项：全部登记文件可读、后集缺失/空/目录、多个条件、受影响集合摘要与顺序稳定、无NFO、外部文本/较大文本、Movie保留、Custody区别、正式Presentation入口与TextRender写入前拒绝。全部Aftercare命名测试225项通过、0失败/跳过；另与UAT-251修复准入等53项重叠回归通过。旧源码位置断言已随函数提取调整；未削弱分类和只读保证。架构边界/语义/diff检查通过。

日志：仓库外 `E:/my_project/helix-git-consolidation-20261008/series-aftercare-nfo-tests.log`、`series-aftercare-nfo-regression.log`。

未执行本版本全架构、完整Host/真实Series维修、UI负责人验收、Linux或构建发布。检查范围为当前Inventory已登记的NFO，不把文件名解析当正式Episode关联；On-deck Artifact Requirement已验证的完整性仍是入库前提。

## 必须继续完成

现有修复链的ArtifactProfile没有Episode目标，TextRender选一个现有NFO、输出movie.nfo，ArtifactOutput按outputKind从Work选一个Result，Materialize和Inventory变更也有单NFO假设。下一批需要使Arca保留并重建已接受Artifact Requirement到正式Inventory成员的精确关系，将目标scope贯穿Planner/Projection/Result、逐NFO生成、Materialize、Inventory原子提交与结算，并验证第二集缺失时其他Episode及Season文件不变。不得以文件名猜集、跨域读取Libra内部Store或给NFO伪造Primary Episode Claim替代该关系。
