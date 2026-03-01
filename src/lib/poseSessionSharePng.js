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
  
function wrapTextLines(ctx, str, maxWidth, font) {
  const s = String(str || "").trim();
  if (!s) return [];
  ctx.save();
  ctx.font = font;
  const words = s.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? (line + " " + w) : w;
    const width = ctx.measureText(test).width;
    if (width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

function normalizeBullets(arr, max = 4) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => (typeof x === "string" ? x : (x?.v || x?.k || "")))
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function orderedMuscleRows(ms) {
  const m = ms || {};
  // 0..1 friendly signals
  return [
    { key: "chest", label: "Chest" },
    { key: "delts", label: "Shoulders" },
    { key: "arms", label: "Arms" },
    { key: "lats", label: "Lats" },
    { key: "back", label: "Back" },
    { key: "waist_taper", label: "Waist Taper" },
    { key: "legs", label: "Legs" },
  ].map((r) => ({ ...r, v: clamp(m[r.key] ?? 0, 0, 1) }));
}

function deltaLabel(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return "locked";
  // Positive-only language: never show negative numbers.
  if (n >= 0.015) return `+${Math.round(n * 100)}%`;
  if (n >= 0.005) return "+1%";
  if (n >= 0) return "locked";
  return "steady";
}
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
  const wins = normalizeBullets(data?.wins, 4);
  const levers = normalizeBullets(data?.levers, 3);
  const poseImages = Array.isArray(data?.pose_images)
    ? data.pose_images.slice(0, 3)
    : (Array.isArray(data?.poseImages) ? data.poseImages.slice(0, 3) : []);
  const headline = String(data?.headline ?? "").slice(0, 80);
  const subhead = String(data?.subhead ?? "").slice(0, 140);
  const summary = String(data?.summary ?? "").slice(0, 200);
  const muscleSignals = data?.muscleSignals || data?.muscle_signals || {};
  const prevMuscleSignals = data?.prevMuscleSignals || data?.prev_muscle_signals || {};

  async function loadImg(src) {
    if (!src) return null;
    return await new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
    });
  }

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

  if (headline) {
    text(ctx, headline, 90, 190, 28, "rgba(255,255,255,0.92)", 850, "left", 10);
  }
  if (subhead) {
    text(ctx, subhead, 90, 226, 22, "rgba(255,255,255,0.72)", 750);
  }

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
  const cardY = 280;
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
  // Affirmation summary (positive-only)
  if (summary) {
    const font = `800 22px system-ui, -apple-system, Segoe UI, Roboto`;
    const lines = wrapTextLines(ctx, summary, cardW - 140, font).slice(0, 2);
    const sy = cardY + 370;
    text(ctx, lines[0] || "", cardX + 70, sy, 22, "rgba(255,255,255,0.74)", 800);
    if (lines[1]) text(ctx, lines[1], cardX + 70, sy + 30, 22, "rgba(255,255,255,0.74)", 800);
  }


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

  // Pose strip (3 thumbnails)
  if (poseImages.length) {
    const thumbs = await Promise.all(poseImages.map(loadImg));
    const tY = cardY + 430;
    const tW = (cardW - 70 * 2 - 24 * 2) / 3;
    const tH = 190;
    for (let i = 0; i < 3; i++) {
      const im = thumbs[i];
      if (!im) continue;
      const x = cardX + 70 + i * (tW + 24);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.strokeStyle = "rgba(120,255,180,0.22)";
      ctx.lineWidth = 2;
      roundRect(ctx, x, tY, tW, tH, 24);
      ctx.fill();
      ctx.stroke();
      ctx.clip();
      // cover crop
      const ar = im.width / im.height;
      const tr = tW / tH;
      let dw = tW,
        dh = tH,
        dx = x,
        dy = tY;
      if (ar > tr) {
        dh = tH;
        dw = dh * ar;
        dx = x - (dw - tW) / 2;
      } else {
        dw = tW;
        dh = dw / ar;
        dy = tY - (dh - tH) / 2;
      }
      ctx.drawImage(im, dx, dy, dw, dh);
      ctx.restore();
    }

    // Results sections (wins → levers → muscle breakdown)
  const sectionY = poseImages.length ? (cardY + 640) : (cardY + 420);

  // Momentum wins
  text(ctx, "MOMENTUM WINS", cardX + 70, sectionY, 24, "rgba(255,255,255,0.72)", 900);
  let y = sectionY + 46;
  wins.slice(0, 3).forEach((w) => {
    text(ctx, "•", cardX + 70, y, 28, "rgba(140,255,200,0.95)", 950);
    text(ctx, String(w).slice(0, 46), cardX + 92, y, 24, "rgba(255,255,255,0.84)", 850);
    y += 38;
  });

  // Next unlock
  if (levers.length) {
    y += 10;
    text(ctx, "NEXT UNLOCK", cardX + 70, y, 24, "rgba(255,255,255,0.72)", 900);
    y += 46;
    levers.slice(0, 2).forEach((w) => {
      text(ctx, "•", cardX + 70, y, 28, "rgba(70,140,255,0.95)", 950);
      text(ctx, String(w).slice(0, 46), cardX + 92, y, 24, "rgba(255,255,255,0.84)", 850);
      y += 38;
    });
  }

  // Muscle breakdown (positive-only movement)
  y += 18;
  text(ctx, "MUSCLE ARC", cardX + 70, y, 24, "rgba(255,255,255,0.72)", 900);
  y += 44;

  const rows = orderedMuscleRows(muscleSignals);
  const prevRows = orderedMuscleRows(prevMuscleSignals).reduce((acc, r) => {
    acc[r.key] = r.v;
    return acc;
  }, {});
  const barX = cardX + 220;
  const barW = cardW - 70 - (barX - cardX) - 110;
  const barH = 16;

  // Pick the top 5 by positive movement (fallback: top signal)
  const ranked = rows
    .map((r) => ({ ...r, d: (r.v - (prevRows[r.key] ?? 0)) }))
    .sort((a, b) => (b.d - a.d) || (b.v - a.v))
    .slice(0, 5);

  ranked.forEach((r) => {
    text(ctx, r.label, cardX + 70, y + 4, 22, "rgba(255,255,255,0.82)", 850);
    // bar bg
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    roundRect(ctx, barX, y - 8, barW, barH, 999);
    ctx.fill();
    // bar fill
    const fillW = Math.max(8, Math.floor(barW * clamp(r.v, 0, 1)));
    ctx.fillStyle = "rgba(140,255,200,0.85)";
    roundRect(ctx, barX, y - 8, fillW, barH, 999);
    ctx.fill();
    ctx.restore();

    // delta (never negative)
    const dTxt = deltaLabel(r.d);
    text(ctx, dTxt, cardX + cardW - 70, y + 4, 22, "rgba(140,255,200,0.95)", 950, "right");
    y += 38;
  });


  // Footer branding
  text(ctx, "Slimcal.ai", 90, H - 110, 28, "rgba(255,255,255,0.60)", 900);
  text(ctx, "POSE SESSION", W - 90, H - 110, 22, "rgba(170,255,210,0.65)", 900, "right");

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
  return blob;
}
}