#!/usr/bin/env python3
"""The figures of countries/us/incidence.json, the "Who pays" view: which income group pays which share of the
federal taxes, next to its share of income.

    python3 pipeline/us/who_pays.py            diagnostics: every figure, the checks, what the page will show
    python3 pipeline/us/who_pays.py --check    recompute and compare with countries/us/incidence.json
    python3 pipeline/us/who_pays.py --write    write the computed numbers into countries/us/incidence.json

Only numbers are computed and written: the group shares and lower bounds, the number of households, the income
shares, the shares of the computed profiles and the coverage of the unemployment-tax node. The texts of
incidence.json are maintained by hand. pipeline/us/who-pays.md explains every figure. The file gives no income total:
the diagnostics show why (the shares of income paid would come out above CBO's published rates).

Reads (pipeline/us/fetch_inputs.py downloads them into pipeline/us/.cache/):
  cbo/62761-supp-data.xlsx      CBO, The Distribution of Household Income, 2023 (September 2026), supplemental data:
                                Tables 1 (households), 2 (group minimums), 3 (average income), 7 (average taxes),
                                9 (average tax rates), 10 (income shares), 12 (tax shares); the rows for 2023
  cbo/62761-data.xlsx           the report's figure data, Figure 13: refundable credits as a share of income
  irs/23in01w2all.xlsx          IRS Statistics of Income, Form W-2 statistics 2023, Table 1.H: wages by size of AGI
                                and multiple of the Social Security wage base -> wages above the cap
  irs/23in12ms.xls              IRS Statistics of Income 2023, Table 1.2: number of returns by size of AGI
  omb/receipts_fy2027.xlsx      OMB Public Budget Database, receipts: FUTA and the states' deposits in 2025
  bea/NipaDataA.txt             BEA, NIPA annual series: GDP of calendar year 2023 (A191RC), diagnostics only
  countries/us/budget.json, countries/us/country.json   the revenue leaves; GDP of fiscal year 2025 (OMB)
Read by hand (constants marked HAND below): Treasury OTA, Distribution Table 2025 001 (estate and gift taxes);
Tax Policy Center, Table T24-0048 (August 1, 2024), an image; Penn Wharton Budget Model, "Eliminating Income Taxes
on Social Security Benefits" (February 7, 2025), Table 3, for comparison.
Standard library only.
"""
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
CACHE = os.path.join(HERE, ".cache")
PACK = os.path.join(ROOT, "countries", "us")
sys.path.insert(0, os.path.join(HERE, "..", "de"))
sys.path.insert(0, HERE)
from xlsx import X  # noqa: E402  the generic stdlib reader of the German pipeline
from xls import XLS  # noqa: E402  the BIFF8 reader of the US pipeline

YEAR = "2023"
# The groups of CBO's tables, lowest incomes first, with the row labels of the supplemental data.
GROUPS = [
    ("q1", "Lowest quintile"), ("q2", "Second quintile"), ("q3", "Middle quintile"), ("q4", "Fourth quintile"),
    ("p81_90", "81st to 90th percentiles"), ("p91_95", "91st to 95th percentiles"),
    ("p96_99", "96th to 99th percentiles"), ("top_1", "Top 1 percent"),
]
IDS = [g for g, _ in GROUPS]
TAXES = ["federal", "individual", "payroll", "corporate", "excise"]   # columns C to G of Tables 7, 9 and 12
WAGE_BASE_2023 = 160200   # Social Security contribution and benefit base 2023 (the "1 time" of IRS Table 1.H)

# HAND: Treasury, Office of Tax Analysis, Distribution Table 2025 001 (June 12, 2024), "Percent Distribution",
# column "Estate and Gift Taxes": 0.0 in every decile from 0 to 90, 90 to 95: 0.0, 95 to 99: 0.1, 99 to 99.9: 6.7,
# Top .1: 91.8 (the rows add up to 98.7; families with negative income pay the rest).
OTA_ESTATE = {"q1": 0.0, "q2": 0.0, "q3": 0.0, "q4": 0.0, "p81_90": 0.0, "p91_95": 0.0, "p96_99": 0.1,
              "top_1": 6.7 + 91.8}
