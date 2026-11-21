# United States: how the budget data is built

`build_budget.py` produces `countries/us/budget.json`, the federal budget of fiscal year 2025 (October 2024 to
September 2025) in the unified budget, from the files of the Office of Management and Budget (OMB). `build_dist.py`
produces `countries/us/distributions/wages.json`, the wages per worker that the Social Security measure is
calculated on. `debt.py` produces `countries/us/debt.json`, the projection of debt and interest. The other pack files
(`country.json`, `sources.json`, `policies.json`) are maintained by hand;
`build_budget.py --check` also compares the GDP and population in `country.json` with the cached sources, and
`measures.py --check` recomputes the constants that the measures in `policies.json` take from sources. One measure's
effects are generated: `workforce.py` derives what each spending leaf pays its civilian staff, and
`measures.py --write` turns that into the effects of `federal_workforce_cut`. The source ids used in the scripts are
the keys of `countries/us/sources.json`.

## Run it

Python 3.9 or newer, standard library only (the `.xlsx` reader is `pipeline/de/xlsx.py`). From the repository root:

```
python3 pipeline/us/fetch_inputs.py            # download what is missing into pipeline/us/.cache/
python3 pipeline/us/build_budget.py            # diagnostics: checks, reconciliation with Treasury, every leaf
python3 pipeline/us/build_budget.py --check    # rebuild in memory, compare with budget.json and country.json
python3 pipeline/us/build_budget.py --write    # replace budget.json
python3 pipeline/us/build_dist.py --check      # the same for distributions/wages.json (--write to replace it)
python3 pipeline/us/workforce.py              # diagnostics: civilian staff costs by leaf, checked against OMB's total
python3 pipeline/us/measures.py --check        # the figures behind the measures, compared with policies.json
python3 pipeline/us/households.py             # diagnostics: the figures of the measures added in November 2026
python3 pipeline/us/measures.py --write        # rewrite the generated effects and the computed constants
python3 pipeline/us/debt.py                    # diagnostics: the figures behind debt.json, the refinancing fit
python3 pipeline/us/debt.py --check            # rebuild debt.json in memory and compare (--write to replace it)
npm run validate                               # then check the whole pack
```

With the cache as downloaded on 20 and 21 November 2026, the four checks report no difference.
Every run, with or without an option, stops with an error if the leaves do not add up to OMB's published totals.

## Sources and the cache

`.cache/` holds the downloaded files, one folder per publisher, and is not in git (127 MB, of which 77 MB are the
Trustees Report and 12 MB the BEA flat file). Nothing in it is executed or imported. OMB rarely replaces a Budget's files after publication, and the
Monthly Treasury Statement for a given month is fixed, so a fresh download should reproduce the pack; BEA's flat file
is replaced with every NIPA release, which can change the one BEA figure quoted in a note.

