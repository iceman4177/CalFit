// src/lib/poseSessionSharePng.js
// Story-friendly Pose Session share card generator.
// Designed for IG/FB story aspect ratio with short, proud, positive copy.

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

function cleanLine(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[-•\s]+/, "")
    .trim();
}

function pickViralWins(wins = [], summary = "", subhead = "") {
  const pool = [];
  for (const item of wins || []) {
    const t = cleanLine(item);
    if (t) pool.push(t);
  }

  const seen = new Set();
  const deduped = pool.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const selected = deduped.slice(0, 3);

  if (!selected.length && cleanLine(summary)) {
    selected.push(cleanLine(summary));
  }
  if (selected.length < 2 && cleanLine(subhead)) {
    selected.push(cleanLine(subhead));
  }
  while (selected.length < 3) {
    const fallbacks = [
      "Baseline locked and momentum is building.",
      "Strong visual presence across the pose set.",
      "Consistent effort is showing in the scan."
    ];
    const next = fallbacks[selected.length] || "Solid progress signal.";
    if (!selected.includes(next)) selected.push(next);
  }
  return selected.slice(0, 3);
}

function getAffirmation({ summary = "", wins = [] }) {
  const lead = cleanLine(summary);
  if (lead) {
    const shortLead = lead.length > 165 ? `${lead.slice(0, 162).trim()}…` : lead;
    return shortLead;
  }

  const topWin = cleanLine((wins || [])[0]);
  if (topWin) {
    return topWin.length > 165 ? `${topWin.slice(0, 162).trim()}…` : topWin;
  }

  return "Strong baseline locked. Your pose set is showing momentum and a confident visual presence.";
}

function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const source = cleanLine(text);
  if (!source) return [];
  const words = source.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }

  const usedWords = lines.join(" ").split(" ").filter(Boolean).length;
  const remaining = words.slice(usedWords);
  const last = line || remaining.shift() || "";
  if (last) lines.push(last);

  if (remaining.length > 0 && lines.length) {
    let tail = lines[lines.length - 1];
    while (ctx.measureText(`${tail}…`).width > maxWidth && tail.length > 3) {
      tail = tail.slice(0, -1).trim();
    }
    lines[lines.length - 1] = `${tail}…`;
  }

  return lines.slice(0, maxLines);
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const lines = wrapLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, idx) => ctx.fillText(line, x, y + idx * lineHeight));
  return lines.length;
}

