"""The shares of countries/de/incidence.json: who pays the revenue, by income group.

incidence.json is written by hand (its texts, the map of nodes, the payers). This script holds the
published tables its numbers come from, typed in from the documents with table and page, and
derives every share of the file from them: the four groups' shares of income and the profiles
that spread a tax over the groups. With --check it compares them with the file and exits with
status 1 if one differs by more than 1e-6. The income tax profile is not derived here but by the
engine from distributions/taxable_income.json (src/engine/incidence.de.test.ts checks it).
The derivations are described in pipeline/de/who-pays.md.

    python3 pipeline/de/build_incidence.py            # print the derived shares
    python3 pipeline/de/build_incidence.py --check    # and compare them with incidence.json

Python 3.9 or newer, standard library only. Run from the repository root.
"""
import json
import sys
from pathlib import Path

PACK = Path(__file__).resolve().parents[2] / "countries" / "de"
DIGITS = 6

# The four groups of the population ranked by income: deciles 1 to 5, deciles 6 to 9, decile 10
# without the top 1 %, the top 1 %. A row below has ten deciles and then the top 1 %.


def four(row):
    """Ten deciles and the top 1 % -> bottom half, next 40 %, next 9 %, top 1 %."""
    deciles, top = row[:10], row[10]
    return [sum(deciles[0:5]), sum(deciles[5:9]), deciles[9] - top, top]


def normalise(values):
    """Shares that sum to 1 after rounding: the remainder of the rounding goes to the largest."""
    total = sum(values)
    shares = [round(v / total, DIGITS) for v in values]
    largest = max(range(len(shares)), key=lambda i: shares[i])
    shares[largest] = round(shares[largest] + 1 - sum(shares), DIGITS)
    return shares


def split_decile_10(deciles, top_part):
    """A row of ten deciles without a top 1 %: give the top 1 % `top_part` of decile 10."""
    return list(deciles) + [deciles[9] * top_part]


# --- DIW Politikberatung kompakt 114 (Bach, Beznoska, Steiner 2016), year 2015 -----------------
# Persons ranked by household gross income per equivalent adult (new OECD scale), p. 31.

# Table 4-12 (p. 61): share of household gross income in %, deciles 1..10, top 1 %.
DIW_INCOME = [2.6, 3.7, 4.9, 5.7, 7.0, 8.0, 9.7, 11.7, 14.5, 32.1, 9.9]

# Table 4-11 (p. 60): taxes and contributions in % of household gross income, deciles 1..10, top 1 %.
DIW_RATES = {
    "direct": [0.2, 0.4, 1.4, 2.5, 4.0, 6.6, 9.2, 11.8, 14.8, 24.6, 34.8],  # income tax, soli, business taxes
    "indirect": [22.9, 18.3, 16.2, 15.5, 13.8, 12.5, 11.4, 10.7, 9.4, 6.6, 4.8],
    "vat": [13.0, 10.9, 9.6, 9.1, 8.1, 7.3, 6.7, 6.4, 5.7, 4.2, 3.2],  # VAT and insurance tax
    "energy": [3.4, 2.6, 2.4, 2.2, 1.9, 1.8, 1.6, 1.5, 1.2, 0.6, 0.2],  # energy taxes and EEG levy
    "tobacco": [2.9, 1.7, 1.3, 1.2, 1.0, 1.0, 0.9, 0.8, 0.6, 0.4, 0.1],  # tobacco, alcohol, betting
    "property": [1.2, 1.0, 1.1, 1.1, 1.1, 1.0, 0.9, 0.9, 0.8, 0.7, 0.8],  # property, motor vehicle, other
    "passed_on": [2.4, 2.0, 1.9, 1.8, 1.6, 1.4, 1.3, 1.2, 1.1, 0.6, 0.4],  # indirect taxes of the business sector
    "contributions": [5.7, 14.6, 18.7, 21.2, 23.0, 25.1, 26.4, 27.7, 27.5, 14.9, 3.5],
    "taxes": [23.1, 18.6, 17.5, 18.0, 17.8, 19.1, 20.5, 22.5, 24.2, 31.2, 39.6],
    "taxes_and_contributions": [28.9, 33.3, 36.2, 39.2, 40.7, 44.2, 47.0, 50.2, 51.7, 46.1, 43.1],
}


