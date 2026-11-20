#!/usr/bin/env python3
"""Civilian personnel costs of fiscal year 2025 by budget item, for the measure `federal_workforce_cut`.

    python3 pipeline/us/workforce.py     print the personnel base by item and group of agencies, its check against
                                         OMB's published total, and the figures the measure's card quotes

measures.py writes the measure's effects from `effects()` (--write) and compares them with policies.json (--check).

Inputs (.cache/, written by fetch_inputs.py; nothing there is executed):
  omb/objclass_detail_fy2027.xlsx   OMB, object class detail of the FY 2027 Budget: obligations by account, object
                                    class and direct or reimbursable, $ million; "PY Amount" is the actual of 2025.
  omb/ap_5_tables_1-3_fy2027.xlsx   Analytical Perspectives, Tables 5-1 to 5-3: civilian employment (FTE) and pay and
                                    benefits. Table 5-3's executive-branch total is the check of the base.
  omb/outlays_fy2027.xlsx           through build_budget.py: which budget item holds each account's outlays, and the
                                    agency contributions to the retirement funds netted in the item for federal
                                    retirement.
  mts/mts_table_5_2025-09-30.csv    administrative expenses of the two Social Security trust funds in 2025.
  bls/ces_CES9091100001.json        BLS Current Employment Statistics: federal employment except the Postal Service.

The base is civilian personnel compensation and benefits (object classes 11.1, 11.3, 11.5 and 12.1) of the
executive branch without the Postal Service, the scope of Table 5-3, and the script stops if the two differ. Where
the file does not say which budget item a cost belongs to, the script allocates it; these steps are its own:
  1. An account's costs go to the item that holds the account's outlays in the account's default subfunction. An
     account whose outlays lie in several items there (or whose default is a whole function or "multiple") is split
     in proportion to its positive outlays per item.
  2. Reimbursable obligations (work an account does for other accounts, such as the Defense working capital funds)
     are spread over the same agency's items in proportion to the agency's direct personnel costs, because the
     paying accounts bear the saving.
  3. Social Security's administrative account, which the Public Budget Database does not list as an account of its
     own (its outlays are in the trust funds' accounts), is split between the two trust funds in proportion to
     their administrative expenses.
  4. Item and group pairs below MIN_PAIR are added to the group's largest pair in the same budget function, or,
     failing that, to the group's largest pair, so that the card lists fewer items.
Each effect's note names the amounts placed by steps 1 to 4.
"""
import collections, csv, functools, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
sys.path.insert(0, os.path.join(HERE, "..", "de"))
sys.path.insert(0, HERE)   # ahead of the German pipeline, which has a build_budget.py of its own
import build_budget as bb  # noqa: E402  (builds the tree in memory; prints nothing on import)
from xlsx import X  # noqa: E402

POLICY = "federal_workforce_cut"
CIVILIAN = ("11.1", "11.3", "11.5", "12.1")   # full-time permanent, other than full-time permanent, other pay, benefits
SERVICES = ("25.1", "25.2")                   # advisory and assistance services, other services from non-federal sources
EXCLUDED = {"001": "Legislative Branch", "002": "Judicial Branch", "440": "Postal Service"}
GROUP_ORDER = ["defense", "veterans_health", "homeland_justice", "other"]
GROUP_NAME = {
    "defense": ("the Department of Defense", "des Verteidigungsministeriums"),
    "veterans_health": ("the health care staff of the Department of Veterans Affairs", "des Gesundheitspersonals des Veteranenministeriums"),
    "homeland_justice": ("the Departments of Homeland Security and Justice", "des Heimatschutz- und des Justizministeriums"),
    "other": ("the other agencies", "der übrigen Behörden"),
}
RETIREMENT_ITEM = "exp.income_security.federal_retirement"
RETIREMENT_ACCOUNTS = ("813520", "818640")    # agency contributions to the civil service and Foreign Service funds
SSA_ADMIN = ("016", "00", "8704")             # Social Security Administration, Limitation on Administrative Expenses
IRS = ("015", "45")
MIN_PAIR = 1e9
UNCERTAINTY = {"low": 0.6, "high": 1.0, "basis": "staff"}
SOURCES = ["omb_objclass_fy2027", "omb_ap_workforce_fy2027", "omb_pbd_outlays_fy2027"]
EXEC = "Executive Branch (excluding Postal Service):"


