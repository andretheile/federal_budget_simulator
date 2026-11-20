#!/usr/bin/env python3
"""The figures behind the measures in countries/us/policies.json, recomputed from the cache.

    python3 pipeline/us/measures.py            print every figure the measures use, with its source
    python3 pipeline/us/measures.py --check    also compare the constants in policies.json with the recomputed ones;
                                               exit status 1 on a difference
    python3 pipeline/us/measures.py --write    replace the generated effects in policies.json (see below)

policies.json is written by hand, like the German one; its notes show the arithmetic. This script makes the
constants in the effects reproducible: where an effect's factor or amount is computed from a source, the
computation is here, and --check fails if policies.json does not hold the result.

One measure's effects are generated rather than written by hand: those of `federal_workforce_cut`, one per budget
item and group of agencies, from OMB's object class data (workforce.py). --write puts them into the measure, whose
other parts (label, summary, params, catches, sources) stay as written; --check compares them in full.

Constants read by hand from documents (not parsed) are marked HAND with the place they were read.
"""
import csv, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
PACK = os.path.normpath(os.path.join(HERE, "..", "..", "countries", "us"))
sys.path.insert(0, os.path.join(HERE, "..", "de"))
from xlsx import X  # the generic stdlib reader of the German pipeline

# HAND: Treasury, General Explanations of the Administration's Fiscal Year 2025 Revenue Proposals (March 2024),
# table of revenue estimates, line "Raise the corporate income tax rate to 28 percent", fiscal year 2025, $ million.
TREASURY_28_PERCENT_FY2025 = 122474
# HAND: NATO, Defence Expenditure of NATO Countries (2014-2025), table 3 (share of GDP), United States, 2025e.
NATO_US_2025 = 3.22
# Own assumption: share of the static tariff yield lost because imports fall, are diverted or exempted.
TARIFF_IMPORT_LOSS = 0.20
# HAND: Joint Committee on Taxation, JCX-11-21, Table 1, income and payroll tax offset for 2025.
JCT_OFFSET_2025 = 0.221
# HAND: IRS Publication 5901 (February 2024), p. 2: revenue from IRS enforcement, tax years 2020-2021, $ billion a year.
IRS_ENFORCEMENT_REVENUE = 63e9


def workforce():
    """The module behind `federal_workforce_cut`; importing it builds the budget tree in memory."""
    if HERE not in sys.path[:1]:
        sys.path.insert(0, HERE)
    import workforce as wf
    return wf


def budget_leaf(node_id):
    budget = json.load(open(os.path.join(PACK, "budget.json"), encoding="utf-8"))

    def walk(nodes):
        for n in nodes:
            if n["id"] == node_id:
                return n
            if "children" in n:
                found = walk(n["children"])
                if found:
                    return found
    node = walk(budget["revenue"] + budget["expenditure"])

    def total(n):
        return sum(total(c) for c in n["children"]) if "children" in n else n["amount"]
    return total(node)


def gdp():
    country = json.load(open(os.path.join(PACK, "country.json"), encoding="utf-8"))
    return country["indicators"]["gdp"]["value"]


def goods_imports(first_month):
    """Goods imports (BOP basis, seasonally adjusted, $ million) over the 12 months starting October of the year
    before, from FT-900 Exhibit 1."""
    year = None
    months = {}
    names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    for _, r in X(os.path.join(CACHE, "census", "ft900_exh1.xlsx")).rows("1"):
        label = (r[0] if r else "").strip()
        if label.isdigit() and len(label) == 4:
            year = int(label)
            continue
        name = label.replace(" (R)", "")
        if year and name in names and len(r) > 8 and r[8].strip():
            months[(year, names.index(name) + 1)] = float(r[8])
    fy = first_month
    keys = [(fy - 1, m) for m in (10, 11, 12)] + [(fy, m) for m in range(1, 10)]
    missing = [k for k in keys if k not in months]
    if missing:
        sys.exit("FT-900: months missing %s" % missing)
    return sum(months[k] for k in keys)


def mts(table, date, desc, column, parent_desc=None):
    path = os.path.join(CACHE, "mts", "mts_table_%s_%s.csv" % (table, date))
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    byid = {r["classification_id"]: r for r in rows}
    hits = [r for r in rows if r["classification_desc"].strip() == desc
            and (parent_desc is None or byid.get(r["parent_id"], {}).get("classification_desc", "").strip() == parent_desc)]
    if len(hits) != 1:
        sys.exit("MTS table %s %s: %d rows for %r under %r" % (table, date, len(hits), desc, parent_desc))
    return float(hits[0][column].lstrip("'"))


