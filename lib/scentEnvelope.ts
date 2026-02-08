import { clamp } from "./cone";

export type TerrainType = "mixed" | "open" | "forest" | "urban" | "swamp" | "beach";
export type StabilityType = "neutral" | "stable" | "convective";
export type PrecipType = "none" | "light" | "moderate" | "heavy";

export type LatLon = { lat: number; lon: number };

export type EnvelopePolys = {
  core: LatLon[];
  fringe: LatLon[];
  residual: LatLon[];
};

export type StartPoint = { label: string; point: LatLon };

export function addMinutesIso(iso: string, mins: number) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}

function metersPerDegreeLat() {
  return 111_320;
}

function metersPerDegreeLon(latDeg: number) {
  return 111_320 * Math.cos((latDeg * Math.PI) / 180);
}

function moveLL(start: LatLon, bearingDeg: number, distanceMeters: number): LatLon {
  // simple flat-earth approx (fine for local SAR)
  const br = (bearingDeg * Math.PI) / 180;
  const dNorth = Math.cos(br) * distanceMeters;
  const dEast = Math.sin(br) * distanceMeters;

  const dLat = dNorth / metersPerDegreeLat();
  const dLon = dEast / metersPerDegreeLon(start.lat);

  return { lat: start.lat + dLat, lon: start.lon + dLon };
}

// wind FROM -> downwind TO
function downwind(fromDeg: number) {
  return (fromDeg + 180) % 360;
}

function terrainLenMult(t: TerrainType) {
  switch (t) {
    case "open": return 1.1;
    case "forest": return 0.95;
    case "urban": return 0.85;
    case "swamp": return 0.9;
    case "beach": return 1.0;
    default: return 1.0;
  }
}

function stabilityMult(s: StabilityType) {
  // stable tends to be narrower/longer, convective mixes more
  switch (s) {
    case "stable": return 0.9;
    case "convective": return 1.05;
    default: return 1.0;
  }
}

function mixMult(s: StabilityType, terrain: TerrainType) {
  let m = 1.0;
  if (s === "stable") m *= 0.85;
  if (s === "convective") m *= 1.25;
  if (terrain === "urban") m *= 1.15;
  return m;
}

function tauMinutes(tempF: number, rh: number, cloud: string, windMph: number) {
  // rough but defensible defaults
  let tau = 180; // neutral ~3h
  if (tempF > 85 || rh < 35 || windMph > 15 || cloud === "clear") tau = 120;
  if (tempF < 65 && rh > 55 && (cloud === "overcast" || cloud === "night")) tau = 240;
  return tau;
}

function confidenceScore(tMin: number, tempF: number, rh: number, cloud: string, precip: string, recentRain: boolean, windMph: number) {
  const tau = tauMinutes(tempF, rh, cloud, windMph);
  const cTime = 100 * Math.exp(-tMin / tau);

  let hum = 1.0;
  if (rh < 30) hum = 0.8;
  else if (rh > 60) hum = 1.1;

  let temp = 1.0;
  if (tempF > 85) temp = 0.85;
  else if (tempF < 60) temp = 1.05;

  let sun = 1.0;
  if (cloud === "clear") sun = 0.85;
  else if (cloud === "partly") sun = 0.95;
  else if (cloud === "overcast" || cloud === "night") sun = 1.05;

  let rain = 1.0;
  if (precip === "heavy") rain = 0.75;
  else if (precip === "moderate") rain = 0.9;
  else if (precip === "light") rain = 0.9;
  if (recentRain) rain *= 0.95;

  let wind = 1.0;
  if (windMph <= 3) wind = 0.85;
  else if (windMph <= 12) wind = 1.0;
  else if (windMph <= 18) wind = 0.9;
  else wind = 0.8;

  const c = cTime * hum * temp * sun * rain * wind;
  return clamp(Math.round(c), 5, 100);
}

function confidenceBand(c: number) {
  if (c >= 70) return "High";
  if (c >= 40) return "Moderate";
  return "Low";
}

function resetRecommendation(c: number) {
  if (c < 40) return 30;
  if (c < 70) return 45;
  return 60;
}