def group_of(agency, item):
    """The param that cuts a cost: by agency, and for Veterans Affairs by whether the cost lies in veterans' health
    care (subfunction 703, which also holds the medical staff paid from the Toxic Exposures Fund)."""
    if agency == "007":
        return "defense"
    if agency == "029":
        return "veterans_health" if item == "exp.veterans.health" else "other"
    if agency in ("024", "011"):
        return "homeland_justice"
    return "other"


@functools.lru_cache(maxsize=None)
def objclass():
    """Rows of the object class file with a value for 2025: dicts with the file's column names and v (dollars)."""
    rows = X(os.path.join(CACHE, "omb", "objclass_detail_fy2027.xlsx")).rows("Data")
    _, head = next(rows)
    out = []
    for _, r in rows:
        d = dict(zip(head, r + [""] * (len(head) - len(r))))
        if d["PY Amount"].strip() and float(d["PY Amount"]):
            d["v"] = float(d["PY Amount"]) * 1e6
            out.append(d)
    return tuple(out)


def objclass_sum(classes, agency=None, bureau=None):
    """Dollars of 2025 in the given object classes, executive branch without the Postal Service."""
    return sum(d["v"] for d in objclass() if d["OB Class Code"] in classes and d["OMB Agency Code"] not in EXCLUDED
               and (agency is None or d["OMB Agency Code"] == agency) and (bureau is None or d["OMB Bureau Code"] == bureau))


def _accounts():
    """(agency, bureau, account) -> {(subfunction, item): thousand dollars of 2025 outlays}, and the item that takes
    the rest of each subfunction."""
    owner = {}
    for leaf in bb.leaves(bb.EXP):
        for rule in leaf["take"]:
            for i, r in enumerate(bb.OUTLAYS):
                if bb.matches(r, rule):
                    owner[i] = leaf["id"]
    rest = {code: leaf["id"] for leaf in bb.leaves(bb.EXP) for code in leaf["rest"]}
    out = collections.defaultdict(lambda: collections.defaultdict(float))
    for i, r in enumerate(bb.OUTLAYS):
        item = owner.get(i) or rest.get(r["sub"])
        if item:
            out[(r["agency"], r["bureau"], r["account"])][(r["sub"], item)] += r["v"]
    return out, rest


def admin_expenses():
    """Administrative expenses of the OASI and DI trust funds in fiscal year 2025 (MTS Table 5), dollars."""
    rows = list(csv.DictReader(open(os.path.join(CACHE, "mts", "mts_table_5_2025-09-30.csv"), encoding="utf-8")))
    byid = {r["classification_id"]: r for r in rows}
    out = {}
    for r in rows:
        if r["classification_desc"].strip() == "Administrative Expenses":
            parent = byid.get(r["parent_id"], {}).get("classification_desc", "").strip()
            if parent.startswith("Federal Old-Age and Survivors Insurance"):
                out["exp.social_security.oasi"] = float(r["current_fytd_net_outly_amt"].lstrip("'"))
            elif parent.startswith("Federal Disability Insurance"):
                out["exp.social_security.di"] = float(r["current_fytd_net_outly_amt"].lstrip("'"))
    if len(out) != 2:
        sys.exit("MTS Table 5: administrative expenses of the OASI and DI trust funds not found")
    return out


def ap_rows(sheet):
    return [r for _, r in X(os.path.join(CACHE, "omb", "ap_5_tables_1-3_fy2027.xlsx")).rows(sheet)]


def table_5_3():
    """{(section, line): (2025 actual, 2026 estimate, 2027 estimate)} in $ million, from Table 5-3."""
    out, section = {}, None
    for r in ap_rows("Table 5-3"):
        label = (r[0] if r else "").strip()
        if label.endswith(":"):
            section = label
        elif label in ("Pay", "Benefits", "Subtotal") and len(r) > 3 and r[1].strip():
            out[(section, label)] = tuple(float(c) for c in r[1:4])
    return out


