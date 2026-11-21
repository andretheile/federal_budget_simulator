#!/usr/bin/env python3
"""countries/us/debt.json, the projection of debt and interest, built from the cache.

    python3 pipeline/us/debt.py            print the figures behind debt.json, with their sources
    python3 pipeline/us/debt.py --check    rebuild debt.json in memory and compare it with the file; exit status 1 on
                                           any difference
    python3 pipeline/us/debt.py --write    replace debt.json

Every number in debt.json, in its values and in its texts, is computed here from the files in pipeline/us/.cache/
(fetch_inputs.py). Figures that only a PDF holds are constants marked HAND with the place they were read; where an
Excel table holds the same figure for other years, the script checks the hand-read values against it.

What the file holds:
  stock          debt held by the public at the end of FY 2025 (OMB, Historical Table 7.1)
  interest       net interest in FY 2025 (Historical Table 3.1), the budget item exp.net_interest
  refinancing    the share of the debt that takes the market rate each year, fitted so that the engine's recursion
                 reproduces OMB's sensitivity of outlays to rates (Analytical Perspectives, Table 1-3); the average
                 maturity of marketable debt (Treasury, Monthly Statement of the Public Debt) is shown beside it
  assumptions    market rate: Treasury's par yield curve on its latest date, weighted by the terms at issue of the
                 marketable debt; growth: the Federal Reserve's longer-run real growth plus its 2 % inflation target
  presets        OMB's economic assumptions; Treasury yields of 2012-2021 and 1991-2000 weighted the same way; the
                 worsening of the primary deficit in Treasury's long-term projection
  plans          OMB's current-services baseline to FY 2036 and the President's Budget to FY 2031, as balance, net
                 interest, net interest over receipts and growth (OMB projects no debt)
  references     FY 1946 (highest debt) and FY 1991 (highest interest burden before FY 2025)
  measuresFrom   FY 2028, with the end date of the continuing resolution for FY 2027 (P.L. 119-103)
"""
import csv, datetime as dt, html, json, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
PACK = os.path.normpath(os.path.join(HERE, "..", "..", "countries", "us"))
OUT = os.path.join(PACK, "debt.json")
sys.path.insert(0, os.path.join(HERE, "..", "de"))
from xlsx import X  # the generic stdlib reader of the German pipeline

BASE = 2025
MEASURES_FROM = 2028
COMPARISONS = [("exp.defense", "national defense", "Verteidigung"), ("exp.medicare", "Medicare", "Medicare"),
               ("exp.social_security", "Social Security", "Social Security"),
               ("exp.health.medicaid", "Medicaid", "Medicaid")]

# ---- constants read by hand ---------------------------------------------------------------------------------------
# HAND: OMB, Analytical Perspectives FY 2027, chapter 12 (ap_12_current_services_fy2027.pdf), p. 134, Table 12-4,
# "Total, receipts", $ billion. 2026-2031 are checked against Historical Table 2.1, which has no years after 2031.
T12_4_RECEIPTS = {2025: 5236.4, 2026: 5475.7, 2027: 5921.0, 2028: 6288.4, 2029: 6660.3, 2030: 7137.3, 2031: 7559.4,
                  2032: 7984.3, 2033: 8446.8, 2034: 8891.3, 2035: 9360.8, 2036: 9846.1}
# HAND: the same table, "Customs duties", $ billion.
T12_4_CUSTOMS = {2025: 194.9, 2026: 406.1, 2036: 681.3}
# HAND: the same page, Table 12-2 (fiscal years): GDP in current dollars, $ billion (2025-2031 checked against
# Historical Table 10.1), real GDP in chained 2017 dollars, and the 91-day bill and ten-year note rates, percent.
T12_2_GDP = {2025: 30323, 2026: 32076, 2027: 33793, 2028: 35540, 2029: 37372, 2030: 39285, 2031: 41254,
             2032: 43295, 2033: 45436, 2034: 47683, 2035: 50039, 2036: 52515}
T12_2_REAL_GDP = {2025: 23709, 2031: 28357, 2036: 32715}
T12_2_BILL = {2030: 3.1, 2036: 3.1}
T12_2_NOTE10 = {2030: 3.4, 2036: 3.3}
# HAND: Analytical Perspectives FY 2027, chapter 1 (ap_1_assumptions_fy2027.pdf), p. 5, Table 1-2, 10-year Treasury
# notes in the 2027 Budget, calendar years: 3.3 percent from 2030 ("a terminal rate of 3.3 percent in 2030", p. 3).
AP1_NOTE10_TERMINAL = (2030, 3.3)
# HAND: the same chapter, p. 7, Table 1-3, "Interest rates only, sustained during 2026-2036", Outlays, $ billion.
T01_3_RATES_OUTLAYS = {2026: 44.1, 2027: 142.4, 2028: 206.0, 2029: 265.2, 2030: 318.1, 2031: 370.0, 2032: 417.4,
                       2033: 463.2, 2034: 505.8, 2035: 548.2, 2036: 590.6}
# HAND: Analytical Perspectives FY 2027, chapter 11 (ap_11_borrowing_fy2027.pdf), p. 124: "The average maturity of
# outstanding debt was 71 months at the end of 2025." Checked against the maturities in the MSPD.
AP11_AVERAGE_MATURITY_MONTHS = 71
# HAND: Treasury, Executive Summary to the FY 2025 Financial Report of the U.S. Government (March 2026), pp. 8-9:
# primary deficit 2.7 % of GDP in 2025, 3.3 % on average over the next ten years, a peak of 4.2 % in 2046 and 3.1 %
# in 2100; debt held by the public 99 % of GDP at the end of FY 2025 and 576 % in 2100.
FR = {"primary_2025": 2.7, "primary_10y": 3.3, "peak": 4.2, "peak_year": 2046, "primary_2100": 3.1, "debt_2100": 576}
# HAND: OMB, Mid-Session Review of the Budget for FY 2027 (MSR_2027.pdf), transmittal letter of September 4, 2026, and
# p. 1: it gives no new totals, only Tables S-1 and S-2; outlays for 2026 are projected lower than in the Budget,
# "partially offset by a reduction in receipts", which is "partly attributable to changes in expected collections from
# customs duties".
MSR_DATE = dt.date(2026, 9, 4)

# ---- sources (ids of countries/us/sources.json) ----------------------------------------------------------------
S_HIST = "omb_hist_fy2027"            # Tables 1.1, 2.1, 3.2, 10.1
S_HIST_DEBT = "omb_hist_debt_fy2027"  # Tables 3.1, 7.1
S_AP12 = "omb_ap_current_services_fy2027"
S_AP1 = "omb_ap_assumptions_fy2027"
S_AP11 = "omb_ap_borrowing_fy2027"
S_MSR = "omb_msr_fy2027"
S_MTS26 = "treasury_mts_2026_09"
S_MSPD25 = "treasury_mspd_2025_09"
S_MSPD26 = "treasury_mspd_2026_10"
S_YIELDS = "treasury_yield_curve"
S_FR = "treasury_fr_2025"
S_SEP = "fed_sep_2026_09"
S_CR = "plaw_119_103"
S_OBBBA = "plaw_119_21"
S_PLAWS = "govinfo_plaw_119"
S_SCOTUS = "scotus_24_1287"


def cache(rel):
    path = os.path.join(CACHE, rel)
    if not os.path.exists(path):
        sys.exit("missing %s: run pipeline/us/fetch_inputs.py first" % rel)
    return path


def num(text):
    text = str(text).strip().replace(",", "").lstrip("'")
    if text in ("", "null", "*", "-*") or set(text) <= {"."}:
        return 0.0
    return float(text)


def fail(message):
    sys.exit("debt.py: " + message)


# ---- OMB ------------------------------------------------------------------------------------------------------


def hist_by_year(name, sheet="Table"):
    """{year (int, estimates included): [values]} of a Historical Table laid out with one row per year."""
    out = {}
    for _, r in X(cache("omb/" + name)).rows(sheet):
        m = re.match(r"^(\d{4})( estimate)?$", r[0].strip()) if r else None
        if m:
            out[int(m.group(1))] = [num(v) for v in r[1:]]
    return out


def h31():
    """Table 3.1 (one column per year): {line: {year: $ million}} for the lines of the first block."""
    rows = list(X(cache("omb/hist03z1_fy2027.xlsx")).rows("Table"))
    years = [int(h[:4]) if h[:4].isdigit() else None for h in rows[1][1]]
    out = {}
    for _, r in rows[2:]:
        label = r[0].strip()
        if label.startswith("As percentages"):
            break
        out[label] = {years[i]: num(r[i]) for i in range(1, len(r)) if years[i] and r[i] not in ("", "..........")}
    return out


def h32_2025():
    """Table 3.2, FY 2025: {subfunction code: $ million} for function 900."""
    rows = list(X(cache("omb/hist03z2_fy2027.xlsx")).rows("Table"))
    col = rows[2][1].index(str(BASE))
    out = {}
    for _, r in rows:
        m = re.match(r"^(9\d\d) ", r[0].strip()) if r else None
        if m and len(r) > col and r[col].strip():
            out[m.group(1)] = num(r[col])
    return out


def t12_6():
    """Analytical Perspectives Table 12-6: {"net_interest" | "total": {year: $ billion}}, 2025-2036."""
    rows = list(X(cache("omb/ap_12_tables_fy2027.xlsx")).rows("12-6"))
    years = [2025] + [int(v) for v in rows[3][1][2:13]]
    out = {}
    for _, r in rows:
        label = r[0].strip(" .") if r else ""
        if label in ("Net Interest", "Total"):
            out["net_interest" if label == "Net Interest" else "total"] = {y: num(v) for y, v in zip(years, r[1:13])}
    if set(out) != {"net_interest", "total"}:
        fail("Table 12-6: rows Net Interest and Total not found")
    return out


def t11_2():
    """Analytical Perspectives Table 11-2: total other transactions affecting borrowing, {year: $ billion}."""
    for _, r in X(cache("omb/ap_11_tables_fy2027.xlsx")).rows("11-2"):
        if r and r[0].strip().startswith("Total, other transactions"):
            return {2025: num(r[1]), 2026: num(r[2]), 2027: num(r[3])}
    fail("Table 11-2: total not found")


