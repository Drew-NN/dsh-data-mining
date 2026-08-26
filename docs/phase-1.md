# Phase 1 规格（感知补全）

依据 DESIGN.md 路线图 Phase 1：值分布、数据盘点、抽样升级。三个小里程碑，沿用 TDD 节奏（规格 → 测试先红 → 实现 → 全绿 → 提交）。

## 动机（来自 DESIGN 的失败场景，不是罗列）

- **value_counts**：profile 只给 `unique` 数量，模型看不出分布——分类列是否失衡（churn 的 yes/no 比例）、高基数列是不是 ID（top 全是单例）。感知层缺"分布视图"。
- **discover_datasets**：模型靠 bash ls/find + file 工具拼凑盘点，容易漏、慢、且不小心用 cat 打开大文件。数据收集（第 3 步）的起点需要结构化盘点。
- **sample_rows 升级**：宽表每行几十列，返回全列灌爆上下文（列过滤）；"找 churned=yes 的行"用 offset/limit 盲扫不可行（条件过滤）。

## M1.1 value_counts

**目标**：给定列，返回 top-k 频数 + 占比，让模型一眼看出分布形态。

- 输入：`path`、`column`（列名，找不到时报错并列出有效列名）、`topK`（默认 10，上限 50）、`maxRows`/`maxBytes`（复用 profile 的采样与截断语义）。
- 输出：`{ path, column, kind, total (非缺失数), missing, unique, sampled, truncated, values: [{ value, count, rate }] }`——按 count 降序、value 升序稳定排序；`omitted` 字段给出未展示的类别数（unique - 展示数），模型知道分布是否完整呈现。
- 计数基于**已读入（可能已采样的）行**，`sampled`/`truncated` 继续说明近似性。
- 缺失值单独统计（不混进 top-k），方便识别"哨兵值冒充数据"的场景。

**验收**（M1.1 已完成，提交 7a036bd）：
- [x] 已知数据手算计数、占比、排序（含并列值顺序）
- [x] topK 截断 + omitted 数量正确
- [x] 列名不存在时报错
- [x] 缺失单独统计；采样时 sampled 标记

## M1.2 discover_datasets

**目标**：盘点工作区里的数据文件，替代 bash 拼凑。

- 输入：`dir`（默认进程 cwd）、`maxDepth`（默认 3）、`maxFiles`（默认 200）。
- 行为：递归扫描，跳过隐藏目录（`.` 开头）、`node_modules`/`.git`；按扩展名识别格式（csv/tsv/json/jsonl/parquet/xlsx/xls）；对 csv/tsv 顺带嗅探分隔符；行数估算：读前 64KB 数行数按大小外推（小文件即精确），估算值标记 `estimated: true`。
- 输出：`{ root, fileCount, truncated, files: [{ path, ext, kind, bytes, delimiter?, rowEstimate?, estimated }] }`，按路径排序。
- 根目录不存在或不是目录时报错（空结果会被误读为"这里没有数据"）。

**验收**（M1.2 已完成，提交 7afbfd8）：
- [x] 递归找到数据文件、大小正确
- [x] csv 分隔符嗅探正确（tab/逗号）
- [x] 行数估算：小文件精确、大文件外推且标记 estimated
- [x] 隐藏目录与 node_modules 被跳过；超过 maxFiles 截断
- [x] 根目录不存在报错

## M1.3 sample_rows 升级

**目标**：减少返回噪音、支持按值找行。

- 新增 `columns` 参数（列名子集，按给定顺序返回；未知列名报错并列出有效列名）。
- 新增 `where` 参数（`{ column, equals }` 精确匹配原始单元格值）；匹配先行，`offset`/`limit` 作用于**匹配结果**；返回 `totalMatches`；仍受 maxBytes 截断即报错（语义需要整文件）。
- 输出加 `columns` 回声，`totalRows` 更名为 `totalMatches`（无 where 时等于总行数）。
- `null` 单元格永不匹配（即使 `equals` 是空字符串）。

**验收**（M1.3 已完成，提交见下）：
- [x] 列过滤：只返回指定列、顺序正确、未知列报错
- [x] where 精确匹配 + offset/limit 作用于匹配集 + totalMatches 正确
- [x] null 永不匹配；既有行为不回归

## Phase 1 总验收

- [x] 全部 68 个测试通过（11 profile + 12 parsing + 6 discover + 39 tool），构建通过
