#!/usr/bin/env python3
"""Figures on people, incomes, wealth and SNAP for the measures added in November 2026, from the cache.

    python3 pipeline/us/households.py     print every figure, with the intermediate steps

measures.py takes the figures from `figures()` and checks the constants in policies.json against them.

Inputs (.cache/, written by fetch_inputs.py; nothing there is executed):
  census/nc-est2025-agesex-res.csv  Census Bureau, Vintage 2025: resident population by single year of age, July 1.
  irs/23in12ms.xls                  IRS Statistics of Income, tax year 2023, Table 1.2: returns, AGI and taxable
                                    income by size of AGI and filing status (thousand dollars).
  irs/23in35tr.xls, 23in36tr.xls    the same, Tables 3.5 and 3.6: income taxed at each rate, by size of AGI and by
                                    filing status.
  fed/dfa-networth-levels-detail.csv  Federal Reserve, Distributional Financial Accounts: net worth and number of
                                    households by wealth percentile group, quarterly ($ million).
  fns/FY25.xlsx                     USDA Food and Nutrition Service, SNAP state participation and benefits, fiscal
                                    year 2025 (data as of November 13, 2026).

Own steps, each named in the card that uses it:
  - Rebate phase-out: AGI is taken as evenly spread within each AGI class of Table 1.2; children are counted with
    the adults in proportion (the Census ratio of people under 18 to adults), because the table does not give
    children per return.
  - Top rate: the ordinary income above the bill's thresholds is the income taxed at 37% on returns with AGI of $1
    million or more (Table 3.5), less, for each return taxed at 37%, the income between the 37% threshold of 2023
    and the bill's threshold, weighted by the filing statuses of the returns taxed at 37% (Table 3.6).
  - Wealth: a Pareto distribution through the top 1% and the top 0.1% of the Distributional Financial Accounts
    gives the net worth above $50 million and above $1 billion.
"""
import csv, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
sys.path.insert(0, os.path.join(HERE, "..", "de"))
sys.path.insert(0, HERE)
from xlsx import X  # noqa: E402
from xls import XLS  # noqa: E402

