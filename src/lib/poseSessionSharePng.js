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
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
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

  const usedWords = lines.join(" ").split(" ").filter(Boolean).length;
  const remaining = words.slice(usedWords);
  if (line) {
    let tail = line;
    while (remaining.length) {
      const next = `${tail} ${remaining[0]}`;
      if (ctx.measureText(next).width > maxWidth) break;
      tail = next;
      remaining.shift();
    }
    lines.push(tail);
  }

  if (remaining.length && lines.length) {
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

function drawParagraph(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const lines = wrapLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, idx) => ctx.fillText(line, x, y + idx * lineHeight));
  return { lines, height: lines.length * lineHeight };
}

function cleanLines(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeCopy({ copy = null, mode = "baseline", gender = "male", summary = "" } = {}) {
  if (copy && typeof copy === "object") {
    return {
      modeLabel: copy.mode || (mode === "recheck" ? "Re-Check" : "Baseline Read"),
      hero: copy.hero || "You look like you train.",
      subread: copy.subread || summary || "Strong look already showing.",
      bulletsLabel: copy.bulletsLabel || (mode === "recheck" ? "WHAT IMPROVED" : "WHAT STANDS OUT"),
      bullets: cleanLines(copy.bullets).slice(0, 3),
      breakdown: cleanLines(copy.breakdown).slice(0, 3),
      nextUp: cleanLines(copy.nextUp).slice(0, 2),
    };
  }

  const female = gender === "female";
  return {
    modeLabel: mode === "recheck" ? "Re-Check" : "Baseline Read",
    hero: female ? (mode === "recheck" ? "Sharper than last time." : "You’re looking toned.") : (mode === "recheck" ? "Cleaner and more dialed." : "You look like you train."),
    subread: summary || (female ? "Your shape already looks polished and put together." : "Strong upper-body base. Lean, athletic look already showing."),
    bulletsLabel: mode === "recheck" ? "WHAT IMPROVED" : "WHAT STANDS OUT",
    bullets: female
      ? ["Balanced, toned shape", "Lean waist", "Strong, put-together look"]
      : ["Broad shoulders", "Solid upper-body presence", "Lean, athletic base"],
    breakdown: female
      ? ["Your shape already reads clean and athletic.", "Back and shoulders show nice definition."]
      : ["Your shoulders read first, which gives you that trained look right away.", "Your upper body already has solid structure."] ,
    nextUp: female
      ? ["A little more lower-body shape would make this pop even more."]
      : ["A little more chest, delts, and arms would make this hit even harder."],
  };
}

function drawSpeckles(ctx, W, H) {
  const dots = [
    [0.12, 0.08, 1.5, 0.35], [0.22, 0.16, 2.5, 0.28], [0.48, 0.11, 3.1, 0.32], [0.83, 0.12, 2.4, 0.3],
    [0.72, 0.2, 1.8, 0.22], [0.18, 0.27, 1.6, 0.24], [0.9, 0.32, 2.2, 0.26], [0.34, 0.43, 1.9, 0.18],
    [0.68, 0.52, 1.4, 0.18], [0.27, 0.66, 2.6, 0.22], [0.79, 0.76, 2.4, 0.26], [0.14, 0.84, 2.1, 0.22],
  ];
  dots.forEach(([rx, ry, rr, ra]) => {
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 222, 170, ${ra})`;
    ctx.arc(W * rx, H * ry, rr, 0, Math.PI * 2);
    ctx.fill();
  });
}

export async function buildPoseSessionSharePng({
  mode = "baseline",
  gender = "male",
  copy = null,
  thumbs = [],
  summary = "",
  hashtag = "#SlimCalAI",
} = {}) {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const normalized = normalizeCopy({ copy, mode, gender, summary });
  const isRecheck = mode === "recheck";

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#130507");
  bg.addColorStop(0.4, "#2a0907");
  bg.addColorStop(0.72, "#4d120b");
  bg.addColorStop(1, "#170507");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const nebula = ctx.createRadialGradient(W * 0.52, H * 0.14, 20, W * 0.52, H * 0.14, H * 0.7);
  nebula.addColorStop(0, "rgba(255,220,150,0.34)");
  nebula.addColorStop(0.18, "rgba(255,140,70,0.18)");
  nebula.addColorStop(0.5, "rgba(255,80,50,0.08)");
  nebula.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, W, H);
  drawSpeckles(ctx, W, H);

  const cardX = 44;
  const cardY = 46;
  const cardW = W - 88;
  const cardH = H - 92;

  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 42);
  ctx.fillStyle = "rgba(31, 7, 8, 0.76)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(243, 199, 147, 0.65)";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, cardX + 10, cardY + 10, cardW - 20, cardH - 20, 36);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 225, 190, 0.22)";
  ctx.stroke();
  ctx.restore();

  const contentX = cardX + 34;
  const contentW = cardW - 68;
  let y = cardY + 56;

  ctx.fillStyle = "#f8e9dc";
  ctx.font = "900 58px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("SlimCal", contentX, y);
  const slimCalW = ctx.measureText("SlimCal").width;
  const pillX = contentX + slimCalW + 12;
  const pillY = y - 43;
  ctx.save();
  roundRectPath(ctx, pillX, pillY, 78, 42, 10);
  ctx.fillStyle = "rgba(128, 74, 28, 0.84)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 211, 148, 0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#f2d185";
  ctx.font = "800 27px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("AI", pillX + 22, y - 12);
  ctx.restore();

  y += 52;
  ctx.fillStyle = "rgba(248, 233, 220, 0.95)";
  ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("POSE SESSION", contentX, y);

  y += 28;
  const rule = ctx.createLinearGradient(contentX, y, contentX + contentW, y);
  rule.addColorStop(0, "rgba(255, 184, 92, 0)");
  rule.addColorStop(0.18, "rgba(255, 183, 94, 0.95)");
  rule.addColorStop(1, "rgba(255, 184, 92, 0.10)");
  ctx.fillStyle = rule;
  ctx.fillRect(contentX, y, contentW, 3);

  y += 58;
  ctx.fillStyle = "#f5d08a";
  ctx.font = "800 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(normalized.modeLabel.toUpperCase(), contentX, y);

  y += 22;
  ctx.fillStyle = isRecheck ? "#f4d46f" : "#f7d9c6";
  ctx.font = "italic 76px Georgia, Times New Roman, serif";
  const heroLines = wrapLines(ctx, normalized.hero, contentW, 2);
  heroLines.forEach((line, idx) => {
    ctx.fillText(line, contentX, y + idx * 78);
  });

  y += heroLines.length * 78 + 12;
  ctx.fillStyle = "rgba(248, 235, 222, 0.96)";
  ctx.font = "500 23px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const subreadBlock = drawParagraph(ctx, normalized.subread, contentX, y, contentW, 30, 3);
  y += subreadBlock.height + 36;

  const normalizedThumbs = (Array.isArray(thumbs) ? thumbs : []).slice(0, 3);
  const images = [];
  for (const thumb of normalizedThumbs) {
    try {
      images.push(thumb?.dataUrl ? await loadImage(thumb.dataUrl) : null);
    } catch {
      images.push(null);
    }
  }
  while (images.length < 3) images.push(null);

  const thumbGap = 16;
  const thumbW = Math.floor((contentW - thumbGap * 2) / 3);
  const thumbH = 274;
  for (let i = 0; i < 3; i++) {
    const x = contentX + i * (thumbW + thumbGap);
    ctx.save();
    roundRectPath(ctx, x, y, thumbW, thumbH, 24);
    ctx.fillStyle = "rgba(49, 12, 10, 0.85)";
    ctx.fill();
    ctx.clip();
    if (images[i]) drawCover(ctx, images[i], x, y, thumbW, thumbH);
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x, y, thumbW, thumbH, 24);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 201, 126, 0.62)";
    ctx.shadowColor = "rgba(255, 168, 80, 0.34)";
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.restore();
  }
  y += thumbH + 46;

  const drawSectionLabel = (label, top) => {
    ctx.fillStyle = "#f3cd8a";
    ctx.font = "800 21px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(label, contentX, top);
    const labelW = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(255, 193, 120, 0.28)";
    ctx.fillRect(contentX + labelW + 16, top - 8, contentW - labelW - 16, 2);
  };

  drawSectionLabel(normalized.bulletsLabel, y);
  y += 28;
  ctx.fillStyle = "rgba(247, 236, 228, 0.96)";
  ctx.font = "500 21px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  normalized.bullets.slice(0, 3).forEach((item) => {
    ctx.beginPath();
    ctx.fillStyle = "#f0cf8c";
    ctx.arc(contentX + 9, y - 7, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(247, 236, 228, 0.96)";
    const bullet = drawParagraph(ctx, item, contentX + 24, y, contentW - 24, 28, 2);
    y += Math.max(34, bullet.height + 2);
  });

  y += 14;
  drawSectionLabel("BREAKDOWN", y);
  y += 30;
  ctx.fillStyle = "rgba(247, 236, 228, 0.94)";
  ctx.font = "500 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  normalized.breakdown.slice(0, 3).forEach((item) => {
    const block = drawParagraph(ctx, item, contentX, y, contentW, 28, 3);
    y += block.height + 14;
  });

  y += 6;
  drawSectionLabel("NEXT UP", y);
  y += 30;
  ctx.fillStyle = "rgba(247, 236, 228, 0.94)";
  ctx.font = "500 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  normalized.nextUp.slice(0, 2).forEach((item) => {
    const block = drawParagraph(ctx, item, contentX, y, contentW, 28, 3);
    y += block.height + 14;
  });

  const buttonH = 76;
  const footerBrandY = cardY + cardH - 52;
  const footerButtonY = footerBrandY - 116;

  if (y > footerButtonY - 18) y = footerButtonY - 18;

  ctx.save();
  roundRectPath(ctx, contentX, footerButtonY, contentW, buttonH, 22);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 193, 120, 0.72)";
  ctx.shadowColor = "rgba(255, 168, 80, 0.18)";
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#f2c77e";
  ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const shareW = ctx.measureText("SHARE").width;
  ctx.fillText("SHARE", contentX + (contentW - shareW) / 2, footerButtonY + 48);

  ctx.fillStyle = "#f4ddd0";
  ctx.font = "800 32px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("SlimCal", contentX + 112, footerBrandY);
  const brandW = ctx.measureText("SlimCal").width;
  ctx.save();
  roundRectPath(ctx, contentX + 112 + brandW + 10, footerBrandY - 28, 68, 34, 9);
  ctx.fillStyle = "rgba(128, 74, 28, 0.84)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 211, 148, 0.48)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#f2d185";
  ctx.font = "800 21px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("AI", contentX + 112 + brandW + 31, footerBrandY - 6);
  ctx.restore();

  ctx.fillStyle = "rgba(249, 232, 213, 0.92)";
  ctx.font = "700 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(hashtag, contentX + 112, footerBrandY + 32);

  ctx.save();
  ctx.fillStyle = "rgba(207, 118, 118, 0.78)";
  roundRectPath(ctx, cardX + cardW / 2 - 62, cardY + cardH - 24, 124, 6, 3);
  ctx.fill();
  ctx.restore();

  return canvas.toDataURL("image/png");
}