# ---- Treasury --------------------------------------------------------------------------------------------------


def mts_rows(table, date):
    with open(cache("mts/mts_table_%s_%s.csv" % (table, date)), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def mts(table, date, column, desc=None, line=None):
    hits = [r for r in mts_rows(table, date)
            if (desc is None or r["classification_desc"].strip() == desc) and (line is None or r["line_code_nbr"] == line)]
    if len(hits) != 1:
        fail("MTS table %s %s: %d rows for %r %r" % (table, date, len(hits), desc, line))
    return num(hits[0][column])


def marketable_debt():
    """Marketable Treasury securities on September 30, 2025, one per CUSIP: (class, $ million, years from issue to
    maturity, years left to maturity)."""
    with open(cache("treasury/mspd_table_3_market_2025-09-30.csv"), encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    record = dt.date(2025, 9, 30)
    out, total = [], None
    for r in rows:
        if r["security_class1_desc"] == "Total Marketable":
            total = num(r["outstanding_amt"])
        if r["maturity_date"] in ("null", "") or r["outstanding_amt"] in ("null", ""):
            continue
        issue, maturity = dt.date.fromisoformat(r["issue_date"]), dt.date.fromisoformat(r["maturity_date"])
        out.append((r["security_class1_desc"], num(r["outstanding_amt"]), (maturity - issue).days / 365.25,
                    (maturity - record).days / 365.25, maturity))
    # Besides the securities, the total holds the Federal Financing Bank's debt and matured securities not yet redeemed.
    other = sum(num(r["outstanding_amt"]) for r in rows if r["security_class1_desc"] == "Federal Financing Bank"
                or r["security_class2_desc"].startswith("Total Matured"))
    if total is None or abs(sum(o for _, o, *_ in out) + other - total) > 1:
        fail("MSPD table 3: the securities do not add up to total marketable debt")
    return out


def maturity_profile(secs):
    total = sum(o for _, o, *_ in secs)
    one_year = dt.date(2026, 9, 30)
    within = sum(o for c, o, _, _, m in secs if m <= one_year)
    floating = sum(o for c, o, _, _, m in secs if c.startswith("Floating") and m > one_year)
    share = lambda prefix: sum(o for c, o, *_ in secs if c.startswith(prefix)) / total
    return {"total": total, "years": sum(o * left for _, o, _, left, _ in secs) / total,
            "within": within / total, "repriced": (within + floating) / total,
            "bills": share("Bills"), "tips": share("Inflation")}


def curve_days(year):
    """Treasury's daily par yield curve for a calendar year: [(date, {term in years: percent})]."""
    with open(cache("treasury/yield_curve_%d.csv" % year), encoding="utf-8") as f:
        rows = list(csv.reader(f))
    terms = []
    for h in rows[0][1:]:
        n, unit = h.replace('"', "").split(" ", 1)
        terms.append(float(n) / 12 if unit.lower().startswith("mo") else float(n))
    out = []
    for r in rows[1:]:
        points = {t: float(v) for t, v in zip(terms, r[1:]) if v.strip() not in ("", "N/A")}
        out.append((dt.datetime.strptime(r[0], "%m/%d/%Y").date(), points))
    return out


def at_term(points, term):
    """Linear in the term between the curve's points, flat beyond its ends."""
    keys = sorted(points)
    if term <= keys[0]:
        return points[keys[0]]
    if term >= keys[-1]:
        return points[keys[-1]]
    for a, b in zip(keys, keys[1:]):
        if a <= term <= b:
            return points[a] + (points[b] - points[a]) * (term - a) / (b - a)


def weighted_yield(points, secs):
    """The curve weighted by the debt: each security at the yield of its term at issue; floating-rate notes, which pay
    the 13-week bill rate, at the three-month yield; inflation-protected securities at the nominal yield of their term."""
    total = sum(o for _, o, *_ in secs)
    return sum(o * at_term(points, 0.25 if c.startswith("Floating") else term) for c, o, term, _, _ in secs) / total


def years_average(years, secs):
    """The weighted yield averaged over the days of each year, then over the years; and the same for ten-year notes."""
    weighted, ten = [], []
    for year in years:
        days = curve_days(year)
        weighted.append(sum(weighted_yield(p, secs) for _, p in days) / len(days))
        ten.append(sum(p[10.0] for _, p in days) / len(days))
    return sum(weighted) / len(weighted), sum(ten) / len(ten)


def debt_limit():
    """MSPD table 2 on October 31, 2026: (statutory limit, debt subject to limit, balance), $ million."""
    with open(cache("treasury/mspd_table_2_2026-10-31.csv"), encoding="utf-8") as f:
        rows = {r["debt_limit_class1_desc"]: r for r in csv.DictReader(f)}
    return (num(rows["Statutory Debt Limit"]["total_mil_amt"]), num(rows["Total Public Debt Subject to Limit"]["total_mil_amt"]),
            num(rows["Balance of Statutory Debt Limit"]["total_mil_amt"]))


# ---- Federal Reserve, laws ----------------------------------------------------------------------------------------


def fed_longer_run():
    """Median longer-run real GDP growth and PCE inflation, Summary of Economic Projections, Table 1."""
    text = open(cache("fed/fomcprojtabl20260916.htm"), encoding="utf-8").read()
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", "", text, flags=re.S))))
    table = text[text.index("Table 1. Economic projections"):]
    if "September 2026" not in table[:300]:
        fail("SEP: not the projections of September 2026")
    row = lambda label: [float(v) for v in re.search(label + r"((?: [\d.]+){5})", table).group(1).split()]
    return row("Change in real GDP")[4], row("PCE inflation")[4]


def continuing_resolution():
    """P.L. 119-103: approval date and the end date of the continuing resolution (division A, sec. 106(3))."""
    text = open(cache("govinfo/PLAW-119publ103.xml"), encoding="utf-8").read()
    end = re.search(r'identifier="/us/pl/119/103/dA/s106/3".*?<content>([^<]+)</content>', text, flags=re.S)
    title = re.search(r"<dc:title>([^<]+)", text).group(1)
    if not end or "continuing appropriations" not in title.lower() or "fiscal year 2027" not in title.lower():
        fail("P.L. 119-103: not the continuing resolution for FY 2027")
    approved = re.search(r"<approvedDate>([^<]+)", text).group(1)
    return dt.date.fromisoformat(approved), dt.datetime.strptime(end.group(1).strip(" ."), "%B %d, %Y").date()


def later_laws():
    """The public laws after P.L. 119-103 in govinfo's archive: the newest (number, date), and any whose title makes
    appropriations for fiscal year 2027 (there must be none for the note to hold)."""
    newest, found = None, []
    with zipfile.ZipFile(cache("govinfo/PLAW-119-public.zip")) as z:
        for name in z.namelist():
            m = re.match(r"PLAW-119publ(\d+)\.xml$", name)
            if not m or int(m.group(1)) <= 103:
                continue
            text = z.read(name).decode("utf-8", "replace")
            title = re.search(r"<dc:title>([^<]+)", text).group(1)
            date = dt.date.fromisoformat(re.search(r"<approvedDate>([^<]+)", text).group(1))
            if newest is None or int(m.group(1)) > newest[0]:
                newest = (int(m.group(1)), date)
            if re.search(r"appropriations", title, re.I) and re.search(r"fiscal year 2027", title, re.I):
                found.append(title)
    return newest, found


def debt_limit_law():
    """P.L. 119-21, sec. 72001: the amount by which it raised the limit of 31 U.S.C. 3101(b), dollars."""
    text = open(cache("govinfo/PLAW-119publ21.xml"), encoding="utf-8").read()
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text))
    m = re.search(r"SEC\. 72001\..{0,200}?The limitation under section 3101\(b\).{0,300}?is increased by \$([\d,]+)\.", text)
    if not m:
        fail("P.L. 119-21: sec. 72001 not found")
    return num(m.group(1))


# ---- the pack -----------------------------------------------------------------------------------------------------


def pack_json(name):
    return json.load(open(os.path.join(PACK, name), encoding="utf-8"))


def budget_node(node_id):
    budget = pack_json("budget.json")

    def find(nodes):
        for n in nodes:
            if n["id"] == node_id:
                return n
            hit = find(n.get("children", []))
            if hit:
                return hit

    def total(n):
        return sum(total(c) for c in n["children"]) if "children" in n else n["amount"]
    node = find(budget["revenue"] + budget["expenditure"])
    if node is None:
        fail("budget.json has no node %s" % node_id)
    return total(node)


# ---- writing numbers --------------------------------------------------------------------------------------------

MINUS = "−"


def group(text, sep):
    whole, _, frac = text.partition(".")
    neg = whole.startswith("-")
    whole = whole.lstrip("-")
    parts = []
    while len(whole) > 3:
        parts.insert(0, whole[-3:])
        whole = whole[:-3]
    parts.insert(0, whole)
    return (MINUS if neg else "") + sep.join(parts) + (("," if sep == "." else ".") + frac if frac else "")


def fixed(value, digits, lang):
    text = "%.*f" % (digits, value)
    if text.startswith("-") and float(text) == 0:
        text = text[1:]
    return group(text, "," if lang == "en" else ".")


def money(dollars, lang):
    """As the interface writes money: "$7.01T", "$970.1B", "$450M"; "7,01 Bio. Dollar", "970,1 Mrd. Dollar"."""
    a = abs(dollars)
    sign = MINUS if dollars < 0 else ""
    if a >= 1e12:
        n, unit = fixed(a / 1e12, 2, lang), ("T", "Bio.")
    elif a >= 1e9:
        n, unit = fixed(a / 1e9, 1, lang), ("B", "Mrd.")
    else:
        v = a / 1e6
        n, unit = fixed(v, 1 if v < 99.95 else 0, lang), ("M", "Mio.")
    return sign + ("$%s%s" % (n, unit[0]) if lang == "en" else "%s %s Dollar" % (n, unit[1]))


def pct(fraction, lang, digits=1):
    """A fraction as percent: "99.5%", "99,5 %"."""
    n = fixed(fraction * 100, digits, lang)
    return n + ("%" if lang == "en" else " %")


def pp(points, lang, digits=1):
    """A value already in percent: 4.8 -> "4.8%", "4,8 %"."""
    return pct(points / 100, lang, digits)


