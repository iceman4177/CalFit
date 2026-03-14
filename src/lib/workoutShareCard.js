function clean(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
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

function wrapLines(ctx, text, maxWidth, maxLines = 3) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = '';

  const pushCurrent = () => {
    if (current) {
      lines.push(current);
      current = '';
    }
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const test = current ? `${current} ${word}` : word;

    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
      continue;
    }

    if (!current) {
      current = word;
      pushCurrent();
      continue;
    }

    if (lines.length === maxLines - 1) {
      const tailWords = [current, ...words.slice(i)].join(' ').trim();
      let tail = tailWords;
      while (tail.length > 3 && ctx.measureText(`${tail}…`).width > maxWidth) {
        tail = tail.slice(0, -1).trim();
      }
      lines.push(`${tail}${tail !== tailWords ? '…' : ''}`);
      return lines;
    }

    pushCurrent();
    current = word;
  }

  pushCurrent();
  return lines.slice(0, maxLines);
}

function ellipsize(ctx, text, maxWidth) {
  const src = clean(text);
  if (!src) return '';
  if (ctx.measureText(src).width <= maxWidth) return src;
  let out = src;
  while (out.length > 3 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1).trim();
  }
  return `${out}…`;
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
  const visibleCount = 5;
  const visible = safe.slice(0, visibleCount).map(formatExerciseLine);
  if (safe.length > visibleCount) visible.push(`+${safe.length - visibleCount} more ${safe.length - visibleCount === 1 ? 'exercise' : 'exercises'}`);
  return visible;
}

function buildCardSummary({ totalCalories = 0, exerciseCount = 0, startedAt = '' }) {
  const cal = Math.round(Number(totalCalories) || 0);
  const count = Math.max(0, Number(exerciseCount) || 0);
  if (cal > 0 && count > 0) {
    return `Crushed ${count} ${count === 1 ? 'exercise' : 'exercises'} and burned ${cal} cal.`;
  }
  if (count > 0) {
    return `Logged ${count} ${count === 1 ? 'exercise' : 'exercises'} with SlimCal AI.`;
  }
  if (startedAt) {
    return `Session logged ${startedAt}.`;
  }
  return 'Workout logged with SlimCal AI.';
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
  gradient.addColorStop(0, '#edf4ff');
  gradient.addColorStop(0.45, '#f8fbff');
  gradient.addColorStop(1, '#eef2ff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  roundRect(ctx, 42, 42, width - 84, height - 84, 42);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(37, 99, 235, 0.12)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 16;
  ctx.fill();
  ctx.restore();

  const cardX = 82;
  const cardW = width - (cardX * 2);
  let y = 122;

  ctx.fillStyle = '#2563eb';
  ctx.font = '900 42px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('SlimCal AI', cardX, y);

  y += 56;
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 70px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Workout Complete', cardX, y);

  y += 46;
  ctx.fillStyle = '#64748b';
  ctx.font = '600 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText(startedAt ? `Logged ${startedAt}` : 'Logged with SlimCal', cardX, y);

  y += 60;
  roundRect(ctx, cardX, y, 258, 82, 41);
  ctx.fillStyle = '#dbeafe';
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 40px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText(`${Math.round(Number(totalCalories) || 0)} cal`, cardX + 28, y + 54);

  const exerciseCount = Array.isArray(exercises) ? exercises.length : 0;
  if (exerciseCount > 0) {
    roundRect(ctx, cardX + 278, y, 300, 82, 41);
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.12)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(`${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'}`, cardX + 308, y + 52);
  }

  y += 138;
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 34px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Session breakdown', cardX, y);

  y += 26;
  const list = buildExerciseLines(exercises);
  const fallback = String(shareText || '')
    .split('\n')
    .map((line) => line.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 4);
  const lines = (list.length ? list : fallback).slice(0, 5);

  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  for (const line of lines) {
    const wrapped = wrapLines(ctx, line, cardW - 84, 2);
    const isMulti = wrapped.length > 1;
    const rowH = isMulti ? 96 : 72;
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
    if (isMulti) {
      const top = y + 36;
      wrapped.forEach((row, idx) => {
        const text = idx === wrapped.length - 1 ? ellipsize(ctx, row, cardW - 84) : row;
        ctx.fillText(text, cardX + 52, top + (idx * 30));
      });
    } else {
      ctx.fillText(ellipsize(ctx, wrapped[0] || line, cardW - 84), cardX + 52, y + 45);
    }

    y += rowH;
  }

  y += 46;
  const noteH = 142;
  roundRect(ctx, cardX, y, cardW, noteH, 30);
  ctx.fillStyle = 'rgba(37, 99, 235, 0.06)';
  ctx.fill();

  ctx.fillStyle = '#2563eb';
  ctx.font = '900 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Share note', cardX + 28, y + 42);

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 30px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  const summary = buildCardSummary({ totalCalories, exerciseCount, startedAt });
  const summaryLines = wrapLines(ctx, summary, cardW - 56, 2);
  summaryLines.forEach((line, idx) => {
    ctx.fillText(line, cardX + 28, y + 88 + (idx * 34));
  });

  ctx.fillStyle = '#64748b';
  ctx.font = '700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('#SlimcalAI', cardX, height - 112);

  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));
}