| Cache file | Source | Used for |
|---|---|---|
| `omb/outlays_fy2027.xlsx` | OMB Public Budget Database, Budget for FY 2027 (April 2026): outlays by account, subfunction and category, thousand dollars | every spending leaf |
| `omb/receipts_fy2027.xlsx` | the same database: receipts by account and source | every revenue leaf |
| `omb/hist01z1_fy2027.xlsx` | Historical Table 1.1 | check: receipts, outlays, deficit |
| `omb/hist02z1_fy2027.xlsx` | Historical Table 2.1 | check: receipts by source |
| `omb/hist03z2_fy2027.xlsx` | Historical Table 3.2 | check: every subfunction and the defence titles; function totals in texts |
| `omb/hist10z1_fy2027.xlsx` | Historical Table 10.1 | GDP by fiscal year (`country.json`) |
| `omb/ap_4_tables_fy2027.xlsx` | Analytical Perspectives, Table 4-1 | note on student loans |
| `mts/mts_table_{1,3,4,9}_2025-09-30.csv` | Treasury, Monthly Treasury Statement for September 2025, through the Fiscal Data API | reconciliation; receipts before refunds |
| `mts/mts_table_{1,3,4,9}_2026-09-30.csv` | the same for September 2026 | fiscal year 2026 figures in notes and the method note |
| `census/NST-EST2025-ALLDATA.csv` | Census Bureau, population estimates, Vintage 2025 | population (`country.json`) |
| `bea/NipaDataA.txt` | BEA, all annual NIPA series | Table 3.18B: national-accounts comparison, Medicare premiums |
| `irs/p15--2025.pdf` | IRS Publication 15 (2025) | payroll tax rates and wage base in descriptions (read by hand) |
| `irs/23in01w2all.xlsx` | IRS Statistics of Income, Form W-2 statistics 2023 (October 2026), Table 1 | `build_dist.py`: wages per worker |
| `census/ft900_exh1.xlsx` | Census Bureau, FT-900 release of November 2026, Exhibit 1 (the address always holds the latest release) | `measures.py`: goods imports for the tariff measure |
| `mts/mts_table_5_*.csv` | Monthly Treasury Statement, Table 5 (outlays by agency) | `measures.py`: CBP and ICE outlays in 2025 and 2026; `workforce.py`: administrative expenses of the Social Security trust funds |
| `omb/objclass_detail_fy2027.xlsx` | OMB, object class detail of the Budget for FY 2027: obligations by account, object class, direct or reimbursable, $ million | `workforce.py`: civilian pay and benefits of 2025 per leaf |
| `omb/ap_5_tables_1-3_fy2027.xlsx` | Analytical Perspectives, Tables 5-1 to 5-3: civilian FTE, pay and benefits | `workforce.py`: check of the personnel base, figures on the card |
| `bls/ces_CES9091100001.json` | BLS Current Employment Statistics, federal employment except the Postal Service, through the public API (always the latest data) | `workforce.py`: employment quoted on the card |
| `census/nc-est2025-agesex-res.csv`, `irs/23in12ms.xls`, `irs/23in35tr.xls`, `irs/23in36tr.xls`, `fed/dfa.zip`, `fns/snap-zip-fy69tocurrent-11.zip` (with `fns/FY25.xlsx` extracted), `cms/202?-oep-state-level-public-use-file.zip` | Census population by age 2025; IRS Statistics of Income 2023, Tables 1.2, 3.5, 3.6; Federal Reserve, Distributional Financial Accounts; FNS SNAP state data FY 2025; CMS Marketplace open enrollment 2025 and 2026 | `households.py`: the measures added in November 2026 |
| `omb/hist03z1_fy2027.xlsx`, `omb/hist07z1_fy2027.xlsx` | Historical Tables 3.1 (outlays by function, with the Budget's estimates to 2031) and 7.1 (federal debt) | `debt.py`: the stock, net interest, defense, the President's Budget path, history |
| `omb/ap_12_tables_fy2027.xlsx`, `omb/ap_12_current_services_fy2027.pdf` | Analytical Perspectives, chapter 12: Table 12-6 (outlays and net interest in the baseline to 2036); Tables 12-2 and 12-4 only in the PDF | `debt.py`: the baseline path; GDP and receipts for 2032-2036 read by hand |
| `omb/ap_11_tables_fy2027.xlsx`, `omb/ap_11_borrowing_fy2027.pdf` | Analytical Perspectives, chapter 11: Table 11-2 (other transactions affecting borrowing), average maturity | `debt.py`: other means of financing; check of the maturity |
| `omb/ap_1_assumptions_fy2027.pdf` | Analytical Perspectives, chapter 1: Table 1-3 (sensitivity of the budget to rates) | `debt.py`: the refinancing share (read by hand) |
| `omb/MSR_2027.pdf` | Mid-Session Review of the Budget for FY 2027 (September 2026) | read by hand: it updates no totals |
| `mts/mts_table_6_*.csv` | Monthly Treasury Statement, Table 6 (means of financing), through the Fiscal Data API | `debt.py`: debt held by the public at the end of FY 2026, borrowing |
| `treasury/mspd_table_3_market_2025-09-30.csv`, `treasury/mspd_table_2_2026-10-31.csv` | Treasury, Monthly Statement of the Public Debt, Tables III (marketable securities by CUSIP) and II (debt limit), through the Fiscal Data API | `debt.py`: maturities, the weights of the market rate, the debt limit |
| `treasury/yield_curve_{2026,1991-2000,2012-2021}.csv` | Treasury, daily par yield curve rates, one file per year | `debt.py`: the market rate (the latest day) and two presets |
| `treasury/executive-summary-2025.pdf` | Treasury, Executive Summary to the FY 2025 Financial Report | `debt.py`: long-term projection of the primary deficit (read by hand) |
| `fed/fomcprojtabl20260916.htm` | Federal Reserve, Summary of Economic Projections, September 2026 | `debt.py`: longer-run growth; the projected federal funds rate in the market-rate note |
| `fed/h41_20251002.htm` | Federal Reserve, H.4.1 of October 2, 2025, Table 6 | `debt.py`: the deferred asset of the Reserve Banks (interest note) |
| `mts/mts_table_4_2026-02-28.csv` | Monthly Treasury Statement for February 2026, Table 4 | `measures.py`, `debt.py`: customs refunds before and after the Supreme Court's ruling of February 20, 2026 |
| `govinfo/PLAW-119publ98.xml`, `omb/ap_5_tables_1-3_fy2027.xlsx` | the Secure America Act; Analytical Perspectives, Table 5-1 | `debt.py`: the act's appropriations added up, civilian employment in 2025 and 2026 (baseline note) |
| `govinfo/PLAW-119-public.zip` | all public laws of the 119th Congress (the address always holds the latest) | `debt.py`: no law after P.L. 119-103 appropriates for FY 2027 |
| `govinfo/`, `house/`, `scotus/`, `fr/`, `nato/`, `treasury/`, `irs/p5901.pdf`, `omb/ap_5_management_fy2027.pdf` | laws, bills and their status, a House roll call, the Trustees Report, presidential remarks, Supreme Court decisions and orders, Federal Register documents, NATO, Treasury, IRS and OMB documents (list in `fetch_inputs.py`) | read by hand for the measures' notes and catches |

## How the tree is built

Every row of the Public Budget Database with a value for 2025 goes to exactly one leaf. A leaf names the rows it
takes (`take`: subfunction, agency, bureau, account) and the subfunctions whose remaining rows it collects (`rest`).
The script stops if a row is taken twice, if a row with a value is left over, or if a leaf is negative, which the pack
format does not allow. The leaves then add up to Historical Table 1.1 to the thousand dollars, and each subfunction
and each defence title to Table 3.2 to the million; `build_budget.py` prints both checks.

One revenue leaf is empty on purpose: `rev.wealth_tax`, for measures that would introduce a tax the federal
government does not levy.

Spending follows OMB's functions. Below them are subfunctions, and where the debate needs a single programme, the
accounts of that programme: Social Security by trust fund, Medicare by part, Medicaid, CHIP, the premium tax credits,
SNAP, SSI, the refundable parts of the earned income and child tax credits, TANF, the FEMA Disaster Relief Fund,
CBP, ICE, the IRS, and the Department of Defense by title. Revenue follows OMB's source categories, with the payroll
taxes by trust fund and the larger excise taxes by account.

## What is data and what is arrangement

Data, taken as published: every account and subfunction amount, the totals, and the receipts before and after
refunds quoted in notes.

Arithmetic within OMB's classification (quality `derived`):

- remainder leaves: a subfunction less the accounts shown on their own;
- leaves that combine subfunctions or bureaus, such as highways (Federal Highway Administration in subfunction 401);
- Medicare by part: each trust fund account less the premiums and refunds booked to it, so that the premiums are
  netted where OMB nets them in total;
- higher education (subfunction 502) was −$35.0 billion in 2025, because the student loan programmes booked
  negative subsidies of $132.9 billion; it is combined with schools (501) and education research (503);
- the Foreign Military Sales trust fund (in subfunction 155, which was −$14.9 billion) is netted with security
  assistance (152), whose grants are spent through it; the rest of 155 goes with diplomacy (153, 154).

Arrangement across OMB's functions, marked "own allocation" in the notes (quality `derived`). The format allows no
negative amounts, and OMB books these receipts as negative spending that belongs to no function, or to a function
that is negative as a whole:

| Receipts (fiscal year 2025) | OMB code | Deducted from |
|---|---|---|
| employer contributions of agencies for their own staff to the retirement funds, Social Security and Medicare, $144.4 billion | 951, 952 | federal civilian and military pensions (602) |
| net receipts of federal mortgage guarantees (FHA, Ginnie Mae, GSE fees), $40.7 billion | 371 | housing assistance (604) |
| net receipts of deposit insurance (FDIC), $32.2 billion | 373 | other advancement of commerce (376) |
| rents and royalties on the Outer Continental Shelf, sales of major assets, $5.8 billion | 953, 954 | conservation and land management (302) |

The receipts, outlays and deficit stay OMB's. Three groups differ from OMB's function totals because of it: income
security ($516.5 billion against $701.6 billion), commerce ($12.6 billion against −$28.1 billion for "commerce and
housing credit") and natural resources ($84.0 billion against $89.8 billion); undistributed offsetting receipts
(−$150.3 billion) have no group. Each group says so in its description.

Net interest is one leaf (function 900, $970.1 billion): gross interest on Treasury securities less the interest
credited to federal trust funds, less other interest and investment income. A leaf for interest on the debt held by
the public alone would need a negative leaf for the other interest received.

## Official sources compared

| Fiscal year 2025, billion dollars | Receipts | Outlays | Deficit |
|---|---|---|---|
| OMB, Historical Table 1.1 (the pack) | 5,236.421 | 7,011.105 | 1,774.684 |
| Treasury, Monthly Treasury Statement for September 2025 | 5,234.616 | 7,009.974 | 1,775.357 |
| BEA, NIPA Table 3.18B, budget lines | 5,234.602 | 7,009.827 | 1,775.225 |
| BEA, NIPA Table 3.18B, national accounts | 5,550.020 (current receipts) | 7,409.936 (current expenditures) | 1,859.917 (net federal saving, negative) |

OMB's actuals include corrections that agencies reported after Treasury's final statement; the difference sits
mainly in miscellaneous receipts (+$1.8 billion) and, by function, in general government (+$4.3 billion), education
(+$2.8 billion), community development (−$2.2 billion), justice (−$2.0 billion) and agriculture (−$1.9 billion), where
OMB and Treasury also classify some accounts differently. `build_budget.py` prints the table by function. The pack
follows OMB, because only OMB publishes the account detail with the subfunction of every account. Treasury's
statement for September 2026 later revised its fiscal year 2025 outlays to $7,009.986 billion.

The Congressional Budget Office's figures could not be retrieved (cbo.gov refuses automated downloads) and are not
used.

## Updating to a new year

1. The Budget for fiscal year 2028 brings fiscal year 2026 actuals. Change the file names in `fetch_inputs.py`
   (`fy2027` to `fy2028`, the upload month in the path), the MTS dates, and the Census vintage; set `YEAR` in
   `build_budget.py`; move the old cache aside and fetch.
2. Run `build_budget.py`. It stops at any rule that no longer matches a row (an account renumbered or moved to
   another subfunction) and at any leaf that has become negative; adjust the rules or combine the leaf with its
   neighbour, and say so in the note.
3. Read the notes in the output: they quote figures computed from the cache, but their wording (which items net
   out, which programmes dominate a remainder) has to be checked against the new year.
4. Update GDP and population in `country.json` (the diagnostics print them), the base year and its label, the
   totals in the method note, and the `accessed` dates and notes in `sources.json`.
5. Rebuild with `--write`, run `--check` and `npm run validate`.

## The measures

`policies.json` is written by hand, like the German one, and every note shows its arithmetic. The constants that
come from a source are recomputed by `measures.py` (`--check` fails if `policies.json` holds another value):

| Measure | Constant | How |
|---|---|---|
| `defense_spending_gdp` | offset −0.0322 | NATO's estimate of US defence spending in 2025, 3.22 % of GDP (read by hand from the NATO report); the effect adds the difference to the target times GDP |
| `corporate_tax_rate` | factor 0.038701 × rate + 0.187279 | Treasury's estimate for a 28 % rate in fiscal year 2025 ($122.5 billion, read by hand) divided by the static gain on 2025 receipts ($452.1 billion × 7/21): 81.3 %, applied to every point of rate change |
| `tariff_all_imports` | $27.857 billion per point | goods imports from October 2024 to September 2025 (FT-900, $3,482.1 billion) × 1 % × (1 − 0.20) |
| `tariff_all_imports` | offset 0.221 | the Joint Committee on Taxation's income and payroll tax offset for 2025 (JCX-11-21, read by hand) |

The Social Security measure needs no constant: the engine applies the old and the new rate curve to
`distributions/wages.json` and carries the relative change over to the payroll taxes. `build_dist.py` prints what
the 2025 rule and a rule without a cap yield on the distribution (without a cap the taxable wages are 17.9 % higher)
and checks the bins against Table 1.H, which gives the same wages by multiples of the wage limit.

### The federal workforce (`federal_workforce_cut`)

The measure has four params, the share of civilian positions cut in four groups of agencies: the Department of
Defense (OMB agency 007), veterans' health care (Veterans Affairs staff whose costs lie in subfunction 703, including
medical staff paid from the Toxic Exposures Fund), the Departments of Homeland Security and Justice (024, 011), and
all other agencies of the executive branch. Its effects are generated, not written by hand: `workforce.py` derives
what each spending leaf paid its civilian staff in 2025, and `measures.py --write` makes one `add` effect per leaf
and group (the group's param times the cost) plus one effect per group on federal pensions (602). `--check`
compares all of them, notes included, with `policies.json`.

The base is object classes 11.1, 11.3, 11.5 and 12.1 (civilian pay and benefits) of the executive branch without
the Postal Service in OMB's object class file: $383.299 billion, equal to Table 5-3 of the Analytical Perspectives
to the million; the script stops if they differ. Legislative branch ($4.4 billion), judiciary ($5.6 billion), Postal
Service ($65.0 billion) and military pay (11.6, 11.7, 12.2) are not in it. The file gives the account of every
amount; which leaf an account belongs to comes from `build_budget.py`'s assignment of the Public Budget Database.
Of the base, $269.5 billion lands in a leaf directly; the rest is placed by the script's own rules, which every
effect's note names with its amount:

- an account whose outlays lie in several leaves within its default subfunction, or whose default is a whole
  function or "multiple" (the FBI's salaries, for example, which OMB books partly to defence-related activities),
  is split by its positive outlays per leaf ($46.4 billion);
- reimbursable obligations, work an account does for others such as the Defense working capital funds, are spread
  over the same agency's leaves like its direct costs, because the paying accounts bear the saving ($59.4 billion);
- Social Security's administrative account, which the database does not list as an account of its own, is split
  between the two trust funds by their administrative expenses in the Monthly Treasury Statement ($7.9 billion);
- leaf and group pairs below $1 billion are added to the group's largest pair in the same function (or the group's
  largest overall, $0.3 billion), which leaves 40 pairs.

The agencies' contributions to the civil service and Foreign Service retirement funds are offsetting receipts
netted in federal pensions (see the table above); fewer employees pay less of them, so that leaf rises. The share is
the contributions of 2025 ($50.4 billion, accounts 813520 and 818640), the executive branch's part by its share of
civilian pay, over the base: 12.84 %. Employer Social Security and Medicare taxes are not netted out in the same
way, because the measure assumes that those who leave work elsewhere and their new employers pay these taxes.
Four leaves have staff costs above their net outlays, because fees and other receipts are netted against them:
other law enforcement (immigration and customs fees), commerce (deposit insurance), food, drug and workplace safety
(the FDA's user fees, within its account) and the Defense revolving funds. The params stop at 50 %, where no leaf is
cut below zero.

### The measures added in November 2026

`households.py` computes their figures from the cache; the IRS tables are old Excel files, read by `xls.py`
(standard library). `measures.py --check` compares every constant with `policies.json`, and `--write` sets them.

| Measure | Constant | How |
|---|---|---|
| `social_security_benefit_tax` | −$1.005B per point | income of the trust funds from the taxation of benefits under IRC 86 in fiscal year 2025: OASDI $59.4B (Trustees Report, Table VI.C3, without the $335M withheld from nonresident aliens under IRC 871(a)(3), which H.R. 1040 does not end) and HI $41.1B (Medicare Trustees Report, Table V.H1), read by hand |
| `tariff_rebate_checks` | $273.3M per dollar | Census population of July 1, 2025 without the 4.5 million aged 17, who are neither qualifying children (IRC 24(c): under 17) nor eligible as dependents (337.3 million), less the phase-out of S. 2475 on the IRS's 2023 returns by AGI and filing status (Table 1.2): 19.0 % at $600 |
| `aca_enhanced_credits` | outlays −$13.8B, income tax +$8.0B when the enhancement ends in full | Treasury's estimate for making the enhancement permanent, fiscal year 2027 (Greenbook FY 2025, read by hand) |
| `wealth_tax` | $142.7B and $38.2B per point | a Pareto tail through the top 1 % and top 0.1 % of the Distributional Financial Accounts (2025 Q3): net worth between $50 million and $1 billion above the threshold, and above $1 billion |
| `top_income_tax_rate` | $5.50B per point above 37 % | income taxed at 37 % on returns with AGI of $1 million or more (IRS Table 3.5), less, for each return taxed at 37 %, the income between the 2023 threshold of the 37 % rate (Rev. Proc. 2022-38) and the bill's threshold for 2023: the bill's amounts are in 2018 dollars and indexed (sec. 2(f)), so each is raised by the factor that took the same filing status's 37 % threshold from the bill's table to 2023 ($2,312,500 joint, $1,156,250 single). The gap is weighted by the filing statuses of all returns in the same AGI class (Table 1.2); Table 3.6 has them only for all returns taxed at 37 %, AGI below $1 million included |
| `snap_state_cost_share` | −$741M per point of the top share | FY 2025 benefits by state (FNS) in the tiers of P.L. 119-21 sec. 10105 by each state's FY 2025 payment error rate (read by hand from FNS's PDF; the benefit-weighted mean, 10.63 %, is checked against the national 10.62 %) |

Data, taken as published: outlays and receipts of 2025 in the budget, imports, NATO's estimate, Treasury's revenue
estimate, the JCT offset, wages by size class, the wage limits, civilian pay and benefits by account.

Judgement, marked "own judgment" or "own assumption" in the notes:

- **Ranges.** The low and high multipliers of all seven measures (foreign aid 0.6 to 1.0, defence ±10 %,
  enforcement 0.8 to 1.0, wage cap 0.75 to 1.0, corporate rate 0.7 to 1.1, tariff 0.75 to 1.125 and the offset
  20 % to 25 %, federal workforce 0.6 to 1.0, tax on benefits 0.85 to 1.0, rebate 0.85 to 1.05, ACA credits 0.9 to
  1.5, wealth tax 0.5 to 1.0, top rate 0.6 to 1.0, SNAP share 0.5 to 1.0).
- **The federal workforce's allocation** to leaves where the object class file does not give it (above), and the
  executive branch's share of the retirement contributions.
- **The tariff's import loss** of 20 % (range 10 % to 40 %): no official estimate could be retrieved; the
  Congressional Budget Office's estimates of the tariffs' budgetary effects are on cbo.gov, which refuses
  automated downloads.
- **The corporate rate**: Treasury's share for 28 % is applied linearly to every rate, up and down.
- **The rebate's phase-out**: incomes evenly spread within each AGI class, children in proportion to adults.
- **The wealth tax's distribution**: the Pareto tail is an assumption; the Federal Reserve publishes no count of
  households above $1 billion.
- **Wages**: per taxpayer on a tax return, uprated from 2023 to 2025 by the growth of the wage limit; the relative
  change is applied to the self-employment tax as well.

## The debt projection (`debt.py`)

`debt.py` writes the whole of `countries/us/debt.json`, its texts included: every number in it is computed from the
cache. Figures that only a PDF holds are constants marked HAND with the page; where a workbook holds the same figure for
other years, the script checks the hand-read values against it (Table 12-4 against Historical Table 2.1, Table 12-2
against Table 10.1, the average maturity against OMB's 71 months). It stops if the stock and flows do not fit: net
interest against the budget item, Table 11-2 against the change in debt less the deficit, the MTS totals.

| Field | Value | How |
|---|---|---|
| `stock` | $30.17T | debt held by the public at the end of FY 2025, Historical Table 7.1: the debt the deficits add to, at OMB's measure, the one net interest goes with |
| `interest` | $970.1B, node `exp.net_interest` | net interest, Table 3.1 (function 900), equal to the budget item |
| `refinancing.share` | 0.24 (derived) | the engine's recursion (`fit_refinancing`) from FY 2025, on OMB's primary balances (President's Budget to 2031, baseline to 2036) at OMB's rates weighted like the debt (3.2%), run once as it is and once with all rates one point higher from January 1, 2026; the share, in steps of 0.01, whose extra interest comes closest to Table 1-3 in FY 2027 to 2036. 1/average maturity (0.17) misses FY 2027 by 29%, the share repricing within a year (0.34) overshoots by 8% to 23% |
| `refinancing.averageMaturity` | 5.91 years | MSPD Table III, by amount outstanding |
| `market_rate` default | 4.8% | the par yield curve of the latest day in the 2026 file (November 20, 2026), held for the whole horizon, each marketable security at the yield of its term at issue (a bill at the term its CUSIP was first issued for; all bills at three months give 4.77%), floating-rate notes at three months, weighted by amount outstanding at the end of FY 2025. The note gives the Federal Reserve's projected federal funds rate (September 2026) beside it; no preset for lower short rates, as no source gives a matching long end |
| `growth` default | 4.0% | the Federal Reserve's longer-run real growth (2.0%) plus its 2% inflation target |
| presets | 3.2% and 4.9%; 1.6%; 6.0%; drift −0.07 | OMB's economics from 2032 (rates weighted the same way, FY GDP growth); the same weighting over the daily curves of 2012-2021 and 1991-2000; the rise of the primary deficit in Treasury's long-term projection from 2.7% (2025) to 4.2% (2046), which the preset's label and note limit to 2046, as Treasury's deficit falls back afterwards |
| `plans` | baseline to FY 2036, President's Budget to FY 2031 | balance, net interest, net interest over receipts and growth per fiscal year; OMB projects no debt, so the projection follows their primary balance. The notes also compute what the baseline already holds (civilian employment, Table 5-1; international affairs and defense, Table 12-6) and what it lacks (the Secure America Act, P.L. 119-98, its appropriations added up) |
| `references` | FY 1946, FY 1991 | the highest debt held by the public relative to GDP, and the highest share of net interest in receipts and GDP before FY 2025, from Tables 1.1, 3.1, 7.1 and 10.1 |
| `measuresFrom` | FY 2028 | the end date of the continuing resolution is read from P.L. 119-103, the newest appropriations law in govinfo's archive of public laws (which runs to P.L. 119-142 of November 10, 2026) |

The starting path is the FY 2025 budget continued (no `follow`). The note in `debt.json` says why OMB's paths are not
the default and what the projection leaves out.

The Congressional Budget Office's baseline projects debt held by the public as well, under current law and on economics
that do not assume the President's proposals, but cbo.gov refuses automated downloads. To add it as a plan, download by
hand the workbooks "10-Year Budget Projections" and "10-Year Economic Projections" of CBO's latest Budget and Economic
Outlook from https://www.cbo.gov/data/budget-economic-data into `.cache/cbo/` and read them in `debt.py`: debt held by
the public by fiscal year (as `debtRatio`), revenues, outlays, net interest and fiscal-year GDP. Followed by its debt
ratios, the projection would then meet CBO's debt, other means of financing included, instead of adding the deficit
alone. Check first how CBO values the debt: OMB's measure, the pack's stock, was $110B below Treasury's face value at
the end of FY 2025, and a plan on another measure would move the path by that much.
