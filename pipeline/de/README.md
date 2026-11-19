# Germany: how the budget data is built

These scripts produce four files of the German country pack from official statistics:

- `countries/de/budget.json` (revenue and expenditure of general government, base year 2024)
- `countries/de/distributions/taxable_income.json`
- `countries/de/distributions/gross_earnings.json`
- `countries/de/distributions/net_wealth.json`

The other pack files (`country.json`, `policies.json`, `sources.json`) are maintained by hand and are not
generated. The source ids used in the scripts (`eurostat_gov_10a_exp`, `bundeshaushalt_2024`, ...) are the
keys of `countries/de/sources.json`; a new source needs an entry there.

## Run it

Python 3.9 or newer, standard library only. Run from the repository root:

```
python3 pipeline/de/build_budget.py --check    # rebuild in memory, compare with budget.json
python3 pipeline/de/build_dist.py --check      # the same for the three distributions
python3 pipeline/de/build_budget.py --write    # replace budget.json
python3 pipeline/de/build_dist.py --write      # replace the three distributions
python3 pipeline/de/check_distributions.py     # plausibility checks, prints only
npm run validate                               # then check the whole pack
```

Without an option both build scripts only print diagnostics: the level shares of every expenditure leaf, the
totals, the bins. With the cache as delivered, `--check` reports all four files as identical.

## Scripts

| File | What it does |
|---|---|
| `fetch_inputs.py` | Downloads the source files into `.cache/` and writes the text tables the build scripts read. Keeps whatever is already there; `--force` downloads again. |
| `build_budget.py` | The budget tree: labels, amounts, level shares, notes, the nationality breakdown. Reads the Eurostat COFOG table from the cache; every other figure is a constant in the file with its source next to it. |
| `levels.py` | The method for level shares (which level of government bears an expense). Used by `build_budget.py`. |
| `build_dist.py` | The three distributions. Income and earnings come from 2022 statistics and are uprated to 2024 values (see below). |
| `check_distributions.py` | Plausibility checks: the 2022 income tax schedule on 2022 incomes against the official tax total, the 2024 schedule and selected reforms against government estimates, contributions under the 2022 and 2024 rules, and wealth above several thresholds. It integrates curves of marginal rates the way the engine does. |
| `es.py` | Eurostat fetcher and table printer, for looking up figures by hand. |
| `bh.py` | Drill-down through the federal budget on bundeshaushalt.de, for looking up budget titles by hand. |
| `xlsx.py` | Minimal reader for `.xlsx` files (no dependencies). |

## Sources and the cache

`.cache/` holds the downloaded files and is not in git. It is the exact data vintage the pack was built
from (downloaded 17 and 18 November 2026). Eurostat revises its tables several times a year, so a fresh
download will usually not reproduce the pack. The cache also contains the documents behind the measures in
`policies.json` (Bundestag papers, studies); no script reads those.

| Cache file | Source | Used for |
|---|---|---|
| `exp_2024_full.tsv` | Eurostat `gov_10a_exp`, Germany 2024, all sectors | expenditure amounts by COFOG group; level shares |
| `main_2024.tsv` | Eurostat `gov_10a_main`, Germany 2024 | official totals; taxes, sales, property income and transfers by level; EU contribution |
| `ntl/ntl.xlsx`, `ntl_de.tsv` | Eurostat National Tax Lists, sheet DE | every tax and social contribution by national name |
| `bh_*.json` | bundeshaushalt.de, actuals 2024 | Bürgergeld, MPs' pay, parental allowance, solidarity surcharge, earmarked federal transfers |
| `ba/zr-gruarb.xlsx` | Federal Employment Agency, basic income support time series | housing costs under Bürgergeld |
| `bt/2101069.pdf` | Bundestag printed paper 21/1069 | payment entitlements by nationality |
| `drv/rv_in_zahlen.pdf`, `drv/abbVIII51.pdf` | pension insurance statistics | pension expenditure and its split by pension type |
| `est/lest2022.xlsx`, `est/csv02.tsv` | Destatis wage and income tax statistics 2022, table 73111-02 | income distribution |
| `est/csv04.tsv` | the same workbook, table 73111-04 (wage tax cases by gross wage) | earnings distribution; wage share of pension contributions |
| `drv/rv_in_zeitreihen.pdf` | pension insurance time series | contribution revenue 2022 and 2024; average earnings 2022 and 2024 (uprating factor) |
| `gkv/kj1_2024.pdf` | health insurance, final accounts 2024 (KJ 1) | contributions of compulsory and other members |
| `ecb/dwa_de.csv` | ECB Distributional Wealth Accounts, Germany | wealth distribution |

Figures from PDFs, from the federal budget and from the tax list were read by hand and typed into
`build_budget.py`. Only the three files named at the top of `fetch_inputs.py` are parsed by the scripts.

## What is data and what is judgement

Data, taken as published:

- every amount on a COFOG group, every tax and contribution, and the totals. The leaves sum to Eurostat's
  total revenue and expenditure for 2024;
