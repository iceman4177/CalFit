// src/lib/poseSessionSharePng.js
// Zero-dependency PNG generator for Pose Session share assets (9:16 story card).
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

function drawGlow(ctx, cx, cy, radius, color, alpha = 0.22) {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, `rgba(${color}, ${alpha})`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

async function loadImageFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function drawImageCover(ctx, img, x, y, w, h) {
  if (!img) return;
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export async function buildPoseSessionSharePng(data, opts = {}) {
  const W = 1080;
  const H = 1920;

  const dpr = clamp(opts.pixelRatio || 2, 1, 3);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#060b13");
  bg.addColorStop(0.6, "#071a2b");
  bg.addColorStop(1, "#03060c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Glows (neon / matrix vibe)
  drawGlow(ctx, W * 0.22, H * 0.18, 420, "0,255,190", 0.18);
  drawGlow(ctx, W * 0.80, H * 0.28, 520, "59,130,246", 0.16);
  drawGlow(ctx, W * 0.60, H * 0.78, 620, "168,85,247", 0.14);

  const pad = 84;

  // Header
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "900 66px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(String(data?.headline || "POSE SESSION").toUpperCase(), pad, pad + 58);

  ctx.fillStyle = "rgba(220,255,245,0.72)";
  ctx.font = "600 30px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("powered by SlimCal", pad, pad + 102);

  // Score row
  const buildArc = clamp(data?.buildArc ?? 78, 0, 100);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.font = "900 150px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`${Math.round(buildArc)}/100`, pad, pad + 320);

  ctx.fillStyle = "rgba(220,255,245,0.78)";
  ctx.font = "800 44px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(String(data?.strength || "Momentum"), pad, pad + 386);

  // Meta pills
  const percentile = clamp(data?.percentile ?? 22, 1, 99);
  const streak = clamp(data?.streakCount ?? 1, 1, 999);
  ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";

  const pills = [
    `Top ${percentile}%`,
    `${streak} day streak`,
    `+${Math.max(0, Math.round(data?.sincePoints ?? 0))} pts`,
  ];

  let px = pad;
  const py = pad + 430;
  for (const txt of pills) {
    const tw = ctx.measureText(txt).width;
    const pw = tw + 54;
    const ph = 64;
    ctx.save();
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, px, py, pw, ph, 999);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(0,255,190,0.22)";
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, pw, ph, 999);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(234,255,251,0.95)";
    ctx.fillText(txt, px + 26, py + 44);
    px += pw + 16;
  }

  // Subhead / hype
  const sub = String(data?.subhead || "").trim();
  if (sub) {
    ctx.fillStyle = "rgba(220,255,245,0.78)";
    ctx.font = "650 36px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    // simple wrap (2 lines max)
    const maxW = W - pad * 2;
    const words = sub.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? cur + " " + w : w;
      if (ctx.measureText(cand).width <= maxW || !cur) cur = cand;
      else { lines.push(cur); cur = w; }
      if (lines.length >= 2) break;
    }
    if (cur && lines.length < 2) lines.push(cur);

    const y0 = pad + 540;
    lines.forEach((ln, i) => ctx.fillText(ln, pad, y0 + i * 46));
  }

  // Pose image strip (3 panels)
  const imgs = Array.isArray(data?.poseImages) ? data.poseImages.slice(0, 3) : [];
  const loaded = await Promise.all(imgs.map(loadImageFromDataUrl));

  const stripY = pad + 650;
  const stripH = 560;
  const gap = 18;
  const tileW = Math.floor((W - pad * 2 - gap * 2) / 3);
  const tileH = stripH;

  for (let i = 0; i < 3; i++) {
    const x = pad + i * (tileW + gap);
    const y = stripY;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, x, y, tileW, tileH, 28);
    ctx.fill();
    ctx.clip();
    drawImageCover(ctx, loaded[i], x, y, tileW, tileH);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(0,255,190,0.18)";
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, tileW, tileH, 28);
    ctx.stroke();
    ctx.restore();
  }

  // Wins + levers panels
  const wins = Array.isArray(data?.wins) ? data.wins.slice(0, 2) : [];
  const levers = Array.isArray(data?.levers) ? data.levers.slice(0, 2) : [];

  const panelY = stripY + stripH + 42;
  const panelH = 420;
  const panelW = (W - pad * 2 - 24) / 2;

  function drawListPanel(title, items, x, y) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    roundRect(ctx, x, y, panelW, panelH, 28);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, panelW, panelH, 28);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "900 44px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(title, x + 34, y + 72);

    ctx.fillStyle = "rgba(220,255,245,0.82)";
    ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    let yy = y + 128;
    const bullet = "• ";
    items.forEach((it) => {
      const txt = String(it || "").trim();
      if (!txt) return;
      ctx.fillText(bullet + txt, x + 34, yy);
      yy += 54;
    });

    ctx.restore();
  }

  drawListPanel("WINS", wins, pad, panelY);
  drawListPanel("NEXT", levers, pad + panelW + 24, panelY);

  // Footer tag
  ctx.fillStyle = "rgba(220,255,245,0.50)";
  ctx.font = "700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("#SlimcalAI", pad, H - 60);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob;
}
