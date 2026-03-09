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

function trimTerminalPunctuation(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[.…·•]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(text = "") {
  return trimTerminalPunctuation(
    String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^[-•\s]+/, "")
      .trim()
  );
}

function positiveClean(text = "") {
  let s = cleanLine(text);
  if (!s) return "";

  s = s
    .replace(/\bmoderate\b/gi, "solid")
    .replace(/\breasonable\b/gi, "strong")
    .replace(/\bdecent\b/gi, "strong")
    .replace(/\bsome\s+definition\b/gi, "visible definition")
    .replace(/\bsome\s+potential\b/gi, "clear potential")
    .replace(/\bpotential\b/gi, "upside")
    .replace(/\bmay\s+obscure[^.]*\.?/gi, "")
    .replace(/\bas\s+the\s+shirt[^.]*\.?/gi, "")
    .replace(/\bpose\s+quality\s+is\s+solid[^.]*\.?/gi, "")
    .replace(/\bpose\s+quality\s+is\s+moderate[^.]*\.?/gi, "")
    .replace(/\bwith\s+some\s+/gi, "with ")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  s = s.replace(/^(the\s+poses?\s+(show|demonstrate|capture)\s+)/i, "");
  s = s.replace(/^(this\s+set\s+shows\s+)/i, "");
  return trimTerminalPunctuation(s);
}

