# United States: how the budget data is built

`build_budget.py` produces `countries/us/budget.json`, the federal budget of fiscal year 2025 (October 2024 to
September 2025) in the unified budget, from the files of the Office of Management and Budget (OMB). The other pack
files (`country.json`, `sources.json`, `policies.json`) are maintained by hand; `--check` also compares the GDP and
population in `country.json` with the cached sources. The source ids used in the script are the keys of
`countries/us/sources.json`.

## Run it

Python 3.9 or newer, standard library only (the `.xlsx` reader is `pipeline/de/xlsx.py`). From the repository root:

```
python3 pipeline/us/fetch_inputs.py            # download what is missing into pipeline/us/.cache/
python3 pipeline/us/build_budget.py            # diagnostics: checks, reconciliation with Treasury, every leaf
python3 pipeline/us/build_budget.py --check    # rebuild in memory, compare with budget.json and country.json
python3 pipeline/us/build_budget.py --write    # replace budget.json
npm run validate                               # then check the whole pack
```

With the cache as downloaded on 20 November 2026, `--check` reports `budget.json` as identical and finds no problem.
Every run, with or without an option, stops with an error if the leaves do not add up to OMB's published totals.

## Sources and the cache

`.cache/` holds the downloaded files, one folder per publisher, and is not in git (14 MB, most of it the BEA flat
file). Nothing in it is executed or imported. OMB rarely replaces a Budget's files after publication, and the
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

## How the tree is built

Every row of the Public Budget Database with a value for 2025 goes to exactly one leaf. A leaf names the rows it
takes (`take`: subfunction, agency, bureau, account) and the subfunctions whose remaining rows it collects (`rest`).
The script stops if a row is taken twice, if a row with a value is left over, or if a leaf is negative, which the pack
format does not allow. The leaves then add up to Historical Table 1.1 to the thousand dollars, and each subfunction
and each defence title to Table 3.2 to the million; `build_budget.py` prints both checks.

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
