// src/lib/frameCheckSharePng.js
// Zero-dependency PNG generator for Frame Check share assets (9:16 story card).
// Uses Canvas API only. No DOM capture. Safe for Vite builds.

function clamp(n, a, b) {
  const x = Number(n);
  if (Number.isNaN(x)) return a;
  return Math.min(b, Math.max(a, x));
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGlow(ctx, cx, cy, radius, color, alpha = 0.28) {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, `rgba(${color}, ${alpha})`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function pickTierColor(tier) {
  const t = String(tier || "").toUpperCase();
  if (t.includes("ELITE")) return "#22c55e";
  if (t.includes("VILLAIN")) return "#ef4444";
  if (t.includes("LOCKED")) return "#3b82f6";
  if (t.includes("BUILD")) return "#a855f7";
  return "#94a3b8";
}

export async function buildFrameCheckSharePng(data, opts = {}) {
  const W = 1080;
  const H = 1920;

  const dpr = clamp(opts.pixelRatio || 2, 1, 3);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#070f1d");
  bg.addColorStop(0.55, "#071a33");
  bg.addColorStop(1, "#050914");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Glows
  drawGlow(ctx, W * 0.18, H * 0.22, 360, "59,130,246", 0.26); // blue
  drawGlow(ctx, W * 0.82, H * 0.28, 420, "168,85,247", 0.22); // purple
  drawGlow(ctx, W * 0.65, H * 0.72, 520, "34,197,94", 0.16); // green

  const pad = 84;

  // Header
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = "800 64px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("FRAME CHECK", pad, pad + 54);

  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = "500 30px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("powered by SlimCal", pad, pad + 96);

  // Tier pill
  const tier = data?.tier || "BUILD ARC";
  const tierColor = pickTierColor(tier);
  const pillText = tier;
  ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const pillW = Math.max(260, ctx.measureText(pillText).width + 64);
  const pillH = 64;
  const pillX = W - pad - pillW;
  const pillY = pad + 18;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, pillX, pillY, pillW, pillH, 999);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  roundRect(ctx, pillX, pillY, pillW, pillH, 999);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = tierColor;
  ctx.fillText(pillText, pillX + 32, pillY + 44);

  // Main score
  const overall = clamp(data?.overall ?? 0, 0, 100);
  const scoreText = `${Math.round(overall)}/100`;
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.font = "900 150px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(scoreText, pad, pad + 320);

  // Subscores
  const aesthetic = clamp(data?.aesthetic ?? 0, 0, 100);
  const discipline = clamp(data?.discipline ?? 0, 0, 100);

  ctx.font = "700 40px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fillText(`Aesthetic  ${Math.round(aesthetic)}/100`, pad, pad + 390);

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fillText(`Discipline  ${Math.round(discipline)}/100`, pad + 520, pad + 390);

  // Card panel
  const cardX = pad;
  const cardY = pad + 470;
  const cardW = W - pad * 2;
  const cardH = 720;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  roundRect(ctx, cardX, cardY, cardW, cardH, 42);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  roundRect(ctx, cardX, cardY, cardW, cardH, 42);
  ctx.stroke();
  ctx.restore();

  const strength = data?.strength || "Consistency";
  const weakness = data?.weakness || "Training stimulus";
  const projected90 = clamp(data?.projected90 ?? overall, 0, 100);

  // Strength / Weak spot labels
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("Top strength", cardX + 48, cardY + 110);
  ctx.fillText("Weak spot", cardX + 48, cardY + 270);

  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = "900 56px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(String(strength).slice(0, 28), cardX + 48, cardY + 178);
  ctx.fillText(String(weakness).slice(0, 28), cardX + 48, cardY + 338);

  // 90-day projection pill
  const projText = `90d → ${Math.round(projected90)}/100`;
  ctx.font = "800 36px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const projW = ctx.measureText(projText).width + 58;
  const projH = 62;
  const projX = cardX + 48;
  const projY = cardY + 420;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  roundRect(ctx, projX, projY, projW, projH, 999);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  roundRect(ctx, projX, projY, projW, projH, 999);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(projText, projX + 28, projY + 42);

  // Footer caption
  ctx.fillStyle = "rgba(255,255,255,0.52)";
  ctx.font = "600 30px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const footer = data?.isEstimate ? "estimated scan • log more to sharpen" : "daily scan • discipline × physique signals";
  ctx.fillText(footer, cardX + 48, cardY + cardH - 72);

  ctx.fillStyle = "rgba(255,255,255,0.48)";
  ctx.font = "700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("slimcal.ai", cardX + 48, cardY + cardH - 32);

  // Export
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1.0));
  return blob;
}

export async function shareOrDownloadPng(blob, fileName = "slimcal-frame-check.png", text = "") {
  if (!blob) return;

  const file = new File([blob], fileName, { type: "image/png" });

  // Native share sheet (best on mobile)
  try {
    if (navigator?.canShare?.({ files: [file] }) && navigator?.share) {
      await navigator.share({ files: [file], text });
      return;
    }
  } catch {
    // fall back to download
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}