def table_5_1():
    """FTE in thousands by agency line of Table 5-1: {name: (2024, 2025, 2026, 2027, change 2026 to 2027 as a
    share)}; the table's "---" (no change) and "-*" (tiny) count as 0."""
    def number(c):
        c = c.strip()
        return 0.0 if c in ("", "---", "-*", "*") else float(c)
    out = {}
    for r in ap_rows("Table 5-1"):
        if len(r) > 6 and r[0].strip() and r[1].strip() and r[1].strip()[0].isdigit():
            out[r[0].strip()] = tuple(number(c) for c in r[1:5]) + (number(r[6]),)
    return out


@functools.lru_cache(maxsize=None)
def personnel():
    """Civilian personnel costs of 2025 in dollars: {(item, group): {how: dollars}} after steps 1 to 3, where `how`
    says whether the file gives the item (`file`) or the script allocates it (`split`, `reimbursable`, `ssa`,
    `subfunction`); and the excluded branches."""
    accounts, rest = _accounts()
    records = []          # (item, group, agency, direct, how, dollars)
    excluded = collections.defaultdict(float)
    for d in objclass():
        if d["OB Class Code"] not in CIVILIAN:
            continue
        v = d["v"]
        agency, bureau, account = d["OMB Agency Code"], d["OMB Bureau Code"], d["OMB Account"]
        if agency in EXCLUDED:
            excluded[agency] += v
            continue
        direct = d["Direct/Reimbursable"] == "D"
        sub = d["Default Budget Subfunction"][:3]

        def record(item, how, dollars):
            records.append((item, group_of(agency, item), agency, direct, how, dollars))

        legs = accounts.get((agency, bureau, account))
        if not legs:
            if (agency, bureau, account) == SSA_ADMIN:
                admin = admin_expenses()
                for item, w in admin.items():
                    record(item, "ssa", v * w / sum(admin.values()))
                continue
            if sub not in rest:
                sys.exit("object class account %s-%s-%s has no budget item" % (agency, bureau, account))
            record(rest[sub], "subfunction", v)
            continue
        exact = [k for k in legs if k[0] == sub]
        if len(exact) == 1:
            record(exact[0][1], "file", v)
            continue
        weights = collections.defaultdict(float)
        for (s, item), w in legs.items():
            if not exact or s == sub:
                weights[item] += w
        # positive outlays; if there are none, their size; if all are zero, equal parts
        for fix in (lambda w: max(w, 0), abs, lambda w: 1.0):
            fixed = {item: fix(w) for item, w in weights.items()}
            if sum(fixed.values()) > 0:
                break
        total = sum(fixed.values())
        for item, w in fixed.items():
            if w:
                record(item, "split" if len(fixed) > 1 else "file", v * w / total)
    direct_cost = collections.defaultdict(lambda: collections.defaultdict(float))
    for item, group, agency, direct, how, v in records:
        if direct:
            direct_cost[agency][(item, group)] += v
    cost = collections.defaultdict(lambda: collections.defaultdict(float))
    for item, group, agency, direct, how, v in records:
        base = direct_cost.get(agency)
        if direct or not base:
            cost[(item, group)][how] += v
            continue
        total = sum(base.values())
        for key, w in base.items():
            cost[key]["reimbursable"] += v * w / total
    cost = {k: dict(v) for k, v in cost.items()}
    official = table_5_3()[(EXEC, "Subtotal")][0] * 1e6
    base = sum(sum(v.values()) for v in cost.values())
    if abs(base - official) > 0.5e6:
        sys.exit("personnel base %.0f million differs from Table 5-3 (%.0f million)" % (base / 1e6, official / 1e6))
    return cost, dict(excluded)


def merged(cost):
    """Step 4. Returns {(item, group): dollars} and {(item, group): dollars added from smaller pairs}."""
    out = {k: sum(v.values()) for k, v in cost.items()}
    function = {leaf["id"]: n["id"] for n in bb.EXP for leaf in bb.leaves([n])}
    moved = collections.defaultdict(float)
    for key, v in sorted(out.items(), key=lambda kv: kv[1]):
        if v >= MIN_PAIR or key not in out:
            continue
        item, group = key
        big = [(w, k) for k, w in out.items() if k[1] == group and k != key and w >= MIN_PAIR]
        same = [c for c in big if function[c[1][0]] == function[item]]
        if not big:
            continue
        target = max(same or big)[1]
        out[target] += out.pop(key)
        moved[target] += v
    return out, dict(moved)