# --- bill and law parameters (HAND: read from the bill or law text named) -----------------------------------
# S. 2475, American Worker Rebate Act of 2025 (Hawley, July 28, 2025), new IRC 6428C: $600 per eligible individual
# (twice on a joint return) and per qualifying child, reduced by 5% of AGI above these amounts.
REBATE_DEFAULT = 600
REBATE_PHASEOUT_RATE = 0.05
REBATE_THRESHOLD = {"joint": 150000, "separate": 75000, "head": 112500, "single": 75000}
ADULTS = {"joint": 2, "separate": 1, "head": 1, "single": 1}
# H.R. 4280, Bipartisan Tax Fairness Act of 2025 (Fitzpatrick, July 2, 2025): 39.6% on taxable income above
# $2,000,000 on joint returns and above $1,000,000 on other returns.
TOP_THRESHOLD = {"joint": 2000000, "separate": 1000000, "head": 1000000, "single": 1000000}
TOP_RATE_NOW = 37.0
# S. 4246, Ultra-Millionaire Tax Act of 2026 (Warren, March 26, 2026): 2% of net worth above $50 million, 3% above
# $1 billion.
WEALTH_ZERO_BRACKET = 50e6
WEALTH_TOP_THRESHOLD = 1e9
DFA_QUARTER = "2025:Q3"     # end of fiscal year 2025
# P.L. 119-21, sec. 10105 (new 7 U.S.C. 2013(a)(2)): State share of SNAP benefits by payment error rate, from fiscal
# year 2028: below 6% none, 6% to below 8% 5%, 8% to below 10% 10%, 10% or more 15%. As fractions of the top share:
SNAP_TIERS = [(6.0, 0.0), (8.0, 1 / 3), (10.0, 2 / 3), (float("inf"), 1.0)]
SNAP_TOP_SHARE = 15
# TRANSCRIBED by hand from USDA Food and Nutrition Service, "Supplemental Nutrition Assistance Program: Payment Error
# Rates, Fiscal Year 2025" (dated June 24, 2026; fns/snap-qcfy25-per.pdf, the one table of the document): per state
# the overpayment rate, the underpayment rate and the payment error rate, percent. Checks (snap_state_share): each
# row's two parts add up to its total within rounding, which catches a mistyped digit in any one of the three
# figures of a row; and the states' rates weighted by their FY 2025 benefits come to the published national rate
# within 0.05 points, which catches a wrong total in a large state. Not caught: the same slip in a part and in the
# total of one row, or a small state's rate swapped with another's.
SNAP_PER_ROWS = {
    "Alabama": (8.82, 0.70, 9.52), "Alaska": (20.58, 2.57, 23.15), "Arizona": (8.63, 2.16, 10.80),
    "Arkansas": (7.97, 0.84, 8.81), "California": (10.06, 0.87, 10.93), "Colorado": (8.52, 1.57, 10.09),
    "Connecticut": (7.43, 1.65, 9.08), "Delaware": (14.55, 1.45, 16.00), "District of Columbia": (15.33, 3.33, 18.66),
    "Florida": (11.54, 1.43, 12.97), "Georgia": (13.62, 1.59, 15.21), "Guam": (9.52, 2.18, 11.70),
    "Hawaii": (9.94, 0.98, 10.92), "Idaho": (3.45, 0.40, 3.85), "Illinois": (13.33, 1.33, 14.67),
    "Indiana": (7.73, 2.04, 9.77), "Iowa": (4.63, 0.71, 5.34), "Kansas": (8.46, 0.98, 9.44),
    "Kentucky": (4.02, 0.67, 4.70), "Louisiana": (6.84, 1.30, 8.14), "Maine": (9.33, 1.48, 10.81),
    "Maryland": (10.89, 2.19, 13.08), "Massachusetts": (11.83, 0.66, 12.49), "Michigan": (8.66, 1.23, 9.89),
    "Minnesota": (9.86, 2.72, 12.58), "Mississippi": (7.57, 1.94, 9.51), "Missouri": (8.24, 0.43, 8.67),
    "Montana": (7.51, 1.35, 8.86), "Nebraska": (4.82, 1.08, 5.90), "Nevada": (5.69, 0.53, 6.22),
    "New Hampshire": (6.15, 2.70, 8.85), "New Jersey": (4.81, 2.05, 6.86), "New Mexico": (15.76, 1.06, 16.81),
    "New York": (12.06, 1.12, 13.18), "North Carolina": (5.76, 1.60, 7.36), "North Dakota": (7.48, 2.40, 9.89),
    "Ohio": (5.10, 1.66, 6.76), "Oklahoma": (9.63, 1.41, 11.04), "Oregon": (13.88, 0.26, 14.14),
    "Pennsylvania": (8.03, 1.18, 9.21), "Rhode Island": (11.63, 0.79, 12.42), "South Carolina": (7.83, 0.97, 8.80),
    "South Dakota": (2.05, 0.42, 2.47), "Tennessee": (7.84, 1.60, 9.44), "Texas": (6.99, 2.35, 9.34),
    "Utah": (4.64, 0.89, 5.54), "Vermont": (5.06, 0.32, 5.38), "Virgin Islands": (4.17, 1.19, 5.36),
    "Virginia": (10.30, 2.02, 12.32), "Washington": (6.15, 0.83, 6.98), "West Virginia": (6.22, 0.46, 6.69),
    "Wisconsin": (5.32, 0.40, 5.72), "Wyoming": (3.55, 0.41, 3.96),
}
SNAP_PER_FY2025 = {state: row[2] for state, row in SNAP_PER_ROWS.items()}
SNAP_PER_NATIONAL = 10.62


def cache(rel):
    path = os.path.join(CACHE, rel)
    if not os.path.exists(path):
        sys.exit("missing %s: run pipeline/us/fetch_inputs.py first" % rel)
    return path


# --- Census ----------------------------------------------------------------------------------------------------

def population_2025():
    """(people under 18, people 18 and over) on July 1, 2025."""
    young = adults = 0
    for r in csv.DictReader(open(cache("census/nc-est2025-agesex-res.csv"), encoding="utf-8-sig")):
        if r["SEX"] != "0" or r["AGE"] == "999":
            continue
        v = int(r["POPESTIMATE2025"])
        if int(r["AGE"]) < 18:
            young += v
        else:
            adults += v
    return young, adults


