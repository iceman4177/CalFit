// src/lib/dailyChecklist.js
// Shared, canonical micro-quest spine used by DailyEvaluationHome (Card 2) and DailyRecapCoach.
// Goal: keep checklist logic consistent across UI + coaching tone without touching persistence/sync.

export function getHourInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const h = parts.find((p) => p.type === "hour")?.value;
    const n = Number(h);
    return Number.isFinite(n) ? n : null;
  } catch {
    return date?.getHours?.() ?? null;
  }
}

// ---- Robust meal helpers (local + cloud shapes) ----
function getMealText(m) {
  try {
    if (!m) return "";
    return String(m?.name ?? m?.title ?? m?.food_name ?? m?.label ?? "");
  } catch {
    return "";
  }
}

function getMealTsMs(m) {
  try {
    if (!m) return NaN;
    const raw =
      m?.eaten_at ?? m?.eatenAt ?? m?.createdAt ?? m?.created_at ?? m?.timestamp ?? m?.time ?? null;
    if (raw == null) return NaN;
    // number => assume ms if large, else seconds
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) return NaN;
      return raw > 2_000_000_000 ? raw : raw * 1000;
    }
    // string/date
    const d = raw instanceof Date ? raw : new Date(String(raw));
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : NaN;
  } catch {
    return NaN;
  }
}


// ---- Meal event grouping + time-window inference (PST) ----
function isBreakfastLikeText(t) {
  if (!t) return false;
  const s = String(t).toLowerCase();
  // lightweight keywords; time-of-day still dominates
  return /(egg|eggs|oat|oats|oatmeal|cereal|yogurt|toast|bagel|pancake|waffle|bacon|sausage|coffee|banana|berries|granola|protein shake|shake)/.test(s);
}