# HAND: Tax Policy Center, Table T24-0048, "Exclude Social Security Benefits from Gross Income", distribution by
# expanded cash income percentile, 2025 (preliminary, August 1, 2024), column "Share of Total Federal Tax Change":
# lowest quintile 0.0, second 3.7, middle 23.9, fourth 36.5, 80-90 17.1, 90-95 8.6, 95-99 7.7, top 1 percent 2.4.
# Its percentiles hold equal numbers of people (note 3), as CBO's do.
TPC_SS = {"q1": 0.0, "q2": 3.7, "q3": 23.9, "q4": 36.5, "p81_90": 17.1, "p91_95": 8.6, "p96_99": 7.7, "top_1": 2.4}
# HAND, for comparison only: Penn Wharton Budget Model, Table 3, 2026, average tax change in dollars per household,
# and the size of each group as a share of households (quintiles and percentile bands of the income distribution).
PWBM_SS = [("q1", 0, 0.20), ("q2", -15, 0.20), ("q3", -340, 0.20), ("q4", -1135, 0.20), ("p81_90", -1625, 0.10),
           ("p91_95", -1590, 0.05), ("p96_99", -2020, 0.04), ("top_1", -2205, 0.009), ("top_1", -2450, 0.001)]


def need(rel):
    path = os.path.join(CACHE, rel)
    if not os.path.exists(path):
        sys.exit("missing %s: run pipeline/us/fetch_inputs.py first" % rel)
    return path


def num(text):
    return float(str(text).replace(",", "").strip())


def cbo_rows(book, sheet, first_col):
    """{group label: [values]} of the 2023 rows of one CBO table (all households)."""
    out = {}
    for _, r in book.rows(sheet):
        if len(r) > 2 and r[1] == YEAR:
            out[r[0]] = [num(v) for v in r[2:]]
    missing = [label for _, label in GROUPS + [("all", first_col)] if label not in out]
    if missing:
        sys.exit("%s: no 2023 row for %s" % (sheet, missing))
    return out


def normalize(values):
    total = sum(values)
    return [v / total for v in values]


def rounded(shares, digits=6):
    """Shares rounded to `digits`, the rounding difference put on the largest, so that they add up to exactly 1."""
    out = [round(s, digits) for s in shares]
    i = max(range(len(out)), key=lambda k: out[k])
    out[i] = round(out[i] + 1 - sum(out), digits)
    return out


def cbo():
    book = X(need("cbo/62761-supp-data.xlsx"))
    demo = cbo_rows(book, "1. Demographics", "All quintiles")
    mins = {}
    for _, r in book.rows("2. Income Group Mins"):
        if len(r) > 2 and r[1] == YEAR:
            mins[int(num(r[0]))] = [num(v) for v in r[2:]]
    avg = cbo_rows(book, "3. Avg HH Income", "All quintiles")
    taxes = cbo_rows(book, "7. Federal Taxes", "All quintiles")
    rates = cbo_rows(book, "9. Federal Tax Rates", "All quintiles")
    inc_shares = cbo_rows(book, "10. Household Income Shares", "All quintiles")
    tax_shares = cbo_rows(book, "12. Federal Taxes Shares", "All quintiles")
    labels = [label for _, label in GROUPS]
    # Table 2 has one column per group in the order lowest .. highest quintile, then 81-90, 91-95, 96-99, top 1;
    # the highest quintile's column is dropped (its minimum is that of the 81st to 90th percentiles).
    minimum = {size: [row[0], row[1], row[2], row[3], row[5], row[6], row[7], row[8]] for size, row in mins.items()}
    return {
        "households": [demo[label][0] * 1e6 for label in labels],           # Table 1, column C, millions
        "households_all": demo["All quintiles"][0] * 1e6,
        "minimum": minimum,                                                 # Table 2, 2023 dollars, by household size
        "avg_income_all": avg["All quintiles"][2],                          # Table 3, column E
        "avg_income": [avg[label][2] for label in labels],
        "avg_taxes_all": dict(zip(TAXES, taxes["All quintiles"])),          # Table 7, columns C to G
        "rates": {t: [rates[label][i] for label in labels] for i, t in enumerate(TAXES)},   # Table 9, percent
        "income_share": [inc_shares[label][1] for label in labels],         # Table 10, column D, percent
        "tax_share": {t: [tax_shares[label][i] for label in labels] for i, t in enumerate(TAXES)},   # Table 12
    }


