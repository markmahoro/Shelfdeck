# UAT-214 NFO人物观察与确定关联记录链路

## 合同与现状

依据唯一SSOT 6.6.2.1：Arca只读取当前Inventory声明的NFO并发布只读Evidence；People仅消费Projection并拥有人物注册；Arca独立记录更新发布新的Media-Cast/Inventory revision，不创建Case、不改写NFO，不更改Primary/Material Control/Canonical Identity。允许关联的证明只有exact provider/namespace/key唯一active Person、用户接受Candidate的exact origin evidence、正式Merge correlation。姓名/alias近似不够。

原实现只有NFO文件身份记录刷新与既有Inventory relation分页，未形成NFO解析→People→关联记录更新。不能用旧NFO指纹能力或People已注册数量代替关闭证据。

## 已实现的观察半链（221文件架构全门禁通过）

- 复用安全Movie NFO parser，单文件256 KiB、最多256演员，拒绝DTD/损坏XML/越界，不发布部分演员；TMDB编号为Provider Identity，不当作本地Person ID。冲突/非法编号保留弱Evidence。
- Arca分页只列Entry范围；读取在单Entry reconcile内进行，最多16个当前声明NFO、总256演员，不扫描目录/读取Primary。读后复核Entry active与Inventory revision，过时结果不发布。
- People通过独立技术游标消费Arca Projection，强身份走既有规则注册、弱身份走既有Registration Candidate，不接触Material Binding。
- 10分钟同Inventory观察复用、256 Entry缓存上限；Inventory revision变化立即重读。NFO内容Evidence摘要不依赖无关Inventory revision，避免相同字节在记录更新后重复开启弱Candidate；缓存丢失仅重复观察，不改变事实。
- 解析与已有NFO回归19项通过；Projection→真实People Store、revision重读/同内容去重及过时抑制12项通过。

## 剩余验收闭包

补People精确关联只读证明与Arca关系记录更新事务：原关系、当前Inventory、Person proof在提交前复核，关系修正不要求NFO Binding变化，不改变媒体文件/Control。覆盖强身份、用户接受exact origin、merge、同名不关联、冲突不关联、旧revision拒绝、重放不重复与零Case；再验证完整后台游标发现及生产已知记录场景。仅观察半链不关闭UAT-214。


## 确定关联与记录提交的本地实现

People新增只读Media-Cast Reference Query，exact namespace/key唯一active命中、user-accepted Candidate exact origin、正式Merge链（有界16跳/拒绝循环）三条路径，保留Person revision/factDigest/inputDigest/proofDigest。已有active personId不以新名字或其他Provider改绑；跨Provider冲突不任选一个。

Arca在健康周期内执行独立关系记录命令，每批最多64个变化、最多4096当前关系；在自身事务前重读People证明，Receipt保留不可变revision/digest，未来Merge独立再观察，不将两个Business Owner放入同一事务。Arca提交精确当前Inventory/Basis、原relation digest与Proof输入，只有personId/relationDigest变化，其他已接受关系字段/媒体/Binding/Control/Canonical Identity保留。active Case或Off-deck阻止；正常健康记录更新不创建Case。旧queued Case若Basis已变，保留invalidated历史并由实际修复需求重新评估。

既有45个Canonical Transactions不增加：Inventory Record Refresh Commit增加精确`arca.inventory.person-records.refresh@1`变体，不写Control。SSOT及生成合同同步，113 Capability/99 Result family/187 tables不变。聚合合同摘要f6ff4ca4b9c00be414f7689ecf1d8ea806a3bccd6e1db4a0fce7fae14ccc0256。

18项People/关系提交针对性测试通过，真实NFO→真实People Store→Arca关系revision链路8项组通过；覆盖不改原姓名/NFO、零Case、摘要伪造回滚、旧revision拒绝、重放原Receipt。222文件架构及其余四门禁通过。最初默认并发下Entry启动deadline一次超时，独立14 PASS/3 SKIP；架构runner固定并发4后222文件全部通过，未延长服务或FFmpeg生产超时。另补active Case/Off-deck人物记录变体fence测试。

关闭前仍需后台周期实际驱动和部署后限定场景验证，尤其已有弱Candidate随Inventory变化的exact origin条件逐项核对；不能拿本地直接调用命令替代全部运行验收。
