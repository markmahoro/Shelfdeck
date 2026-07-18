# P8-04 Subject Continuity Resolution Evidence

Status: PASS

Date: 2026-07-19

- 输入仅为immutable Candidate Delivery、global continuity head和Libra active Subject snapshot；无Store旁读或调用者Subject选择。
- Candidate Episode scope按全部primary payload Episode Claim取UTF-8有序并集；single固定空集，season空集fail closed。
- 0/1/N match witness、matched set、overlap与Decision均按SSOT唯一公式形成digest。
- `season_extension`仅允许one exact active match + evaluated zero overlap；其他情况全部`new_subject`并由Libra allocator分配ID。
- multiple只冻结subjectId排序最小的两个distinct witness；title/year/path/folder/fuzzy score不参与判断。
- Focused 3/3、Full Architecture 597/597 PASS；`findings=[]`、`prohibitedActionsRun=[]`。
- 未修改SSOT，未运行E2E/Docker/Canary/生产/真实媒体副作用，未触碰`media-desktop`。
