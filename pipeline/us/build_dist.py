#!/usr/bin/env python3
"""Builds countries/us/distributions/wages.json: wages per worker, for the measure on the Social Security wage cap.

    python3 pipeline/us/build_dist.py            diagnostics: the bins, and what the payroll tax rule yields on them
    python3 pipeline/us/build_dist.py --check    rebuild in memory and compare with the existing file
    python3 pipeline/us/build_dist.py --write    rebuild and replace the file

Input (written by fetch_inputs.py):
  .cache/irs/23in01w2all.xlsx   IRS Statistics of Income, Form W-2 statistics for tax year 2023 (October 2026),
                                Table 1.B: taxpayers with wage income by size of wage income. A taxpayer's wages
                                are the sum of all Forms W-2 of that person, so the bins are per worker, not per job.
                                Table 1.H gives the same wages by multiples of the Social Security wage limit and
                                is used here as a check.

Uprating: 2023 is the latest year published. The Social Security wage limit (contribution and benefit base) grows
by law with the national average wage index, from $160,200 in 2023 to $176,100 in 2025 (2026 Trustees Report,
Table V.C6). Every dollar value is multiplied by that growth, so that the 2023 wages stand in the same relation to
the 2025 limit as they did to the 2023 limit; the number of workers stays that of 2023.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "countries", "us", "distributions"))
sys.path.insert(0, os.path.join(HERE, "..", "de"))
from xlsx import X  # the generic stdlib reader of the German pipeline

BASE_2023, BASE_2025 = 160200, 176100   # contribution and benefit base; Trustees Report 2026, Table V.C6
UPRATE = BASE_2025 / BASE_2023
RATE = 0.124                            # OASDI tax rate, employee and employer together (IRS Publication 15, 2025)


def number(text):
    return float(str(text).replace(",", "").strip())


def table_1b():
    """[(from, to or None, count, wages in dollars)] from Table 1.B, all taxpayers."""
    path = os.path.join(CACHE, "irs", "23in01w2all.xlsx")
    if not os.path.exists(path):
        sys.exit("missing irs/23in01w2all.xlsx: run pipeline/us/fetch_inputs.py first")
    out = []
    for _, r in X(path).rows("Table 1.B"):
        label = (r[0] if r else "").strip()
        if not label.startswith("$"):
            continue
        parts = label.replace("$", "").replace(",", "").split()
        low = float(parts[0])
        high = float(parts[2]) if parts[1] == "under" else None   # "$10,000,000 and over"
        out.append((low, high, int(number(r[1])), number(r[2]) * 1000))
    return out


def total_row():
    for _, r in X(os.path.join(CACHE, "irs", "23in01w2all.xlsx")).rows("Table 1.B"):
        if r and r[0].strip() == "" and len(r) > 2 and r[1] and r[1].strip().isdigit() and int(r[1]) > 10**8:
            return int(number(r[1])), number(r[2]) * 1000
    sys.exit("Table 1.B: no total row")


def build():
    rows = table_1b()
    count, wages = total_row()
    assert abs(sum(r[2] for r in rows) - count) <= len(rows), "classes do not add up to the total count"
    assert abs(sum(r[3] for r in rows) - wages) <= 1e3 * len(rows) * 1000, "classes do not add up to total wages"
    bins = []
    for low, high, n, w in rows[:-1]:
        frm = 0 if low <= 1 else round(low * UPRATE)
        bins.append({"from": frm, "to": round(high * UPRATE), "count": n, "mean": round(w / n * UPRATE, 2)})
    for a, b in zip(bins, bins[1:]):
        assert a["to"] == b["from"] and a["from"] <= a["mean"] <= a["to"], (a, b)
    low, high, n, w = rows[-1]
    assert high is None
    mean = w / n
    alpha = round(mean / (mean - low), 4)        # Pareto tail whose mean equals the class mean
    tail = {"from": bins[-1]["to"], "count": n, "alpha": alpha}
    return {
        "id": "wages",
        "label": {"en": "Annual wages per worker", "de": "Jahreslohn je Beschäftigtem"},
        "variable": {"en": "wages, tips and other compensation per year in dollars, all Forms W-2 of a person together",
                     "de": "Löhne, Trinkgelder und andere Vergütungen pro Jahr in Dollar, alle Lohnbescheinigungen (Form W-2) einer Person zusammen"},
        "unit": {"en": "workers (taxpayers with wages)", "de": "Beschäftigte (Steuerpflichtige mit Lohneinkommen)"},
        "year": 2025,
        "bins": bins,
        "tail": tail,
        "quality": "derived",
        "sources": ["irs_soi_w2_2023", "ssa_trustees_2026"],
        "note": {
            "en": ("IRS Statistics of Income, Form W-2 statistics for tax year 2023, Table 1.B: %s million taxpayers with $%s billion of wages, "
                   "by size of wage income. A person's wages from all employers are added up, as for the wage limit of the employee's share. "
                   "Only workers on an individual income tax return are counted; wages of state and local government employees "
                   "who are not covered by Social Security are included. The top class ($10 million and over) is a Pareto distribution "
                   "whose mean equals the official class mean. 2023 is the latest year published: every dollar value is uprated by the growth "
                   "of the Social Security wage limit from $160,200 (2023) to $176,100 (2025), +%.1f %%, which follows the national average "
                   "wage index by law; the number of workers is that of 2023.") % (
                "{:,.1f}".format(count / 1e6), "{:,.1f}".format(wages / 1e9), (UPRATE - 1) * 100),
            "de": ("Statistik der Steuerbehörde IRS zu den Lohnbescheinigungen (Form W-2) für das Steuerjahr 2023, Tabelle 1.B: %s Mio. "
                   "Steuerpflichtige mit %s Mrd. Dollar Lohn, nach Größenklassen des Lohns. Die Löhne einer Person von allen Arbeitgebern "
                   "sind zusammengezählt, wie für die Beitragsgrenze des Arbeitnehmeranteils. Erfasst sind nur Beschäftigte, die eine "
                   "Einkommensteuererklärung abgeben; Löhne von Beschäftigten der Bundesstaaten und Kommunen, die nicht in der Social Security "
                   "versichert sind, sind enthalten. Die oberste Klasse (ab 10 Mio. Dollar) ist als Pareto-Verteilung dargestellt, deren "
                   "Mittelwert dem amtlichen Klassenmittel entspricht. 2023 ist das jüngste veröffentlichte Jahr: Alle Dollarwerte sind mit dem "
                   "Anstieg der Beitragsbemessungsgrenze der Social Security von 160.200 Dollar (2023) auf 176.100 Dollar (2025) fortgeschrieben, "
                   "also um %s %%, der gesetzlich dem nationalen Durchschnittslohnindex folgt; die Zahl der Beschäftigten ist die von 2023.") % (
                "{:,.1f}".format(count / 1e6).replace(".", ","), "{:,.1f}".format(wages / 1e9).replace(",", "X").replace(".", ",").replace("X", "."),
                ("%.1f" % ((UPRATE - 1) * 100)).replace(".", ",")),
        },
    }


def taxed(dist, cap):
    """Wages up to `cap` per worker, summed over the distribution (the tail integrated as Pareto)."""
    total = 0.0
    for b in dist["bins"]:
        if b["to"] <= cap:
            total += b["count"] * b["mean"]
        elif b["from"] >= cap:
            total += b["count"] * cap
        else:
            # inside the bin: assume wages spread evenly between its bounds
            width = b["to"] - b["from"]
            below = (cap - b["from"]) / width
            total += b["count"] * below * (b["from"] + cap) / 2 + b["count"] * (1 - below) * cap
    total += dist["tail"]["count"] * cap
    return total


def check_against_1h(dist):
    """Table 1.H: wages of workers below one times the 2023 limit. In 2025 dollars that is the share of wages below
    $176,100 in the uprated distribution; the two must agree closely."""
    for _, r in X(os.path.join(CACHE, "irs", "23in01w2all.xlsx")).rows("Table 1.H"):
        if r and r[0].strip() == "" and len(r) > 4 and r[1].strip().isdigit():
            total, under = number(r[2]), number(r[4])
            break
    model_under = sum(b["count"] * b["mean"] for b in dist["bins"] if b["to"] <= BASE_2025)
    return under / total, model_under / sum(b["count"] * b["mean"] for b in dist["bins"])


if __name__ == "__main__":
    dist = build()
    text = json.dumps(dist, ensure_ascii=False, indent=2) + "\n"
    path = os.path.join(OUT, "wages.json")
    if "--check" in sys.argv:
        same = os.path.exists(path) and open(path, encoding="utf-8").read() == text
        print("wages.json is", "identical to the rebuilt version" if same else "DIFFERENT from the rebuilt version")
        sys.exit(0 if same else 1)
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
        print("wrote", path)
    else:
        for b in dist["bins"]:
            print("%12d %12d %12d %14.2f" % (b["from"], b["to"], b["count"], b["mean"]))
        print("tail", dist["tail"])
    mean_tail = dist["tail"]["alpha"] / (dist["tail"]["alpha"] - 1) * dist["tail"]["from"]
    all_wages = sum(b["count"] * b["mean"] for b in dist["bins"]) + dist["tail"]["count"] * mean_tail
    below = taxed(dist, BASE_2025)
    print("wages in the model %.1f bn (2025 dollars); below the $176,100 limit %.1f bn = %.1f %%" % (all_wages / 1e9, below / 1e9, below / all_wages * 100))
    print("removing the limit raises the taxable base by %.1f %%" % ((all_wages / below - 1) * 100))
    share_1h, share_bins = check_against_1h(dist)
    print("check: wages of workers below one limit, Table 1.H %.1f %% of all wages; whole bins below $176,100 in the model %.1f %%"
          % (share_1h * 100, share_bins * 100))