def retirement_share():
    """Share of the base that agencies pay into the civil service and Foreign Service retirement funds. The budget
    nets these contributions out of the item for federal retirement; a smaller workforce pays less of them, so that
    item rises. The contributions of all branches but the Postal Service are attributed to the executive branch by
    its share of civilian pay (Table 5-3)."""
    t = table_5_3()
    pay = {k[0]: v[0] for k, v in t.items() if k[1] == "Pay"}
    executive = pay[EXEC] / (pay[EXEC] + pay["Legislative Branch:"] + pay["Judicial Branch:"])
    contributions = -sum(bb.q(account=a) for a in RETIREMENT_ACCOUNTS) * 1e3
    base = t[(EXEC, "Subtotal")][0] * 1e6
    return round(contributions * executive / base, 4), {"contributions": contributions, "executive": executive, "base": base}


def _bn(dollars, lang):
    tenths = int(round(abs(dollars) / 1e8))
    whole, tenth = tenths // 10, tenths % 10
    if lang == "de":
        return "%s,%d Mrd. Dollar" % (bb._group(whole, "."), tenth)
    return "$%s.%d billion" % (bb._group(whole, ","), tenth)


def _pct(x, lang):
    s = "%.1f" % (x * 100)
    return (s.replace(".", ",") + " %") if lang == "de" else s + "%"


ALLOCATED = {
    "split": ("accounts spread over several items, split by their outlays",
              "Konten, die sich auf mehrere Posten verteilen, nach ihren Ausgaben aufgeteilt"),
    "reimbursable": ("work done for other accounts of the agency, spread like its direct personnel costs",
                     "Arbeit für andere Konten der Behörde, verteilt wie deren direkte Personalkosten"),
    "ssa": ("Social Security's administrative account, split between the two trust funds by their administrative expenses",
            "dem Verwaltungskonto der Social Security, auf die beiden Fonds nach deren Verwaltungsausgaben aufgeteilt"),
    "subfunction": ("accounts not listed in the outlays database, placed by their subfunction",
                    "Konten, die in der Ausgabendatenbank fehlen, nach ihrer Teilfunktion zugeordnet"),
}


