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

function clean(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[-•\s]+/, "")
    .replace(/[.]{2,}/g, ".")
    .trim();
}

function dedupeList(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const t = clean(item);
    if (!t) continue;
    const key = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(the|and|with|your|more|already)\b/g, "").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function shortenSentence(text = "", max = 88) {
  let s = clean(text);
  if (!s) return "";
  s = s
    .replace(/Compared to the last scan,\s*/i, "")
    .replace(/Compared with your recent baseline,\s*/i, "")
    .replace(/This looks /i, "")
    .replace(/There’s /i, "")
    .replace(/There is /i, "")
    .replace(/Your /i, "")
    .replace(/and the overall look feels more complete\.?/i, "")
    .replace(/, which makes[^.]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const parts = s.split(/[,.]| and /i).map(clean).filter(Boolean);
  let out = "";
  for (const part of parts) {
    const next = out ? `${out}. ${part}` : part;
    if (next.length > max) break;
    out = next;
  }
  s = out || s.slice(0, max - 1).trim();
  return s.replace(/[,:;\-–—\s]+$/g, "").trim();
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = clean(text).split(" ").filter(Boolean);
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
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

function fitScriptFont(ctx, text, maxWidth, start = 78, min = 46) {
  let size = start;
  while (size >= min) {
    ctx.font = `700 italic ${size}px Georgia, Times New Roman, serif`;
    if (ctx.measureText(clean(text)).width <= maxWidth) return size;
    size -= 2;
  }
  return min;
}

function drawBullets(ctx, items, x, y, maxWidth, lineHeight, bulletGap) {
  let yy = y;
  for (const item of items) {
    const lines = wrapLines(ctx, item, maxWidth - 34, 2);
    if (!lines.length) continue;
    ctx.fillText("•", x, yy);
    lines.forEach((line, idx) => ctx.fillText(line, x + 28, yy + idx * lineHeight));
    yy += lines.length * lineHeight + bulletGap;
  }
  return yy;
}

function normalizeShareTemplate(template = {}) {
  const bullets = dedupeList(template.bullets || []).slice(0, 3);
  const breakdown = dedupeList((template.breakdown || []).map((x) => shortenSentence(x, 84))).slice(0, 3);
  const nextUp = dedupeList((template.nextUp || []).map((x) => shortenSentence(x, 112))).slice(0, 2);
  return {
    mode: clean(template.mode || "Baseline Read"),
    hero: clean(template.hero || "You look like you train."),
    bulletsLabel: clean(template.bulletsLabel || "WHAT STANDS OUT"),
    bullets,
    breakdown,
    nextUp,
  };
}

export async function buildPoseSessionSharePng({
  shareTemplate = null,
  thumbs = [],
  hashtag = "#SlimCalAI",
} = {}) {
  const tpl = normalizeShareTemplate(shareTemplate || {});

  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#2a0909");
  bg.addColorStop(0.23, "#5a0c07");
  bg.addColorStop(0.55, "#2b0808");
  bg.addColorStop(1, "#160406");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const nebula = [
    [W * 0.25, H * 0.18, 420, "rgba(255,176,82,0.22)"],
    [W * 0.74, H * 0.12, 380, "rgba(255,211,124,0.14)"],
    [W * 0.55, H * 0.55, 520, "rgba(255,112,40,0.10)"],
    [W * 0.50, H * 0.82, 460, "rgba(255,145,86,0.08)"],
  ];
  for (const [x, y, r, color] of nebula) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  for (let i = 0; i < 140; i++) {
    const x = (Math.sin(i * 91.3) * 0.5 + 0.5) * W;
    const y = (Math.sin(i * 51.7 + 1.3) * 0.5 + 0.5) * H;
    const r = 0.7 + ((i * 17) % 10) / 10;
    ctx.fillStyle = i % 4 === 0 ? "rgba(255,221,180,0.65)" : "rgba(255,195,120,0.28)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const cardX = 42;
  const cardY = 84;
  const cardW = W - 84;
  const cardH = H - 168;

  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 44);
  ctx.fillStyle = "rgba(35, 6, 8, 0.72)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,214,162,0.82)";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, cardX + 12, cardY + 12, cardW - 24, cardH - 24, 36);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,201,138,0.42)";
  ctx.stroke();
  ctx.restore();

  const padX = cardX + 42;
  const contentW = cardW - 84;
  let y = cardY + 72;

  ctx.fillStyle = "rgba(255,236,223,0.98)";
  ctx.font = "500 54px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("SlimCal", padX, y);
  const slimW = ctx.measureText("SlimCal").width;
  ctx.save();
  roundRectPath(ctx, padX + slimW + 14, y - 42, 90, 44, 10);
  ctx.fillStyle = "rgba(166,112,34,0.88)";
  ctx.fill();
  ctx.fillStyle = "rgba(255,233,165,0.98)";
  ctx.font = "700 30px Georgia, Times New Roman, serif";
  ctx.fillText("AI", padX + slimW + 39, y - 12);
  ctx.restore();

  y += 56;
  ctx.fillStyle = "rgba(255,239,226,0.98)";
  ctx.font = "500 42px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("POSE SESSION", padX, y);

  y += 32;
  const lineY = y;
  ctx.fillStyle = "rgba(255,188,106,0.72)";
  ctx.fillRect(padX, lineY, contentW, 2);
  const flare = ctx.createRadialGradient(padX + contentW * 0.56, lineY + 1, 0, padX + contentW * 0.56, lineY + 1, 120);
  flare.addColorStop(0, "rgba(255,231,167,0.95)");
  flare.addColorStop(1, "rgba(255,231,167,0)");
  ctx.fillStyle = flare;
  ctx.fillRect(padX + contentW * 0.56 - 120, lineY - 36, 240, 72);

  y += 56;
  ctx.fillStyle = "rgba(255,226,180,0.98)";
  ctx.font = "500 38px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(tpl.mode.toUpperCase(), padX, y);

  y += 82;
  const heroSize = fitScriptFont(ctx, tpl.hero, contentW, 82, 54);
  ctx.font = `700 italic ${heroSize}px Georgia, Times New Roman, serif`;
  ctx.fillStyle = tpl.mode.toLowerCase().includes("re-check")
    ? "rgba(255,222,128,0.98)"
    : "rgba(255,222,213,0.98)";
  const heroLines = wrapLines(ctx, tpl.hero, contentW, 2);
  heroLines.forEach((line, idx) => ctx.fillText(line, padX, y + idx * (heroSize + 4)));
  y += heroLines.length * (heroSize + 4) + 30;

  const thumbGap = 14;
  const thumbW = Math.floor((contentW - thumbGap * 2) / 3);
  const thumbH = 420;
  const images = [];
  const safeThumbs = Array.isArray(thumbs) ? thumbs.slice(0, 3) : [];
  for (let i = 0; i < 3; i++) {
    try {
      images.push(safeThumbs[i]?.dataUrl ? await loadImage(safeThumbs[i].dataUrl) : null);
    } catch {
      images.push(null);
    }
  }

  for (let i = 0; i < 3; i++) {
    const x = padX + i * (thumbW + thumbGap);
    ctx.save();
    roundRectPath(ctx, x, y, thumbW, thumbH, 28);
    ctx.fillStyle = "rgba(32,11,10,0.45)";
    ctx.fill();
    ctx.clip();
    if (images[i]) drawCover(ctx, images[i], x, y, thumbW, thumbH);
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, x, y, thumbW, thumbH, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,191,124,0.92)";
    ctx.stroke();
    ctx.restore();
  }
  y += thumbH + 44;

  const sectionLabel = (text, yy) => {
    ctx.fillStyle = "rgba(255,201,126,0.98)";
    ctx.font = "500 44px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(text, padX, yy);
    const lx = padX + ctx.measureText(text).width + 18;
    ctx.fillStyle = "rgba(255,196,118,0.48)";
    ctx.fillRect(lx, yy - 14, contentW - (lx - padX), 2);
  };

  sectionLabel(tpl.bulletsLabel, y);
  y += 46;
  ctx.fillStyle = "rgba(255,238,228,0.98)";
  ctx.font = "400 27px system-ui, -apple-system, Segoe UI, Roboto";
  y = drawBullets(ctx, tpl.bullets, padX + 4, y, contentW, 36, 10) + 18;

  sectionLabel("BREAKDOWN", y);
  y += 44;
  ctx.fillStyle = "rgba(255,239,230,0.98)";
  ctx.font = "400 26px system-ui, -apple-system, Segoe UI, Roboto";
  y = drawBullets(ctx, tpl.breakdown, padX + 4, y, contentW, 34, 12) + 14;

  sectionLabel("NEXT UP", y);
  y += 44;
  ctx.fillStyle = "rgba(255,239,230,0.98)";
  ctx.font = "400 28px system-ui, -apple-system, Segoe UI, Roboto";
  const nextLines = tpl.nextUp.slice(0, 2);
  nextLines.forEach((line, idx) => {
    const wrapped = wrapLines(ctx, line, contentW, idx === 0 ? 3 : 2);
    wrapped.forEach((wline, widx) => ctx.fillText(wline, padX, y + widx * 36));
    y += wrapped.length * 36 + 12;
  });

  const footerY = cardY + cardH - 52;
  ctx.fillStyle = "rgba(255,235,223,0.98)";
  ctx.font = "500 52px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("SlimCal", padX + 182, footerY);
  const footW = ctx.measureText("SlimCal").width;
  ctx.save();
  roundRectPath(ctx, padX + 182 + footW + 14, footerY - 40, 90, 42, 10);
  ctx.fillStyle = "rgba(166,112,34,0.88)";
  ctx.fill();
  ctx.fillStyle = "rgba(255,233,165,0.98)";
  ctx.font = "700 30px Georgia, Times New Roman, serif";
  ctx.fillText("AI", padX + 182 + footW + 39, footerY - 11);
  ctx.restore();

  ctx.fillStyle = "rgba(255,241,224,0.92)";
  ctx.font = "400 26px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(clean(hashtag || "#SlimCalAI"), padX + 194, footerY + 42);

  ctx.save();
  ctx.fillStyle = "rgba(255,184,196,0.7)";
  roundRectPath(ctx, W / 2 - 92, cardY + cardH - 18, 184, 8, 4);
  ctx.fill();
  ctx.restore();

  return c.toDataURL("image/png");
}
