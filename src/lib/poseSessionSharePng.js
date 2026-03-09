// src/lib/poseSessionSharePng.js
// Premium Pose Session share card generator.
// Social-first 9:16 story export with central safe area for feed reposts.

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
    .trim();
}

function cleanLine(text = "") {
  return trimTerminalPunctuation(
    String(text || "")
      .replace(/^[-•\s]+/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function sentenceCase(text = "") {
  const s = cleanLine(text);
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function titleCase(text = "") {
  return cleanLine(text)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function uniqueByMeaning(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const t = cleanLine(item);
    if (!t) continue;
    const k = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 6).join(" ");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function normalizeCopy(text = "", gender = "male") {
  let s = cleanLine(text);
  if (!s) return "";

  s = s
    .replace(/\bsilhouette\b/gi, gender === "female" ? "shape" : "look")
    .replace(/\bbuild read\b/gi, "look")
    .replace(/\bvisual signal\b/gi, "look")
    .replace(/\bbaseline locked\b/gi, gender === "female" ? "Base look saved" : "Base look saved")
    .replace(/\btrending up\b/gi, gender === "female" ? "looking better" : "looking better")
    .replace(/\bbeautifully put together\b/gi, "really put together")
    .replace(/\bput together\b/gi, "clean")
    .replace(/\bphysique presentation\b/gi, "look")
    .replace(/\bphysique memory\b/gi, "check history")
    .replace(/\s{2,}/g, " ")
    .trim();

  return trimTerminalPunctuation(s);
}

function pickStandouts({ wins = [], highlights = [], summary = "", gender = "male" }) {
  const pool = uniqueByMeaning([
    ...(Array.isArray(wins) ? wins : []),
    ...(Array.isArray(highlights) ? highlights : []),
    summary,
  ].map((item) => normalizeCopy(item, gender)).filter(Boolean));

  const out = [];
  for (const item of pool) {
    if (item.length > 52) continue;
    out.push(titleCase(item));
    if (out.length >= 3) break;
  }

  const fallbacks = gender === "female"
    ? ["Toned Shape", "Clean Presence", "Pretty Momentum"]
    : ["Aesthetic Base", "Upper-Body Pop", "Built Momentum"];

  while (out.length < 3) {
    const next = fallbacks[out.length];
    if (!out.includes(next)) out.push(next);
  }
  return out.slice(0, 3);
}

function inferHero({ headline = "", subhead = "", summary = "", gender = "male", strength = "" }) {
  const source = [headline, subhead, summary, strength].map((t) => normalizeCopy(t, gender)).join(" ").toLowerCase();

  if (gender === "female") {
    if (/snatch|waist/.test(source)) return "Waist Is Looking Snatched";
    if (/glute|lower/.test(source)) return "Shape Is Coming Through";
    if (/sculpt|toned|defined/.test(source)) return "Looking Sculpted";
    if (/pretty|gorgeous|elegant|polished/.test(source)) return "Pretty And Polished";
    if (/strong|athletic/.test(source)) return "Strong And Pretty";
    return "Looking Sculpted";
  }

  if (/jacked|stacked|huge/.test(source)) return "Looking Jacked";
  if (/wide|lat|back/.test(source)) return "Back Is Hitting";
  if (/shoulder|delt|arms|bicep/.test(source)) return "Upper Body Is Popping";
  if (/shredded|lean|sharp/.test(source)) return "Looking Sharp";
  if (/built|muscular/.test(source)) return "Looking Built";
  return "Looking Built";
}

function inferDeck({ summary = "", subhead = "", levers = [], gender = "male" }) {
  const pool = [summary, subhead, ...(Array.isArray(levers) ? levers : [])]
    .map((t) => sentenceCase(normalizeCopy(t, gender)))
    .filter(Boolean);

  const preferred = pool.find((line) => line.length >= 28 && line.length <= 108);
  if (preferred) return preferred;

  return gender === "female"
    ? "Clean pose set, pretty energy, and the kind of shape that makes people want their own check."
    : "Strong pose set, real upper-body presence, and the kind of look that makes people want their own check.";
}

function inferNextLine({ summary = "", levers = [], gender = "male" }) {
  const source = [summary, ...(Array.isArray(levers) ? levers : [])].map((t) => normalizeCopy(t, gender)).join(" ").toLowerCase();

  if (gender === "female") {
    if (/lean|sharp|cut/.test(source)) return "A little more leanness and this look gets even cleaner.";
    if (/glute|lower/.test(source)) return "Keep building and the full look will hit even harder on camera.";
    return "Stay consistent and this look gets even prettier and more dialed in.";
  }

  if (/lean|sharp|cut/.test(source)) return "A little more leanness and this one gets crazy sharp.";
  if (/bulk|size|full/.test(source)) return "Keep stacking size and this upper-body look gets even louder.";
  return "Stay consistent and this one gets more aesthetic every check.";
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
    if (lines.length >= maxLines - 1) break;
  }

  if (line) lines.push(line);

  if (lines.length > maxLines) return lines.slice(0, maxLines);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    let tail = lines[maxLines - 1];
    while (ctx.measureText(`${tail}…`).width > maxWidth && tail.length > 4) {
      tail = tail.slice(0, -1).trim();
    }
    lines[maxLines - 1] = `${trimTerminalPunctuation(tail)}…`;
  }

  return lines.slice(0, maxLines).map(cleanLine);
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const lines = wrapLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, idx) => ctx.fillText(line, x, y + idx * lineHeight));
  return lines.length;
}

function drawChip(ctx, { x, y, text, fill, stroke, color }) {
  ctx.save();
  ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
  const w = ctx.measureText(text).width + 34;
  roundRectPath(ctx, x, y, w, 38, 19);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 17, y + 25);
  ctx.restore();
  return w;
}

