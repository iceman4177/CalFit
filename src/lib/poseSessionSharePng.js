// src/lib/poseSessionSharePng.js
// Zero-dependency PNG generator for Pose Session share assets.
// Uses Canvas API only. No DOM capture. Safe for Vite builds.

function clamp(n, a, b) {
  const x = Number(n);
  if (Number.isNaN(x)) return a;
  return Math.min(b, Math.max(a, x));
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGlowDot(ctx, x, y, r, color) {
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 3.2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, r * 0.35), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function text(ctx, str, x, y, size, color, weight = 800, align = "left", glow = 0) {
  ctx.save();
  ctx.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, Roboto`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  if (glow && glow > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
  }
  ctx.fillText(str, x, y);
  ctx.restore();
}

export async function buildPoseSessionSharePng(data, opts = {}) {
  const W = opts.width || 1080;
  const H = opts.height || 1350;

  const buildArc = clamp(data?.build_arc ?? 80, 0, 100);
  const percentile = clamp(data?.percentile ?? 20, 1, 99);
  const strength = String(data?.strength ?? "Consistency").slice(0, 28);
  const horizon = clamp(data?.horizon_days ?? 90, 7, 365);
  const poseCount = clamp(data?.pose_count ?? 3, 1, 10);
  const streak = clamp(data?.streak_count ?? 1, 1, 999);
  const since = clamp(data?.since_points ?? 0, 0, 99);
  const wins = Array.isArray(data?.wins) ? data.wins.slice(0, 4) : [];

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#05070C");
  bg.addColorStop(0.55, "#070B14");
  bg.addColorStop(1, "#04060A");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Star dust
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 1.6;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Accent glows
  drawGlowDot(ctx, W * 0.18, H * 0.22, 16, "rgba(120,255,180,1)");
  drawGlowDot(ctx, W * 0.78, H * 0.34, 14, "rgba(70,140,255,1)");
  drawGlowDot(ctx, W * 0.55, H * 0.74, 12, "rgba(120,255,180,1)");

  // Header
  text(ctx, "POSE SESSION", 90, 90, 46, "rgba(140,255,200,0.98)", 950, "left", 18);
  text(ctx, `3 poses • auto‑capture • week‑over‑week wins`, 90, 152, 26, "rgba(240,255,252,0.90)", 750);

  // Streak chip
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  roundRect(ctx, W - 350, 92, 260, 58, 999);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  text(ctx, `STREAK ${streak}×`, W - 220, 106, 26, "rgba(240,255,252,0.94)", 950, "center", 10);

  // Main card
  const cardX = 90;
  const cardY = 240;
  const cardW = W - 180;
  const cardH = 760;

  // Card bg
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(0,0,0,0.40)";
  ctx.strokeStyle = "rgba(120,255,180,0.22)";
  ctx.lineWidth = 2;
  roundRect(ctx, cardX, cardY, cardW, cardH, 44);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Build Arc block
  text(ctx, "BUILD ARC", cardX + 70, cardY + 70, 32, "rgba(140,255,200,0.98)", 950, "left", 14);
  text(ctx, `${buildArc}/100`, cardX + 70, cardY + 118, 102, "rgba(240,255,252,0.98)", 980, "left", 18);
  text(ctx, `Top ${percentile}%`, cardX + 70, cardY + 236, 34, "rgba(140,255,200,0.96)", 900, "left", 12);
  text(ctx, `Strength: ${strength}`, cardX + 70, cardY + 292, 28, "rgba(240,255,252,0.92)", 850);
  text(ctx, `${horizon}-Day upgrade horizon`, cardX + 70, cardY + 334, 22, "rgba(240,255,252,0.74)", 720);

  // Pose count pill
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  roundRect(ctx, cardX + cardW - 300, cardY + 70, 210, 56, 999);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  text(ctx, `${poseCount} poses`, cardX + cardW - 195, cardY + 83, 26, "rgba(255,255,255,0.88)", 900, "center");

  // Since last (positive-only)
  if (since > 0) {
    ctx.save();
    ctx.fillStyle = "rgba(120,255,180,0.10)";
    ctx.strokeStyle = "rgba(120,255,180,0.22)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, cardX + cardW - 300, cardY + 140, 210, 56, 999);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    text(ctx, `+${since} pts`, cardX + cardW - 195, cardY + 153, 26, "rgba(140,255,200,0.98)", 950, "center", 12);
  }

  // Divider line
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 70, cardY + 390);
  ctx.lineTo(cardX + cardW - 70, cardY + 390);
  ctx.stroke();
  ctx.restore();

  // Highlights
  text(ctx, "HIGHLIGHTS", cardX + 70, cardY + 420, 24, "rgba(255,255,255,0.72)", 900);
  let y = cardY + 468;
  wins.forEach((w) => {
    const k = String(w?.k ?? "").slice(0, 18);
    const v = String(w?.v ?? "").slice(0, 18);
    text(ctx, k, cardX + 70, y, 28, "rgba(255,255,255,0.82)", 850);
    text(ctx, v, cardX + cardW - 70, y, 28, "rgba(170,255,210,0.95)", 950, "right");
    y += 52;
  });

  // Bottom CTA bar
  const barY = cardY + cardH - 140;
  ctx.save();
  ctx.fillStyle = "rgba(70,140,255,0.16)";
  ctx.strokeStyle = "rgba(70,140,255,0.32)";
  ctx.lineWidth = 2;
  roundRect(ctx, cardX + 70, barY, cardW - 140, 92, 28);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  text(ctx, "Share your arc → #SlimcalAI", cardX + cardW / 2, barY + 26, 30, "rgba(255,255,255,0.92)", 900, "center");

  // Footer branding
  text(ctx, "Slimcal.ai", 90, H - 110, 28, "rgba(255,255,255,0.60)", 900);
  text(ctx, "POSE SESSION", W - 90, H - 110, 22, "rgba(170,255,210,0.65)", 900, "right");

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
  return blob;
}
