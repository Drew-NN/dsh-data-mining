# Phase 3 规格（流程：manifest + 检查点）

依据 DESIGN.md 第 102-103 行（存储 + 流程约定）、第 107 行（协作定位四节点）、路线图 Phase 3。

## 动机（不是新方向，是 DESIGN 已承诺未实现的部分）

- 前三个 Phase 交付了"眼睛"（感知工具）和"刹车"（守门工具），但没有**骨架**：agent 的中间状态全在上下文里，跨步骤无记忆，中途不与人交互。
- 第一轮基准证实了这一点：B 会话把工具用得很好，但工作流结构与 A 完全一样（单会话一气呵成），没有停顿、没有决策记录——插件只是"顺手工具"，没成为"agent"。
- manifest + 检查点是 DESIGN 四大机制里剩下的两个，也是基线 agent 永远无法自己获得的部分（它靠上下文活着、不会主动建立结构化决策档案）——这是插件的护城河。

## 一、manifest schema（version 1）

文件位置：`<cwd>/dsh_manifest/manifest.json`（与 `splits/` 同目录，同一账本体系）。

```json
{
  "version": 1,
  "goal": {
    "statement": "一句话目标",
    "target": "目标变量列名",
    "metric": "成功指标",
    "constraints": ["可选约束，如：需要可解释性"]
  },
  "phase": "business | data-understanding | data-collection | data-cleaning | split | preprocessing | modeling | evaluation | deployment | done | null",
  "datasets": [
    { "path": "绝对路径", "notes": "关键发现/疑点/业务含义", "recordedAt": "ISO 时间" }
  ],
  "split": {
    "splitFile": "split.json 路径",
    "strategy": "random | chronological | group",
    "trainFile": "train.csv 路径",
    "testFile": "test.csv 路径"
  },
  "decisions": [
    { "text": "决定内容，如：age 的 999 视为缺失，impute 中位数", "phase": "做出决定的阶段", "recordedAt": "ISO 时间" }
  ]
}
```

规则：
- 文件不存在 = 空 manifest（工具自动创建），所有字段可为空/null。
- 只追加不覆盖：`datasets`/`decisions` 是数组，新记录 append；`goal`/`split`/`phase` 是单值，后写覆盖。
- 无并发锁（单会话使用，文档说明）。

## 二、manifest 工具（五个动作，一个工具）

| action | 参数 | 行为 |
|---|---|---|
| `read` | — | 返回整个 manifest（不存在时返回空结构） |
| `set_goal` | statement, target, metric, constraints? | 写 goal，同时 phase → business（若为空） |
| `set_phase` | phase | 写当前阶段 |
| `add_dataset` | path, notes? | 追加到 datasets |
| `record_decision` | text | 追加到 decisions，phase 取当前 manifest.phase |
| `set_split` | splitFile | 读取 split.json 补全 strategy/trainFile/testFile 后写入 |

输出：全部返回更新后的 manifest（`read` 也返回 manifest），渲染为简洁文本。**每个写操作后 agent 都能立即读到账本全貌**。

文件路径：默认 `<cwd>/dsh_manifest/manifest.json`，工具参数可覆盖。

## 三、检查点协议（DESIGN 四节点，人设+技能固化）

人设硬规则（cordis.patch.yml）：四个节点必须"写 manifest → 汇报 → 等确认 → 才进入下一阶段"：

1. **业务理解后**：set_goal → 汇报目标/指标 → 等确认（未确认不得看数据）。
2. **数据理解后**：add_dataset（数据地图/疑点/发现的业务含义）→ 汇报 → 等确认（人补充含义/聚合键/预测时点）。
3. **评估后**：汇报指标 + 基线对比 + 泄漏自查（check_leakage 结果）→ 等拍板（继续优化还是交付）。
4. **交付时**：最终报告引用 manifest 内容（goal/decisions/split）→ 验收。

中间步骤（收集/清洗/切分/建模）agent 全权执行不打扰，但每个关键决定 record_decision，切分后 set_split。

技能固化：data-mining-workflow 每个 Phase 的退出条件改为"该阶段对应记录已写入 manifest 才可继续"——记录是进入下一阶段的通行证，不是建议。

## 四、验收标准

- [ ] manifest 工具单测：空结构、goal/phase/datasets/decisions/split 各动作正确，往返一致
- [ ] 工具级测试：set_goal → read 可见；add_dataset 追加；record_decision 带当前 phase；set_split 从 split.json 补全
- [ ] 人设/技能含四节点检查点描述
- [ ] 全量测试通过、构建通过
- [ ] 交互式真测（需用户在场）：agent 开跑先问目标；回答后 manifest 有 goal；中途改一个决定 → decisions 出现新记录且行为照做；报告引用账本可复现