def effects():
    """The measure's effects: one per item and group of agencies (the group's param cuts it), then one per group on
    the item for federal retirement for the agency contributions that are no longer netted out."""
    cost, _ = personnel()
    pairs, moved = merged(cost)
    share, _ = retirement_share()
    out, by_group = [], collections.defaultdict(float)
    for group in GROUP_ORDER:
        for v, item in sorted(((v, item) for (item, g), v in pairs.items() if g == group), reverse=True):
            scale = -round(v / 100)
            v = -scale * 100.0
            by_group[group] += v
            en = ["Civilian pay and benefits of %s in this item in fiscal year 2025: %s." % (GROUP_NAME[group][0], _bn(v, "en"))]
            de = ["Zivile Personalkosten %s in diesem Posten im Haushaltsjahr 2025: %s." % (GROUP_NAME[group][1], _bn(v, "de"))]
            parts = cost.get((item, group), {})
            own = sorted(((parts.get(how, 0), how) for how in ALLOCATED if parts.get(how, 0) >= max(0.05 * v, 50e6)), reverse=True)
            if own:
                en.append("Allocated by the pack: " + "; ".join("%s from %s" % (_bn(x, "en"), ALLOCATED[how][0]) for x, how in own) + ".")
                de.append("Vom Paket zugeordnet: " + "; ".join("%s aus %s" % (_bn(x, "de"), ALLOCATED[how][1]) for x, how in own) + ".")
            extra = moved.get((item, group), 0)
            if extra >= 50e6:
                en.append("Includes %s of the same group in smaller items, added here." % _bn(extra, "en"))
                de.append("Enthält %s derselben Gruppe aus kleineren Posten, hier zugeschlagen." % _bn(extra, "de"))
            en.append("The cut saves the chosen share of it.")
            de.append("Die Kürzung spart davon den eingestellten Anteil.")
            allocated = sum(parts.get(how, 0) for how in ALLOCATED) + extra
            sources = list(SOURCES) + (["treasury_mts_2025_09"] if parts.get("ssa") else [])
            out.append({
                "type": "add", "target": item,
                "amount": {"param": "cut_" + group, "scale": scale},
                "quality": "derived" if allocated < 0.2 * v else "estimate",
                "uncertainty": dict(UNCERTAINTY), "sources": sources,
                "note": {"en": " ".join(en), "de": " ".join(de)},
            })
    for group in GROUP_ORDER:
        v = by_group[group]
        out.append({
            "type": "add", "target": RETIREMENT_ITEM,
            "amount": {"param": "cut_" + group, "scale": round(v * share / 100)},
            "quality": "estimate", "uncertainty": dict(UNCERTAINTY), "sources": list(SOURCES),
            "note": {
                "en": ("Less netted out: about %s of the pay and benefits of %s (%s) are agency contributions to the civil "
                       "service and Foreign Service retirement funds. They stay within the government, and the budget "
                       "subtracts them from this item; with fewer employees, less is subtracted. Own estimate: the funds' "
                       "agency contributions in 2025 over the base, the executive branch's part by its share of civilian "
                       "pay." % (_pct(share, "en"), GROUP_NAME[group][0], _bn(v, "en"))),
                "de": ("Weniger Verrechnung: etwa %s der Personalkosten %s (%s) sind Beiträge der Behörden an die "
                       "Pensionsfonds des öffentlichen und des auswärtigen Dienstes. Sie bleiben innerhalb des Staates, "
                       "und der Haushalt zieht sie von diesem Posten ab; mit weniger Beschäftigten wird weniger "
                       "abgezogen. Eigene Schätzung: die Behördenbeiträge an die Fonds 2025 im Verhältnis zur Basis, der "
                       "Anteil der Exekutive nach ihrem Anteil an den zivilen Gehältern."
                       % (_pct(share, "de"), GROUP_NAME[group][1], _bn(v, "de"))),
            },
        })
    return out


def bls_federal():
    """Federal employment except the Postal Service, thousands, seasonally adjusted: {(year, month): value}."""
    data = json.load(open(os.path.join(CACHE, "bls", "ces_CES9091100001.json"), encoding="utf-8"))
    series = data["Results"]["series"][0]["data"]
    return {(int(x["year"]), int(x["period"][1:])): float(x["value"]) for x in series if x["period"] != "M13"}


