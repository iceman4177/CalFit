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

export async function buildPoseSessionSharePng({
  headline = "POSE SESSION",
  subhead = "",
  wins = [],
  levers = [],
  sincePoints = 0,
  // Back-compat: either pass poseImages (array of data URLs) + poseTitles,
  // or pass thumbs = [{ title, dataUrl }].
  poseImages = [],
  poseTitles = [],
  thumbs = [],
  muscleSignals = null,
  trackLabel = "",
  localDay = "",
  // viral fields
  tier = "",
  score = null,
  highlights = [],
  summary = "",
  hashtag = "#SlimCalAI",
} = {}) {
  
  // Normalize older/newer payload shapes
  const _wins = Array.isArray(wins) && wins.length
    ? wins
    : (Array.isArray(highlights) ? highlights : []);
  const _levers = Array.isArray(levers) && levers.length
    ? levers
    : [];
  const _headline = headline || "POSE SESSION";
  const scoreNum = Number.isFinite(Number(score)) ? Number(score) : null;
  const tierText = (tier && String(tier).trim()) ? String(tier).trim() : "";
  const _subhead = (typeof subhead === "string" ? subhead.trim() : "") || (tierText ? tierText : "");
  const _summary = (typeof summary === "string" && summary.trim()) ? summary.trim() : "";
  const _hashtag = (hashtag && String(hashtag).trim()) ? String(hashtag).trim() : "#SlimCalAI";
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

  ctx.fillStyle = "#E9FFF8";
  ctx.font = "900 56px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(String(_headline), cardX + 26, cardY + 98);

  if (_subhead) {
    ctx.fillStyle = "rgba(233,255,248,0.90)";
    ctx.font = "700 30px system-ui, -apple-system, Segoe UI, Roboto";
    const safeSub = String(_subhead).slice(0, 120);
    ctx.fillText(safeSub, cardX + 26, cardY + 142);
  }

  // hashtag pill
  if (_hashtag) {
    const tag = String(_hashtag).slice(0, 24);
    ctx.save();
    ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
    const tw = ctx.measureText(tag).width;
    const px = cardX + cardW - 26 - (tw + 34);
    const py = cardY + 110;
    roundRectPath(ctx, px, py, tw + 34, 34, 17);
    ctx.fillStyle = "rgba(0,255,190,0.16)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,255,190,0.22)";
    ctx.stroke();
    ctx.fillStyle = "rgba(233,255,248,0.95)";
    ctx.fillText(tag, px + 17, py + 24);
    ctx.restore();
  }

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

  const normalizedThumbs = Array.isArray(thumbs) && thumbs.length
    ? thumbs
    : (Array.isArray(poseImages) ? poseImages : []).slice(0, 3).map((u, i) => ({
        title: (Array.isArray(poseTitles) ? poseTitles[i] : "") || "",
        dataUrl: u,
      }));

  const imgs = [];
  for (let i = 0; i < 3; i++) {
    const u = normalizedThumbs[i]?.dataUrl;
    try {
      imgs.push(u ? await loadImage(u) : null);
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
    const lbl = normalizedThumbs?.[i]?.title
      ? String(normalizedThumbs[i].title).slice(0, 18)
      : "";
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

  drawSection("WINS", _wins, "rgba(0,255,190,0.18)");

  // Viral share summary (short + positive)
  if (_summary) {
    const summaryLines = _summary
      .split(/\n|\r/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    drawSection("WHAT HITS", summaryLines, "rgba(255,210,120,0.20)");
  }
  drawSection("PROGRESS NOTE", _levers, "rgba(0,255,255,0.18)");

  // optional signals (simple bars, always positive framing)
  if (muscleSignals && typeof muscleSignals === "object") {
    const order = [
      ["chest", "Chest"],
      ["lats", "Lats"],
      ["delts", "Delts"],
      ["arms", "Arms"],
      ["waist_taper", "Taper"],
    ];
    ctx.fillStyle = "#E9FFF8";
    ctx.font = "900 34px system-ui, -apple-system, Segoe UI, Roboto";
    const tl = String(trackLabel || "").trim();
    ctx.fillText(tl ? `Signals · ${tl.slice(0, 14)}` : "Signals", textX, y);
    y += 26;

    const barW = cardW - 52;
    const barH = 18;
    const rowGap = 18;

    for (const [k, label] of order) {
      const v = clamp(muscleSignals?.[k] ?? 0.6, 0, 1);

      ctx.fillStyle = "rgba(233,255,248,0.86)";
      ctx.font = "800 24px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText(label, textX, y + 24);

      const bx = textX + 180;
      const by = y + 10;

      // track
      ctx.save();
      roundRectPath(ctx, bx, by, barW - 180, barH, 10);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fill();
      ctx.restore();

      // fill
      ctx.save();
      roundRectPath(ctx, bx, by, (barW - 180) * v, barH, 10);
      ctx.fillStyle = "rgba(0,255,190,0.40)";
      ctx.fill();
      ctx.restore();

      y += barH + rowGap;
    }

    y += 10;
  }

  // footer
  ctx.fillStyle = "rgba(233,255,248,0.55)";
  ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto";
  const footerLeft = "Slimcal.ai";
  const footerRight = localDay ? String(localDay) : String(_hashtag || "");
  ctx.fillText(footerLeft, cardX + 26, cardY + cardH - 26);
  if (footerRight) {
    const m = ctx.measureText(footerRight);
    ctx.fillText(footerRight, cardX + cardW - 26 - m.width, cardY + cardH - 26);
  }

  return c.toDataURL("image/png");
}