def diw_burden(name):
    """A column of Table 4-11 as amounts: the rate times the group's share of income."""
    return [rate * income for rate, income in zip(DIW_RATES[name], DIW_INCOME)]


# Table 3-7 (p. 38), year 2008: profit and capital income ("Gewinn- und Kapitaleinkommen"), bn euros,
# deciles 1..10, top 1 %. Includes the rental value of owner-occupied homes (p. 30).
DIW_CAPITAL = [5.7, 8.6, 12.7, 14.1, 16.4, 17.2, 25.2, 24.8, 38.2, 243.3, 149.1]

# The top 1 %'s part of decile 10's VAT in DIW 2016: (3.2 % x 9.9) / (4.2 % x 32.1), Tables 4-11, 4-12.
VAT_TOP_IN_DECILE_10 = (3.2 * 9.9) / (4.2 * 32.1)

# --- DIW Wochenbericht 31/2017 (Bach, Isaak): VAT by decile, EVS 2013 ------------------------
# Persons ranked by household net income per equivalent adult. Table 3 (p. 632), "Steueraufkommen,
# Struktur in Prozent", deciles 1..10; no top 1 %.
WB31_FOOD_TRANSPORT = [8.2, 8.8, 9.3, 9.5, 9.8, 10.0, 10.1, 10.5, 11.2, 12.7]  # cut of the reduced rate on food and local transport
WB31_OTHER_REDUCED = [3.6, 5.1, 6.7, 7.6, 8.6, 9.4, 10.6, 11.6, 14.5, 22.3]  # abolishing all reductions but food and local transport
# Table 1 (p. 628), VAT 2017 in bn euros: standard-rate final use 208.5, of which bought by the state 43.0.
WB31_STANDARD = 208.5
WB31_STANDARD_STATE = 43.0

# --- DIW Wochenbericht 13/2017 (Bach, Fischer, Haan, Wrohlich): spouse splitting ------------------
# Table 1 (p. 251), individual taxation with a transferable basic allowance, all couples, million
# euros, deciles 1..10 of household gross income per equivalent adult; no top 1 %.
WB13_SPLITTING = [19, 18, 107, 392, 846, 1376, 1914, 3035, 3813, 3878]
# The advantage of splitting is capped at high incomes, so the top 1 % is taken to have a tenth of
# decile 10, its share of the decile's people (an assumption).
SPLITTING_TOP_IN_DECILE_10 = 0.1

# --- BMF, Datensammlung zur Steuerpolitik, Ausgabe 2026, Table 2.2 (p. 20), year 2026 --------------
# Taxpayers ranked by total income, couples as one taxpayer. Cumulative shares in %.
BMF_INCOME_TAX = {"bottom_50": 6.5, "top_10": 56.9, "top_1": 24.6}
BMF_SOLI = {"bottom_50": 0.1, "top_10": 96.7, "top_1": 64.7}


def bmf_four(column):
    return [column["bottom_50"], 100 - column["bottom_50"] - column["top_10"], column["top_10"] - column["top_1"], column["top_1"]]


# --- Solidarity surcharge 2024 by tax, million euros (federal cash result; build_budget.py, SOLI) ---
SOLI_WAGE, SOLI_ASSESSED, SOLI_CORPORATE, SOLI_NV, SOLI_ABG = 4096.695, 3449.587, 2209.268, 1820.009, 1058.735
SOLI_EARNERS = SOLI_WAGE + SOLI_ASSESSED  # 7,546.282: offset of solidarity_surcharge, effect 0
SOLI_CAPITAL = SOLI_NV + SOLI_ABG  # 2,878.744: on withholding tax and the flat-rate tax
SOLI_NODE = SOLI_EARNERS + SOLI_CAPITAL + SOLI_CORPORATE  # 12,634.294: budget.json rev.taxes.income.soli
INCOME_TAX = 282261.305 + 58591.413  # budget.json wage tax and assessed income tax, million euros