# --- IRS Statistics of Income, Table 1.2 ------------------------------------------------------------------------

STATUS_COLUMN = {"all": 1, "joint": 13, "separate": 25, "head": 37, "single": 49}


def _bounds(label):
    label = label.replace("\n", " ").strip()
    if label.startswith("No adjusted gross income"):
        return None, 0.0
    nums = [float(x.replace(",", "")) for x in re.findall(r"\$([\d,]+)", label)]
    if "or more" in label:
        return nums[0], None
    return nums[0], nums[1]


def soi_classes():
    """{status: [(lower, upper, returns, AGI dollars, taxable income dollars)]} for all returns, by size of AGI."""
    book = XLS(cache("irs/23in12ms.xls"))
    rows = book.rows(book.sheets[0])
    out = {s: [] for s in STATUS_COLUMN}
    started = False
    for _, vals in rows:
        label = str(vals[0]) if vals and vals[0] not in (None, "None") else ""
        if label.startswith("All returns, total"):
            started = True
            continue
        if not started:
            continue
        if label.startswith("Taxable returns"):
            break
        lo, hi = _bounds(label)
        for status, c in STATUS_COLUMN.items():
            n = float(vals[c] or 0)
            out[status].append((lo, hi, n, float(vals[c + 1] or 0) * 1e3, float(vals[c + 7] or 0) * 1e3))
    total = sum(n for _, _, n, _, _ in out["all"])
    if abs(total - 160602107) > 10:              # the classes add up to the total within rounding
        sys.exit("Table 1.2: %d returns, not the published 160,602,107" % total)
    return out


def _loss_uniform(lo, hi, threshold, cap):
    """Average of min(cap, 5% x max(0, x - threshold)) for x evenly spread over [lo, hi]."""
    a = REBATE_PHASEOUT_RATE
    full = threshold + cap / a                      # income at which the payment is gone

    def integral(x):                                # integral from -inf to x of the loss
        if x <= threshold:
            return 0.0
        if x <= full:
            return a * (x - threshold) ** 2 / 2
        return a * (full - threshold) ** 2 / 2 + cap * (x - full)
    return (integral(hi) - integral(lo)) / (hi - lo)


def rebate(amount=REBATE_DEFAULT):
    """Rebate of `amount` per adult and child: gross cost for the whole population, the part the phase-out takes
    away from filers, and the net cost."""
    young, adults = population_2025()
    per_adult = amount * (1 + young / adults)       # the adult's own amount and, in proportion, the children's
    loss = 0.0
    for status, classes in soi_classes().items():
        if status == "all":
            continue
        cap = per_adult * ADULTS[status]
        t = REBATE_THRESHOLD[status]
        for lo, hi, n, agi, _ in classes:
            if not n or lo is None:
                continue
            if hi is None:                           # the open top class lies wholly above every phase-out
                loss += n * cap if lo >= t + cap / REBATE_PHASEOUT_RATE else n * _loss_uniform(lo, agi / n * 2 - lo, t, cap)
            else:
                loss += n * _loss_uniform(lo, hi, t, cap)
    gross = amount * (young + adults)
    return {"gross": gross, "loss": loss, "net": gross - loss, "people": young + adults, "young": young, "adults": adults}


# HAND: IRS, Rev. Proc. 2022-38, section 3.01, tables 1 to 4: the 37% rate began in tax year 2023 above these
# taxable incomes.
TOP_BRACKET_2023 = {"joint": 693750, "separate": 346875, "head": 578100, "single": 578125}
TABLE36_COLUMN = {"all": 1, "joint": 4, "separate": 7, "head": 10, "single": 13}


def _rate_row(rel):
    book = XLS(cache(rel))
    return book, book.rows(book.sheets[0])


