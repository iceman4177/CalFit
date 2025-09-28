// src/lib/migrateLocalToCloud.js
import { saveWorkout, saveMeal, upsertDailyMetrics } from './db';

export function collectAllLocalData() {
  const workoutHistory = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
  const mealHistory    = JSON.parse(localStorage.getItem('mealHistory') || '[]');

  // Flatten meals with timestamps (we only have per-day lists)
  const meals = [];
  for (const day of mealHistory) {
    for (const m of (day.meals || [])) {
      meals.push({
        datetime: new Date().toISOString(), // we didn’t store per-meal time historically
        title: m.name,
        totalCalories: m.calories || 0,
        items: [{ name: m.name, qty: 1, unit: 'serving', calories: m.calories || 0 }],
        __day: day.date,
      });
    }
  }

  return { workouts: workoutHistory, meals, dailyMetrics: [] };
}

export async function migrateLocalToCloud(user) {
  if (!user?.id) return;
  if (localStorage.getItem('localMigrated')) return;

  const data = collectAllLocalData();

  // Migrate workouts
  for (const w of data.workouts) {
    const started = new Date().toISOString();
    const ended   = new Date().toISOString();
    const sets = (w.exercises || []).map(s => ({
      exercise_name: s.name,
      equipment: null,
      muscle_group: null,
      weight: null,
      reps: s.reps || null,
      tempo: null,
      volume: (s.reps || 0) * (s.sets || 0),
    }));
    await saveWorkout(user.id, {
      started_at: started,
      ended_at: ended,
      goal: null,
      notes: null,
    }, sets);

    // bump burned for that day if we have totalCalories
    if (Number.isFinite(w.totalCalories)) {
      const day = (new Date()).toISOString().slice(0,10);
      await upsertDailyMetrics(user.id, day, w.totalCalories || 0, 0);
    }
  }

  // Migrate meals
  for (const m of data.meals) {
    await saveMeal(user.id, {
      eaten_at: new Date(m.datetime).toISOString(),
      title: m.title,
      total_calories: m.totalCalories,
    }, (m.items || []).map(it => ({
      food_name: it.name, qty: it.qty, unit: it.unit,
      calories: it.calories, protein: it.protein, carbs: it.carbs, fat: it.fat,
    })));
    const day = (m.__day) || (new Date(m.datetime).toISOString().slice(0,10));
    await upsertDailyMetrics(user.id, day, 0, m.totalCalories || 0);
  }

  localStorage.setItem('localMigrated', 'true');
}
