// src/lib/dailyChecklist.js
// Lightweight, shared helper for "micro-quest" inference.
// NOTE: This is intentionally heuristic + additive; it should never block core app flows.

function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function getHourInTimeZone(dateLike, timeZone = "America/Los_Angeles") {
  try {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    const hourStr = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(d);
    const h = parseInt(hourStr, 10);
    return Number.isFinite(h) ? h : d.getHours();
  } catch {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    return d.getHours();
  }
}

function windowForHour(h) {
  const hour = safeNum(h, 12);
  // Morning: 4–10, Afternoon: 11–16, Night: 17–3 (wrap)
  if (hour >= 4 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 16) return "afternoon";
  return "night";
}

function mealTs(meal) {
  return (
    meal?.eaten_at ||
    meal?.eatenAt ||
    meal?.logged_at ||
    meal?.loggedAt ||
    meal?.created_at ||
    meal?.createdAt ||
    meal?.ts ||
    meal?.time ||
    null
  );
}

// Group meals into "events" so a snack + drink doesn't count as multiple meal slots.
// Default: new event if ≥ 75 minutes since last meal.
function groupMealEvents(meals = [], timeZone = "America/Los_Angeles", gapMinutes = 75) {
  const sorted = [...(meals || [])]
    .filter(Boolean)
    .map((m) => {
      const ts = mealTs(m);
      const t = ts ? new Date(ts).getTime() : NaN;
      return { ...m, _ts: ts, _t: t };
    })
    .filter((m) => Number.isFinite(m._t))
    .sort((a, b) => a._t - b._t);

  const out = [];
  let cur = null;

  for (const m of sorted) {
    if (!cur) {
      cur = { start_t: m._t, end_t: m._t, meals: [m] };
      continue;
    }
    const mins = (m._t - cur.end_t) / 60000;
    if (mins >= gapMinutes) {
      out.push(cur);
      cur = { start_t: m._t, end_t: m._t, meals: [m] };
    } else {
      cur.end_t = m._t;
      cur.meals.push(m);
    }
  }
  if (cur) out.push(cur);

  // Annotate each event with window + hour
  return out.map((ev) => {
    const mid = new Date((ev.start_t + ev.end_t) / 2);
    const hour = getHourInTimeZone(mid, timeZone);
    return { ...ev, hour, window: windowForHour(hour) };
  });
}

function summarizeMealSlots(events = []) {
  const has = { morning: false, afternoon: false, night: false };
  for (const ev of events) {
    if (ev?.window) has[ev.window] = true;
  }

  // Brunch heuristic: a first event between 11–13 can count as "breakfast done" but still recommend lunch later.
  const first = events?.[0];
  if (!has.morning && first && first.window === "afternoon" && safeNum(first.hour, 12) <= 13) {
    has.morning = true;
  }
  return has;
}

export function buildMicroQuestSummary({
  now = new Date(),
  timeZone = "America/Los_Angeles",
  meals = [],
  workouts = [],
  proteinSoFar = 0,
  proteinTarget = 170,
  consumed = null,
  burned = null,
  calorieGoal = null,
} = {}) {
  const h = getHourInTimeZone(now, timeZone);
  const currentWindow = windowForHour(h);

  const mealEvents = groupMealEvents(meals, timeZone, 75);
  const slots = summarizeMealSlots(mealEvents);

  const workoutsCount = Array.isArray(workouts) ? workouts.length : 0;

  const pending = [];

  // Window-first pending suggestions
  if (!slots.morning) pending.push({ id: "log_breakfast", window: "morning", label: "Log your first meal (breakfast)" });
  if (!slots.afternoon) pending.push({ id: "log_lunch", window: "afternoon", label: "Log lunch (even a quick meal)" });
  if (!slots.night) pending.push({ id: "log_dinner", window: "night", label: "Log dinner / last meal" });

  if (workoutsCount <= 0) pending.push({ id: "log_workout", window: "afternoon", label: "Log a workout (even a short one)" });

  const pTarget = safeNum(proteinTarget, 0);
  const pSoFar = safeNum(proteinSoFar, 0);
  if (pTarget > 0 && pSoFar < pTarget) {
    const remaining = Math.max(0, Math.round(pTarget - pSoFar));
    pending.push({ id: "protein_target", window: "night", label: `Hit protein target (+${remaining}g left)` });
  }

  // Determine completion: we treat the above 5 as the canonical "micro quest spine"
  const spine = [
    { id: "log_breakfast", done: !!slots.morning },
    { id: "log_lunch", done: !!slots.afternoon },
    { id: "log_dinner", done: !!slots.night },
    { id: "log_workout", done: workoutsCount > 0 },
    { id: "protein_target", done: !(pTarget > 0 && pSoFar < pTarget) },
  ];

  const total = spine.length;
  const done = spine.filter((q) => q.done).length;

  const windowCounts = {
    morning: { done: slots.morning ? 1 : 0, total: 1 },
    afternoon: { done: slots.afternoon ? 1 : 0, total: 1 },
    night: { done: slots.night ? 1 : 0, total: 1 },
  };

  const momentum = total ? Math.round((done / total) * 100) : 0;

  // Pick "next best move": pending item in current window, else first pending.
  const nextBest =
    pending.find((p) => p.window === currentWindow) ||
    pending[0] ||
    null;

  // Small, human-friendly "tone tag"
  let toneTag = "steady";
  if (momentum >= 80) toneTag = "crushing";
  else if (momentum >= 55) toneTag = "solid";
  else if (momentum >= 30) toneTag = "warming_up";
  else toneTag = "reset";

  return {
    current_window: currentWindow,
    momentum_percent: momentum,
    tone_tag: toneTag,
    spine_done: done,
    spine_total: total,
    meal_events: mealEvents.length,
    slots,
    window_counts: windowCounts,
    pending_top: pending.slice(0, 5),
    next_best_move: nextBest,
    context: {
      consumed: consumed == null ? null : Math.round(safeNum(consumed, 0)),
      burned: burned == null ? null : Math.round(safeNum(burned, 0)),
      calorie_goal: calorieGoal == null ? null : Math.round(safeNum(calorieGoal, 0)),
      protein_so_far: Math.round(pSoFar),
      protein_target: Math.round(pTarget),
    },
  };
}