def refundable_credits_2023():
    """CBO figure data, Figure 13: average refundable tax credits as a percentage of income before transfers and
    taxes, 2023, for the lowest, second and middle quintiles."""
    for _, r in X(need("cbo/62761-data.xlsx")).rows("Figure 13"):
        if r and r[0] == YEAR:
            return [num(v) for v in r[1:4]]
    sys.exit("Figure 13: no row for 2023")


def above_cap_by_agi():
    """IRS Table 1.H: [(AGI low, AGI high or None, wages above the 2023 wage base in dollars)]; wages of taxpayers
    below the base contribute nothing, those in the columns '1 under 2', '2 under 4' and '4 times and over'
    contribute their wages less one wage base each."""
    out = []
    for _, r in X(need("irs/23in01w2all.xlsx")).rows("Table 1.H"):
        label = (r[0] if r else "").strip()
        if not label.startswith("$"):
            continue
        parts = label.replace("$", "").replace(",", "").split()
        low = float(parts[0])
        high = float(parts[2]) if parts[1] == "under" else None
        cells = [num(v) if v not in ("", None) else 0.0 for v in r[1:11]]
        above = sum(cells[k + 1] * 1000 - cells[k] * WAGE_BASE_2023 for k in (4, 6, 8))
        out.append((low, high, above))
    return out


def returns_by_agi():
    """IRS Table 1.2: [(AGI low, AGI high or None, number of returns)] for returns with positive AGI."""
    book = XLS(need("irs/23in12ms.xls"))
    out, started = [], False
    for _, r in book.rows(book.sheets[0]):
        label = str(r[0] or "").strip() if r else ""
        if label.startswith("All returns"):
            started = True
            continue
        if not started:
            continue
        if label.startswith("Taxable returns"):
            break
        if not label.startswith("$"):
            continue
        parts = label.replace("$", "").replace(",", "").split()
        low = float(parts[0])
        high = float(parts[2]) if parts[1] == "under" else None
        out.append((low, high, float(r[1])))
    return out


class AgiDistribution:
    """Returns ranked by AGI: Pareto within each class of Table 1.2 (through the counts above its two bounds)."""

    def __init__(self, classes):
        self.classes = classes
        self.total = sum(n for _, _, n in classes)
        self.above = []   # (low, high, N above low, N above high, alpha)
        cum = self.total
        for low, high, n in classes:
            n_above_high = cum - n
            if high is None or n_above_high <= 0:
                alpha = None
            else:
                alpha = math.log(cum / n_above_high) / math.log(high / max(low, 1.0))
            self.above.append((max(low, 1.0), high, cum, n_above_high, alpha))
            cum = n_above_high

    def count_above(self, x):
        for low, high, n_low, n_high, alpha in self.above:
            if high is None or x < high:
                if x <= low:
                    return n_low
                if alpha is None:
                    raise ValueError("no Pareto exponent in the open top class")
                return n_low * (x / low) ** (-alpha)
        return 0.0

    def cut(self, share_from_top):
        """AGI above which `share_from_top` of the returns lie."""
        target = share_from_top * self.total
        for low, high, n_low, n_high, alpha in self.above:
            if n_high <= target <= n_low and alpha:
                return low * (target / n_low) ** (-1.0 / alpha)
        raise ValueError("cut outside the classes")

    def mass(self, a, b):
        """AGI of the returns between a and b (b None = no upper bound), up to a constant factor per piece."""
        total = 0.0
        for low, high, n_low, n_high, alpha in self.above:
            lo = max(a, low)
            hi = b if high is None else (min(b, high) if b is not None else high)
            if hi is not None and hi <= lo:
                continue
            if alpha is None:
                raise ValueError("mass in the open top class")
            # density of returns n_low * alpha * low^alpha * x^(-alpha-1); AGI mass integrates x times that
            k = n_low * alpha * low ** alpha
            if abs(alpha - 1) < 1e-9:
                total += k * (math.log(hi) - math.log(lo))
            else:
                total += k * (lo ** (1 - alpha) - hi ** (1 - alpha)) / (alpha - 1)
        return total


