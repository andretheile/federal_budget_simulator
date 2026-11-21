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
Read by build_dist.py and measures.py (the measures in policies.json):
  irs/23in01w2all.xlsx          IRS Statistics of Income, Form W-2 statistics 2023, Table 1   -> distributions/wages.json
  census/ft900_exh1.xlsx        Census Bureau, FT-900 release of November 2026, Exhibit 1      -> goods imports (tariff measure)
  mts/mts_table_5_*.csv         Monthly Treasury Statement, Table 5 (outlays by agency)         -> fiscal year 2026 outlays in catches
Read by workforce.py (through measures.py; the measure federal_workforce_cut):
  omb/objclass_detail_fy2027.xlsx  OMB, object class detail by account (2025 actual)            -> personnel costs per budget item
  omb/ap_5_tables_1-3_fy2027.xlsx  Analytical Perspectives, Tables 5-1 to 5-3                  -> check of the base, FTE, pay and benefits
  bls/ces_CES9091100001.json    BLS Current Employment Statistics, federal except Postal Service -> employment quoted on the card
Read by households.py (through measures.py; the measures added in November 2026):
  census/nc-est2025-agesex-res.csv  Census Bureau, population by single year of age, July 1, 2025  -> rebate checks
  irs/23in12ms.xls              IRS Statistics of Income 2023, Table 1.2 (by AGI and filing status) -> rebate phase-out
  irs/23in35tr.xls, 23in36tr.xls  IRS Statistics of Income 2023, Tables 3.5 and 3.6 (income by tax rate) -> top rate
  fed/dfa.zip                   Federal Reserve, Distributional Financial Accounts (net worth by percentile) -> wealth tax
  fns/snap-zip-fy69tocurrent-11.zip  FNS, SNAP state data; fns/FY25.xlsx is extracted from it -> SNAP state share
  cms/202{5,6}-oep-state-level-public-use-file.zip  CMS, Marketplace open enrollment, national rows -> ACA credits
Read by hand for the measures added in November 2026 (constants marked HAND in measures.py and households.py):
  cms/2026-medicare-trustees-report.pdf  Medicare Trustees Report 2026, Table V.H1 (tax on benefits to HI)
  fns/snap-qcfy25-per.pdf       FNS, SNAP payment error rates, fiscal year 2025 (by state)
  irs/rp-22-38.pdf              IRS, Rev. Proc. 2022-38: the 37% thresholds of tax year 2023
  govinfo/BILLS-*.htm, DCPD-*.htm  bills of the 119th Congress and presidential remarks quoted on the cards
Kept for reference (read by hand; the measures quote them):
  irs/p15--2025.pdf             IRS Publication 15 (2025): payroll tax rates, Social Security wage base
  govinfo/CDOC-119hdoc163.pdf   2026 Annual Report of the Social Security Trustees (H. Doc. 119-163)
  govinfo/BILLS-119hr9519ih.pdf Social Security 2100 Act, H.R. 9519 as introduced (29 June 2026)
  govinfo/PLAW-119publ*.xml     public laws: 119-1 (Laken Riley Act), 119-21 (reconciliation act of 2025),
                                119-28 (Rescissions Act of 2025), 119-37 (CR of November 2025, bar on reductions in
                                force), 119-75 (Consolidated Appropriations Act, 2026), 119-98 (Secure America Act),
                                119-103 (CR for 2027)
  govinfo/GOVPUB-Y4_T19_4-PURL-gpo157077.pdf  JCT, income and payroll tax offsets 2021-2031 (JCX-11-21)
  govinfo/GOVPUB-Y10-PURL-LPS107729.pdf      CBO, The Role of the 25 Percent Revenue Offset (2009)
  scotus/24-1287.pdf            Supreme Court, Learning Resources, Inc. v. Trump (20 February 2026)
  scotus/606US2PP_Ord.pdf       Supreme Court, orders of 606 U.S. (preliminary print), among them Trump v. AFGE, 24A1174
  fr/2026-*.pdf                 Federal Register: section 122 surcharge, end of the IEEPA duties, section 301 action;
                                2026-21320, OPM's rule on administrative leave for workforce realignment
  fr/2025-*.pdf                 Federal Register: hiring freeze (2025-01905), Executive Orders 14210 (2025-02762)
                                and 14356 (2025-19614)
  omb/ap_5_management_fy2027.pdf  Analytical Perspectives, chapter 5 (Management): employees who left in 2025
  irs/p5901.pdf                 IRS Publication 5901, return on investment of IRS funding (enforcement revenue)
  nato/                         NATO defence expenditure 2014-2025; the 5 % commitment
  treasury/General-Explanations-FY2025.pdf   Treasury, revenue proposals of the FY 2025 Budget (corporate rate)
