// src/lib/poseSessionSharePng.js
// Builds a social-share-ready PNG (Instagram feed friendly 4:5).
// Returns a Blob (image/png) so iOS share sheets recognize it as an image.

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 6) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = words[i];
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  // Ellipsis if overflow
  const didTruncate = (words.join(" ").length > lines.join(" ").length + 3);
  if (didTruncate && lines.length) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(last + "…").width > maxWidth && last.length > 0) last = last.slice(0, -1);
    lines[lines.length - 1] = (last || "").trim() + "…";
  }
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineHeight);
  }
  return lines.length;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = clamp(r, 0, Math.min(w, h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function loadToBitmap(src) {
  if (!src) return null;
  // src can be a Blob, File, or dataURL/http url string
  if (src instanceof Blob) {
    return await createImageBitmap(src);
  }
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  const p = new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = reject;
  });
  img.src = url;
  const loaded = await p;
  try {
    return await createImageBitmap(loaded);
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

function pickSummary(analysis) {
  if (!analysis) return "";
  // Prefer explicit share summary
  if (analysis.share_summary) return String(analysis.share_summary);
  // Fall back to first paragraph / first sentence of report
  const report = String(analysis.report || "").trim();
  if (!report) return "";
  const firstPara = report.split(/\n\s*\n/)[0] || report;
  const firstSentence = firstPara.split(/(?<=[.!?])\s+/)[0] || firstPara;
  return firstSentence.trim();
}

export async function buildPoseSessionSharePng({
  poseImages = [], // array of 3 (dataURL / Blob / File)
  analysis = null,
  title = "Physique Breakdown",
  subtitle = "Scan results",
  hashtag = "#slimcalAI",
} = {}) {
  // Instagram feed friendly: 1080x1350 (4:5)
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0b0c10");
  g.addColorStop(1, "#121422");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "700 54px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("Slimcal AI", 72, 110);

  ctx.fillStyle = "rgba(255,255,255,0.80)";
  ctx.font = "600 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(title, 72, 160);

  ctx.fillStyle = "rgba(255,255,255,0.60)";
  ctx.font = "500 24px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(subtitle, 72, 200);

  // Image row (3)
  const pad = 72;
  const gap = 22;
  const rowTop = 250;
  const rowH = 520;
  const cellW = Math.floor((W - pad * 2 - gap * 2) / 3);
  const r = 26;

  const bitmaps = await Promise.all(poseImages.slice(0, 3).map(loadToBitmap));
  for (let i = 0; i < 3; i++) {
    const x = pad + i * (cellW + gap);
    const y = rowTop;
    // Card
    ctx.save();
    roundRect(ctx, x, y, cellW, rowH, r);
    ctx.clip();
    // soft bg in case image missing
    const gg = ctx.createLinearGradient(x, y, x, y + rowH);
    gg.addColorStop(0, "rgba(255,255,255,0.10)");
    gg.addColorStop(1, "rgba(255,255,255,0.04)");
    ctx.fillStyle = gg;
    ctx.fillRect(x, y, cellW, rowH);

    const bm = bitmaps[i];
    if (bm) {
      // cover-fit
      const scale = Math.max(cellW / bm.width, rowH / bm.height);
      const dw = bm.width * scale;
      const dh = bm.height * scale;
      const dx = x + (cellW - dw) / 2;
      const dy = y + (rowH - dh) / 2;
      ctx.drawImage(bm, dx, dy, dw, dh);
    }

    // subtle vignette
    const vg = ctx.createLinearGradient(x, y, x, y + rowH);
    vg.addColorStop(0, "rgba(0,0,0,0.05)");
    vg.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, cellW, rowH);

    ctx.restore();
  }

  // Divider line
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(pad, rowTop + rowH + 40, W - pad * 2, 2);

  // Summary block
  const summary = pickSummary(analysis);
  const sumTop = rowTop + rowH + 90;

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "700 30px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("Quick read", pad, sumTop);

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "500 28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const linesUsed = wrapText(ctx, summary || "Strong base with visible athletic shape — keep building momentum.", pad, sumTop + 50, W - pad * 2, 40, 5);

  // Hashtag + footer
  const footerY = H - 110;
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(hashtag, pad, footerY);

  ctx.fillStyle = "rgba(255,255,255,0.50)";
  ctx.font = "500 22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("Generate your own at slimcal.ai", pad, footerY + 42);

  // Export
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
  if (!blob) throw new Error("Failed to build PNG");
  return blob;
}
