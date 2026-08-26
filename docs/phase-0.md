# Phase 0 规格（地基）

依据 DESIGN.md 路线图 Phase 0：CSV 解析鲁棒性 + 真实数值统计 + 日期推断。三个里程碑，每个做完跑通测试再提交。

## M0.1 解析鲁棒性

**目标**：让 `profile_dataset` / `sample_rows` 在真实世界的 CSV 上可信——不因 BOM、分隔符、超大文件而产出错误或崩溃。

**改动点**：

1. **剥 UTF-8 BOM**：`parseCsv` 开头剥掉 `\uFEFF`（Excel 导出的 CSV 第一个表头会带）。
2. **分隔符**：`parseCsv` 支持显式 delimiter 参数（`,` `\t` `;` `|`），不传时自动检测（取前几行里字段数最一致的候选，默认逗号）。
3. **大小上限**：`readCsvFile` 支持 `maxBytes`（默认 64MB），超过只读头部、返回 `truncated` 标记；`sample_rows` 遇截断直接报错（offset 语义不能被静默破坏），`profile_dataset` 遇截断标记 `truncated: true`（统计为头部近似）。
4. **行数采样（头部 + 等距）**：`parseCsv` 支持 `maxRows`（默认 10 万）；超过时保留前一半 + 之后每 k 行取 1 行（k 由已知总行数算出，确定性），标记 `sampled: true`，并报告真实总行数。

**输出契约变化**：`DatasetProfile` 增加 `rowsProfiled`（实际画像行数）、`sampled`（是否行采样）、`truncated`（是否字节截断）；`rowCount` 语义改为"已知的真实数据行数"。

**验收**（M0.1 已完成，2025-08-25）：
- [x] 带 BOM 的 CSV 表头干净
- [x] tab/分号/竖线分隔自动识别，显式参数优先
- [x] 超过 maxBytes 的文件：profile 标 `truncated`，sample_rows 报错
- [x] 超过 maxRows 的文件：`sampled: true`，保留行 = 前一半 + 等距，已知总行数正确
- [x] 全部 36 个测试通过（12 解析 + 24 工具），构建通过

## M0.2 真实统计

**目标**：让 `profile_dataset` 对数值列给出可信的分布统计，对时间列给出正确的类型判断——模型第一次看数据就带着"哪里有异常"的信号。

**改动点**：

1. **数值列统计**：kind 为 `number` 的列增加 `stats` 字段：`n`（参与统计的非缺失值个数）、`min`/`max`/`mean`、`std`（样本标准差 ddof=1，n<2 时为 null）、`p25`/`p50`/`p75`（线性插值分位数，与 numpy/pandas 默认一致）。统计在**已读入的（可能已采样的）行**上计算，`sampled`/`truncated` 标记继续说明近似性。
2. **datetime 类型**：`ColumnKind` 增加 `datetime`。识别 ISO 日期（`2024-01-01`、带时间、`T`/空格分隔、`Z`/时区偏移）和 `YYYY/MM/DD`；正则匹配 + `Date.parse` 验证。裸年份（`2024`）仍是 `number`；日期与数值/布尔混列归 `string`。
3. **schema 与渲染**：`profile_dataset` 的列 schema 加 `stats`（仅 number 列出现）、kind 枚举加 `datetime`；渲染文本加统计摘要。

**对拍**：统计用已知小数据集手算断言（`toBeCloseTo`），不与被测函数同源计算。

**验收**（M0.2 已完成，2025-08-25）：
- [x] 数值列 stats 与手算一致（含 n=1 时 std=null、偶数样本中位数插值）
- [x] datetime 识别正确：ISO/带时间/斜杠 → datetime；裸年份 → number；混列 → string
- [x] 非数值列无 stats 字段
- [x] 全部 48 个测试通过（11 profile + 12 parsing + 25 tool），构建通过

## M0.3 工具面（待 M0.2 完成后细化）

- `profile_dataset` schema 加 stats 字段、渲染更新、README 同步
