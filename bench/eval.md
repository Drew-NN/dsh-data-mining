# 基准评估结果（第一轮，2025-08-26）

任务：churn.csv（800 行合成数据）完整数据挖掘。两组：A = 无插件 headless；B = 带 dsh-data-mining bundle。
两个会话均使用编译版 CLI（apps/cli/lib/bin.js）以正确的工作区 cwd 运行，产物完整落盘。

## 已知 DGP（生成脚本见 git: bench/make_churn.py）
- calls 强负驱动（流失者均值 ~61 vs 未流失 ~109）；plan 强驱动（basic 34% > standard 18% > premium 6%）
- age 弱驱动；city（60 城）/joined_year/last_active 为纯噪声
- calls 6% 随机缺失；流失率 19%

## 工具使用（会话轨迹）

| | A（无插件） | B（有插件） |
|---|---|---|
| bash | 18 次 | 10 次 |
| write/edit/read | 4/1/0 | 6/1/2 |
| 插件工具 | — | discover_datasets 1, profile_dataset 1, sample_rows 1, value_counts 1, split_dataset 1, check_leakage 1（PASS） |
| 技能加载 | — | 3 次 |

B 的 check_leakage 输出：totals 640+160+0=800 ✓ row-counts ✓ duplicates: no exact duplicate rows ✓ id-column: no customer_id overlap → LEAKAGE OK。切分元数据落盘在 dsh_manifest/splits/churn_split/（默认 outDir，cwd 相对——manifest 机制被真实使用）。

## 评分（每项 0-2）

| 维度 | A | B | 证据 |
|---|---|---|---|
| 数据理解 | 2 | 2 | 双方都详尽（缺失模式/分布/单变量关系）；B 还发现 joined_year=2024 与 last_active=2023 的时间矛盾 |
| 切分纪律 | 2 | 2 | A：Pipeline 内先切分（75/25 分层）；B：split_dataset 工具切分（80/20 分层）+ Pipeline |
| 泄漏验证 | 1 | 2 | A 是脚本内自述验证；B 是 check_leakage 机械 PASS（重复行/ID/行数全查） |
| 评估诚实性 | 2 | 2 | 双方都报未见数据指标 + 基线对比 + 局限；B 附混淆矩阵与阈值说明 |
| 发现正确性 | 2 | 1.5 | 双方前二驱动正确（calls/plan）；A 正确剔除 city 噪声（卡方 p=0.62）；B 把 city 列为第 3 驱动（ΔAUC 0.034，注明小样本谨慎——实为噪声） |
| 可复现性 | 1.5 | 2 | A：单脚本+seed+REPORT，无 requirements.txt/模型文件；B：3 脚本+requirements+模型+切分元数据+复现步骤 |
| 工具利用（仅 B） | — | 2 | 全链工具+技能，恰如其分 |
| 合计 | 10.5/12 | 11.5/13 | |

## 结论（诚实版）

1. 干净小任务上，有/无插件都能高质量完成——基线的 deepseek agent + bash/python 已足够能打。插件的优势不在"能否完成"，而在：
   - 验证可审计性：B 的防泄漏是机械 PASS，A 是自述——信任 B"没泄漏"的成本更低；
   - 交付物完整性：B 的切分元数据/模型/reports/requirements 齐全；
   - 探索结构化：B 用 10 次 bash + 4 个感知工具，A 用 18 次 bash 拼凑。
2. 发现正确性上 A 略胜（正确剔除 city）——暴露插件的真实弱点：profile/value_counts 对高基数列（60 城 × ~13 行）没有"可能是 ID/噪声"的警告。这是 DESIGN"给解释不给裸数字"的未尽之处，值得加。
3. 基准教训：(a) 基准秘密（eval.md/make_churn.py）放仓库内会被 agent 读到造成污染——必须移出；测试中已修正（删除后重跑）；(b) 头两轮运行因 pnpm --dir 覆盖 cwd 导致工作区错误、产物丢失——用编译版 CLI + 直接 cwd 解决；(c) 测试集大小不同（A 200 行 vs B 160 行）使指标不可直接对比。
4. 下一步建议：插件是"结构插件"，在无陷阱数据上不改变结论、只改变结论的可靠性与交付质量。要用带陷阱的基准测"拦得住错误"：预缩放列、跨切分重复行、随机切分时序陷阱、更大文件（GB 级）、高基数列——那才是守门层（split/check）与感知层（大文件采样）的主场。
