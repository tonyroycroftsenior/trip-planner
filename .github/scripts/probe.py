import urllib.request, re, json
url = "https://www.swellmap.com/surf-forecasts/new-zealand/manu-bay"
html = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (personal surf planner)"}), timeout=30).read().decode("utf-8", "replace")
m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
d = json.loads(m.group(1))
def walk(o, path="", depth=0):
    if depth > 6: return
    if isinstance(o, dict):
        for k, v in o.items():
            t = type(v).__name__
            extra = (" len=%d" % len(v)) if isinstance(v, (list, dict, str)) else ""
            sample = repr(v)[:120] if not isinstance(v, (dict, list)) else (repr(v[0])[:160] if isinstance(v, list) and v else "")
            print("  " * depth + path + "." + k, t + extra, sample)
            if k not in ("navigation",): walk(v, path + "." + k, depth + 1)
    elif isinstance(o, list) and o and isinstance(o[0], (dict, list)):
        walk(o[0], path + "[0]", depth + 1)
walk(d["props"]["pageProps"])
print("buildId", d.get("buildId"), "page", d.get("page"), "query", d.get("query"))
chunk = re.search(r'(/_next/static/chunks/pages/%5BforecastType%5D[^"]+\.js)', html).group(1)
js = urllib.request.urlopen("https://www.swellmap.com" + chunk.replace("%5B","%5B"), timeout=30).read().decode("utf-8", "replace")
print("chunk size", len(js))
print(sorted(set(re.findall(r'["`](https?://[^"`]{5,120}|/api/[^"`]{1,120})["`]', js)))[:40])
