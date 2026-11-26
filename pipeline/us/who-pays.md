# United States: who pays the federal taxes (`countries/us/incidence.json`)

The "Who pays" view shows which income group pays which share of the federal taxes of fiscal year 2025, next to that
group's share of income, and how the visitor's measures change it. This file says where every figure of
`countries/us/incidence.json` comes from and how it is computed, for the fact-check. It was revised on November 26,
2026 after an independent fact-check (ten findings; the numbers held).

```
python3 pipeline/us/fetch_inputs.py      # downloads the inputs into pipeline/us/.cache/
python3 pipeline/us/who_pays.py          # diagnostics: every figure below, the checks, what the view shows today
python3 pipeline/us/who_pays.py --check  # recompute the numbers and compare them with incidence.json
python3 pipeline/us/who_pays.py --write  # write the computed numbers into incidence.json (texts stay as they are)
```

`who_pays.py` computes every number of the file except those read by hand from documents that are not tables (marked
`HAND` in the script): Treasury's estate-tax shares, the Tax Policy Center's table T24-0048 (an image), and, for
comparison only, the Penn Wharton Budget Model's averages. The texts of `incidence.json` are maintained by hand; their
figures are quoted from the output of the script.

## Sources and how they were retrieved (November 26, 2026)

| Source id | Document | Used for |
|---|---|---|
| `cbo_household_income_2023_data` | CBO, *The Distribution of Household Income, 2023* (September 2026), supplemental data, `62761-supp-data.xlsx` | groups, households, lower bounds, income shares, the shares of each tax, Table 9's rates |
| `cbo_household_income_2023_figures` | the same report's figure data, `62761-data.xlsx`, Figure 13 | refundable credits of the three lowest fifths: the bounds of the income-tax profile |
| `cbo_household_income_2023` | the report itself, `62761-Household-Income-2023.pdf` | definitions, the published headline (top 1%: 26% of federal taxes, p. 26) |
| `cbo_household_income_2021` | CBO, *The Distribution of Household Income in 2021* (September 2024), `60341-income.pdf`, Appendices A and D | who bears which tax (the 2023 report refers to this appendix for its methods, p. 8); the income concept (p. 37) |
| `cbo_tariffs_2025_06` | CBO, letter on the tariffs of January 6 to May 13, 2025 (June 4, 2025), `61389-Tariff-Effects.pdf` | that CBO has no table of the tariffs' burden by income group; what it says about goods and durables |
| `cbo_offset_2009` | CBO, *The Role of the 25 Percent Revenue Offset* (January 2009), pp. 2-3 (already in the pack; read again) | who bears the revenue offset of the tariff measure |
| `treasury_ota_distribution_2025` | Treasury, Office of Tax Analysis, Distribution Table 2025 001 (June 12, 2024) | estate and gift taxes; the other convention for customs duties |
| `tpc_t24_0048` | Tax Policy Center, Table T24-0048 (August 1, 2024), read in the Internet Archive's copy of its image | the measure `social_security_benefit_tax` |
| `pwbm_ss_benefits_2025` | Penn Wharton Budget Model, *Eliminating Income Taxes on Social Security Benefits* (February 7, 2025), Table 3 | the other published split of the same measure, named in the note |
| `irs_soi_w2_2023`, `irs_soi_2023_t12` | IRS Statistics of Income 2023: Form W-2 statistics Table 1.H; Table 1.2 | the measure `social_security_wage_cap` |
| `omb_pbd_receipts_fy2027` | OMB Public Budget Database, receipts, column 2025 | the split of unemployment insurance receipts |
| `hr_4280_2025` | H.R. 4280, section 2(a) to (d) (read again) | the thresholds of the top-rate measure |
| `fed_dfa` | Federal Reserve, Distributional Financial Accounts (`dfa.zip`, read again) | that it gives wealth by income group (`dfa-income-levels.csv`: pct00to20 … pct99to100) but not the households above $50M by income |

Read and not used: Treasury OTA, *Distribution of Premium Tax Credit by Family Income Percentile, 2018* (see the ACA
measure in section 8); CBO's tariff letter of December 18, 2024 (`61112-Tariffs.pdf`: no figures by income group).
BEA's GDP of 2023 (A191RC, $27,825,886M) is read by the script only to show why the file gives no income total
(section 2).

