// src/lib/frameCheck.js
// Frame Check: viral, detailed daily "scan" report built from SlimCal data.
// Pure helpers only — no persistence/sync changes.

function clamp(n, a, b) {
  const x = Number(n);
  if (Number.isNaN(x)) return a;
  return Math.min(b, Math.max(a, x));
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(n, d) {
  const nn = safeNum(n);
  const dd = safeNum(d);
  if (dd <= 0) return 0;
  return clamp((nn / dd) * 100, 0, 200);
}

export function computeFrameCheckScores(ctx) {
  const consumed = safeNum(ctx?.totals?.consumed);
  const burned = safeNum(ctx?.totals?.burned);
  const net = consumed - burned;

  const calorieTarget = safeNum(ctx?.targets?.calorieTarget);
  const proteinTarget = safeNum(ctx?.targets?.proteinTarget);
  const macros = ctx?.totals?.macros || {};
  const protein = safeNum(macros?.protein_g);

  const hasMeals = !!ctx?.derived?.hasMeals;
  const hasWorkout = !!ctx?.derived?.hasWorkout;

  const checklist = ctx?.checklist || {};
  const checklistPct = clamp(safeNum(checklist?.pct), 0, 100);

  // Confidence: how much signal we actually have today (so we don't "punish" missing data).
  const signals = [
    hasMeals ? 1 : 0,
    hasWorkout ? 1 : 0,
    checklistPct >= 10 ? 1 : 0,
    protein >= 10 ? 1 : 0,
    calorieTarget > 0 ? 1 : 0,
    proteinTarget > 0 ? 1 : 0,
    safeNum(ctx?.profile?.height_in) > 0 || safeNum(ctx?.profile?.height_cm) > 0 ? 1 : 0,
    safeNum(ctx?.profile?.weight_lb) > 0 || safeNum(ctx?.profile?.weight_kg) > 0 ? 1 : 0,
  ];
  const confidence = clamp(signals.reduce((a, b) => a + b, 0) / signals.length, 0, 1);

  const calErr = calorieTarget > 0 ? Math.abs(net - calorieTarget) : Math.abs(net);
  const calTight =
    calorieTarget > 0
      ? clamp(100 - (calErr / Math.max(150, calorieTarget * 0.3)) * 100, 0, 100)
      : 55; // neutral if no target

  const proteinPct =
    proteinTarget > 0
      ? clamp((protein / proteinTarget) * 100, 0, 130)
      : protein >= 120
        ? 100
        : clamp((protein / 120) * 100, 0, 100);

  const trainingScore = hasWorkout ? clamp((burned / 450) * 100, 0, 100) : 0;

  // Aesthetic = proxy for "body composition + muscle-building behavior signals"
  const aestheticRaw = clamp(
    0.35 * proteinPct +
      0.25 * trainingScore +
      0.20 * calTight +
      0.20 * checklistPct,
    0,
    100
  );

  // Discipline = consistency + logging + adherence
  const disciplineRaw = clamp(
    (hasMeals ? 18 : 0) +
      (hasWorkout ? 18 : 0) +
      0.32 * calTight +
      0.32 * checklistPct,
    0,
    100
  );

  const overallRaw = clamp(0.55 * disciplineRaw + 0.45 * aestheticRaw, 0, 100);

  // Calibration: keep it motivating & shareable.
  // - Never humiliate users for missing data (mark as "estimate" instead).
  // - Still allow high scores when signals are strong.
  const floor = confidence < 0.35 ? 45 : 35;
  const ceil = 97;

  const aesthetic = clamp(aestheticRaw + (1 - confidence) * 6, 0, 100);
  const discipline = clamp(disciplineRaw + (1 - confidence) * 6, 0, 100);

  const overall = clamp(overallRaw + (1 - confidence) * 8, floor, ceil);

  let tier = "REBUILD ARC";
  if (overall >= 88) tier = "ELITE ARC";
  else if (overall >= 78) tier = "VILLAIN ARC";
  else if (overall >= 64) tier = "LOCKED IN";
  else if (overall >= 52) tier = "BUILD ARC";

  const isEstimate = confidence < 0.55;

  // Strength / Weak spot: behavioral + actionable
  let strength = "Consistency";
  if (trainingScore >= 70) strength = "Training output";
  else if (proteinPct >= 95) strength = "Protein discipline";
  else if (calTight >= 80) strength = "Calorie control";
  else if (checklistPct >= 75) strength = "Daily structure";

  let weakness = "Training stimulus";
  if (!hasMeals) weakness = "Meal logging";
  else if (!hasWorkout) weakness = "Training stimulus";
  else if (proteinPct < 70) weakness = "Protein";
  else if (calTight < 65) weakness = "Calorie tightness";
  else if (checklistPct < 60) weakness = "Follow-through";

  // 90-day projection: never shame; small trend based on discipline momentum.
  const deltaPerMonth = clamp((discipline - 58) / 12, -1.2, 3.0); // -1.2..+3.0 / month
  const projected90 = clamp(overall + deltaPerMonth * 3, floor, 99);

  return {
    overall: Math.round(overall),
    discipline: Math.round(discipline),
    aesthetic: Math.round(aesthetic),
    tier,
    strength,
    weakness,
    projected90: Math.round(projected90),
    confidence: Math.round(confidence * 100),
    isEstimate,
  };
}

export function buildFrameCheckPrompt(ctx) {
  const totals = ctx?.totals || {};
  const macros = totals?.macros || {};
  const targets = ctx?.targets || {};
  const profile = ctx?.profile || {};
  const checklist = ctx?.checklist || {};
  const scores = computeFrameCheckScores(ctx);

  const lines = [];

  lines.push("You are SlimCal Frame Check — a cinematic but grounded daily body & discipline scan. 80% serious, 20% meme spice. Never be cruel.");
  lines.push("");
  lines.push("Return JSON with keys: headline, summary, breakdown, next_moves, share_card, projection_90d.");
  lines.push("Constraints:");
  lines.push("- Be specific. Use the user's numbers. Reference what they did today.");
  lines.push("- Give 3-6 bullet 'next_moves' that are immediate and time-window aware.");
  lines.push("- 'breakdown' should include: physique signals, discipline overlay, nutrition, training, checklist.");
  lines.push("- 'share_card' is a short punchy 3-6 lines that looks good in a screenshot.");
  lines.push("");

  lines.push("=== TODAY INPUTS ===");
  lines.push(`Local day: ${String(ctx?.dayISO || "")}`);
  lines.push(`Calories consumed: ${Math.round(safeNum(totals?.consumed))}`);
  lines.push(`Calories burned: ${Math.round(safeNum(totals?.burned))}`);
  lines.push(`Net calories: ${Math.round(safeNum(totals?.netKcal ?? (safeNum(totals?.consumed) - safeNum(totals?.burned))))}`);
  lines.push(`Protein: ${Math.round(safeNum(macros?.protein_g))} g`);
  lines.push(`Carbs: ${Math.round(safeNum(macros?.carbs_g))} g`);
  lines.push(`Fat: ${Math.round(safeNum(macros?.fat_g))} g`);
  lines.push(`Meals logged: ${safeNum(totals?.mealsCount)}`);
  lines.push(`Workout logged: ${ctx?.derived?.hasWorkout ? "yes" : "no"}`);

  lines.push("");
  lines.push("=== TARGETS / PROFILE ===");
  lines.push(`Calorie target: ${targets?.calorieTarget ? Math.round(safeNum(targets?.calorieTarget)) : "unknown"}`);
  lines.push(`Protein target: ${targets?.proteinTarget ? Math.round(safeNum(targets?.proteinTarget)) : "unknown"}`);
  lines.push(`Goal type: ${profile?.goalType || profile?.fitness_goal || "unknown"}`);
  lines.push(`Diet preference: ${profile?.dietPreference || profile?.diet_preference || "unknown"}`);
  lines.push(`Training intent: ${profile?.trainingIntent || profile?.training_intent || "unknown"}`);
  lines.push(`Training split: ${profile?.trainingSplit || profile?.training_split || "unknown"}`);
  lines.push(`BMR est: ${profile?.bmr_est || "unknown"}`);
  lines.push(`TDEE est: ${profile?.tdee_est || "unknown"}`);

  lines.push("");
  lines.push("=== CHECKLIST ===");
  lines.push(`Checklist completion: ${Math.round(safeNum(checklist?.pct))}% (${safeNum(checklist?.doneCount)}/${safeNum(checklist?.totalCount)})`);
  if (Array.isArray(checklist?.nextUp) && checklist.nextUp.length) {
    lines.push("Next-up items:");
    checklist.nextUp.slice(0, 6).forEach((t) => lines.push(`- ${t}`));
  }

  lines.push("");
  lines.push("=== INTERNAL SCORES (for grounding) ===");
  lines.push(`Overall: ${scores.overall}/100`);
  lines.push(`Discipline: ${scores.discipline}/100`);
  lines.push(`Aesthetic: ${scores.aesthetic}/100`);
  lines.push(`Tier: ${scores.tier}`);
  lines.push(`Top strength: ${scores.strength}`);
  lines.push(`Weak spot: ${scores.weakness}`);
  lines.push(`Projected 90d: ${scores.projected90}/100`);

  return lines.join("\n");
}

export function buildLocalFrameReport(ctx) {
  const s = computeFrameCheckScores(ctx);
  const checklistPct = Math.round(safeNum(ctx?.checklist?.pct));
  const hasMeals = !!ctx?.derived?.hasMeals;
  const hasWorkout = !!ctx?.derived?.hasWorkout;

  const headline = `${s.tier} • ${s.overall}/100`;
  const summary = [
    `Aesthetic: ${s.aesthetic}/100 • Discipline: ${s.discipline}/100`,
    `Strength: ${s.strength} • Weak spot: ${s.weakness}`,
    `Checklist: ${checklistPct}% • Meals: ${hasMeals ? "✅" : "—"} • Workout: ${hasWorkout ? "✅" : "—"}`,
  ].join("\n");

  const breakdown = [
    `Nutrition: protein + calorie control are your biggest levers today.`,
    `Training: ${hasWorkout ? "you logged training — keep intensity honest." : "no workout logged yet — even 20–35 min moves the needle."}`,
    `Structure: checklist completion correlates with consistency and results.`,
  ];

  const next_moves = [];
  if (!hasMeals) next_moves.push("Log your first meal (even a rough estimate).");
  if (!hasWorkout) next_moves.push("Do a 25–45 min session: push/pull/legs or a hard incline walk.");
  if (s.weakness.toLowerCase().includes("protein")) next_moves.push("Add a protein hit (25–45g) in the next meal.");
  if (s.weakness.toLowerCase().includes("calorie")) next_moves.push("Keep net calories closer to target: tighten portions or add 15–20 min burn.");
  if (checklistPct < 70) next_moves.push("Clear the next 2 checklist items in your current time window.");

  const projection_90d = `If you keep today's discipline trend, you're trending toward ~${s.projected90}/100 in ~90 days.`;

  const share_card = [
    "FRAME CHECK",
    `${s.tier} • ${s.overall}/100`,
    `Strength: ${s.strength}`,
    `Weak: ${s.weakness}`,
    `90d: ~${s.projected90}/100`,
    "powered by SlimCal",
  ].join("\n");

  return { headline, summary, breakdown, next_moves, share_card, projection_90d, scores: s };
}