export async function buildPoseSessionSharePng({
  headline = "POSE SESSION",
  subhead = "Baseline locked ✅",
  wins = [],
  poseImages = [],
  poseTitles = [],
  thumbs = [],
  trackLabel = "",
  localDay = "",
  tier = "",
  score = null,
  highlights = [],
  summary = "",
  hashtag = "#SlimCalAI",
} = {}) {
  const viralWins = pickViralWins(
    Array.isArray(wins) && wins.length ? wins : highlights,
    summary,
    subhead,
  );
  const affirmation = getAffirmation({ summary, wins: viralWins });
  const title = cleanLine(headline || "POSE SESSION") || "POSE SESSION";
  const subtitle = cleanLine(subhead || "Baseline locked ✅") || "Baseline locked ✅";
  const safeHashtag = cleanLine(hashtag || "#SlimCalAI") || "#SlimCalAI";

  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#02060b");
  bg.addColorStop(0.4, "#051019");
  bg.addColorStop(1, "#03070d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.5, H * 0.18, 40, W * 0.5, H * 0.18, H * 0.9);
  glow.addColorStop(0, "rgba(0,255,190,0.18)");
  glow.addColorStop(0.5, "rgba(0,255,190,0.06)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const pad = 54;
  const cardX = pad;
  const cardY = pad;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;

  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 42);
  ctx.fillStyle = "rgba(8,13,18,0.90)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,255,190,0.18)";
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(0,255,190,0.20)";
  ctx.fillRect(cardX + 26, cardY + 26, cardW - 52, 2);

  // Header
  ctx.fillStyle = "#E9FFF8";
  ctx.font = "900 68px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(title.slice(0, 18), cardX + 26, cardY + 104);

  ctx.fillStyle = "rgba(233,255,248,0.90)";
  ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(subtitle.slice(0, 34), cardX + 26, cardY + 152);

  // Hashtag pill
  ctx.save();
  ctx.font = "800 26px system-ui, -apple-system, Segoe UI, Roboto";
  const tagW = ctx.measureText(safeHashtag).width + 40;
  const tagX = cardX + cardW - 26 - tagW;
  const tagY = cardY + 110;
  roundRectPath(ctx, tagX, tagY, tagW, 42, 21);
  ctx.fillStyle = "rgba(0,255,190,0.14)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,255,190,0.20)";
  ctx.stroke();
  ctx.fillStyle = "rgba(233,255,248,0.96)";
  ctx.fillText(safeHashtag.slice(0, 16), tagX + 20, tagY + 29);
  ctx.restore();

  // Intentionally no score/tier on share card — keep tone neutral/positive only.

  // Affirmation card
  const affX = cardX + 26;
  const affY = cardY + 188;
  const affW = cardW - 52;
  const affH = 174;
  ctx.save();
  roundRectPath(ctx, affX, affY, affW, affH, 26);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,210,120,0.20)";
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(255,210,120,0.95)";
  ctx.font = "900 24px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("WHAT HITS", affX + 22, affY + 34);
  ctx.fillStyle = "rgba(233,255,248,0.94)";
  ctx.font = "800 30px system-ui, -apple-system, Segoe UI, Roboto";
  drawWrappedText(ctx, affirmation, affX + 22, affY + 80, affW - 44, 34, 3);

  // Thumbnails row
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

  const imgTop = affY + affH + 40;
  const imgGap = 18;
  const imgW = Math.floor((cardW - 52 - imgGap * 2) / 3);
  const imgH = 420;
  const imgX0 = cardX + 26;

  for (let i = 0; i < 3; i++) {
    const x = imgX0 + i * (imgW + imgGap);
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
    }
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x, y, imgW, imgH, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,255,190,0.22)";
    ctx.stroke();
    ctx.restore();

    const lbl = cleanLine(normalizedThumbs?.[i]?.title || "").slice(0, 16);
    if (lbl) {
      const labelW = Math.min(imgW - 26, Math.max(126, ctx.measureText(lbl).width + 28));
      ctx.save();
      roundRectPath(ctx, x + 12, y + imgH - 52, labelW, 38, 14);
      ctx.fillStyle = "rgba(0,0,0,0.50)";
      ctx.fill();
      ctx.fillStyle = "rgba(233,255,248,0.95)";
      ctx.font = "800 20px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText(lbl, x + 26, y + imgH - 25);
      ctx.restore();
    }
  }

  // Positive wins only — no negative/lever text on story card.
  let y = imgTop + imgH + 46;
  ctx.fillStyle = "#E9FFF8";
  ctx.font = "900 38px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("WINS", cardX + 26, y);
  y += 22;

  const boxW = cardW - 52;
  for (const item of viralWins.slice(0, 3)) {
    y += 18;
    const lines = (() => {
      ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto";
      return wrapLines(ctx, item, boxW - 54, 2);
    })();
    const boxH = lines.length > 1 ? 94 : 72;

    ctx.save();
    roundRectPath(ctx, cardX + 26, y, boxW, boxH, 20);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,255,190,0.16)";
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(233,255,248,0.94)";
    ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto";
    lines.forEach((line, idx) => {
      ctx.fillText(line, cardX + 50, y + 31 + idx * 32);
    });

    ctx.fillStyle = "rgba(0,255,190,0.92)";
    ctx.font = "900 28px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText("•", cardX + 34, y + 31);

    y += boxH;
  }

  // Footer
  const footY = cardY + cardH - 34;
  ctx.fillStyle = "rgba(233,255,248,0.58)";
  ctx.font = "800 24px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("Slimcal.ai", cardX + 26, footY);

  const rightFoot = cleanLine(localDay || trackLabel || safeHashtag).slice(0, 20);
  if (rightFoot) {
    const m = ctx.measureText(rightFoot);
    ctx.fillText(rightFoot, cardX + cardW - 26 - m.width, footY);
  }

  return c.toDataURL("image/png");
}
