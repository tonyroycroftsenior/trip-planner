// Daily surf alert for Days Offshore.
// Reads the spot list from index.html, pulls the Open-Meteo forecast, and opens a GitHub issue
// (which sends a GitHub app notification) for each new run of 2+ good days in a region.
// Good day: at least 4 straight daylight hours (5am-8pm) with swell >= 0.5 m and offshore or light (<= 5 kt) wind.
import { readFileSync } from "node:fs";

const TZ = "Pacific/Auckland";
const DAYS = 8;
const APP_URL = "https://tonyroycroftsenior.github.io/trip-planner/";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const listText = html.match(/var SPOTS_DEFAULT = (\[[\s\S]*?\n  \]);/)[1];
const SPOTS = new Function("return " + listText)();
const REGIONS = new Function("return " + html.match(/var REGIONS = (\[[^\]]*\]);/)[1])();
const CFG = Object.assign({ minSwell: 0.5, minHours: 4, countLightWind: true, minDays: 2, startHour: 5, endHour: 20, regions: REGIONS },
  JSON.parse(readFileSync(new URL("../../alerts.json", import.meta.url), "utf8")));
console.log("Alert settings:", JSON.stringify(CFG));

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function seaPoint(s, km) {
  const f = ((s.offshore + 180) % 360) * Math.PI / 180;
  return { lat: +(s.lat + (km / 111) * Math.cos(f)).toFixed(3), lon: +(s.lon + (km / (111 * Math.cos(s.lat * Math.PI / 180))) * Math.sin(f)).toFixed(3) };
}
async function getPoints(base, params, pts) {
  const q = new URLSearchParams({ ...params, latitude: pts.map(p => p.lat).join(","), longitude: pts.map(p => p.lon).join(",") });
  const r = await fetch(base + "?" + q);
  if (!r.ok) throw new Error(base + " " + r.status + " " + (await r.text()).slice(0, 200));
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}
const hasSwell = m => (m?.hourly?.swell_wave_height || m?.hourly?.wave_height || []).some(v => v !== null && v !== undefined);

const weather = await getPoints("https://api.open-meteo.com/v1/forecast",
  { hourly: "wind_speed_10m,wind_direction_10m", wind_speed_unit: "kn", timezone: TZ, forecast_days: DAYS }, SPOTS);
const marineParams = { hourly: "swell_wave_height,wave_height", timezone: TZ, forecast_days: DAYS };
const marine = await getPoints("https://marine-api.open-meteo.com/v1/marine", marineParams, SPOTS.map(s => seaPoint(s, 6)));
const missing = marine.map((m, i) => hasSwell(m) ? -1 : i).filter(i => i >= 0);
if (missing.length) {
  const again = await getPoints("https://marine-api.open-meteo.com/v1/marine", marineParams, missing.map(i => seaPoint(SPOTS[i], 18)));
  missing.forEach((i, k) => { if (hasSwell(again[k])) marine[i] = again[k]; });
}

const clock = h => h === 0 || h === 24 ? "12am" : h < 12 ? h + "am" : h === 12 ? "12pm" : (h - 12) + "pm";
const dates = weather[0].hourly.time.filter(t => t.endsWith("T00:00")).map(t => t.slice(0, 10));

function goodWindow(i, date) {
  const s = SPOTS[i], w = weather[i].hourly, m = marine[i]?.hourly || {};
  const mIdx = new Map((m.time || []).map((t, k) => [t, k]));
  let best = null, cur = null;
  for (let h = CFG.startHour; h <= CFG.endHour; h++) {
    const t = `${date}T${String(h).padStart(2, "0")}:00`;
    const wi = w.time.indexOf(t), mi = mIdx.get(t);
    const sw = mi === undefined ? null : (m.swell_wave_height?.[mi] ?? m.wave_height?.[mi] ?? null);
    const ws = wi < 0 ? null : w.wind_speed_10m[wi], wd = wi < 0 ? null : w.wind_direction_10m[wi];
    const ok = sw !== null && sw >= CFG.minSwell && ws !== null && wd !== null && ((CFG.countLightWind && ws <= 5) || angDiff(wd, s.offshore) <= 50);
    if (ok) {
      if (!cur) cur = { start: h, end: h, sw: [], ws: [] };
      cur.end = h; cur.sw.push(sw); cur.ws.push(ws);
      if (!best || cur.end - cur.start > best.end - best.start) best = cur;
    } else cur = null;
  }
  if (!best || best.end - best.start + 1 < CFG.minHours) return null;
  return { ...best, len: best.end - best.start + 1, swell: Math.max(...best.sw), wind: Math.round(best.ws.reduce((a, b) => a + b, 0) / best.ws.length) };
}

const fmtDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const runs = [];
for (const region of REGIONS.filter(r => CFG.regions.includes(r))) {
  const idx = SPOTS.map((s, i) => s.region === region ? i : -1).filter(i => i >= 0);
  let run = [];
  const flush = () => { if (run.length >= CFG.minDays) runs.push({ region, days: run }); run = []; };
  for (const date of dates) {
    let pick = null;
    for (const i of idx) { const w = goodWindow(i, date); if (w && (!pick || w.len > pick.w.len || (w.len === pick.w.len && w.swell > pick.w.swell))) pick = { s: SPOTS[i], w }; }
    if (pick) run.push({ date, ...pick }); else flush();
  }
  flush();
}
console.log(`Found ${runs.length} good run(s).`);

const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN, owner = process.env.GITHUB_REPOSITORY_OWNER;
const gh = (path, opts = {}) => fetch("https://api.github.com/repos/" + repo + path, { ...opts, headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "Content-Type": "application/json" } });
const existing = await (await gh("/issues?state=all&per_page=100")).json();
const seen = (Array.isArray(existing) ? existing : []).map(i => i.title + "\n" + (i.body || "")).join("\n");

// One notification per morning, listing only runs that haven't been sent before (keyed by region + first day)
const fresh = runs.filter(r => {
  const key = `run:${r.region}|${r.days[0].date}`;
  const oldTitle = `Good run: ${r.region}, ${fmtDay(r.days[0].date)} –`;
  return !seen.includes(key) && !seen.includes(oldTitle);
});
if (!fresh.length) { console.log("No new runs to send."); process.exit(0); }

const sections = fresh.map(r => {
  const lines = r.days.map(d => `- **${fmtDay(d.date)}**: ${d.s.name}, offshore ${clock(d.w.start)}–${clock(d.w.end + 1)}, swell up to ${d.w.swell.toFixed(1)} m, wind about ${d.w.wind} kts`);
  return `### ${r.region}: ${fmtDay(r.days[0].date)} – ${fmtDay(r.days.at(-1).date)} (${r.days.length} days)\n<!-- run:${r.region}|${r.days[0].date} -->\n${lines.join("\n")}`;
});
const title = `Good surf runs: ${fresh.map(r => r.region).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`;
const body = `@${owner} New runs of ${CFG.minDays}+ good days in a row:\n\n${sections.join("\n\n")}\n\n[Open Days Offshore](${APP_URL})\n\n_Good day: swell ${CFG.minSwell} m or more and at least ${CFG.minHours} hours of offshore${CFG.countLightWind ? " or light" : ""} wind between ${clock(CFG.startHour)} and ${clock(CFG.endHour)}. Change these in Alert settings in the app. Forecast from Open-Meteo._`;
const res = await gh("/issues", { method: "POST", body: JSON.stringify({ title, body }) });
console.log(res.ok ? "Sent: " + title : "Failed: " + res.status + " " + (await res.text()).slice(0, 200));