def wage_cap_profile(group_shares):
    """Wages above the Social Security wage base by income group: IRS Table 1.H's AGI classes, cut at the AGI that
    ranks the same share of returns (Table 1.2) from the top as each group holds of households; within a class the
    wages above the base follow AGI."""
    dist = AgiDistribution(returns_by_agi())
    cum, cuts = 0.0, {}
    for gid, share in reversed(list(zip(IDS, group_shares))):
        cum += share
        if gid != "q1":
            cuts[gid] = dist.cut(cum)    # lowest AGI of the group
    bounds = {}
    upper = None
    for gid in reversed(IDS):
        low = cuts.get(gid, 1.0)
        bounds[gid] = (low, upper)
        upper = low
    result = dict.fromkeys(IDS, 0.0)
    classes = above_cap_by_agi()
    for low, high, above in classes:
        if above <= 0:
            continue
        lo, hi = max(low, 1.0), high
        if hi is None:   # the open class of $10M and over lies above every cut
            result["top_1"] += above
            continue
        whole = dist.mass(lo, hi)
        for gid, (g_lo, g_hi) in bounds.items():
            a = max(lo, g_lo)
            b = hi if g_hi is None else min(hi, g_hi)
            if b > a:
                result[gid] += above * dist.mass(a, b) / whole
    total = sum(above for _, _, above in classes)
    return [result[g] for g in IDS], cuts, total, dist


def budget_leaves():
    budget = json.load(open(os.path.join(PACK, "budget.json")))
    out = {}

    def walk(node, path):
        kids = node.get("children") or []
        if not kids:
            out[node["id"]] = (node.get("amount", 0), path + [node["id"]])
        for k in kids:
            walk(k, path + [node["id"]])
    for node in budget["revenue"]:
        walk(node, [])
    return out


def unemployment_split():
    """OMB receipts database, 2025: the Unemployment Insurance subcategory (933-10) by account, thousand dollars."""
    book = X(need("omb/receipts_fy2027.xlsx"))
    rows = book.rows(list(book.sheets)[0])
    _, head = next(rows)
    col = {h: i for i, h in enumerate(head)}
    parts = {}
    for _, r in rows:
        if len(r) > col["2025"] and r[col["Source Category Code"]] == "933" and r[col["Source Subcategory"]] == "10":
            parts[r[col["Account Name"]]] = num(r[col["2025"]] or 0) * 1000
    states = sum(v for k, v in parts.items() if "Deposits by States" in k)
    return parts, states, sum(parts.values())


def gdp_2023():
    for line in open(need("bea/NipaDataA.txt")):
        if line.startswith("A191RC,2023,"):
            return num(line.split(",", 2)[2].strip().strip('"')) * 1e6
    sys.exit("BEA: no A191RC for 2023")


