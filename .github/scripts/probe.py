import urllib.request, re
for url in ["https://www.swellmap.com/surf-forecasts/new-zealand/manu-bay", "https://www.swellmap.com/surfing/new-zealand/wainui-beach"]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (personal surf planner)"})
    try:
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    except Exception as e:
        print("ERR", url, e); continue
    print("==", url, len(html), "bytes")
    print("scripts:", re.findall(r'<script[^>]+src="([^"]+)"', html)[:15])
    print("json-ish urls:", sorted(set(re.findall(r'["\'](/[^"\']*(?:api|json|forecast|data)[^"\']*)["\']', html)))[:30])
    for kw in ["__NEXT_DATA__", "window.__", "var forecast", "swell", "rating", "Hs", "wave"]:
        i = html.find(kw); print(kw, i, html[max(0,i-150):i+250].replace("\n"," ") if i >= 0 else "")
