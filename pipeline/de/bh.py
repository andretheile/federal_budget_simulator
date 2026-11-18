#!/usr/bin/env python3
"""Drill-down through the federal budget on bundeshaushalt.de (the data behind "Bundeshaushalt digital").

    python3 pipeline/de/bh.py <year> [id] [expenses|income] [actual|target]

    python3 pipeline/de/bh.py 2024                  budget sections (Einzelpläne), actuals
    python3 pipeline/de/bh.py 2024 11               chapters of section 11
    python3 pipeline/de/bh.py 2024 1101             titles of chapter 1101 (e.g. Bürgergeld, housing costs)
    python3 pipeline/de/bh.py 2024 6001 income      tax revenue titles of the federal government

Prints id, amount in million euros and label, largest first. The amounts typed into build_budget.py were read
from these listings. Responses are kept in .cache/bh_<hash of the request>.json and reused; delete a file to
fetch the current data. The endpoint is the one the website itself uses and is not a documented API.
"""
import sys, json, urllib.request, os, hashlib

if len(sys.argv) < 2:
    sys.exit(__doc__)
year = sys.argv[1]
id_ = sys.argv[2] if len(sys.argv) > 2 else ""
account = sys.argv[3] if len(sys.argv) > 3 else "expenses"
quota = sys.argv[4] if len(sys.argv) > 4 else "actual"
url = f"https://www.bundeshaushalt.de/internalapi/budgetData?year={year}&account={account}&quota={quota}&unit=single"
if id_:
    url += f"&id={id_}"
cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
os.makedirs(cache, exist_ok=True)
path = os.path.join(cache, "bh_" + hashlib.md5(url.encode()).hexdigest()[:10] + ".json")
if os.path.exists(path):
    d = json.load(open(path))
else:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (generic-stat-client)"})
    raw = urllib.request.urlopen(req, timeout=60).read()
    open(path, "wb").write(raw)
    d = json.loads(raw)
print("#", url)
print("#", d["meta"].get("modifyDate"), d["detail"].get("label"), "%.3f million" % (d["detail"]["value"] / 1e6))
for c in sorted(d.get("children", []), key=lambda c: -c["value"]):
    print(c["id"], "%.3f" % (c["value"] / 1e6), c["label"][:110], sep="\t")
