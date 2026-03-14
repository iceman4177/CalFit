// src/lib/poseSessionSharePng.js
// Warm premium Pose Session share card generator.
// Uses locked Pose Session copy when provided and expands body text into the available card space.

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

function ensureSentencePeriod(text = "") {
  const s = cleanText(text);
  if (!s) return "";
  if (/[.!?]$/.test(s)) return s;
  return `${s}.`;
}

function ensureSentencePeriods(items = []) {
  return (items || []).map((item) => ensureSentencePeriod(item)).filter(Boolean);
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

function formatPoseLabel(thumb = {}) {
  const key = String(thumb?.poseKey || "").toLowerCase().trim();
  if (key === "front_double_bi") return "Front Double Bi";
  if (key === "lat_spread") return "Lat Spread";
  if (key === "back_double_bi") return "Back Double Bi";
  if (key === "front_scan") return "Front Pose";
  if (key === "side_scan") return "Side Pose";
  if (key === "back_scan") return "Back Pose";

  const title = String(thumb?.title || "").trim();
  if (!title) return "Pose";
  return title
    .replace(/\bscan\b/i, "Pose")
    .replace(/\bdouble bi\b/i, "Front Double Bi")
    .replace(/\s+/g, " ")
    .trim();
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

  const words = src.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  let i = 0;

  while (i < words.length) {
    const word = words[i];
    const test = current ? `${current} ${word}` : word;

    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
      i += 1;
      continue;
    }

    if (!current) {
      current = word;
      i += 1;
    }

    if (lines.length === maxLines - 1) {
      const tailWords = [current, ...words.slice(i)].join(" ").trim();
      let tail = tailWords;
      while (tail.length > 3 && ctx.measureText(tail + "…").width > maxWidth) {
        tail = tail.slice(0, -1).trim();
      }
      lines.push(tail + (tail !== tailWords ? "…" : (i < words.length ? "…" : "")));
      return lines;
    }

    lines.push(current);
    current = "";
  }

  if (current) lines.push(current);
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
  ctx.font = "900 30px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(text, x, y);
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(255,190,120,0.26)";
  ctx.fillRect(x + tw + 18, y - 11, Math.max(40, width - tw - 18), 2);
}

function measureWrappedHeight(ctx, items, maxWidth, lineHeight, itemGap = 0, maxLinesPerItem = 4) {
  let total = 0;
  for (const item of items || []) {
    const lines = wrapLines(ctx, item, maxWidth, maxLinesPerItem);
    total += lines.length * lineHeight + itemGap;
  }
  return total;
}

