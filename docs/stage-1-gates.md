# 阶段 1 规格（门禁引擎，两个工人最小闭环）

依据 PHASE-GATE-DESIGN.md（阶段门禁改进设计）第三~五节，第一版只做"两个工人 + 门禁"能转起来的部分。全部在插件仓库内开发，不依赖 UI。

## 目标

把"阶段推进"从**模型自觉**变成**结构强制**：模型提议（dm_complete 提交）+ 系统核验（退出条件机器可查）+ 用户放行（dm_confirm 确认）。未确认前，越权工具调用被拒绝并明确反馈。

## 一、phaseGates 状态（manifest 扩展）

在现有 manifest 结构上新增（与 `phase` 字段兼容）：

```jsonc
"phaseGates": {
  "business":           { "status": "unlocked" },
  "data-understanding": { "status": "locked" },
  "data-collection":    { "status": "locked" },
  "data-cleaning":      { "status": "locked" },
  "split":              { "status": "locked" },
  "preprocessing":      { "status": "locked" },
  "modeling":           { "status": "locked" },
  "evaluation":         { "status": "locked" },
  "deployment":         { "status": "locked" },
  "done":               { "status": "locked" }
}
```

- status: `locked | unlocked | pending(待确认) | done`
- 规则：unlocked/pending 至多一个；前置 done 才 unlock 下一个；无 phaseGates 时（新工作区/旧会话）按"business=unlocked，其余 locked"推断（迁移兼容）。
- 回退：redo → 该阶段 unlocked，其后全部 locked。

## 二、dm 工具（一个工具，五个动作）

| action | 行为 |
|---|---|
| `phase` | 查询全部阶段状态（只读） |
| `complete <phase>` | 提交完成申请：核验该阶段退出条件（见下）→ 通过则置 `pending`；不通过则拒绝并列缺什么 |
| `confirm <phase>` | 用户放行：pending → `done`，解锁下一阶段（这个动作由用户在 UI 点确认触发；headless/测试环境里直接调用模拟用户） |
| `redo <phase>` | 回退：该阶段 → unlocked，其后全部 locked |
| `force <phase>` | 强制通过（人类判断优先）：无论核验结果直接 done，记录 override 原因 |

## 三、退出条件核验（第一版只做机器可查的）

| 阶段 | 核验条件 | 数据来源 |
|---|---|---|
| business | `goal` 存在（statement/target/metric 非空） | manifest |
| data-understanding | `datasets` 非空 | manifest |
| split | `split` 引用存在 | manifest |
| 其他阶段 | 第一版暂不核验（条件待定，`complete` 只置 pending 不拦） | — |

## 四、工具门禁（执行前检查，未解锁即拒绝）

给现有数据工具加"执行前查 phaseGates"：调用时若该工具所属阶段未解锁，拒绝并返回"🔒 阶段未解锁，只能讨论不能执行"。

| 工具 | 所属阶段 | 允许条件 |
|---|---|---|
| discover_datasets / profile_dataset / value_counts / sample_rows | data-understanding | data-understanding 为 unlocked 或 done |
| split_dataset / check_leakage | split | split 为 unlocked 或 done |
| manifest / dm | 不限 | 永远允许（记账与门禁本身不锁） |

初始：business=unlocked 时，数据工具（属 data-understanding=locked）即被拒——"目标未确认前不看数据"。

## 五、验收（阶段 1 已完成，2025-08-28）

- [x] 状态机纯函数：初始推断、complete→pending、confirm→done+解锁下一个、redo 回退、force、前置锁定
- [x] dm 工具：phase 查询；complete 核验 business（无 goal 拒绝）；confirm 后下一阶段解锁；redo 回退；force 记录原因
- [x] 门禁：business 未 done 时 profile_dataset 被拒；data-understanding 未 done 时 split_dataset 被拒；无 phaseGates 时工具照常（向后兼容）；manifest/dm 不被锁
- [x] 全量 123 个测试通过、构建通过、提交
