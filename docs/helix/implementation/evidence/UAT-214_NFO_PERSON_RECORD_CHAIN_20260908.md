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
