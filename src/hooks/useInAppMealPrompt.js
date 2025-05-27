// src/hooks/useInAppMealPrompt.js
import { useEffect, useState } from 'react';

// storage keys
const PREFS_KEY    = 'mealReminderPrefs';   // either { name: time, … } or [ { name, time }, … ]
const PROMPTED_KEY = 'mealPromptsToday';   // { [YYYY-MM-DD]: [mealName,…] }

function todayKey() {
  // ISO date, e.g. "2025-05-26"
  return new Date().toISOString().slice(0, 10);
}

function loadPrefs() {
  const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // new format
    return raw.filter(p => p.name && p.time);
  }
  // legacy object format → array
  return Object.entries(raw).map(([name, time]) => ({ name, time }));
}

function loadPromptedMap() {
  return JSON.parse(localStorage.getItem(PROMPTED_KEY) || '{}');
}

function savePromptedMap(map) {
  localStorage.setItem(PROMPTED_KEY, JSON.stringify(map));
}

export default function useInAppMealPrompt() {
  const [missed, setMissed] = useState([]);

  useEffect(() => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    // 1) load & normalize prefs
    const prefs = loadPrefs()
      .map(p => {
        const [h, m] = p.time.split(':').map(Number);
        return { name: p.name, minutes: h * 60 + m };
      })
      .sort((a, b) => a.minutes - b.minutes);

    if (prefs.length === 0) {
      setMissed([]);
      return;
    }

    // 2) load today's prompted meals
    const promptedMap = loadPromptedMap();
    const today       = todayKey();
    const already     = promptedMap[today] || [];

    // 3) find all meals whose time ≤ now and not yet prompted
    const newly = prefs
      .filter(p => p.minutes <= nowMinutes)
      .map(p => p.name)
      .filter(name => !already.includes(name));

    if (newly.length) {
      promptedMap[today] = [...already, ...newly];
      savePromptedMap(promptedMap);
    }

    setMissed(newly);
  }, []); // run once on mount

  return missed;
}
