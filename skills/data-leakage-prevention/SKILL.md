---
name: data-leakage-prevention
description: Use before training or evaluating any model on tabular data, and whenever you are about to impute, scale, encode, or split a dataset, to apply the data-leakage rules that keep test-set information out of training. The most dangerous failure in data mining is a model that scores high but leaks — its metric is fake.
---

# Data Leakage Prevention

Apply these rules to every modeling task. A leaked model looks excellent on paper and fails in production; these rules are the difference between "scored well" and "actually works".

## The one rule that subsumes everything

**Information from the test (or validation) set must never influence training.** If a computation uses test rows, it is leakage, even if the leak is small or indirect.

## The mechanical way to obey it: pipelines, not habits

Structure every preprocessing step as a scikit-learn `Pipeline` (or equivalent). A `Pipeline` fits its transformers on the training split and applies them to the test split automatically — the fit/apply boundary becomes structural instead of a discipline you have to remember:

```python
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression

pipe = Pipeline([
    ('impute', SimpleImputer(strategy='median')),  # fit on train, applied to test
    ('scale', StandardScaler()),                    # fit on train, applied to test
    ('model', LogisticRegression()),                # fit on train
])
pipe.fit(X_train, y_train)
score = pipe.score(X_test, y_test)                  # test sees only fitted transformers
```

If you are not using a pipeline, say explicitly, for every statistic: **where was it fit, and where was it applied?** If the answer is ever "the full dataset", that is leakage.

## Concrete rules

1. **Split before any preprocessing that uses global statistics.** Imputation values (mean/median/mode), scalers (min-max, z-score), and encoders must be FIT on the training split only, then APPLIED to the test split. Never compute them on the full dataset first.
2. **Target encoding is the subtlest leak.** Encoding a categorical column with the mean of the target per category is leakage if computed on the full dataset — the category's encoding contains test labels. Compute target statistics inside cross-validation folds only (e.g. `TargetEncoder` with `cv`), or skip the technique.
3. **Do not select features or hyperparameters using test performance.** Model selection and feature selection belong on a validation split (or inside cross-validation), never on the test set. The test set is touched exactly once, at the very end.
4. **Time-series data is never randomly split.** If the rows have a time order, split chronologically (train = earlier, test = later) or use time-aware cross-validation such as `TimeSeriesSplit`. A random split on time-ordered data leaks the future into the past. Watch for time-dependent features too (rolling means, lags) — they must be computed within the training window.
5. **Watch for row-level leakage.** If rows are related (same customer, same session, repeated measurements), group them — do not let the same entity appear in both train and test. Use `GroupKFold` or a group-aware split when rows are not independent.
6. **Drop exact duplicate rows before splitting.** A row that exists verbatim in both train and test is a free correct answer — the model memorizes it, the test score is inflated. Deduplicate (see `data-quality-assessment`) before the split, and verify no duplicated identifier crosses the boundary.
7. **No test-set lookups during feature engineering.** If a feature is computed by joining or aggregating across the dataset, the aggregation must come from training rows only.
8. **Sanity-check the result.** If a model reports near-perfect scores (AUC ≈ 1.0, 100% accuracy) on a real-world dataset, suspect leakage before celebrating. Re-examine every preprocessing step with the first rule in mind.

## The five-minute self-check

Walk the pipeline top to bottom and answer for each step:

| Step | The question to answer |
|---|---|
| Imputation | Was the imputation value fit on training rows only? |
| Scaling / normalization | Were min/max/mean/std computed on training rows only? |
| Encoding | Did any encoding use target or test information (incl. target encoding)? |
| Feature selection / HPO | Was any choice made using test performance? |
| Split | Time order respected? Groups kept together? Duplicates removed first? |

If any answer is "no" or "not sure", the metric is not trustworthy — go back and fix the pipeline before reporting anything.

## Report template for this skill

After applying these rules, state briefly: where the split happened, what was fit on training only, and how you confirmed no test information entered training. If you cannot guarantee this, say so explicitly — do not present a leaked metric as a real result.