def compute():
    c = cbo()
    hh = c["households"]
    group_shares = normalize(hh)
    income_share = normalize(c["income_share"])
    # Total income of the households in the groups, 2023: CBO's average for all households times their number,
    # times the groups' part of it (Table 10's shares of the groups add up to more than 100 because the households
    # with negative income, in no group, have negative income).
    income_all_2023 = c["avg_income_all"] * c["households_all"]
    income_groups_2023 = income_all_2023 * sum(c["income_share"]) / 100
    country = json.load(open(os.path.join(PACK, "country.json")))
    gdp_fy2025 = country["indicators"]["gdp"]["value"]
    growth = gdp_fy2025 / gdp_2023()
    income_total = income_groups_2023 * growth
    ts = c["tax_share"]
    profiles = {
        # CBO counts refundable credits as negative income tax; the two lowest fifths pay less than nothing on
        # balance. The budget books the part of the credits above a household's tax as spending: on the receipts
        # node those groups are set to zero, the others keep CBO's proportions.
        "individual_income_tax": normalize([max(v, 0.0) for v in ts["individual"]]),
        "payroll_taxes": normalize(ts["payroll"]),
        "excise_taxes": normalize(ts["excise"]),
        "customs_duties": normalize(ts["excise"]),
        "estate_gift_taxes": normalize([OTA_ESTATE[g] for g in IDS]),
        "top_1_percent": [0.0] * 7 + [1.0],
    }
    cap, cap_cuts, cap_total, dist = wage_cap_profile(group_shares)
    profiles["wages_above_cap"] = normalize(cap)
    profiles["social_security_benefit_tax"] = normalize([TPC_SS[g] for g in IDS])
    pwbm = dict.fromkeys(IDS, 0.0)
    for gid, change, size in PWBM_SS:
        pwbm[gid] += -change * size
    # The two lowest fifths' income tax before refundable credits, 2023: net rate (Table 9) plus credits (Figure 13)
    credits = refundable_credits_2023()
    before_credits = []
    for i in range(2):
        rate = (c["rates"]["individual"][i] + credits[i]) / 100
        before_credits.append((rate, rate * c["avg_income"][i] * c["households"][i]))
    parts, states, unemployment = unemployment_split()
    return {
        "pwbm_ss": normalize([pwbm[g] for g in IDS]), "credits": credits, "before_credits": before_credits,
        "cbo": c, "group_shares": group_shares, "income_share": income_share, "income_all_2023": income_all_2023,
        "income_groups_2023": income_groups_2023, "growth": growth, "income_total": income_total,
        "profiles": profiles, "cap_cuts": cap_cuts, "cap_total": cap_total, "cap_by_group": cap, "dist": dist,
        "unemployment_parts": parts, "unemployment_states": states, "unemployment_total": unemployment,
        "coverage_unemployment": 1 - states / unemployment,
    }


def published_shares(c, without_corporate):
    """Each group's share of CBO's federal taxes, from Table 12's shares by tax and Table 7's totals by tax."""
    kinds = ["individual", "payroll", "excise"] + ([] if without_corporate else ["corporate"])
    totals = {t: c["avg_taxes_all"][t] * c["households_all"] for t in kinds}
    amount = [sum(c["tax_share"][t][i] / 100 * totals[t] for t in kinds) for i in range(len(IDS))]
    return [a / sum(totals.values()) for a in amount], totals


def page_view(result, incidence):
    """What the view shows today: every revenue leaf of budget.json through the node map of incidence.json."""
    leaves = budget_leaves()
    nodes = incidence["nodes"]
    profiles = {k: v["shares"] for k, v in incidence["profiles"].items()}
    groups = [0.0] * len(IDS)
    payers, seen = {}, {}
    for leaf, (amount, path) in leaves.items():
        entry = next((nodes[p] for p in reversed(path) if p in nodes), None)
        if entry is None:
            raise SystemExit("leaf %s has no entry in the node map" % leaf)
        seen[leaf] = entry
        cov = entry.get("coverage", 1.0 if "profile" in entry else 0.0)
        if "profile" in entry:
            for i, s in enumerate(profiles[entry["profile"]]):
                groups[i] += amount * cov * s
        rest = amount * (1 - cov)
        if rest > 1e-6:
            if "payer" not in entry:
                raise SystemExit("leaf %s: %.0f not spread and no payer" % (leaf, rest))
            payers[entry["payer"]] = payers.get(entry["payer"], 0.0) + rest
    total = sum(a for a, _ in leaves.values())
    return groups, payers, total, leaves, seen


def numbers(result):
    """The numbers of incidence.json that this script owns, keyed by their place in the file."""
    c = result["cbo"]
    out = {"population.count": int(round(sum(c["households"])))}
    for i, gid in enumerate(IDS):
        out["groups.%s.share" % gid] = rounded(result["group_shares"])[i]
        if i > 0:   # the first group has no lower bound
            out["groups.%s.from" % gid] = int(c["minimum"][1][i])
    out["income.shares"] = rounded(result["income_share"])
    for pid, shares in result["profiles"].items():
        out["profiles.%s.shares" % pid] = rounded(shares)
    out["nodes.rev.social_insurance.unemployment.coverage"] = round(result["coverage_unemployment"], 6)
    return out