function buildTagSet({ gender = "male", standouts = [], summary = "", strength = "" }) {
  const source = `${standouts.join(" ")} ${summary} ${strength}`.toLowerCase();
  const tags = [];

  const add = (value) => {
    const v = titleCase(value);
    if (v && !tags.includes(v)) tags.push(v);
  };

  if (gender === "female") {
    if (/snatch|waist/.test(source)) add("Snatched");
    if (/toned|sculpt|defined/.test(source)) add("Sculpted");
    if (/pretty|gorgeous|polished|elegant/.test(source)) add("Pretty");
    if (/strong|athletic/.test(source)) add("Athletic");
    add("Pose Check");
    add("Momentum");
  } else {
    if (/jacked|stacked|built|muscular/.test(source)) add("Built");
    if (/lean|shredded|sharp/.test(source)) add("Sharp");
    if (/shoulder|arm|upper/.test(source)) add("Upper-Body Pop");
    if (/aesthetic|back|lat|wide/.test(source)) add("Aesthetic");
    add("Pose Check");
    add("Momentum");
  }

  return tags.slice(0, 3);
}

export async function buildPoseSessionSharePng({
  headline = "PHYSIQUE CHECK",
  subhead = "",
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
  gender = "male",
  strength = "",
  levers = [],
} = {}) {
  const g = String(gender || "male").toLowerCase() === "female" ? "female" : "male";
  const theme = g === "female"
    ? {
        accent: "#ff5db2",
        accentSoft: "rgba(255,93,178,0.18)",
        accentStroke: "rgba(255,93,178,0.30)",
        radial: "rgba(255,93,178,0.18)",
        chip: "rgba(255,93,178,0.14)",
        chipStroke: "rgba(255,93,178,0.24)",
        chipText: "rgba(255,238,248,0.96)",
      }
    : {
        accent: "#cfff4d",
        accentSoft: "rgba(207,255,77,0.17)",
        accentStroke: "rgba(207,255,77,0.30)",
        radial: "rgba(207,255,77,0.18)",
        chip: "rgba(207,255,77,0.14)",
        chipStroke: "rgba(207,255,77,0.25)",
        chipText: "rgba(245,255,224,0.96)",
      };

  const standouts = pickStandouts({ wins, highlights, summary, gender: g });
  const hero = inferHero({ headline, subhead, summary, gender: g, strength });
  const deck = inferDeck({ summary, subhead, levers, gender: g });
  const nextLine = inferNextLine({ summary, levers, gender: g });
  const tags = buildTagSet({ gender: g, standouts, summary, strength });
  const safeHashtag = cleanLine(hashtag || "#SlimCalAI") || "#SlimCalAI";
  const label = g === "female" ? "POSE SESSION · HER CHECK" : "POSE SESSION · HIS CHECK";

  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#05070c");
  bg.addColorStop(0.42, "#09111a");
  bg.addColorStop(1, "#04060a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const topGlow = ctx.createRadialGradient(W * 0.55, H * 0.14, 30, W * 0.55, H * 0.14, H * 0.75);
  topGlow.addColorStop(0, theme.radial);
  topGlow.addColorStop(0.4, theme.accentSoft);
  topGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, W, H);

  const sideGlow = ctx.createRadialGradient(W * 0.08, H * 0.70, 10, W * 0.08, H * 0.70, H * 0.45);
  sideGlow.addColorStop(0, theme.accentSoft);
  sideGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sideGlow;
  ctx.fillRect(0, 0, W, H);

  const safeX = 74;
  const safeY = 84;
  const safeW = W - safeX * 2;
  const safeH = H - safeY * 2;

  ctx.save();
  roundRectPath(ctx, safeX, safeY, safeW, safeH, 42);
  ctx.fillStyle = "rgba(8,11,17,0.76)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, safeX + 18, safeY + 18, safeW - 36, safeH - 36, 34);
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.accentStroke;
  ctx.stroke();
  ctx.restore();

  let cursorY = safeY + 34;
  const contentX = safeX + 34;
  const contentW = safeW - 68;

  ctx.font = "800 20px system-ui, -apple-system, Segoe UI, Roboto";
  const labelW = ctx.measureText(label).width + 34;
  roundRectPath(ctx, contentX, cursorY, labelW, 36, 18);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.accentStroke;
  ctx.stroke();
  ctx.fillStyle = "rgba(245,248,255,0.95)";
  ctx.fillText(label, contentX + 17, cursorY + 24);

  const hashW = ctx.measureText(safeHashtag).width + 30;
  const hashX = contentX + contentW - hashW;
  roundRectPath(ctx, hashX, cursorY, hashW, 36, 18);
  ctx.fillStyle = theme.chip;
  ctx.fill();
  ctx.strokeStyle = theme.chipStroke;
  ctx.stroke();
  ctx.fillStyle = theme.chipText;
  ctx.fillText(safeHashtag, hashX + 15, cursorY + 24);

  cursorY += 72;

  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = "900 18px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(cleanLine(headline || "PHYSIQUE CHECK").slice(0, 30), contentX, cursorY);

  cursorY += 26;
  ctx.fillStyle = "#F7FAFF";
  ctx.font = "900 72px system-ui, -apple-system, Segoe UI, Roboto";
  const heroLines = wrapLines(ctx, hero, contentW - 10, 2);
  heroLines.forEach((line, idx) => ctx.fillText(line, contentX, cursorY + idx * 74));
  cursorY += Math.max(1, heroLines.length) * 74 + 12;

  ctx.fillStyle = "rgba(235,242,255,0.88)";
  ctx.font = "700 30px system-ui, -apple-system, Segoe UI, Roboto";
  drawWrappedText(ctx, deck, contentX, cursorY, contentW - 20, 36, 3);
  cursorY += 116;

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

  const panelY = cursorY;
  const panelH = 510;
  const gap = 18;
  const panelW = Math.floor((contentW - gap * 2) / 3);
  const imageTitles = normalizedThumbs.map((thumb, i) => cleanLine(thumb?.title || poseTitles?.[i] || ["Front", "Side", "Back"][i] || "Pose"));

  for (let i = 0; i < 3; i++) {
    const x = contentX + i * (panelW + gap);
    const y = panelY;

    ctx.save();
    roundRectPath(ctx, x, y, panelW, panelH, 28);
    ctx.fillStyle = "rgba(0,0,0,0.46)";
    ctx.fill();
    ctx.clip();
    if (imgs[i]) {
      drawCover(ctx, imgs[i], x, y, panelW, panelH);
    } else {
      const filler = ctx.createLinearGradient(x, y, x, y + panelH);
      filler.addColorStop(0, theme.accentSoft);
      filler.addColorStop(1, "rgba(255,255,255,0.02)");
      ctx.fillStyle = filler;
      ctx.fillRect(x, y, panelW, panelH);
    }
    const shadow = ctx.createLinearGradient(x, y + panelH * 0.50, x, y + panelH);
    shadow.addColorStop(0, "rgba(0,0,0,0)");
    shadow.addColorStop(1, "rgba(0,0,0,0.82)");
    ctx.fillStyle = shadow;
    ctx.fillRect(x, y, panelW, panelH);
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x, y, panelW, panelH, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = i === 1 ? theme.accentStroke : "rgba(255,255,255,0.10)";
    ctx.stroke();
    ctx.restore();

    const indexText = `0${i + 1}`;
    ctx.fillStyle = "rgba(255,255,255,0.40)";
    ctx.font = "900 18px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(indexText, x + 16, y + 30);

    ctx.fillStyle = "#F8FBFF";
    ctx.font = "900 26px system-ui, -apple-system, Segoe UI, Roboto";
    drawWrappedText(ctx, imageTitles[i] || "Pose", x + 16, y + panelH - 56, panelW - 32, 28, 2);
  }

  cursorY = panelY + panelH + 28;

  ctx.save();
  roundRectPath(ctx, contentX, cursorY, contentW, 178, 28);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.accentStroke;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = theme.chipText;
  ctx.font = "900 22px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("STANDS OUT", contentX + 24, cursorY + 36);

  let chipX = contentX + 24;
  let chipY = cursorY + 56;
  for (const text of standouts) {
    const width = ctx.measureText(text).width + 34;
    if (chipX + width > contentX + contentW - 24) {
      chipX = contentX + 24;
      chipY += 50;
    }
    chipX += drawChip(ctx, {
      x: chipX,
      y: chipY,
      text,
      fill: theme.chip,
      stroke: theme.chipStroke,
      color: theme.chipText,
    }) + 12;
  }

  cursorY += 206;

  ctx.save();
  roundRectPath(ctx, contentX, cursorY, contentW, 204, 28);
  const noteGrad = ctx.createLinearGradient(contentX, cursorY, contentX + contentW, cursorY + 204);
  noteGrad.addColorStop(0, "rgba(255,255,255,0.05)");
  noteGrad.addColorStop(1, theme.accentSoft);
  ctx.fillStyle = noteGrad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.accentStroke;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.font = "900 20px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("NEXT UP", contentX + 24, cursorY + 34);
  ctx.fillStyle = "#F7FAFF";
  ctx.font = "800 37px system-ui, -apple-system, Segoe UI, Roboto";
  drawWrappedText(ctx, nextLine, contentX + 24, cursorY + 82, contentW - 48, 42, 3);

  cursorY += 236;

  const footerY = safeY + safeH - 114;
  ctx.fillStyle = "rgba(255,255,255,0.90)";
  ctx.font = "900 30px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("Get your own on SlimCal AI", contentX, footerY);
  ctx.fillStyle = "rgba(255,255,255,0.56)";
  ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("Pose. Scan. Post. Repeat.", contentX, footerY + 36);

  const meta = cleanLine(localDay || trackLabel || tier || "").slice(0, 26);
  if (meta) {
    ctx.font = "800 20px system-ui, -apple-system, Segoe UI, Roboto";
    const mw = ctx.measureText(meta).width;
    ctx.fillText(meta, contentX + contentW - mw, footerY + 36);
  }

  ctx.fillStyle = theme.accent;
  ctx.fillRect(contentX, footerY + 58, contentW, 2);

  return c.toDataURL("image/png");
}
