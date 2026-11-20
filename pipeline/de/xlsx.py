#!/usr/bin/env python3
"""Minimal xlsx reader (stdlib only). Usage:
  xlsx.py file.xlsx                 -> list sheets
  xlsx.py file.xlsx SHEET [grep]    -> dump rows as TSV (optionally only rows matching regex)
"""
import sys, zipfile, re
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def col2num(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


class X:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.ss = []
        if "xl/sharedStrings.xml" in self.z.namelist():
            root = ET.fromstring(self.z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                self.ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
        wb = ET.fromstring(self.z.read("xl/workbook.xml"))
        rels = ET.fromstring(self.z.read("xl/_rels/workbook.xml.rels"))
        rid = {r.get("Id"): r.get("Target") for r in rels}
        self.sheets = {}
        for s in wb.find("m:sheets", NS):
            t = rid[s.get("{%s}id" % NS["r"])]
            t = t.lstrip("/")
            if not t.startswith("xl/"):
                t = "xl/" + t
            self.sheets[s.get("name")] = t

    def rows(self, name):
        root = ET.fromstring(self.z.read(self.sheets[name]))
        for row in root.iter("{%s}row" % NS["m"]):
            out = {}
            for c in row.findall("m:c", NS):
                ref = c.get("r")
                col = col2num(re.match(r"[A-Z]+", ref).group())
                t = c.get("t")
                v = c.find("m:v", NS)
                if t == "s" and v is not None:
                    val = self.ss[int(v.text)]
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                else:
                    val = v.text if v is not None else ""
                out[col] = val
            if out:
                mx = max(out)
                yield int(row.get("r")), [out.get(i, "") for i in range(1, mx + 1)]


if __name__ == "__main__":
    x = X(sys.argv[1])
    if len(sys.argv) == 2:
        for n in x.sheets:
            print(n)
    else:
        pat = re.compile(sys.argv[3], re.I) if len(sys.argv) > 3 else None
        for i, r in x.rows(sys.argv[2]):
            line = "\t".join(str(v).replace("\n", " ") for v in r)
            if pat is None or pat.search(line):
                print(i, line, sep="\t")
