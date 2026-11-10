const TZ="Pacific/Auckland";
  var WAVE_MODELS = ["meteofrance_wave", "ecmwf_wam", "ncep_gfswave025", "dwd_gwam"];
  function seaPoint(s, km) {
    var facing = (s.offshore + 180) % 360 * Math.PI / 180;
    var lat = s.lat + (km / 111) * Math.cos(facing);
    var lon = s.lon + (km / (111 * Math.cos(s.lat * Math.PI / 180))) * Math.sin(facing);
    return { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
  }  function circMean(ds) {
    var x = 0, y = 0; ds.forEach(function (d) { x += Math.cos(d * Math.PI / 180); y += Math.sin(d * Math.PI / 180); });
    return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
  }  function ensembleMerge(m) {
    if (!m || !m.hourly || m.hourly.wave_height) return m;
    var H = m.hourly, n = (H.time || []).length;
    function col(v, md) { return H[v + "_" + md] || []; }
    var out = {}; ["wave_height", "wave_period", "wave_direction", "swell_wave_height", "swell_wave_period", "swell_wave_direction", "wind_wave_height", "wind_wave_period", "wind_wave_direction", "wave_height_min", "wave_height_max", "model_count"].forEach(function (k) { out[k] = []; });
    for (var i = 0; i < n; i++) {
      var tot = [], totDir = [], totPer = [], comp = [], sw = { h: [], p: [], d: [] }, ww = { h: [], p: [], d: [] };
      WAVE_MODELS.forEach(function (md) {
        var h = col("wave_height", md)[i];
        if (h === null || h === undefined || h <= 0.02) return;
        tot.push(h);
        var wd = col("wave_direction", md)[i], wp = col("wave_period", md)[i];
        if (wd !== null && wd !== undefined) totDir.push(wd);
        if (wp) totPer.push(wp);
        var sh = col("swell_wave_height", md)[i];
        if (sh !== null && sh !== undefined) {
          comp.push(h);
          sw.h.push(sh); if (col("swell_wave_period", md)[i]) sw.p.push(col("swell_wave_period", md)[i]); if (col("swell_wave_direction", md)[i] !== null && col("swell_wave_direction", md)[i] !== undefined && sh > 0.02) sw.d.push(col("swell_wave_direction", md)[i]);
          var wh = col("wind_wave_height", md)[i];
          if (wh !== null && wh !== undefined) { ww.h.push(wh); if (col("wind_wave_period", md)[i]) ww.p.push(col("wind_wave_period", md)[i]); if (col("wind_wave_direction", md)[i] !== null && col("wind_wave_direction", md)[i] !== undefined && wh > 0.02) ww.d.push(col("wind_wave_direction", md)[i]); }
        }
      });
      function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
      function r2(v) { return v === null ? null : Math.round(v * 100) / 100; }
      var T = avg(tot), C = avg(comp), k = T !== null && C ? Math.max(0.6, Math.min(1.6, T / C)) : 1;
      out.wave_height.push(r2(T)); out.wave_period.push(r2(avg(totPer))); out.wave_direction.push(totDir.length ? circMean(totDir) : null);
      out.wave_height_min.push(tot.length ? Math.min.apply(null, tot) : null); out.wave_height_max.push(tot.length ? Math.max.apply(null, tot) : null); out.model_count.push(tot.length);
      out.swell_wave_height.push(sw.h.length ? r2(avg(sw.h) * k) : null); out.swell_wave_period.push(r2(avg(sw.p))); out.swell_wave_direction.push(sw.d.length ? circMean(sw.d) : null);
      out.wind_wave_height.push(ww.h.length ? r2(avg(ww.h) * k) : null); out.wind_wave_period.push(r2(avg(ww.p))); out.wind_wave_direction.push(ww.d.length ? circMean(ww.d) : null);
    }
    Object.keys(out).forEach(function (k2) { H[k2] = out[k2]; });
    return m;
  }  function angDiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function trainFt(h, T, dir, s) {
    if (h === null || h === undefined || T === null || T === undefined || h <= 0) return 0;
    var facing = (s.offshore + 180) % 360;
    var diff = dir === null || dir === undefined ? 45 : angDiff(dir, facing);
    /* Waves within 45 degrees of straight-on arrive almost in full; beyond that they wrap in much smaller
       (tuned on Wainui, 10 Nov 2026: a 0.8 m 10 s due-south swell read 2-5 ft here when Surfline had 1-2 ft) */
    var dirF = diff <= 45 ? Math.sqrt(Math.cos(diff * Math.PI / 180))
      : diff >= 90 ? 0.03 : Math.max(0.03, Math.sqrt(Math.cos(Math.PI / 4)) * Math.pow(Math.cos(diff * Math.PI / 180) / Math.cos(Math.PI / 4), 4));
    var perF = clamp(0.37 + (T - 6) * 0.17, 0.3, 1.6);
    return h * 3.28 * perF * dirF;
  }  function surfFt(s, c) {
    var sw = trainFt(c.sh, c.sp, c.sd, s);
    var ww = c.wwh !== null && c.wwh !== undefined ? trainFt(c.wwh, c.wwp, c.wwd, s) : 0;
    if (!sw && !ww) sw = trainFt(c.wh, c.wp, c.wd, s);
    return Math.sqrt(sw * sw + ww * ww) * (s.exp || 1) * SIZE_CAL;
  }  function ftRange(c) {
    if (c < 0.4) return "flat";
    var lo = Math.max(0, Math.floor(c * 0.8)), hi = Math.max(1, Math.ceil(c * 1.2));
    if (hi <= lo) hi = lo + 1;
    return lo + "–" + hi + " ft";
  }  var SIZE_CAL = 1.8;

const s={ lat: -37.650, lon: 176.200, offshore: 225, exp: 0.9 };
const p=seaPoint(s,6);
const H="swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,wave_period,wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction";
const u="https://marine-api.open-meteo.com/v1/marine?latitude="+p.lat+"&longitude="+p.lon+"&hourly="+H+"&models="+WAVE_MODELS.join(",")+"&timezone="+TZ+"&forecast_days=2";
const raw=await (await fetch(u)).json();
const perModel={};
WAVE_MODELS.forEach(md=>perModel[md]=raw.hourly["wave_height_"+md]);
const m=ensembleMerge(JSON.parse(JSON.stringify(raw))); const h=m.hourly;
for(let i=5;i<20;i++){
  const c={sh:h.swell_wave_height[i],sp:h.swell_wave_period[i],sd:h.swell_wave_direction[i],wwh:h.wind_wave_height[i],wwp:h.wind_wave_period[i],wwd:h.wind_wave_direction[i],wh:h.wave_height[i],wp:h.wave_period[i],wd:h.wave_direction[i]};
  const ft=surfFt(s,c);
  console.log(h.time[i],"tot",c.wh,"sw",c.sh,c.sp,c.sd,"ww",c.wwh,c.wwp,c.wwd,"ft",ft.toFixed(2),ftRange(ft),"| models",WAVE_MODELS.map(md=>md+":"+perModel[md][i]+"/"+raw.hourly["swell_wave_height_"+md]?.[i]+"@"+raw.hourly["swell_wave_period_"+md]?.[i]+"s/"+raw.hourly["wind_wave_height_"+md]?.[i]).join(" "));
}
