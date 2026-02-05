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
};

export default function ConeCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, props.width, props.height);
    if (!props.srcPoint) return;

    // marker
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(props.srcPoint.x, props.srcPoint.y, 7, 0, Math.PI * 2);
    ctx.fill();

    if (!props.wind) return;

    const mph = mpsToMph(props.wind.wind_speed_mps);
    const halfAngle =
      props.halfAngleDeg === "auto" ? defaultHalfAngleDegFromMph(mph) : props.halfAngleDeg;

    const g = computeCone(props.srcPoint, props.lengthPx, halfAngle, props.wind.wind_dir_from_deg);

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
    ctx.setLineDash([]);

    // label
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(12, 12, 520, 68);
    ctx.fillStyle = "white";
    ctx.font = "16px system-ui";
    ctx.fillText(`Wind from ${Math.round(props.wind.wind_dir_from_deg)}° @ ${mph.toFixed(1)} mph`, 20, 38);
    ctx.font = "13px system-ui";
    ctx.fillText(props.label || "Visual cone overlay (planning estimate)", 20, 60);
  }, [props.width, props.height, props.srcPoint, props.wind, props.lengthPx, props.halfAngleDeg, props.label]);

  return (
    <canvas
      ref={ref}
      width={props.width}
      height={props.height}
      style={{ width: "100%", height: "100%", borderRadius: 16 }}
    />
  );
}