# --- Eurostat, National Tax Lists (29 October 2026), sheet DE, 2024, million euros -------------------
# Withholding tax on capital income ("Kapitalertragsteuer und Zinsabschlag"): households D51M C03,
# corporations D51O C02. build_budget.py builds rev.taxes.income.capital_income from both, less the
# surcharge on them; the households' part of the tax and of its surcharge is taken to be the same.
CAPITAL_HOUSEHOLDS, CAPITAL_CORPORATIONS = 34652.0, 18662.0
CAPITAL_HOUSEHOLD_SHARE = CAPITAL_HOUSEHOLDS / (CAPITAL_HOUSEHOLDS + CAPITAL_CORPORATIONS)
# rev.taxes.income.other: income tax of non-residents D51E C01, EU energy crisis contribution D51O C05.
ABROAD, ENERGY_CRISIS = 15174.0, 1936.0
# rev.taxes.consumption.broadcasting_fee: households D59F C03, enterprises D29H C05.
BROADCASTING_HOUSEHOLDS, BROADCASTING_ENTERPRISES = 8264.0, 837.0
# rev.taxes.consumption.other (9,270 in all): of it paid by firms as such, bank levies and the deposit
# guarantee fund (D29H C03, C04, C06: 50 + 1,158 + 1) and administrative fees of enterprises (D29E C01: 218).
OTHER_LEVIES, OTHER_LEVIES_FIRMS = 9270.0, 50.0 + 1158.0 + 1.0 + 218.0

# --- Wealth tax and levy by income -------------------------------------------------------------
# Share of the revenue by percentile of gross income per equivalent adult (adults). The tables do not
# say where below the 99th percentile the rest falls: it goes to no group (payer "unassigned").
# DIW kompakt 211 (2026), Table 5-4 (p. 108), 1 %, personal allowance 2 million, no business
# allowance: 1st to 99th 17.5, 99.1 to 99.9 17.9, 99.91 to 99.99 25.6, top 0.01 % 39.0.
WEALTH_TAX = [17.5, 17.9 + 25.6 + 39.0]
# DIW kompakt 157 (2020), Table 4-7 (p. 54), 10 to 30 %, allowances 2 million and 5 million for
# business assets: 1st to 99th 0.3, 99.1 to 99.9 7.8, top 0.1 % 91.9.
WEALTH_LEVY = [0.3, 7.8 + 91.9]

# --- DIW Politikberatung kompakt 124 (Bach, Buslei 2017), Table 4-5 (p. 39), 2017 ------------------
# The flat-rate tax on capital income raised to 30 %, million euros, deciles of taxpayers (couples
# as one) by total income per equivalent adult, and the top percentiles: deciles 1 to 10, top 1 %.
FLAT_TAX_30 = [0, 0, 0, 0, 0, 3, 14, 34, 71, 1334, 1072]


