import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { toPng } from "html-to-image";

import ConeCanvas from "@/components/ConeCanvas";
import type { WindData } from "@/lib/cone";
import { mpsToMph, mphToMps } from "@/lib/cone";
import {
  computeScentEnvelope,
  addMinutesIso,
  type TerrainType,
  type StabilityType,
  type PrecipType,
} from "@/lib/scentEnvelope";

const LeafletMapInner = dynamic(() => import("./LeafletMapClient"), { ssr: false });

type LKP = { id: string; lat: number; lon: number; timeISO: string; label?: string };
type Trap = { id: string; lat: number; lon: number; label: string };

function isoNow() {
  return new Date().toISOString();
}
function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(v: string) {
  return new Date(v).toISOString();
}

export default function LiveMap() {
  const center: LatLngExpression = useMemo(() => [27.49, -82.45], []);
  const zoom = 14;

  // app mode
  const [appMode, setAppMode] = useState<"live" | "scenario">("live");

  // live LKPs
  const [lkps, setLkps] = useState<LKP[]>([]);
  const [activeLkpId, setActiveLkpId] = useState<string | null>(null);
  const activeLkp = useMemo(() => lkps.find((k) => k.id === activeLkpId) ?? null, [lkps, activeLkpId]);
  const [lockSource, setLockSource] = useState(true);

  // scenario location + time
  const [scenarioLL, setScenarioLL] = useState<{ lat: number; lon: number } | null>(null);
  const [scenarioLabel, setScenarioLabel] = useState("Scenario");
  const [scenarioLkpISO, setScenarioLkpISO] = useState<string>(isoNow());
  const [scenarioElapsedMin, setScenarioElapsedMin] = useState<number>(60);

  const scenarioLkp: LKP | null = useMemo(() => {
    if (!scenarioLL) return null;
    return { id: "scenario", lat: scenarioLL.lat, lon: scenarioLL.lon, timeISO: scenarioLkpISO, label: scenarioLabel };
  }, [scenarioLL, scenarioLkpISO, scenarioLabel]);

  const activeForModel: LKP | null = useMemo(() => (appMode === "live" ? activeLkp : scenarioLkp), [appMode, activeLkp, scenarioLkp]);

  const selectedLL = useMemo(() => {
    if (appMode === "live") return activeLkp ? { lat: activeLkp.lat, lon: activeLkp.lon } : null;
    return scenarioLL;
  }, [appMode, activeLkp, scenarioLL]);

  // wind
  const [wind, setWind] = useState<WindData | null>(null);
  const [windMode, setWindMode] = useState<"current" | "hourly" | "historical" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11);
  const [manualFromDeg, setManualFromDeg] = useState<number>(315);

  const effectiveWind: WindData | null = useMemo(() => {
    if (windMode === "manual") {
      return {
        wind_speed_mps: mphToMps(manualSpeedMph),
        wind_dir_from_deg: manualFromDeg,
        time_local: "manual",
      };
    }
    return wind;
  }, [windMode, manualSpeedMph, manualFromDeg, wind]);

  // environment (envelope)
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [showTimeBands, setShowTimeBands] = useState(true);
  const [bandSet, setBandSet] = useState<number[]>([15, 30, 60, 120]);
  const [tempF, setTempF] = useState(75);
  const [rh, setRh] = useState(50);
  const [cloud, setCloud] = useState<"clear" | "partly" | "overcast" | "night">("partly");
  const [precip, setPrecip] = useState<PrecipType>("none");
  const [recentRain, setRecentRain] = useState(false);
  const [terrain, setTerrain] = useState<TerrainType>("mixed");
  const [stability, setStability] = useState<StabilityType>("neutral");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // traps
  const [traps, setTraps] = useState<Trap[]>([]);
  const [mapMode, setMapMode] = useState<"setSource" | "addTrap">("setSource");
  const [newTrapLabel, setNewTrapLabel] = useState("Terrain trap");

  // visual cone
  const [lengthPx, setLengthPx] = useState(780);
  const [halfAngleDeg, setHalfAngleDeg] = useState<"auto" | number>("auto");

  // user location (optional)
  const [showUserLocation, setShowUserLocation] = useState(false);
  const [followUser, setFollowUser] = useState(false);
  const [locateToken, setLocateToken] = useState(0);
  const [centerOnMeToken, setCenterOnMeToken] = useState(0);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    // ensure OFF by default
    setShowUserLocation(false);
    setFollowUser(false);
  }, []);

  // time now tick
  const [nowISO, setNowISO] = useState<string>(isoNow());
  useEffect(() => {
    if (appMode !== "live") return;
    const id = setInterval(() => setNowISO(isoNow()), 30_000);
    return () => clearInterval(id);
  }, [appMode]);

  // refs
  const mapRef = useRef<LeafletMap | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1200, h: 800 });
  useEffect(() => {
    if (!mapWrapRef.current) return;
    const el = mapWrapRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);

  function recomputeSrcPoint(map: LeafletMap | null, ll: { lat: number; lon: number } | null) {
    if (!map || !ll) { setSrcPoint(null); return; }
    const pt = map.latLngToContainerPoint([ll.lat, ll.lon]);
    setSrcPoint({ x: pt.x, y: pt.y });
  }

  function onMapReady(map: LeafletMap) {
    mapRef.current = map;
    recomputeSrcPoint(map, selectedLL);
  }

  function onViewChanged(map: LeafletMap) {
    recomputeSrcPoint(map, selectedLL);
  }

  async function fetchWind(lat: number, lon: number) {
    if (windMode === "manual") return;

    const modeSafe =
      windMode === "hourly" ? "hourly" : windMode === "historical" ? "historical" : "current";

    const body: any = { lat, lon, mode: modeSafe };
    if (modeSafe === "historical") body.time_iso = scenarioLkpISO;

    const r = await fetch("/api/wind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const js = await r.json();
    if (!r.ok) throw new Error(js?.error || "Wind fetch failed");
    setWind(js);
  }

  async function onMapClick(lat: number, lon: number) {
    if (mapMode === "addTrap") {
      setTraps((prev) => [{ id: uid("trap"), lat, lon, label: newTrapLabel || "Terrain trap" }, ...prev]);
      return;
    }

    if (appMode === "scenario") {
      setScenarioLL({ lat, lon });
      recomputeSrcPoint(mapRef.current, { lat, lon });
      try { await fetchWind(lat, lon); } catch (e: any) { alert(e?.message || String(e)); }
      return;
    }

    // live
    if (lockSource && activeLkp) return;

    const id = activeLkp?.id ?? uid("lkp");
    const lkp: LKP = { id, lat, lon, timeISO: isoNow(), label: activeLkp?.label ?? "LKP" };
    setLkps((prev) => [lkp, ...prev.filter((p) => p.id !== id)]);
    setActiveLkpId(id);

    recomputeSrcPoint(mapRef.current, { lat, lon });
    try { await fetchWind(lat, lon); } catch (e: any) { alert(e?.message || String(e)); }
  }

  const envelopeNow = useMemo(() => {
    if (!showEnvelope || !activeForModel || !effectiveWind) return null;
    const windSpeedMph = mpsToMph(effectiveWind.wind_speed_mps);
    const nowForModel = appMode === "scenario"
      ? addMinutesIso(activeForModel.timeISO, scenarioElapsedMin)
      : nowISO;

    return computeScentEnvelope({
      lkp_lat: activeForModel.lat,
      lkp_lon: activeForModel.lon,
      lkp_time_iso: activeForModel.timeISO,
      now_time_iso: nowForModel,
      wind_from_deg: effectiveWind.wind_dir_from_deg,
      wind_speed_mph: windSpeedMph,
      temperature_f: tempF,
      rel_humidity_pct: rh,
      cloud,
      precip,
      recent_rain: recentRain,
      terrain,
      stability,
    });
  }, [showEnvelope, activeForModel, effectiveWind, appMode, scenarioElapsedMin, nowISO, tempF, rh, cloud, precip, recentRain, terrain, stability]);

  const envelopeBands = useMemo(() => {
    if (!showEnvelope || !showTimeBands || !activeForModel || !effectiveWind) return null;
    const windSpeedMph = mpsToMph(effectiveWind.wind_speed_mps);

    return bandSet.slice().sort((a,b)=>a-b).map((mins) => {
      const e = computeScentEnvelope({
        lkp_lat: activeForModel.lat,
        lkp_lon: activeForModel.lon,
        lkp_time_iso: activeForModel.timeISO,
        now_time_iso: addMinutesIso(activeForModel.timeISO, mins),
        wind_from_deg: effectiveWind.wind_dir_from_deg,
        wind_speed_mph: windSpeedMph,
        temperature_f: tempF,
        rel_humidity_pct: rh,
        cloud,
        precip,
        recent_rain: recentRain,
        terrain,
        stability,
      });

      return { minutes: mins, polygons: e.polygons, confidence_score: e.confidence_score, confidence_band: e.confidence_band };
    });
  }, [showEnvelope, showTimeBands, bandSet, activeForModel, effectiveWind, tempF, rh, cloud, precip, recentRain, terrain, stability]);

  const windText = useMemo(() => {
    if (!effectiveWind) return "Wind: (not fetched yet)";
    const mph = mpsToMph(effectiveWind.wind_speed_mps);
    const from = Math.round(effectiveWind.wind_dir_from_deg);
    return `Wind from ${from}° @ ${mph.toFixed(1)} mph`;
  }, [effectiveWind]);

  async function exportPNG() {
    if (!exportRef.current) return;
    const dataUrl = await toPng(exportRef.current, { cacheBust: true, pixelRatio: 2 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `k9_scent_cone_${stamp}.png`;
    a.click();
  }

  return (
    <div className="shell">
      {/* MAP */}
      <div className="card mapCard" ref={mapWrapRef} style={{ position: "relative" }}>
        <div ref={exportRef} style={{ position: "absolute", inset: 0 }}>
          <LeafletMapInner
            center={center}
            zoom={zoom}
            onMapClick={onMapClick}
            onMapReady={onMapReady}
            onViewChanged={onViewChanged}
            showUserLocation={showUserLocation}
            followUser={followUser}
            locateToken={locateToken}
            centerOnMeToken={centerOnMeToken}
            onUserLocation={(lat: number, lon: number) => setUserLoc({ lat, lon })}
            showEnvelope={showEnvelope}
            envelopeNow={envelopeNow ? envelopeNow.polygons : null}
            envelopeBands={envelopeBands}
            startPoints={envelopeNow ? envelopeNow.recommended_start_points : null}
            traps={traps}
            lkps={appMode === "live" ? lkps : (scenarioLkp ? [scenarioLkp] : [])}
            activeLkpId={appMode === "live" ? activeLkpId : (scenarioLkp ? scenarioLkp.id : null)}
          />

          {/* Cone overlay */}
          <div style={{ position: "absolute", inset: 0, zIndex: 999, pointerEvents: "none" }}>
            <ConeCanvas
              width={size.w}
              height={size.h}
              srcPoint={srcPoint}
              wind={effectiveWind}
              lengthPx={lengthPx}
              halfAngleDeg={halfAngleDeg}
              label={selectedLL ? `Point @ ${selectedLL.lat.toFixed(5)}, ${selectedLL.lon.toFixed(5)}` : "Click map to set point"}
            />
          </div>

          {/* Footer chip (included in export) */}
          <div className="footerChip">
            {envelopeNow
              ? `Confidence: ${envelopeNow.confidence_score} (${envelopeNow.confidence_band}) • ${windText}`
              : windText}
          </div>
        </div>
      </div>

      {/* PANEL */}
      <div className="card panel">
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <h1 className="h1">K9 Scent Cone</h1>
              <p className="sub">
                Decision-support for K9 deployment. Not a route predictor—use with field observations and handler judgement.
              </p>
            </div>
            <span className="pill">Basemap: Neutral</span>
          </div>

          <div className="section">
            <div className="row">
              <button className={`btn ${appMode === "live" ? "btnPrimary" : ""}`} style={{ flex: 1 }} onClick={() => setAppMode("live")}>
                Live
              </button>
              <button className={`btn ${appMode === "scenario" ? "btnPrimary" : ""}`} style={{ flex: 1 }} onClick={() => setAppMode("scenario")}>
                Scenario
              </button>
            </div>

            {appMode === "live" && (
              <>
                <label className="label">
                  <input
                    type="checkbox"
                    checked={lockSource}
                    onChange={(e) => setLockSource(e.target.checked)}
                    style={{ marginRight: 8 }}
                  />
                  Lock point (keeps it fixed while panning/zooming)
                </label>

                <div className="small" style={{ marginTop: 6 }}>
                  Click map to set point. If locked, uncheck lock to choose a new point.
                </div>
              </>
            )}

            {appMode === "scenario" && (
              <>
                <label className="label">Scenario label</label>
                <input className="input" value={scenarioLabel} onChange={(e) => setScenarioLabel(e.target.value)} />

                <label className="label">LKP date/time (local)</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={isoToLocalInput(scenarioLkpISO)}
                  onChange={(e) => setScenarioLkpISO(localInputToIso(e.target.value))}
                />

                <label className="label">Minutes since LKP</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={1440}
                  value={scenarioElapsedMin}
                  onChange={(e) => setScenarioElapsedMin(Number(e.target.value))}
                />

                <div className="small" style={{ marginTop: 6 }}>
                  Click map to set scenario location, then fetch wind.
                </div>
              </>
            )}
          </div>

          <div className="section">
            <b>Wind</b>

            <label className="label">Source</label>
            <select className="input" value={windMode} onChange={(e) => setWindMode(e.target.value as any)}>
              <option value="current">Current (Open-Meteo)</option>
              <option value="hourly">Hourly (Open-Meteo)</option>
              <option value="historical">Historical (scenario time)</option>
              <option value="manual">Manual</option>
            </select>

            {windMode === "manual" ? (
              <>
                <label className="label">Wind speed (mph)</label>
                <input className="input" type="number" min={0} max={60} value={manualSpeedMph} onChange={(e) => setManualSpeedMph(Number(e.target.value))} />

                <label className="label">Wind from (deg)</label>
                <input className="input" type="number" min={0} max={360} value={manualFromDeg} onChange={(e) => setManualFromDeg(Number(e.target.value))} />
              </>
            ) : (
              <button
                className="btn btnWide"
                style={{ marginTop: 10 }}
                onClick={async () => {
                  if (!selectedLL) return alert("Set a point first (click the map).");
                  try { await fetchWind(selectedLL.lat, selectedLL.lon); } catch (e: any) { alert(e?.message || String(e)); }
                }}
                disabled={!selectedLL}
              >
                Fetch wind for selected point
              </button>
            )}

            <div className="small" style={{ marginTop: 10 }}>{windText}</div>
          </div>

          <div className="section">
            <b>Live Location</b>
            <label className="label" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={showUserLocation}
                onChange={(e) => {
                  const on = e.target.checked;
                  setShowUserLocation(on);
                  if (on) setLocateToken((n) => n + 1); // marker only (no recenter)
                  if (!on) setFollowUser(false);
                }}
              />
              Show my location (does not lock map)
            </label>

            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={() => {
                  if (!showUserLocation) setShowUserLocation(true);
                  setLocateToken((n) => n + 1);
                  setCenterOnMeToken((n) => n + 1); // one-time recenter
                }}
              >
                Center on me
              </button>

              <button
                className="btn"
                style={{ flex: 1, opacity: showUserLocation ? 1 : 0.5 }}
                disabled={!showUserLocation}
                onClick={() => setFollowUser((p) => !p)}
              >
                {followUser ? "Following" : "Follow me"}
              </button>
            </div>

            {userLoc && <div className="small" style={{ marginTop: 8 }}>You: {userLoc.lat.toFixed(5)}, {userLoc.lon.toFixed(5)}</div>}
          </div>

          <div className="section">
            <b>Visual Cone</b>

            <label className="label">Length</label>
            <input
              className="input"
              type="range"
              min={200}
              max={1800}
              value={lengthPx}
              onChange={(e) => setLengthPx(Number(e.target.value))}
            />

            <div className="row" style={{ marginTop: 8 }}>
              <button className={`btn ${halfAngleDeg === "auto" ? "btnPrimary" : ""}`} style={{ flex: 1 }} onClick={() => setHalfAngleDeg("auto")}>
                Auto angle
              </button>
              <input
                className="input"
                style={{ flex: 1 }}
                type="number"
                min={5}
                max={60}
                disabled={halfAngleDeg === "auto"}
                value={halfAngleDeg === "auto" ? 18 : halfAngleDeg}
                onChange={(e) => setHalfAngleDeg(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="section">
            <b>Time-aware Envelope</b>

            <label className="label" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="checkbox" checked={showEnvelope} onChange={(e) => setShowEnvelope(e.target.checked)} />
              Show envelope polygons
            </label>

            <label className="label" style={{ display: "flex", gap: 10, alignItems: "center", opacity: showEnvelope ? 1 : 0.55 }}>
              <input type="checkbox" disabled={!showEnvelope} checked={showTimeBands} onChange={(e) => setShowTimeBands(e.target.checked)} />
              Show time bands
            </label>

            <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
              {[15, 30, 60, 120, 240].map((m) => (
                <button
                  key={m}
                  className="btn"
                  style={{ padding: "8px 10px", opacity: showEnvelope && showTimeBands ? 1 : 0.5 }}
                  disabled={!showEnvelope || !showTimeBands}
                  onClick={() => setBandSet((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))}
                >
                  <span style={{ fontWeight: bandSet.includes(m) ? 800 : 650 }}>{m}m</span>
                </button>
              ))}
            </div>

            {envelopeNow && (
              <div className="small" style={{ marginTop: 10 }}>
                <b>Confidence:</b> {envelopeNow.confidence_score} ({envelopeNow.confidence_band}) • <b>Reset:</b> {envelopeNow.reset_recommendation_minutes} min
                <div style={{ marginTop: 6 }}>
                  <b>Notes:</b>
                  <ul style={{ margin: "6px 0 0 18px" }}>
                    {envelopeNow.deployment_notes.slice(0, 3).map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </div>
              </div>
            )}

            <button className="btn btnWide" style={{ marginTop: 10 }} onClick={() => setShowAdvanced((p) => !p)}>
              {showAdvanced ? "Hide conditions" : "Edit conditions"}
            </button>

            {showAdvanced && (
              <>
                <label className="label">Temp (°F) / Humidity (%)</label>
                <div className="row">
                  <input className="input" style={{ flex: 1 }} type="number" value={tempF} onChange={(e) => setTempF(Number(e.target.value))} />
                  <input className="input" style={{ flex: 1 }} type="number" value={rh} onChange={(e) => setRh(Number(e.target.value))} />
                </div>

                <label className="label">Cloud / Precip</label>
                <div className="row">
                  <select className="input" style={{ flex: 1 }} value={cloud} onChange={(e) => setCloud(e.target.value as any)}>
                    <option value="clear">Clear</option>
                    <option value="partly">Partly</option>
                    <option value="overcast">Overcast</option>
                    <option value="night">Night</option>
                  </select>

                  <select className="input" style={{ flex: 1 }} value={precip} onChange={(e) => setPrecip(e.target.value as any)}>
                    <option value="none">None</option>
                    <option value="light">Light</option>
                    <option value="moderate">Moderate</option>
                    <option value="heavy">Heavy</option>
                  </select>
                </div>

                <label className="label" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="checkbox" checked={recentRain} onChange={(e) => setRecentRain(e.target.checked)} />
                  Recent rain ended
                </label>

                <label className="label">Terrain / Stability</label>
                <div className="row">
                  <select className="input" style={{ flex: 1 }} value={terrain} onChange={(e) => setTerrain(e.target.value as any)}>
                    <option value="mixed">Mixed</option>
                    <option value="open">Open</option>
                    <option value="forest">Forest</option>
                    <option value="urban">Urban</option>
                    <option value="swamp">Swamp/Brush</option>
                    <option value="beach">Beach/Sand</option>
                  </select>

                  <select className="input" style={{ flex: 1 }} value={stability} onChange={(e) => setStability(e.target.value as any)}>
                    <option value="neutral">Neutral</option>
                    <option value="stable">Stable</option>
                    <option value="convective">Convective</option>
                  </select>
                </div>
              </>
            )}
          </div>

          <div className="section">
            <b>Traps</b>
            <div className="row" style={{ marginTop: 10 }}>
              <button className={`btn ${mapMode === "setSource" ? "btnPrimary" : ""}`} style={{ flex: 1 }} onClick={() => setMapMode("setSource")}>
                Set point
              </button>
              <button className={`btn ${mapMode === "addTrap" ? "btnPrimary" : ""}`} style={{ flex: 1 }} onClick={() => setMapMode("addTrap")}>
                Add trap
              </button>
            </div>

            {mapMode === "addTrap" && (
              <>
                <label className="label">Trap label</label>
                <input className="input" value={newTrapLabel} onChange={(e) => setNewTrapLabel(e.target.value)} />
                <div className="small" style={{ marginTop: 6 }}>Click map to place a trap.</div>
              </>
            )}

            {traps.length > 0 && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {traps.slice(0, 6).map((t) => (
                  <div key={t.id} className="row" style={{ alignItems: "center" }}>
                    <div style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.9)" }}>{t.label}</div>
                    <button className="btn" onClick={() => setTraps((p) => p.filter((x) => x.id !== t.id))}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="btn btnPrimary btnWide" style={{ marginTop: 12 }} onClick={exportPNG}>
            Export PNG (map + cone + footer)
          </button>

          <div className="section">
            <b>How to use</b>
            <div className="small" style={{ marginTop: 6 }}>
              <ol style={{ margin: "6px 0 0 18px" }}>
                <li>Select <b>Live</b> or <b>Scenario</b>.</li>
                <li>Click the map to set a point. In Live, use <b>Lock point</b> to keep it fixed.</li>
                <li>Fetch wind (or switch to Manual).</li>
                <li>Use Envelope confidence + start points to guide deployment.</li>
                <li>Export PNG for briefings/ICS.</li>
              </ol>
              <div style={{ marginTop: 8 }}>
                Tip: Use <span className="kbd">Scenario</span> + <span className="kbd">Historical</span> to visualize conditions at a past time.
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