function groupMealsIntoEventsPST(mealsArr) {
  const MIN_GAP_MS = 45 * 60 * 1000; // 45 minutes = one "meal event"
  const rows = (Array.isArray(mealsArr) ? mealsArr : [])
    .map((m) => ({ ms: getMealTsMs(m), text: getMealText(m) }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms);

  const events = [];
  for (const r of rows) {
    const last = events[events.length - 1];
    if (last && r.ms - last.ms <= MIN_GAP_MS) {
      last.texts.push(r.text);
      last.msEnd = r.ms;
    } else {
      events.push({ msStart: r.ms, msEnd: r.ms, texts: [r.text] });
    }
  }

  return events.map((e) => {
    const hourPST = getHourInTimeZone(new Date(e.msStart), "America/Los_Angeles");
    return {
      hourPST: Number.isFinite(hourPST) ? hourPST : null,
      text: e.texts.filter(Boolean).join(" "),
      msStart: e.msStart,
      msEnd: e.msEnd,
    };
  });
}

function bucketMealWindowPST(hour) {
  if (hour == null) return null;
  // breakfast: 4-10, lunch: 11-15, dinner: 16-21, late: 22-3
  if (hour >= 4 && hour <= 10) return "breakfast";
  if (hour >= 11 && hour <= 15) return "lunch";
  if (hour >= 16 && hour <= 21) return "dinner";
  return "late";
}

function getMealStep({ nowHourPST, mealBuckets }) {
  const hasBreakfast = !!mealBuckets?.breakfast;
  const hasLunch = !!mealBuckets?.lunch;
  const hasDinner = !!mealBuckets?.dinner;

  // If we can infer meal timing, prefer accuracy over simple counts.
  if (!hasBreakfast && nowHourPST < 11) return { step: "breakfast", title: "Log breakfast" };
  if (!hasBreakfast) return { step: "first", title: "Log your first meal" };

  if (!hasLunch && nowHourPST < 16) return { step: "lunch", title: "Log lunch" };
  if (!hasLunch) return { step: "next", title: "Log your next meal" };

  if (!hasDinner && nowHourPST >= 16) return { step: "dinner", title: "Log dinner" };
  if (!hasDinner) return { step: "next", title: "Log your next meal" };

  return { step: "snack", title: "Log a snack (optional)" };
}



export function inferMealBucketsPST(mealsArr, now = new Date()) {
  const arr = Array.isArray(mealsArr) ? mealsArr : [];
  const mealEvents = groupMealsIntoEventsPST(arr);
  const mealHoursPST = mealEvents.map((e) => e.hourPST).filter((h) => typeof h === "number");

  const bucketCounts = mealHoursPST.reduce(
    (acc, h) => {
      const b = bucketMealWindowPST(h);
      if (b) acc[b] = (acc[b] || 0) + 1;
      return acc;
    },
    { breakfast: 0, lunch: 0, dinner: 0, late: 0 }
  );

  const nowHourPST = getHourInTimeZone(now, "America/Los_Angeles");

  // UX rule: If it's past breakfast time (>= 12pm) and the user logged *a* meal but none were in the breakfast window,
  // treat their first logged meal as "breakfast" so the checklist stays intuitive.
  if (nowHourPST != null && nowHourPST >= 12 && nowHourPST < 16 && bucketCounts.breakfast === 0 && mealEvents.length > 0) {
    const firstEvt = mealEvents[0];
    const firstHour = Number(firstEvt?.hourPST);
    const firstLooksBreakfast = isBreakfastLikeText(firstEvt?.text);
    // Only apply when it's plausibly breakfast/early-day.
    if (firstLooksBreakfast || (Number.isFinite(firstHour) && firstHour <= 15)) {
      if (bucketCounts.lunch > 0) bucketCounts.lunch -= 1;
      else if (bucketCounts.dinner > 0) bucketCounts.dinner -= 1;
      else if (bucketCounts.late > 0) bucketCounts.late -= 1;
      bucketCounts.breakfast = 1;
    }
  }

  const mealBuckets = {
    breakfast: bucketCounts.breakfast > 0,
    lunch: bucketCounts.lunch > 0,
    dinner: bucketCounts.dinner > 0,
    late: bucketCounts.late > 0,
  };

  return {
    nowHourPST,
    mealEvents,
    mealHoursPST,
    bucketCounts,
    mealBuckets,
  };
}

// ---- Canonical checklist items (micro-quests) ----
function buildChecklist({
  goalType,
  profileComplete,
  mealsCount,
  mealBuckets,
  nowHourPST,
  hasWorkout,
  proteinG,
  carbsG,
  fatG,
  proteinTarget,
  carbsTarget,
  fatTarget,
  dayHydrationDone,
}) {
  const g = normalizeGoalType(goalType);
  const hour = Number.isFinite(nowHourPST) ? nowHourPST : getHourInTimeZone(new Date(), "America/Los_Angeles");


  const items = [];
  const push = (it) => items.push(it);

  // Morning
  push({
    key: "setup",
    window: "morning",
    title: "Set targets (30 sec)",
    subtitle: "Rings + coach stay accurate",
    done: !!profileComplete,
    action: "/workout",
    priority: 0,
    hiddenWhenDone: true,
    manual: false,
  });

  // Manual hydration checkbox (morning routine)
  push({
    key: "rehydrate",
    window: "morning",
    title: "Hydrate",
    subtitle: hour < 12 ? "Water + electrolytes" : "Water (quick reset)",
    done: !!dayHydrationDone,
    action: null,
    priority: 1,
    hiddenWhenDone: false,
    manual: true,
  });

  // Meals as chronological checkpoints (time-aware in Pacific time)
  const hasB = mealBuckets?.breakfast === true;
  const hasL = mealBuckets?.lunch === true;
  const hasD = mealBuckets?.dinner === true;

  push({
    key: "meal_morning",
    window: "morning",
    title: "Log breakfast (2 min)",
    subtitle: goalType === "bulk" ? "Protein + carbs (yogurt + oats)" : "Protein-first (25–35g)",
    done: hasB || ((Number(mealsCount) || 0) >= 1 && hour <= 10),
    action: "/meals",
    priority: 2,
    hiddenWhenDone: false,
    manual: false,
  });

  push({
    key: "meal_afternoon",
    window: "afternoon",
    title: "Log lunch (2 min)",
    subtitle: goalType === "bulk" ? "Protein + carbs (chicken + rice)" : "Protein + fiber (chicken + salad)",
    done: hasL || ((Number(mealsCount) || 0) >= 2 && hour >= 11 && hour <= 15),
    action: "/meals",
    priority: 3,
    hiddenWhenDone: false,
    manual: false,
  });

  push({
    key: "meal_night",
    window: "night",
    title: "Log dinner",
    subtitle: "Close the day (protein-focused)",
    done: hasD || ((Number(mealsCount) || 0) >= 3 && hour >= 16),
    action: "/meals",
    priority: 4,
    hiddenWhenDone: false,
    manual: false,
  });
// Protein checkpoint (afternoon) + finish target (night)
  const pT = Number(proteinTarget) || 0;
  const pNow = Number(proteinG) || 0;
  if (pT > 0) {
    const half = Math.round(pT * 0.5);
    const needHalf = Math.max(0, half - pNow);
    push({
      key: "protein_half",
      window: "afternoon",
      title: pNow >= half ? "Protein checkpoint" : "Hit protein checkpoint",
      subtitle: pNow >= half ? "Nice — keep going" : `Get to ~${half}g (add ~${Math.round(Math.min(45, needHalf))}g)`,
      done: pNow >= half,
      action: "/meals",
      priority: 5,
      hiddenWhenDone: false,
      manual: false,
    });

    const pGap = Math.max(0, pT - pNow);
    push({
      key: "protein_full",
      window: "night",
      title: pGap > 0 ? "Hit protein target" : "Protein target hit",
      subtitle: pGap > 0 ? `Add ~${Math.round(Math.min(60, pGap))}g protein` : "Done ✅",
      done: pGap <= 0,
      action: "/meals",
      priority: 6,
      hiddenWhenDone: false,
      manual: false,
    });
  }

  // Goal-aware fuel / movement steps
  if (g === "bulk") {
    const cT = Number(carbsTarget) || 0;
    const cNow = Number(carbsG) || 0;
    if (cT > 0) {
      const cGap = Math.max(0, cT - cNow);
      push({
        key: "fuel",
        window: "night",
        title: cGap > 0 ? "Fuel training (carbs)" : "Carbs on track",
        subtitle: cGap > 0 ? `Add ~${Math.round(Math.min(110, cGap))}g carbs` : "Nice",
        done: cGap <= 0,
        action: "/meals",
        priority: 7,
        hiddenWhenDone: false,
        manual: false,
      });
    }
  } else if (g === "cut") {
    push({
      key: "walk",
      window: "afternoon",
      title: "10‑min walk",
      subtitle: "Easy deficit win",
      done: !!hasWorkout,
      action: "/workout",
      priority: 7,
      hiddenWhenDone: false,
      manual: false,
    });
  } else {
    push({
      key: "move",
      window: "afternoon",
      title: "Move 10 minutes",
      subtitle: "Keeps your day clean",
      done: !!hasWorkout,
      action: "/workout",
      priority: 7,
      hiddenWhenDone: false,
      manual: false,
    });
  }

  // Workout (best in afternoon/evening)
  push({
    key: "workout",
    window: hour < 15 ? "afternoon" : "night",
    title: hasWorkout ? "Workout logged" : "Log workout (2 min)",
    subtitle: hasWorkout ? "Exercise counted ✅" : "Even 1 exercise — log it",
    done: !!hasWorkout,
    action: "/workout",
    priority: 8,
    hiddenWhenDone: false,
    manual: false,
  });

  return items
    .filter((it) => !(it.hiddenWhenDone && it.done))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 18);
}


