---
name: data-quality-assessment
description: Use during data understanding and before any preprocessing, when a dataset has missing values, outliers, duplicates, or inconsistent types, to assess data quality systematically — missingness patterns, outlier detection, duplicate rows, and value-consistency checks — and record every quality problem before fixing anything.
---

# Data Quality Assessment

Use this skill after `profile_dataset` reveals quality problems and before you fix anything. The workflow's Phase 2 exit condition is "you know what is wrong with the data" — this skill is how you get there. Fix nothing until the assessment is written down; every fix you make later must be traceable to a problem found here.

## The output of this skill

A short quality report with three sections: **missingness**, **outliers**, **duplicates & consistency**. One line per finding, with the column, the evidence (from `profile_dataset` / `sample_rows`), and the planned treatment. This report is the input to Phase 3 (preparation).

## 1. Missing values — look at the pattern, not just the rate

`profile_dataset` gives the missing count and rate per column. The rate alone decides nothing; the **pattern** decides the strategy:

- **Is missingness concentrated in a few columns or spread everywhere?** A column at 80% missing is usually dropped or flagged; a column at 2% missing is usually imputed or kept as-is.
- **Does missingness correlate with other columns or with the target?** Cross-tabulate missing-vs-present against a second column with `sample_rows`. If missing rows share a property (one source, one batch, one group), the data is **not missing at random** — dropping rows silently biases the dataset.
- **Do sentinel values pretend to be data?** `0`, `-1`, `999`, `'unknown'`, `'N/A'`, `'null'` as strings are common fake-missing encodings. `profile_dataset`'s sample values and `unique` count will often reveal them. Decide once whether a sentinel counts as missing and record that decision.

Then choose per column: **drop** (high rate, low value), **impute** (low rate, well-understood column), or **flag** (add an `is_missing` indicator — often the most honest choice when missingness may be informative). **Load `data-leakage-prevention` before computing any imputation statistic** — the statistic must be fit on training data only.

## 2. Outliers — detect, then decide with domain sense

- **Numeric columns**: use IQR (`Q3 + 1.5·IQR` / `Q1 − 1.5·IQR`) or z-score (|z| > 3). Do not delete on statistics alone — an outlier may be the most important row (a fraud case, a churn event).
- **Check plausibility against the domain**: a negative age, a 1e6 salary in a household survey, a date in the future. `profile_dataset`'s min/max-style investigation happens through `sample_rows` on the extremes.
- **Decide and record**: keep (with a note), clip/winsorize (state the bounds), transform (log/box-cox — but fit the transform on training data only), or drop (with a count).
- Never remove outliers before the train/test split, and never tune the outlier rule on test data.

## 3. Duplicates — exact, near, and identity

- **Exact duplicate rows**: same values in every column. Count them (e.g. via pandas `duplicated()`). Drop or keep by a stated rule — but **drop before the split**, otherwise the same row can appear in both train and test, which is row-level leakage.
- **Duplicate identifiers**: a column that should be unique (customer id, session id, timestamp) with repeated values — the dataset may be event-level, not entity-level. Decide the grain and document it.
- **Near-duplicates**: same entity with slight differences (name casing, trailing spaces, date formatting). Usually an inconsistency to normalize, not a row to drop.

## 4. Type & value consistency

- **Mixed-type columns**: `profile_dataset` reports `string` when a column mixes numbers and text. Find the odd values with `sample_rows` and normalize or split them.
- **Casing / whitespace**: `"New York"` vs `"new york"` vs `"New York "` are three values to `unique` but one city. Trim and normalize *after* recording the original state.
- **Units**: `kg` vs `g`, `$` vs `€`, percentages as `0.05` vs `5`. Pick one representation per column and state it.
- **Dates**: multiple formats in one column (`2024-01-01`, `01/02/2024`, `Jan 1 2024`) — parse to one canonical type and note the source format. If the data is time-ordered, this is also the moment to plan a chronological split (see `data-leakage-prevention` rule 4).

## When you are done

You should be able to answer, for every column: kind, missing pattern and strategy, outlier findings, duplicate status, and value-consistency state. If you cannot, run more `sample_rows` / `profile_dataset` calls — the assessment is incomplete, and Phase 3 fixes built on an incomplete assessment are guesswork.