def date(d, lang):
    months_en = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
                 "November", "December"]
    months_de = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
                 "November", "Dezember"]
    return ("%s %d, %d" % (months_en[d.month - 1], d.day, d.year) if lang == "en"
            else "%d. %s %d" % (d.day, months_de[d.month - 1], d.year))


def fy(year, lang):
    return ("FY %d" if lang == "en" else "Haushaltsjahr %d") % year


def T(en, de):
    return {"en": en, "de": de}


# ---- the figures ----------------------------------------------------------------------------------------------------


def figures():
    f = {}
    country = pack_json("country.json")
    h1 = hist_by_year("hist01z1_fy2027.xlsx")          # receipts, outlays, deficit ($ million), to 2025
    h2 = hist_by_year("hist02z1_fy2027.xlsx")          # total receipts in column 8, to 2031
    h7 = hist_by_year("hist07z1_fy2027.xlsx")          # gross, government accounts, public, Fed ($ million)
    h10 = hist_by_year("hist10z1_fy2027.xlsx")         # GDP ($ billion), to 2031
    t31 = h31()
    ni31, def31, out31 = t31["Net interest"], t31["National Defense"], t31["Total, Federal outlays"]
    gdp = {y: v[0] * 1e9 for y, v in h10.items()}
    for y in range(2032, 2037):
        gdp[y] = T12_2_GDP[y] * 1e9
    f["gdp"] = gdp

    # Checks of what is read by hand, and of the pack.
    for y in range(2026, 2032):
        if abs(h2[y][7] / 1e3 - T12_4_RECEIPTS[y]) > 0.051:
            fail("Table 12-4 receipts %d (%s) differ from Historical Table 2.1 (%s)" % (y, T12_4_RECEIPTS[y], h2[y][7]))
    for y in range(2025, 2032):
        if round(h10[y][0]) != T12_2_GDP[y]:
            fail("Table 12-2 GDP %d differs from Historical Table 10.1" % y)
    if round(gdp[BASE]) != country["indicators"]["gdp"]["value"]:
        fail("country.json GDP is not Historical Table 10.1")
    if abs(ni31[BASE] * 1e6 - budget_node("exp.net_interest")) > 0.5:
        fail("net interest in Table 3.1 differs from budget.json exp.net_interest")
    t126 = t12_6()
    if abs(t126["net_interest"][BASE] * 1e3 - ni31[BASE]) > 1 or abs(t126["total"][BASE] * 1e3 - out31[BASE]) > 1:
        fail("Table 12-6 FY 2025 differs from Historical Table 3.1")

    # Stock and interest, FY 2025.
    f["dhp"] = {y: v[2] * 1e6 for y, v in h7.items()}
    f["gross"], f["gov_accounts"], f["fed_held"] = h7[BASE][0] * 1e6, h7[BASE][1] * 1e6, h7[BASE][3] * 1e6
    f["net_interest"] = {y: v * 1e6 for y, v in ni31.items()}
    f["defense"] = {y: v * 1e6 for y, v in def31.items()}
    sub = h32_2025()
    f["interest_gross"] = sub["901"] * 1e6
    f["interest_trust_funds"] = -(sub["902"] + sub["903"]) * 1e6
    f["interest_other_income"] = -(sub["908"] + sub["909"]) * 1e6
    if abs(f["interest_gross"] - f["interest_trust_funds"] - f["interest_other_income"] - f["net_interest"][BASE]) > 1e6:
        fail("the subfunctions of function 900 do not add up to net interest")
    f["fed_remittances"] = budget_node("rev.miscellaneous.federal_reserve")
    f["receipts"] = {y: v[0] * 1e6 for y, v in h1.items()}
    f["outlays"] = {y: v[1] * 1e6 for y, v in h1.items()}
    f["deficit"] = {y: -v[2] * 1e6 for y, v in h1.items()}
    f["dhp_face_2025"] = mts("6", "2025-09-30", "close_month_acct_bal_amt", line="9034")

    # Other means of financing: the growth of debt held by the public beyond the deficit.
    f["gap"] = {y: f["dhp"][y] - f["dhp"][y - 1] - f["deficit"][y] for y in (2023, 2024, 2025)}
    f["gap_ratio"] = {y: f["gap"][y] / gdp[y] for y in f["gap"]}
    other = t11_2()
    if abs(other[2025] * 1e9 - f["gap"][2025]) > 0.06e9:
        fail("Table 11-2 FY 2025 (%s) differs from Tables 7.1 and 1.1 (%s)" % (other[2025], f["gap"][2025] / 1e9))
    f["other_omb"] = {y: other[y] * 1e9 for y in (2026, 2027)}
    f["other_omb_ratio"] = {y: f["other_omb"][y] / gdp[y] for y in (2026, 2027)}

    # FY 2026 as it came out (Monthly Treasury Statement for September 2026).
    f["fy26_receipts"] = mts("9", "2026-09-30", "current_fytd_rcpt_outly_amt", line="120")
    f["fy26_outlays"] = mts("9", "2026-09-30", "current_fytd_rcpt_outly_amt", line="340")
    f["fy26_interest"] = mts("9", "2026-09-30", "current_fytd_rcpt_outly_amt", "Net Interest")
    f["fy26_deficit"] = mts("6", "2026-09-30", "fytd_net_txn_amt", line="9661")
    if abs(f["fy26_outlays"] - f["fy26_receipts"] - f["fy26_deficit"]) > 1e6:
        fail("MTS: receipts, outlays and deficit of FY 2026 do not fit")
    f["fy26_dhp"] = mts("6", "2026-09-30", "close_month_acct_bal_amt", line="9310")
    f["fy26_borrowing"] = mts("6", "2026-09-30", "fytd_net_txn_amt", line="9310")
    f["fy26_gap"] = f["fy26_borrowing"] - f["fy26_deficit"]
    f["fy26_customs"] = mts("4", "2026-09-30", "current_fytd_net_rcpt_amt", "Customs Duties")
    f["fy26_customs_refunds"] = mts("4", "2026-09-30", "current_fytd_refund_amt", "Customs Duties")
    f["fy26_primary"] = f["fy26_receipts"] - f["fy26_outlays"] + f["fy26_interest"]

    # The two paths of OMB. The President's Budget: Historical Tables 2.1, 3.1 and 10.1, to 2031.
    policy = {}
    for y in range(2026, 2032):
        policy[y] = {"receipts": h2[y][7] * 1e6, "outlays": out31[y] * 1e6, "interest": ni31[y] * 1e6}
    # The baseline: Tables 12-4 (receipts; 2026-2031 equal to Table 2.1) and 12-6, to 2036.
    baseline = {}
    for y in range(2026, 2037):
        receipts = h2[y][7] * 1e6 if y <= 2031 else T12_4_RECEIPTS[y] * 1e9
        baseline[y] = {"receipts": receipts, "outlays": t126["total"][y] * 1e9, "interest": t126["net_interest"][y] * 1e9}
    for path in (policy, baseline):
        for y, p in path.items():
            p["gdp"] = gdp[y]
            p["primary"] = p["receipts"] - p["outlays"] + p["interest"]
            p["deficit"] = p["outlays"] - p["receipts"]
    f["policy"], f["baseline"] = policy, baseline
    f["defense_above_baseline"] = {y: def31[y] * 1e6 - t12_6_defense(y) for y in (2027, 2031)}
    f["intl_above_baseline"] = {y: t31["International Affairs"][y] * 1e6 - t12_6_line("International Affairs", y)
                                for y in range(2027, 2032)}
    f["primary_2025"] = (f["receipts"][BASE] - f["outlays"][BASE] + f["net_interest"][BASE]) / gdp[BASE]
    f["real_growth_2026_2036"] = (T12_2_REAL_GDP[2036] / T12_2_REAL_GDP[2025]) ** (1 / 11) - 1
    f["real_growth_2032_2036"] = (T12_2_REAL_GDP[2036] / T12_2_REAL_GDP[2031]) ** (1 / 5) - 1
    f["nominal_growth_2032_2036"] = (T12_2_GDP[2036] / T12_2_GDP[2031]) ** (1 / 5) - 1

    # Marketable debt and the market rate.
    secs = marketable_debt()
    f["maturity"] = maturity_profile(secs)
    if round(f["maturity"]["years"] * 12) != AP11_AVERAGE_MATURITY_MONTHS:
        fail("MSPD: average maturity %.1f months, OMB says %d" % (f["maturity"]["years"] * 12, AP11_AVERAGE_MATURITY_MONTHS))
    days = curve_days(2026)
    f["curve_date"], f["curve"] = max(days)
    f["market_rate"] = weighted_yield(f["curve"], secs)
    f["omb_rate"] = weighted_yield({0.25: T12_2_BILL[2036], 10.0: T12_2_NOTE10[2036]}, secs)
    f["low_years"] = years_average(range(2012, 2022), secs)
    f["nineties"] = years_average(range(1991, 2001), secs)

    # Growth: the Federal Reserve's longer run.
    f["fed_real"], f["fed_pce"] = fed_longer_run()
    f["growth"] = ((1 + f["fed_real"] / 100) * (1 + f["fed_pce"] / 100) - 1) * 100

    # Refinancing: the share at which the engine's recursion reproduces OMB's sensitivity.
    f["refi_fit"] = fit_refinancing(f, policy, baseline)

    # The debt limit and the laws.
    f["limit"], f["subject"], f["headroom"] = (v * 1e6 for v in debt_limit())
    f["limit_raise"] = debt_limit_law()
    f["cr_approved"], f["cr_end"] = continuing_resolution()
    (f["newest_law"], f["newest_law_date"]), later = later_laws()
    if later:
        fail("a law after P.L. 119-103 makes appropriations for FY 2027: %s" % later)

    # History: FY 1946 (highest debt held by the public) and FY 1991 (highest interest burden before FY 2025).
    ratio = lambda series, y: series[y] / gdp[y]
    hist_years = [y for y in f["dhp"] if y <= BASE and y in gdp and y in f["receipts"] and y in f["net_interest"]]
    f["peak_debt_year"] = max(hist_years, key=lambda y: ratio(f["dhp"], y))
    before = [y for y in hist_years if y < BASE]
    f["peak_interest_year"] = max(before, key=lambda y: f["net_interest"][y] / f["receipts"][y])
    if f["peak_interest_year"] != max(before, key=lambda y: ratio(f["net_interest"], y)):
        fail("the highest interest share of receipts and of GDP before FY 2025 fall in different years")
    for share in (lambda y: f["net_interest"][y] / f["receipts"][y], lambda y: ratio(f["net_interest"], y)):
        if share(BASE) <= share(f["peak_interest_year"]):
            fail("FY 2025 is no longer above the earlier peak of the interest burden")
    f["above_defense"] = [y for y in hist_years if f["net_interest"][y] > f["defense"][y]]
    return f