// ----------------------------- main ------------------------------------------


export function buildDailyChecklistItems({
  goalType,
  profileComplete,
  meals = [],
  mealsCount,
  now = new Date(),
  hasWorkout,
  proteinG,
  carbsG,
  fatG,
  proteinTarget,
  carbsTarget,
  fatTarget,
  dayHydrationDone,
}) {
  const inferred = inferMealBucketsPST(meals, now);
  const nowHourPST = inferred.nowHourPST;
  const mealBuckets = inferred.mealBuckets;

  return buildChecklist({
    goalType,
    profileComplete,
    mealsCount: Number(mealsCount) || (Array.isArray(meals) ? meals.length : 0),
    mealBuckets,
    nowHourPST,
    hasWorkout: !!hasWorkout,
    proteinG: Number(proteinG) || 0,
    carbsG: Number(carbsG) || 0,
    fatG: Number(fatG) || 0,
    proteinTarget: Number(proteinTarget) || 0,
    carbsTarget: Number(carbsTarget) || 0,
    fatTarget: Number(fatTarget) || 0,
    dayHydrationDone: !!dayHydrationDone,
  });
}

export function buildChecklistWindows(items = []) {
  const src = Array.isArray(items) ? items : [];
  const buckets = { morning: [], afternoon: [], night: [] };
  for (const it of src) {
    const w = it?.window;
    if (w === "morning" || w === "afternoon" || w === "night") buckets[w].push(it);
    else buckets.afternoon.push(it);
  }
  return buckets;
}

