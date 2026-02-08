import React, { useEffect, useRef } from "react";
import { computeCone, defaultHalfAngleDegFromMph, mpsToMph, WindData } from "@/lib/cone";

type Props = {
  width: number;
  height: number;
  srcPoint: { x: number; y: number } | null;
  wind: WindData | null;
  lengthPx: number;
  halfAngleDeg: number | "auto";
  label?: string;
  onClick?: (pt: { x: number; y: number }) => void;
  backgroundImage?: HTMLImageElement | null; // screenshot mode
};

export default function ConeCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, props.width, props.height);

    if (props.backgroundImage) {
      ctx.drawImage(props.backgroundImage, 0, 0, props.width, props.height);
    }

    if (!props.srcPoint) return;

    // marker
    // Source marker
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(props.srcPoint.x, props.srcPoint.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!props.wind) return;

    const mph = mpsToMph(props.wind.wind_speed_mps);
    const halfAngle =
      props.halfAngleDeg === "auto" ? defaultHalfAngleDegFromMph(mph) : props.halfAngleDeg;

    const g = computeCone(
      props.srcPoint,
      props.lengthPx,
      halfAngle,
      props.wind.wind_dir_from_deg
    );

    // gradient cone fill
    const grad = ctx.createRadialGradient(
      props.srcPoint.x,
      props.srcPoint.y,
      10,
      props.srcPoint.x,
      props.srcPoint.y,
      props.lengthPx
    );
    grad.addColorStop(0.0, "rgba(249, 115, 22, 0.45)");
    grad.addColorStop(0.65, "rgba(251, 191, 36, 0.22)");
    grad.addColorStop(1.0, "rgba(253, 230, 138, 0.08)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(props.srcPoint.x, props.srcPoint.y);
    ctx.lineTo(g.left.x, g.left.y);
    ctx.lineTo(g.tip.x, g.tip.y);
    ctx.lineTo(g.right.x, g.right.y);
    ctx.closePath();
    ctx.fill();

    // centerline
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 5;
    ctx.setLineDash([16, 12]);
    ctx.beginPath();
    ctx.moveTo(props.srcPoint.x, props.srcPoint.y);
    ctx.lineTo(g.tip.x, g.tip.y);
    ctx.stroke();

    // edges
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(props.srcPoint.x, props.srcPoint.y); ctx.lineTo(g.left.x, g.left.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(props.srcPoint.x, props.srcPoint.y); ctx.lineTo(g.right.x, g.right.y); ctx.stroke();
    ctx.setLineDash([]);

    // label
    const speedStr = `${mph.toFixed(1)} mph`;
    const from = Math.round(props.wind.wind_dir_from_deg);
    const down = Math.round(g.downwindDeg);

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(12, 12, 520, 68);
    ctx.fillStyle = "white";
    ctx.font = "18px system-ui";
    ctx.fillText(`Wind from ${from}° @ ${speedStr}  → downwind ${down}°`, 20, 40);
    ctx.font = "14px system-ui";
    ctx.fillText(props.label || "Probable scent cone (planning estimate)", 20, 64);
  }, [
    props.width,
    props.height,
    props.srcPoint,
    props.wind,
    props.lengthPx,
    props.halfAngleDeg,
    props.label,
    props.backgroundImage,
  ]);

  return (
    <canvas
      ref={ref}
      width={props.width}
      height={props.height}
      style={{ width: "100%", height: "100%", borderRadius: 16 }}
    />
  );
}


export async function downloadDataUrlPNG_ICS(
  dataUrl: string,
  filename: string,
  meta: {
    notes?: string;
    lat?: number;
    lon?: number;
    windSource?: string;
    windFromDeg?: number;
    windSpeedMps?: number;
    windSpeedMph?: number;
    timeLocal?: string;
    timeUtc?: string;
    coneLengthPx?: number;
    coneHalfAngleDeg?: number | "auto";
  }
): Promise<void> {
  const img = new Image();
  img.src = dataUrl;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load export image"));
  });

  const baseW = img.width;
  const baseH = img.height;

  const out = document.createElement("canvas");
  out.width = baseW;
  out.height = baseH + 180;

  const ctx = out.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(img, 0, 0);

  // Footer background
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, baseH, out.width, 180);

  // Header
  ctx.fillStyle = "white";
  ctx.font = "18px system-ui";
  ctx.fillText("ICS Scent Cone Planning Export (Decision Support)", 16, baseH + 28);

  // Line 1
  ctx.font = "14px system-ui";
  ctx.fillText(
    `Local Time: ${meta.timeLocal ?? "n/a"}   |   UTC: ${meta.timeUtc ?? "n/a"}   |   Wind Source: ${meta.windSource ?? "n/a"}`,
    16,
    baseH + 55
  );

  // Line 2
  const windStr =
    meta.windFromDeg != null ? `Wind FROM: ${Math.round(meta.windFromDeg)}°` : "Wind FROM: n/a";
  const speedStr =
    meta.windSpeedMph != null
      ? `${meta.windSpeedMph.toFixed(1)} mph`
      : meta.windSpeedMps != null
      ? `${meta.windSpeedMps.toFixed(2)} m/s`
      : "n/a";

  ctx.fillText(
    `Location: ${meta.lat?.toFixed(6) ?? "n/a"}, ${meta.lon?.toFixed(6) ?? "n/a"}   |   ${windStr} @ ${speedStr}`,
    16,
    baseH + 78
  );

  // Line 3
  ctx.fillText(
    `Cone: length=${meta.coneLengthPx ?? "n/a"}px   half-angle=${meta.coneHalfAngleDeg ?? "n/a"}`,
    16,
    baseH + 101
  );

  // Notes
  ctx.font = "13px system-ui";
  const notes = meta.notes?.trim() ? meta.notes.trim() : "(no notes)";
  ctx.fillText(`Notes: ${notes}`.slice(0, 160), 16, baseH + 124);

  // Disclaimer
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(
    "Disclaimer: Planning estimate only. Terrain/thermals/obstacles can significantly alter scent behavior.",
    16,
    baseH + 154
  );

  const a = document.createElement("a");
  a.download = filename;
  a.href = out.toDataURL("image/png");
  a.click();
}