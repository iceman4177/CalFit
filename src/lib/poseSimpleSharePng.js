// src/lib/poseSimpleSharePng.js
// Minimal, stable share card generator for the SIMPLE Pose Session flow.
// - Uses 3 pose images (data URLs)
// - Neutral/positive tone only
// - Returns a PNG data URL

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

async function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

export async function buildPoseSimpleSharePng({
  brand = 'Slimcal.ai',
  tier = 'BASELINE LOCKED',
  score10 = 8.0,
  summary = "",
  bullets = [],
  poseImages = [],
} = {}) {
  const W = 1080;
  const H = 1350;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // Background
  ctx.fillStyle = '#04070b';
  ctx.fillRect(0, 0, W, H);

  // Glow
  const g = ctx.createRadialGradient(W * 0.5, H * 0.18, 40, W * 0.5, H * 0.18, H * 0.9);
  g.addColorStop(0, 'rgba(0,255,190,0.16)');
  g.addColorStop(0.55, 'rgba(0,255,190,0.04)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const pad = 60;
  const cardX = pad;
  const cardY = pad;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;

  // Outer card
  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 44);
  ctx.fillStyle = 'rgba(10,14,20,0.90)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,255,190,0.18)';
  ctx.stroke();
  ctx.restore();

  // Header
  ctx.fillStyle = 'rgba(233,255,248,0.92)';
  ctx.font = '900 56px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText(String(brand).slice(0, 24), cardX + 26, cardY + 92);

  // Tier
  ctx.fillStyle = 'rgba(0,255,190,0.95)';
  ctx.font = '900 42px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText(String(tier).slice(0, 26), cardX + 26, cardY + 148);

  // Score pill
  const pillX = cardX + 26;
  const pillY = cardY + 170;
  const pillW = 520;
  const pillH = 70;
  ctx.save();
  roundRectPath(ctx, pillX, pillY, pillW, pillH, 999);
  const gg = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY);
  gg.addColorStop(0, 'rgba(0,255,190,0.26)');
  gg.addColorStop(1, 'rgba(0,200,255,0.18)');
  ctx.fillStyle = gg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,255,190,0.22)';
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(233,255,248,0.92)';
  ctx.font = '900 30px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText(`AESTHETIC: ${Number(score10).toFixed(1)}/10`, pillX + 22, pillY + 46);

  // Images row
  const imgTop = cardY + 280;
  const imgH = 430;
  const gap = 18;
  const imgW = Math.floor((cardW - 52 - gap * 2) / 3);
  const imgX0 = cardX + 26;

  const imgs = [];
  for (let i = 0; i < 3; i++) {
    try {
      imgs.push(poseImages[i] ? await loadImage(poseImages[i]) : null);
    } catch {
      imgs.push(null);
    }
  }

  for (let i = 0; i < 3; i++) {
    const x = imgX0 + i * (imgW + gap);
    const y = imgTop;

    ctx.save();
    roundRectPath(ctx, x, y, imgW, imgH, 28);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.clip();

    if (imgs[i]) {
      drawCover(ctx, imgs[i], x, y, imgW, imgH);
    } else {
      ctx.fillStyle = 'rgba(0,255,190,0.08)';
      ctx.fillRect(x, y, imgW, imgH);
    }

    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x, y, imgW, imgH, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,255,190,0.22)';
    ctx.stroke();
    ctx.restore();
  }


  // Short share summary (one line)
  const shareSummary = String(summary || "").trim();
  if (shareSummary) {
    const line = shareSummary.length > 92 ? shareSummary.slice(0, 92) + "…" : shareSummary;
    ctx.fillStyle = 'rgba(233,255,248,0.84)';
    ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(line, cardX + 26, imgTop + imgH + 36);
  }

  // Bullets
  let y = imgTop + imgH + 72;
  ctx.fillStyle = 'rgba(233,255,248,0.92)';
  ctx.font = '900 34px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText("WHAT'S POPPING", cardX + 26, y);
  y += 18;

  const shown = (bullets || []).filter(Boolean).slice(0, 3);
  ctx.font = '800 28px system-ui, -apple-system, Segoe UI, Roboto';
  for (const b of shown) {
    y += 52;
    ctx.save();
    roundRectPath(ctx, cardX + 26, y - 36, cardW - 52, 64, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,255,190,0.16)';
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(233,255,248,0.92)';
    ctx.fillText(String(b).slice(0, 56), cardX + 26 + 18, y);
  }

  // Footer
  const foot = 'Drop your Build Arc — #SlimcalAI';
  ctx.fillStyle = 'rgba(233,255,248,0.70)';
  ctx.font = '800 22px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText(foot, cardX + 26, cardY + cardH - 32);

  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png', 1.0));
  return blob;
}

