#!/usr/bin/env python3
"""Builds countries/de/distributions/taxable_income.json and net_wealth.json.

    python3 pipeline/de/build_dist.py            diagnostics only
    python3 pipeline/de/build_dist.py --check    rebuild in memory and compare with the existing files
    python3 pipeline/de/build_dist.py --write    rebuild and replace the two files

Inputs (written by fetch_inputs.py):
  .cache/est/csv02.tsv    Destatis wage and income tax statistics 2022, table 73111-02 (sheet csv-73111-02)
  .cache/ecb/dwa_de.csv   ECB Distributional Wealth Accounts, Germany, households, net wealth

What is data and what is judgement is listed in README.md.
"""
import json, os, re, collections, math, sys

HERE = os.path.dirname(os.path.abspath(__file__))
S = os.path.join(HERE, ".cache")
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "countries", "de", "distributions"))


def income():
    rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(S, "est", "csv02.tsv"))][1:]
    D = collections.OrderedDict()
    for r in rows:
        if len(r) < 9 or not r[3]:
            continue
        if r[5].strip() != "Zu versteuerndes Einkommen":
            continue
        D[(r[3], r[4])] = (float(r[7]), float(r[8]))

    def bounds(c):
        c = c.replace(" ", " ")
        if c.startswith("unter 0"):
            return (None, 0.0)
        m = re.match(r"von ([\d ]+) bis unter ([\d ]+) EUR", c)
        if m:
            return (float(m.group(1).replace(" ", "")), float(m.group(2).replace(" ", "")))
        m = re.match(r"([\d ]+) EUR oder mehr", c)
        if m:
            return (float(m.group(1).replace(" ", "")), None)
        return "total"

    merged = collections.OrderedDict()
    for (tab, cls), (n, z) in D.items():
        b = bounds(cls)
        if b == "total":
            continue
        split = tab.startswith("nach der Splitting")
        f = 2.0 if split else 1.0
        lo = None if b[0] is None else b[0] / f
        hi = None if b[1] is None else b[1] / f
        key = (lo, hi)
        cnt, tot = merged.get(key, (0.0, 0.0))
        merged[key] = (cnt + n * f, tot + z)
    keys = sorted(merged, key=lambda k: (-1e18 if k[0] is None else k[0]))
    bins, tail = [], None
    for lo, hi in keys:
        cnt, tot = merged[(lo, hi)]
        mean = tot / cnt
        if lo is None:
            bins.append({"from": -50000, "to": 0, "count": round(cnt), "mean": round(mean, 2)})
        elif hi is None:
            alpha = mean / (mean - lo)
            tail = {"from": lo, "count": round(cnt), "alpha": round(alpha, 4)}
            print("income tail: count", cnt, "mean", mean, "alpha", alpha)
        else:
            bins.append({"from": lo, "to": hi, "count": round(cnt), "mean": round(mean, 2)})
    for a, b in zip(bins, bins[1:]):
        assert a["to"] == b["from"], (a, b)
    assert tail["from"] == bins[-1]["to"]
    n = sum(b["count"] for b in bins) + tail["count"]
    z = sum(b["count"] * b["mean"] for b in bins) + tail["count"] * tail["from"] * tail["alpha"] / (tail["alpha"] - 1)
    print("income units", n, "total zvE bn", z / 1e9)
    return {
        "id": "taxable_income",
        "label": {"de": "Zu versteuerndes Einkommen je Steuerpflichtigem", "en": "Taxable income per taxpayer"},
        "variable": {"de": "zu versteuerndes Einkommen pro Jahr in Euro (bei zusammen veranlagten Paaren je Partner die Hälfte)", "en": "taxable income per year in euros (for jointly assessed couples, half per partner)"},
        "unit": {"de": "Steuerpflichtige Personen (zusammen veranlagte Paare zählen als zwei Personen)", "en": "taxpayers (jointly assessed couples count as two persons)"},
        "year": 2022,
        "bins": bins,
        "tail": tail,
        "quality": "derived",
        "sources": ["destatis_lest_2022"],
        "note": {"de": "Lohn- und Einkommensteuerstatistik 2022, Tabelle 73111-02 (unbeschränkt Steuerpflichtige nach Größenklassen des zu versteuernden Einkommens). Weil der Steuertarif bei zusammen veranlagten Paaren auf das halbe gemeinsame Einkommen angewendet wird (Splitting), wurden Paare als zwei Personen mit je halbem Einkommen gezählt; die halbierten Größenklassen der Splittingtabelle decken sich mit denen der Grundtabelle. Die oberste Klasse (ab 1 Mio. Euro) ist als Pareto-Verteilung dargestellt, deren Mittelwert dem amtlichen Klassenmittel entspricht. Die Untergrenze der Klasse mit negativem Einkommen ist gesetzt. Einkommen des Jahres 2022; Kapitalerträge unter der Abgeltungsteuer sind nicht enthalten.",
                 "en": "Wage and income tax statistics 2022, table 73111-02 (resident taxpayers by size class of taxable income). Because the tax schedule is applied to half the joint income of jointly assessed couples (income splitting), couples were counted as two persons with half the income each; the halved size classes of the splitting table coincide with those of the basic table. The top class (EUR 1 million and above) is represented as a Pareto distribution whose mean equals the official class mean. The lower bound of the class with negative income is set arbitrarily. Incomes of 2022; capital income taxed at the flat withholding rate is not included."},
    }


