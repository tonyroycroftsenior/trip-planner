import json, urllib.request
pts = {"wainui": (-38.69, 178.07), "stent": (-39.22, 173.78), "manu": (-37.82, 174.81), "taystreet": (-37.65, 176.20), "opunake": (-39.46, 173.86)}
for name, (la, lo) in pts.items():
    u = f"https://api.open-meteo.com/v1/forecast?latitude={la}&longitude={lo}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&timezone=Pacific%2FAuckland&forecast_days=2"
    d = json.load(urllib.request.urlopen(u))["hourly"]
    for t in ["2026-11-10T09:00", "2026-11-10T15:00", "2026-11-10T18:00", "2026-11-11T00:00"]:
        i = d["time"].index(t); print(name, t, "kn", d["wind_speed_10m"][i], "dir", d["wind_direction_10m"][i], "gust", d["wind_gusts_10m"][i])