Read by debt.py (countries/us/debt.json, the debt and interest projection):
  omb/hist01z1_fy2027.xlsx, hist03z1_fy2027.xlsx, hist07z1_fy2027.xlsx, hist10z1_fy2027.xlsx
                                OMB Historical Tables 1.1 (receipts, outlays), 3.1 (defense, net interest), 7.1 (debt
                                held by the public), 10.1 (GDP): the stock, the President's Budget path to 2031, history
  omb/ap_12_tables_fy2027.xlsx  Analytical Perspectives, Table 12-6: outlays and net interest in the baseline to 2036
  omb/ap_11_tables_fy2027.xlsx  Analytical Perspectives, Table 11-2: other transactions affecting borrowing
  mts/mts_table_6_*.csv         Monthly Treasury Statement, Table 6 (means of financing): debt held by the public
  treasury/mspd_table_3_market_2025-09-30.csv  Monthly Statement of the Public Debt, marketable securities by CUSIP
  treasury/mspd_table_2_2026-10-31.csv         Monthly Statement of the Public Debt, debt subject to limit
  treasury/yield_curve_*.csv    Treasury, daily par yield curve rates by calendar year
  fed/fomcprojtabl20260916.htm  Federal Reserve, Summary of Economic Projections, September 2026, Table 1
  govinfo/PLAW-119-public.zip   public laws of the 119th Congress: titles and dates (appropriations for FY 2027)
  govinfo/PLAW-119publ21.xml, PLAW-119publ103.xml  the debt limit (sec. 72001); the continuing resolution's end date
Read by hand for debt.py (constants marked HAND there):
  omb/ap_12_current_services_fy2027.pdf  Analytical Perspectives, chapter 12: Tables 12-2 (GDP) and 12-4 (receipts)
                                         in the baseline for 2032-2036, which the workbook does not hold
  omb/ap_1_assumptions_fy2027.pdf        Analytical Perspectives, chapter 1: Table 1-3, sensitivity of outlays to rates
  omb/ap_11_borrowing_fy2027.pdf         Analytical Perspectives, chapter 11: average maturity, debt limit
  omb/MSR_2027.pdf                       Mid-Session Review of the Budget for FY 2027 (September 2026)
  treasury/executive-summary-2025.pdf    Executive Summary to the FY 2025 Financial Report of the U.S. Government
