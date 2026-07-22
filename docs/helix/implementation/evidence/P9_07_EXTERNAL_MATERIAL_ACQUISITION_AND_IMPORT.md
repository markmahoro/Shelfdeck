# P9-07 External Material Acquisition and Import Evidence

Status: PASS

- Architecture baseline: `1619735c`（local integration `aeedb2b7`）
- Implementation closure: `fff40f8d92dbff88f07435a49bb0bcbae4934578`
- 链路：typed query → search → select → request → observe → stability → identity → package verify → one-member Workspace import。
- 边界：Provider/Worker只经P5 typed port；每次import只消费一个`externalMemberId`；无reference-list或旧acquisition thin path。
- 反例：deferred不切换来源；路径逃逸拒绝；同一import重放返回同一receipt；重启后不重复写入。

