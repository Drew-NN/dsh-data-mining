---
name: data-mining-workflow
description: Use at the start of any data-mining task, and when you are unsure what to do next, to run the six-phase CRISP-DM workflow — business understanding, data understanding, data preparation, modeling, evaluation, deployment — in order, producing the right artifact at each phase instead of jumping straight to model training.
---

# Data Mining Workflow (CRISP-DM, condensed)

Follow these phases in order. Each phase has an exit condition; do not move on until it is met. Skipping straight to model training is the most common beginner mistake — the model is only phase four.

## Phase 1 — Business understanding

Clarify what the user actually wants. What is the target? What would success look like? If the goal is ambiguous, ask. Write one sentence: the goal, the target variable, and the success metric.

## Phase 2 — Data understanding

Use `profile_dataset` on each dataset first: schema, missing rates, per-column kinds, sample values. Use `sample_rows` to inspect suspicious columns. Note data quality problems (missing values, outliers, wrong types, duplicate rows) before fixing anything.

## Phase 3 — Data preparation

Clean and transform: missing-value strategy (drop / impute / flag), type fixes, outlier handling, feature engineering, encoding. **Load the `data-leakage-prevention` skill before any preprocessing that uses global statistics** — imputation and scaling must be fit on training data only. Record every transformation so it can be replayed.

## Phase 4 — Modeling

Start with a simple baseline model (e.g. logistic regression or a decision tree) before trying complex ones. Then try 2-3 reasonable alternatives. Compare them fairly: same split, same metric, same preprocessing.

## Phase 5 — Evaluation

Evaluate on data the model has never seen, using the metric agreed in Phase 1. Use proper cross-validation (stratified for classification, time-aware for time series). **Load the `data-leakage-prevention` skill and verify no leakage** before trusting any score. Compare against the baseline: is the complexity justified?

## Phase 6 — Deployment / report

Deliver: the key findings (what drives the target), the model's honest performance with its limitations, the artifacts produced (scripts, model file, report), and how to reproduce the result. Keep the final answer brief and factual.

## When you are stuck

Ask: which phase am I in? What is this phase's exit condition? If you cannot answer either, go back to the previous phase's deliverable.
