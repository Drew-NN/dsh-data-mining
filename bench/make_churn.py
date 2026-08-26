#!/usr/bin/env python3
"""Generate the synthetic churn benchmark dataset with a known DGP.

Ground truth (for evaluation):
- churn is driven strongly by `calls` (negative) and `plan` (basic > standard
  > premium), weakly by `age` (younger churn more).
- `city` (60 values) and `joined_year` are pure noise.
- ~5% of `calls` are missing (missing at random).
- `last_active` is a date column (available for chronological splits).

Run: python3 make_churn.py <output.csv>
"""
import csv
import random
import sys
from datetime import date, timedelta

random.seed(20240825)

PLANS = ['basic', 'standard', 'premium']
PLAN_P = [0.3, 0.4, 0.3]
CITIES = [f'city_{i:02d}' for i in range(60)]


def sigmoid(x):
    if x >= 0:
        z = 1 / (1 + 2.718281828459045 ** -x)
    else:
        e = 2.718281828459045 ** x
        z = e / (1 + e)
    return z


rows = []
for i in range(1, 801):
    age = random.randint(18, 70)
    plan = random.choices(PLANS, PLAN_P)[0]
    # calls: base depends on plan, then noise
    plan_base = {'basic': 40, 'standard': 90, 'premium': 160}[plan]
    calls = max(0, int(random.gauss(plan_base, plan_base * 0.45)))
    city = random.choice(CITIES)
    joined_year = random.randint(2018, 2024)
    missing = random.random() < 0.05
    calls_out = None if missing else calls
    # logit: calls strong negative, plan strong, age weak; base kept low so
    # the overall churn rate lands in the realistic 15-30% range
    logit = (-1.3
             + 1.0 * (plan == 'basic')
             + 0.5 * (plan == 'standard')
             - 0.5 * (calls / 50)
             - 0.2 * ((age - 44) / 20))
    churn = random.random() < sigmoid(logit)
    last_active = date(2024, 1, 1) - timedelta(days=random.randint(1, 90))
    rows.append([f'u{i:04d}', age, plan, calls_out, city, joined_year,
                 churn, last_active.isoformat()])

with open(sys.argv[1], 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['customer_id', 'age', 'plan', 'calls', 'city',
                'joined_year', 'churn', 'last_active'])
    w.writerows(rows)

print(f'wrote {len(rows)} rows to {sys.argv[1]}')
