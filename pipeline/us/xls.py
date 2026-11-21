"""Minimal stdlib reader for BIFF8 .xls (OLE2 compound file) workbooks: the IRS Statistics of Income tables are
published only in this old Excel format.

Usage: from xls import XLS; b = XLS(path); b.sheets -> list of names;
b.cells(sheet) -> dict {(row, col): value}; b.rows(sheet) -> list of (row, [values]).
Reads SST strings, LABELSST, LABEL, NUMBER, RK, MULRK, FORMULA cached numbers/strings.
"""
import struct

ENDOFCHAIN = 0xFFFFFFFE
FREESECT = 0xFFFFFFFF


def _ole_stream(data, names=("Workbook", "Book")):
    if data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ValueError("not an OLE2 file")
    sec_shift, mini_shift = struct.unpack_from("<HH", data, 30)
    ssz = 1 << sec_shift
    msz = 1 << mini_shift
    n_fat, dir_start = struct.unpack_from("<II", data, 44)
    mini_cutoff, mini_fat_start, n_mini_fat, difat_start, n_difat = struct.unpack_from("<IIIII", data, 56)

    def sec(i):
        off = 512 + i * ssz
        return data[off:off + ssz]

    difat = list(struct.unpack_from("<109I", data, 76))
    d = difat_start
    for _ in range(n_difat):
        if d in (ENDOFCHAIN, FREESECT):
            break
        vals = struct.unpack("<%dI" % (ssz // 4), sec(d))
        difat.extend(vals[:-1])
        d = vals[-1]
    fat = []
    for s in difat[:n_fat]:
        if s in (ENDOFCHAIN, FREESECT):
            continue
        fat.extend(struct.unpack("<%dI" % (ssz // 4), sec(s)))

    def chain(start):
        out, s, seen = [], start, set()
        while s not in (ENDOFCHAIN, FREESECT) and s < len(fat) and s not in seen:
            seen.add(s)
            out.append(s)
            s = fat[s]
        return out

    dirdata = b"".join(sec(s) for s in chain(dir_start))
    entries = []
    for i in range(len(dirdata) // 128):
        e = dirdata[i * 128:(i + 1) * 128]
        nlen = struct.unpack_from("<H", e, 64)[0]
        name = e[:max(nlen - 2, 0)].decode("utf-16-le", "replace")
        etype = e[66]
        start, size = struct.unpack_from("<II", e, 116)
        entries.append((name, etype, start, size))
    root = entries[0]
    ministream = b"".join(sec(s) for s in chain(root[2]))
    minifat = []
    for s in chain(mini_fat_start):
        minifat.extend(struct.unpack("<%dI" % (ssz // 4), sec(s)))
    for name, etype, start, size in entries:
        if etype == 2 and name in names:
            if size < mini_cutoff:
                out, s = [], start
                while s not in (ENDOFCHAIN, FREESECT) and s < len(minifat):
                    out.append(ministream[s * msz:(s + 1) * msz])
                    s = minifat[s]
                return b"".join(out)[:size]
            return b"".join(sec(s) for s in chain(start))[:size]
    raise ValueError("no Workbook stream")


def _records(stream):
    pos = 0
    n = len(stream)
    while pos + 4 <= n:
        rid, ln = struct.unpack_from("<HH", stream, pos)
        yield pos, rid, stream[pos + 4:pos + 4 + ln]
        pos += 4 + ln


class _Seg:
    """Reader over an SST record plus its CONTINUE records."""

    def __init__(self, segs):
        self.segs = segs
        self.i = 0
        self.p = 0

    def _ensure(self):
        while self.p >= len(self.segs[self.i]) and self.i + 1 < len(self.segs):
            self.i += 1
            self.p = 0

    def read(self, n):
        out = b""
        while n > 0:
            self._ensure()
            seg = self.segs[self.i]
            take = min(n, len(seg) - self.p)
            if take <= 0:
                break
            out += seg[self.p:self.p + take]
            self.p += take
            n -= take
        return out

    def chars(self, cch, high):
        out = []
        while cch > 0:
            if self.p >= len(self.segs[self.i]):
                # string continues in next CONTINUE record: new option byte
                self.i += 1
                self.p = 0
                high = self.segs[self.i][0] & 1
                self.p = 1
            seg = self.segs[self.i]
            avail = len(seg) - self.p
            if high:
                take = min(cch, avail // 2)
                out.append(seg[self.p:self.p + 2 * take].decode("utf-16-le", "replace"))
                self.p += 2 * take
            else:
                take = min(cch, avail)
                out.append(seg[self.p:self.p + take].decode("latin-1"))
                self.p += take
            cch -= take
        return "".join(out)


def _unicode_str(b, off, lenbytes=2):
    if lenbytes == 2:
        cch = struct.unpack_from("<H", b, off)[0]
    else:
        cch = b[off]
    off += lenbytes
    flags = b[off]
    off += 1
    rich = flags & 8
    ext = flags & 4
    if rich:
        off += 2
    if ext:
        off += 4
    if flags & 1:
        return b[off:off + 2 * cch].decode("utf-16-le", "replace")
    return b[off:off + cch].decode("latin-1")


def _rk(v):
    if v & 2:
        x = float(v >> 2) if not (v & 0x80000000) else float((v >> 2) - (1 << 30))
    else:
        x = struct.unpack("<d", struct.pack("<Q", (v & 0xFFFFFFFC) << 32))[0]
    if v & 1:
        x /= 100.0
    return x


class XLS:
    def __init__(self, path):
        data = open(path, "rb").read()
        self.stream = _ole_stream(data)
        self.sst = []
        self._sheets = []  # (name, offset)
        recs = list(_records(self.stream))
        i = 0
        while i < len(recs):
            pos, rid, body = recs[i]
            if rid == 0x0085:
                off = struct.unpack_from("<I", body, 0)[0]
                name = _unicode_str(body, 6, lenbytes=1)
                self._sheets.append((name, off))
            elif rid == 0x00FC:
                segs = [body]
                j = i + 1
                while j < len(recs) and recs[j][1] == 0x003C:
                    segs.append(recs[j][2])
                    j += 1
                self._parse_sst(segs)
                i = j - 1
            elif rid == 0x000A:
                break
            i += 1

    @property
    def sheets(self):
        return [n for n, _ in self._sheets]

    def _parse_sst(self, segs):
        r = _Seg(segs)
        total, uniq = struct.unpack("<II", r.read(8))
        for _ in range(uniq):
            cch = struct.unpack("<H", r.read(2))[0]
            flags = r.read(1)[0]
            nrun = struct.unpack("<H", r.read(2))[0] if flags & 8 else 0
            next_ = struct.unpack("<I", r.read(4))[0] if flags & 4 else 0
            s = r.chars(cch, flags & 1)
            if nrun:
                r.read(4 * nrun)
            if next_:
                r.read(next_)
            self.sst.append(s)

    def cells(self, sheet):
        idx = self.sheets.index(sheet) if isinstance(sheet, str) else sheet
        off = self._sheets[idx][1]
        out = {}
        last_formula = None
        for pos, rid, body in _records(self.stream[off:]):
            if rid == 0x000A:
                break
            if rid == 0x00FD:
                r, c, _, k = struct.unpack_from("<HHHI", body)
                out[(r, c)] = self.sst[k]
            elif rid == 0x0203:
                r, c, _ = struct.unpack_from("<HHH", body)
                out[(r, c)] = struct.unpack_from("<d", body, 6)[0]
            elif rid == 0x027E:
                r, c, _, v = struct.unpack_from("<HHHI", body)
                out[(r, c)] = _rk(v)
            elif rid == 0x00BD:
                r, c0 = struct.unpack_from("<HH", body)
                n = (len(body) - 6) // 6
                for k in range(n):
                    _, v = struct.unpack_from("<HI", body, 4 + 6 * k)
                    out[(r, c0 + k)] = _rk(v)
            elif rid == 0x0204:
                r, c, _ = struct.unpack_from("<HHH", body)
                out[(r, c)] = _unicode_str(body, 6)
            elif rid == 0x0006:
                r, c, _ = struct.unpack_from("<HHH", body)
                res = body[6:14]
                if res[6:8] == b"\xff\xff":
                    if res[0] == 0:
                        last_formula = (r, c)  # string follows in STRING record
                    elif res[0] == 1:
                        out[(r, c)] = bool(res[2])
                    else:
                        out[(r, c)] = None
                else:
                    out[(r, c)] = struct.unpack("<d", res)[0]
            elif rid == 0x0207 and last_formula:
                out[last_formula] = _unicode_str(body, 0)
                last_formula = None
        return out

    def rows(self, sheet):
        cells = self.cells(sheet)
        if not cells:
            return []
        maxc = max(c for _, c in cells)
        rows = sorted({r for r, _ in cells})
        return [(r, [cells.get((r, c)) for c in range(maxc + 1)]) for r in rows]