**cbo.gov refuses automated downloads** (it answers 403 with a captcha page), and so does taxpolicycenter.org. Their
files were retrieved from the Internet Archive's copies, as raw bytes (`https://web.archive.org/web/<timestamp>id_/<original
address>`). For each file the SHA-1 of the bytes received equals the digest the archive recorded for its capture:

| File | Capture | SHA-1 (base32, as in the archive's index) |
|---|---|---|
| `62761-supp-data.xlsx` | 2026-09-25 23:07:07 | `3JNZ5JIKHWZWEYVMCK4XYMHC6FK5WCN6` |
| `62761-data.xlsx` | 2026-09-26 15:53:22 | `YVK6WGG3Q4C5ZJ4SJ5Q6LZIGWS3ASHKZ` |
| `62761-Household-Income-2023.pdf` | 2026-09-26 15:19:37 | `MHCSPNJQDDMMKTCRLR75O65LPTD6RXG2` |
| `60341-income.pdf` | 2024-09-12 14:16:04 | `7HKGCGURGGZ4AIJLVE7KSHBOHK6YJGUQ` |
| `61389-Tariff-Effects.pdf` | 2025-06-04 16:26:55 | `4SJK2A3J3DOK4NYHW73SMXTQI6PZSG7D` |
| TPC `t24-0048.gif` | 2024-08-03 10:07:08 | `DHA4H454YKJVJAH6VNZDHPZECVTDH65V` |

The report of September 2026 is CBO's latest in the series: the archive's listing of cbo.gov's files from September to
November 2026 holds no later one, and the report itself covers "the most recent year for which such data are
available" (p. 2). The first version of this file said that `62761-data.xlsx` was not archived: the first capture in
the archive's index is a failed one, and the two good captures of the same day were missed.

## 1. Population and groups

CBO ranks households by income before transfers and taxes divided by the square root of household size (2021
report, p. 28); each quintile holds about a fifth of the *people* ("approximately equal numbers"; Table 1: 63.8M people
in the lowest fifth, 64.9M in each of the others), so the groups hold slightly different numbers of households.
Households whose losses exceed their other income (negative income) are in no group but in the totals (workbook,
sheet "Contents and Notes", cell A30). The view's groups are CBO's own: the four lower quintiles and the highest
quintile split into the 81st to 90th, 91st to 95th, 96th to 99th percentiles and the top 1%. That is the upper limit
the brief set; it keeps the top 10% and top 5% readable.

All figures: rows for 2023 of the workbook, all households.

| Group | Label | Households, M (Table 1, col. C) | Share | Lower bound, one person, 2023 $ (Table 2, row 55) |
|---|---|---|---|---|
| `q1` | Lowest fifth | 26.1 (row 100) | 0.196093 | none (the first group has no `from`) |
| `q2` | Second fifth | 27.1 (row 145) | 0.203606 | 31,800 (D55) |
| `q3` | Middle fifth | 27.0 (row 190) | 0.202855 | 53,700 (E55) |
| `q4` | Fourth fifth | 26.6 (row 235) | 0.199850 | 79,800 (F55) |
| `p81_90` | Top 11 to 20% | 13.2 (row 325) | 0.099174 | 122,200 (H55) |
| `p91_95` | Top 6 to 10% | 6.6 (row 370) | 0.049587 | 172,100 (I55) |
| `p96_99` | Top 2 to 5% | 5.2 (row 415) | 0.039068 | 240,800 (J55) |
| `top_1` | Top 1% | 1.3 (row 460) | 0.009767 | 549,000 (K55) |

- `population.count` = 133.1M, the sum of the groups; all households 133.7M (row 55), so about 0.6M have negative
  income (`population.note`). Shares = households / 133.1M, rounded to six places, the rounding put on the largest
  group. CBO rounds the numbers of households to 0.1M: the top 1% (1.3M) is uncertain by about 4% in that figure.
  `population.perUnit`: "per household".
- Lower bounds: Table 2, household size 1 (row 55), which is the ranking's own scale. For two people CBO gives
  $776,300 for the top 1% (row 100), for four $1,097,900 (row 190): the one-person figure times the square root of the
  household size, as the ranking text says.

## 2. Income

- Shares: Table 10, column D (income before transfers and taxes), rows as above: 3.8, 8.7, 13.5, 20.1, 14.6, 10.2,
  13.4, 16.4; they add up to 100.7 because the households with negative income have negative income. Divided by
  100.7: 0.037736, 0.086395, 0.134062, 0.199602, 0.144985, 0.101291, 0.133069, 0.162860.
- Concept (`income.concept`), from the 2021 report, Appendix D, p. 37: wages including the employer's payroll taxes
  and health insurance, the share of corporate income taxes CBO allocates to workers and to owners of capital, business
  income, realized capital gains, interest, dividends, rents, other income, and the social insurance benefits (Social
  Security, Medicare, regular unemployment insurance, workers' compensation).
- **No income total.** The first version carried CBO's 2023 income ($147,300 × 133.7M × 1.007 = $19,831.9B for the
  groups) to fiscal year 2025 with nominal GDP (× 30,322,847 / 27,825,886 = 1.08974, $21,611.5B). The taxes of FY 2025
  as a share of that income came out 2 to 5 points above CBO's average federal tax rates without the corporate tax
  (Table 9, column C minus F) in every group, and 14 points above for the lowest fifth:

| Group | FY 2025 taxes / income grown with GDP | CBO 2023, Table 9, federal minus corporate |
|---|---|---|
| Lowest fifth | 13.6% | -0.3% |
| Second fifth | 11.6% | 8.6% |
| Middle fifth | 14.6% | 12.4% |
| Fourth fifth | 18.7% | 16.1% |
| Top 11 to 20% | 22.2% | 19.1% |
| Top 6 to 10% | 24.6% | 21.1% |
| Top 2 to 5% | 27.4% | 23.5% |
| Top 1% | 31.4% | 26.0% |

  The reasons: FY 2025 receipts are larger than CBO's 2023 liabilities grown with GDP (individual income tax receipts
  of $2,656.0B against CBO's $1,978.8B × 1.090 = $2,156.4B); refundable credits are spending in this budget, not
  negative tax, which matters most for the lowest fifth; and the income of 2025 by group is not known. The file
  therefore gives no `income.total`, and the page shows no share of their income that the groups pay.

## 3. Profiles per tax

CBO's federal taxes are individual income, payroll, corporate income and excise taxes (report, p. 3). Its conventions
(2021 report, Appendix A, p. 27), which decide the result:

- individual income tax and the employee's share of payroll taxes: the households that pay them;
- the employer's share of payroll taxes: the employees, "because employers appear to pass on their share of payroll
  taxes to employees by paying lower wages"; **kept as CBO has it**, and said in the file's note;
- excise taxes: households by their consumption of the taxed goods; excises on intermediate goods by households'
  overall consumption;
- corporate income tax: 75% to owners of capital (interest, dividends, rents, adjusted capital gains), 25% to workers.
  **Not used**: by the owner's rule the corporate income tax goes to the payer "companies" (section 4).

Not allocated by CBO (2021 report, p. 21, note 9; workbook, "Contents and Notes", A49): the states' deposits for
unemployment insurance, estate and gift taxes, Federal Reserve earnings, customs duties, fees and fines.

Shares of each tax, Table 12, rows as above (percent):

| Group | All (C) | Individual income (D) | Payroll (E) | Corporate (F) | Excise (G) |
|---|---|---|---|---|---|
| q1 | 0.1 | -4.2 | 4.7 | 1.4 | 10.6 |
| q2 | 4.1 | -0.9 | 10.2 | 3.2 | 14.2 |
| q3 | 8.9 | 4.0 | 15.7 | 5.8 | 18.1 |
| q4 | 17.0 | 13.1 | 24.1 | 10.1 | 21.6 |
| p81_90 | 14.8 | 14.1 | 17.5 | 9.2 | 13.3 |
| p91_95 | 11.6 | 12.5 | 11.6 | 8.3 | 8.2 |
| p96_99 | 17.3 | 22.5 | 11.4 | 15.6 | 8.4 |
| top_1 | 26.1 | 38.8 | 4.6 | 45.4 | 5.3 |
| sum | 99.9 | 99.9 | 99.8 | 99.0 | 99.7 |

The profiles (percent, lowest group first; each is the list divided by its sum):

| Profile | q1 | q2 | q3 | q4 | 81-90 | 91-95 | 96-99 | top 1 | Quality |
|---|---|---|---|---|---|---|---|---|---|
| `individual_income_tax` | 0 | 0 | 3.81 | 12.48 | 13.43 | 11.90 | 21.43 | 36.95 | estimate |
| `payroll_taxes` | 4.71 | 10.22 | 15.73 | 24.15 | 17.54 | 11.62 | 11.42 | 4.61 | derived |
| `excise_taxes` | 10.63 | 14.24 | 18.15 | 21.66 | 13.34 | 8.22 | 8.43 | 5.32 | derived |
| `customs_duties` | 10.63 | 14.24 | 18.15 | 21.66 | 13.34 | 8.22 | 8.43 | 5.32 | estimate |
| `estate_gift_taxes` | 0 | 0 | 0 | 0 | 0 | 0 | 0.10 | 99.90 | estimate |

**Individual income tax: the two lowest fifths count with zero, the lower bound.** CBO counts refundable credits
(earned income, child and premium tax credits) as negative income tax (2021 report, pp. 37-38), so the two lowest
fifths have negative shares, -4.2% and -0.9%. The format allows no negative share, and the budget node
`rev.individual_income` ($2,656.0B) holds receipts only: OMB books the part of a refundable credit that exceeds a
household's tax as an outlay (the 2021 report, p. 22, note 14). The two groups' receipts lie between zero and their tax
before refundable credits, which CBO's figure data give:

| | Lowest fifth | Second fifth |
|---|---|---|
| refundable credits, % of income (figure data, Figure 13, 2023) | 12.5 | 4.1 |
| net income tax rate (Table 9, column D) | -11.1 | -1.0 |
| tax before refundable credits, % of income | 1.4 | 3.1 |
| income (Table 3, E × Table 1, C) | $28,500 × 26.1M = $743.9B | $63,100 × 27.1M = $1,710.0B |
| tax before refundable credits | $10.4B | $53.0B |

against CBO's net income tax of $1,978.8B for all households. The profile takes the lower bound, zero, and scales the
other groups' CBO shares by 1/105.0: those shares are upper bounds. Top 1%: 38.8 / 105.0 = 36.95% at most; with the
two groups at their upper bounds, 38.8% × 1,978.8 / (1.05 × 1,978.8 + 10.4 + 53.0) = 35.86% at least. Quality
"estimate", because zero is an assumption within that range. With CBO's negative shares instead (which the format
would have to allow), the view would show the lowest fifth at -0.01% and the top 1% at 24.68% of the attributed taxes,
against 2.38% and 23.61% now.

**Customs duties: estimate.** No official table spreads customs duties over CBO's groups. CBO's letters on tariffs
(December 18, 2024, p. 6; June 4, 2025, pp. 6-7) say it is "still evaluating" the effects across the income
distribution; the June letter: tariffs raise the prices of goods more than of services, "households at the lower end
of the income distribution spend a greater share of their income on goods", but the largest price increases are for
durable goods such as household appliances and motor vehicles, which "account for a larger share of total consumption
for households at the higher end". The format keeps taxes on consumption with the households that buy. Customs
duties are therefore spread like CBO's excise taxes, that is like the consumption of motor fuel, tobacco, alcohol and
air travel (2021 report, pp. 27 and 38; own assumption); imported goods are a broader basket. Treasury's OTA spreads
customs duties by labor and capital income instead (table footnote 2); its column "Excises and Customs Duties" gives,
in the same percentile bands: 3.2, 7.1, 11.0, 19.7, 15.8, 11.5, 14.5, 16.7 (sum 99.5). The range for the top 1% is thus
5.3% (here) to 16.7% (Treasury). The Tax Policy Center's tariff tables (T24-0079, T25-0014, T25-0018) could not be
reached.

**Estate and gift taxes: estimate.** OTA, Distribution Table 2025 001, "Percent Distribution", column "Estate and Gift
Taxes": 0.0 in every decile from 0 to 90 and in 90 to 95, 0.1 in 95 to 99, 6.7 in 99 to 99.9, 91.8 in the top 0.1;
the rows add up to 98.7 because "families with negative incomes pay a significant share of the estate tax" (footnote
3). Top 1% = 6.7 + 91.8 = 98.5; divided by 98.6: 0.10% and 99.90%. OTA's bands have the same percentile bounds as CBO's
groups but hold equal numbers of families (17.9M in the lowest decile, 18.9M in the others), ranked by another income:
cash income adjusted for family size, which includes unrealized gains at death; the table is for 2025 under the law as
of June 2024.

## 4. Node map and payers

Every revenue leaf of `countries/us/budget.json` maps to exactly one entry (the nearest ancestor's), and the lines add
up to the budget's receipts of $5,236.4B; `who_pays.py --check` and the validator fail otherwise.

| Entry | Leaves (FY 2025, $B) | Goes to |
|---|---|---|
| `rev.individual_income` | 2,656.0 | profile `individual_income_tax` |
| `rev.corporate_income` | 452.1 | payer `companies` |
| `rev.social_insurance` | OASI 1,097.4, DI 186.4, Medicare 395.4, federal employees 8.6, railroad 6.5 | profile `payroll_taxes` |
| `rev.social_insurance.unemployment` | 54.0 | `payroll_taxes` for 16.0336%, the rest to payer `employers` |
| `rev.excise` | highway 43.8, aviation 23.1, tobacco 9.5, alcohol 8.1, other 12.9 | profile `excise_taxes` |
| `rev.excise.stock_buybacks` | 8.5 | payer `companies` |
| `rev.customs` | 194.9 | profile `customs_duties` |
| `rev.estate_gift` | 29.5 | profile `estate_gift_taxes` |
| `rev.wealth_tax` | 0 (only with the measure) | payer `wealth_holders` |
| `rev.miscellaneous` | Federal Reserve 5.5, fees, fines and other 44.2 | payer `not_a_tax` |

- **Unemployment insurance**: OMB receipts database, source 933-10, column 2025: FUTA $8,632M (account 804201),
  deposits by states $45,383M (804230), deposits by the Railroad Retirement Board $34M (804250); total $54,049M. CBO
  counts only the federal tax (2021 report, p. 38). Coverage = (8,632 + 34) / 54,049 = 0.160336; the states' deposits
  go to `employers`, because no source spreads them. The pack thus treats employers' contributions in two ways, and the
  file's note says both: the federal payroll taxes, the employer's share and the federal unemployment tax included, are
  with the workers as CBO has them; the states' unemployment taxes, which CBO leaves out of federal taxes, are shown as
  paid by employers. That keeps the groups' shares reconcilable with CBO's.
- **Railroad retirement taxes and federal employees' retirement contributions** ($15.2B) are not named in CBO's
  definition (Social Security, Medicare, unemployment insurance); spread like payroll taxes (own assumption).
- **Stock buybacks**: a tax on corporations' repurchases of their own shares. It goes to `companies`: it rests on what
  corporations do with their profits; CBO's rule for excise taxes (by households' consumption) is not used for it.
- **Payers**, in the order the page lists them, each with the sources of its note: `companies` $460.6B, `employers`
  $45.4B, `wealth_holders` $0 today, `unassigned` $0 today (changes of measures that no source places in the groups),
  `not_a_tax` $49.7B. The groups together: $4,680.7B. 4,680.7 + 460.6 + 45.4 + 49.7 = 5,236.4. The labels follow the
  German pack's ("Companies", "Employers", "Households, no group assigned", "No taxes: …").

## 5. Scopes

1. `taxes`, "All federal taxes": individual income, payroll (all social insurance receipts), excise, customs, estate
   and gift, wealth tax, corporate income tax. Payroll taxes are taxes, as in CBO's figures. The groups' shares are of
   the part the households pay; the corporate income tax, the stock buyback tax and the states' unemployment taxes are
   in the scope but go to payers.
2. `income_tax`, "Individual income tax": `rev.individual_income`, a figure often quoted. Its top-1% share here is
   37.0% of receipts, against CBO's 38.8% of the net tax after refundable credits; the scope's note says why.

## 6. The headline

| Group | Households | Income | All federal taxes: the view (FY 2025) | CBO 2023, published, with corporate tax (Table 12, C) | CBO 2023 without corporate tax, derived | Individual income tax: the view | CBO 2023 (Table 12, D) |
|---|---|---|---|---|---|---|---|
| Lowest fifth | 19.61 | 3.77 | 2.38 | 0.1 | -0.12 | 0 | -4.2 |
| Second fifth | 20.36 | 8.64 | 4.61 | 4.1 | 4.11 | 0 | -0.9 |
| Middle fifth | 20.29 | 13.41 | 9.02 | 8.9 | 9.24 | 3.81 | 4.0 |
| Fourth fifth | 19.98 | 19.96 | 17.22 | 17.0 | 17.92 | 12.48 | 13.1 |
| Top 11 to 20% | 9.92 | 14.50 | 14.83 | 14.8 | 15.51 | 13.43 | 14.1 |
| Top 6 to 10% | 4.96 | 10.13 | 11.50 | 11.6 | 12.02 | 11.90 | 12.5 |
| Top 2 to 5% | 3.91 | 13.31 | 16.84 | 17.3 | 17.51 | 21.43 | 22.5 |
| Top 1% | 0.98 | 16.29 | 23.61 | 26.1 | 23.64 | 36.95 | 38.8 |

- **Derived without the corporate income tax**: group amount = Σ over individual income, payroll and excise taxes of
  the Table 12 share × the tax's total; totals = Table 7, row 55 (average for all households) × 133.7M: individual
  income $14,800 → $1,978.8B, payroll $11,200 → $1,497.4B, excise $600 → $80.2B (corporate $3,400 → $454.6B). The same
  sum with the corporate income tax reproduces CBO's published column C within 0.1 point in every group (top 1%:
  26.11 against 26.1), which checks the method. Table 7's averages are rounded to $100, so the excise total is
  uncertain by about 8%; it carries little weight. From Tables 9 and 10 instead (the rate without the corporate tax ×
  the income share: top 1% 26.0 × 16.4, over all households 18.1 × 100), the top 1% comes out at 23.56%: the
  `companies` note says "about 23.6%".
- **The view**: every FY 2025 leaf times its node's profile and coverage; shares of the $4,680.7B the groups pay. It
  differs from the derived column because the lowest two fifths count with zero income tax (section 3), and because
  customs ($194.9B, spread like excise taxes) and estate taxes are added and the budget's mix of taxes is that of FY
  2025.
- Per household and year (amount / households): lowest fifth $4,263, top 1% $849,954.

## 7. The wage distribution is not declared income-ranked

`distributions/wages.json` ranks 146.7 million workers by their own wages. CBO ranks households by size-adjusted
income of all their members and sources: a sole earner with $200,000 of wages in a household of four has about
$100,000 on CBO's scale and sits in the fourth fifth (Table 2: the highest quintile begins at $244,500 for four
people, row 190), while by wages alone the worker is among the 6.2% of workers above the cap (Table 1.H: 9.0M of
146.7M). Splitting the workers at the groups' shares would put all wages above the cap into the top 5% to 6% and
overstate the concentration. `incidence.distributions` is therefore left out, and the Social Security measure uses a
profile of its own above the cap (section 8).

## 8. The measures

What the validator prints for each measure on its own at its default (change for the groups, lowest first; payers):

| Measure | Effect or shift | Spread by | At the default |
|---|---|---|---|
| `social_security_wage_cap` | schedule on `rev.social_insurance.social_security` | `incidenceAbove: { from: 176100, incidence: "wages_above_cap" }`; below the cap the node's profile (`payroll_taxes`) | +$0.0B … +$26.0B, +$79.0B, +$121.5B (top 1%) |
| `corporate_tax_rate` | scale on `rev.corporate_income` | payer `companies` | companies +$122.5B |
| `tariff_all_imports` | add on `rev.customs` | the node's profile (`customs_duties`), no key | together with the shift: +$23.1B (lowest fifth) … +$11.5B (top 1%), net $217.0B |
| `tariff_all_imports` | shift to `rev.individual_income` (offset, 22.1%) | `customs_duties` | see the line above |
| `social_security_benefit_tax` | add on `rev.individual_income` | own profile `social_security_benefit_tax` (estimate) | -$3.7B (second fifth) … -$36.7B (fourth) … -$2.4B (top 1%) |
| `aca_enhanced_credits` | add on `rev.individual_income` (+$8.0B) | payer `unassigned`, with `incidenceNote` | unassigned +$8.0B |
| `aca_enhanced_credits` | add on `exp.health.aca_credits` | never counted | spending |
| `wealth_tax` | two adds on `rev.wealth_tax` | payer `wealth_holders` (key on both effects; also the node's entry) | wealth_holders +$399.9B |
| `top_income_tax_rate` | add on `rev.individual_income` | own profile `top_1_percent` (derived) | top 1% +$14.3B |

**Tariff offset.** The measure books the income and payroll taxes a tariff displaces (22.1% of it) against the income
tax. Spread like the income tax, the offset made the tariff a tax cut for the top 1% (-$7.9B at the default). CBO's
paper on the offset (January 2009, p. 2) explains it: an indirect tax leaves less of the value of output "to be paid to
those who provide the inputs to the production process", so that, with the price level unchanged, it is "borne, in
the form of reduced compensation, by all those who provide the inputs", and "collections of direct taxes would be
similarly lower"; p. 3 gives the arithmetic ($100 of indirect tax, $25 less income tax). The offset falls on those who
bear the tariff, so the shift carries `"incidence": "customs_duties"` and the net tariff is spread like the gross; the
customs profile's note says so.

**`wages_above_cap`** (estimate). IRS Form W-2 statistics 2023, Table 1.H: taxpayers with wages and their wages
(thousand dollars) by AGI class of their return and by multiple of the 2023 wage base ($160,200). Wages above the
base in a cell = wages − number × $160,200, for the columns "1 under 2 times", "2 under 4 times", "4 times and over";
total $1,485.2B (the class "No adjusted gross income", $1.42B, is left out like CBO's negative incomes). To match the
groups, returns are ranked by AGI (Table 1.2: 158.4M returns with AGI above zero, Pareto within each class through the
counts above its bounds) and cut where the same share of returns lies above as the group holds of households: top 1%
from $676,418 of AGI, top 2 to 5% from $272,441, top 6 to 10% from $183,108, top 11 to 20% from $118,571. Within an
AGI class of Table 1.H the wages above the base are split by the AGI the Pareto curve puts on each side of a cut (own
assumption). Result ($B): q1 0.2, q2 0.2, q3 0.6, q4 1.3, top 11 to 20% 18.0, top 6 to 10% 168.2, top 2 to 5% 510.7,
top 1% 785.9; shares 0.01, 0.01, 0.04, 0.09, 1.21, 11.33, 34.39, 52.91%. Returns are not households, and AGI is not
adjusted for household size: a high earner with a large household sits lower in CBO's ranking, so this is probably too
concentrated at the top. The measure's curve is free: the profile is attached with `incidenceAbove`, from the cap of
the measure's baseline schedule ($176,100, the point where its rate drops to zero), so it spreads only the change
from rates on wages above the cap; a change of the rate below the cap follows the payroll profile. The split of wages
above the 2023 cap of $160,200 is thus applied above the pack's cap of $176,100. A curve that taxes only the highest
wages (the $400,000 preset) falls even more on the top than this profile says. Self-employment income above the cap
is assumed to be spread like wages, as in the measure itself.

**`social_security_benefit_tax`** (estimate). Tax Policy Center, Table T24-0048, "Exclude Social Security Benefits
from Gross Income", distribution of federal tax change by expanded cash income percentile, 2025 (preliminary, August
1, 2024), read in the Internet Archive's copy of the table image. Column "Share of Total Federal Tax Change": lowest
quintile 0.0, second 3.7, middle 23.9, fourth 36.5, 80-90 17.1, 90-95 8.6, 95-99 7.7, top 1 percent 2.4 (top quintile
35.8; top 0.1 percent 0.3). Sum of the eight groups 99.9; divided by it: 0, 3.70, 23.92, 36.54, 17.12, 8.61, 7.71,
2.40%. Note 3: "the income percentile classes … contain an equal number of people, not tax units", as CBO's do; the
units are tax units ranked by expanded cash income, and the baseline is "the law currently in place as of July 31,
2024", before the deduction for people 65 and over of July 2025 (named in the measure's note).

The Penn Wharton Budget Model's split differs strongly. Its Table 3 (2026) gives average tax changes per household
of 0, -15, -340, -1,135 (quintiles one to four), -1,625 (80-90%), -1,590 (90-95%), -2,020 (95-99%), -2,205 (99-99.9%),
-2,450 (top 0.1%). Weighted with group sizes of 0.2, 0.2, 0.2, 0.2, 0.1, 0.05, 0.04, 0.009, 0.001: 0, 0.47, 10.57, 35.30,
25.27, 12.36, 12.56, 3.47%, so 53.7% on the top fifth against TPC's 35.8%. The page does not state its units, and
$643 per household × 133.1M = $85.6B against its own revenue loss of $116B in 2026 (Table 1), so its units are not
CBO's households. TPC's table is used, because its groups hold equal numbers of people as CBO's do; the note names
PWBM's as the other published split.

**`top_1_percent`** (derived). H.R. 4280 taxes taxable income above $1,000,000 for single filers (section 2(c)), heads
of household (2(b)) and married people filing separately (2(d)), and above $2,000,000 for couples filing jointly
(2(a)), in 2018 dollars, indexed (section 2(f)); in 2023 about $1.16 million and $2.31 million (`hr_4280_2025`). CBO's
lowest income of the top 1% in 2023: $549,000 (one person), $776,300 (two), $950,800 (three), $1,097,900 (four)
(Table 2, column K, rows 55, 100, 145, 190); taxable income is part of the income CBO ranks by. Every affected return
therefore belongs to a household in the top 1%, except a return other than a joint return in a household of five or
more ($549,000 × √5 = $1,227,600 > $1,156,250), which the profile ignores.

**`aca_enhanced_credits`, the income-tax part.** The format as built has no "not counted": the effect names the payer
`unassigned` and says in its `incidenceNote` who pays: "Paid by people with marketplace coverage whose premium tax
credit shrinks or ends with the enhancement, which had lowered the share of income they pay for a benchmark plan and
opened the credit to people above four times the poverty line; no table splits it by income group." Treasury OTA's
*Distribution of Premium Tax Credit by Family Income Percentile, 2018* was read and not used: it is the whole credit
before the enhancement (94% to the lowest six deciles, $10M to the top 1%), its deciles hold equal numbers of
families, and the enhancement's change falls differently, above all on people above four times the poverty line whom
the credit of 2018 did not reach.

## 9. Open, and decisions for the owner

- **Negative income tax shares.** CBO's own shares for the lowest two fifths are negative (refundable credits). The
  format requires shares ≥ 0, so they count with zero on the receipts, the lower bound (section 3). With CBO's net
  convention the view would show the lowest fifth at about 0% and the top 1% at 24.7% instead of 2.4% and 23.6%.
- **Customs duties** rest on an assumption (like the consumption of fuel, tobacco, alcohol and air travel);
  Treasury's convention would put 16.7% instead of 5.3% on the top 1%. No CBO, JCT or Treasury table of the tariffs'
  burden by these groups was found; TPC's tariff tables could not be reached.
- **The wealth tax** is shown as a payer of its own, `wealth_holders`, outside the income groups, because no source
  places the households worth more than $50 million in them. The payer `unassigned` would also fit; the separate line
  says who they are.
- **The benefit tax**: two published splits that differ strongly (TPC and PWBM), both from before the law of July
  2025.
- **Years.** Shares of 2023 (CBO), 2025 (OTA, TPC), applied to the amounts of fiscal year 2025; no income total.
- **Not verified from a primary document**: the Tax Policy Center's tariff tables (blocked, not archived as far as
  found); any official estimate of who pays the tariffs, the wage cap or the ACA enhancement by CBO's groups.