def t12_6_line(label, year):
    rows = list(X(cache("omb/ap_12_tables_fy2027.xlsx")).rows("12-6"))
    years = [2025] + [int(v) for v in rows[3][1][2:13]]
    for _, r in rows:
        if r and r[0].strip(" .") == label:
            return num(r[1 + years.index(year)]) * 1e9
    fail("Table 12-6: no row %r" % label)


def t12_6_defense(year):
    return t12_6_line("Total, National Defense", year)


def fit_refinancing(f, policy, baseline):
    """The engine's interest recursion (src/engine/debt.ts) from the stock and net interest of FY 2025, on OMB's
    primary balances (the President's Budget to 2031, the baseline after it) at OMB's own rate, once as it is and once
    with all rates one point higher from January 1, 2026 (273 of the 365 days of FY 2026). The share is the one, in
    steps of 0.01, whose extra interest comes closest to OMB's Table 1-3 in FY 2027 to 2036 (least squared relative
    error)."""
    primary = {y: (policy[y] if y in policy else baseline[y])["primary"] for y in range(2026, 2037)}
    base = f["omb_rate"] / 100
    first = (dt.date(2026, 9, 30) - dt.date(2026, 1, 1)).days + 1
    shock = {y: 0.01 * (first / 365 if y == 2026 else 1) for y in primary}

    def run(share, extra):
        debt, rate, out = f["dhp"][BASE], f["net_interest"][BASE] / f["dhp"][BASE], {}
        for y in range(2026, 2037):
            market = base + extra.get(y, 0)
            paid = (1 - share) * rate + share * market
            due = paid * debt
            deficit = due - primary[y]
            if deficit > 0:
                rate = (due + market * deficit) / (debt + deficit)
            else:
                rate = paid
            debt = max(0.0, debt + deficit)
            out[y] = due
        return out

    rows = []
    for k in range(10, 41):
        share = k / 100
        a, b = run(share, {}), run(share, shock)
        diff = {y: (b[y] - a[y]) / 1e9 / T01_3_RATES_OUTLAYS[y] - 1 for y in primary}
        rows.append((sum(diff[y] ** 2 for y in range(2027, 2037)), share, diff))
    best = min(rows)
    return {"share": best[1], "errors": best[2], "table": {r[1]: r[2] for r in rows}}


# ---- debt.json --------------------------------------------------------------------------------------------------


def r4(x):
    return round(x, 4)


