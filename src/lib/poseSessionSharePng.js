// src/lib/poseSessionSharePng.js
// Warm premium Pose Session share card generator.
// Optimized for social story/feed posting while matching the in-app result layer.

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

function cleanLine(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[-•\s]+/, "")
    .trim();
}

function wrapText(ctx, text, maxWidth) {
  const source = cleanLine(text);
  if (!source) return [];
  const words = source.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapTextMax(ctx, text, maxWidth, maxLines = 3) {
  const lines = wrapText(ctx, text, maxWidth);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 0) {
    last = last.slice(0, -1).trim();
  }
  out[maxLines - 1] = `${last}…`;
  return out;
}

function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const lines = wrapTextMax(ctx, text, maxWidth, maxLines);
  lines.forEach((line, idx) => ctx.fillText(line, x, y + idx * lineHeight));
  return lines.length;
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
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawStarField(ctx, W, H) {
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 2.2 + 0.4;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, ${180 + Math.round(Math.random() * 50)}, ${120 + Math.round(Math.random() * 60)}, ${0.08 + Math.random() * 0.25})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function defaultCopy(gender = "male", mode = "baseline") {
  const isFemale = gender === "female";
  const isRecheck = mode === "recheck";
  if (isFemale && isRecheck) {
    return {
      modeLabel: "Re-Check",
      hero: "Sharper than last time.",
      subRead: "Cleaner, more dialed, and more complete than the last scan.",
      sectionLabel: "WHAT IMPROVED",
      bullets: ["More polished shape", "Better waist and back definition", "More confident presentation"],
      breakdown: "Tighter, cleaner definition with a more athletic full look.",
      nextUp: "Keep building shape while holding onto the polished look already showing.",
      coachNote: "Real visible progress that people will actually notice.",
    };
  }
  if (isFemale) {
    return {
      modeLabel: "Baseline Read",
      hero: "You’re looking toned.",
      subRead: "Lean, polished shape with a strong foundation already there.",
      sectionLabel: "WHAT STANDS OUT",
      bullets: ["Balanced toned shape", "Lean waist", "Put-together look"],
      breakdown: "Clean athletic shape with nice definition through the waist, back, and shoulders.",
      nextUp: "More lower-body shape would make this pop even more.",
      coachNote: "Strong baseline. The shape is already there.",
    };
  }
  if (isRecheck) {
    return {
      modeLabel: "Re-Check",
      hero: "Cleaner and more dialed.",
      subRead: "Sharper than last time with a more complete look overall.",
      sectionLabel: "WHAT IMPROVED",
      bullets: ["More upper-body definition", "Better shoulder pop", "Cleaner presentation"],
      breakdown: "Sharper shoulders, arms, and torso with a more refined overall look.",
      nextUp: "Keep adding upper-body size while holding onto the leanness.",
      coachNote: "Visible progress without forcing it. The next jump should stand out even more.",
    };
  }
  return {
    modeLabel: "Baseline Read",
    hero: "You look like you train.",
    subRead: "Strong upper-body base. Lean, athletic look already showing.",
    sectionLabel: "WHAT STANDS OUT",
    bullets: ["Broad shoulders", "Solid upper-body presence", "Lean athletic base"],
    breakdown: "Strong upper-body base with a clean athletic look already showing.",
    nextUp: "More chest, delts, and arms would make this hit even harder.",
    coachNote: "Strong baseline. Keep stacking size while staying lean.",
  };
}

