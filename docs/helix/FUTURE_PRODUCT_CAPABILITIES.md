# Helix Post-Beta Product Capability Reservations

Status: `NON-CANONICAL / DEFERRED / NOT_BETA / NOT_IMPLEMENTATION_AUTHORIZATION`

Last updated: 2026-07-18

## Purpose

本文只记录已经明确有用户价值、但不进入当前Beta合同的后续能力。它不是架构SSOT、活动计划、Capability
Catalog或实现授权；任何条目落地前都必须在新的SSOT revision中重新完成Owner、Capability、API、Recovery与
验收闭合。`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`始终具有唯一架构权威。

## FPC-01 Reference Image辅助搜索

### 用户结果

人物详情的Reference Image区域未来可以同时提供：

- `上传图片`：用户选择本地图片；
- `搜索图片`：用户输入或沿用Person名称，系统返回若干外部网图，用户选择一张后进入与本地上传完全相同的
  Reference Image导入、单人脸校验和提交路径。

搜索只有一个产品目的：帮助用户找到某演员的图片。它不负责注册Person、发现演员、生成Registration
Candidate、判断Media-Cast关系或自动选择Reference Image。搜索结果是短生命周期UI数据；用户未明确选择前，
不得写Person、Reference、Candidate或Media-Cast Fact。

### 为什么不进入Beta

当前clean Capability Catalog没有独立的Reference Image Search原子能力。复用
`people.registration_evidence.observe@1`会把“发现/注册人物”和“搜索图片便利工具”耦合在一起；让
`people.reference_asset.import@1`内部联网搜索则会把用户已选资产导入与Provider检索合并成复杂Executor。

Beta因此只实现本地图片上传。缺少搜索能力不影响：

- direct Person Registration；
- Registration Candidate接受；
- On-deck NFO人物自动发现；
- Reference Image本地上传、单人脸校验、释放；
- Media-Cast形成或确定性修正。

### 后续设计保留

未来如进入正式设计，应增加一个独立的`pure_observation`搜索合同及对应Provider Adapter operation。该合同至少
需要冻结query、Provider/config revision、分页/数量上限、图片URL/缩略图/来源Evidence、超时与内容安全；
用户选择结果随后转换为正式外部asset handle，再复用既有Reference Image Maintenance。不得让搜索Capability
直接写People Store或绕过用户选择。

## 本轮其他明确Beta取舍

以下能力同样不在本轮Beta中，但已直接由SSOT限制，无需在本文展开新的设计：

- 手工Media-Cast关系编辑；
- 仅凭名称、Alias或人脸相似自动改写On-deck Media-Cast；
- People Management直接扫描Shelf Target Folder或读取Arca Material Binding；
- 通用Metadata Center、跨Provider Broker或隐藏的多Provider fallback；
- Person Merge后批量重写历史Media-Cast Fact。

这些取舍都不允许通过兼容层、旁读Store、复杂Executor或UI隐藏按钮提前实现。
