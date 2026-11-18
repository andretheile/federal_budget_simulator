#!/usr/bin/env python3
"""Plausibility checks of the two distributions against published totals.

    python3 pipeline/de/check_distributions.py

It integrates tax schedules over the distributions the same way the engine does (src/engine/distribution.ts:
two uniform pieces per bin that preserve count and mean, Pareto tail in closed form) and prints:

  - the 2022 income tax schedule, written as a step function, applied to taxable_income.json. Official tariff
    income tax in the 2022 statistics is 373.3 bn euros; the result should be close to it. The same step
    function is the `baseline` of the measure top_income_tax in countries/de/policies.json. If the income
    distribution is rebuilt for a later year, derive the steps from that year's schedule in the same way and
    update the measure by hand.
  - what raising the two top rates yields in the model, and
  - the wealth above several thresholds in net_wealth.json, to compare with wealth tax studies.
"""
import json, os

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


def schedule_2022():
    """Income tax schedule 2022 (section 32a EStG) as steps of constant marginal rates.
    Zone 1: 10,348 to 14,926 euros, marginal rate rising linearly from 14 % to 23.97 %: two steps.
    Zone 2: 14,927 to 58,596 euros, from 23.97 % to 42 %: six steps. Each step carries the marginal rate at its
    midpoint. Then 42 % up to 277,825 euros and 45 % above."""
    z1 = [(10348 + (14927 - 10348) * k / 2, 0.14 + (0.2397 - 0.14) * (k + 0.5) / 2) for k in range(2)]
    z2 = [(14927 + (58597 - 14927) * k / 6, 0.2397 + (0.42 - 0.2397) * (k + 0.5) / 6) for k in range(6)]
    return [(0, 0.0)] + z1 + z2 + [(58597, 0.42), (277826, 0.45)]


if __name__ == "__main__":
    inc = json.load(open(os.path.join(DIST, "taxable_income.json")))
    w = json.load(open(os.path.join(DIST, "net_wealth.json")))
    base = schedule_2022()
    print("2022 schedule as steps:", [(round(f, 2), round(r, 4)) for f, r in base])
    tb = total(inc, base)
    print("model tariff income tax: %.1f bn euros (official 2022: 373.3 bn)" % (tb / 1e9))
    for top, rich in ((0.45, 0.45), (0.42, 0.48), (0.45, 0.48)):
        ref = base[:-2] + [(58597, top), (277826, rich)]
        tr = total(inc, ref)
        print("top rate %.0f %%, higher rate %.0f %%: model %+.2f bn, i.e. %+.2f %% of the baseline" % (top * 100, rich * 100, (tr - tb) / 1e9, (tr / tb - 1) * 100))
    wealth_total = total(w, [(-1e12, 1.0)]) - 1e12 * (sum(b["count"] for b in w["bins"]) + w["tail"]["count"])
    print("net wealth in the distribution: %.3f tn euros" % (wealth_total / 1e12))
    for allowance in (1e6, 2e6, 4e6, 1e7):
        exc = excess(w, allowance)
        print("wealth above %10.0f euros per household: %.3f tn (%.1f %% of all net wealth); 1 %% tax: %.1f bn" % (allowance, exc / 1e12, exc / wealth_total * 100, exc / 1e11))