def get_set(doc, key, value=None):
    """Read (value None) or write one of the numbers() keys in the incidence.json document."""
    if key == "population.count":
        target, field = doc["population"], "count"
    elif key.startswith("groups."):
        _, gid, field = key.split(".")
        target = next(g for g in doc["groups"] if g["id"] == gid)
    elif key.startswith("income."):
        target, field = doc["income"], key.split(".")[1]
    elif key.startswith("profiles."):
        _, pid, field = key.split(".")
        target = doc["profiles"].setdefault(pid, {})
    elif key.startswith("nodes."):
        node, field = key[len("nodes."):].rsplit(".", 1)
        target = doc["nodes"][node]
    else:
        raise KeyError(key)
    if value is None:
        return target.get(field)
    target[field] = value
    return value


def report(result, incidence):
    c = result["cbo"]
    pct = lambda v: "%6.2f" % (100 * v)   # noqa: E731
    print("CBO, The Distribution of Household Income, 2023 (September 2026): the 2023 rows, all households")
    print("households: all %.1fM, in the groups %.1fM (the rest have negative income)" % (
        c["households_all"] / 1e6, sum(c["households"]) / 1e6))
    print("%-8s %8s %7s %9s %8s | CBO shares of federal taxes (Table 12): all, income, payroll, corporate, excise"
          % ("group", "hh (M)", "hh %", "from ($)", "income %"))
    for i, gid in enumerate(IDS):
        print("%-8s %8.1f %s %9.0f %s | %s" % (
            gid, c["households"][i] / 1e6, pct(result["group_shares"][i]), c["minimum"][1][i],
            pct(result["income_share"][i]), "  ".join("%6.1f" % c["tax_share"][t][i] for t in TAXES)))
    print("sums of the published shares: income %.1f, taxes %s" % (
        sum(c["income_share"]), ", ".join("%s %.1f" % (t, sum(c["tax_share"][t])) for t in TAXES)))
    print("income before transfers and taxes, 2023: all households %.1fB, groups %.1fB; x GDP FY2025/CY2023 %.5f"
          " = %.1fB (not in the file, see the rates below)" % (
              result["income_all_2023"] / 1e9, result["income_groups_2023"] / 1e9, result["growth"],
              result["income_total"] / 1e9))
    print()
    print("Profiles (shares in percent, lowest group first):")
    for pid, shares in result["profiles"].items():
        print("  %-28s %s" % (pid, " ".join(pct(s) for s in shares)))
    print("  %-28s %s" % ("(PWBM, benefit tax, compare)", " ".join(pct(s) for s in result["pwbm_ss"])))
    print()
    print("Income tax of the two lowest fifths before refundable credits, 2023: net rate (Table 9) + credits"
          " (Figure 13: %s %% of income for the lowest three fifths)" % ", ".join("%.1f" % v for v in result["credits"]))
    for gid, (rate, amount) in zip(IDS, result["before_credits"]):
        print("  %-8s %.1f %% of income = %.1fB (CBO's net income tax of all households: %.1fB)" % (
            gid, 100 * rate, amount / 1e9, c["avg_taxes_all"]["individual"] * c["households_all"] / 1e9))
    net = c["avg_taxes_all"]["individual"] * c["households_all"]
    positive = sum(max(v, 0.0) for v in c["tax_share"]["individual"]) / 100 * net
    top = c["tax_share"]["individual"][-1] / 100 * net
    print("  top 1%% of the receipts: %.2f %% with zero for the two groups, %.2f %% with the amounts above" % (
        100 * top / positive, 100 * top / (positive + sum(a for _, a in result["before_credits"]))))
    print()
    all_in, totals = published_shares(c, without_corporate=False)
    no_corp, totals_nc = published_shares(c, without_corporate=True)
    print("CBO's shares of federal taxes, 2023: published (Table 12, col. C), recomputed from the four taxes, and")
    print("derived without the corporate income tax (individual income, payroll and excise taxes):")
    print("  totals by tax from Table 7 x households (B): " + ", ".join(
        "%s %.1f" % (t, v / 1e9) for t, v in totals.items()))
    for i, gid in enumerate(IDS):
        print("  %-8s published %5.1f  recomputed %s  without corporate %s" % (
            gid, c["tax_share"]["federal"][i], pct(all_in[i]), pct(no_corp[i])))
    print()
    print("Wages above the Social Security wage base, 2023 (IRS Table 1.H): %.1fB" % (result["cap_total"] / 1e9))
    print("  lowest AGI of each group when returns (Table 1.2, %.1fM with AGI above zero) are cut at the groups'"
          " shares: %s" % (result["dist"].total / 1e6, ", ".join(
              "%s $%.0f" % (g, v) for g, v in sorted(result["cap_cuts"].items(), key=lambda kv: kv[1]))))
    print("  by group (B): " + ", ".join("%s %.1f" % (g, v / 1e9) for g, v in zip(IDS, result["cap_by_group"])))
    print()
    print("Unemployment insurance receipts 2025 (OMB, 933-10): " + "; ".join(
        "%s %.3fB" % (k, v / 1e9) for k, v in result["unemployment_parts"].items() if v))
    print("  states' deposits %.3fB of %.3fB -> spread like payroll taxes: %.6f" % (
        result["unemployment_states"] / 1e9, result["unemployment_total"] / 1e9, result["coverage_unemployment"]))
    if incidence is None:
        return
    groups, payers, total, leaves, seen = page_view(result, incidence)
    attributed = sum(groups)
    print()
    print("What the view shows today, FY 2025 amounts of budget.json through the node map of incidence.json:")
    print("  revenue %.1fB = groups %.1fB + payers %s" % (total / 1e9, attributed / 1e9, ", ".join(
        "%s %.1fB" % (k, v / 1e9) for k, v in payers.items())))
    assert abs(attributed + sum(payers.values()) - total) < 1, "the statement does not add up to the revenue"
    scope_nodes = incidence["scopes"][0]["nodes"]
    for i, gid in enumerate(IDS):
        rate = groups[i] / (result["income_total"] * incidence["income"]["shares"][i])
        cbo_rate = c["rates"]["federal"][i] - c["rates"]["corporate"][i]
        print("  %-8s pays %s %% of the attributed taxes (%.1fB);  CBO all-in %5.1f, CBO without corporate %s;"
              "  of its income with a GDP-grown total %s %%, CBO's rate without corporate %.1f %%" % (
                  gid, pct(groups[i] / attributed), groups[i] / 1e9, c["tax_share"]["federal"][i], pct(no_corp[i]),
                  pct(rate), cbo_rate))
    print("  scope 1 (%s): %s" % (incidence["scopes"][0]["id"], ", ".join(scope_nodes)))
    print("  every revenue leaf has an entry: %d leaves, %d with one" % (len(leaves), len(seen)))