export async function buildPoseSessionSharePng({
  gender = "male",
  mode = "baseline",
  copy = null,
  thumbs = [],
  hashtag = "#SlimCalAI",
} = {}) {
  const shareCopy = copy || defaultCopy(gender, mode);
  const safeHashtag = cleanLine(hashtag || "#SlimCalAI") || "#SlimCalAI";

  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#140404");
  bg.addColorStop(0.45, "#240708");
  bg.addColorStop(1, "#100203");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glowTop = ctx.createRadialGradient(W * 0.52, H * 0.08, 40, W * 0.52, H * 0.08, H * 0.7);
  glowTop.addColorStop(0, "rgba(255,205,120,0.30)");
  glowTop.addColorStop(0.18, "rgba(255,140,70,0.18)");
  glowTop.addColorStop(0.7, "rgba(0,0,0,0)");
  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, W, H);

  const glowRight = ctx.createRadialGradient(W * 0.84, H * 0.18, 30, W * 0.84, H * 0.18, H * 0.46);
  glowRight.addColorStop(0, "rgba(255,140,90,0.22)");
  glowRight.addColorStop(0.65, "rgba(0,0,0,0)");
  ctx.fillStyle = glowRight;
  ctx.fillRect(0, 0, W, H);

  drawStarField(ctx, W, H);

  const pad = 38;
  const cardX = pad;
  const cardY = pad;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;

  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 42);
  ctx.fillStyle = "rgba(36, 7, 8, 0.78)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 200, 132, 0.58)";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, cardX + 8, cardY + 8, cardW - 16, cardH - 16, 36);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 220, 175, 0.28)";
  ctx.stroke();
  ctx.restore();

  const contentX = cardX + 32;
  const contentW = cardW - 64;
  let y = cardY + 36;

  ctx.fillStyle = "#FFE5D6";
  ctx.font = "800 64px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("SlimCal", contentX, y + 14);

  const slimW = ctx.measureText("SlimCal").width;
  ctx.save();
  roundRectPath(ctx, contentX + slimW + 10, y - 28, 78, 40, 10);
  ctx.fillStyle = "rgba(255, 209, 128, 0.14)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 209, 128, 0.45)";
  ctx.stroke();
  ctx.fillStyle = "#F4C66F";
  ctx.font = "800 30px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("AI", contentX + slimW + 29, y + 1);
  ctx.restore();

  y += 52;
  ctx.fillStyle = "rgba(255, 229, 214, 0.96)";
  ctx.font = "800 26px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("POSE SESSION", contentX, y);

  y += 28;
  const line = ctx.createLinearGradient(contentX, y, contentX + contentW, y);
  line.addColorStop(0, "rgba(255, 190, 120, 0.18)");
  line.addColorStop(0.45, "rgba(255, 199, 120, 0.95)");
  line.addColorStop(1, "rgba(255, 190, 120, 0.18)");
  ctx.fillStyle = line;
  ctx.fillRect(contentX, y, contentW, 2);

  y += 48;
  ctx.fillStyle = "#EAB36B";
  ctx.font = "800 26px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(String(shareCopy.modeLabel || "Baseline Read").toUpperCase(), contentX, y);

  y += 26;
  ctx.fillStyle = "#F8DCCF";
  ctx.font = 'italic 700 76px Georgia, "Times New Roman", serif';
  const heroLines = wrapTextMax(ctx, shareCopy.hero, contentW, 2);
  heroLines.forEach((lineText, idx) => ctx.fillText(lineText, contentX, y + idx * 74));
  y += heroLines.length * 74;

  ctx.fillStyle = "rgba(255, 226, 212, 0.90)";
  ctx.font = "600 24px system-ui, -apple-system, Segoe UI, Roboto";
  const subLines = wrapTextMax(ctx, shareCopy.subRead, contentW, 3);
  subLines.forEach((lineText, idx) => ctx.fillText(lineText, contentX, y + 18 + idx * 30));
  y += 28 + subLines.length * 30;

  const normalizedThumbs = (Array.isArray(thumbs) ? thumbs : []).slice(0, 3);
  const imgs = [];
  for (let i = 0; i < 3; i++) {
    const u = normalizedThumbs[i]?.dataUrl;
    try {
      imgs.push(u ? await loadImage(u) : null);
    } catch {
      imgs.push(null);
    }
  }

  y += 26;
  const imgGap = 16;
  const imgW = Math.floor((contentW - imgGap * 2) / 3);
  const imgH = 338;
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
    ctx.lineWidth = 3;
    ctx.strokeStyle = i === 1 ? "rgba(255, 191, 108, 0.9)" : "rgba(255, 190, 120, 0.52)";
    ctx.stroke();
    ctx.restore();
  }
  y += imgH + 38;

  ctx.fillStyle = "#F0BE7B";
  ctx.font = "900 23px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(String(shareCopy.sectionLabel || "WHAT STANDS OUT").toUpperCase(), contentX, y);
  ctx.fillStyle = "rgba(255,190,120,0.35)";
  ctx.fillRect(contentX + 250, y - 11, contentW - 250, 2);
  y += 34;

  ctx.fillStyle = "rgba(255, 233, 220, 0.96)";
  ctx.font = "600 20px system-ui, -apple-system, Segoe UI, Roboto";
  for (const bullet of (shareCopy.bullets || []).slice(0, 3)) {
    ctx.beginPath();
    ctx.fillStyle = "#F1C067";
    ctx.arc(contentX + 9, y - 6, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 233, 220, 0.96)";
    drawWrapped(ctx, bullet, contentX + 26, y, contentW - 26, 24, 2);
    y += 38;
  }

  const compactSection = (label, text, maxLines = 4) => {
    ctx.fillStyle = "#F0BE7B";
    ctx.font = "900 23px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(label, contentX, y);
    ctx.fillStyle = "rgba(255,190,120,0.35)";
    ctx.fillRect(contentX + 170, y - 11, contentW - 170, 2);
    y += 30;
    ctx.fillStyle = "rgba(255, 225, 210, 0.92)";
    ctx.font = "600 19px system-ui, -apple-system, Segoe UI, Roboto";
    const lines = drawWrapped(ctx, text, contentX, y, contentW, 25, maxLines);
    y += lines * 25 + 20;
  };

  compactSection("BREAKDOWN", shareCopy.breakdown, 4);
  compactSection("NEXT UP", shareCopy.nextUp, 4);
  compactSection("COACH NOTE", shareCopy.coachNote, 4);

  const buttonH = 64;
  const buttonY = H - 214;
  ctx.save();
  roundRectPath(ctx, contentX, buttonY, contentW, buttonH, 24);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 190, 120, 0.68)";
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#F3C57D";
  ctx.font = "800 28px system-ui, -apple-system, Segoe UI, Roboto";
  const shareText = "SHARE";
  const shareWidth = ctx.measureText(shareText).width;
  ctx.fillText(shareText, contentX + (contentW - shareWidth) / 2, buttonY + 42);

  const footY = H - 126;
  ctx.fillStyle = "#FFD8CC";
  ctx.font = "800 30px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("SlimCal", contentX + 120, footY);
  const footSlimW = ctx.measureText("SlimCal").width;
  ctx.save();
  roundRectPath(ctx, contentX + 120 + footSlimW + 10, footY - 28, 66, 34, 9);
  ctx.fillStyle = "rgba(255, 209, 128, 0.14)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 209, 128, 0.45)";
  ctx.stroke();
  ctx.fillStyle = "#F4C66F";
  ctx.font = "800 24px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("AI", contentX + 120 + footSlimW + 24, footY - 2);
  ctx.restore();

  ctx.fillStyle = "rgba(255, 223, 206, 0.88)";
  ctx.font = "600 18px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(safeHashtag, contentX + 108, H - 92);

  ctx.save();
  ctx.fillStyle = "rgba(222, 146, 154, 0.62)";
  roundRectPath(ctx, W / 2 - 80, H - 56, 160, 6, 3);
  ctx.fill();
  ctx.restore();

  return canvas.toDataURL("image/png");
}