def derive():
    capital = normalise(four(DIW_CAPITAL))
    soli_income_tax = normalise(bmf_four(BMF_SOLI))
    income_tax_bmf = normalise(bmf_four(BMF_INCOME_TAX))
    capital_households = SOLI_CAPITAL * CAPITAL_HOUSEHOLD_SHARE
    households = SOLI_EARNERS + capital_households
    soli_households = normalise([SOLI_EARNERS * a + capital_households * b for a, b in zip(soli_income_tax, capital)])
    # The surcharge on capital income and on corporate tax: the households' part of the capital
    # surcharge by profit and capital income, the rest to companies.
    on_capital = capital_households / (SOLI_CAPITAL + SOLI_CORPORATE)
    soli_capital_corporate = [round(on_capital * share, DIGITS) for share in capital]
    soli_capital_corporate_companies = round(1 - sum(soli_capital_corporate), DIGITS)
    # The surcharge for those exempt since 2021: 5.5 % on everybody's income tax, spread like income tax,
    # minus today's surcharge, spread like today's; a negative remainder is set to zero.
    full = [0.055 * INCOME_TAX * share for share in income_tax_bmf]
    today = [SOLI_EARNERS * share for share in soli_income_tax]
    soli_exempt = normalise([max(0.0, a - b) for a, b in zip(full, today)])
    wealth_tax_top = round(WEALTH_TAX[1] / 100, DIGITS)
    wealth_levy_top = round(WEALTH_LEVY[1] / 100, DIGITS)
    abroad = round(ABROAD / (ABROAD + ENERGY_CRISIS), DIGITS)
    broadcasting = round(BROADCASTING_HOUSEHOLDS / (BROADCASTING_HOUSEHOLDS + BROADCASTING_ENTERPRISES), DIGITS)
    levies = round(OTHER_LEVIES_FIRMS / OTHER_LEVIES, DIGITS)
    return {
        "income": normalise(four(DIW_INCOME)),
        "profiles": {
            "vat_standard": normalise(four(diw_burden("vat"))),
            "vat_food_transport": normalise(four(split_decile_10(WB31_FOOD_TRANSPORT, VAT_TOP_IN_DECILE_10))),
            "vat_other_reduced": normalise(four(split_decile_10(WB31_OTHER_REDUCED, VAT_TOP_IN_DECILE_10))),
            "energy": normalise(four(diw_burden("energy"))),
            "tobacco_alcohol": normalise(four(diw_burden("tobacco"))),
            "property_motor": normalise(four(diw_burden("property"))),
            "contributions": normalise(four(diw_burden("contributions"))),
            "capital_income": capital,
            "flat_tax_rise": normalise(four(FLAT_TAX_30)),
            "soli_households": soli_households,
            "soli_income_tax": soli_income_tax,
            "soli_exempt": soli_exempt,
            "splitting": normalise(four(split_decile_10(WB13_SPLITTING, SPLITTING_TOP_IN_DECILE_10))),
        },
        "payers": {
            "soli_capital_corporate": (soli_capital_corporate, {"companies": soli_capital_corporate_companies}),
            "wealth_tax": ([0.0, 0.0, 0.0, wealth_tax_top], {"unassigned": round(1 - wealth_tax_top, DIGITS)}),
            "wealth_levy": ([0.0, 0.0, 0.0, wealth_levy_top], {"unassigned": round(1 - wealth_levy_top, DIGITS)}),
            "abroad_and_companies": ([0.0, 0.0, 0.0, 0.0], {"abroad": abroad, "companies": round(1 - abroad, DIGITS)}),
            "broadcasting_fee": ([0.0, 0.0, 0.0, 0.0], {"unassigned": broadcasting, "companies": round(1 - broadcasting, DIGITS)}),
            "other_levies": ([0.0, 0.0, 0.0, 0.0], {"unassigned": round(1 - levies, DIGITS), "companies": levies}),
        },
        "coverage": {
            "rev.taxes.consumption.vat.standard.other": round(1 - WB31_STANDARD_STATE / WB31_STANDARD, DIGITS),
            "rev.taxes.income.soli": round(households / SOLI_NODE, DIGITS),
            "rev.taxes.income.capital_income": round(CAPITAL_HOUSEHOLD_SHARE, DIGITS),
        },
        # For pipeline/de/who-pays.md, not in the file.
        "compare": {
            "income_tax_bmf": income_tax_bmf,
            "taxes_diw": normalise(four(diw_burden("taxes"))),
            "taxes_and_contributions_diw": normalise(four(diw_burden("taxes_and_contributions"))),
            "direct_diw": normalise(four(diw_burden("direct"))),
            "indirect_diw": normalise(four(diw_burden("indirect"))),
            "passed_on_diw": normalise(four(diw_burden("passed_on"))),
        },
    }


def main():
    derived = derive()
    for key in ("income",):
        print(f"{key:28} {derived[key]}")
    for key, shares in derived["profiles"].items():
        print(f"profile {key:20} {shares}")
    for key, (shares, payers) in derived["payers"].items():
        print(f"profile {key:20} {shares} {payers}")
    for key, value in derived["coverage"].items():
        print(f"coverage {key:44} {value}")
    for key, shares in derived["compare"].items():
        print(f"compare {key:28} {shares}")
    if "--check" not in sys.argv:
        return
    data = json.loads((PACK / "incidence.json").read_text(encoding="utf-8"))
    problems = []

    def same(label, a, b):
        if len(a) != len(b) or any(abs(x - y) > 1e-6 for x, y in zip(a, b)):
            problems.append(f"{label}: file {a}, derived {b}")

    same("income.shares", data["income"]["shares"], derived["income"])
    for key, shares in derived["profiles"].items():
        same(f"profiles.{key}.shares", data["profiles"][key]["shares"], shares)
    for key, (shares, payers) in derived["payers"].items():
        same(f"profiles.{key}.shares", data["profiles"][key]["shares"], shares)
        for payer, part in payers.items():
            same(f"profiles.{key}.payers.{payer}", [data["profiles"][key].get("payers", {}).get(payer, 0)], [part])
    for key, value in derived["coverage"].items():
        same(f"nodes.{key}.coverage", [data["nodes"][key].get("coverage", 1)], [value])
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("incidence.json: every derived share matches")


if __name__ == "__main__":
    main()
