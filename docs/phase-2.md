# Phase 2 规格（守门：切分 + 泄漏检查）

依据 DESIGN.md 路线图 Phase 2 与"切分/预处理"两节：机械可判定的正确性（切分、泄漏）用工具强制，错了就拒绝，不给假分数。

## 动机（来自 DESIGN 的失败场景）

- **切分死**：随机切时序数据、不按实体分组切、重复行跨 train/test、全量 fit scaler 再切分——泄漏，指标假得漂亮。
- **顺序死**：切分必须发生在一切"从数据里学参数"的变换之前，而"自觉"不可靠。
- **聚合死**：聚合特征用全量数据（把 test 信息卷进 train）——`idColumn`/`groupColumn` 声明为跨切分检查打底。

## 设计决定：切分元数据放哪、什么格式

- **位置**：工作区下 `dsh_manifest/` 目录（默认 `<cwd>/dsh_manifest/`，可 `outDir` 覆盖）。这是 Phase 3 manifest 的前身——目标/边界/决策/切分元数据最终都会住在这里。
- **布局**：`dsh_manifest/splits/<name>/` 下三个文件：`train.csv`、`test.csv`、`split.json`（元数据）。
- **`split.json` 格式（version 1）**：

```json
{
  "version": 1,
  "datasetPath": "/abs/path/data.csv",
  "name": "churn-80-20",
  "strategy": "random | chronological | group",
  "ratio": 0.8,
  "seed": 42,
  "stratifyColumn": null,
  "timeColumn": null,
  "gapDays": null,
  "groupColumn": null,
  "idColumn": "customer_id",
  "totalRows": 10000,
  "trainRows": 8000,
  "testRows": 2000,
  "droppedRows": 0,
  "trainFile": "/abs/path/train.csv",
  "testFile": "/abs/path/test.csv",
  "createdAt": "ISO timestamp"
}
```

- 策略语义（确定性、可复现）：
  - **random**：seed 化 Fisher-Yates 打乱行序，取前 `ratio` 为 train；可选 `stratifyColumn` 按组内打乱。
  - **chronological**：按 `timeColumn`（ISO/斜杠日期，`Date.parse` 可解析）升序；`k = floor(n·ratio)`，cutoff = 第 k 行的时间；train = time ≤ cutoff，test = time > cutoff + `gapDays`，gap 窗口内的行丢弃并记录（`droppedRows`）。时间不可解析 → 报错。
  - **group**：按 `groupColumn` 分组，seed 化打乱组序，贪心装到 train 直到行数比例达标；实体永不跨切分。组值为空 → 报错。
- 输出文件保留**原始行序**（train/test 都是原文件行的子集，不打乱）。
- **诚实边界**：切分需要全文件（不能采样），默认 `maxBytes` 64MB，超限报错并提示加大或改用 Python——与 sample_rows 一致的立场。

## M2.1 split_dataset

**输入**：`path`、`name`、`strategy`、`ratio`（默认 0.8）、`seed`（默认 42）、`stratifyColumn?`、`timeColumn?`、`gapDays?`、`groupColumn?`、`idColumn?`（供泄漏检查）、`outDir?`（默认 `<cwd>/dsh_manifest/splits/<name>`）、`maxBytes?`。

**输出**：`{ datasetPath, name, strategy, totalRows, trainRows, testRows, droppedRows, trainFile, testFile, splitFile, seed, ratio, stratifyColumn, timeColumn, gapDays, groupColumn, idColumn }`（渲染为简短摘要）。

**验收**：
- [ ] random：seed 相同结果一致；train/test 行数按 ratio；行不重叠；并集 = 全集
- [ ] stratify：每个层内比例 ≈ ratio（小样本下允许偏差）
- [ ] chronological：train 全早于 test；gap 生效且有 droppedRows；时间不可解析报错
- [ ] group：同一组值不跨切分；train 行数比例 ≈ ratio
- [ ] 输出文件存在、split.json 与文件一致；可复现（同 seed 重跑产生相同文件）
- [ ] 超 maxBytes 报错

## M2.2 check_leakage

**输入**：`splitFile`（split.json 路径，必填）、`maxBytes?`（默认 64MB，读取 train/test 用）。

**检查项（机械可判定，错了就拒绝）**：
1. **元数据与文件存在**：split.json 可读且 version=1；train/test 文件存在。
2. **行数一致**：train/test 实际行数与元数据一致。
3. **精确重复行跨界**：行规范化哈希（JSON.stringify(单元格数组)）取交集；count + 最多 3 个重复行样例。**>0 即失败**。
4. **id 列跨界**（元数据有 idColumn 时）：train/test 的 id 集合交集计数；**group 策略下 >0 即失败**，其他策略记警告。
5. **时序顺序**（元数据有 timeColumn 时）：max(train 时间) + gap ≤ min(test 时间)；时间不可解析即失败。
6. **总量**：train+test+dropped = totalRows。

**输出**：`{ ok, datasetPath, splitFile, checks: [{ name, passed, detail }], duplicateCount, idOverlapCount, droppedRows, trainRows, testRows }`；`ok=false` 时渲染明确列出失败项。

**验收**：
- [ ] 干净切分：全过，ok=true
- [ ] 人为在 test 里插入 train 的行 → 重复检查失败
- [ ] group 切分后 test 里出现 train 的 id → id 检查失败
- [ ] 时序切分后打乱 test 顺序/混入早于 train 的行 → 时序检查失败
- [ ] 篡改 train/test 行数 → 行数检查失败
- [ ] 读取超 maxBytes 报错（不能静默地"检查一半"）
