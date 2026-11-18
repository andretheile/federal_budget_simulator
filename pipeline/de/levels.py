"""Level shares for expenditure leaves: which level of government bears a spending item.

Input: .cache/exp_2024_full.tsv (Eurostat gov_10a_exp, Germany 2024). Eurostat publishes general government
(S13) by COFOG group, but the four subsectors only by COFOG division, and subsector figures include payments
to other levels of government. The method, also described in the methodology text of country.json:

 1. own[d][s] = TE - D7 - D9 per division d and subsector s: spending without current and capital transfers.
    Official data. Summed over subsectors this equals the same expression for S13.
 2. The consolidated transfers of S13 (D7 + D9 per division) go to recipients outside government. Eurostat does
    not say which level pays them, so they are assigned with the payer weights EXT below. JUDGEMENT, guided by
    what the large items are (EU contribution, development aid, hospital investment grants, day-care providers)
    and checked against the economy-wide split of such transfers in gov_10a_main.
 3. Within a division, leaves with a known final spender are fixed (build_budget.py: fixed=...). The other
    leaves start from seed weights (build_budget.py: seed=..., JUDGEMENT based on who is responsible for the
    task) and are fitted to the division totals from steps 1 and 2 by iterative proportional fitting.
 4. Earmarked transfers between levels are then moved to the payer (build_budget.py, federal budget actuals).
"""
import collections, os

B = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
SECS = ["S1311", "S1312", "S1313", "S1314"]
LV = ["central", "state", "local", "social_security"]


def load_exp():
    M = collections.defaultdict(dict)
    for l in open(os.path.join(B, "exp_2024_full.tsv")):
        if l.startswith("#"):
            continue
        r = l.rstrip("\n").split("\t")
        M[(r[1], r[0])][r[2]] = float(r[3])
    return M


# payer weights for consolidated transfers to non-government units, per division (central, state, local, ss)
EXT = {
    "GF01": (0.85, 0.13, 0.02, 0.0),
    "GF02": (1.0, 0.0, 0.0, 0.0),
    "GF03": (0.12, 0.73, 0.15, 0.0),
    "GF04": (0.56, 0.175, 0.26, 0.005),
    "GF05": (0.48, 0.395, 0.125, 0.0),
    "GF06": (0.13, 0.72, 0.15, 0.0),
    "GF07": (0.06, 0.82, 0.10, 0.02),
    "GF08": (0.31, 0.435, 0.255, 0.0),
    "GF09": (0.075, 0.455, 0.47, 0.0),
    "GF10": (0.10, 0.31, 0.58, 0.01),
}


def division_targets(M):
    """F[d] = final spending by level incl. assigned external transfers; scaled to the S13 total."""
    F = {}
    for d in EXT:
        own = [M[(d, s)].get("TE", 0) - M[(d, s)].get("D7", 0) - M[(d, s)].get("D9", 0) for s in SECS]
        ext = M[(d, "S13")].get("D7", 0) + M[(d, "S13")].get("D9", 0)
        f = [o + ext * w for o, w in zip(own, EXT[d])]
        tot = M[(d, "S13")]["TE"]
        k = tot / sum(f)  # removes the small consolidation difference (interest between levels)
        F[d] = [x * k for x in f]
    return F


def ipf(rows, targets, iters=500):
    """rows: list of (amount, seed[4]); targets[4]. Returns matrix of amounts per level."""
    X = []
    for amt, seed in rows:
        s = sum(seed)
        X.append([amt * w / s for w in seed])
    for _ in range(iters):
        for j in range(4):
            col = sum(x[j] for x in X)
            if col > 0:
                f = targets[j] / col
                for x in X:
                    x[j] *= f
        for i, (amt, _) in enumerate(rows):
            r = sum(X[i])
            if r > 0:
                f = amt / r
                X[i] = [v * f for v in X[i]]
    return X
