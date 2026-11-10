"""Fetch Swellmap forecasts for the app's spots (personal use) and save them encrypted.

Only the phone with the private key can read swellmap.enc.json; the public key is in swellmap-key.json.
Runs a few times a day, one page per spot, with a pause between requests.
"""
import base64, json, os, re, time, urllib.request
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
html_src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
spots = re.findall(r'\{ id: "([a-z]+)",[^}]*?sm: "(https://www\.swellmap\.com/[^"]+)"', html_src)
# Spots without a known page: try likely Swellmap names and keep the first that has a forecast
TRY = {"mount": ["mount-maunganui", "mount-maunganui-main-beach", "mt-maunganui"], "taystreet": ["tay-street", "mount-maunganui"],
       "opoutere": ["opoutere", "opoutere-beach"], "ngarunui": ["ngarunui-beach", "ngarunui", "raglan-beach"],
       "kumera": ["kumera-patch", "kumara-patch"], "makorori": ["makorori", "makorori-beach", "makorori-point"],
       "opoutama": ["opoutama", "opoutama-beach", "mahia-beach"]}
known = {sid for sid, _ in spots}
for sid, slugs in TRY.items():
    if sid not in known:
        spots += [(sid, "https://www.swellmap.com/surf-forecasts/new-zealand/" + sl) for sl in slugs]
print("Spots to fetch:", sorted({s for s, _ in spots}))

KEEP = ["time", "wave", "swell", "period", "swell_dir", "sea_dir", "set_face", "rating", "wind_sp", "wind_dir", "wind_gust", "tide", "sunrise", "sunset"]
out = {"fetchedAt": int(time.time() * 1000), "spots": {}}
for sid, url in spots:
    if sid in out["spots"]:
        continue
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Days Offshore personal surf planner)"})
        page = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
        m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
        fd = json.loads(m.group(1))["props"]["pageProps"]["initialState"]["forecast"]["forecastData"]
        if not fd or not fd.get("time"):
            raise ValueError("no forecast on page")
        out["spots"][sid] = {k: fd.get(k) for k in KEEP}
        out["spots"][sid]["page"] = url
        print("OK", sid, len(fd.get("time") or []), "steps; first wave", (fd.get("wave") or [None])[0], "wind", (fd.get("wind_sp") or [None])[0], "rating", (fd.get("rating") or [None])[0])
    except Exception as e:
        print("FAILED", sid, url, e)
    time.sleep(4)

if not out["spots"]:
    raise SystemExit("No spots fetched; leaving the previous file in place.")

pub = json.load(open(os.path.join(ROOT, "swellmap-key.json")))
dec = lambda s: int.from_bytes(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)), "big")
recipient = ec.EllipticCurvePublicNumbers(dec(pub["x"]), dec(pub["y"]), ec.SECP256R1()).public_key()
eph = ec.generate_private_key(ec.SECP256R1())
shared = eph.exchange(ec.ECDH(), recipient)
key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"days-offshore", info=b"swellmap").derive(shared)
iv = os.urandom(12)
ct = AESGCM(key).encrypt(iv, json.dumps(out, separators=(",", ":")).encode(), None)
en = lambda i: base64.urlsafe_b64encode(i.to_bytes(32, "big")).rstrip(b"=").decode()
pn = eph.public_key().public_numbers()
json.dump({"v": 1, "epk": {"x": en(pn.x), "y": en(pn.y)}, "iv": base64.b64encode(iv).decode(), "ct": base64.b64encode(ct).decode()},
          open(os.path.join(ROOT, "swellmap.enc.json"), "w"))
print("Saved", len(out["spots"]), "spots")
