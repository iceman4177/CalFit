// src/lib/poseSessionSharePng.js
// Zero-dependency PNG generator for Pose Session share assets (story card).
// Uses Canvas API only. Safe for Vite/Rollup builds.

function clamp(n, a, b) {
  const x = Number(n);
  if (Number.isNaN(x)) return a;
  return Math.min(b, Math.max(a, x));
}

function fmtPct(x) {
  const v = clamp(x, 0, 100);
  return `${Math.round(v)}%`;
}

function fmtNum(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString();
}

async function loadImage(src) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGlowText(ctx, text, x, y, opts = {}) {
  const { font = "900 56px system-ui", fill = "#eafffb", glow = "rgba(0,255,190,0.35)" } = opts;
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.fillStyle = fill;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 18;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawCoverImage(ctx, img, dx, dy, dw, dh) {
  // cover-crop the image into the destination rect
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const sAR = sw / sh;
  const dAR = dw / dh;

  let sx = 0, sy = 0, sW = sw, sH = sh;
  if (sAR > dAR) {
    // source wider -> crop left/right
    sW = sh * dAR;
    sx = (sw - sW) / 2;
  } else {
    // source taller -> crop top/bottom
    sH = sw / dAR;
    sy = (sh - sH) / 2;
  }
  ctx.drawImage(img, sx, sy, sW, sH, dx, dy, dw, dh);
}

export async function buildPoseSessionSharePng({
  headline = "POSE SESSION",
  subhead = "",
  buildArc = "Build Arc",
  percentile = 0,
  strength = 0,
  streakCount = 0,
  sincePoints = 0,
  wins = [],
  levers = [],
  poseImages = [],
} = {}) {
  const W = 1080;
  const H = 1920;

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  // Background gradient
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#05070a");
  g.addColorStop(0.55, "#060b10");
  g.addColorStop(1, "#05070a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Neon grid hint
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = "rgba(0,255,190,1)";
  for (let y = 140; y < H; y += 80) {
    ctx.beginPath();
    ctx.moveTo(80, y);
    ctx.lineTo(W - 80, y);
    ctx.stroke();
  }
  ctx.restore();

  // Header
  drawGlowText(ctx, headline, 72, 70, { font: "900 54px system-ui" });
  ctx.save();
  ctx.font = "700 24px system-ui";
  ctx.fillStyle = "rgba(220,255,245,0.90)";
  ctx.fillText(subhead || "Progress update", 72, 132);
  ctx.restore();

  // Main stats card
  const cardX = 72, cardY = 190, cardW = W - 144, cardH = 260;
  ctx.save();
  ctx.shadowColor = "rgba(0,255,190,0.20)";
  ctx.shadowBlur = 22;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundedRect(ctx, cardX, cardY, cardW, cardH, 32);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(0,255,190,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = "900 34px system-ui";
  ctx.fillStyle = "#eafffb";
  ctx.fillText(String(buildArc || "Build Arc").toUpperCase(), cardX + 28, cardY + 26);

  ctx.font = "800 22px system-ui";
  ctx.fillStyle = "rgba(220,255,245,0.88)";
  ctx.fillText("Percentile", cardX + 28, cardY + 86);
  ctx.fillText("Strength", cardX + 280, cardY + 86);
  ctx.fillText("Streak", cardX + 520, cardY + 86);

  ctx.font = "900 42px system-ui";
  ctx.fillStyle = "#eafffb";
  ctx.fillText(fmtPct(percentile), cardX + 28, cardY + 118);
  ctx.fillText(fmtNum(strength), cardX + 280, cardY + 118);
  ctx.fillText(`${fmtNum(streakCount)}d`, cardX + 520, cardY + 118);

  ctx.font = "800 22px system-ui";
  ctx.fillStyle = "rgba(220,255,245,0.86)";
  ctx.fillText(`+${fmtNum(sincePoints)} pts since last`, cardX + 28, cardY + 186);
  ctx.restore();

  // Pose images strip
  const stripX = 72, stripY = 490, stripW = W - 144, stripH = 760;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.50)";
  roundedRect(ctx, stripX, stripY, stripW, stripH, 34);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,255,190,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const imgs = (poseImages || []).filter(Boolean).slice(0, 3);
  const slotGap = 18;
  const slotW = (stripW - slotGap * 4) / 3;
  const slotH = stripH - slotGap * 2;
  const slotY = stripY + slotGap;

  for (let i = 0; i < 3; i++) {
    const slotX = stripX + slotGap + i * (slotW + slotGap);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    roundedRect(ctx, slotX, slotY, slotW, slotH, 26);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,255,190,0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();

    if (imgs[i]) {
      try {
        const img = await loadImage(imgs[i]);
        drawCoverImage(ctx, img, slotX, slotY, slotW, slotH);
      } catch {
        // ignore image load failures
      }
    } else {
      ctx.fillStyle = "rgba(220,255,245,0.20)";
      ctx.font = "900 26px system-ui";
      ctx.fillText("POSE", slotX + 24, slotY + 24);
    }
    ctx.restore();
  }

  // Bottom advice card
  const tipsX = 72, tipsY = 1280, tipsW = W - 144, tipsH = 520;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundedRect(ctx, tipsX, tipsY, tipsW, tipsH, 34);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,255,190,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = "900 34px system-ui";
  ctx.fillStyle = "#eafffb";
  ctx.fillText("TODAY’S WINS", tipsX + 28, tipsY + 26);
  ctx.font = "800 24px system-ui";
  ctx.fillStyle = "rgba(220,255,245,0.90)";

  const wLines = (Array.isArray(wins) ? wins : []).slice(0, 4);
  let y = tipsY + 78;
  for (const w of wLines) {
    ctx.fillText(`• ${String(w)}`, tipsX + 28, y);
    y += 46;
  }

  ctx.font = "900 34px system-ui";
  ctx.fillStyle = "#eafffb";
  ctx.fillText("NEXT LEVERS", tipsX + 28, y + 18);
  ctx.font = "800 24px system-ui";
  ctx.fillStyle = "rgba(220,255,245,0.90)";
  y += 70;

  const lLines = (Array.isArray(levers) ? levers : []).slice(0, 4);
  for (const l of lLines) {
    ctx.fillText(`• ${String(l)}`, tipsX + 28, y);
    y += 46;
  }
  ctx.restore();

  // Footer mark
  ctx.save();
  ctx.font = "800 22px system-ui";
  ctx.fillStyle = "rgba(220,255,245,0.65)";
  ctx.fillText("slimcal.ai", 72, H - 54);
  ctx.restore();

  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  return blob;
}
