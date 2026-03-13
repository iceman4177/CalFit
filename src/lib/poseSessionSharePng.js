// src/lib/poseSessionSharePng.js
// Premium Pose Session share card generator.
// Locked 4-state system: male/female × baseline/re-check.

function clean(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
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

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
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

function wrapText(ctx, text, maxWidth) {
  const words = clean(text).split(" ").filter(Boolean);
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

function drawParagraph(ctx, text, x, y, maxWidth, lineHeight, maxLines = 10) {
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return lines.length * lineHeight;
}

function drawBulletList(ctx, items, x, y, maxWidth, lineHeight) {
  let cursorY = y;
  for (const item of items) {
    const lines = wrapText(ctx, item, maxWidth - 34);
    ctx.fillText("•", x, cursorY);
    lines.forEach((line, idx) => ctx.fillText(line, x + 28, cursorY + idx * lineHeight));
    cursorY += Math.max(1, lines.length) * lineHeight + 10;
  }
  return cursorY - y;
}

function drawSparkles(ctx, W, H) {
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 2.2 + 0.4;
    const a = Math.random() * 0.6 + 0.15;
    ctx.fillStyle = `rgba(255,${180 + Math.round(Math.random() * 60)},${90 + Math.round(Math.random() * 50)},${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGlow(ctx, x, y, r, inner, outer = "rgba(0,0,0,0)") {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

const COPY = {
  male_baseline: {
    mode: "BASELINE READ",
    hero: "You look like you train.",
    subRead: "You've already got a strong upper-body look, and the base is clearly there for an even more standout physique.",
    sectionLabel: "WHAT STANDS OUT",
    bullets: [
      "Broad shoulders",
      "Solid upper-body presence",
      "Lean, athletic base",
    ],
    breakdown: "Your shoulders read first, which gives you that trained look right away. Your upper body already has solid shape, and there's enough structure there that it doesn't look random or undeveloped. Your arms and upper torso are starting to come together nicely, and your frame gives off a clean athletic look already. From the back, there's a good starting outline through the shoulders and upper back, which makes the physique feel more put together overall.",
    nextUp: "You're already looking lean and athletic, and you're well on your way to looking even more built and dialed. A little more upper-body size, especially through the chest, delts, and arms, would make this hit even harder.",
    coachNote: "This is a strong baseline because you're not starting from zero. You already look like someone who trains, and if you keep stacking size while staying lean, this can turn into a seriously sharp physique.",
  },
  male_recheck: {
    mode: "RE-CHECK",
    hero: "Cleaner and more dialed.",
    subRead: "This looks sharper than last time. The physique is tightening up, and the overall look feels more complete.",
    sectionLabel: "WHAT IMPROVED",
    bullets: [
      "More upper-body definition",
      "Better shoulder pop",
      "Cleaner overall presentation",
    ],
    breakdown: "Your upper body looks more dialed than before, especially through the shoulders and arms. There's a cleaner look through the torso now, which makes the physique read sharper right away. Your back and shoulder area feel a little more developed, and the overall presentation comes across more confident and more trained. Compared to the last scan, this doesn't just look similar — it looks more refined.",
    nextUp: "You're already looking fit and sculpted, and this is clearly moving toward an even more standout build. Keep pushing size in the upper body while holding onto the leanness that's already showing, and this will separate fast.",
    coachNote: "The big win here is that the progress is visible without needing to force it. You're already carrying a sharper look, and if you keep the same consistency, the next jump should be even easier to notice.",
  },
  female_baseline: {
    mode: "BASELINE READ",
    hero: "You're looking toned.",
    subRead: "Your shape already looks clean and put together, and the overall look is trending toward even more polished.",
    sectionLabel: "WHAT STANDS OUT",
    bullets: [
      "Balanced, toned shape",
      "Lean waist",
      "Strong, put-together look",
    ],
    breakdown: "Your physique already reads toned, especially through the waist and overall shape. There's a clean athletic look here that feels balanced instead of forced, which makes the result come across polished. Your back and shoulders show nice definition, and the way your shape carries on camera gives the whole scan a confident feel. Your lower body also gives a strong foundation to the look, so overall this already feels like a fit, put-together baseline.",
    nextUp: "You're already looking lean and polished, and you're well on your way to looking even more sculpted. A little more shape through the glutes and lower body would make this pop even more while keeping the same clean toned look.",
    coachNote: "This is a really strong baseline because the shape is already there. You don't need a complete transformation to look good — you already do — and the next phase is just about making the strengths show even more.",
  },
  female_recheck: {
    mode: "RE-CHECK",
    hero: "Sharper than last time.",
    subRead: "This looks cleaner, more dialed, and more complete than your last scan.",
    sectionLabel: "WHAT IMPROVED",
    bullets: [
      "More polished overall shape",
      "Better definition through the waist and back",
      "Stronger, more confident presentation",
    ],
    breakdown: "Your physique looks more refined than before, especially through the waist, back, and overall shape. There's a tighter, cleaner feel to the scan now, which makes the whole look come across more toned and more intentional. Your shoulders and upper back are reading with better definition, and the lower body shape feels more connected to the full look. Compared to the last scan, this feels more dialed and more obviously athletic.",
    nextUp: "You're already looking strong and toned, and this is clearly heading toward an even more sculpted version of the same look. Keep building shape where it counts while holding onto the polished look that's already showing.",
    coachNote: "What's nice here is that the progress feels real and visible, not forced. You already had a good base, and now it's starting to look more refined in a way people will actually notice.",
  },
};

function getStateCopy({ gender = "male", mode = "baseline" } = {}) {
  const g = String(gender || "male").toLowerCase() === "female" ? "female" : "male";
  const m = String(mode || "baseline").toLowerCase() === "recheck" ? "recheck" : "baseline";
  return COPY[`${g}_${m}`] || COPY.male_baseline;
}

export async function buildPoseSessionSharePng({
  gender = "male",
  mode = "baseline",
  thumbs = [],
  hashtag = "#SlimCalAI",
} = {}) {
  const copy = getStateCopy({ gender, mode });
  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#140608");
  bg.addColorStop(0.35, "#2a0e10");
  bg.addColorStop(0.72, "#4f170d");
  bg.addColorStop(1, "#14070a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  drawGlow(ctx, W * 0.18, H * 0.14, 260, "rgba(255,158,80,0.18)");
  drawGlow(ctx, W * 0.82, H * 0.24, 340, "rgba(255,112,84,0.18)");
  drawGlow(ctx, W * 0.55, H * 0.74, 480, "rgba(255,145,64,0.12)");
  drawSparkles(ctx, W, H);

  const outerX = 28;
  const outerY = 56;
  const outerW = W - 56;
  const outerH = H - 112;

  ctx.save();
  roundRectPath(ctx, outerX, outerY, outerW, outerH, 54);
  ctx.fillStyle = "rgba(10,4,6,0.58)";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,224,200,0.78)";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, outerX + 8, outerY + 8, outerW - 16, outerH - 16, 48);
  ctx.strokeStyle = "rgba(255,170,110,0.38)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const cardX = outerX + 26;
  const cardY = outerY + 22;
  const cardW = outerW - 52;
  const lineStart = cardX + 18;
  const lineEnd = cardX + cardW - 18;

  ctx.fillStyle = "rgba(255,233,224,0.96)";
  ctx.font = "700 44px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("SlimCal", cardX, cardY + 36);
  ctx.save();
  ctx.font = "700 28px Georgia, Times New Roman, serif";
  const slimW = ctx.measureText("SlimCal").width;
  const aiX = cardX + slimW + 14;
  const aiY = cardY + 5;
  roundRectPath(ctx, aiX, aiY, 72, 36, 8);
  ctx.fillStyle = "rgba(255,206,95,0.22)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,206,95,0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,218,124,0.98)";
  ctx.fillText("AI", aiX + 21, aiY + 26);
  ctx.restore();

  ctx.fillStyle = "rgba(255,232,220,0.92)";
  ctx.font = "700 26px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("POSE SESSION", cardX, cardY + 86);

  const ruleY = cardY + 112;
  const rule = ctx.createLinearGradient(lineStart, ruleY, lineEnd, ruleY);
  rule.addColorStop(0, "rgba(255,186,110,0.12)");
  rule.addColorStop(0.48, "rgba(255,196,116,1)");
  rule.addColorStop(1, "rgba(255,186,110,0.12)");
  ctx.fillStyle = rule;
  ctx.fillRect(lineStart, ruleY, cardW - 36, 2);

  ctx.fillStyle = "rgba(255,210,150,0.95)";
  ctx.font = "700 26px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(copy.mode, cardX, cardY + 158);

  ctx.fillStyle = copy.mode === "RE-CHECK" ? "rgba(255,221,132,0.98)" : "rgba(255,220,205,0.98)";
  ctx.font = "italic 700 58px Georgia, Times New Roman, serif";
  const heroLines = wrapText(ctx, copy.hero, cardW - 10).slice(0, 2);
  heroLines.forEach((line, i) => ctx.fillText(line, cardX, cardY + 224 + i * 56));

  ctx.fillStyle = "rgba(255,229,220,0.82)";
  ctx.font = "500 24px system-ui, -apple-system, Segoe UI, Roboto";
  const subY = cardY + 278;
  drawParagraph(ctx, copy.subRead, cardX, subY, cardW - 10, 30, 3);

  const normalizedThumbs = Array.isArray(thumbs) ? thumbs.slice(0, 3) : [];
  const images = [];
  for (let i = 0; i < 3; i++) {
    try {
      images.push(normalizedThumbs[i]?.dataUrl ? await loadImage(normalizedThumbs[i].dataUrl) : null);
    } catch {
      images.push(null);
    }
  }

  const imgTop = cardY + 372;
  const imgGap = 12;
  const imgW = Math.floor((cardW - imgGap * 2) / 3);
  const imgH = 250;

  for (let i = 0; i < 3; i++) {
    const x = cardX + i * (imgW + imgGap);
    ctx.save();
    roundRectPath(ctx, x, imgTop, imgW, imgH, 24);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fill();
    ctx.clip();
    if (images[i]) {
      drawCover(ctx, images[i], x, imgTop, imgW, imgH);
    }
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, x, imgTop, imgW, imgH, 24);
    ctx.lineWidth = 3;
    ctx.strokeStyle = i === 1 ? "rgba(255,196,120,0.98)" : "rgba(255,185,130,0.78)";
    ctx.stroke();
    ctx.restore();
  }

  let y = imgTop + imgH + 54;
  const sectionLineX = cardX + 270;
  const bodyX = cardX + 8;
  const bodyW = cardW - 16;

  const drawSectionHeader = (label) => {
    ctx.fillStyle = "rgba(255,214,170,0.97)";
    ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(label, cardX, y);
    const yy = y - 8;
    const sectionRule = ctx.createLinearGradient(sectionLineX, yy, lineEnd, yy);
    sectionRule.addColorStop(0, "rgba(255,186,110,0.22)");
    sectionRule.addColorStop(0.35, "rgba(255,196,116,0.9)");
    sectionRule.addColorStop(1, "rgba(255,186,110,0.05)");
    ctx.fillStyle = sectionRule;
    ctx.fillRect(sectionLineX, yy, cardW - (sectionLineX - cardX) - 18, 2);
    y += 28;
  };

  drawSectionHeader(copy.sectionLabel);
  ctx.fillStyle = "rgba(255,237,228,0.94)";
  ctx.font = "500 23px system-ui, -apple-system, Segoe UI, Roboto";
  y += drawBulletList(ctx, copy.bullets, bodyX, y, bodyW, 30) + 8;

  drawSectionHeader("BREAKDOWN");
  ctx.fillStyle = "rgba(255,236,228,0.9)";
  ctx.font = "500 21px system-ui, -apple-system, Segoe UI, Roboto";
  y += drawParagraph(ctx, copy.breakdown, bodyX, y, bodyW, 27, 8) + 16;

  drawSectionHeader("NEXT UP");
  ctx.fillStyle = "rgba(255,236,228,0.9)";
  ctx.font = "500 21px system-ui, -apple-system, Segoe UI, Roboto";
  y += drawParagraph(ctx, copy.nextUp, bodyX, y, bodyW, 27, 6) + 16;

  drawSectionHeader("COACH NOTE");
  ctx.fillStyle = "rgba(255,236,228,0.92)";
  ctx.font = "500 20px system-ui, -apple-system, Segoe UI, Roboto";
  y += drawParagraph(ctx, copy.coachNote, bodyX, y, bodyW, 26, 6) + 30;

  const btnH = 62;
  const btnY = Math.min(y, outerY + outerH - 156);
  ctx.save();
  roundRectPath(ctx, cardX, btnY, cardW, btnH, 20);
  ctx.fillStyle = "rgba(50,10,10,0.26)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,170,120,0.88)";
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "rgba(255,212,150,0.98)";
  ctx.font = "700 30px system-ui, -apple-system, Segoe UI, Roboto";
  const shareText = "SHARE";
  const shareW = ctx.measureText(shareText).width;
  ctx.fillText(shareText, cardX + (cardW - shareW) / 2, btnY + 40);

  const footerY = outerY + outerH - 52;
  ctx.fillStyle = "rgba(255,224,218,0.92)";
  ctx.font = "700 36px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("SlimCal", cardX + 118, footerY);
  ctx.save();
  ctx.font = "700 24px Georgia, Times New Roman, serif";
  const footSlimW = ctx.measureText("SlimCal").width;
  const footAiX = cardX + 118 + footSlimW + 10;
  roundRectPath(ctx, footAiX, footerY - 28, 66, 32, 8);
  ctx.fillStyle = "rgba(255,206,95,0.2)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,206,95,0.48)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,218,124,0.98)";
  ctx.fillText("AI", footAiX + 18, footerY - 6);
  ctx.restore();

  ctx.fillStyle = "rgba(255,228,180,0.98)";
  ctx.font = "500 24px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(clean(hashtag || "#SlimCalAI"), cardX + 110, footerY + 36);

  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(90,38,52,0.95)";
  ctx.beginPath();
  ctx.moveTo(W / 2 - 110, outerY + outerH - 18);
  ctx.lineTo(W / 2 + 110, outerY + outerH - 18);
  ctx.stroke();
  ctx.restore();

  return c.toDataURL("image/png");
}
