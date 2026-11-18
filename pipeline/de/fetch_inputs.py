#!/usr/bin/env python3
"""Downloads the source files the build scripts read into pipeline/de/.cache/ and derives the text tables.

    python3 pipeline/de/fetch_inputs.py            fetch what is missing, keep what is there
    python3 pipeline/de/fetch_inputs.py --force    download everything again (replaces the stored vintage)

Nothing that already exists is replaced unless --force is given: the cache is the exact data vintage the pack
was built from. Eurostat revises its figures several times a year, so a fresh download will usually differ,
and the constants typed into build_budget.py then have to be checked against the new files (see README.md).

Read by the build scripts:
  exp_2024_full.tsv        Eurostat gov_10a_exp, Germany, base year          -> levels.py, build_budget.py
  est/csv02.tsv            Destatis wage and income tax statistics, 73111-02  -> build_dist.py
  ecb/dwa_de.csv           ECB Distributional Wealth Accounts, Germany        -> build_dist.py
Kept for reference (the constants in build_budget.py were read from them by hand):
  main_2024.tsv            Eurostat gov_10a_main, Germany, base year
  ntl_de.tsv               Eurostat National Tax List, sheet DE
  ba/zr-gruarb.xlsx        Federal Employment Agency, basic income support time series
"""
import os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import es
from xlsx import X

CACHE = os.path.join(HERE, ".cache")
FORCE = "--force" in sys.argv
YEAR = "2024"
UA = {"User-Agent": "Mozilla/5.0 (generic-stat-client)"}

DOWNLOADS = {
    # Eurostat: National Tax Lists workbook. The file name carries the release date; find the current link on
    # https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Tax_revenue_statistics
    "ntl/ntl.xlsx": "https://ec.europa.eu/eurostat/statistics-explained/images/3/3b/National_tax_lists_2025_2026-10-29.xlsx",
    # Destatis: Statistischer Bericht Lohn- und Einkommensteuer 2022. Newer years are linked on
    # https://www.destatis.de/DE/Themen/Staat/Steuern/Lohnsteuer-Einkommensteuer/_inhalt.html
    "est/lest2022.xlsx": "https://www.destatis.de/DE/Themen/Staat/Steuern/Lohnsteuer-Einkommensteuer/Publikationen/Downloads-Lohn-und-Einkommenssteuern/statistischer-bericht-lohn-einkommensteuer-2140710227005.xlsx?__blob=publicationFile&v=2",
    # ECB data API: net wealth of German households by wealth group, quarterly
    "ecb/dwa_de.csv": "https://data-api.ecb.europa.eu/service/data/DWA/Q.DE.S14.A+N+_Z.LE+_Z.NWA+_Z..EUR+_Z+PT+HHS+EUR_R_NH+EUR_R_POP.S+_Z.N?startPeriod=2019-Q4&endPeriod=2025-Q4&format=csvdata",
    # Federal Employment Agency: Strukturen der Grundsicherung SGB II, time series (always the current edition)
    "ba/zr-gruarb.xlsx": "https://statistik.arbeitsagentur.de/Statistikdaten/Detail/Aktuell/iiia7/zeitreihekreise-zr-gruarb/zr-gruarb-d-0-xlsx.xlsx?__blob=publicationFile&v=1",
}
# Eurostat tables written as text: file -> (dataset, request). es.py keeps the raw response per request; with
# --force those raw files are removed first.
EUROSTAT = {
    "exp_%s_full.tsv" % YEAR: ("gov_10a_exp", {"geo": "DE", "unit": "MIO_EUR", "time": YEAR}),
    "main_%s.tsv" % YEAR: ("gov_10a_main", {"geo": "DE", "unit": "MIO_EUR", "time": YEAR}),
}
# sheets of the workbooks written as text: file -> (workbook, sheet)
SHEETS = {
    "ntl_de.tsv": ("ntl/ntl.xlsx", "DE"),
    "est/csv02.tsv": ("est/lest2022.xlsx", "csv-73111-02"),
}


def want(rel):
    path = os.path.join(CACHE, rel)
    if os.path.exists(path) and not FORCE:
        print("kept    ", rel)
        return None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


for rel, url in DOWNLOADS.items():
    path = want(rel)
    if path:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            data = r.read()
        open(path, "wb").write(data)
        print("fetched ", rel, len(data), "bytes")

for rel, (dataset, params) in EUROSTAT.items():
    path = want(rel)
    if path:
        if FORCE:
            for f in os.listdir(CACHE):
                if f.startswith(dataset + "_") and f.endswith(".json"):
                    os.remove(os.path.join(CACHE, f))
        open(path, "w", encoding="utf-8").write("\n".join(es.lines(dataset, params)) + "\n")
        print("wrote   ", rel)

for rel, (workbook, sheet) in SHEETS.items():
    path = want(rel)
    if path:
        with open(path, "w", encoding="utf-8") as f:
            for i, row in X(os.path.join(CACHE, workbook)).rows(sheet):
                f.write(str(i) + "\t" + "\t".join(str(v).replace("\n", " ") for v in row) + "\n")
        print("wrote   ", rel)