def main():
    result = compute()
    path = os.path.join(PACK, "incidence.json")
    incidence = json.load(open(path)) if os.path.exists(path) else None
    if "--write" in sys.argv:
        if incidence is None:
            sys.exit("countries/us/incidence.json is missing: write the texts first")
        for key, value in numbers(result).items():
            get_set(incidence, key, value)
        incidence["income"].pop("total", None)
        incidence["groups"][0].pop("from", None)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(incidence, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("wrote", os.path.relpath(path, ROOT))
        return
    if "--check" in sys.argv:
        if incidence is None:
            sys.exit("countries/us/incidence.json is missing")
        bad = 0
        for key, value in numbers(result).items():
            have = get_set(incidence, key)
            same = (have == value) if not isinstance(value, list) else (
                isinstance(have, list) and len(have) == len(value) and all(abs(a - b) < 1e-9 for a, b in
                                                                          zip(have, value)))
            if not same:
                bad += 1
                print("DIFF", key, "file:", have, "computed:", value)
        if "total" in incidence["income"] or "from" in incidence["groups"][0]:
            bad += 1
            print("DIFF the file gives an income total or a lower bound for the first group")
        for pid, prof in incidence["profiles"].items():
            s = prof["shares"] + list((prof.get("payers") or {}).values())
            assert len(prof["shares"]) == len(IDS) and min(s) >= 0 and abs(sum(s) - 1) < 1e-6, "profile %s" % pid
        assert abs(sum(g["share"] for g in incidence["groups"]) - 1) < 1e-6
        assert abs(sum(incidence["income"]["shares"]) - 1) < 1e-6
        page_view(result, incidence)
        print("no difference" if not bad else "%d differences" % bad)
        sys.exit(1 if bad else 0)
    report(result, incidence)


if __name__ == "__main__":
    main()
