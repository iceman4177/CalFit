function clean(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function wrapLines(ctx, text, maxWidth, maxLines = 6) {
  const words = clean(text).split(' ').filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    lines.push(current);
    current = word;

    if (lines.length >= maxLines - 1) break;
  }

  const consumed = lines.join(' ');
  const consumedCount = consumed ? consumed.split(' ').filter(Boolean).length : 0;
  const remaining = words.slice(consumedCount);
  let tail = current || '';
  if (remaining.length > 1) {
    tail = [tail, ...remaining.slice(1)].filter(Boolean).join(' ');
  }

  if (tail && lines.length < maxLines) {
    let clipped = tail;
    let wasClipped = false;
    while (clipped.length > 4 && ctx.measureText(clipped).width > maxWidth) {
      clipped = clipped.slice(0, -1).trim();
      wasClipped = true;
    }
    lines.push(wasClipped ? `${clipped}…` : clipped);
  }

  return lines.slice(0, maxLines).filter(Boolean);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
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

function formatExerciseLine(ex = {}) {
  const name = clean(ex?.exerciseName || ex?.name || 'Exercise');
  const sets = Number(ex?.sets) || 0;
  const reps = ex?.reps != null && String(ex.reps).trim() !== '' ? String(ex.reps).trim() : '';
  const calories = Number(ex?.calories) || 0;
  const isSauna = (ex?.exerciseType === 'Sauna') || /sauna/i.test(name);

  if (isSauna) return `Sauna session${calories > 0 ? ` · ${Math.round(calories)} cal` : ''}`;

  let detail = '';
  if (sets && reps) detail = `${sets}x${reps}`;
  else if (sets) detail = `${sets} sets`;
  else if (reps) detail = `${reps} reps`;

  return `${name}${detail ? ` · ${detail}` : ''}${calories > 0 ? ` (${Math.round(calories)} cal)` : ''}`;
}

function buildExerciseLines(exercises = []) {
  const safe = Array.isArray(exercises) ? exercises : [];
  const visible = safe.slice(0, 4).map(formatExerciseLine);
  if (safe.length > 4) {
    visible.push(`+${safe.length - 4} more ${safe.length - 4 === 1 ? 'move' : 'moves'}`);
  }
  return visible;
}

export async function makeWorkoutShareCardBlob({ exercises = [], totalCalories = 0, shareText = '', startedAt = '' } = {}) {
  const canvas = document.createElement('canvas');
  const width = 1080;
  const height = 1350;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#eff6ff');
  gradient.addColorStop(0.52, '#f8fafc');
  gradient.addColorStop(1, '#eef2ff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  roundRect(ctx, 50, 50, width - 100, height - 100, 44);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(37, 99, 235, 0.14)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  ctx.fill();
  ctx.restore();

  const cardX = 82;
  const cardW = width - (cardX * 2);
  let y = 118;

  ctx.fillStyle = '#2563eb';
  ctx.font = '900 42px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('SlimCal AI', cardX, y);

  y += 56;
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 70px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Workout Complete', cardX, y);

  y += 48;
  ctx.fillStyle = '#64748b';
  ctx.font = '600 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  const subtitle = startedAt ? `Logged ${startedAt}` : 'Logged with SlimCal';
  ctx.fillText(subtitle, cardX, y);

  y += 64;
  roundRect(ctx, cardX, y, 265, 86, 43);
  ctx.fillStyle = '#dbeafe';
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 40px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText(`${Math.round(Number(totalCalories) || 0)} cal`, cardX + 30, y + 56);

  if (Array.isArray(exercises) && exercises.length) {
    const countLabel = `${exercises.length} ${exercises.length === 1 ? 'exercise' : 'exercises'}`;
    roundRect(ctx, cardX + 285, y, 290, 86, 43);
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.12)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(countLabel, cardX + 314, y + 54);
  }

  y += 136;
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Session breakdown', cardX, y);

  y += 26;
  const exerciseLines = buildExerciseLines(exercises);
  const fallbackLines = String(shareText || '')
    .split('\n')
    .map((line) => line.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 4);
  const lines = (exerciseLines.length ? exerciseLines : fallbackLines).slice(0, 5);

  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  for (const line of lines) {
    const wrapped = wrapLines(ctx, line, cardW - 82, 2);
    const lineCount = Math.max(1, wrapped.length);
    const rowH = lineCount === 1 ? 72 : 100;
    y += 16;
    roundRect(ctx, cardX, y, cardW, rowH, 24);
    ctx.fillStyle = '#f8fbff';
    ctx.strokeStyle = 'rgba(157, 183, 255, 0.28)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(cardX + 28, y + (rowH / 2), 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    wrapped.forEach((wrappedLine, idx) => {
      ctx.fillText(wrappedLine, cardX + 52, y + 41 + (idx * 30));
    });

    y += rowH;
  }

  y += 44;
  const captionBoxH = 170;
  roundRect(ctx, cardX, y, cardW, captionBoxH, 32);
  ctx.fillStyle = 'rgba(37, 99, 235, 0.06)';
  ctx.fill();

  ctx.fillStyle = '#2563eb';
  ctx.font = '900 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Post caption', cardX + 28, y + 42);

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  const captionPreview = wrapLines(
    ctx,
    clean(shareText) || 'Just crushed another workout with SlimCal AI. #SlimcalAI',
    cardW - 56,
    3,
  );
  captionPreview.forEach((line, idx) => {
    ctx.fillText(line, cardX + 28, y + 88 + (idx * 34));
  });

  ctx.fillStyle = '#64748b';
  ctx.font = '700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('#SlimcalAI', cardX, height - 112);
  ctx.fillText('Built to share', width - 270, height - 112);

  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));
}
