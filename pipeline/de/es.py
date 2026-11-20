#!/usr/bin/env python3
"""Small Eurostat fetcher (dissemination API, JSON-stat). Prints a flat table of all non-empty values.

    python3 pipeline/de/es.py <dataset> key=val[,val] ...
    python3 pipeline/de/es.py gov_10a_exp geo=DE unit=MIO_EUR sector=S13 na_item=TE time=2024

Responses are kept in .cache/<dataset>_<hash of the request>.json and reused, so a cached request always
returns the vintage that was downloaded first. Delete the file to fetch the current vintage.
"""
import sys, json, urllib.request, urllib.parse, os, hashlib

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")


def fetch(dataset, params):
    q = [("format", "JSON"), ("lang", "en")]
    for k, v in params.items():
        for x in v.split(","):
            q.append((k, x))
    url = BASE + dataset + "?" + urllib.parse.urlencode(q)
    h = hashlib.md5(url.encode()).hexdigest()[:12]
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{dataset}_{h}.json")
    if os.path.exists(path):
        return json.load(open(path)), url
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (generic-stat-client)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    open(path, "wb").write(data)
    return json.loads(data), url


def table(d):
    ids = d["id"]
    sizes = d["size"]
    cats = []
    for i in ids:
        idx = d["dimension"][i]["category"]["index"]
        inv = sorted(idx, key=lambda k: idx[k])
        cats.append(inv)
    vals = d["value"]
    rows = []
    mult = [1] * len(sizes)
    for i in range(len(sizes) - 2, -1, -1):
        mult[i] = mult[i + 1] * sizes[i + 1]
    for k, v in vals.items():
        k = int(k)
        coords = []
        for i in range(len(sizes)):
            coords.append(cats[i][(k // mult[i]) % sizes[i]])
        rows.append((dict(zip(ids, coords)), v))
    return rows


def labels(d, dim):
    return d["dimension"][dim]["category"].get("label", {})


def lines(dataset, params):
    """The table as text lines: two comment lines (request URL, last update), then one tab-separated row per value
    with the varying dimensions, the value and the labels of those dimensions."""
    d, url = fetch(dataset, params)
    out = ["# " + url, "# updated " + str(d.get("updated"))]
    rows = table(d)
    vary = [i for i, s in zip(d["id"], d["size"]) if s > 1]
    lab = {dim: labels(d, dim) for dim in vary}
    rows.sort(key=lambda r: [r[0][x] for x in vary])
    for c, v in rows:
        out.append("\t".join(["\t".join(f"{c[x]}" for x in vary), str(v), "\t".join(lab[x].get(c[x], "")[:70] for x in vary if x != "time")]))
    return out


if __name__ == "__main__":
    params = dict(a.split("=", 1) for a in sys.argv[2:] if "=" in a and not a.startswith("--"))
    print("\n".join(lines(sys.argv[1], params)))