def top_rate_base():
    """Ordinary taxable income above the H.R. 4280 thresholds, tax year 2023, dollars. Table 3.5 gives the income
    taxed at 37% by size of AGI; from each class of $1 million or more, the income between the 37% threshold and the
    bill's threshold is taken off for every return taxed at 37%, with the thresholds weighted by the filing statuses
    of the returns taxed at 37% (Table 3.6). Classes below $1 million are left out."""
    _, rows36 = _rate_row("irs/23in36tr.xls")
    row37 = next(v for _, v in rows36 if v and str(v[0]).strip().startswith("37 percent"))
    n37 = {s: float(row37[c]) for s, c in TABLE36_COLUMN.items()}
    gap = sum(n37[s] / n37["all"] * (TOP_THRESHOLD[s] - TOP_BRACKET_2023[s]) for s in TOP_THRESHOLD)
    book, rows35 = _rate_row("irs/23in35tr.xls")
    header = dict(rows35)[4]
    col = next(i for i, x in enumerate(header) if str(x).strip().startswith("37 percent"))
    base, income37 = 0.0, 0.0
    for _, v in rows35:
        label = str(v[0]) if v and v[0] not in (None, "None") else ""
        if not label.startswith("$"):
            continue
        lo, _ = _bounds(label)
        if lo is None or lo < 1e6:
            continue
        n, inc = float(v[col] or 0), float(v[col + 1] or 0) * 1e3
        income37 += inc
        base += max(0.0, inc - n * gap)
    total37 = float(row37[2]) * 1e3
    return {"base": base, "gap": gap, "income37_1m": income37, "income37_all": total37, "returns37": n37["all"],
            "joint_share": n37["joint"] / n37["all"]}


# --- Federal Reserve, Distributional Financial Accounts --------------------------------------------------------

def wealth():
    """Pareto tail through the top 1% and top 0.1% of households by net worth: index, households and net worth
    above the thresholds of S. 4246, and the tax base of each bracket (dollars)."""
    import zipfile
    with zipfile.ZipFile(cache("fed/dfa.zip")) as z:
        text = z.read("dfa-networth-levels-detail.csv").decode("utf-8-sig")
    rows = {r["Category"]: r for r in csv.DictReader(text.splitlines()) if r["Date"] == DFA_QUARTER}
    n01, w01 = float(rows["TopPt1"]["Household count"]), float(rows["TopPt1"]["Net worth"]) * 1e6
    n1 = n01 + float(rows["RemainingTop1"]["Household count"])
    w1 = w01 + float(rows["RemainingTop1"]["Net worth"]) * 1e6
    alpha = 1 / (1 - math.log(w01 / w1) / math.log(n01 / n1))
    t1 = w1 / n1 * (alpha - 1) / alpha                  # lower bound of the top 1% under the fitted tail

    def above(x):
        n = n1 * (x / t1) ** -alpha
        return n, n * x / (alpha - 1)                    # households above x, their net worth in excess of x
    n50, e50 = above(WEALTH_ZERO_BRACKET)
    nbn, ebn = above(WEALTH_TOP_THRESHOLD)
    return {"alpha": alpha, "top1_households": n1, "top1_wealth": w1, "top01_households": n01, "top01_wealth": w01,
            "top1_threshold": t1, "households_50m": n50, "households_1bn": nbn,
            "base_low": e50 - ebn, "base_high": ebn}


# --- SNAP ------------------------------------------------------------------------------------------------------

def snap_benefits_fy2025():
    """{state: benefits in fiscal year 2025, dollars} and the national total, from FNS's state workbook."""
    book = X(cache("fns/FY25.xlsx"))
    states, total = {}, None
    for sheet in book.sheets:
        current = None
        for _, r in book.rows(sheet):
            first = (r[0] if r else "").strip()
            rest = [c for c in r[1:] if str(c).strip()]
            if first and not rest and not first.startswith(("National", "SNAP", "Fiscal", "Footnotes", "ALL DATA")):
                current = None if first == sheet else first      # a block named like its sheet is the region's total
            elif first == "Total" and len(r) > 3 and r[3].strip() not in ("", "--"):
                if sheet == "US Summary":
                    total = float(r[3])
                elif current:
                    states[current] = float(r[3])
    if total is None or abs(sum(states.values()) - total) > 1:
        sys.exit("FNS FY25.xlsx: the states do not add up to the US total")
    return states, total


