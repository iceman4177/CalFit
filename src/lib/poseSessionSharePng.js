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

function wrapText(ctx, text, maxWidth) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return [];
  const words = value.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);

    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
      continue;
    }

    let chunk = "";
    for (const ch of word) {
      const candidateChunk = chunk + ch;
      if (ctx.measureText(candidateChunk).width <= maxWidth) {
        chunk = candidateChunk;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    line = chunk;
  }

  if (line) lines.push(line);
  return lines;
}

function truncateWrappedLines(ctx, text, maxWidth, maxLines) {
  const lines = wrapText(ctx, text, maxWidth);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1] || "";
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }
  out[maxLines - 1] = `${last}…`;
  return out;
}

export async function buildPoseSessionSharePng({
  headline = "POSE SESSION",
  subhead = "Baseline locked ✅",
  wins = [],
  levers = [],
  sincePoints = 0,
  poseImages = [],
  poseTitles = [],
  thumbs = [],
  muscleSignals = null,
  trackLabel = "",
  localDay = "",
  tier = "",
  score = null,
  highlights = [],
  summary = "",
  hashtag = "#SlimCalAI",
} = {}) {
  const _wins = Array.isArray(wins) && wins.length ? wins : Array.isArray(highlights) ? highlights : [];
  const _levers = Array.isArray(levers) && levers.length ? levers : [];
  const _headline = headline || "POSE SESSION";
  const scoreNum = Number.isFinite(Number(score)) ? Number(score) : null;
  const tierText = tier && String(tier).trim() ? String(tier).trim() : "";
  const _subhead = subhead || (tierText ? `${tierText}${scoreNum !== null ? ` · ${scoreNum.toFixed?.(1) || scoreNum}/10` : ""}` : "Baseline locked ✅");
  const _summary = typeof summary === "string" && summary.trim() ? summary.trim() : "";
  const _hashtag = hashtag && String(hashtag).trim() ? String(hashtag).trim() : "#SlimCalAI";

  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#04070b";
  ctx.fillRect(0, 0, W, H);

  const g = ctx.createRadialGradient(W * 0.5, H * 0.2, 40, W * 0.5, H * 0.2, H * 0.95);
  g.addColorStop(0, "rgba(0,255,190,0.13)");
  g.addColorStop(0.55, "rgba(0,255,190,0.04)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const pad = 48;
  const cardX = pad;
  const cardY = pad;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;

  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 42);
  ctx.fillStyle = "rgba(10,14,20,0.9)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,255,190,0.18)";
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(0,255,190,0.18)";
  ctx.fillRect(cardX + 26, cardY + 26, cardW - 52, 2);

  ctx.fillStyle = "#E9FFF8";
  ctx.font = "900 58px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(String(_headline), cardX + 26, cardY + 98);

  ctx.fillStyle = "rgba(233,255,248,0.9)";
  ctx.font = "700 30px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(String(_subhead).slice(0, 120), cardX + 26, cardY + 142);

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

  if (sincePoints > 0) {
    ctx.fillStyle = "rgba(0,255,190,0.92)";
    ctx.font = "900 30px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(`+${sincePoints} levels since last`, cardX + 26, cardY + 184);
  }

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
      ctx.fillStyle = "rgba(0,255,190,0.08)";
      ctx.fillRect(x, y, imgW, imgH);
      ctx.fillStyle = "rgba(233,255,248,0.65)";
      ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText("Pose", x + 18, y + 44);
    }

    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x, y, imgW, imgH, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,255,190,0.22)";
    ctx.stroke();
    ctx.restore();

    const lbl = normalizedThumbs?.[i]?.title ? String(normalizedThumbs[i].title).slice(0, 24) : "";
    if (lbl) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.54)";
      roundRectPath(ctx, x + 14, y + imgH - 54, Math.min(imgW - 28, 240), 40, 14);
      ctx.fill();
      ctx.fillStyle = "rgba(233,255,248,0.92)";
      ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText(lbl, x + 28, y + imgH - 26);
      ctx.restore();
    }
  }

  const textX = cardX + 26;
  const sectionW = cardW - 52;
  let y = imgTop + imgH + 40;

  const drawSection = (title, items, accent = "rgba(0,255,190,0.22)", options = {}) => {
    const maxItems = options.maxItems ?? 3;
    const maxLines = options.maxLines ?? 3;
    const shown = (items || []).filter(Boolean).map((t) => String(t).trim()).filter(Boolean).slice(0, maxItems);
    if (!shown.length) return;

    ctx.fillStyle = "#E9FFF8";
    ctx.font = "900 34px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(title, textX, y);
    y += 18;

    for (const t of shown) {
      y += 22;
      ctx.font = "800 24px system-ui, -apple-system, Segoe UI, Roboto";
      const textMaxW = sectionW - 36;
      const lines = truncateWrappedLines(ctx, t, textMaxW, maxLines);
      const lineHeight = 29;
      const boxH = Math.max(72, 28 + lines.length * lineHeight);

      ctx.save();
      roundRectPath(ctx, textX, y, sectionW, boxH, 18);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "rgba(233,255,248,0.92)";
      let ty = y + 42;
      for (const line of lines) {
        ctx.fillText(line, textX + 18, ty);
        ty += lineHeight;
      }
      y += boxH;
    }

    y += 26;
  };

  drawSection("Wins", _wins, "rgba(0,255,190,0.18)", { maxItems: 3, maxLines: 3 });

  if (_summary) {
    drawSection("Glow-up", [_summary], "rgba(255,210,120,0.20)", { maxItems: 1, maxLines: 5 });
  }

  drawSection("Next unlocks", _levers, "rgba(0,255,255,0.18)", { maxItems: 3, maxLines: 3 });

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

    const barW = sectionW;
    const barH = 18;
    const rowGap = 18;

    for (const [k, label] of order) {
      const v = clamp(muscleSignals?.[k] ?? 0.6, 0, 1);

      ctx.fillStyle = "rgba(233,255,248,0.86)";
      ctx.font = "800 24px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText(label, textX, y + 24);

      const bx = textX + 180;
      const by = y + 10;
      const usableW = barW - 180;

      ctx.save();
      roundRectPath(ctx, bx, by, usableW, barH, 10);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRectPath(ctx, bx, by, usableW * v, barH, 10);
      ctx.fillStyle = "rgba(0,255,190,0.40)";
      ctx.fill();
      ctx.restore();

      y += barH + rowGap;
    }

    y += 10;
  }

  const footerY = cardY + cardH - 28;
  ctx.fillStyle = "rgba(233,255,248,0.55)";
  ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto";
  const footerLeft = "Slimcal.ai";
  const footerRight = localDay ? String(localDay) : String(_hashtag || "");
  ctx.fillText(footerLeft, cardX + 26, footerY);
  if (footerRight) {
    const m = ctx.measureText(footerRight);
    ctx.fillText(footerRight, cardX + cardW - 26 - m.width, footerY);
  }

  return c.toDataURL("image/png");
}