def build(f):
    gdp = f["gdp"]
    share = f["refi_fit"]["share"]
    errors = f["refi_fit"]["errors"]
    m = f["maturity"]
    market = round(f["market_rate"], 1)
    growth = round(f["growth"], 1)
    omb_rate = round(f["omb_rate"], 1)
    omb_growth = round(f["nominal_growth_2032_2036"] * 100, 1)
    low, low10 = f["low_years"]
    nineties, nineties10 = f["nineties"]
    drift_fr = round(-(FR["peak"] - FR["primary_2025"]) / (FR["peak_year"] - BASE), 2)
    pb = {"policy": f["policy"][2031]["primary"] / gdp[2031], "baseline": f["baseline"][2036]["primary"] / gdp[2036]}
    curve = f["curve"]
    terms = sorted(curve)
    bill_lo, bill_hi = curve[terms[0]], curve[1.0]
    fy26_gdp_share = f["fy26_primary"] / gdp[2026]
    one_over = 1 / m["years"]
    err27 = abs(errors[2027])
    err_later = max(abs(errors[y]) for y in range(2028, 2037))

    def L(fn):
        return T(fn("en"), fn("de"))

    stock = {
        "value": round(f["dhp"][BASE]),
        "quality": "official",
        "sources": [S_HIST_DEBT, "treasury_mts_2025_09", S_OBBBA, S_MSPD26],
        "note": L(lambda l: (
            "Debt held by the public at the end of FY 2025 (%s): %s or %s of GDP (OMB, Historical Table 7.1). It is the "
            "debt that deficits add to: Treasury securities held outside the federal government, the Federal Reserve's "
            "%s included, valued at their sale price plus the discount amortized since, the measure OMB uses with net "
            "interest. Not included are the %s held by the Social Security trust funds and other federal accounts, "
            "whose interest the government pays to itself; with them, gross federal debt was %s (%s of GDP). "
            "Treasury's statement at face value puts debt held by the public at %s. The debt limit applies to nearly "
            "all gross debt: the July 2025 law raised it by %s to %s, and at the end of October 2026 the debt subject "
            "to it was %s, %s below."
            % (date(dt.date(2025, 9, 30), l), money(f["dhp"][BASE], l), pct(f["dhp"][BASE] / gdp[BASE], l),
               money(f["fed_held"], l), money(f["gov_accounts"], l), money(f["gross"], l), pct(f["gross"] / gdp[BASE], l),
               money(f["dhp_face_2025"], l), money(f["limit_raise"], l), money(f["limit"], l), money(f["subject"], l),
               money(f["headroom"], l))
            if l == "en" else
            "Schulden des Bundes bei Dritten (debt held by the public) Ende des Haushaltsjahres 2025 (%s): %s oder %s "
            "des BIP (OMB, Historical Table 7.1). Zu diesen Schulden kommen die Defizite hinzu: Staatsanleihen in der "
            "Hand von Gläubigern außerhalb des Bundes, die %s der Federal Reserve eingeschlossen, bewertet zum "
            "Ausgabekurs zuzüglich des seither aufgelösten Abschlags, wie die OMB sie den Nettozinsen gegenüberstellt. "
            "Nicht enthalten sind die %s, die die Treuhandfonds der Social Security und andere Konten des Bundes halten; "
            "deren Zinsen zahlt der Bund sich selbst. Mit ihnen betrug die Bruttoschuld des Bundes %s (%s des BIP). "
            "Zum Nennwert weist das Finanzministerium die Schulden bei Dritten mit %s aus. Die Schuldenobergrenze gilt "
            "für fast die ganze Bruttoschuld: Das Gesetz vom Juli 2025 hob sie um %s auf %s an, und Ende Oktober 2026 "
            "lagen die ihr unterliegenden Schulden bei %s, %s darunter."
            % (date(dt.date(2025, 9, 30), l), money(f["dhp"][BASE], l), pct(f["dhp"][BASE] / gdp[BASE], l),
               money(f["fed_held"], l), money(f["gov_accounts"], l), money(f["gross"], l), pct(f["gross"] / gdp[BASE], l),
               money(f["dhp_face_2025"], l), money(f["limit_raise"], l), money(f["limit"], l), money(f["subject"], l),
               money(f["headroom"], l)))),
    }
    start_rate = f["net_interest"][BASE] / f["dhp"][BASE]
    interest = {
        "value": round(f["net_interest"][BASE]),
        "node": "exp.net_interest",
        "quality": "official",
        "sources": [S_HIST_DEBT, S_HIST],
        "note": L(lambda l: (
            "Net interest in FY 2025 (OMB function 900): %s or %s of GDP. It is the interest on Treasury securities "
            "(%s), less the %s credited to federal trust funds, which stays within the government, and less %s of other "
            "interest and investment income the government receives, mostly from its loan accounts. The projection "
            "starts from the budget item net interest, the same amount, so that the first year matches the budget "
            "exactly; over debt held by the public it gives a starting rate of %s. The Federal Reserve pays most of the "
            "interest it earns on Treasury securities back to the Treasury, which the budget counts as revenue (%s in "
            "FY 2025); in the projection that revenue keeps its share of GDP and does not follow rates."
            % (money(f["net_interest"][BASE], l), pct(f["net_interest"][BASE] / gdp[BASE], l, 2),
               money(f["interest_gross"], l), money(f["interest_trust_funds"], l), money(f["interest_other_income"], l),
               pct(start_rate, l, 2), money(f["fed_remittances"], l))
            if l == "en" else
            "Nettozinsen im Haushaltsjahr 2025 (Funktion 900 der OMB): %s oder %s des BIP. Das sind die Zinsen auf "
            "Staatsanleihen (%s), abzüglich der %s, die den Treuhandfonds des Bundes gutgeschrieben werden und innerhalb "
            "des Staates bleiben, und abzüglich %s übriger Zins- und Kapitalerträge des Bundes, vor allem aus seinen "
            "Kreditkonten. Die Projektion beginnt mit dem Haushaltsposten Nettozinsen, demselben Betrag, damit das erste "
            "Jahr genau zum Haushalt passt; bezogen auf die Schulden bei Dritten ergibt das einen Anfangszins von %s. "
            "Die Federal Reserve führt den größten Teil der Zinsen, die sie auf Staatsanleihen erhält, an das "
            "Finanzministerium ab; der Haushalt zählt das als Einnahme (%s im Haushaltsjahr 2025). In der Projektion "
            "behält diese Einnahme ihren Anteil am BIP und folgt den Zinsen nicht."
            % (money(f["net_interest"][BASE], l), pct(f["net_interest"][BASE] / gdp[BASE], l, 2),
               money(f["interest_gross"], l), money(f["interest_trust_funds"], l), money(f["interest_other_income"], l),
               pct(start_rate, l, 2), money(f["fed_remittances"], l)))),
    }
    refinancing = {
        "share": share,
        "averageMaturity": round(m["years"], 2),
        "quality": "derived",
        "sources": [S_AP1, S_MSPD25, S_AP11],
        "note": L(lambda l: (
            "A share fitted to OMB's estimates, not one divided by the average time to maturity (%s years at the end of "
            "FY 2025, which would give %s): %s of marketable debt took a new rate within the following year, mostly "
            "bills, which roll over several times a year, while the rest keeps its rate for years. At %s, run on OMB's own path and rates, this "
            "calculation reproduces OMB's estimate of how much more interest the government would pay if all rates "
            "stayed one point higher from 2026, to within %s in FY 2027 and %s from FY 2028 to FY 2036 (Analytical "
            "Perspectives, Table 1-3). Maturities: Treasury, Monthly Statement of the Public Debt, %s."
            % (fixed(m["years"], 2, l), pct(one_over, l), pct(m["repriced"], l), pct(share, l, 0), pct(err27, l, 0),
               pct(err_later, l, 0), date(dt.date(2025, 9, 30), l))
            if l == "en" else
            "Ein an die Schätzungen der OMB angepasster Anteil, nicht eins geteilt durch die durchschnittliche Restlaufzeit "
            "(Ende des Haushaltsjahres 2025 %s Jahre, das ergäbe %s): %s der handelbaren Schulden bekamen im folgenden "
            "Jahr einen neuen Zins, vor allem kurzfristige Schatzwechsel, die mehrmals im Jahr erneuert werden, während der Rest seinen Zins "
            "über Jahre behält. Mit %s gibt diese Rechnung, auf dem Pfad und mit den Zinsen der OMB, deren Schätzung "
            "wieder, wie viel mehr Zinsen der Bund zahlen würde, wenn alle Zinsen ab 2026 dauerhaft einen Prozentpunkt "
            "höher lägen: auf %s genau im Haushaltsjahr 2027 und auf %s genau in den Haushaltsjahren 2028 bis 2036 "
            "(Analytical Perspectives, Tabelle 1-3). Laufzeiten: Finanzministerium, Monatsausweis der Staatsschuld "
            "zum %s."
            % (fixed(m["years"], 2, l), pct(one_over, l), pct(m["repriced"], l), pct(share, l, 0), pct(err27, l, 0),
               pct(err_later, l, 0), date(dt.date(2025, 9, 30), l)))),
    }

    curve_day = f["curve_date"]
    assumptions = [
        {"id": "market_rate", "type": "number", "label": T("Interest rate on new debt", "Zins für neue Schulden"),
         "unit": "percent", "min": -1, "max": 10, "step": 0.1, "default": market,
         "note": L(lambda l: (
             "Default: Treasury's par yields on %s, weighted by how the marketable debt outstanding at the end of FY "
             "2025 was spread over terms at issue: %s. Bills, %s of that debt, yielded %s to %s (one month to one "
             "year), ten-year notes %s, thirty-year bonds %s; floating-rate notes count at the three-month yield, "
             "inflation-protected securities at the nominal yield of their term. All new and refinanced debt pays this "
             "one rate, which does not react to the level of debt. OMB's paths assume %s on 91-day bills and %s on "
             "ten-year notes from %d."
             % (date(curve_day, l), pp(f["market_rate"], l), pct(m["bills"], l, 0), pp(bill_lo, l, 2), pp(bill_hi, l, 2),
                pp(curve[10.0], l, 2), pp(curve[30.0], l, 2), pp(T12_2_BILL[2030], l), pp(AP1_NOTE10_TERMINAL[1], l),
                AP1_NOTE10_TERMINAL[0])
             if l == "en" else
             "Vorgabe: Renditen von US-Staatsanleihen am %s (Par Yield Curve des Finanzministeriums), gewichtet danach, "
             "wie sich die handelbaren Schulden Ende des Haushaltsjahres 2025 auf die ursprünglichen Laufzeiten "
             "verteilten: %s. Kurzfristige Schatzwechsel, %s dieser Schulden, rentierten mit %s bis %s (ein Monat bis "
             "ein Jahr), zehnjährige Anleihen mit %s, dreißigjährige mit %s; variabel verzinsliche Anleihen zählen mit "
             "dem Dreimonatszins, inflationsgeschützte mit dem nominalen Zins ihrer Laufzeit. Für alle neuen und "
             "umgeschuldeten Kredite gilt dieser eine Zins; er reagiert nicht auf die Höhe der Schulden. Die Pfade der "
             "OMB rechnen mit %s für Schatzwechsel mit 91 Tagen Laufzeit und %s für zehnjährige Anleihen ab %d."
             % (date(curve_day, l), pp(f["market_rate"], l), pct(m["bills"], l, 0), pp(bill_lo, l, 2), pp(bill_hi, l, 2),
                pp(curve[10.0], l, 2), pp(curve[30.0], l, 2), pp(T12_2_BILL[2030], l), pp(AP1_NOTE10_TERMINAL[1], l),
                AP1_NOTE10_TERMINAL[0]))),
         "sources": [S_YIELDS, S_MSPD25, S_AP12]},
        {"id": "growth", "type": "number", "label": T("Nominal economic growth per year", "Nominales Wirtschaftswachstum pro Jahr"),
         "unit": "percent", "min": -2, "max": 8, "step": 0.1, "default": growth,
         "note": L(lambda l: (
             "Default %s: real growth in the longer run of %s a year, the median of the Federal Reserve's policymakers "
             "in September 2026, plus inflation at the Federal Reserve's target of %s. The economic assumptions of "
             "OMB's paths, which OMB developed on the assumption that the President's proposals are enacted, expect "
             "%s a year by fiscal year from 2032 to 2036, on real growth of %s. When the calculation follows one of "
             "OMB's paths, the path's growth applies up to its last year and this value only after that."
             % (pp(growth, l), pp(f["fed_real"], l), pp(f["fed_pce"], l, 0), pct(f["nominal_growth_2032_2036"], l),
                pct(f["real_growth_2032_2036"], l))
             if l == "en" else
             "Vorgabe %s: langfristiges reales Wachstum von %s im Jahr, der Median der geldpolitischen Entscheider der "
             "Federal Reserve vom September 2026, plus Inflation in Höhe ihres Ziels von %s. Die Wirtschaftsannahmen "
             "der Pfade der OMB, die die OMB unter der Annahme entwickelt hat, dass die Vorschläge des Präsidenten "
             "Gesetz werden, rechnen in den Haushaltsjahren 2032 bis 2036 mit %s im Jahr bei realem Wachstum von %s. "
             "Folgt die Rechnung einem Pfad der OMB, gilt bis zu dessen letztem Jahr dessen Wachstum und dieser Wert "
             "erst danach."
             % (pp(growth, l), pp(f["fed_real"], l), pp(f["fed_pce"], l, 0), pct(f["nominal_growth_2032_2036"], l),
                pct(f["real_growth_2032_2036"], l)))),
         "sources": [S_SEP, S_AP12]},
        {"id": "horizon", "type": "number", "label": T("Years ahead", "Zeitraum"), "unit": "years", "min": 1, "max": 50,
         "step": 1, "default": 30,
         "note": T("How many fiscal years after FY 2025 are calculated.",
                   "Wie viele Haushaltsjahre nach dem Haushaltsjahr 2025 berechnet werden.")},
        {"id": "drift", "type": "number",
         "label": T("Yearly change in the budget before interest", "Jährliche Veränderung des Haushalts ohne Zinsen"),
         "unit": "percent_gdp", "min": -0.5, "max": 0.5, "step": 0.01, "default": 0,
         "note": L(lambda l: (
             "The primary balance is the budget balance before interest. At 0 it keeps its share of GDP: that of FY "
             "2025, %s, or, when the calculation follows one of OMB's paths, that of the path's last year (%s in FY "
             "2031 on the President's Budget, %s in FY 2036 on the baseline); then the change counts only after that "
             "year. A negative value stands for costs that grow faster than the economy, such as Social Security and "
             "Medicare as the population ages: %s0.1 means the primary balance worsens by 0.1%% of GDP every year, by 3%% "
             "after 30 years. Treasury's long-term projection under current policy corresponds to about %s until %d."
             % (pct(f["primary_2025"], l, 2), pct(pb["policy"], l, 2), pct(pb["baseline"], l, 2), MINUS,
                fixed(drift_fr, 2, l), FR["peak_year"])
             if l == "en" else
             "Der Primärsaldo ist der Haushaltssaldo ohne Zinsen. Bei 0 behält er seinen Anteil am BIP: den des "
             "Haushaltsjahres 2025, %s, oder, wenn die Rechnung einem Pfad der OMB folgt, den im letzten Jahr des Pfades "
             "(%s im Haushaltsjahr 2031 beim Haushaltsentwurf des Präsidenten, %s im Haushaltsjahr 2036 bei der "
             "Fortschreibung); die Veränderung zählt dann erst nach diesem Jahr. Ein negativer Wert steht für Kosten, die "
             "schneller wachsen als die Wirtschaft, etwa Social Security und Medicare in einer alternden Gesellschaft: "
             "%s0,1 heißt, der Primärsaldo verschlechtert sich jedes Jahr um 0,1 %% des BIP, nach 30 Jahren um 3 %%. Der "
             "Langfristprojektion des Finanzministeriums nach geltender Politik entsprechen bis %d etwa %s."
             % (pct(f["primary_2025"], l, 2), pct(pb["policy"], l, 2), pct(pb["baseline"], l, 2), MINUS,
                FR["peak_year"], fixed(drift_fr, 2, l)))),
         "sources": [S_FR]},
    ]

    presets = [
        {"id": "omb_economics", "label": T("OMB's economic assumptions", "Wirtschaftsannahmen der OMB"),
         "values": {"market_rate": omb_rate, "growth": omb_growth},
         "note": L(lambda l: (
             "The economics of the Budget for FY 2027 from 2032 on: %s on 91-day bills and %s on ten-year notes, %s "
             "when weighted like the debt; nominal growth of %s a year by fiscal year, on real growth of %s. OMB "
             "developed them on the assumption that the President's proposals are enacted. Only rate and growth change."
             % (pp(T12_2_BILL[2036], l), pp(T12_2_NOTE10[2036], l), pp(f["omb_rate"], l), pct(f["nominal_growth_2032_2036"], l),
                pct(f["real_growth_2032_2036"], l))
             if l == "en" else
             "Die Wirtschaftsannahmen des Haushaltsentwurfs für 2027 ab 2032: %s für Schatzwechsel mit 91 Tagen Laufzeit "
             "und %s für zehnjährige Anleihen, gewichtet wie die Schulden %s; nominales Wachstum von %s im Jahr bei "
             "realem Wachstum von %s. Die OMB hat sie unter der Annahme entwickelt, dass die Vorschläge des Präsidenten "
             "Gesetz werden. Nur Zins und Wachstum ändern sich."
             % (pp(T12_2_BILL[2036], l), pp(T12_2_NOTE10[2036], l), pp(f["omb_rate"], l), pct(f["nominal_growth_2032_2036"], l),
                pct(f["real_growth_2032_2036"], l)))),
         "sources": [S_AP12, S_MSPD25]},
        {"id": "low_rates_2012_2021", "label": T("The low-rate years", "Die Niedrigzinsjahre"),
         "values": {"market_rate": round(low, 1)},
         "note": L(lambda l: (
             "From 2012 to 2021 Treasury yields, weighted like the debt, averaged %s; ten-year notes yielded %s."
             % (pp(low, l), pp(low10, l))
             if l == "en" else
             "Von 2012 bis 2021 rentierten US-Staatsanleihen, gewichtet wie die Schulden, im Mittel mit %s, "
             "zehnjährige Anleihen mit %s." % (pp(low, l), pp(low10, l)))),
         "sources": [S_YIELDS]},
        {"id": "nineties", "label": T("Rates as in the 1990s", "Zinsen wie in den 1990er-Jahren"),
         "values": {"market_rate": round(nineties, 1)},
         "note": L(lambda l: (
             "From 1991 to 2000 Treasury yields, weighted like the debt, averaged %s; ten-year notes yielded %s. In FY "
             "%d net interest took %s of federal revenue, the highest share before FY 2025."
             % (pp(nineties, l), pp(nineties10, l), f["peak_interest_year"],
                pct(f["net_interest"][f["peak_interest_year"]] / f["receipts"][f["peak_interest_year"]], l))
             if l == "en" else
             "Von 1991 bis 2000 rentierten US-Staatsanleihen, gewichtet wie die Schulden, im Mittel mit %s, zehnjährige "
             "Anleihen mit %s. Im Haushaltsjahr %d gingen %s der Einnahmen des Bundes an Nettozinsen, der höchste Anteil "
             "vor dem Haushaltsjahr 2025."
             % (pp(nineties, l), pp(nineties10, l), f["peak_interest_year"],
                pct(f["net_interest"][f["peak_interest_year"]] / f["receipts"][f["peak_interest_year"]], l)))),
         "sources": [S_YIELDS, S_HIST_DEBT]},
        {"id": "treasury_long_term", "label": T("Rising costs as in Treasury's long-term projection",
                                                "Steigende Kosten wie in der Langfristprojektion des Finanzministeriums"),
         "values": {"drift": drift_fr},
         "note": L(lambda l: (
             "Treasury's projection under current policy (Financial Report for FY 2025): the primary deficit, %s of GDP "
             "in 2025, averages %s over the next ten years and peaks at %s in %d, about %s points of GDP worse each "
             "year; it then falls back to %s in 2100, when debt held by the public reaches %s of GDP. Only the yearly "
             "change is set here; rate and growth stay as chosen."
             % (pp(FR["primary_2025"], l), pp(FR["primary_10y"], l), pp(FR["peak"], l), FR["peak_year"],
                fixed(-drift_fr, 2, l), pp(FR["primary_2100"], l), pp(FR["debt_2100"], l, 0))
             if l == "en" else
             "Projektion des Finanzministeriums nach geltender Politik (Finanzbericht für das Haushaltsjahr 2025): Das "
             "Primärdefizit, 2025 %s des BIP, beträgt in den nächsten zehn Jahren im Mittel %s und erreicht %d mit %s "
             "seinen Höchststand, jedes Jahr um etwa %s Punkte des BIP mehr; danach sinkt es bis 2100 auf %s, wenn die "
             "Schulden bei Dritten %s des BIP erreichen. Gesetzt wird hier nur die jährliche Veränderung; Zins und "
             "Wachstum bleiben, wie gewählt."
             % (pp(FR["primary_2025"], l), pp(FR["primary_10y"], l), FR["peak_year"], pp(FR["peak"], l),
                fixed(-drift_fr, 2, l), pp(FR["primary_2100"], l), pp(FR["debt_2100"], l, 0)))),
         "sources": [S_FR]},
    ]

    def history(year, kind_en, kind_de, note_en, note_de):
        return {"id": "fy%d" % year, "label": T("FY %d: %s" % (year, kind_en), "Haushaltsjahr %d: %s" % (year, kind_de)),
                "kind": "history", "year": year,
                "debtRatio": r4(f["dhp"][year] / gdp[year]), "interestRatio": r4(f["net_interest"][year] / gdp[year]),
                "revenueRatio": r4(f["receipts"][year] / gdp[year]),
                "sources": [S_HIST_DEBT, S_HIST], "note": T(note_en, note_de)}

    py, iy = f["peak_debt_year"], f["peak_interest_year"]
    references = [
        history(py, "highest debt", "höchste Schulden",
                "After the Second World War. Debt held by the public, net interest and receipts as OMB counts them today "
                "(Historical Tables 1.1, 3.1, 7.1 and 10.1).",
                "Nach dem Zweiten Weltkrieg. Schulden bei Dritten, Nettozinsen und Einnahmen, wie die OMB sie heute "
                "rechnet (Historical Tables 1.1, 3.1, 7.1 und 10.1)."),
        history(iy, "highest interest burden before 2025", "höchste Zinslast vor 2025",
                "Net interest as a share of revenue and of GDP was higher in no year before FY 2025.",
                "Nettozinsen gemessen an den Einnahmen und am BIP waren in keinem Jahr vor dem Haushaltsjahr 2025 höher."),
    ]

    comparisons = [{"node": node, "label": T(en, de)} for node, en, de in COMPARISONS]

    def points(path, years):
        out, prev = [], gdp[years[0] - 1]
        for y in years:
            p = path[y]
            out.append({"year": y, "balanceRatio": r4((p["receipts"] - p["outlays"]) / p["gdp"]),
                        "interestRatio": r4(p["interest"] / p["gdp"]), "interestToRevenue": r4(p["interest"] / p["receipts"]),
                        "growth": r4(p["gdp"] / prev - 1)})
            prev = p["gdp"]
        return out

    bl, po = f["baseline"], f["policy"]
    customs = lambda y, l: money(T12_4_CUSTOMS[y] * 1e9, l)
    fy26 = lambda l, path: (
        "FY 2026 came out differently: OMB estimated a deficit of %s and net interest of %s; Treasury's final statement "
        "for the year shows a deficit of %s and net interest of %s. OMB's Mid-Session Review of %s gives no new totals; "
        "it expected lower outlays for FY 2026, partly offset by lower receipts from customs duties."
        % (money(path[2026]["deficit"], l), money(path[2026]["interest"], l), money(f["fy26_deficit"], l),
           money(f["fy26_interest"], l), date(MSR_DATE, l))
        if l == "en" else
        "Das Haushaltsjahr 2026 ist anders ausgefallen: Die OMB schätzte ein Defizit von %s und Nettozinsen von %s; der "
        "letzte Monatsausweis des Finanzministeriums für das Jahr zeigt ein Defizit von %s und Nettozinsen von %s. Die "
        "Halbjahresüberprüfung der OMB (Mid-Session Review) vom %s nennt keine neuen Summen; sie erwartete für 2026 "
        "geringere Ausgaben, teils ausgeglichen durch geringere Einnahmen aus Zöllen."
        % (money(path[2026]["deficit"], l), money(path[2026]["interest"], l), money(f["fy26_deficit"], l),
           money(f["fy26_interest"], l), date(MSR_DATE, l)))
    plans = [
        {"id": "omb_baseline_fy2027",
         "label": T("OMB baseline under current law (Budget FY 2027)",
                    "Fortschreibung der OMB nach geltendem Recht (Haushaltsentwurf 2027)"),
         "scope": "all", "accounts": "budget", "points": points(bl, list(range(2026, 2037))), "quality": "official",
         "sources": [S_AP12, S_AP1, S_HIST, S_MTS26, S_MSR, S_SCOTUS],
         "note": L(lambda l: "\n\n".join([
             ("OMB's current-services baseline from the Budget for FY 2027 (April 2026): receipts, outlays and net "
              "interest for FY 2026 to FY 2036 under the laws in force when it was made, with discretionary spending at "
              "its 2026 level plus inflation (Analytical Perspectives, Tables 12-4 and 12-6), and GDP by fiscal year "
              "(Table 12-2). OMB projects no debt. Followed, the calculation takes each year's balance before interest "
              "and computes interest and debt itself, at the rates chosen here; after FY 2036 it holds that year's "
              "primary balance, %s of GDP." % pct(pb["baseline"], l, 2)
              if l == "en" else
              "Die Fortschreibung der OMB zum Haushaltsentwurf für 2027 (April 2026): Einnahmen, Ausgaben und "
              "Nettozinsen der Haushaltsjahre 2026 bis 2036 nach den Gesetzen, die bei ihrer Erstellung galten, die "
              "jährlich bewilligten Ausgaben auf dem Stand von 2026 zuzüglich Inflation (Analytical Perspectives, "
              "Tabellen 12-4 und 12-6), und das BIP nach Haushaltsjahren (Tabelle 12-2). Schulden projiziert die OMB "
              "nicht. Folgt ihr die Rechnung, übernimmt sie in jedem Jahr den Saldo ohne Zinsen und berechnet Zinsen "
              "und Schulden selbst, mit den hier gewählten Zinsen; nach dem Haushaltsjahr 2036 hält sie dessen "
              "Primärsaldo von %s des BIP." % pct(pb["baseline"], l, 2)),
             ("Its economics are those of the President's Budget, which OMB developed on the assumption that the "
              "President's proposals are enacted: real growth of %s a year on average to FY 2036, %s on 91-day bills "
              "and %s on ten-year notes from %d. Its receipts include customs duties of %s in FY 2026, rising to %s in "
              "FY 2036, after %s in FY 2025."
              % (pct(f["real_growth_2026_2036"], l), pp(T12_2_BILL[2030], l), pp(AP1_NOTE10_TERMINAL[1], l),
                 AP1_NOTE10_TERMINAL[0], customs(2026, l), customs(2036, l), customs(2025, l))
              if l == "en" else
              "Ihre Wirtschaftsannahmen sind die des Haushaltsentwurfs, die die OMB unter der Annahme entwickelt hat, "
              "dass die Vorschläge des Präsidenten Gesetz werden: reales Wachstum von %s im Jahr bis zum Haushaltsjahr "
              "2036, %s für Schatzwechsel mit 91 Tagen Laufzeit und %s für zehnjährige Anleihen ab %d. Ihre Einnahmen "
              "enthalten Zölle von %s im Haushaltsjahr 2026, steigend auf %s im Haushaltsjahr 2036, nach %s im "
              "Haushaltsjahr 2025."
              % (pct(f["real_growth_2026_2036"], l), pp(T12_2_BILL[2030], l), pp(AP1_NOTE10_TERMINAL[1], l),
                 AP1_NOTE10_TERMINAL[0], customs(2026, l), customs(2036, l), customs(2025, l))),
             fy26(l, bl) + (
                 " Customs duties came to %s, after %s was refunded to importers following the Supreme Court's ruling "
                 "of February 2026 on the emergency tariffs." % (money(f["fy26_customs"], l), money(f["fy26_customs_refunds"], l))
                 if l == "en" else
                 " Die Zölle brachten %s, nachdem %s an Importeure erstattet wurden, weil der Supreme Court die "
                 "Notstandszölle im Februar 2026 für rechtswidrig erklärt hatte."
                 % (money(f["fy26_customs"], l), money(f["fy26_customs_refunds"], l))),
             ("The baseline is current law of early 2026, not the FY 2025 budget that the measures here change. Some "
              "of them are already in it: the end of the enhanced ACA premium tax credits, the states' share of SNAP "
              "from FY 2028, the money of the July 2025 law for border and immigration enforcement, and tariffs well "
              "above those of FY 2025. Following the baseline and switching on one of these counts it twice."
              if l == "en" else
              "Die Fortschreibung bildet das geltende Recht von Anfang 2026 ab, nicht den Haushalt 2025, den die "
              "Maßnahmen hier verändern. Manche von ihnen sind schon enthalten: das Ende der erhöhten Prämienzuschüsse "
              "nach dem ACA, der Anteil der Bundesstaaten an SNAP ab dem Haushaltsjahr 2028, das Geld des Gesetzes vom "
              "Juli 2025 für Grenzschutz und Einwanderungsbehörden und Zölle weit über denen des Haushaltsjahres 2025. "
              "Wer der Fortschreibung folgt und eine dieser Maßnahmen einschaltet, zählt sie doppelt."),
         ]))},
        {"id": "omb_budget_fy2027",
         "label": T("President's Budget FY 2027", "Haushaltsentwurf des Präsidenten für 2027"),
         "scope": "all", "accounts": "budget", "points": points(po, list(range(2026, 2032))), "quality": "official",
         "sources": [S_HIST, S_HIST_DEBT, S_AP12, S_MTS26, S_MSR],
         "note": L(lambda l: "\n\n".join([
             ("OMB's estimates for the President's Budget for FY 2027 (April 2026), which assume that the President's "
              "proposals are enacted: receipts (Historical Table 2.1), outlays and net interest (Table 3.1) and GDP "
              "(Table 10.1) for FY 2026 to FY 2031. OMB projects no debt. Followed, the calculation takes each year's "
              "balance before interest and computes interest and debt itself, at the rates chosen here; after FY 2031 "
              "it holds that year's primary balance, %s of GDP." % pct(pb["policy"], l, 2)
              if l == "en" else
              "Die Schätzungen der OMB zum Haushaltsentwurf des Präsidenten für 2027 (April 2026), die annehmen, dass "
              "die Vorschläge des Präsidenten Gesetz werden: Einnahmen (Historical Table 2.1), Ausgaben und Nettozinsen "
              "(Tabelle 3.1) und BIP (Tabelle 10.1) der Haushaltsjahre 2026 bis 2031. Schulden projiziert die OMB "
              "nicht. Folgt ihm die Rechnung, übernimmt sie in jedem Jahr den Saldo ohne Zinsen und berechnet Zinsen "
              "und Schulden selbst, mit den hier gewählten Zinsen; nach dem Haushaltsjahr 2031 hält sie dessen "
              "Primärsaldo von %s des BIP." % pct(pb["policy"], l, 2)),
             ("Receipts and economics are those of OMB's baseline. The proposals raise national defense above the "
              "baseline by %s in FY 2027 and %s in FY 2031, to %s and %s, and lower most other spending, international "
              "affairs by %s to %s a year."
              % (money(f["defense_above_baseline"][2027], l), money(f["defense_above_baseline"][2031], l),
                 money(f["defense"][2027], l), money(f["defense"][2031], l),
                 money(-max(f["intl_above_baseline"].values()), l), money(-min(f["intl_above_baseline"].values()), l))
              if l == "en" else
              "Einnahmen und Wirtschaftsannahmen sind die der Fortschreibung. Die Vorschläge heben die Verteidigung "
              "gegenüber der Fortschreibung um %s im Haushaltsjahr 2027 und %s im Haushaltsjahr 2031 an, auf %s und %s, "
              "und senken die meisten übrigen Ausgaben, die für internationale Angelegenheiten um %s bis %s im Jahr."
              % (money(f["defense_above_baseline"][2027], l), money(f["defense_above_baseline"][2031], l),
                 money(f["defense"][2027], l), money(f["defense"][2031], l),
                 money(-max(f["intl_above_baseline"].values()), l), money(-min(f["intl_above_baseline"].values()), l))),
             fy26(l, po),
             ("This path contains the President's proposals as well as current law. Following it and switching on the "
              "measures for defense, foreign aid, the federal workforce, border and immigration enforcement, the ACA "
              "credits, SNAP or the tariff counts them twice, in part or in full."
              if l == "en" else
              "Dieser Pfad enthält die Vorschläge des Präsidenten und das geltende Recht. Wer ihm folgt und die "
              "Maßnahmen zu Verteidigung, Auslandshilfe, Bundespersonal, Grenzschutz und Einwanderungsbehörden, den "
              "ACA-Zuschüssen, SNAP oder dem Zoll einschaltet, zählt sie ganz oder teilweise doppelt."),
         ]))},
    ]

    newest = f["newest_law"]
    measures_from = {
        "year": MEASURES_FROM,
        "note": L(lambda l: (
            "Measures act in the projection from FY 2028 at the earliest, the first fiscal year that has not begun: FY "
            "2026 is over, and FY 2027 began on %s. Until %s it runs on a continuing resolution that carries on the "
            "funding of the year before (P.L. 119-103 of %s); no later law provides its funding (govinfo, laws through "
            "P.L. 119-%d of %s). This is an assumption of the calculation: a law could still change part of FY 2027, "
            "and many measures would take longer to be decided and to take effect. Where a law or a bill sets a later "
            "start, or a source shows a slow build-up, the measure says so itself."
            % (date(dt.date(2026, 10, 1), l), date(f["cr_end"], l), date(f["cr_approved"], l), newest,
               date(f["newest_law_date"], l))
            if l == "en" else
            "Maßnahmen wirken in der Projektion frühestens im Haushaltsjahr 2028, dem ersten, das noch nicht begonnen "
            "hat: Das Haushaltsjahr 2026 ist vorbei, und das Haushaltsjahr 2027 hat am %s begonnen. Bis zum %s gilt "
            "dafür ein Übergangshaushalt (continuing resolution), der die Mittel des Vorjahres fortschreibt (P.L. 119-103 vom %s); ein späteres "
            "Gesetz, das das Jahr finanziert, gibt es nicht (govinfo, Gesetze bis P.L. 119-%d vom %s). Das ist eine "
            "Annahme der Rechnung: Ein Gesetz könnte noch einen Teil des Haushaltsjahres 2027 ändern, und viele "
            "Maßnahmen bräuchten länger, bis sie beschlossen sind und wirken. Wo ein Gesetz oder Entwurf einen "
            "späteren Beginn festlegt oder eine Quelle einen langsamen Aufbau belegt, sagt die Maßnahme das selbst."
            % (date(dt.date(2026, 10, 1), l), date(f["cr_end"], l), date(f["cr_approved"], l), newest,
               date(f["newest_law_date"], l)))),
        "sources": [S_CR, S_PLAWS],
    }

    gap_lo, gap_hi = min(f["gap_ratio"].values()), max(f["gap_ratio"].values())
    note = L(lambda l: (
        "The starting point is the budget of FY 2025, continued: revenue and spending other than interest keep their "
        "share of GDP of FY 2025, a deficit before interest of %s of GDP, and the chosen assumptions hold every year. "
        "The measures change this budget, so on this path none of them is counted twice. OMB's two paths, its baseline "
        "under current law and the President's Budget, can be chosen instead. They are not the default because they "
        "rest on economic assumptions that OMB developed on the assumption that the President's proposals are enacted, "
        "with real growth of %s a year to FY 2036, and on customs duties of %s for FY 2026, of which %s was collected after "
        "refunds; on them the deficit before interest shrinks to %s of GDP by FY 2036. In FY 2026 it came to %s of GDP "
        "(on OMB's estimate of GDP), and Treasury's long-term projection under current policy puts it at %s on average over the next "
        "ten years. What the calculation leaves out: debt held by the public grows here by the deficit alone. In fact it "
        "also grows with the government's loans, above all student loans, and with its cash balance: by %s to %s of "
        "GDP a year more than the deficit in FY 2023 to 2025, and by %s in FY 2026; OMB had expected %s for FY 2026 "
        "and expects %s for FY 2027. Interest follows the rates chosen here, on OMB's paths too, not OMB's rates. All new debt costs "
        "one market rate; inflation-protected securities, %s of marketable debt, are treated like the rest, although "
        "their principal grows with consumer prices. The debt limit is not modeled; at the end of October 2026 the "
        "debt subject to it was %s below the limit of %s. FY 2026 is over, but the "
        "calculation computes it like any later year; Treasury's final statement shows a deficit of %s, net interest "
        "of %s and debt held by the public of %s at its end. Feedback is left out: higher debt does not push up rates, "
        "and measures do not change growth. Each measure acts in full and for good from FY 2028 unless its card says "
        "it starts later; expiry dates and the reactions of people and firms are missing. Costs that grow faster than "
        "the economy, such as Social Security and Medicare as the population ages, enter only through the yearly "
        "change in the budget before interest."
        % (pct(-f["primary_2025"], l, 2), pct(f["real_growth_2026_2036"], l), customs(2026, l), money(f["fy26_customs"], l),
           pct(-pb["baseline"], l, 2), pct(-fy26_gdp_share, l), pp(FR["primary_10y"], l), pct(gap_lo, l), pct(gap_hi, l),
           money(f["fy26_gap"], l), money(f["other_omb"][2026], l), money(f["other_omb"][2027], l), pct(m["tips"], l),
           money(f["headroom"], l), money(f["limit"], l),
           money(f["fy26_deficit"], l), money(f["fy26_interest"], l), money(f["fy26_dhp"], l))
        if l == "en" else
        "Ausgangspunkt ist der Haushalt des Haushaltsjahres 2025, fortgeschrieben: Einnahmen und Ausgaben ohne Zinsen "
        "behalten ihren Anteil am BIP von 2025, ein Defizit ohne Zinsen von %s des BIP, und die gewählten Annahmen "
        "gelten jedes Jahr. Die Maßnahmen verändern diesen Haushalt; auf diesem Pfad zählt deshalb keine doppelt. "
        "Wählbar sind stattdessen die beiden Pfade der OMB, ihre Fortschreibung nach geltendem Recht und der "
        "Haushaltsentwurf des Präsidenten. Sie sind nicht die Vorgabe, weil sie auf Wirtschaftsannahmen beruhen, die "
        "die OMB unter der Annahme entwickelt hat, dass die Vorschläge des Präsidenten Gesetz werden, mit realem "
        "Wachstum von %s im Jahr bis 2036, und auf Zöllen von %s für das Haushaltsjahr 2026, von denen nach Erstattungen %s "
        "blieben; damit schrumpft das Defizit ohne Zinsen bis zum Haushaltsjahr 2036 auf %s des BIP. Im Haushaltsjahr "
        "2026 betrug es %s des BIP (nach der Schätzung der OMB für das BIP), und die Langfristprojektion des Finanzministeriums nach "
        "geltender Politik setzt es für die nächsten zehn Jahre im Mittel mit %s an. Was die Rechnung weglässt: Die "
        "Schulden bei Dritten wachsen hier nur um das Defizit. Tatsächlich wachsen sie auch mit den Krediten des "
        "Bundes, vor allem an Studierende, und mit seinem Kassenbestand: in den Haushaltsjahren 2023 bis 2025 um %s bis "
        "%s des BIP im Jahr mehr als das Defizit und im Haushaltsjahr 2026 um %s; die OMB hatte für 2026 %s erwartet "
        "und erwartet für 2027 %s. Die Zinsen folgen den hier gewählten Zinssätzen, auch auf den Pfaden der OMB, nicht denen der OMB. "
        "Alle neuen Schulden kosten denselben Marktzins; inflationsgeschützte Anleihen, %s der handelbaren Schulden, "
        "werden wie die übrigen behandelt, obwohl ihr Nennwert mit den Verbraucherpreisen wächst. Die "
        "Schuldenobergrenze ist nicht abgebildet; Ende Oktober 2026 lagen die ihr unterliegenden Schulden %s unter "
        "der Grenze von %s. Das Haushaltsjahr 2026 ist vorbei, doch die "
        "Rechnung berechnet es wie jedes spätere Jahr; der letzte Monatsausweis des Finanzministeriums zeigt ein "
        "Defizit von %s, Nettozinsen von %s und Schulden bei Dritten von %s zum Jahresende. Rückwirkungen fehlen: "
        "Höhere Schulden treiben den Zins nicht nach oben, und Maßnahmen ändern das Wachstum nicht. Jede Maßnahme wirkt "
        "ab dem Haushaltsjahr 2028 voll und dauerhaft, außer ihre Karte nennt einen späteren Beginn; Befristungen und "
        "Reaktionen von Menschen und Unternehmen fehlen. Kosten, die schneller wachsen als die Wirtschaft, etwa Social "
        "Security und Medicare in einer alternden Gesellschaft, kommen nur über die jährliche Veränderung des Haushalts "
        "ohne Zinsen hinein."
        % (pct(-f["primary_2025"], l, 2), pct(f["real_growth_2026_2036"], l), customs(2026, l), money(f["fy26_customs"], l),
           pct(-pb["baseline"], l, 2), pct(-fy26_gdp_share, l), pp(FR["primary_10y"], l), pct(gap_lo, l), pct(gap_hi, l),
           money(f["fy26_gap"], l), money(f["other_omb"][2026], l), money(f["other_omb"][2027], l), pct(m["tips"], l),
           money(f["headroom"], l), money(f["limit"], l),
           money(f["fy26_deficit"], l), money(f["fy26_interest"], l), money(f["fy26_dhp"], l))))

    return {
        "stock": stock,
        "interest": interest,
        "accounts": "budget",
        "refinancing": refinancing,
        "assumptions": assumptions,
        "presets": presets,
        "references": references,
        "comparisons": comparisons,
        "plans": plans,
        "measuresFrom": measures_from,
        "covers": T("the federal government's unified budget and its debt held by the public",
                    "den Gesamthaushalt des Bundes (unified budget) und seine Schulden bei Dritten (debt held by the public)"),
        "note": note,
    }


