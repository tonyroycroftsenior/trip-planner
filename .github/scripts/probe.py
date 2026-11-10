import json, urllib.request
url = ("https://marine-api.open-meteo.com/v1/marine?latitude=-37.60,-38.75&longitude=176.22,178.12"
       "&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,"
       "wind_wave_height,wind_wave_period,wind_wave_direction,sea_level_height_msl,sea_surface_temperature"
       "&models=meteofrance_wave,ecmwf_wam,ncep_gfswave025,dwd_gwam&forecast_days=14&timezone=Pacific%2FAuckland")
try:
    d = json.load(urllib.request.urlopen(url))
except Exception as e:
    print("ERROR", e, getattr(e, "read", lambda: b"")()[:300]); raise SystemExit
d = d if isinstance(d, list) else [d]
for x in d:
    h = x.get("hourly", {}); print(len(h.get("time", [])), "hours")
    for k in sorted(h):
        if k == "time": continue
        v = h[k]; nn = [i for i, a in enumerate(v) if a is not None]
        print(k, "nonnull", len(nn), "last", nn[-1] if nn else None, "sample", v[12])
