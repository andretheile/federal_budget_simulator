#!/usr/bin/env python3
"""Plausibility checks of the distributions against published totals.

    python3 pipeline/de/check_distributions.py

It integrates tax schedules over the distributions the same way the engine does (src/engine/distribution.ts:
two uniform pieces per bin that preserve count and mean, Pareto tail in closed form) and prints:

  - the income tax schedule of the statistics year (2022), written as a curve of marginal rates and as a step
    function, applied to the income distribution as observed in 2022 (the values of taxable_income.json
    divided by the uprating factor of build_dist.py). Official tariff income tax in the 2022 statistics is
    373.3 bn euros; the results should be close to it;
  - the 2024 schedule (the `baseline` of the income tax measure in countries/de/policies.json) on
    taxable_income.json, and what selected changes of the schedule yield, for comparison with published
    estimates;
  - the contributions that the 2022 rules yield on the earnings as observed in 2022 (build_budget.py uses the
    pension figure for the leaf rev.contributions.wages.pension) and that the 2024 rules yield on
    gross_earnings.json, with the wages above the ceilings;
  - the wealth above several thresholds in net_wealth.json, to compare with wealth tax studies.

A curve is a list of points (x, marginal rate in percent), as in the country pack contract: rate 0 below the
first point, linear between points, constant above the last, two points with the same x form a step.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.normpath(os.path.join(HERE, "..", "..", "countries", "de", "distributions"))


def uexc(n, lo, hi, a):
    if a >= hi: return 0.0
    if a <= lo: return n * ((lo + hi) / 2 - a)
    d = hi - a
    return n * d * d / (2 * (hi - lo))


def bin_exc(b, a):
    if a >= b["to"]: return 0.0
    if a <= b["from"]: return b["count"] * (b["mean"] - a)
    w = b["to"] - b["from"]
    p = min(1, max(0, (b["to"] - b["mean"]) / w))
    lower = b["count"] * p
    return uexc(lower, b["from"], b["mean"], a) + uexc(b["count"] - lower, b["mean"], b["to"], a)


def tail_exc(t, a):
    if a <= t["from"]:
        return t["count"] * (t["alpha"] * t["from"] / (t["alpha"] - 1) - a)
    return t["count"] * (t["from"] / a) ** t["alpha"] * a / (t["alpha"] - 1)


def excess(d, a):
    """Sum over all units of max(0, x - a)."""
    s = sum(bin_exc(b, a) for b in d["bins"])
    if d.get("tail"): s += tail_exc(d["tail"], a)
    return s


def total(d, brackets):
    """Tax of a schedule of (from, marginal rate) brackets over the whole distribution."""
    s = 0.0
    for i, (f, r) in enumerate(brackets):
        nxt = brackets[i + 1][0] if i + 1 < len(brackets) else None
        s += r * (excess(d, f) - (excess(d, nxt) if nxt is not None else 0.0))
    return s


def curve_brackets(points, n=2000):
    """A curve of marginal rates (percent) as fine steps. Each linear piece becomes n steps carrying the rate at
    their midpoint, which integrates a linear rate exactly for every unit above the step."""
    out = [(points[0][0] - 1e12, 0.0)] if points[0][1] else []
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x1 == x0: continue
        w = (x1 - x0) / n
        out += [(x0 + k * w, (y0 + (y1 - y0) * (k + 0.5) / n) / 100) for k in range(n)]
    out.append((points[-1][0], points[-1][1] / 100))
    return out


def curve_total(d, points):
    """What all units of a distribution owe under a curve of marginal rates."""
    return total(d, curve_brackets(points))


def uprated(d, f):
    """The same distribution with every value multiplied by f (counts unchanged)."""
    out = dict(d, bins=[dict(b, **{"from": b["from"] * f, "to": b["to"] * f, "mean": b["mean"] * f}) for b in d["bins"]])
    if d.get("tail"): out["tail"] = dict(d["tail"], **{"from": d["tail"]["from"] * f})
    return out


# section 32a EStG as marginal rates in percent: basic allowance, two zones with linearly rising rates, 42 %, 45 %
TARIFF_2022 = [(10347, 14), (14926, 23.97), (58596, 42), (277825, 42), (277825, 45)]
TARIFF_2024 = [(11784, 14), (17005, 23.97), (66760, 42), (277825, 42), (277825, 45)]
TARGET_2024 = 340.853e9   # wage tax and assessed income tax 2024 in budget.json


def steps(tariff):
    """A schedule as steps of constant marginal rates, for measures written with brackets: two steps in the first
    zone and six in the second, each carrying the marginal rate at its midpoint, then the two flat rates.
    From the first euro above each legal threshold."""
    (a, r0), (b, r1), (c, r2), (d, _), (_, r3) = tariff
    z1 = [(a + 1 + (b - a) * k / 2, (r0 + (r1 - r0) * (k + 0.5) / 2) / 100) for k in range(2)]
    z2 = [(b + 1 + (c - b) * k / 6, (r1 + (r2 - r1) * (k + 0.5) / 6) / 100) for k in range(6)]
    return [(0, 0.0)] + z1 + z2 + [(c + 1, r2 / 100), (d + 1, r3 / 100)]


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    from build_dist import UPRATE
    inc = json.load(open(os.path.join(DIST, "taxable_income.json")))
    w = json.load(open(os.path.join(DIST, "net_wealth.json")))
    earn = json.load(open(os.path.join(DIST, "gross_earnings.json")))
    inc22, earn22 = uprated(inc, 1 / UPRATE), uprated(earn, 1 / UPRATE)
    print("2022 schedule on the incomes as observed in 2022 (official tariff income tax 2022: 373.3 bn euros)")
    print("  as a step function: %.1f bn" % (total(inc22, steps(TARIFF_2022)) / 1e9))
    print("  as a curve:         %.1f bn" % (curve_total(inc22, TARIFF_2022) / 1e9))
    reforms = {
        "45 % from 66,761 and 48 % from 277,826, as steps": [(11784, 14), (17005, 23.97), (66760, 42), (66760, 45), (277825, 45), (277825, 48)],
        "48 % from 277,826 (government estimate for 2025: about +3 bn)": TARIFF_2024[:-1] + [(277825, 48)],
        "second zone rising to 45 % at 66,760 (government estimate for a 45 % top rate in 2025: about +14 bn)": [(11784, 14), (17005, 23.97), (66760, 45)],
        "42 % only from 80,000 (government estimate for 2025: about -9.5 bn)": [(11784, 14), (17005, 23.97), (80000, 42), (277825, 42), (277825, 45)],
    }
    t24 = curve_total(inc, TARIFF_2024)
    print("2024 schedule on taxable_income.json (incomes uprated to 2024): %.1f bn as a curve, %.1f bn as steps" % (t24 / 1e9, total(inc, steps(TARIFF_2024)) / 1e9))
    print("  (the budget leaf, wage tax and assessed income tax 2024, is %.1f bn; it is defined differently, so measures transfer only the relative change)" % (TARGET_2024 / 1e9))
    for label, pts in reforms.items():
        r = curve_total(inc, pts) / t24 - 1
        print("  %-104s %+6.2f %%  = %+6.2f bn on the leaf" % (label, r * 100, r * TARGET_2024 / 1e9))
    for label, d, rules in (("as observed in 2022, rules of 2022", earn22, (("pension: 18.6 % up to 84,600", 84600, 18.6), ("health: 15.95 % up to 58,050", 58050, 15.95))),
                            ("gross_earnings.json (uprated to 2024), rules of 2024", earn, (("pension: 18.6 % up to 90,600", 90600, 18.6), ("health: 16.27 % up to 62,100", 62100, 16.27)))):
        n = sum(b["count"] for b in d["bins"]) + d["tail"]["count"]
        wages = excess(d, -1e12) - 1e12 * n
        print("earnings %s: %.3f mn employees, %.1f bn euros gross wages" % (label, n / 1e6, wages / 1e9))
        for name, cap, rate in rules:
            above = excess(d, cap)
            print("  %-30s wages up to the ceiling %.1f bn, contributions %.1f bn; wages above the ceiling %.1f bn (%.1f %% of those below)"
                  % (name, (wages - above) / 1e9, (wages - above) * rate / 1e11, above / 1e9, above / (wages - above) * 100))
    wealth_total = total(w, [(-1e12, 1.0)]) - 1e12 * (sum(b["count"] for b in w["bins"]) + w["tail"]["count"])
    print("net wealth in the distribution: %.3f tn euros" % (wealth_total / 1e12))
    for allowance in (1e6, 2e6, 4e6, 1e7):
        exc = excess(w, allowance)
        print("wealth above %10.0f euros per household: %.3f tn (%.1f %% of all net wealth); 1 %% tax: %.1f bn" % (allowance, exc / 1e12, exc / wealth_total * 100, exc / 1e11))
