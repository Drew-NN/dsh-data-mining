---
name: data-mining-workflow
description: Use at the start of any data-mining task, and when you are unsure what to do next, to run the six-phase CRISP-DM workflow — business understanding, data understanding, data preparation, modeling, evaluation, deployment — in order, producing the right artifact at each phase instead of jumping straight to model training.
---

# Data Mining Workflow (CRISP-DM, condensed)

Follow these phases in order. Each phase has an **exit deliverable**; do not move on until it exists. Skipping straight to model training is the most common beginner mistake — the model is only phase four. Expect to loop back: evaluation usually sends you to preparation or modeling again, not straight to deployment.

**Work conventions that apply to every phase:**

- Keep artifacts in the workspace, in a predictable layout: `scripts/` for code, `models/` for saved models, `reports/` for findings. Name scripts by step (`01_profile.py`, `02_clean.py`, `03_model.py`) so the pipeline reads top to bottom.
- Make everything reproducible: pin a random seed at the top of every modeling script, and record the package versions you used (`pip freeze > requirements.txt` or a `pyproject.toml`).
- Record every data transformation in code (never "fix in Excel"), so the whole pipeline can be replayed from the raw data.

## Phase 1 — Business understanding

**Exit deliverable:** one written sentence stating the goal, the target variable, and the success metric.

Clarify what the user actually wants. What is the target? What would success look like — accuracy, a ranked shortlist, a causal story, a report? If the goal or the metric is ambiguous, **ask** before spending effort; rework at this phase costs one sentence, rework after modeling costs hours.

## Phase 2 — Data understanding

**Exit deliverable:** a list of every dataset, its schema, and its quality problems.

Use `profile_dataset` on each dataset first: schema, missing rates, per-column kinds, sample values. Use `sample_rows` to inspect suspicious columns. Then **load the `data-quality-assessment` skill** and run its checklist: missingness patterns, outliers, duplicates, and value consistency. Note data quality problems *before* fixing anything — the assessment report is the input to Phase 3.

## Phase 3 — Data preparation

**Exit deliverable:** a clean, typed, reproducible preparation script (or scripts).

Clean and transform: missing-value strategy (drop / impute / flag), type fixes, outlier handling, feature engineering, encoding. **Load the `data-leakage-prevention` skill before any preprocessing that uses global statistics** — imputation and scaling must be fit on training data only. Structure the pipeline so the train/test boundary is explicit from the first transformation, not retrofitted at the end.

## Phase 4 — Modeling

**Exit deliverable:** a baseline model plus 2–3 reasonable alternatives, each trained inside the same pipeline.

Start with a simple baseline (logistic regression or a decision tree) before anything complex. Then try 2–3 reasonable alternatives. Compare them fairly: same split, same metric, same preprocessing — that means the alternatives differ only in the estimator, not in the data they see.

## Phase 5 — Evaluation

**Exit deliverable:** a verdict — which model wins, by the Phase 1 metric, on data it has never seen.

Evaluate on data the model has never seen, using the metric agreed in Phase 1. Use proper cross-validation (stratified for classification, time-aware for time series). **Load the `data-leakage-prevention` skill and verify no leakage** before trusting any score. Compare against the baseline: is the complexity justified? If the winner is worse than the baseline, the extra complexity is not earning its keep — go back to Phase 4 or Phase 3.

## Phase 6 — Deployment / report

**Exit deliverable:** a final report that a reader can reproduce.

Deliver: the key findings (what drives the target), the model's honest performance with its limitations, the artifacts produced (scripts, model file, report), and how to reproduce the result — the commands to run and the seed. Keep the final answer brief and factual. If the pipeline cannot be replayed from raw data by someone else, the work is not finished.

## When you are stuck

Ask: which phase am I in? What is this phase's exit deliverable? If you cannot answer either, go back to the previous phase's deliverable — an unfinished phase above you will corrupt every phase below.
