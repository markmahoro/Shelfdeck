# P10 Handoff B and On-deck Detailed Plan

Status: Active

## Objective

在Arca边界内完成Shelf/Standard/Placement读取、Handoff B acceptance/rejection、custody、staging与On-deck Commit。Handoff B Accepted只转移custody；只有On-deck Commit建立或扩展Shelf Entry、Canonical Identity与Deck Fact。

## Work packages

1. P10-00 baseline与完整垂直预检。
2. P10-01 Arca public contracts、Shelf及Standard/Placement snapshot。
3. P10-02 typed acceptance checks与Structured Rejection。
4. P10-03 Handoff B atomic accepted/rejected commits与Libra rejection consumer。
5. P10-04 custody、target slot、stage、verify及final-primary verification。
6. P10-05 On-deck atomic commit、Inventory、Shelf Entry、Canonical Identity、Deck Fact、settlement与Off-load projection。
7. P10-06 capability registration、crash/restart/replay harness与Exit Audit。

只允许local unit/contract/isolated fixture；不得进入P11前跳过P10 Exit Audit。