function coneFan(lkp: LatLon, axisDeg: number, lengthM: number, widthEndM: number, points = 28): LatLon[] {
  // Create a "fan" polygon: lkp -> arc -> lkp
  const halfAngle = Math.atan2(widthEndM, lengthM); // radians
  const start = axisDeg - (halfAngle * 180) / Math.PI;
  const end = axisDeg + (halfAngle * 180) / Math.PI;

  const poly: LatLon[] = [];
  poly.push(lkp);

  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const b = start + (end - start) * t;
    poly.push(moveLL(lkp, b, lengthM));
  }

  poly.push(lkp);
  return poly;
}

export function computeScentEnvelope(input: {
  lkp_lat: number;
  lkp_lon: number;
  lkp_time_iso: string;
  now_time_iso: string;
  wind_from_deg: number;
  wind_speed_mph: number;

  temperature_f: number;
  rel_humidity_pct: number;
  cloud: "clear" | "partly" | "overcast" | "night";
  precip: PrecipType;
  recent_rain: boolean;
  terrain: TerrainType;
  stability: StabilityType;
}) {
  const lkp: LatLon = { lat: input.lkp_lat, lon: input.lkp_lon };
  const tMin = Math.max(0, Math.round((Date.parse(input.now_time_iso) - Date.parse(input.lkp_time_iso)) / 60000));
  const W = Math.max(0, input.wind_speed_mph);
  const W_eff = Math.min(W, 18);

  // Length model (feet -> meters)
  const L_base_ft = 30 + 6.0 * tMin;
  const L_wind_ft = 120 * W_eff * Math.log(1 + tMin / 30);
  let L_ft = (L_base_ft + L_wind_ft) * terrainLenMult(input.terrain) * stabilityMult(input.stability);
  const L_m = L_ft * 0.3048;

  // Width model (feet -> meters)
  const mix = mixMult(input.stability, input.terrain);
  const Width_end_ft = (20 + 3.5 * tMin + 40 * Math.sqrt(Math.max(1, tMin))) * mix;
  const Width_end_m = Width_end_ft * 0.3048;

  // Zone scaling
  const L_core = 0.55 * L_m;
  const W_core = 0.45 * Width_end_m;

  const L_fringe = 0.85 * L_m;
  const W_fringe = 0.8 * Width_end_m;

  const L_res = 1.0 * L_m;
  const W_res = 1.15 * Width_end_m;

  const axis = downwind(input.wind_from_deg);

  const polys: EnvelopePolys = {
    core: coneFan(lkp, axis, L_core, W_core),
    fringe: coneFan(lkp, axis, L_fringe, W_fringe),
    residual: coneFan(lkp, axis, L_res, W_res),
  };

  const c = confidenceScore(
    tMin,
    input.temperature_f,
    input.rel_humidity_pct,
    input.cloud,
    input.precip,
    input.recent_rain,
    W
  );

  const notes: string[] = [];
  if (W <= 3) notes.push("Low wind: scent pooling/eddy likely—work LKP and leeward obstacles.");
  if (W >= 13) notes.push("Higher wind: dilution/variability likely—use multiple start points and reassess often.");
  if (input.precip === "heavy") notes.push("Heavy precip can disrupt airborne scent—prioritize high-probability areas first.");
  if (c < 40) notes.push("Low confidence: use envelope as planning aid; prioritize tracks/POAs/intel.");
  else if (c < 70) notes.push("Moderate confidence: core first, fringe support, residual if resources permit.");
  else notes.push("High confidence: deploy downwind along core axis, bracket fringe.");

  const startPoints: StartPoint[] = [
    { label: "LKP (Immediate)", point: lkp },
    { label: "Core Midline (~35%)", point: moveLL(lkp, axis, 0.35 * L_m) },
    { label: "Core Far (~55%)", point: moveLL(lkp, axis, 0.55 * L_m) },
  ];

  return {
    minutes_since_lkp: tMin,
    polygons: polys,
    confidence_score: c,
    confidence_band: confidenceBand(c) as "High" | "Moderate" | "Low",
    reset_recommendation_minutes: resetRecommendation(c),
    recommended_start_points: startPoints,
    deployment_notes: notes,
  };
}