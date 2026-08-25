---
name: data-leakage-prevention
description: Use before training or evaluating any model on tabular data, and whenever you are about to impute, scale, encode, or split a dataset, to apply the data-leakage rules that keep test-set information out of training. The most dangerous failure in data mining is a model that scores high but leaks — its metric is fake.
---

# Data Leakage Prevention

Apply these rules to every modeling task. A leaked model looks excellent on paper and fails in production; these rules are the difference between "scored well" and "actually works".

## The one rule that subsumes everything

**Information from the test (or validation) set must never influence training.** If a computation uses test rows, it is leakage, even if the leak is small or indirect.

## Concrete rules

1. **Split before any preprocessing that uses global statistics.** Imputation values (mean/median/mode), scalers (min-max, z-score), and encoders must be FIT on the training split only, then APPLIED to the test split. Never compute them on the full dataset first.
2. **Use scikit-learn Pipelines** so the fit/transform split is structural, not a habit. A `Pipeline` fits its transformers on training data and applies them to test data automatically. If you are not using a Pipeline, say explicitly where each statistic was fit.
3. **Do not select features or hyperparameters using test performance.** Model selection and feature selection belong on a validation split (or inside cross-validation), never on the test set. The test set is touched exactly once, at the very end.
4. **Time-series data is never randomly split.** If the rows have a time order, split chronologically (train = earlier, test = later) or use time-aware cross-validation such as `TimeSeriesSplit`. A random split on time-ordered data leaks the future into the past.
5. **Watch for row-level leakage.** If rows are related (same customer, same session, repeated measurements), group them — do not let the same entity appear in both train and test. Use `GroupKFold` or a group-aware split when rows are not independent.
6. **No test-set lookups during feature engineering.** If a feature is computed by joining or aggregating across the dataset, the aggregation must come from training rows only.
7. **Sanity-check the result.** If a model reports near-perfect scores (AUC ≈ 1.0, 100% accuracy) on a real-world dataset, suspect leakage before celebrating. Re-examine every preprocessing step with the first rule in mind.

## Report template for this skill

After applying these rules, state briefly: where the split happened, what was fit on training only, and how you confirmed no test information entered training. If you cannot guarantee this, say so explicitly — do not present a leaked metric as a real result.
