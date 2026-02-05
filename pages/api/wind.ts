import type { NextApiRequest, NextApiResponse } from "next";

type Mode = "current" | "hourly" | "historical";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const { lat, lon, mode, time_iso } = req.body as {
      lat: number;
      lon: number;
      mode: Mode;
      time_iso?: string;
    };

    if (typeof lat !== "number" || typeof lon !== "number") {
      return res.status(400).json({ error: "lat/lon required" });
    }

    const m: Mode = mode || "current";

    // Current wind
    if (m === "current") {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=wind_speed_10m,wind_direction_10m&timezone=auto`;
      const r = await fetch(url);
      const js = await r.json();

      const ws = js?.current?.wind_speed_10m;
      const wd = js?.current?.wind_direction_10m;
      if (ws == null || wd == null) return res.status(500).json({ error: "Open-Meteo missing current wind" });

      // Open-Meteo returns km/h for current wind_speed_10m (forecast API)
      const mph = ws * 0.621371;
      const mps = mph / 2.236936;

      return res.status(200).json({
        wind_from_deg: wd,
        wind_speed_mps: mps,
        time_local: js?.current?.time,
        timezone: js?.timezone,
        utc_offset_seconds: js?.utc_offset_seconds,
      });
    }

    // Hourly wind (pick nearest hour to now)
    if (m === "hourly") {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&hourly=wind_speed_10m,wind_direction_10m&timezone=auto`;
      const r = await fetch(url);
      const js = await r.json();

      const times: string[] = js?.hourly?.time || [];
      const spd: number[] = js?.hourly?.wind_speed_10m || [];
      const dir: number[] = js?.hourly?.wind_direction_10m || [];

      if (!times.length) return res.status(500).json({ error: "Open-Meteo missing hourly" });

      const now = Date.now();
      let best = 0;
      let bestDiff = Infinity;

      for (let i = 0; i < times.length; i++) {
        const t = Date.parse(times[i]);
        const d = Math.abs(t - now);
        if (d < bestDiff) { bestDiff = d; best = i; }
      }

      const ws = spd[best];
      const wd = dir[best];

      // wind_speed_10m hourly is km/h
      const mph = ws * 0.621371;
      const mps = mph / 2.236936;

      return res.status(200).json({
        wind_from_deg: wd,
        wind_speed_mps: mps,
        time_local: times[best],
        timezone: js?.timezone,
        utc_offset_seconds: js?.utc_offset_seconds,
      });
    }

    // Historical: archive API expects date range; we use the same date for start/end
    if (m === "historical") {
      if (!time_iso) return res.status(400).json({ error: "time_iso required for historical" });

      const d = new Date(time_iso);
      if (isNaN(d.getTime())) return res.status(400).json({ error: "Invalid time_iso" });

      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const date = `${yyyy}-${mm}-${dd}`;

      const url =
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&start_date=${date}&end_date=${date}&hourly=wind_speed_10m,wind_direction_10m&timezone=auto`;

      const r = await fetch(url);
      const js = await r.json();

      const times: string[] = js?.hourly?.time || [];
      const spd: number[] = js?.hourly?.wind_speed_10m || [];
      const dir: number[] = js?.hourly?.wind_direction_10m || [];
      if (!times.length) return res.status(500).json({ error: "Open-Meteo archive missing hourly" });

      // choose nearest hour to provided time
      const target = d.getTime();
      let best = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < times.length; i++) {
        const t = Date.parse(times[i]);
        const diff = Math.abs(t - target);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }

      const ws = spd[best];
      const wd = dir[best];
      const mph = ws * 0.621371;
      const mps = mph / 2.236936;

      return res.status(200).json({
        wind_from_deg: wd,
        wind_speed_mps: mps,
        time_local: times[best],
        timezone: js?.timezone,
        utc_offset_seconds: js?.utc_offset_seconds,
        model: "open-meteo-archive",
      });
    }

    return res.status(400).json({ error: "Invalid mode" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