def dumps(debt):
    return json.dumps(debt, ensure_ascii=False, indent=2) + "\n"


def report(f, debt):
    """The figures behind debt.json, for a reviewer."""
    b = lambda x: "%.1f" % (x / 1e9)
    gdp = f["gdp"]
    print("stock: debt held by the public end FY 2025 %s bn (%.2f %% of GDP), Fed %s, government accounts %s, gross %s"
          % (b(f["dhp"][BASE]), 100 * f["dhp"][BASE] / gdp[BASE], b(f["fed_held"]), b(f["gov_accounts"]), b(f["gross"])))
    print("interest: net interest FY 2025 %s bn = 901 %s - trust funds %s - other income %s; starting rate %.3f %%"
          % (b(f["net_interest"][BASE]), b(f["interest_gross"]), b(f["interest_trust_funds"]), b(f["interest_other_income"]),
             100 * f["net_interest"][BASE] / f["dhp"][BASE]))
    m = f["maturity"]
    print("maturity: %.3f years (%.1f months), within a year %.1f %%, with floating-rate notes %.1f %%, bills %.1f %%, TIPS %.1f %%"
          % (m["years"], 12 * m["years"], 100 * m["within"], 100 * m["repriced"], 100 * m["bills"], 100 * m["tips"]))
    print("refinancing fit at OMB's rate %.2f %%: best share %.2f" % (f["omb_rate"], f["refi_fit"]["share"]))
    for share in (0.17, 0.20, 0.22, 0.23, 0.24, 0.25, 0.34):
        row = f["refi_fit"]["table"].get(share)
        if row:
            print("  share %.2f: " % share + " ".join("%d %+.0f%%" % (y, 100 * e) for y, e in sorted(row.items())))
    print("market rate on %s: %.3f %% (3 months %.2f, 10 years %.2f); OMB's rates weighted %.3f %%"
          % (f["curve_date"], f["market_rate"], f["curve"][0.25], f["curve"][10.0], f["omb_rate"]))
    print("2012-2021: %.3f %% (10 years %.3f); 1991-2000: %.3f %% (10 years %.3f)" % (f["low_years"] + f["nineties"]))
    print("growth: Fed longer run real %.1f + PCE %.1f = %.3f %%; OMB nominal 2032-2036 %.3f %%, real 2026-2036 %.3f %%"
          % (f["fed_real"], f["fed_pce"], f["growth"], 100 * f["nominal_growth_2032_2036"], 100 * f["real_growth_2026_2036"]))
    print("other means of financing: " + ", ".join("FY %d %s bn (%.2f %% of GDP)" % (y, b(v), 100 * f["gap_ratio"][y])
                                                   for y, v in sorted(f["gap"].items()))
          + "; OMB FY 2026 %s, FY 2027 %s; actual FY 2026 %s" % (b(f["other_omb"][2026]), b(f["other_omb"][2027]), b(f["fy26_gap"])))
    print("FY 2026 actual: receipts %s, outlays %s, deficit %s, net interest %s, primary %s (%.2f %% of OMB's GDP), "
          "debt held by the public %s, customs %s after refunds %s"
          % (b(f["fy26_receipts"]), b(f["fy26_outlays"]), b(f["fy26_deficit"]), b(f["fy26_interest"]), b(f["fy26_primary"]),
             100 * f["fy26_primary"] / gdp[2026], b(f["fy26_dhp"]), b(f["fy26_customs"]), b(f["fy26_customs_refunds"])))
    print("debt limit %s, subject %s, headroom %s (raised by %s); CR to %s; newest law P.L. 119-%d of %s"
          % (b(f["limit"]), b(f["subject"]), b(f["headroom"]), b(f["limit_raise"]), f["cr_end"], f["newest_law"],
             f["newest_law_date"]))
    print("history: highest debt FY %d, highest interest burden before FY 2025 FY %d; net interest above defense in %s"
          % (f["peak_debt_year"], f["peak_interest_year"], f["above_defense"]))
    for plan in debt["plans"]:
        print("plan %s:" % plan["id"])
        for p in plan["points"]:
            print("  %d balance %+.2f %% interest %.2f %% primary %+.2f %% interest/revenue %.2f %% growth %.2f %%"
                  % (p["year"], 100 * p["balanceRatio"], 100 * p["interestRatio"],
                     100 * (p["balanceRatio"] + p["interestRatio"]), 100 * p["interestToRevenue"], 100 * p["growth"]))


if __name__ == "__main__":
    figs = figures()
    debt = build(figs)
    text = dumps(debt)
    if "--check" in sys.argv:
        same = os.path.exists(OUT) and open(OUT, encoding="utf-8").read() == text
        print("debt.json is", "identical to the rebuilt version" if same else "DIFFERENT from the rebuilt version")
        sys.exit(0 if same else 1)
    if "--write" in sys.argv:
        tmp = OUT + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:  # write next to the target, then swap
            fh.write(text)
        os.replace(tmp, OUT)
        print("wrote", OUT)
    else:
        report(figs, debt)