def figures():
    """The figures the card quotes, recomputed. Dollars, people, or shares."""
    f = {}
    cost, _ = personnel()
    f["wf_base"] = sum(sum(v.values()) for v in cost.values())
    by_group = collections.defaultdict(float)
    for (item, group), v in cost.items():
        by_group[group] += sum(v.values())
    for g in GROUP_ORDER:
        f["wf_base_" + g] = by_group[g]
    f["wf_retirement_share"], parts = retirement_share()
    f["wf_retirement_contributions"] = parts["contributions"]
    t53 = table_5_3()
    f["wf_t53_2025"], f["wf_t53_2026"], f["wf_t53_2027"] = (x * 1e6 for x in t53[(EXEC, "Subtotal")])
    f["wf_pay_2025"], f["wf_pay_2026"], _ = (x * 1e6 for x in t53[(EXEC, "Pay")])
    f["wf_benefits_2025"], f["wf_benefits_2026"], _ = (x * 1e6 for x in t53[(EXEC, "Benefits")])
    fte = table_5_1()
    total = fte["Total, Executive Branch civilian employment"]
    f["wf_fte_2025"], f["wf_fte_2026"], f["wf_fte_2027"] = (x * 1e3 for x in total[1:4])
    named = {"War--Military Programs": "defense", "Veterans Affairs": "va", "Homeland Security": "dhs", "Justice": "doj",
             "Treasury": "treasury", "Agriculture": "agriculture", "Education": "education", "Labor": "labor",
             "National Aeronautics and Space Administration": "nasa"}
    for name, key in named.items():
        f["wf_fte_%s_2025" % key], f["wf_fte_%s_2026" % key], f["wf_fte_%s_2027" % key] = (x * 1e3 for x in fte[name][1:4])
        f["wf_fte_%s_change_2026" % key] = fte[name][2] / fte[name][1] - 1
        f["wf_fte_%s_change_2027" % key] = fte[name][4]          # the table's own percent column
    four = ("defense", "va", "dhs", "doj")
    rest25 = f["wf_fte_2025"] - sum(f["wf_fte_%s_2025" % k] for k in four)
    rest26 = f["wf_fte_2026"] - sum(f["wf_fte_%s_2026" % k] for k in four)
    f["wf_fte_change_2026"] = f["wf_fte_2026"] / f["wf_fte_2025"] - 1
    f["wf_fte_change_2027"] = f["wf_fte_2027"] / f["wf_fte_2026"] - 1
    f["wf_fte_rest_change_2026"] = rest26 / rest25 - 1
    b = bls_federal()
    fy25 = [b[(2024, m)] for m in (10, 11, 12)] + [b[(2025, m)] for m in range(1, 10)]
    f["wf_bls_fy2025_avg"] = sum(fy25) / 12 * 1e3
    for (y, m) in ((2024, 12), (2025, 9), (2025, 10), (2026, 3)):
        f["wf_bls_%d_%02d" % (y, m)] = b[(y, m)] * 1e3
    f["wf_bls_latest"] = b[max(b)] * 1e3
    f["wf_bls_latest_month"] = max(b)[0] * 100 + max(b)[1]
    f["wf_bls_drop_sep_oct_2025"] = (b[(2025, 9)] - b[(2025, 10)]) * 1e3
    f["wf_bls_change_dec24_mar26"] = b[(2026, 3)] / b[(2024, 12)] - 1
    f["wf_bls_change_fy25_latest"] = b[max(b)] / (sum(fy25) / 12) - 1
    f["wf_services_2025"] = objclass_sum(SERVICES)
    f["wf_irs_2025"] = objclass_sum(CIVILIAN, *IRS)
    f["wf_faa_2025"] = objclass_sum(CIVILIAN, "021", "12")
    f["wf_ssa_2025"] = objclass_sum(CIVILIAN, "016")
    return f


if __name__ == "__main__":
    cost, excluded = personnel()
    f = figures()
    print("civilian pay and benefits 2025, executive branch without the Postal Service: %s; Table 5-3: %s"
          % (_bn(f["wf_base"], "en"), _bn(f["wf_t53_2025"], "en")))
    print("excluded:", {EXCLUDED[k]: _bn(v, "en") for k, v in excluded.items()})
    how = collections.defaultdict(float)
    for parts in cost.values():
        for k, v in parts.items():
            how[k] += v
    print("placed by:", {k: _bn(v, "en") for k, v in sorted(how.items(), key=lambda kv: -kv[1])})
    print("by group:", {g: _bn(f["wf_base_" + g], "en") for g in GROUP_ORDER})
    pairs, moved = merged(cost)
    print("%d item-group pairs; %d after adding pairs below %s to larger ones" % (len(cost), len(pairs), _bn(MIN_PAIR, "en")))
    by_item = collections.defaultdict(float)
    for (item, group), v in pairs.items():
        by_item[item] += v
    for item, v in sorted(by_item.items(), key=lambda kv: -kv[1]):
        amount = bb.EXP_AMOUNTS[item] * 1e3
        print("   %-46s %16s of %18s%s" % (item, _bn(v, "en"), _bn(amount, "en"), "   more than the item" if v > amount else ""))
    print("retirement share %.4f: agency contributions %s, executive share %.4f"
          % (f["wf_retirement_share"], _bn(f["wf_retirement_contributions"], "en"), retirement_share()[1]["executive"]))
    for k, v in f.items():
        if not k.startswith(("wf_base", "wf_retirement")):
            print("   %-30s %s" % (k, "{:,.4f}".format(v) if abs(v) < 10 else "{:,.0f}".format(v)))
