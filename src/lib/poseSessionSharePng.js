// src/lib/poseSessionSharePng.js
// Warm premium Pose Session share card generator.
// Fixed to avoid duplicate wording, header collisions, and removes the fake SHARE button.

function cleanText(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[•·]/g, "")
    .trim();
}

function trimTerminalPunctuation(text = "") {
  return cleanText(text).replace(/[.…]+$/g, "").trim();
}

function normalizeForCompare(text = "") {
  return trimTerminalPunctuation(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueLines(items = []) {
  const out = [];
  const seen = new Set();
  for (const raw of items || []) {
    const t = trimTerminalPunctuation(raw);
    if (!t) continue;
    const key = normalizeForCompare(t)
      .split(" ")
      .slice(0, 10)
      .join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function sentenceCase(text = "") {
  const s = trimTerminalPunctuation(text);
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function splitSentences(text = "") {
  const src = cleanText(text)
    .replace(/\s+/g, " ")
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .trim();
  if (!src) return [];
  return src
    .split(/(?<=[.!?])\s+/)
    .map((s) => trimTerminalPunctuation(s))
    .filter(Boolean);
}

function uniqueSentences(text = "") {
  return uniqueLines(splitSentences(text));
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

function fitFont(ctx, text, maxWidth, start, min, fontFamily, style = "700 italic") {
  let size = start;
  while (size > min) {
    ctx.font = `${style} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return min;
}

function wrapLines(ctx, text, maxWidth, maxLines = 3) {
  const src = cleanText(text);
  if (!src) return [];
  const words = src.split(" ");
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
  if (remaining.length && lines.length) {
    let tail = `${lines[lines.length - 1]} ${remaining.join(" ")}`.trim();
    while (tail.length > 3 && ctx.measureText(tail + "…").width > maxWidth) {
      tail = tail.slice(0, -1).trim();
    }
    lines[lines.length - 1] = tail + "…";
  }
  return lines.slice(0, maxLines);
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const lines = wrapLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return lines.length;
}

function inferMode({ mode = "", subhead = "", summary = "" }) {
  const joined = `${mode} ${subhead} ${summary}`.toLowerCase();
  return /re-?check|last time|last scan|sharper than last time|cleaner and more dialed/.test(joined)
    ? "Re-Check"
    : "Baseline Read";
}

function inferHero({ hero = "", headline = "", summary = "", wins = [] }) {
  const candidates = [hero, headline, ...uniqueSentences(summary), ...(wins || [])]
    .map(trimTerminalPunctuation)
    .filter(Boolean)
    .filter((t) => !/^(pose session|physique check|scan results?)$/i.test(t));
  const picked = candidates[0] || "You look like you train";
  return trimTerminalPunctuation(picked);
}

function inferSubread({ subread = "", subhead = "", summary = "", hero = "" }) {
  const heroKey = normalizeForCompare(hero);
  const candidates = [subread, subhead, ...uniqueSentences(summary)]
    .map(trimTerminalPunctuation)
    .filter(Boolean)
    .filter((t) => normalizeForCompare(t) !== heroKey)
    .filter((t) => !/^(baseline read|re-?check)$/i.test(t));
  return candidates[0] || "Strong base already showing with a clean athletic look.";
}

function inferBullets({ bullets = [], wins = [], highlights = [], summary = "", mode = "Baseline Read" }) {
  const merged = uniqueLines([...(bullets || []), ...(wins || []), ...(highlights || [])]);
  if (merged.length >= 3) return merged.slice(0, 3);

  const s = summary.toLowerCase();
  const fallbacks = /re-?check/i.test(mode)
    ? [
        "Sharper overall presentation",
        "Better definition showing",
        "More polished look",
      ]
    : [
        "Strong upper-body presence",
        "Lean athletic base",
        "Clean put-together look",
      ];

  const contextual = [];
  if (/shoulder|delt/.test(s)) contextual.push("Shoulders are reading clearly");
  if (/waist|back/.test(s)) contextual.push("Waist and back look cleaner");
  if (/arms?/.test(s)) contextual.push("Arms are showing more shape");
  if (/glute|lower body|legs?/.test(s)) contextual.push("Lower body adds to the look");

  return uniqueLines([...merged, ...contextual, ...fallbacks]).slice(0, 3);
}

function inferBreakdown({ breakdown = [], summary = "", hero = "", subread = "" }) {
  const lines = uniqueLines([...(breakdown || []), ...uniqueSentences(summary)])
    .filter((t) => normalizeForCompare(t) !== normalizeForCompare(hero))
    .filter((t) => normalizeForCompare(t) !== normalizeForCompare(subread));
  if (lines.length) return lines.slice(0, 3);
  return [subread || "Clean athletic look showing across the full set."];
}

function inferNextUp({ nextUp = [], levers = [], summary = "", mode = "Baseline Read" }) {
  const lines = uniqueLines([...(nextUp || []), ...(levers || []), ...uniqueSentences(summary)]);
  const filtered = lines.filter((t) => t.length >= 18);
  if (filtered.length) return filtered.slice(0, 2);
  return /re-?check/i.test(mode)
    ? ["Keep building on the cleaner look that’s already starting to show."]
    : ["Keep stacking size while holding onto the clean look you already have."];
}

function drawSectionTitle(ctx, text, x, y, width) {
  ctx.fillStyle = "#f2c27b";
  ctx.font = "900 28px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(text, x, y);
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(255,190,120,0.26)";
  ctx.fillRect(x + tw + 18, y - 10, Math.max(40, width - tw - 18), 2);
}

export async function buildPoseSessionSharePng({
  title = "SlimCal",
  brand = "AI",
  mode = "",
  hero = "",
  subread = "",
  bulletsLabel = "",
  bullets = [],
  breakdown = [],
  nextUp = [],
  coachNote = [],
  headline = "",
  subhead = "",
  wins = [],
  levers = [],
  highlights = [],
  summary = "",
  hashtag = "#SlimCalAI",
  thumbs = [],
  poseImages = [],
  poseTitles = [],
  copy = null,
} = {}) {
  const locked = copy && typeof copy === "object" ? copy : null;
  const resolvedMode = cleanText(locked?.mode) || inferMode({ mode, subhead, summary });
  const resolvedHero = trimTerminalPunctuation(locked?.hero) || inferHero({ hero, headline, summary, wins });
  const resolvedSubread = trimTerminalPunctuation(locked?.subread) || inferSubread({ subread, subhead, summary, hero: resolvedHero });
  const resolvedBullets = Array.isArray(locked?.bullets) && locked.bullets.length
    ? uniqueLines(locked.bullets).slice(0, 3)
    : inferBullets({ bullets, wins, highlights, summary, mode: resolvedMode });
  const resolvedBreakdown = Array.isArray(locked?.breakdown) && locked.breakdown.length
    ? uniqueLines(locked.breakdown).slice(0, 4)
    : inferBreakdown({ breakdown, summary, hero: resolvedHero, subread: resolvedSubread });
  const resolvedNextUp = Array.isArray(locked?.nextUp) && locked.nextUp.length
    ? uniqueLines(locked.nextUp).slice(0, 2)
    : inferNextUp({ nextUp, levers, summary, mode: resolvedMode });
  const resolvedCoachNote = Array.isArray(locked?.coachNote) && locked.coachNote.length
    ? uniqueLines(locked.coachNote).slice(0, 2)
    : uniqueLines(coachNote).slice(0, 2);
  const resolvedBulletsLabel = cleanText(locked?.bulletsLabel) || bulletsLabel || (/re-?check/i.test(resolvedMode) ? "WHAT IMPROVED" : "WHAT STANDS OUT");
  const safeHashtag = trimTerminalPunctuation(hashtag || "#SlimCalAI") || "#SlimCalAI";

  const normalizedThumbs = Array.isArray(thumbs) && thumbs.length
    ? thumbs
    : (Array.isArray(poseImages) ? poseImages : []).slice(0, 3).map((u, i) => ({
        title: (Array.isArray(poseTitles) ? poseTitles[i] : "") || "",
        dataUrl: u,
      }));

  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#120405");
  bg.addColorStop(0.24, "#2a0708");
  bg.addColorStop(0.62, "#4b0908");
  bg.addColorStop(1, "#160405");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow1 = ctx.createRadialGradient(W * 0.32, H * 0.18, 10, W * 0.32, H * 0.18, 420);
  glow1.addColorStop(0, "rgba(255,210,120,0.18)");
  glow1.addColorStop(1, "rgba(255,210,120,0)");
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);

  const glow2 = ctx.createRadialGradient(W * 0.7, H * 0.72, 10, W * 0.7, H * 0.72, 520);
  glow2.addColorStop(0, "rgba(255,120,80,0.16)");
  glow2.addColorStop(1, "rgba(255,120,80,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 2.2 + 0.4;
    ctx.fillStyle = `rgba(255, ${180 + Math.floor(Math.random() * 40)}, ${100 + Math.floor(Math.random() * 40)}, ${0.12 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const pad = 44;
  const cardX = pad;
  const cardY = pad;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;

  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 42);
  ctx.fillStyle = "rgba(30,6,7,0.78)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,214,158,0.75)";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, cardX + 10, cardY + 10, cardW - 20, cardH - 20, 34);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,214,158,0.35)";
  ctx.stroke();
  ctx.restore();

  const contentX = cardX + 32;
  const contentW = cardW - 64;
  let y = cardY + 42;

  ctx.fillStyle = "#f5e8dc";
  ctx.font = "900 34px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(String(title || "SlimCal").slice(0, 14), contentX, y);

  const titleW = ctx.measureText(String(title || "SlimCal").slice(0, 14)).width;
  const badgeText = String(brand || "AI").slice(0, 4);
  ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
  const badgeW = Math.max(52, ctx.measureText(badgeText).width + 24);
  ctx.save();
  roundRectPath(ctx, contentX + titleW + 12, y - 30, badgeW, 34, 10);
  ctx.fillStyle = "rgba(180,120,38,0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,214,158,0.65)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#f7d07f";
  ctx.fillText(badgeText, contentX + titleW + 24, y - 8);
  ctx.restore();

  y += 40;
  ctx.fillStyle = "rgba(245,232,220,0.98)";
  ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("POSE SESSION", contentX, y);

  y += 38;
  ctx.fillStyle = "rgba(255,190,120,0.28)";
  ctx.fillRect(contentX, y, contentW, 2);

  y += 34;
  ctx.fillStyle = "#f4c66d";
  ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(resolvedMode.toUpperCase(), contentX, y);

  y += 28;
  const heroSize = fitFont(ctx, resolvedHero, contentW, 78, 50, "Georgia, Times New Roman, serif", "700 italic");
  ctx.fillStyle = "#f2d3c4";
  ctx.font = `700 italic ${heroSize}px Georgia, Times New Roman, serif`;
  const heroLines = wrapLines(ctx, resolvedHero, contentW, 2);
  heroLines.forEach((line, i) => ctx.fillText(line, contentX, y + i * (heroSize + 4)));
  y += heroLines.length * (heroSize + 4) + 12;

  ctx.fillStyle = "rgba(246,234,224,0.96)";
  ctx.font = "500 18px system-ui, -apple-system, Segoe UI, Roboto";
  const subLines = wrapLines(ctx, resolvedSubread, contentW, 4);
  subLines.forEach((line, i) => ctx.fillText(line, contentX, y + i * 24));
  y += subLines.length * 24 + 24;

  const imgs = [];
  for (let i = 0; i < 3; i++) {
    const u = normalizedThumbs[i]?.dataUrl;
    try {
      imgs.push(u ? await loadImage(u) : null);
    } catch {
      imgs.push(null);
    }
  }

  const imgGap = 14;
  const imgW = Math.floor((contentW - imgGap * 2) / 3);
  const imgH = 250;
  for (let i = 0; i < 3; i++) {
    const x = contentX + i * (imgW + imgGap);
    ctx.save();
    roundRectPath(ctx, x, y, imgW, imgH, 24);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.clip();
    if (imgs[i]) drawCover(ctx, imgs[i], x, y, imgW, imgH);
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, x, y, imgW, imgH, 24);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,214,158,0.72)";
    ctx.stroke();
    ctx.restore();
  }
  y += imgH + 34;

  drawSectionTitle(ctx, resolvedBulletsLabel, contentX, y, contentW);
  y += 34;
  ctx.fillStyle = "rgba(246,234,224,0.96)";
  ctx.font = "500 18px system-ui, -apple-system, Segoe UI, Roboto";
  for (const item of resolvedBullets) {
    ctx.beginPath();
    ctx.fillStyle = "#f2c27b";
    ctx.arc(contentX + 8, y - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(246,234,224,0.96)";
    const lines = wrapLines(ctx, item, contentW - 26, 2);
    lines.forEach((line, i) => ctx.fillText(line, contentX + 24, y + i * 22));
    y += lines.length * 22 + 10;
  }

  y += 10;
  drawSectionTitle(ctx, "BREAKDOWN", contentX, y, contentW);
  y += 34;
  ctx.fillStyle = "rgba(246,234,224,0.94)";
  ctx.font = "500 16px system-ui, -apple-system, Segoe UI, Roboto";
  for (const item of resolvedBreakdown.slice(0, 4)) {
    const lines = wrapLines(ctx, item, contentW, 4);
    lines.forEach((line, i) => ctx.fillText(line, contentX, y + i * 21));
    y += lines.length * 21 + 11;
  }

  y += 4;
  drawSectionTitle(ctx, "NEXT UP", contentX, y, contentW);
  y += 32;
  ctx.fillStyle = "rgba(246,234,224,0.94)";
  ctx.font = "500 16px system-ui, -apple-system, Segoe UI, Roboto";
  for (const item of resolvedNextUp.slice(0, 2)) {
    const lines = wrapLines(ctx, item, contentW, 4);
    lines.forEach((line, i) => ctx.fillText(line, contentX, y + i * 21));
    y += lines.length * 21 + 11;
  }

  if (resolvedCoachNote.length) {
    y += 2;
    drawSectionTitle(ctx, "COACH NOTE", contentX, y, contentW);
    y += 32;
    ctx.fillStyle = "rgba(246,234,224,0.94)";
    ctx.font = "500 16px system-ui, -apple-system, Segoe UI, Roboto";
    for (const item of resolvedCoachNote.slice(0, 2)) {
      const lines = wrapLines(ctx, item, contentW, 4);
      lines.forEach((line, i) => ctx.fillText(line, contentX, y + i * 21));
      y += lines.length * 21 + 11;
    }
  }

  // Footer branding only — no fake share button inside the exported share card.
  const footerY = cardY + cardH - 72;
  ctx.fillStyle = "#f0e3d7";
  ctx.font = "700 24px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(String(title || "SlimCal").slice(0, 16), contentX, footerY);
  const footerTitleW = ctx.measureText(String(title || "SlimCal").slice(0, 16)).width;
  ctx.font = "800 18px system-ui, -apple-system, Segoe UI, Roboto";
  const footerBadgeW = Math.max(44, ctx.measureText(badgeText).width + 18);
  ctx.save();
  roundRectPath(ctx, contentX + footerTitleW + 10, footerY - 22, footerBadgeW, 26, 8);
  ctx.fillStyle = "rgba(180,120,38,0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,214,158,0.55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "#f7d07f";
  ctx.fillText(badgeText, contentX + footerTitleW + 18, footerY - 4);
  ctx.restore();

  ctx.fillStyle = "rgba(245,232,220,0.9)";
  ctx.font = "600 15px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(safeHashtag, contentX, footerY + 26);

  ctx.fillStyle = "rgba(244,170,190,0.55)";
  roundRectPath(ctx, W * 0.44, H - 76, W * 0.12, 7, 4);
  ctx.fill();

  return c.toDataURL("image/png");
}