export function pickDefaultWindowIndex(nowHourPST) {
  const h = Number.isFinite(nowHourPST) ? nowHourPST : getHourInTimeZone(new Date(), "America/Los_Angeles");
  if (h == null) return 0;
  if (h < 12) return 0;
  if (h < 17) return 1;
  return 2;
}

export function buildChecklistSummary(items = [], nowHourPST = null) {
  const src = Array.isArray(items) ? items : [];
  const total = src.length;
  const done = src.filter((i) => i?.done).length;
  const windows = buildChecklistWindows(src);

  const byWindow = {};
  for (const w of ["morning", "afternoon", "night"]) {
    const arr = windows[w] || [];
    byWindow[w] = {
      total: arr.length,
      done: arr.filter((i) => i?.done).length,
    };
  }

  const remaining = src.filter((i) => !i?.done);
  const nextStep = remaining[0] || null;

  const idx = pickDefaultWindowIndex(nowHourPST);
  const activeWindow = ["morning", "afternoon", "night"][idx] || "morning";

  return {
    total,
    done,
    remaining: total - done,
    completion_pct: total ? Math.round((done / total) * 100) : 0,
    active_window: activeWindow,
    by_window: byWindow,
    next_step: nextStep
      ? {
          key: nextStep.key,
          title: nextStep.title,
          subtitle: nextStep.subtitle,
          action: nextStep.action || null,
          window: nextStep.window || null,
        }
      : null,
  };
}

export function formatChecklistForPrompt(summary) {
  if (!summary) return "";
  const s = summary;
  const pct = s.completion_pct ?? 0;
  const next = s.next_step
    ? `${s.next_step.title} — ${s.next_step.subtitle}`
    : "None (already complete).";
  return `Micro-quest checklist: ${s.done}/${s.total} complete (${pct}%). Active window: ${s.active_window}. Next step: ${next}`;
}

// Back-compat + convenience wrapper for Recap Coach.
// Some files import this name directly; keep it stable.
export function buildMicroQuestSummary({ items = [], nowHourPST = null } = {}) {
  const summary = buildChecklistSummary(items, nowHourPST);
  return {
    summary,
    prompt_line: formatChecklistForPrompt(summary),
    next_step: summary?.next_step || null,
    completion_pct: summary?.completion_pct ?? 0,
    remaining: summary?.remaining ?? 0,
    active_window: summary?.active_window || "morning",
  };
}