def wealth():
    # ECB DWA, Germany, households, 2024-Q4, million euros (.cache/ecb/dwa_de.csv)
    import csv
    rows = list(csv.DictReader(open(os.path.join(S, "ecb", "dwa_de.csv"))))
    v = {}
    for r in rows:
        if r["TIME_PERIOD"] == "2024-Q4":
            v[(r["DWA_GRP"], r["UNIT_MEASURE"], r["ACCOUNT_ENTRY"])] = float(r["OBS_VALUE"])
    W = v[("_Z", "EUR", "N")] * 1e6
    per_hh = v[("_Z", "EUR_R_NH", "N")] * 1e3
    N = W / per_hh
    dec = N / 10
    q1, q2, b50 = v[("Q1", "EUR", "N")] * 1e6, v[("Q2", "EUR", "N")] * 1e6, v[("B50", "EUR", "N")] * 1e6
    d5 = b50 - q1 - q2
    d = {k: v[(k, "EUR", "N")] * 1e6 for k in ("D6", "D7", "D8", "D9", "D10")}
    t5 = v[("T5", "PT", "_Z")] / 100 * W
    t10 = v[("T10", "PT", "_Z")] / 100 * W
    print("households", N, "total", W / 1e12, "D10", d["D10"] / 1e12, "T10 from share", t10 / 1e12, "T5", t5 / 1e12)
    # Pareto tail above the 90th percentile fitted to the top-10% and top-5% totals
    alpha = 1 / (1 - math.log(t5 / d["D10"]) / math.log(0.5))
    mean10 = d["D10"] / dec
    x90 = mean10 * (alpha - 1) / alpha
    print("alpha", alpha, "x90", x90, "mean top10", mean10, "x95", x90 * 0.5 ** (-1 / alpha))
    means = [q1 / (2 * dec), q2 / (2 * dec), d5 / dec, d["D6"] / dec, d["D7"] / dec, d["D8"] / dec, d["D9"] / dec]
    counts = [2 * dec, 2 * dec, dec, dec, dec, dec, dec]
    # thresholds between groups: geometric mean of neighbouring group means (not published by the ECB)
    th = [0.0]  # between Q1 (negative mean) and Q2
    for a, b in zip(means[1:], means[2:]):
        th.append(math.sqrt(a * b))
    th.append(x90)
    lows = [-250000.0] + th[:-1]
    bins = []
    for lo, hi, c, m in zip(lows, th, counts, means):
        assert lo <= m <= hi, (lo, m, hi)
        bins.append({"from": round(lo), "to": round(hi), "count": round(c), "mean": round(m)})
    for a, b in zip(bins, bins[1:]):
        b["from"] = a["to"]
    tail = {"from": bins[-1]["to"], "count": round(dec), "alpha": round(alpha, 4)}
    tot = sum(b["count"] * b["mean"] for b in bins) + tail["count"] * tail["from"] * tail["alpha"] / (tail["alpha"] - 1)
    print("wealth model total tn", tot / 1e12, "official", W / 1e12)
    for thr in (1e6, 2e6, 4e6, 1e7, 1e8, 1e9):
        if thr >= tail["from"]:
            n = tail["count"] * (tail["from"] / thr) ** tail["alpha"]
            exc = n * thr / (tail["alpha"] - 1)
            print(f"  above {thr:>13,.0f}: households {n:>12,.0f}  wealth above threshold {exc / 1e12:6.3f} tn = {exc / W * 100:5.1f}% of total")
    return {
        "id": "net_wealth",
        "label": {"de": "Nettovermögen der privaten Haushalte", "en": "Net wealth of private households"},
        "variable": {"de": "Nettovermögen je Haushalt in Euro (Immobilien, Betriebs- und Finanzvermögen abzüglich Schulden; ohne Rentenansprüche)", "en": "net wealth per household in euros (real estate, business and financial assets minus debt; excluding pension entitlements)"},
        "unit": {"de": "Haushalte", "en": "households"},
        "year": 2024,
        "bins": bins,
        "tail": tail,
        "quality": "estimate",
        "sources": ["ecb_dwa", "diw_wb_29_2020"],
        "note": {"de": "Verteilungsbasierte Vermögensbilanz (Distributional Wealth Accounts) von EZB und Bundesbank für Deutschland, 4. Quartal 2024: eine experimentelle Statistik, die Befragungsdaten auf die gesamtwirtschaftlichen Vermögensbestände hochrechnet und die Untererfassung sehr reicher Haushalte korrigiert. Amtlich veröffentlicht sind die Vermögenssummen der unteren Hälfte, der Zehntel 6 bis 10 und der Anteil der reichsten 5 %. Eigene Näherungen: Die Grenzen zwischen den Gruppen sind nicht veröffentlicht und als geometrisches Mittel benachbarter Gruppenmittel gesetzt; die Untergrenze der ersten Gruppe ist gesetzt. Oberhalb des 90. Perzentils (rund 1,03 Mio. Euro je Haushalt) wird eine Pareto-Verteilung verwendet, die die veröffentlichten Summen der reichsten 10 % und 5 % genau trifft. Innerhalb der reichsten 5 % ist die Verteilung damit eine Modellannahme; Auswertungen mit Reichenlisten (DIW) deuten auf eine noch stärkere Konzentration an der Spitze hin. Vermögen je Haushalt, nicht je Person.",
                 "en": "Distributional Wealth Accounts of the ECB and the Bundesbank for Germany, fourth quarter of 2024: an experimental statistic that scales survey data to macroeconomic balance sheets and corrects for the under-coverage of very wealthy households. Officially published are the wealth totals of the bottom half, of deciles 6 to 10 and the share of the top 5%. Own approximations: the thresholds between groups are not published and are set to the geometric mean of neighbouring group means; the lower bound of the first group is set arbitrarily. Above the 90th percentile (about EUR 1.03 million per household) a Pareto distribution is used that exactly reproduces the published totals of the top 10% and the top 5%. The distribution within the top 5% is therefore a modelling assumption; analyses using rich lists (DIW) point to even stronger concentration at the very top. Wealth per household, not per person."},
    }


if __name__ == "__main__":
    different = False
    for dist in (income(), wealth()):
        path = os.path.join(OUT, dist["id"] + ".json")
        text = json.dumps(dist, ensure_ascii=False, indent=2)
        if "--check" in sys.argv:
            same = os.path.exists(path) and open(path, encoding="utf-8").read() == text
            different = different or not same
            print(dist["id"] + ".json is", "identical to the rebuilt version" if same else "DIFFERENT from the rebuilt version")
        elif "--write" in sys.argv:
            os.makedirs(OUT, exist_ok=True)
            with open(path + ".tmp", "w", encoding="utf-8") as f:   # write next to the target, then swap
                f.write(text)
            os.replace(path + ".tmp", path)
            print("wrote", path)
        else:
            print(dist["id"], len(dist["bins"]), "bins")
            for b in dist["bins"]:
                print("  ", b)
            print("   tail", dist["tail"])
    sys.exit(1 if different else 0)
