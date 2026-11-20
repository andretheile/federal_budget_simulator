#!/usr/bin/env python3
"""Downloads the source files the US build reads into pipeline/us/.cache/, one folder per publisher.

    python3 pipeline/us/fetch_inputs.py            fetch what is missing, keep what is there
    python3 pipeline/us/fetch_inputs.py --force    download everything again (replaces the stored vintage)

Nothing that already exists is replaced unless --force is given: the cache is the exact data vintage the pack
was built from. The files are data only; nothing in .cache/ is executed or imported.

Read by build_budget.py:
  omb/outlays_fy2027.xlsx       OMB Public Budget Database, outlays by account and subfunction  -> every spending leaf
  omb/receipts_fy2027.xlsx      OMB Public Budget Database, receipts by account and source     -> every revenue leaf
  omb/hist01z1_fy2027.xlsx      OMB Historical Tables, Table 1.1 (totals, on- and off-budget)   -> check of the totals
  omb/hist02z1_fy2027.xlsx      OMB Historical Tables, Table 2.1 (receipts by source)           -> check of the revenue groups
  omb/hist03z2_fy2027.xlsx      OMB Historical Tables, Table 3.2 (outlays by subfunction)       -> check of every subfunction
  omb/hist10z1_fy2027.xlsx      OMB Historical Tables, Table 10.1 (GDP by fiscal year)          -> country.json, GDP
  omb/ap_4_tables_fy2027.xlsx   Analytical Perspectives, credit tables (Table 4-1)             -> note on student loans
  mts/mts_table_*_2025-09-30.csv  Treasury, Monthly Treasury Statement for September 2025     -> comparison, gross receipts and refunds
  mts/mts_table_*_2026-09-30.csv  Treasury, Monthly Treasury Statement for September 2026     -> fiscal year 2026 figures in notes
  census/NST-EST2025-ALLDATA.csv  Census Bureau, population estimates, Vintage 2025             -> country.json, population
  bea/NipaDataA.txt             BEA, NIPA annual data (all tables, flat file)                  -> Table 3.18B, national-accounts comparison
Kept for reference (read by hand):
  irs/p15--2025.pdf             IRS Publication 15 (2025): payroll tax rates, Social Security wage base
"""
import os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
FORCE = "--force" in sys.argv
UA = {"User-Agent": "Mozilla/5.0 (generic-stat-client)"}

OMB = "https://www.whitehouse.gov/wp-content/uploads/2026/04/"
# Treasury Fiscal Data API: one Monthly Treasury Statement table for one record date, as CSV.
MTS = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_%s"
       "?filter=record_date:eq:%s&page[size]=10000&format=csv")

DOWNLOADS = {
    # OMB, Budget of the U.S. Government, Fiscal Year 2027 (April 2026): supplemental materials and historical
    # tables. Linked from https://www.whitehouse.gov/omb/information-resources/budget/ ; a new Budget brings new
    # file names (fy2028).
    "omb/outlays_fy2027.xlsx": OMB + "outlays_fy2027.xlsx",
    "omb/receipts_fy2027.xlsx": OMB + "receipts_fy2027.xlsx",
    "omb/hist01z1_fy2027.xlsx": OMB + "hist01z1_fy2027.xlsx",
    "omb/hist02z1_fy2027.xlsx": OMB + "hist02z1_fy2027.xlsx",
    "omb/hist03z2_fy2027.xlsx": OMB + "hist03z2_fy2027.xlsx",
    "omb/hist10z1_fy2027.xlsx": OMB + "hist10z1_fy2027.xlsx",
    "omb/ap_4_tables_fy2027.xlsx": OMB + "ap_4_tables_fy2027.xlsx",
    # Census Bureau, Vintage 2025 population estimates (July 1), national and state totals.
    "census/NST-EST2025-ALLDATA.csv":
        "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv",
    # BEA, all annual NIPA series as one flat file (Table 3.18B is on a fiscal-year basis). Always the latest
    # release; the cached copy is the one of 4 November 2026.
    "bea/NipaDataA.txt": "https://apps.bea.gov/national/Release/TXT/NipaDataA.txt",
    # IRS, Publication 15 (Circular E) for 2025: payroll tax rates and the Social Security wage base. Read by
    # hand for the descriptions of the payroll tax items; no script parses it.
    "irs/p15--2025.pdf": "https://www.irs.gov/pub/irs-prior/p15--2025.pdf",
}
for date in ("2025-09-30", "2026-09-30"):
    for table in ("1", "3", "4", "9"):
        DOWNLOADS["mts/mts_table_%s_%s.csv" % (table, date)] = MTS % (table, date)


def main():
    for rel, url in DOWNLOADS.items():
        path = os.path.join(CACHE, rel)
        if os.path.exists(path) and not FORCE:
            print("kept    ", rel)
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            data = r.read()
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        print("fetched ", rel, len(data), "bytes")


if __name__ == "__main__":
    main()
