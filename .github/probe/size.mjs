import fs from "fs";
const src = fs.readFileSync("index.html", "utf8");
const TZ = "Pacific/Auckland";
function grab(name) { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); } } }
const code = ["seaPoint","circMean","ensembleMerge","angDiff","clamp","trainFt","surfFt","ftBounds","ftRange"].map(grab).join("\n") +
  "\n" + src.match(/var WAVE_MODELS = [^;]+;/)[0] + "\n" + src.match(/var SIZE_A = [^;]+;/)[0] + "\nreturn {seaPoint,ensembleMerge,surfFt,ftRange,WAVE_MODELS};";
const L = new Function(code)();
const SPOTS = [{ id: "taystreet", lat: -37.650, lon: 176.200, offshore: 225, exp: 0.9 }];
const H = "swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,wave_period,wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction";
for (const s of SPOTS) {
  const p = L.seaPoint(s, 6);
  const u = "https://marine-api.open-meteo.com/v1/marine?latitude=" + p.lat + "&longitude=" + p.lon + "&hourly=" + H + "&models=" + L.WAVE_MODELS.join(",") + "&timezone=" + TZ + "&forecast_days=1";
  let raw; for (let k = 0; k < 3; k++) { try { const c = new AbortController(); setTimeout(() => c.abort(), 15000); raw = await (await fetch(u, { signal: c.signal })).json(); break; } catch (e) {} }
  const h = L.ensembleMerge(raw).hourly;
  for (let i = 4; i <= 19; i++) { const c = { sh: h.swell_wave_height[i], sp: h.swell_wave_period[i], sd: h.swell_wave_direction[i], wwh: h.wind_wave_height[i], wwp: h.wind_wave_period[i], wwd: h.wind_wave_direction[i], wh: h.wave_height[i], wp: h.wave_period[i], wd: h.wave_direction[i] };
    const ft = L.surfFt(s, c); console.log("ROW", h.time[i].slice(11, 16), "tot", c.wh, "sw", c.sh, c.sp, c.sd, "ww", c.wwh, c.wwp, c.wwd, "ft", ft.toFixed(2), L.ftRange(ft)); }
}
const hb = await (await fetch("https://raw.githubusercontent.com/" + process.env.GITHUB_REPOSITORY + "/harbour-data/harbour.json?t=" + Date.now())).json();
hb.readings.filter(r => r.t.slice(0,10) === new Date().toLocaleDateString("en-CA", { timeZone: TZ })).filter((r, i) => i % 5 == 0).forEach(r => console.log("BUOY", r.t, "sig", r.wave_sig, "max", r.wave_max, "per", r.wave_per, "tug", r.tug_wind, r.tug_dir));
