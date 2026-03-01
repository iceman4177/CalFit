// src/lib/poseSessionSharePng.js
// Zero-dependency PNG generator for Pose Session share assets.
// Uses Canvas API only. Safe for Vite builds.

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
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
  ctx.fillText(String(str ?? ""), x, y);
  ctx.restore();
}

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

function drawImageCover(ctx, im, x, y, w, h) {
  if (!im) return;
  const iw = im.naturalWidth || im.width || 1;
  const ih = im.naturalHeight || im.height || 1;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h);
}

export async function buildPoseSessionSharePng(data, opts = {}) {
  const W = opts.width || 1080;
  const H = opts.height || 1350;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  // Background
  ctx.fillStyle = "#05080e";
  ctx.fillRect(0, 0, W, H);

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "rgba(0,255,190,0.14)");
  g.addColorStop(0.6, "rgba(0,160,255,0.08)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Card container
  const pad = 64;
  const cardX = pad;
  const cardY = pad;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;

  ctx.save();
  ctx.fillStyle = "rgba(10,14,22,0.86)";
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.fill();
  ctx.restore();

  // Header
  text(ctx, "Slimcal.ai", cardX + 44, cardY + 36, 28, "rgba(255,255,255,0.75)", 900, "left", 6);
  text(ctx, String(data?.headline ?? "POSE SESSION").toUpperCase(), cardX + cardW - 44, cardY + 36, 22, "rgba(120,255,205,0.85)", 900, "right", 6);

  // Big score
  const buildArc = clamp(data?.buildArc ?? data?.build_arc ?? 80, 0, 100);
  const percentile = clamp(data?.percentile ?? 20, 1, 99);
  const strength = String(data?.strength ?? "Momentum").slice(0, 24);

  text(ctx, `${Math.round(buildArc)}`, cardX + 44, cardY + 92, 110, "rgba(255,255,255,0.92)", 950, "left", 10);
  text(ctx, "Build Arc", cardX + 44, cardY + 210, 26, "rgba(255,255,255,0.62)", 850);
  text(ctx, `${Math.round(percentile)}th percentile`, cardX + 44, cardY + 246, 24, "rgba(120,255,205,0.72)", 850);

  // Strength pill
  const pillX = cardX + 44;
  const pillY = cardY + 290;
  const pillW = Math.min(520, cardW - 88);
  const pillH = 56;
  ctx.save();
  ctx.fillStyle = "rgba(0,255,190,0.12)";
  roundRect(ctx, pillX, pillY, pillW, pillH, 999);
  ctx.fill();
  ctx.restore();
  text(ctx, `Strength: ${strength}`, pillX + 22, pillY + 16, 22, "rgba(210,255,235,0.92)", 850);

  // Subhead
  const sub = String(data?.subhead ?? "").slice(0, 180);
  const font = "800 26px system-ui, -apple-system, Segoe UI, Roboto";
  const lines = wrapTextLines(ctx, sub, cardW - 88, font).slice(0, 3);
  let y = pillY + pillH + 28;
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const ln of lines) {
    ctx.fillText(ln, cardX + 44, y);
    y += 34;
  }
  ctx.restore();

  // Pose images (3 across)
  const poseImages = Array.isArray(data?.poseImages) ? data.poseImages
    : (Array.isArray(data?.pose_images) ? data.pose_images : (Array.isArray(data?.poseImages) ? data.poseImages : []));
  const imgs = await Promise.all((poseImages || []).slice(0, 3).map(loadImg));
  const gridY = y + 18;
  const gap = 18;
  const cellW = Math.floor((cardW - 88 - gap * 2) / 3);
  const cellH = Math.floor(cellW * 1.25);
  for (let i = 0; i < 3; i++) {
    const x = cardX + 44 + i * (cellW + gap);
    const yy = gridY;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, x, yy, cellW, cellH, 26);
    ctx.fill();
    ctx.clip();
    drawImageCover(ctx, imgs[i], x, yy, cellW, cellH);
    ctx.restore();

    // border glow
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,190,0.20)";
    ctx.lineWidth = 2;
    roundRect(ctx, x, yy, cellW, cellH, 26);
    ctx.stroke();
    ctx.restore();
  }

  // Wins / levers
  const wins = normalizeBullets(data?.wins || data?.highlights, 4);
  const levers = normalizeBullets(data?.levers || data?.nextPlan, 3);

  const listY = gridY + cellH + 26;
  text(ctx, "Wins", cardX + 44, listY, 22, "rgba(255,255,255,0.70)", 900);
  let ly = listY + 34;
  wins.forEach((w) => {
    text(ctx, `• ${w}`, cardX + 58, ly, 22, "rgba(255,255,255,0.86)", 850);
    ly += 30;
  });

  const rightX = cardX + cardW * 0.55;
  text(ctx, "Next", rightX, listY, 22, "rgba(255,255,255,0.70)", 900);
  let ry = listY + 34;
  levers.forEach((w) => {
    text(ctx, `• ${w}`, rightX + 14, ry, 22, "rgba(255,255,255,0.86)", 850);
    ry += 30;
  });

  // Footer
  const streak = clamp(data?.streakCount ?? data?.streak_count ?? 1, 1, 999);
  const since = clamp(data?.sincePoints ?? data?.since_points ?? 0, 0, 99);
  text(ctx, `Streak: ${streak} day${streak === 1 ? "" : "s"}   •   Since baseline: +${since}`, cardX + 44, cardY + cardH - 70, 20, "rgba(255,255,255,0.60)", 850);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
  return blob;
}