def snap_state_share():
    """Benefits of fiscal year 2025 that states would have paid under P.L. 119-21, sec. 10105, with their fiscal year
    2025 payment error rates; per tier and in total (dollars)."""
    states, total = snap_benefits_fy2025()
    for state, (over, under, rate) in SNAP_PER_ROWS.items():
        if abs(over + under - rate) > 0.015:
            sys.exit("SNAP error rates: %s %.2f + %.2f is not %.2f; check the transcription" % (state, over, under, rate))
    missing = [s for s, v in states.items() if v and s not in SNAP_PER_FY2025]
    if missing:
        sys.exit("SNAP: no payment error rate for %s" % missing)
    by_tier, weighted = [0.0, 0.0, 0.0, 0.0], 0.0
    for state, v in states.items():
        if not v:
            continue
        per = SNAP_PER_FY2025[state]
        weighted += per * v
        for i, (upper, _) in enumerate(SNAP_TIERS):
            if per < upper:
                by_tier[i] += v
                break
    if abs(weighted / total - SNAP_PER_NATIONAL) > 0.05:
        sys.exit("SNAP error rates: weighted %.2f against the national %.2f; check the transcription" % (weighted / total, SNAP_PER_NATIONAL))
    share = sum(v * f for v, (_, f) in zip(by_tier, SNAP_TIERS)) * SNAP_TOP_SHARE / 100
    delayed = sum(v for s, v in states.items() if v and SNAP_PER_FY2025[s] * 1.5 >= 20)
    return {"benefits": total, "by_tier": by_tier, "state_share": share, "delayed_benefits": delayed,
            "weighted_per": weighted / total, "states_15": sum(1 for s, v in states.items() if v and SNAP_PER_FY2025[s] >= 10),
            "states_0": sum(1 for s, v in states.items() if v and SNAP_PER_FY2025[s] < 6)}


# --- CMS, Marketplace open enrollment ---------------------------------------------------------------------------

def marketplace(year):
    """National row (all platforms) of CMS's open enrollment state-level public use file for a plan year."""
    import io, zipfile
    with zipfile.ZipFile(cache("cms/%d-oep-state-level-public-use-file.zip" % year)) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        text = z.read(name).decode("utf-8-sig")
    for r in csv.DictReader(io.StringIO(text)):
        if r["State_Abrvtn"].strip() == "Total" and r["Pltfrm"].strip() == "All":
            return {k: float(v.replace("$", "").replace(",", "").strip() or 0) for k, v in r.items()
                    if k in ("Cnsmr", "APTC_Cnsmr", "APTC_Cnsmr_Avg_APTC", "Avg_Prm", "Avg_Prm_Aftr_APTC")}
    sys.exit("CMS open enrollment file %d: no national row" % year)


def figures():
    f = {}
    for year in (2025, 2026):
        for k, v in marketplace(year).items():
            f["oep%d_%s" % (year, k)] = v
    young, adults = population_2025()
    f["pop_under18_2025"], f["pop_adults_2025"] = young, adults
    for amount in (600, 2000, 5000):
        r = rebate(amount)
        f["rebate_gross_%d" % amount], f["rebate_loss_%d" % amount], f["rebate_net_%d" % amount] = r["gross"], r["loss"], r["net"]
        f["rebate_loss_share_%d" % amount] = r["loss"] / r["gross"]
    f["rebate_per_dollar"] = round(f["rebate_net_600"] / 600)
    t = top_rate_base()
    for k, v in t.items():
        f["top_" + k] = v
    f["top_per_point"] = round(t["base"] / 100)
    w = wealth()
    for k, v in w.items():
        f["wealth_" + k] = v
    f["wealth_scale_low"] = round(w["base_low"] / 100)
    f["wealth_scale_high"] = round(w["base_high"] / 100)
    s = snap_state_share()
    f["snap_benefits_fy2025"] = s["benefits"]
    for i, v in enumerate(s["by_tier"]):
        f["snap_benefits_tier%d" % i] = v
    f["snap_state_share_fy2025"] = s["state_share"]
    f["snap_scale"] = round(s["state_share"] / SNAP_TOP_SHARE)
    f["snap_delayed_benefits"] = s["delayed_benefits"]
    f["snap_weighted_per"] = s["weighted_per"]
    f["snap_states_15"], f["snap_states_0"] = s["states_15"], s["states_0"]
    return f


if __name__ == "__main__":
    for k, v in figures().items():
        print("%-28s %s" % (k, "{:,.4f}".format(v) if abs(v) < 100 else "{:,.0f}".format(v)))
