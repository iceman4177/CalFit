// src/lib/poseSessionSharePng.js
// Produces a shareable PNG for Pose Session.
// - Keeps tone neutral/positive.
// - Supports embedding the 3 captured pose images.

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

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
    img.onerror = (e) => reject(e);
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

// Backward-compatible builder.
// Newer callers (PoseSession.jsx) pass:
//   { tier, score, highlights, thumbs:[{title,dataUrl}] }
// Older callers may pass:
//   { headline, subhead, wins, levers, poseImages:[dataUrl], poseTitles:[string] }
export async function buildPoseSessionSharePng({
  // New API
  tier,
  score,
  highlights,
  thumbs,
  levers,

  // Legacy API
  headline = "POSE SESSION",
  subhead = "Baseline locked ✅",
  wins = [],
  sincePoints = 0,
  poseImages = [],
  poseTitles = [],
  localDay = "",
} = {}) {
  const W = 1080;
  const H = 1350;

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  // background
  ctx.fillStyle = "#04070b";
  ctx.fillRect(0, 0, W, H);

  // subtle neon gradient
  const g = ctx.createRadialGradient(W * 0.5, H * 0.25, 40, W * 0.5, H * 0.25, H * 0.95);
  g.addColorStop(0, "rgba(0,255,190,0.12)");
  g.addColorStop(0.55, "rgba(0,255,190,0.03)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const pad = 60;
  const cardX = pad;
  const cardY = pad;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;

  // outer card
  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 42);
  ctx.fillStyle = "rgba(10,14,20,0.88)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,255,190,0.18)";
  ctx.stroke();
  ctx.restore();

  // header
  ctx.fillStyle = "rgba(0,255,190,0.18)";
  ctx.fillRect(cardX + 26, cardY + 26, cardW - 52, 2);

  const resolvedHeadline = String(tier || headline || "POSE SESSION").toUpperCase().slice(0, 26);
  const resolvedScore = Number.isFinite(Number(score)) ? clamp(score, 0, 10) : null;
  const resolvedWins = Array.isArray(highlights) ? highlights : wins;
  const resolvedLevers = Array.isArray(levers) ? levers : [];

  ctx.fillStyle = "#E9FFF8";
  ctx.font = "900 56px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(resolvedHeadline || "POSE SESSION", cardX + 26, cardY + 98);

  ctx.fillStyle = "rgba(233,255,248,0.90)";
  ctx.font = "700 30px system-ui, -apple-system, Segoe UI, Roboto";
  const safeSub = resolvedScore !== null
    ? `AESTHETIC: ${resolvedScore.toFixed(1)}/10`
    : String(subhead || "Baseline locked ✅").slice(0, 120);
  ctx.fillText(safeSub, cardX + 26, cardY + 142);

  // optional streak delta
  if (sincePoints > 0) {
    ctx.fillStyle = "rgba(0,255,190,0.92)";
    ctx.font = "900 30px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(`+${sincePoints} levels since last`, cardX + 26, cardY + 184);
  }

  // images row
  const imgTop = cardY + 220;
  const imgH = 360;
  const gap = 18;
  const imgW = Math.floor((cardW - 52 - gap * 2) / 3);
  const imgX0 = cardX + 26;

  const poseList = Array.isArray(thumbs) && thumbs.length
    ? thumbs.slice(0, 3).map((t) => ({
        title: String(t?.title || "").slice(0, 18),
        dataUrl: String(t?.dataUrl || t?.url || ""),
      }))
    : poseImages.slice(0, 3).map((url, i) => ({
        title: String(poseTitles?.[i] || "").slice(0, 18),
        dataUrl: String(url || ""),
      }));

  const imgs = [];
  for (let i = 0; i < Math.min(3, poseList.length); i++) {
    try {
      imgs.push(await loadImage(poseList[i].dataUrl));
    } catch {
      imgs.push(null);
    }
  }

  for (let i = 0; i < 3; i++) {
    const x = imgX0 + i * (imgW + gap);
    const y = imgTop;

    ctx.save();
    roundRectPath(ctx, x, y, imgW, imgH, 28);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fill();
    ctx.clip();

    if (imgs[i]) {
      drawCover(ctx, imgs[i], x, y, imgW, imgH);
    } else {
      // fallback placeholder
      ctx.fillStyle = "rgba(0,255,190,0.08)";
      ctx.fillRect(x, y, imgW, imgH);
      ctx.fillStyle = "rgba(233,255,248,0.65)";
      ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText("Pose", x + 18, y + 44);
    }

    ctx.restore();

    // neon stroke
    ctx.save();
    roundRectPath(ctx, x, y, imgW, imgH, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,255,190,0.22)";
    ctx.stroke();
    ctx.restore();

    // label
    const lbl = String(poseList?.[i]?.title || "").slice(0, 18);
    if (lbl) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.50)";
      roundRectPath(ctx, x + 14, y + imgH - 54, Math.min(imgW - 28, 240), 40, 14);
      ctx.fill();
      ctx.fillStyle = "rgba(233,255,248,0.92)";
      ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText(lbl, x + 28, y + imgH - 26);
      ctx.restore();
    }
  }

  // sections
  const textX = cardX + 26;
  let y = imgTop + imgH + 40;

  const drawSection = (title, items, accent = "rgba(0,255,190,0.22)") => {
    ctx.fillStyle = "#E9FFF8";
    ctx.font = "900 34px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(title, textX, y);
    y += 18;

    const shown = (items || []).filter(Boolean).slice(0, 3);
    if (!shown.length) {
      y += 18;
      return;
    }

    for (const t of shown) {
      y += 22;
      const boxH = 64;
      ctx.save();
      roundRectPath(ctx, textX, y, cardW - 52, boxH, 18);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "rgba(233,255,248,0.92)";
      ctx.font = "800 26px system-ui, -apple-system, Segoe UI, Roboto";
      const line = String(t).slice(0, 60);
      ctx.fillText(line, textX + 18, y + 42);
      y += boxH;
    }

    y += 26;
  };

  drawSection("Wins", resolvedWins, "rgba(0,255,190,0.18)");
  drawSection("Next unlocks", resolvedLevers, "rgba(0,255,255,0.18)");

  // NOTE: The prior implementation attempted to render optional signal bars but
  // referenced undefined variables (muscleSignals/trackLabel) and could crash.
  // We can re-add them later if we explicitly pass those values in.

  // footer
  ctx.fillStyle = "rgba(233,255,248,0.55)";
  ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto";
  const footerLeft = "Slimcal.ai";
  const footerRight = localDay ? String(localDay) : "";
  ctx.fillText(footerLeft, cardX + 26, cardY + cardH - 26);
  if (footerRight) {
    const m = ctx.measureText(footerRight);
    ctx.fillText(footerRight, cardX + cardW - 26 - m.width, cardY + cardH - 26);
  }

  return c.toDataURL("image/png");
}
