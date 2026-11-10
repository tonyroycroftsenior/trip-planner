#!/usr/bin/env python3
"""Read the live numbers off the Port of Tauranga harbour conditions picture.

The port publishes its live readings (wind, waves, temperatures) only as text drawn on a picture,
refreshed about every three minutes. The text is always in the same place and the same typeface,
so each value is cropped from its fixed spot and every digit is matched against a stored picture
of that digit. A digit that does not match clearly is left out rather than guessed.

Usage: harbour-read.py IMAGE "LAST-MODIFIED"            prints one reading as JSON
       harbour-read.py IMAGE "LAST-MODIFIED" HISTORY    also adds it to the HISTORY json file (rolling 24 hours)

LAST-MODIFIED is the picture's Last-Modified header, e.g. "Tue, 10 Nov 2026 21:09:02 GMT": the time the port
last redrew it, which is the time of the readings.
"""
import json, sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo
import numpy as np
from PIL import Image, ImageFilter

SIZE = (1016, 646)
# (left, top, right, bottom) of each value in the picture
BOXES = {
    "wave_max": (738, 37, 806, 60),     # A-Beacon wave buoy
    "wave_sig": (738, 62, 806, 84),
    "wave_per": (738, 87, 806, 109),
    "ab_wind":  (888, 37, 962, 60),     # A-Beacon wind
    "ab_gust":  (888, 62, 962, 84),
    "ab_dir":   (888, 87, 962, 109),
    "tug_wind": (803, 209, 882, 232),   # Tug Berth wind (Pilot Bay side of the Mount)
    "tug_gust": (803, 233, 882, 256),
    "tug_dir":  (798, 258, 882, 281),
    "air":      (196, 62, 292, 84),
    "water":    (196, 246, 292, 268),
}
H = 10                                   # digit height in pixels
THR = 0.38

# One picture per character, 10 rows each, brightness 0-9
TEMPLATES = {
    '.': ['00', '00', '00', '00', '00', '00', '00', '00', '78', '78'],
    '0': ['01798850', '07840781', '18400096', '58000088', '58000088', '58000078', '58000088', '18500195', '17931781', '01789850'],
    '1': ['0178000', '1688100', '5558100', '0048100', '0048000', '0048000', '0048000', '0048000', '0159111', '8889887'],
    '2': ['14888851', '17711694', '03100186', '00000085', '00000771', '00007610', '00587100', '05861000', '18711111', '58998886'],
    '3': ['05899860', '08700694', '03000085', '00000780', '00078730', '00000573', '00000087', '05000087', '48600695', '05888950'],
    '4': ['00005960', '00109971', '00088860', '00380860', '00530860', '05400860', '67000860', '88999999', '00000870', '00000870'],
    '5': ['8999980', '9600000', '8600000', '9600000', '7678640', '6600584', '1000077', '4000087', '6700684', '3788850'],
    '6': ['00589860', '05860693', '08700050', '18300000', '26344450', '37400185', '06300087', '08400087', '06840595', '00698860'],
    '7': ['58989897', '00000195', '00001871', '00005900', '00008600', '00059000', '00077000', '00086000', '00494000', '10681000'],
    '8': ['04888850', '18700684', '08500086', '07700354', '00833420', '06600262', '58000057', '57000077', '19700686', '03887860'],
    '9': ['04866740', '18700581', '48400086', '48400087', '08600477', '03755467', '00000086', '03000385', '08814881', '04788700'],
}

T = {ch: np.array([[int(c) / 9 for c in row] for row in rows], dtype="float32") for ch, rows in TEMPLATES.items()}


def ink(im, box):
    """0..1 'text-ness' per pixel: brightness above the local background, yellow-ish pixels only
    (the values are drawn in yellow; white cloud and blue sea drop out)."""
    a = np.asarray(im.crop(box)).astype("float32")
    L = (a[..., 0] + a[..., 1]) / 2
    bg = np.asarray(Image.fromarray(L.astype("uint8")).filter(ImageFilter.MedianFilter(9))).astype("float32")
    yel = np.minimum(a[..., 0], a[..., 1]) - a[..., 2]
    near = np.asarray(Image.fromarray(np.clip(yel + 128, 0, 255).astype("uint8")).filter(ImageFilter.MaxFilter(3))).astype("float32") - 128
    t = np.clip(L - bg, 0, None)
    t[near < -10] = 0
    top = np.percentile(t, 99.5)
    return np.clip(t / top, 0, 1) if top > 25 else np.zeros_like(t)