function sentenceCase(text = "") {
  const s = cleanLine(text);
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function uniqueByMeaning(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const t = cleanLine(item);
    if (!t) continue;
    const k = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function inferThemes(text = "") {
  const s = ` ${String(text || "").toLowerCase()} `;
  return {
    arms: /\b(arm|bicep|tricep)\b/.test(s),
    shoulders: /\b(shoulder|delt|deltoid)\b/.test(s),
    chest: /\bchest|pec\b/.test(s),
    back: /\bback|lat|v-taper|taper\b/.test(s),
    posture: /\bposture|pose|frame|framing\b/.test(s),
    confidence: /\bconfidence|confident|presence|command|poise\b/.test(s),
    momentum: /\bmomentum|progress|consisten|signal\b/.test(s),
  };
}

function pickViralWins(wins = [], summary = "", subhead = "") {
  const pool = [];
  for (const item of wins || []) {
    const t = positiveClean(item);
    if (t) pool.push(sentenceCase(t));
  }

  const deduped = uniqueByMeaning(pool);
  const selected = deduped.slice(0, 3);

  if (!selected.length && positiveClean(summary)) {
    selected.push(sentenceCase(positiveClean(summary)));
  }
  if (selected.length < 2 && cleanLine(subhead) && !/baseline locked/i.test(subhead)) {
    selected.push(sentenceCase(positiveClean(subhead)));
  }
  while (selected.length < 3) {
    const fallbacks = [
      "Upper-body presence is reading clearly on camera",
      "The pose set is showing confidence and momentum",
      "Consistent effort is giving the scan a strong visual signal"
    ];
    const next = fallbacks[selected.length] || "Strong progress signal";
    if (!selected.includes(next)) selected.push(next);
  }
  return uniqueByMeaning(selected).slice(0, 3);
}

function compressAffirmation(text = "") {
  let s = sentenceCase(positiveClean(text));
  if (!s) return "";

  s = s
    .replace(/the\s+front\s+double\s+biceps\s+pose/gi, "Front double biceps")
    .replace(/the\s+back\s+double\s+biceps\s+pose/gi, "Back double biceps")
    .replace(/the\s+lat\s+spread\s+pose/gi, "Lat spread")
    .replace(/displays/gi, "shows")
    .replace(/highlighting/gi, "showing")
    .replace(/appearing/gi, "looking")
    .replace(/contributing\s+positively\s+to\s+the\s+overall\s+aesthetic[s]?/gi, "adding to the overall look")
    .replace(/with\s+the/gi, "with")
    .replace(/\s{2,}/g, " ")
    .trim();

  const firstSentence = s.split(/(?<=[.!?])\s+/)[0].trim();
  s = firstSentence || s;

  if (s.length <= 118) return trimTerminalPunctuation(s);

  const clauses = s.split(/,|;|\sand\s/i).map(x => trimTerminalPunctuation(x)).filter(Boolean);
  let out = "";
  for (const clause of clauses) {
    const next = out ? `${out}, ${clause}` : clause;
    if (next.length > 118) break;
    out = next;
  }
  if (out) return trimTerminalPunctuation(out);

  return trimTerminalPunctuation(s.slice(0, 112));
}

function getAffirmation({ summary = "", wins = [] }) {
  const lead = compressAffirmation(summary);
  if (lead) return lead;

  const topWin = compressAffirmation((wins || [])[0]);
  if (topWin) return topWin;

  return "Strong pose energy, confident upper-body presence, and clear momentum through the set";
}

function getBottomAffirmation({ summary = "", wins = [] }) {
  const allText = [summary, ...(wins || [])].map(positiveClean).join(" ");
  const t = inferThemes(allText);

  if (t.arms && t.shoulders) {
    return "Really starting to see the upper-body work show up here — better arm pop, stronger shoulder presence, and cleaner pose execution across the set";
  }
  if (t.back && t.posture) {
    return "This one feels sharp — stronger posture, more shape through the upper frame, and a back shot that gives the whole set a better look";
  }
  if (t.confidence || t.momentum) {
    return "Liking the direction here — more confidence in the poses, better presence on camera, and progress that is getting easier to see";
  }

  return "This set feels strong — better upper-body presence, cleaner posing, and the kind of progress that makes you want to keep stacking good days";
}

function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const source = sentenceCase(text);
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
    while (ctx.measureText(tail).width > maxWidth && tail.length > 3) {
      tail = tail.slice(0, -1).trim();
    }
    lines[lines.length - 1] = cleanLine(tail);
  }

  return lines.slice(0, maxLines).map(cleanLine);
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
  const bottomAffirmation = getBottomAffirmation({ summary, wins: viralWins });
  const bottomTitle = "PROGRESS NOTE";
  const title = cleanLine(headline || "POSE SESSION") || "POSE SESSION";
  const subtitleRaw = cleanLine(subhead || "");
  const subtitle = /baseline locked/i.test(subtitleRaw) ? "" : subtitleRaw;
  const safeHashtag = cleanLine(hashtag || "#SlimCalAI") || "#SlimCalAI";

  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

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

  ctx.fillStyle = "#E9FFF8";
  ctx.font = "900 68px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(title.slice(0, 18), cardX + 26, cardY + 104);

  if (subtitle) {
    ctx.fillStyle = "rgba(233,255,248,0.90)";
    ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(subtitle.slice(0, 34), cardX + 26, cardY + 152);
  }

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

  const contentX = cardX + 26;
  const contentW = cardW - 52;

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

  const imgTop = cardY + 168;
  const imgGap = 18;
  const imgW = Math.floor((cardW - 52 - imgGap * 2) / 3);
  const imgH = 430;
  const imgX0 = contentX;

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
      ctx.font = "800 20px system-ui, -apple-system, Segoe UI, Roboto";
      const labelW = Math.min(imgW - 26, Math.max(126, ctx.measureText(lbl).width + 28));
      ctx.save();
      roundRectPath(ctx, x + 12, y + imgH - 52, labelW, 38, 14);
      ctx.fillStyle = "rgba(0,0,0,0.50)";
      ctx.fill();
      ctx.fillStyle = "rgba(233,255,248,0.95)";
      ctx.fillText(lbl, x + 26, y + imgH - 25);
      ctx.restore();
    }
  }

  const affX = contentX;
  const affY = imgTop + imgH + 26;
  const affW = contentW;
  const affH = 176;

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
  ctx.font = "800 25px system-ui, -apple-system, Segoe UI, Roboto";
  drawWrappedText(ctx, affirmation, affX + 22, affY + 76, affW - 44, 29, 4);

  let y = affY + affH + 40;
  ctx.fillStyle = "#E9FFF8";
  ctx.font = "900 38px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("WINS", contentX, y);
  y += 22;

  const boxW = contentW;
  for (const item of viralWins.slice(0, 3)) {
    y += 16;
    const lines = (() => {
      ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto";
      return wrapLines(ctx, item, boxW - 54, 2);
    })();
    const boxH = lines.length > 1 ? 94 : 72;

    ctx.save();
    roundRectPath(ctx, contentX, y, boxW, boxH, 20);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,255,190,0.16)";
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(233,255,248,0.94)";
    ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto";
    lines.forEach((line, idx) => {
      ctx.fillText(line, contentX + 24, y + 31 + idx * 32);
    });

    ctx.fillStyle = "rgba(0,255,190,0.92)";
    ctx.font = "900 28px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText("•", contentX + 8, y + 31);

    y += boxH;
  }

  const bottomY = y + 28;
  const bottomH = Math.max(150, cardY + cardH - 112 - bottomY);
  ctx.save();
  roundRectPath(ctx, contentX, bottomY, boxW, bottomH, 24);
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,255,190,0.12)";
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(0,255,190,0.92)";
  ctx.font = "900 24px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(bottomTitle, contentX + 24, bottomY + 38);

  ctx.fillStyle = "rgba(233,255,248,0.92)";
  ctx.font = "800 29px system-ui, -apple-system, Segoe UI, Roboto";
  drawWrappedText(ctx, bottomAffirmation, contentX + 24, bottomY + 84, boxW - 48, 34, 5);

  const chipY = bottomY + bottomH - 62;
  const chips = ["Upper body", "Dialed in", "Momentum"];
  let chipX = contentX + 24;
  ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
  for (const chip of chips) {
    const chipW = ctx.measureText(chip).width + 32;
    ctx.save();
    roundRectPath(ctx, chipX, chipY, chipW, 34, 17);
    ctx.fillStyle = "rgba(0,255,190,0.11)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,255,190,0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(233,255,248,0.86)";
    ctx.fillText(chip, chipX + 16, chipY + 23);
    ctx.restore();
    chipX += chipW + 12;
  }

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
