// src/lib/poseSessionSharePng.js
// Zero-dependency PNG generator for Pose Session share assets.
// Uses Canvas API only. No DOM capture. Safe for Vite builds.

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
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

function drawGlow(ctx, cx, cy, radius, rgb, alpha = 0.22) {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

/**
 * @returns {Promise<Blob>}
 */
export async function buildPoseSessionSharePng(data, opts = {}) {
  const W = 1080;
  const H = 1920; // story-friendly

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
  bg.addColorStop(0, "#05070C");
  bg.addColorStop(0.55, "#07142A");
  bg.addColorStop(1, "#04060A");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Glows (matrix vibe)
  drawGlow(ctx, W * 0.22, H * 0.18, 420, "34,197,94", 0.18);
  drawGlow(ctx, W * 0.82, H * 0.24, 520, "59,130,246", 0.16);
  drawGlow(ctx, W * 0.65, H * 0.72, 640, "34,197,94", 0.12);

  const pad = 84;
  const buildArc = clamp(data?.buildArc ?? data?.build_arc ?? 78, 0, 100);
  const percentile = clamp(data?.percentile ?? 22, 1, 99);
  const strength = String(data?.strength ?? "Momentum").slice(0, 28);
  const streak = clamp(data?.streakCount ?? data?.streak_count ?? 1, 1, 999);
  const headline = String(data?.headline ?? "POSE SESSION").slice(0, 36);
  const subhead = String(data?.subhead ?? "Baseline locked ✅").slice(0, 140);
  const wins = Array.isArray(data?.wins) ? data.wins.slice(0, 4) : [];
  const levers = Array.isArray(data?.levers) ? data.levers.slice(0, 3) : [];
  const poseImages = Array.isArray(data?.poseImages)
    ? data.poseImages.slice(0, 3)
    : (Array.isArray(data?.pose_images) ? data.pose_images.slice(0, 3) : []);

  // Header
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = "900 64px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(headline, pad, pad + 54);

  ctx.fillStyle = "rgba(240,255,252,0.72)";
  ctx.font = "600 30px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("powered by SlimCal", pad, pad + 98);

  // Streak pill
  const pillText = `STREAK ${streak}×`;
  ctx.font = "900 34px system-ui, -apple-system, Segoe UI, Roboto";
  const pillW = Math.max(260, ctx.measureText(pillText).width + 64);
  const pillH = 64;
  const pillX = W - pad - pillW;
  const pillY = pad + 18;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, pillX, pillY, pillW, pillH, 999);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  roundRect(ctx, pillX, pillY, pillW, pillH, 999);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#22c55e";
  ctx.fillText(pillText, pillX + 32, pillY + 44);

  // Main score
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.font = "900 160px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(`${Math.round(buildArc)}/100`, pad, pad + 340);

  ctx.fillStyle = "rgba(140,255,200,0.92)";
  ctx.font = "900 44px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(`BUILD ARC • Top ${Math.round(percentile)}%`, pad, pad + 410);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "650 32px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(`Strength: ${strength}`, pad, pad + 460);

  // Subhead (wrap-ish)
  const sub = subhead.trim();
  if (sub) {
    ctx.fillStyle = "rgba(240,255,252,0.78)";
    ctx.font = "650 30px system-ui, -apple-system, Segoe UI, Roboto";
    const maxW = W - pad * 2;
    const words = sub.split(/\s+/).filter(Boolean);
    let line = "";
    let y = pad + 520;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxW) {
        line = test;
      } else {
        ctx.fillText(line, pad, y);
        y += 38;
        line = w;
      }
      if (y > pad + 590) break;
    }
    if (line && y <= pad + 590) ctx.fillText(line, pad, y);
  }

  // Pose image strip
  const stripY = 740;
  const stripH = 520;
  const gap = 18;
  const cardW = (W - pad * 2 - gap * 2) / 3;
  const cardH = stripH;
  const imgs = await Promise.all(poseImages.map(loadImg));
  for (let i = 0; i < 3; i++) {
    const x = pad + i * (cardW + gap);
    const y = stripY;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.strokeStyle = "rgba(120,255,180,0.22)";
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, cardW, cardH, 34);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const im = imgs[i];
    if (im) {
      // cover
      const iw = im.naturalWidth || im.width;
      const ih = im.naturalHeight || im.height;
      const scale = Math.max(cardW / iw, cardH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = x + (cardW - dw) / 2;
      const dy = y + (cardH - dh) / 2;
      ctx.save();
      roundRect(ctx, x, y, cardW, cardH, 34);
      ctx.clip();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(im, dx, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText("POSE", x + 28, y + 28);
    }
  }

  // Wins / Next levers
  const boxY = 1320;
  const boxH = 420;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.36)";
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  roundRect(ctx, pad, boxY, W - pad * 2, boxH, 44);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(140,255,200,0.92)";
  ctx.font = "900 36px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("WINS", pad + 34, boxY + 36);
  ctx.fillStyle = "rgba(240,255,252,0.86)";
  ctx.font = "750 28px system-ui, -apple-system, Segoe UI, Roboto";
  let y = boxY + 92;
  for (const w of wins) {
    ctx.fillText(`• ${String(w).slice(0, 60)}`, pad + 34, y);
    y += 40;
    if (y > boxY + 220) break;
  }

  ctx.fillStyle = "rgba(59,130,246,0.92)";
  ctx.font = "900 36px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("NEXT", pad + 34, boxY + 248);
  ctx.fillStyle = "rgba(240,255,252,0.82)";
  ctx.font = "750 28px system-ui, -apple-system, Segoe UI, Roboto";
  y = boxY + 304;
  for (const l of levers) {
    ctx.fillText(`• ${String(l).slice(0, 60)}`, pad + 34, y);
    y += 40;
    if (y > boxY + 390) break;
  }

  // Footer tag
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.font = "700 26px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("slimcal.ai • share your build arc", pad, H - 56);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1.0));
  return blob;
}
