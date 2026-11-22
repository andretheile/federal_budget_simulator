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
| `destatis/pd25_455_742.html`, `destatis/versorgungsempfaenger-ausgaben.csv`, `destatis/versorgungsempfaenger.html` | Destatis, statistics of pension recipients (press release of 17 December 2025, chart data, table) | civil servants' pensions and survivors' benefits 2024 and their split across levels |
| `bh_pdf/epl17_2024.pdf` | federal budget 2024, section 17 | split of title 1702 684 04 between the two programmes |

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
- basic income support in old age and for reduced earning capacity (SGB XII, chapter 4) as a leaf of its own: the
  federal reimbursement of the net expenditure (cash, budget title 1102 632 01). Like the housing costs it is
  assigned to the municipalities, which pay it out, when the shares are fitted, and then moved to the federal level;
  it used to be a part of the remainder leaf of the basic security group, which shrinks by the same amount;
- the support component of child benefit (`KG_SPENDING`): national accounts book as spending only the part of child
  benefit that goes beyond the tax exemption of the children's subsistence minimum, and gross up the taxes by the
  same amount (Destatis, WISTA 5/2019). That part is not published for 2024; the leaf is child benefit under the
  Income Tax Act paid in 2024 times the mean of its share in 2018 (Destatis) and 2026 (federal government), 45.5 %.
  It is taken out of the remainder of the family group, and its level shares are the statutory cost shares of child
  benefit (federal government and states 42.5 % each, municipalities 15 %);
- the zero-amount leaves "tax on sugar-sweetened drinks" and "tax on plastic packaging": neither tax was
  levied in 2024; both were debated with the 2027 federal budget. They exist so that a measure can book
  them, like the wealth tax; as excise duties they are federal (Article 106(1) of the Basic Law);
- the zero-amount leaf "one-off wealth levy": no such levy has been raised since the Lastenausgleich of 1952; Die
  Linke demands one. It exists so that a measure can book the yearly instalments. Unlike the wealth tax, which
  goes to the states, a one-off levy goes to the federal level alone (Article 106(1) no. 5 of the Basic Law); in
  national accounts it would be a capital tax (D.91);
- VAT by rate: the revenue at the reduced rate is not published. It is derived from the government's
  estimates of revenue forgone at 7 instead of 19 % (all reduced rates, food, accommodation, culture, local
  transport, and restaurant meals, which were at the standard rate in 2024): revenue forgone / 12 * 7, or
  * 19 for restaurants. The standard-rate remainder is total VAT minus these. Every VAT leaf has the level
  shares of VAT as a whole;
- the alcohol and coffee taxes as two leaves: beer tax (states) and the other excise duties (federal), so
  that the level shares are the statutory ones instead of a rounded mix;
- the administration of the social insurance funds as three leaves: compensation of employees (D.1) of the
  social security funds in health and in social protection, as Eurostat publishes it by subsector and
  division, and the health insurers' non-staff administrative costs from their accounts (KJ1: gross
  administrative costs less personal administrative costs and fees to associations, whose staff is already
  in D.1). They are taken out of health n.e.c. (COFOG 07.6) and social protection n.e.c. (10.9), which
  shrink by the same amounts, and belong wholly to the social insurance funds, so that a saving in their
  administration relieves the funds and not, through a node's shares, the federal, state or municipal
  budgets. Unlike the health benefit items, they carry no pro-rata share of the federal subsidy to health
  insurance, which is a fixed amount; the other health items carry correspondingly more of it;
- five items carved out of COFOG groups for measures, each a fixed leaf beside a fitted remainder of its group:
  the federal payments to the EEG account (cash 2024, Subsidy Report) out of fuel and energy (04.3); the federal
  funding for efficient buildings (BEG, cash 2024, Climate and Transformation Fund title 893 10) out of general
  economic affairs (04.1); the compensation for the Deutschlandticket (EUR 1.5 billion each from the federal
  government and the states, Regionalisation Act) out of transport (04.5), whose federal half is moved to the
  federal level with the rest of the regionalisation funds; the spending of ARD, ZDF and Deutschlandradio (KEF,
  average of 2021 to 2024) out of broadcasting (08.3); the states' payments to the churches (budgeted amounts
  2024, as compiled by the Humanistische Union) out of religious services (08.4). The remainders' seeds are set
  so that the fit leaves every other leaf of the division as it was (see the comment at `EEG_2024` in
  `build_budget.py`);