function pickBodyLayout(ctx, {
  availableHeight = 0,
  bulletItems = [],
  breakdownItems = [],
  nextUpItems = [],
  coachNoteItems = [],
  width = 0,
}) {
  const presets = [
    {
      bulletFont: 29,
      bulletLineHeight: 38,
      bulletGap: 12,
      breakdownFont: 27,
      breakdownLineHeight: 37,
      breakdownGap: 14,
      nextFont: 24,
      nextLineHeight: 34,
      nextGap: 14,
      coachFont: 24,
      coachLineHeight: 34,
      coachGap: 14,
      sectionTitleGap: 36,
      sectionSpacer: 14,
    },
    {
      bulletFont: 27,
      bulletLineHeight: 36,
      bulletGap: 11,
      breakdownFont: 25,
      breakdownLineHeight: 35,
      breakdownGap: 13,
      nextFont: 22,
      nextLineHeight: 32,
      nextGap: 13,
      coachFont: 22,
      coachLineHeight: 32,
      coachGap: 13,
      sectionTitleGap: 35,
      sectionSpacer: 13,
    },
    {
      bulletFont: 25,
      bulletLineHeight: 34,
      bulletGap: 10,
      breakdownFont: 23,
      breakdownLineHeight: 32,
      breakdownGap: 12,
      nextFont: 20,
      nextLineHeight: 30,
      nextGap: 12,
      coachFont: 20,
      coachLineHeight: 30,
      coachGap: 12,
      sectionTitleGap: 34,
      sectionSpacer: 12,
    },
    {
      bulletFont: 23,
      bulletLineHeight: 31,
      bulletGap: 10,
      breakdownFont: 21,
      breakdownLineHeight: 30,
      breakdownGap: 12,
      nextFont: 18,
      nextLineHeight: 28,
      nextGap: 12,
      coachFont: 18,
      coachLineHeight: 28,
      coachGap: 12,
      sectionTitleGap: 34,
      sectionSpacer: 10,
    },
  ];

  for (const preset of presets) {
    let total = 0;

    total += preset.sectionTitleGap;
    ctx.font = `500 ${preset.bulletFont}px system-ui, -apple-system, Segoe UI, Roboto`;
    total += measureWrappedHeight(ctx, bulletItems, width - 96, preset.bulletLineHeight, preset.bulletGap, 7);

    total += preset.sectionSpacer + preset.sectionTitleGap;
    ctx.font = `500 ${preset.breakdownFont}px system-ui, -apple-system, Segoe UI, Roboto`;
    total += measureWrappedHeight(ctx, breakdownItems, width - 64, preset.breakdownLineHeight, preset.breakdownGap, 9);

    total += preset.sectionSpacer + preset.sectionTitleGap;
    ctx.font = `500 ${preset.nextFont}px system-ui, -apple-system, Segoe UI, Roboto`;
    total += measureWrappedHeight(ctx, nextUpItems, width - 64, preset.nextLineHeight, preset.nextGap, 8);

    if (coachNoteItems.length) {
      total += preset.sectionSpacer + preset.sectionTitleGap;
      ctx.font = `500 ${preset.coachFont}px system-ui, -apple-system, Segoe UI, Roboto`;
      total += measureWrappedHeight(ctx, coachNoteItems, width - 64, preset.coachLineHeight, preset.coachGap, 8);
    }

    if (total <= availableHeight) return preset;
  }

  return presets[presets.length - 1];
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
  gender = "male",
  copy = null,
} = {}) {
  const locked = copy && typeof copy === "object" ? copy : null;
  const resolvedMode = trimTerminalPunctuation(locked?.mode) || inferMode({ mode, subhead, summary });
  const resolvedHero = ensureSentencePeriod(trimTerminalPunctuation(locked?.hero) || inferHero({ hero, headline, summary, wins }));
  const resolvedSubread = ensureSentencePeriod(trimTerminalPunctuation(locked?.subread) || inferSubread({ subread, subhead, summary, hero: resolvedHero }));
  const resolvedBullets = ensureSentencePeriods(uniqueLines(locked?.bullets || []).length
    ? uniqueLines(locked?.bullets || []).slice(0, 3)
    : inferBullets({ bullets, wins, highlights, summary, mode: resolvedMode }));
  const resolvedBreakdown = ensureSentencePeriods(uniqueLines(locked?.breakdown || []).length
    ? uniqueLines(locked?.breakdown || []).slice(0, 4)
    : inferBreakdown({ breakdown, summary, hero: resolvedHero, subread: resolvedSubread }));
  const resolvedNextUp = ensureSentencePeriods(uniqueLines(locked?.nextUp || []).length
    ? uniqueLines(locked?.nextUp || []).slice(0, 2)
    : inferNextUp({ nextUp, levers, summary, mode: resolvedMode }));
  const resolvedCoachNote = ensureSentencePeriods(uniqueLines(locked?.coachNote || coachNote || []).slice(0, 2));
  const resolvedBulletsLabel = trimTerminalPunctuation(locked?.bulletsLabel || bulletsLabel) || (/re-?check/i.test(resolvedMode) ? "WHAT IMPROVED" : "WHAT STANDS OUT");
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

  y += 32;
  ctx.fillStyle = "#f4c66d";
  ctx.font = "800 20px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(resolvedMode.toUpperCase(), contentX, y);

  y += 54;
  const heroSize = fitFont(ctx, resolvedHero, contentW, 66, 50, "system-ui, -apple-system, Segoe UI, Roboto", "900");
  ctx.fillStyle = "#f2d3c4";
  ctx.font = `900 ${heroSize}px system-ui, -apple-system, Segoe UI, Roboto`;
  const heroLines = wrapLines(ctx, resolvedHero, contentW, 2);
  const heroLineHeight = heroSize + 2;
  heroLines.forEach((line, i) => ctx.fillText(line, contentX, y + i * heroLineHeight));
  y += heroLines.length * heroLineHeight + 24;

  ctx.fillStyle = "rgba(246,234,224,0.96)";
  ctx.font = "600 22px system-ui, -apple-system, Segoe UI, Roboto";
  const subLines = wrapLines(ctx, resolvedSubread, contentW, 4);
  subLines.forEach((line, i) => ctx.fillText(line, contentX, y + i * 30));
  y += subLines.length * 30 + 28;

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
  const imgH = 232;
  const thumbLabelH = 34;
  for (let i = 0; i < 3; i++) {
    const x = contentX + i * (imgW + imgGap);
    const thumb = normalizedThumbs[i] || {};
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

    const label = formatPoseLabel(thumb);
    ctx.save();
    roundRectPath(ctx, x + 8, y + imgH - thumbLabelH - 8, imgW - 16, thumbLabelH, 14);
    ctx.fillStyle = "rgba(20,7,7,0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,214,158,0.42)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = "rgba(246,234,224,0.96)";
    ctx.font = "800 16px system-ui, -apple-system, Segoe UI, Roboto";
    const labelLines = wrapLines(ctx, label, imgW - 36, 2);
    labelLines.forEach((line, lineIndex) => ctx.fillText(line, x + 18, y + imgH - thumbLabelH + 13 + lineIndex * 15));
    ctx.restore();
  }
  y += imgH + 38;

  const footerY = cardY + cardH - 58;
  const bodyLayout = pickBodyLayout(ctx, {
    availableHeight: footerY - 34 - y,
    bulletItems: resolvedBullets,
    breakdownItems: resolvedBreakdown.slice(0, 4),
    nextUpItems: resolvedNextUp.slice(0, 2),
    coachNoteItems: resolvedCoachNote.slice(0, 2),
    width: contentW,
  });

  drawSectionTitle(ctx, resolvedBulletsLabel, contentX, y, contentW);
  y += bodyLayout.sectionTitleGap;
  ctx.fillStyle = "rgba(246,234,224,0.96)";
  ctx.font = `500 ${bodyLayout.bulletFont}px system-ui, -apple-system, Segoe UI, Roboto`;
  for (const item of resolvedBullets) {
    ctx.beginPath();
    ctx.fillStyle = "#f2c27b";
    ctx.arc(contentX + 8, y - 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(246,234,224,0.96)";
    const lines = wrapLines(ctx, item, contentW - 96, 7);
    lines.forEach((line, i) => ctx.fillText(line, contentX + 24, y + i * bodyLayout.bulletLineHeight));
    y += lines.length * bodyLayout.bulletLineHeight + bodyLayout.bulletGap;
  }

  y += bodyLayout.sectionSpacer;
  drawSectionTitle(ctx, "BREAKDOWN", contentX, y, contentW);
  y += bodyLayout.sectionTitleGap;
  ctx.fillStyle = "rgba(246,234,224,0.94)";
  ctx.font = `500 ${bodyLayout.breakdownFont}px system-ui, -apple-system, Segoe UI, Roboto`;
  for (const item of resolvedBreakdown.slice(0, 4)) {
    const lines = wrapLines(ctx, item, contentW - 64, 9);
    lines.forEach((line, i) => ctx.fillText(line, contentX, y + i * bodyLayout.breakdownLineHeight));
    y += lines.length * bodyLayout.breakdownLineHeight + bodyLayout.breakdownGap;
  }

  y += bodyLayout.sectionSpacer;
  drawSectionTitle(ctx, "NEXT UP", contentX, y, contentW);
  y += bodyLayout.sectionTitleGap;
  ctx.fillStyle = "rgba(246,234,224,0.94)";
  ctx.font = `500 ${bodyLayout.nextFont}px system-ui, -apple-system, Segoe UI, Roboto`;
  for (const item of resolvedNextUp.slice(0, 2)) {
    const lines = wrapLines(ctx, item, contentW - 64, 8);
    lines.forEach((line, i) => ctx.fillText(line, contentX, y + i * bodyLayout.nextLineHeight));
    y += lines.length * bodyLayout.nextLineHeight + bodyLayout.nextGap;
  }

  if (resolvedCoachNote.length) {
    y += bodyLayout.sectionSpacer;
    drawSectionTitle(ctx, "COACH NOTE", contentX, y, contentW);
    y += bodyLayout.sectionTitleGap;
    ctx.fillStyle = "rgba(246,234,224,0.94)";
    ctx.font = `500 ${bodyLayout.coachFont}px system-ui, -apple-system, Segoe UI, Roboto`;
    for (const item of resolvedCoachNote.slice(0, 2)) {
      const lines = wrapLines(ctx, item, contentW - 64, 8);
      lines.forEach((line, i) => ctx.fillText(line, contentX, y + i * bodyLayout.coachLineHeight));
      y += lines.length * bodyLayout.coachLineHeight + bodyLayout.coachGap;
    }
  }

  // Footer branding only — no fake share button inside the exported share card.
  ctx.fillStyle = "#f0e3d7";
  ctx.font = "700 26px system-ui, -apple-system, Segoe UI, Roboto";
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
  ctx.font = "600 16px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(safeHashtag, contentX, footerY + 26);

  ctx.fillStyle = "rgba(244,170,190,0.55)";
  roundRectPath(ctx, W * 0.44, H - 76, W * 0.12, 7, 4);
  ctx.fill();

  return c.toDataURL("image/png");
}