- the cash figures of individually named items (Bürgergeld, housing costs, asylum seekers' benefits,
  unemployment benefit, parental allowance, MPs' pay, EU contribution);
- the split of taxes, sales, property income and current transfers across levels where Eurostat reports
  it by level;
- counts and totals per income class and per wage class; wealth totals of the bottom half, deciles 6 to 10
  and the top 5 %;
- contributions to health insurance from compulsorily insured employees and from other members, as booked
  in the insurers' accounts.

Arithmetic on published figures:

- remainder leaves: a group total minus the named cash items. Group totals are national accounts, the
  named items are cash, so a remainder is only approximately right;
- the revision leaf: Eurostat's latest total expenditure minus the sum of the older COFOG table;
- statutory pensions by type: pension expenditure times the published shares;
- the solidarity surcharge: federal cash receipts, deducted from the national-accounts tax lines;
- level splits of shared taxes: statutory shares, adjusted to Eurostat's amounts by level because the city
  states count as state government;
- couples in the income distribution: jointly assessed couples are counted as two persons with half the
  income each, because the tax schedule is applied that way;
- the remainder leaf of contributions on wages: the national-accounts total minus the cash figures for
  pension and health insurance;
- the zero-amount leaf "pension contributions of the state for its civil servants": it exists so that a
  measure can book such contributions; its level shares are the imputed contributions by level;
- the zero-amount leaf "replacement benefits for people excluded from citizen's income": it receives the
  benefits that states and municipalities would pay if groups lost citizen's income; its level shares are
  copied from asylum seekers' benefits;
- VAT by rate: the revenue at the reduced rate is not published. It is derived from the government's
  estimates of revenue forgone at 7 instead of 19 % (all reduced rates, food, accommodation, culture, local
  transport, and restaurant meals, which were at the standard rate in 2024): revenue forgone / 12 * 7, or
  * 19 for restaurants. The standard-rate remainder is total VAT minus these. Every VAT leaf has the level
  shares of VAT as a whole;
- the alcohol and coffee taxes as two leaves: beer tax (states) and the other excise duties (federal), so
  that the level shares are the statutory ones instead of a rounded mix.

Judgement, to be reviewed by whoever updates the data:

- **Payer weights for transfers to recipients outside government** (`EXT` in `levels.py`). Eurostat does
  not publish which level pays them.
- **Seed weights** (`seed=` in `build_budget.py`). Eurostat publishes levels only for the ten divisions,
  not for the groups inside them. The seeds say roughly who is responsible for a task; the fit makes the
  division totals come out right. A different seed moves money between leaves of the same division, never
  between divisions or levels overall.
- **Fixed assignments** (`fixed=`), for example prisons to the states and development aid to the federal
  level.
- **Which transfers between levels count as earmarked** and are moved to the payer (the `move(...)` calls):
  federal funding of pension and health insurance, housing costs, basic security in old age, housing
  benefit, regional rail, student grants, social housing. General-purpose grants stay with the spender.
- **Merging COFOG 10.5, 10.6 and 10.7** into one group, because cash benefits cannot be assigned to
  one of them: housing costs under Bürgergeld alone exceed the cash benefits recorded under 10.6.
- **Levels of capital-transfer revenue** and of the revision leaf.
- **Wealth distribution**: thresholds between groups (geometric mean of neighbouring group means, since
  none are published), the lower bound of the first group, and above all the Pareto tail above the 90th
  percentile. It reproduces the published totals of the top 10 % and top 5 %; how wealth is spread inside
  the top 5 % is an assumption.
- **Income distribution**: the top class as a Pareto tail with the published class mean; the lower bound
  of the class with negative income.
- **Uprating to the base year** (`UPRATE` in `build_dist.py`): the latest income and wage statistics are
  from 2022, while measures compare them with 2024 thresholds (basic allowance, contribution ceilings).
  Every euro value of the income and the earnings distribution is therefore multiplied by the growth of
  average earnings of the insured from 2022 to 2024 (+12.0 %); the numbers of persons stay those of 2022.
  This assumes that all incomes grew at the same rate. Without it, relief at the bottom of a tax schedule
  comes out too large and revenue from high incomes too small.
- **VAT at 7 % as 7/12 of the revenue forgone** (`VAT_FORGONE` in `build_budget.py`): this assumes that the
  tax base is the same at 7 and at 19 %, which is how the government's figures are computed (full
  pass-through, no change in behaviour).
- **Share of pension contributions that comes from wages** (`PENSION_WAGE` in `build_budget.py`): the
  insurer's accounts do not split contributions by type. The share is 18.6 % of wages up to the 2022
  ceiling in the wage statistics, divided by total contributions in 2022, and is applied to 2024.

## Updating to a new year

1. Find the latest year in Eurostat `gov_10a_exp` with data for Germany. Set `YEAR` in `fetch_inputs.py`,
   move the old cache aside and run it. Check the download links in that file; two of them carry a release
   date or a year.
2. In `levels.py` point `load_exp` to the new table. Run `build_budget.py` without options: an assertion
   fails if the leaves of a division no longer sum to the Eurostat total.
3. Go through the constants in `build_budget.py` top to bottom and replace each with the new year's figure
   from the source named beside it (`bh.py` and `es.py` help). The texts in notes and descriptions quote
   some of these figures and need the same update.
4. `TE_LATEST` and `TR_LATEST` are the totals of `gov_10a_main`. If they equal the sum of the COFOG table,
   the revision leaf becomes zero and should be removed.
5. Rebuild, run `npm run validate`, and compare the level totals printed by `build_budget.py` with the
   previous year. Large jumps usually mean a transfer was reclassified.
6. Set `UPRATE` in `build_dist.py` to the growth of average earnings from the statistics year to the new
   base year (1 if both are the same year), and the schedules and ceilings in `check_distributions.py` to
   the new years.
7. The measures in `policies.json` refer to node ids, breakdown group ids and amounts from these files. The
   curve measures (`income_tax_schedule`, `pension_contribution_schedule`, `health_contribution_schedule`)
   carry the legal schedule of the base year as `baseline` and as the default of their curve; a new base
   year needs the new schedule, new presets in that year's values and new example incomes
   (`check_distributions.py` prints what the baselines yield).