- the staff of the general administration as three leaves, one per level (`ADMIN_STAFF` in
  `build_budget.py`): compensation of employees (D.1) in general public services by level without research
  and foreign aid, split by full-time equivalents of the personnel statistics (Destatis, 30 June 2024)
  between political leadership and central administration (plus the foreign service at federal level) on
  the one hand and the tax administration and the Bundestag administration on the other. Civil servants
  carry their level's imputed pension contributions per full-time equivalent; the rest is divided by
  full-time equivalents. The leaves are taken out of 01.1 (the rest of the inside share), 01.3 and 01.6 (all
  of their D.1), whose leaves shrink by the same amounts. Each leaf belongs wholly to its level, so that a
  staff cut lands on the level that decides it; the group above carries the level shares as a breakdown that
  a measure can offer for choice, and each leaf carries the same groups with its own level at 1;
- three items carved out of a fitted leaf after the fit (`carve()` in `build_budget.py`): the item gets its
  own level shares, the leaf keeps what is left at each level, and no other leaf changes. Civil servants'
  pensions (56.9 bn) and their survivors' benefits (9.0 bn) in 2024, from the statistics of pension
  recipients, are taken out of the remainders of old age (10.2) and survivors (10.3); their level shares are
  the employers' shares of pension spending in 2024 (states 61.9 %, federal government with the railway fund
  and the Post successor companies 27.5 %, municipalities 8.5 %, other 2.1 %, split between social insurance
  and federal bodies by recipients). Title 1702 684 04 of the federal budget ("Demokratie leben!" and
  "Menschen stärken Menschen", 182.9 m actuals) is taken out of basic research (01.4) and is federal.

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
- **Where the social insurance administration sits.** Eurostat gives the funds' compensation of employees
  only per division. The leaves assume it lies in health n.e.c. (07.6) and social protection n.e.c. (10.9),
  the groups with by far the most compensation of employees in those divisions; part of the 10.9 amount may
  in fact belong to sickness and disability (10.1), for example the accident insurance. The health insurers'
  non-staff administrative costs are a cash figure assumed to lie in 07.6 as well.
- **What counts as general administration, and where its staff sits.** The leaves count the personnel
  statistics' "political leadership and central administration" and, at federal level, foreign affairs;
  the tax administration (tax offices, customs) stays in 01.1, as does the Bundestag administration, which
  is in the Bundestag's own item. Four assumptions: the tax and Bundestag administrations lie wholly in 01.1;
  research staff (01.4, 01.5) is split across levels like the research leaves were fitted before the split
  (federal 46.37 % of basic research, 41.43 % of R&D, the rest the states); the cost of an FTE in the general
  administration equals that in the tax administration of the same level apart from the imputed
  contributions; and the personnel statistics' functions match COFOG 01. The last is the weakest: per FTE the
  leaves come to EUR 77,900 (federal), 79,300 (states) and 76,800 (municipalities). From the average gross
  pay of all municipal staff in June 2024, with annual bonus, employer contributions and supplementary
  pensions, a rough count gives about EUR 71,000. Central administrations pay somewhat above the average, but
  the leaves may also include some staff that the personnel statistics assign to other functions.
- **The share of child benefit booked as spending in 2024** (`KG_SHARE` in `build_budget.py`): the mean of the
  published shares of 2018 and 2026. Because the leaf and the federal reimbursement of basic security in old age
  are fixed leaves, the fit of the other leaves of social protection changed slightly when they were added (for
  example asylum seekers' benefits: states 34.4 % instead of 36.6 %); the division totals by level did not.
- **Where the carved-out items sit in COFOG.** Civil servants' pensions are a cash figure; pensions paid for
  incapacity before the retirement age may in part be booked under sickness and disability (10.1) rather
  than old age. Survivors' benefits get the level shares of all pension spending, although survivors are
  more often federal (41.5 % of recipients against 31.5 % of pensioners). The federal budget assigns title
  1702 684 04 to function 165, research and experimental development outside universities; where national
  accounts book it is not published, and basic research is an assumption. A different place would move
  the amount between groups, not between levels.
- **Where the carved-out items sit in national accounts.** Eurostat does not publish them. The EEG payments are
  subsidies and fit in fuel and energy (04.3, subsidies EUR 26.3 billion). The building grants (EUR 14.1
  billion) are filed under housing in the federal budget, but housing development (06.1) has only EUR 3.3 billion
  of capital transfers at all levels; general economic affairs (04.1, EUR 21.5 billion) is the only group with
  room for them. The broadcasters' spending in national accounts is taken as the KEF's figure; the payments to
  the churches as the states' budgeted amounts, which fit in the current transfers of 08.4 (EUR 845 million).
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