def ncc(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 1e-6 else -1.0


def band(t, x0=0):
    """Top row of the 10-row band holding the number (uses only the number's own columns, not the unit's)."""
    cols = (t > THR).sum(axis=0) > 1
    xs = [x for x in np.where(cols)[0] if x >= x0]
    if not xs:
        return None
    a = b = xs[0]; gap = 0
    for x in range(a, t.shape[1]):
        if cols[x]: b = x + 1; gap = 0
        else:
            gap += 1
            if gap >= 4: break
    rs = (t[:, a:b] > THR).sum(axis=1).astype(float)
    return max(range(0, t.shape[0] - H + 1), key=lambda r: (rs[r:r + H].sum(), -r))


def read_number(t, chars="0123456789", stop_gap=4):
    """Read characters left to right from an ink strip until a gap of `stop_gap` columns (the space
    before the unit). Returns the text, or None when any character is unclear."""
    r0 = band(t)
    if r0 is None:
        return None
    W = t.shape[1]
    tp = np.pad(t, ((2, 2), (2, 12)))
    s = t[r0:r0 + H]
    cols = (s > THR).sum(axis=0) > 0
    x = 0; out = ""
    while x < W and not cols[x]: x += 1
    while x < W:
        e = x
        while e < W and cols[e]: e += 1
        is_point = e - x <= 3 and not (s[:6, x:e] > THR).any()
        if is_point:
            if not out or out[-1] == ".": return None
            out += "."; x = e
        else:
            cand = []
            for ch in chars:
                tm = T[ch]; w = tm.shape[1]
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        cand.append((ncc(tp[2 + r0 + dy:2 + r0 + dy + H, 2 + x + dx:2 + x + dx + w], tm), ch, w, dx))
            cand.sort(reverse=True)
            sc, ch, w, dx = cand[0]
            second = max([c[0] for c in cand if c[1] != ch] or [-1])
            if sc < 0.75 or sc - second < 0.1:
                if not out and e - x <= 3:      # a speck before the number
                    x = e
                    while x < W and not cols[x]: x += 1
                    continue
                return None
            out += ch; x = x + dx + w
        g = max(x, 0)
        while g < W and not cols[g]: g += 1
        if g >= W or g - x >= stop_gap: break
        x = g
    if not out or out.endswith(".") or out.count(".") > 1:
        return None
    return out


# Believable ranges; anything outside is dropped rather than logged as a wrong number
LIMITS = {"wave_max": (0, 15), "wave_sig": (0, 10), "wave_per": (1, 25), "ab_wind": (0, 90), "ab_gust": (0, 120),
          "ab_dir": (0, 360), "tug_wind": (0, 90), "tug_gust": (0, 120), "tug_dir": (0, 360), "air": (-5, 45), "water": (5, 30)}
WHOLE = ("ab_wind", "ab_gust", "ab_dir", "tug_wind", "tug_gust", "tug_dir")


def clean(r):
    for k, (lo, hi) in LIMITS.items():
        v = r.get(k)
        if v is not None and not (lo <= v <= hi):
            r[k] = None
    for w, g in (("ab_wind", "ab_gust"), ("tug_wind", "tug_gust")):
        if r.get(w) is not None and r.get(g) is not None and r[g] < r[w]:
            r[w] = r[g] = None
    if r.get("wave_sig") is not None and r.get("wave_max") is not None and r["wave_max"] < r["wave_sig"]:
        r["wave_sig"] = r["wave_max"] = None
    for k in WHOLE:
        if r.get(k) is not None:
            r[k] = int(r[k])
    return r


def read(path, stamp=None):
    im = Image.open(path).convert("RGB")
    if im.size != SIZE:
        raise SystemExit("unexpected picture size %s: the layout may have changed" % (im.size,))
    raw = {k: read_number(ink(im, b)) for k, b in BOXES.items()}
    out = {"t": stamp}
    for k, v in raw.items():
        out[k] = float(v) if v is not None else None
        if k in WHOLE and v is not None and "." in v:
            out[k] = None
    return clean(out), raw


def local_stamp(http_date):
    """Last-Modified header -> New Zealand local time, e.g. 2026-11-11T10:09"""
    return parsedate_to_datetime(http_date).astimezone(ZoneInfo("Pacific/Auckland")).strftime("%Y-%m-%dT%H:%M")


if __name__ == "__main__":
    reading, raw = read(sys.argv[1], local_stamp(sys.argv[2]))
    print(json.dumps({"reading": reading, "raw": raw}))
    unread = [k for k, v in raw.items() if v is None]
    if len(unread) > 6:
        raise SystemExit("could not read most values (%s): the picture layout may have changed" % ", ".join(unread))
    if len(sys.argv) > 3:
        try:
            rows = json.load(open(sys.argv[3])).get("readings", [])
        except Exception:
            rows = []
        rows = [r for r in rows if r.get("t") != reading["t"]] + [reading]
        rows.sort(key=lambda r: r["t"])
        rows = rows[-480:]      # 24 hours at one reading every three minutes
        json.dump({"source": "Port of Tauranga harbour conditions, port-tauranga.co.nz", "tz": "Pacific/Auckland",
                   "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "readings": rows},
                  open(sys.argv[3], "w"), separators=(",", ":"))