def figures():
    f = {}
    f["gdp_fy2025"] = gdp()
    # foreign aid
    f["aid_151"] = budget_leaf("exp.international.aid")
    # defence
    f["defense_050"] = budget_leaf("exp.defense")
    f["defense_050_share"] = f["defense_050"] / f["gdp_fy2025"]
    f["defense_add_per_point"] = f["gdp_fy2025"] * 0.01
    f["defense_offset"] = -NATO_US_2025 / 100
    # immigration enforcement
    f["cbp_fy2025"] = budget_leaf("exp.justice.cbp")
    f["ice_fy2025"] = budget_leaf("exp.justice.ice")
    for date, tag in (("2025-09-30", "fy2025"), ("2026-09-30", "fy2026")):
        f["mts_ice_" + tag] = mts("5", date, "Immigration and Customs Enforcement", "current_fytd_net_outly_amt")
        f["mts_cbp_" + tag] = mts("5", date, "U.S. Customs and Border Protection", "current_fytd_net_outly_amt")
    # Social Security payroll taxes
    f["oasi"] = budget_leaf("rev.social_insurance.social_security.oasi")
    f["di"] = budget_leaf("rev.social_insurance.social_security.di")
    # corporate income tax
    f["corporate"] = budget_leaf("rev.corporate_income")
    static_28 = f["corporate"] * 7 / 21
    f["corporate_realised"] = TREASURY_28_PERCENT_FY2025 * 1e6 / static_28
    f["corporate_scale"] = round(f["corporate_realised"] / 21, 6)
    f["corporate_offset"] = round(1 - f["corporate_scale"] * 21, 6)
    # tariffs
    f["imports_fy2025"] = goods_imports(2025) * 1e6
    f["imports_fy2026"] = goods_imports(2026) * 1e6
    f["customs_fy2025"] = budget_leaf("rev.customs")
    f["effective_rate_fy2025"] = f["customs_fy2025"] / f["imports_fy2025"]
    for date, tag in (("2025-09-30", "fy2025"), ("2026-09-30", "fy2026")):
        for col, name in (("current_fytd_gross_rcpt_amt", "gross"), ("current_fytd_refund_amt", "refunds"), ("current_fytd_net_rcpt_amt", "net")):
            f["customs_%s_%s" % (name, tag)] = mts("4", date, "Customs Duties", col)
    f["tariff_scale"] = round(f["imports_fy2025"] * 0.01 * (1 - TARIFF_IMPORT_LOSS))
    f["tariff_offset"] = JCT_OFFSET_2025
    # federal civilian workforce (workforce.py; amounts in dollars, employment in people)
    wf = workforce()
    f.update(wf.figures())
    share = f["wf_retirement_share"]
    f["wf_saving_per_point"] = f["wf_base"] * 0.01 * (1 - share)
    f["wf_saving_default_12"] = f["wf_saving_per_point"] * 12
    f["wf_irs_cut_12"] = f["wf_irs_2025"] * 0.12
    f["wf_irs_enforcement_12"] = IRS_ENFORCEMENT_REVENUE * 0.12
    return f


def expected(f):
    """(policy id, path into the policy, value) that policies.json must hold."""
    return [
        ("defense_spending_gdp", ("effects", 0, "amount", "offset"), round(f["defense_offset"], 6)),
        ("corporate_tax_rate", ("effects", 0, "factor", "scale"), f["corporate_scale"]),
        ("corporate_tax_rate", ("effects", 0, "factor", "offset"), f["corporate_offset"]),
        ("tariff_all_imports", ("effects", 0, "amount", "scale"), f["tariff_scale"]),
        ("tariff_all_imports", ("effects", 0, "shift", "ratio"), f["tariff_offset"]),
    ]


def check_generated(policies):
    """The generated effects of `federal_workforce_cut` against policies.json, in full."""
    wf = workforce()
    policy = policies.get(wf.POLICY)
    if policy is None:
        return ["%s: missing" % wf.POLICY]
    want, have = wf.effects(), policy.get("effects", [])
    problems = []
    if len(want) != len(have):
        problems.append("%s: %d effects in policies.json, %d generated (run measures.py --write)" % (wf.POLICY, len(have), len(want)))
    for i, (a, b) in enumerate(zip(have, want)):
        if a != b:
            problems.append("%s effects/%d (%s): differs from the generated effect (run measures.py --write)" % (wf.POLICY, i, b["target"]))
    return problems


def write_generated():
    wf = workforce()
    path = os.path.join(PACK, "policies.json")
    data = json.load(open(path, encoding="utf-8"))
    policy = next((p for p in data["policies"] if p["id"] == wf.POLICY), None)
    if policy is None:
        sys.exit("policies.json has no measure %s; write its card first" % wf.POLICY)
    policy["effects"] = wf.effects()
    with open(path, "w", encoding="utf-8") as out:
        out.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print("wrote %d effects of %s into %s" % (len(policy["effects"]), wf.POLICY, path))


def check(f):
    policies = {p["id"]: p for p in json.load(open(os.path.join(PACK, "policies.json"), encoding="utf-8"))["policies"]}
    problems = check_generated(policies)
    for pid, path, want in expected(f):
        node = policies.get(pid)
        try:
            for key in path:
                node = node[key]
        except (KeyError, IndexError, TypeError):
            problems.append("%s %s: missing" % (pid, "/".join(map(str, path))))
            continue
        if abs(node - want) > 1e-9 * max(1, abs(want)):
            problems.append("%s %s: %r in policies.json, %r recomputed" % (pid, "/".join(map(str, path)), node, want))
    return problems


if __name__ == "__main__":
    if "--write" in sys.argv:
        write_generated()
    f = figures()
    for key, value in f.items():
        print("%-32s %s" % (key, "{:,.6f}".format(value) if abs(value) < 100 else "{:,.0f}".format(value)))
    if "--check" in sys.argv:
        problems = check(f)
        for p in problems:
            print("PROBLEM:", p)
        print("policies.json constants", "match the sources" if not problems else "DIFFER from the sources")
        sys.exit(1 if problems else 0)