"""
import os, sys, urllib.request, zipfile

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
    # --- the measures ---
    # IRS Statistics of Income, Form W-2 statistics, tax year 2023 (published October 2026), Table 1: taxpayers
    # with wage income by size of wage income. Listed on
    # https://www.irs.gov/statistics/soi-tax-stats-individual-information-return-form-w2-statistics
    "irs/23in01w2all.xlsx": "https://www.irs.gov/pub/irs-soi/23in01w2all.xlsx",
    # Census Bureau, U.S. International Trade in Goods and Services (FT-900), Exhibit 1. The address always holds
    # the latest release; the cached copy is the release of November 2026 (data through September 2026).
    "census/ft900_exh1.xlsx": "https://www.census.gov/foreign-trade/Press-Release/current_press_release/exh1.xlsx",
    # Congressional documents, bills, laws and reports archived by the Government Publishing Office.
    "govinfo/CDOC-119hdoc163.pdf": "https://www.govinfo.gov/content/pkg/CDOC-119hdoc163/pdf/CDOC-119hdoc163.pdf",
    "govinfo/BILLS-119hr9519ih.pdf": "https://www.govinfo.gov/content/pkg/BILLS-119hr9519ih/pdf/BILLS-119hr9519ih.pdf",
    "govinfo/GOVPUB-Y4_T19_4-PURL-gpo157077.pdf":
        "https://www.govinfo.gov/content/pkg/GOVPUB-Y4_T19_4-PURL-gpo157077/pdf/GOVPUB-Y4_T19_4-PURL-gpo157077.pdf",
    "govinfo/GOVPUB-Y10-PURL-LPS107729.pdf":
        "https://www.govinfo.gov/content/pkg/GOVPUB-Y10-PURL-LPS107729/pdf/GOVPUB-Y10-PURL-LPS107729.pdf",
    "scotus/24-1287.pdf": "https://www.supremecourt.gov/opinions/25pdf/607us2r12_8nj9.pdf",
    "fr/2026-03824.pdf": "https://www.govinfo.gov/content/pkg/FR-2026-02-25/pdf/2026-03824.pdf",
    "fr/2026-03832.pdf": "https://www.govinfo.gov/content/pkg/FR-2026-02-25/pdf/2026-03832.pdf",
    "fr/2026-15274.pdf": "https://www.govinfo.gov/content/pkg/FR-2026-07-28/pdf/2026-15274.pdf",
    "nato/def-exp-2025-en.pdf": "https://www.nato.int/content/dam/nato/webready/documents/finance/def-exp-2025-en.pdf",
    "nato/five-percent.html": "https://www.nato.int/en/what-we-do/introduction-to-nato/defence-expenditures-and-natos-5-commitment",
    "treasury/General-Explanations-FY2025.pdf": "https://home.treasury.gov/system/files/131/General-Explanations-FY2025.pdf",
    # --- the federal workforce measure ---
    "omb/objclass_detail_fy2027.xlsx": OMB + "objclass_detail_fy2027.xlsx",
    "omb/ap_5_tables_1-3_fy2027.xlsx": OMB + "ap_5_tables_1-3_fy2027.xlsx",
    "omb/ap_5_management_fy2027.pdf": OMB + "ap_5_management_fy2027.pdf",
    # BLS public API, version 1 (no registration). Always the latest data; the cached copy is the one of
    # 20 November 2026 (October 2026 preliminary).
    "bls/ces_CES9091100001.json":
        "https://api.bls.gov/publicAPI/v1/timeseries/data/CES9091100001?startyear=2024&endyear=2026",
    "fr/2025-01905.pdf": "https://www.govinfo.gov/content/pkg/FR-2025-01-28/pdf/2025-01905.pdf",
    "fr/2025-02762.pdf": "https://www.govinfo.gov/content/pkg/FR-2025-02-14/pdf/2025-02762.pdf",
    "fr/2025-19614.pdf": "https://www.govinfo.gov/content/pkg/FR-2025-10-20/pdf/2025-19614.pdf",
    "fr/2026-21320.pdf": "https://www.govinfo.gov/content/pkg/FR-2026-10-19/pdf/2026-21320.pdf",
    "scotus/606US2PP_Ord.pdf": "https://www.supremecourt.gov/opinions/preliminaryprint/606US2PP_Ord.pdf",
    "irs/p5901.pdf": "https://www.irs.gov/pub/irs-pdf/p5901.pdf",
    # --- the measures added in November 2026 ---
    "census/nc-est2025-agesex-res.csv":
        "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/national/asrh/nc-est2025-agesex-res.csv",
    "irs/23in12ms.xls": "https://www.irs.gov/pub/irs-soi/23in12ms.xls",
    "irs/23in35tr.xls": "https://www.irs.gov/pub/irs-soi/23in35tr.xls",
    "irs/23in36tr.xls": "https://www.irs.gov/pub/irs-soi/23in36tr.xls",
    "irs/rp-22-38.pdf": "https://www.irs.gov/pub/irs-drop/rp-22-38.pdf",
    # Federal Reserve, Distributional Financial Accounts: always the latest release; the cached copy has data
    # through 2026 Q2. The pack reads 2025 Q3.
    "fed/dfa.zip": "https://www.federalreserve.gov/releases/z1/dataviz/download/zips/dfa.zip",
    # USDA FNS: the web pages refuse automated requests; the files are served from its file server. The SNAP
    # archive always holds the latest data; the cached copy is the one of November 13, 2026.
    "fns/snap-zip-fy69tocurrent-11.zip":
        "https://fns-prod.azureedge.us/sites/default/files/resource-files/snap-zip-fy69tocurrent-11.zip",
    "fns/snap-qcfy25-per.pdf": "https://fns-prod.azureedge.us/sites/default/files/resource-files/snap-qcfy25-per.pdf",
    "cms/2026-medicare-trustees-report.pdf": "https://www.cms.gov/oact/tr/2026",
    "cms/2025-oep-state-level-public-use-file.zip": "https://www.cms.gov/files/zip/2025-oep-state-level-public-use-file.zip",
    "cms/2026-oep-state-level-public-use-file.zip": "https://www.cms.gov/files/zip/2026-oep-state-level-public-use-file.zip",
}
for doc in ("BILLS-119hr1040ih", "BILLS-119s2475is", "BILLS-119s3385pcs", "BILLS-119hr247ih", "BILLS-119s4246is",
            "BILLS-119hr4280ih", "BILLS-119hr7975ih", "BILLS-119s5526rs", "DCPD-202501109", "DCPD-202600688"):
    DOWNLOADS["govinfo/%s.htm" % doc] = "https://www.govinfo.gov/content/pkg/%s/html/%s.htm" % (doc, doc)
# Members taken out of downloaded archives: (archive, member, cache path).
EXTRACT = [("fns/snap-zip-fy69tocurrent-11.zip", "FY25.xlsx", "fns/FY25.xlsx")]
for law in ("1", "21", "28", "37", "75", "98", "103"):
    DOWNLOADS["govinfo/PLAW-119publ%s.xml" % law] = "https://www.govinfo.gov/bulkdata/PLAW/119/public/PLAW-119publ%s.xml" % law
for date in ("2025-09-30", "2026-09-30"):
    for table in ("1", "3", "4", "5", "6", "9"):
        DOWNLOADS["mts/mts_table_%s_%s.csv" % (table, date)] = MTS % (table, date)
# --- the debt projection (debt.py) ---
for name in ("hist03z1_fy2027.xlsx", "hist07z1_fy2027.xlsx", "ap_12_tables_fy2027.xlsx", "ap_11_tables_fy2027.xlsx",
             "ap_12_current_services_fy2027.pdf", "ap_1_assumptions_fy2027.pdf", "ap_11_borrowing_fy2027.pdf"):
    DOWNLOADS["omb/" + name] = OMB + name
# The Mid-Session Review of September 2026, which updates no path for receipts, deficits or interest.
DOWNLOADS["omb/MSR_2027.pdf"] = "https://www.whitehouse.gov/wp-content/uploads/2026/09/MSR_2027.pdf"
# Treasury Fiscal Data API: Monthly Statement of the Public Debt, marketable securities by CUSIP at the end of fiscal
# year 2025 (maturity profile), and the debt subject to limit at the latest month-end.
FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/debt/mspd/"
DOWNLOADS["treasury/mspd_table_3_market_2025-09-30.csv"] = (
    FISCAL + "mspd_table_3_market?filter=record_date:eq:2025-09-30&page[size]=10000&format=csv")
DOWNLOADS["treasury/mspd_table_2_2026-10-31.csv"] = (
    FISCAL + "mspd_table_2?filter=record_date:eq:2026-10-31&page[size]=10000&format=csv")
# Treasury, daily par yield curve rates, one file per calendar year: 2026 for the market rate (the cached copy runs to
# November 20, 2026), 1991-2000 and 2012-2021 for two presets.
for year in [2026] + list(range(1991, 2001)) + list(range(2012, 2022)):
    DOWNLOADS["treasury/yield_curve_%d.csv" % year] = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/%d/all"
        "?type=daily_treasury_yield_curve&field_tdr_date_value=%d&page&_format=csv" % (year, year))
DOWNLOADS["treasury/executive-summary-2025.pdf"] = "https://fiscal.treasury.gov/system/files/2026-03/executive-summary-2025.pdf"
# All public laws of the 119th Congress as one archive (always the latest; the cached copy was fetched on November 21,
# 2026 and runs to P.L. 119-142): debt.py checks that no law after P.L. 119-103 appropriates for fiscal year 2027.
DOWNLOADS["govinfo/PLAW-119-public.zip"] = "https://www.govinfo.gov/bulkdata/PLAW/119/public/PLAW-119-public.zip"
# Federal Reserve, Summary of Economic Projections of September 16, 2026: longer-run growth (the growth default).
DOWNLOADS["fed/fomcprojtabl20260916.htm"] = "https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm"


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
    for archive, member, rel in EXTRACT:
        path = os.path.join(CACHE, rel)
        if os.path.exists(path) and not FORCE:
            continue
        with zipfile.ZipFile(os.path.join(CACHE, archive)) as z:
            data = z.read(member)
        with open(path, "wb") as f:
            f.write(data)
        print("extracted", rel, "from", archive)


if __name__ == "__main__":
    main()
