const TZ="Pacific/Auckland";
  var WAVE_MODELS = ["meteofrance_wave", "ecmwf_wam", "ncep_gfswave025", "dwd_gwam"];
  function seaPoint(s, km) {
    var facing = (s.offshore + 180) % 360 * Math.PI / 180;
    var lat = s.lat + (km / 111) * Math.cos(facing);
    var lon = s.lon + (km / (111 * Math.cos(s.lat * Math.PI / 180))) * Math.sin(facing);
    return { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
  }  function circMean(ds, ws) {
    var x = 0, y = 0; ds.forEach(function (d, j) { var w = ws ? ws[j] : 1; x += w * Math.cos(d * Math.PI / 180); y += w * Math.sin(d * Math.PI / 180); });
    return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
  }  function ensembleMerge(m) {
    if (!m || !m.hourly || m.hourly.wave_height) return m;
    var H = m.hourly, n = (H.time || []).length;
    function col(v, md) { return H[v + "_" + md] || []; }
    var out = {}; ["wave_height", "wave_period", "wave_direction", "swell_wave_height", "swell_wave_period", "swell_wave_direction", "wind_wave_height", "wind_wave_period", "wind_wave_direction", "wave_height_min", "wave_height_max", "model_count"].forEach(function (k) { out[k] = []; });
    for (var i = 0; i < n; i++) {
      var tot = [], totDir = [], totPer = [], comp = [], sw = { h: [], p: [], pw: [], d: [], dw: [] }, ww = { h: [], p: [], pw: [], d: [], dw: [] };
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
          /* Periods and directions are weighted by wave energy (height squared), so a model that puts a tiny
             long-period swell in (GFS often has 0.06 m at 18 s) doesn't drag the average period up */
          sw.h.push(sh); if (col("swell_wave_period", md)[i] && sh > 0.02) { sw.p.push(col("swell_wave_period", md)[i]); sw.pw.push(sh * sh); } if (col("swell_wave_direction", md)[i] !== null && col("swell_wave_direction", md)[i] !== undefined && sh > 0.02) { sw.d.push(col("swell_wave_direction", md)[i]); sw.dw.push(sh * sh); }
          var wh = col("wind_wave_height", md)[i];
          if (wh !== null && wh !== undefined) { ww.h.push(wh); if (col("wind_wave_period", md)[i] && wh > 0.02) { ww.p.push(col("wind_wave_period", md)[i]); ww.pw.push(wh * wh); } if (col("wind_wave_direction", md)[i] !== null && col("wind_wave_direction", md)[i] !== undefined && wh > 0.02) { ww.d.push(col("wind_wave_direction", md)[i]); ww.dw.push(wh * wh); } }
        }
      });
      function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
      function wavg(a, w) { var t = 0, sw2 = 0; a.forEach(function (v, j) { t += v * w[j]; sw2 += w[j]; }); return sw2 ? t / sw2 : null; }
      function r2(v) { return v === null ? null : Math.round(v * 100) / 100; }
      var T = avg(tot), C = avg(comp), k = T !== null && C ? Math.max(0.6, Math.min(1.6, T / C)) : 1;
      out.wave_height.push(r2(T)); out.wave_period.push(r2(avg(totPer))); out.wave_direction.push(totDir.length ? circMean(totDir) : null);
      out.wave_height_min.push(tot.length ? Math.min.apply(null, tot) : null); out.wave_height_max.push(tot.length ? Math.max.apply(null, tot) : null); out.model_count.push(tot.length);
      out.swell_wave_height.push(sw.h.length ? r2(avg(sw.h) * k) : null); out.swell_wave_period.push(r2(wavg(sw.p, sw.pw))); out.swell_wave_direction.push(sw.d.length ? circMean(sw.d, sw.dw) : null);
      out.wind_wave_height.push(ww.h.length ? r2(avg(ww.h) * k) : null); out.wind_wave_period.push(r2(wavg(ww.p, ww.pw))); out.wind_wave_direction.push(ww.d.length ? circMean(ww.d, ww.dw) : null);
    }
    Object.keys(out).forEach(function (k2) { H[k2] = out[k2]; });
    /* The per-model columns are no longer needed; dropping them keeps the saved forecast small enough for phone storage */
    Object.keys(H).forEach(function (k2) { if (WAVE_MODELS.some(function (md) { return k2.slice(-md.length - 1) === "_" + md; })) delete H[k2]; });
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
  }  function ftBounds(c) {
    var lo = Math.max(0, Math.round(c * 0.8)), hi = Math.max(1, Math.round(c * 1.2));
    if (hi <= lo) hi = lo + 1;
    return [lo, hi];
  }  function ftRange(c) {
    if (c < 0.4) return "flat";
    var b = ftBounds(c);
    return b[0] + "–" + b[1] + " ft";
  }  var SIZE_CAL = 1.4;

const SPOTS=[{id:"taystreet",lat:-37.650,lon:176.200,offshore:225,exp:0.9,swell:22},{id:"mount",lat:-37.632,lon:176.180,offshore:210,exp:0.9,swell:22},{id:"papamoa",lat:-37.700,lon:176.300,offshore:225,exp:1.0,swell:22},{id:"matakana",lat:-37.570,lon:176.090,offshore:225,exp:1.0,swell:22}];
const H="swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,wave_period,wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction";
for (const s of SPOTS){
  const p=seaPoint(s,6);
  const u="https://marine-api.open-meteo.com/v1/marine?latitude="+p.lat+"&longitude="+p.lon+"&hourly="+H+"&models="+WAVE_MODELS.join(",")+"&timezone="+TZ+"&forecast_days=1";
  let raw; for(let k=0;k<3;k++){ try{ const c=new AbortController(); setTimeout(()=>c.abort(),15000); raw=await (await fetch(u,{signal:c.signal})).json(); break;}catch(e){} }
  const h=ensembleMerge(raw).hourly;
  for(let i=5;i<=18;i+=1){ const c={sh:h.swell_wave_height[i],sp:h.swell_wave_period[i],sd:h.swell_wave_direction[i],wwh:h.wind_wave_height[i],wwp:h.wind_wave_period[i],wwd:h.wind_wave_direction[i],wh:h.wave_height[i],wp:h.wave_period[i],wd:h.wave_direction[i]};
    const ft=surfFt(s,c); console.log("ROW",s.id,h.time[i].slice(11,16),"sw",c.sh,c.sp,c.sd,"ww",c.wwh,c.wwp,c.wwd,"ft",ft.toFixed(2),ftRange(ft)); }
}
const hb=await (await fetch("https://raw.githubusercontent.com/"+process.env.GITHUB_REPOSITORY+"/harbour-data/harbour.json?t="+Date.now())).json();
hb.readings.filter(r=>r.t.slice(11,13)>="05"&&r.t.slice(11,13)<="08").filter((r,i)=>i%5==0).forEach(r=>console.log("BUOY",r.t,"sig",r.wave_sig,"max",r.wave_max,"per",r.wave_per,"tug",r.tug_wind,r.tug_dir));
