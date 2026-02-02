//
// UUID v4 fallback (for environments without crypto.randomUUID)
function uuidv4Fallback() {
  try {
    // RFC4122-ish
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  } catch {
    return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, () => '0');
  }
}
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Container,
  Typography,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Grid,
  Card,
  CardContent,
  Paper,
  Stack,
  Chip
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import ShareWorkoutModal from './ShareWorkoutModal';
import TemplateSelector from './TemplateSelector';
import { MET_VALUES } from './exerciseMeta';
import { EXERCISE_ROM } from './exerciseConstants';
import { updateStreak } from './utils/streak';
import SuggestedWorkoutCard from './components/SuggestedWorkoutCard';
import UpgradeModal from './components/UpgradeModal';
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse
} from './components/FeatureUseBadge.jsx';
import { useAuth } from './context/AuthProvider.jsx';
import { calcExerciseCaloriesHybrid } from './analytics';
import { callAIGenerate } from './lib/ai'; // ✅ identity-aware AI helper

// ✅ direct Supabase reads for lightweight "today" history hydration (mirrors meals behavior)
import { supabase } from './lib/supabaseClient';
import { ensureScopedFromLegacy, readScopedJSON, writeScopedJSON, scopedKey, KEYS } from './lib/scopedStorage.js';

// ✅ local-first wrappers (idempotent, queued sync, syncs to Supabase when signed in)
import {
  saveWorkoutLocalFirst,
  deleteWorkoutLocalFirst,
  upsertDailyMetricsLocalFirst
} from './lib/localFirst';

// ---- Paywall helpers ----
const isProUser = () => {
  try {
    if (localStorage.getItem('isPro') === 'true') return true;
    const ud = JSON.parse(localStorage.getItem('userData') || '{}');
    return !!ud.isPremium;
  } catch {
    return false;
  }
};

// ---- formatting ----
function formatExerciseLine(ex) {
  const setsNum = parseInt(ex.sets, 10);
  const hasSets = Number.isFinite(setsNum) && setsNum > 0;

  let repsStr = '';
  if (typeof ex.reps === 'string') repsStr = ex.reps.trim();
  else {
    const r = parseInt(ex.reps, 10);
    repsStr = Number.isFinite(r) && r > 0 ? String(r) : '';
  }
  const hasReps = repsStr !== '' && repsStr !== '0';

  const weight = parseFloat(ex.weight);
  const hasWeight = Number.isFinite(weight) && weight > 0;

  const vol =
    hasSets && hasReps ? `${setsNum}×${repsStr}` :
      hasSets ? `${setsNum}×` :
        hasReps ? `×${repsStr}` : '';

  const wt = hasWeight ? ` @ ${weight} lb` : '';
  const name = ex.exerciseName || ex.name || 'Exercise';
  const kcals = ((+ex.calories) || 0).toFixed(2);

  if (!vol && !hasWeight) return `${name} — ${kcals} cals`;
  return `${name} — ${vol}${wt} — ${kcals} cals`;
}
function formatSessionExerciseDetail(ex) {
  const name = ex?.name || ex?.exerciseName || 'Exercise';

  // If we have per-set rows (from workout_sets hydration), render them compactly
  if (Array.isArray(ex?._sets) && ex._sets.length) {
    const parts = ex._sets.slice(0, 4).map((s) => {
      const r = (s?.reps != null && s?.reps !== '') ? String(s.reps) : '';
      const w = (s?.weight != null && s?.weight !== '' && Number(s.weight) > 0) ? `${s.weight}lb` : '';
      if (w && r) return `${w}×${r}`;
      if (w) return w;
      if (r) return `${r} reps`;
      return '';
    }).filter(Boolean);

    const more = ex._sets.length > 4 ? ` +${ex._sets.length - 4} more` : '';
    let suffix = parts.length ? ` — ${parts.join(', ')}${more}` : '';
    // Cardio / timed activities: treat `volume` as minutes when no strength reps/weight present.
    if (!suffix) {
      const volumeMinutes = ex._sets.reduce((s, x) => s + safeNum(x?.volume, 0), 0);
      if (volumeMinutes > 0) suffix = ` — ${Math.round(volumeMinutes)} min`;
    }
    return `${name}${suffix}`;
  }

  const setsNum = parseInt(ex?.sets, 10);
  const reps = ex?.reps != null ? String(ex.reps).trim() : '';
  const weight = ex?.weight != null ? Number(ex.weight) : 0;

  const vol =
    Number.isFinite(setsNum) && setsNum > 0 && reps ? `${setsNum}×${reps}` :
      Number.isFinite(setsNum) && setsNum > 0 ? `${setsNum} sets` :
        reps ? `${reps} reps` : '';

  const wt = Number.isFinite(weight) && weight > 0 ? ` @ ${weight} lb` : '';
  return vol || wt ? `${name} — ${vol}${wt}` : name;
}

function getSessionTitle(sess) {
  try {
    const name = String(sess?.name || '').trim();
    if (name && name !== 'Workout') return name;
    const ex0 = sess?.exercises?.[0]?.name;
    if (ex0) return String(ex0);
    return name || 'Workout';
  } catch {
    return 'Workout';
  }
}

// ---- Local-day ISO helper (local midnight; avoids UTC off-by-one) ----
function localDayISO(d = new Date()) {
  try {
    const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return ld.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function tryHHMM(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ---- Stable device id (not workout session id) ----
function getOrCreateClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now());
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
  }
}

// ✅ Stable draft workout session id (THIS is what prevents duplicates + enables upsert while typing)
function getOrCreateActiveWorkoutSessionId() {
  try {
    let sid = localStorage.getItem('slimcal:activeWorkoutSessionId');
    if (!sid) {
      sid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : uuidv4Fallback();
      localStorage.setItem('slimcal:activeWorkoutSessionId', sid);
    }
    return sid;
  } catch {
    return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : uuidv4Fallback();
  }
}

function clearActiveWorkoutSessionId() {
  try {
    localStorage.removeItem('slimcal:activeWorkoutSessionId');
  } catch { }
}

export default function WorkoutPage({ userData, onWorkoutLogged }) {
  const history = useHistory();
  const { user } = useAuth();
  // --- User-scoped local caches (prevents cross-account contamination on same device) ---
  const userId = user?.id || null;

  const readWorkoutHistory = useCallback(() => {
    try {
      ensureScopedFromLegacy(KEYS.workoutHistory, userId);
      const list = readScopedJSON(KEYS.workoutHistory, userId, []);
      const arr = Array.isArray(list) ? list : [];
      // Self-heal: never let other users' sessions leak into this user's totals.
      const cleaned = arr.filter((s) => {
        const uid = s?.user_id || s?.userId || (s?.user && s.user.id) || null;
        return !uid || uid === userId;
      });
      if (cleaned.length !== arr.length) {
        writeScopedJSON(KEYS.workoutHistory, userId, cleaned);
      }
      return cleaned;
    } catch {
      return [];
    }
  }, [userId]);

  const writeWorkoutHistory = useCallback((list) => {
    try {
      ensureScopedFromLegacy(KEYS.workoutHistory, userId);
      writeScopedJSON(KEYS.workoutHistory, userId, Array.isArray(list) ? list : []);
    } catch {}
  }, [userId]);

  const readDailyCache = useCallback(() => {
    try {
      ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
      const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {});
      return cache && typeof cache === 'object' ? cache : {};
    } catch {
      return {};
    }
  }, [userId]);

  const writeDailyCache = useCallback((cache) => {
    try {
      ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
      writeScopedJSON(KEYS.dailyMetricsCache, userId, cache && typeof cache === 'object' ? cache : {});
    } catch {}
  }, [userId]);

  useEffect(() => {
    if (!userData) history.replace('/edit-info');
  }, [userData, history]);

  const [currentStep, setCurrentStep] = useState(1);
  const [cumulativeExercises, setCumulativeExercises] = useState([]);
  const [newExercise, setNewExercise] = useState({
    exerciseType: '',
    cardioType: '',
    manualCalories: '',
    muscleGroup: '',
    exerciseName: '',
    weight: '',
    sets: '1',
    reps: '',
    concentricTime: '',
    eccentricTime: ''
  });
  const [currentCalories, setCurrentCalories] = useState(0);
  const [showSaunaSection, setShowSaunaSection] = useState(false);
  const [saunaTime, setSaunaTime] = useState('');
  const [saunaTemp, setSaunaTemp] = useState('180');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showSuggestCard, setShowSuggestCard] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showBackHelp, setShowBackHelp] = useState(false);
  const [showLogHelp, setShowLogHelp] = useState(false);
  const [showShareHelp, setShowShareHelp] = useState(false);
  const [showNewHelp, setShowNewHelp] = useState(false);

  // ✅ "Meals-style": show today's logged workouts at the bottom (no need to leave page)
  const [todaySessions, setTodaySessions] = useState([]);
  const [loadingTodaySessions, setLoadingTodaySessions] = useState(false);

  // ✅ stable draft id ref for this workout session
  const activeWorkoutSessionIdRef = useRef(getOrCreateActiveWorkoutSessionId());

  // ✅ stable "started_at" so autosaves don't constantly rewrite it
  const startedAtRef = useRef(new Date().toISOString());

  // ✅ Rehydrate an in-progress draft when you leave/return to the Workout tab (prevents "it saved then vanished")
  useEffect(() => {
    try {
      const now = new Date();
      const todayUS = now.toLocaleDateString('en-US');
      const todayISO = localDayISO(now);
      const cid = String(activeWorkoutSessionIdRef.current || '');
      if (!cid) return;

      const raw = readWorkoutHistory();
      const list = Array.isArray(raw) ? raw : [];
      const draft = list.find((w) => {
        const id = String(w?.client_id || w?.id || '');
        const d = String(w?.date || '');
        const hasEx = Array.isArray(w?.exercises) && w.exercises.length > 0;
        return id === cid && hasEx && (d === todayUS || d === todayISO);
      });

      if (draft) {
        const next = (draft.exercises || []).map((ex) => ({
          exerciseType: ex.exerciseType || '',
          muscleGroup: ex.muscleGroup || '',
          exerciseName: ex.name || ex.exerciseName || '',
          weight: ex.weight || '',
          sets: ex.sets || '',
          reps: ex.reps || '',
          concentricTime: ex.concentricTime || '',
          eccentricTime: ex.eccentricTime || '',
          calories: ex.calories || 0
        }));
        if (next.length) {
          setCumulativeExercises(next);
          const total = next.reduce((s, ex) => s + (Number(ex.calories) || 0), 0);
          setCurrentCalories(total);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const readTodaySessionsFromLocal = useCallback(() => {
    const now = new Date();
    const todayUS = now.toLocaleDateString('en-US');
    const todayISO = localDayISO(now);
    try {
      const raw = readWorkoutHistory();
      const list = Array.isArray(raw) ? raw : [];
      // --- De-dupe + normalize ---
      // Workouts can exist in localStorage with either `date` = todayUS or `date` = todayISO.
      // If both exist for the same session (same client_id), it shows twice and doubles burned.
      const byId = new Map();
      let sawDupes = false;

      const isToday = (d) => d === todayUS || d === todayISO;
      const score = (sess) => {
        const hasExercises = Array.isArray(sess?.exercises) && sess.exercises.length > 0;
        const total = safeNum(sess?.totalCalories ?? sess?.total_calories, 0);
        // prefer sessions with exercises, then higher total, then newer timestamp
        const t = new Date(sess?.started_at || sess?.createdAt || 0).getTime() || 0;
        return (hasExercises ? 1_000_000 : 0) + (total * 1000) + (t / 1000);
      };

      for (const w0 of list) {
        if (!w0) continue;
        const cid = String(w0?.client_id || w0?.id || '');
        if (!cid) continue;
        const total0 = safeNum(w0?.totalCalories ?? w0?.total_calories, 0);
        const hasExercises0 = Array.isArray(w0?.exercises) && w0.exercises.length > 0;
        // Drop "ghost" sessions: 0 kcal + no exercises (these are usually stale draft placeholders from old versions)
        if ((isToday(w0?.date) || isToday(w0?.date?.toString?.() || '')) && total0 <= 0 && !hasExercises0) continue;
        const w = {
          ...w0,
          // normalize totals for UI
          totalCalories: safeNum(w0?.totalCalories ?? w0?.total_calories, 0),
          total_calories: safeNum(w0?.total_calories ?? w0?.totalCalories, 0),
        };
        if (isToday(w?.date)) w.date = todayUS;

        const prev = byId.get(cid);
        if (!prev) byId.set(cid, w);
        else {
          sawDupes = true;
          byId.set(cid, score(w) >= score(prev) ? w : prev);
        }
      }

      let cleaned = Array.from(byId.values());
      // newest first
      cleaned.sort((a, b) => {
        const ta = new Date(a?.started_at || a?.createdAt || 0).getTime();
        const tb = new Date(b?.started_at || b?.createdAt || 0).getTime();
        return tb - ta;
      });

      // Today list (normalized to todayUS). Extra de-dupe by (time + kcal) to guard
      // against rare cases where two rows exist for the same workout but different ids.
      let today = cleaned.filter(w => w?.date === todayUS);
      if (today.length > 1) {
        const fpMap = new Map();
        const uniq = [];
        for (const w of today) {
          const total = safeNum(w?.totalCalories ?? w?.total_calories, 0);
          const hhmm = tryHHMM(w?.started_at || w?.createdAt || w?.ended_at);
          const fp = `${hhmm}|${Math.round(total * 10)}`;
          const prev = fpMap.get(fp);
          if (!prev) {
            fpMap.set(fp, w);
            uniq.push(w);
            continue;
          }
          // prefer the one with exercises detail
          const prevEx = Array.isArray(prev?.exercises) ? prev.exercises.length : 0;
          const curEx = Array.isArray(w?.exercises) ? w.exercises.length : 0;
          if (curEx > prevEx) {
            fpMap.set(fp, w);
            const idx = uniq.indexOf(prev);
            if (idx >= 0) uniq[idx] = w;
          } else {
            sawDupes = true;
          }
        }
        today = uniq;
        if (sawDupes) {
          // rebuild cleaned with today's unique sessions only
          const nonToday2 = cleaned.filter(w => w?.date !== todayUS);
          cleaned = [...today, ...nonToday2];
        }
      }

      setTodaySessions(today);

      // If we detected dupes / mixed date formats, write back a cleaned list + fix burned caches
      if (sawDupes) {
        try {
          writeWorkoutHistory(cleaned.slice(0, 300));
        } catch {}

        // Update burnedToday + dailyMetricsCache burned so banner doesn't flicker/double-count
        const burnedToday = today.reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
        try {
          localStorage.setItem((user?.id ? scopedKey('burnedToday', user.id) : 'burnedToday'), String(Math.round(burnedToday || 0)));
        } catch {}
        try {
          const cache = readDailyCache() || {};
          const prev = cache[todayISO] || {};
          cache[todayISO] = {
            ...prev,
            burned: Math.round(burnedToday || 0),
            updated_at: new Date().toISOString()
          };
          writeDailyCache(cache);
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
            detail: { date: todayISO, burned: Math.round(burnedToday || 0) }
          }));
        } catch {}
      }
    } catch {
      setTodaySessions([]);
    }
  }, []);

  const hydrateTodaySessionsFromCloud = useCallback(async () => {
    if (!user?.id || !supabase) return;

    const now = new Date();
    const dayISO = localDayISO(now);
    const todayUS = now.toLocaleDateString('en-US');

    const isTodayAny = (s) => {
      const d = String(s?.date || '');
      const ld = String(s?.__local_day || '');
      return d === String(todayUS) || d === String(dayISO) || ld === String(dayISO);
    };

    setLoadingTodaySessions(true);
    try {
      let data = null;
      let error = null;

      // ✅ Prefer local_day equality (timezone-proof)
      try {
        const res = await supabase
          .from('workouts')
          .select('id,client_id,total_calories,started_at,ended_at,created_at,local_day')
          .eq('user_id', user.id)
          .eq('local_day', dayISO)
          .order('started_at', { ascending: false });
        data = res?.data;
        error = res?.error;
      } catch {}

      // Fallback: started_at range (older schema)
      if (error && /column .*local_day.* does not exist/i.test(error?.message || '')) {
        const startLocal = new Date(`${dayISO}T00:00:00`);
        const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);
        const res2 = await supabase
          .from('workouts')
          .select('id,client_id,total_calories,started_at,ended_at,created_at')
          .eq('user_id', user.id)
          .gte('started_at', startLocal.toISOString())
          .lt('started_at', nextLocal.toISOString());
        data = res2?.data;
        error = res2?.error;
      }

      if (error) {
        console.warn('[WorkoutPage] hydrateTodaySessionsFromCloud failed', error);
        return;
      }

      const cloud = Array.isArray(data) ? data : [];
      if (cloud.length === 0) return;

      // ✅ Pull workout_sets so we can render exercise/sets details (like meals)
      const workoutIds = cloud.map(w => w?.id).filter(Boolean);
      const setsByWorkout = new Map();
      try {
        if (workoutIds.length) {
          const resS = await supabase
            .from('workout_sets')
            .select('workout_id,exercise_name,weight,reps,tempo,volume,created_at')
            .eq('user_id', user.id)
            .in('workout_id', workoutIds)
            .order('created_at', { ascending: true });

          const rows = Array.isArray(resS?.data) ? resS.data : [];
          for (const r of rows) {
            const wid = String(r?.workout_id || '');
            if (!wid) continue;
            const arr = setsByWorkout.get(wid) || [];
            arr.push(r);
            setsByWorkout.set(wid, arr);
          }
        }
      } catch (e) {
        console.warn('[WorkoutPage] workout_sets pull failed (continuing)', e);
      }

      const buildExercisesFromSets = (rows = []) => {
        const by = new Map();
        for (const r of rows) {
          const name = String(r?.exercise_name || '').trim();
          if (!name) continue;
          const arr = by.get(name) || [];
          arr.push({
            reps: r?.reps ?? null,
            weight: r?.weight ?? null,
            tempo: r?.tempo ?? null,
            volume: r?.volume ?? null
          });
          by.set(name, arr);
        }
        const out = [];
        for (const [name, sets] of by.entries()) {
          const repsList = sets.map(s => (s?.reps != null ? String(s.reps) : '')).filter(Boolean);
          const maxW = sets.map(s => Number(s?.weight) || 0).reduce((m, v) => Math.max(m, v), 0);
          out.push({
            name,
            sets: sets.length,
            reps: repsList.length ? repsList.join(',') : '',
            weight: maxW > 0 ? maxW : '',
            calories: 0,
            _sets: sets
          });
        }
        return out;
      };

      // Merge cloud sessions into local workoutHistory, preserving local exercise details if present
      try {
        const key = 'workoutHistory';
        const raw = JSON.parse(localStorage.getItem(key) || '[]');
        const list = Array.isArray(raw) ? raw : [];

        const map = new Map();
        for (const sess of list) {
          const cid = String(sess?.client_id || sess?.id || '');
          if (!cid) continue;
          map.set(cid, sess);
        }

        for (const w of cloud) {
          const cid = String(w?.client_id || w?.id || '');
          if (!cid) continue;

          const total = safeNum(w?.total_calories, 0);
          const setsRows = setsByWorkout.get(String(w?.id || '')) || [];
          const exercisesFromSets = buildExercisesFromSets(setsRows);

          // Skip junk rows (old draft placeholders)
          if (total <= 0 && exercisesFromSets.length === 0) continue;

          const norm = {
            id: cid,
            client_id: cid,
            date: todayUS,
            __local_day: w?.local_day || dayISO,
            started_at: w?.started_at || w?.created_at || new Date().toISOString(),
            ended_at: w?.ended_at || w?.started_at || w?.created_at || new Date().toISOString(),
            createdAt: w?.started_at || w?.created_at || new Date().toISOString(),
            totalCalories: total,
            total_calories: total,
            name: exercisesFromSets?.[0]?.name || 'Workout',
            exercises: exercisesFromSets,
            uploaded: true,
            __cloud: true,
            __workout_id: w?.id || null
          };

          const existing = map.get(cid);
          if (existing) {
            const existingExercises = Array.isArray(existing?.exercises) ? existing.exercises : [];
            const keepExercises = existingExercises.length > 0;
            map.set(cid, {
              ...norm,
              ...existing,
              __local_day: norm.__local_day,
              __workout_id: norm.__workout_id || existing.__workout_id || null,
              exercises: keepExercises ? existingExercises : norm.exercises,
              totalCalories: safeNum(existing?.totalCalories ?? existing?.total_calories, norm.totalCalories),
              total_calories: safeNum(existing?.total_calories ?? existing?.totalCalories, norm.total_calories)
            });
          } else {
            map.set(cid, norm);
          }
        }

        const nonToday = list.filter(s => !isTodayAny(s));
        let todayMerged = Array.from(map.values()).filter(s => isTodayAny(s));

        // Normalize all today entries to use the US string (matches meals)
        todayMerged = todayMerged.map(s => ({ ...s, date: todayUS }));

        // newest first
        todayMerged.sort((a, b) => {
          const ta = new Date(a?.started_at || a?.createdAt || 0).getTime();
          const tb = new Date(b?.started_at || b?.createdAt || 0).getTime();
          return tb - ta;
        });

        // Extra guard: if two sessions have different ids but same time+calories, treat as duplicate
        if (todayMerged.length > 1) {
          const seen = new Set();
          const uniq = [];
          for (const s of todayMerged) {
            const kcal = Math.round(safeNum(s?.totalCalories ?? s?.total_calories, 0) * 10) / 10;
            const hhmm = tryHHMM(s?.started_at || s?.createdAt || '');
            const fp = `${hhmm}|${kcal}`;
            if (hhmm && kcal > 0 && seen.has(fp)) continue;
            seen.add(fp);
            uniq.push(s);
          }
          todayMerged = uniq;
        }

        const next = [...todayMerged, ...nonToday];
        localStorage.setItem(key, JSON.stringify(next.slice(0, 300)));

        // Update burnedToday + cache so banner reflects sessions immediately
        const burnedToday = todayMerged.reduce((s, sess) => s + safeNum(sess?.totalCalories ?? sess?.total_calories, 0), 0);
        try { localStorage.setItem((user?.id ? scopedKey('burnedToday', user.id) : 'burnedToday'), String(Math.round(burnedToday || 0))); } catch {}

        try {
          const cache = readDailyCache() || {};
          const prev = cache[dayISO] || {};
          cache[dayISO] = { ...prev, burned: Math.round(burnedToday || 0), updated_at: new Date().toISOString() };
          writeDailyCache(cache);
        } catch {}

        try {
          window.dispatchEvent(new CustomEvent('slimcal:burned:update', { detail: { date: dayISO, burned: Math.round(burnedToday || 0) } }));
          window.dispatchEvent(new CustomEvent('slimcal:workoutHistory:update'));
        } catch {}
      } catch (e) {
        console.warn('[WorkoutPage] merge cloud workouts into local failed', e);
      }
    } finally {
      setLoadingTodaySessions(false);
    }
  }, [user?.id]);

  // ✅ Meals-style behavior: on load/focus, pull today's workouts from cloud into local
  // and keep the on-page history + banner consistent without needing to visit /history.
  useEffect(() => {
    readTodaySessionsFromLocal();
    hydrateTodaySessionsFromCloud();

    const onWorkoutHistoryUpdate = () => readTodaySessionsFromLocal();
    const onBurnedUpdate = () => readTodaySessionsFromLocal();
    const onStorage = (e) => {
      if (!e) return;
      if (e.key === 'workoutHistory') readTodaySessionsFromLocal();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        hydrateTodaySessionsFromCloud();
        readTodaySessionsFromLocal();
      }
    };

    window.addEventListener('slimcal:workoutHistory:update', onWorkoutHistoryUpdate);
    window.addEventListener('slimcal:burned:update', onBurnedUpdate);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('slimcal:workoutHistory:update', onWorkoutHistoryUpdate);
      window.removeEventListener('slimcal:burned:update', onBurnedUpdate);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [readTodaySessionsFromLocal, hydrateTodaySessionsFromCloud]);

  const handleDismiss = (key, setter, cb) => {
    try {
      localStorage.setItem(key, 'true');
    } catch { }
    setter(false);
    if (cb) cb();
  };

  const handleLoadTemplate = exercises => {
    setCumulativeExercises(
      (exercises || []).map(ex => ({
        exerciseType: ex.exerciseType || '',
        muscleGroup: ex.muscleGroup || '',
        exerciseName: ex.name,
        weight: ex.weight || '',
        sets: ex.sets || '',
        reps: ex.reps || '',
        concentricTime: ex.concentricTime || '',
        eccentricTime: ex.eccentricTime || '',
        calories: ex.calories
      }))
    );
  };

  const exerciseOptions = {
    cardio: ['Treadmill', 'Bike', 'Elliptical', 'Rowing Machine', 'Stair Climber'],
    machine: {
      Chest: ['Chest Press Machine', 'Cable Crossover/Functional Trainer'],
      Shoulders: ['Shoulder Press Machine'],
      Back: ['Seated Row Machine', 'Lat Pulldown Machine'],
      Legs: ['Leg Press Machine', 'Leg Extension Machine', 'Leg Curl Machine'],
      Abs: ['Abdominal Crunch Machine'],
      Misc: ['Pec Fly / Rear Deltoid Machine', 'Assisted Pull-Up/Dip Machine']
    },
    dumbbell: {
      Chest: ['Dumbbell Bench Press', 'Dumbbell Flyes'],
      Shoulders: ['Dumbbell Shoulder Press', 'Dumbbell Lateral Raise'],
      Biceps: ['Dumbbell Bicep Curls', 'Hammer Curls'],
      Triceps: ['Dumbbell Triceps Extensions'],
      Back: ['Dumbbell Rows (One-Arm Row)'],
      Traps: ['Dumbbell Shrugs'],
      Legs: ['Dumbbell Squats', 'Dumbbell Lunges', 'Dumbbell Deadlifts', 'Dumbbell Step-Ups']
    },
    barbell: {
      Chest: ['Barbell Bench Press'],
      Shoulders: ['Overhead Press (Barbell Press)', 'Barbell Upright Row'],
      Back: ['Barbell Row'],
      Biceps: ['Barbell Bicep Curls'],
      Legs: ['Barbell Squat', 'Barbell Deadlift', 'Barbell Lunges'],
      Glutes: ['Barbell Hip Thrusts'],
      FullBody: ['Barbell Clean and Press / Power Clean'],
      Traps: ['Barbell Shrugs']
    }
  };

  const calculateCalories = () => {
    if (!newExercise.exerciseName && newExercise.exerciseType !== 'cardio') {
      setCurrentCalories(0);
      return 0;
    }
    const entry = {
      exerciseName: newExercise.exerciseName || newExercise.exerciseType,
      sets: newExercise.sets,
      reps: newExercise.reps,
      tempo: `${newExercise.concentricTime || 2}-1-${newExercise.eccentricTime || 2}`,
      weight: newExercise.weight
    };
    const intent = (localStorage.getItem('training_intent') || 'general').toLowerCase();
    const total = calcExerciseCaloriesHybrid(
      entry,
      { weight: userData?.weight },
      { MET_VALUES, EXERCISE_ROM },
      intent
    );
    setCurrentCalories(total);
    return total;
  };

  const handleCalculate = () => {
    if (newExercise.exerciseType === 'cardio') {
      const cal = parseFloat(newExercise.manualCalories);
      if (!cal || cal <= 0) {
        alert('Please enter valid calories for cardio.');
        return;
      }
      setCurrentCalories(cal);
    } else {
      calculateCalories();
    }
  };

  const handleAddExercise = () => {
    if (newExercise.exerciseType === 'cardio') {
      const cal = parseFloat(newExercise.manualCalories);
      if (!cal || cal <= 0) {
        alert('Please enter valid calories for cardio.');
        return;
      }
            const entry = { exerciseType: 'cardio', exerciseName: newExercise.cardioType || 'Cardio', calories: cal };
      const next = [...cumulativeExercises, entry];
      setCumulativeExercises(next);
      instantPersistWorkoutDraftToBanner(next);
setNewExercise(prev => ({ ...prev, cardioType: '', manualCalories: '' }));
      setCurrentCalories(0);
      return;
    }

    if (
      !newExercise.exerciseName ||
      parseFloat(newExercise.weight) <= 0 ||
      parseInt(newExercise.reps, 10) <= 0
    ) {
      alert('Please enter a valid exercise, weight, and reps.');
      return;
    }

    const cals = calculateCalories();
        const entry = { ...newExercise, calories: cals };
    const next = [...cumulativeExercises, entry];
    setCumulativeExercises(next);
    instantPersistWorkoutDraftToBanner(next);

setNewExercise({
      exerciseType: '',
      cardioType: '',
      manualCalories: '',
      muscleGroup: '',
      exerciseName: '',
      weight: '',
      sets: '1',
      reps: '',
      concentricTime: '',
      eccentricTime: ''
    });
    setCurrentCalories(0);
  };

  const handleDoneWithExercises = () => {
    if (
      (newExercise.exerciseType === 'cardio' && parseFloat(newExercise.manualCalories) > 0) ||
      (newExercise.exerciseName &&
        parseFloat(newExercise.weight) > 0 &&
        parseInt(newExercise.reps, 10) > 0)
    ) {
      handleAddExercise();
    }
    setCurrentStep(3);
  };

  const handleRemoveExercise = idx => {
    const next = (cumulativeExercises || []).filter((_, i) => i !== idx);
    setCumulativeExercises(next);
    instantPersistWorkoutDraftToBanner(next);
  };

  // ✅ Sauna logging
  const handleSaveSauna = () => {
    if (saunaTime.trim()) {
      const t = parseFloat(saunaTime) || 0;
      const tmp = parseFloat(saunaTemp) || 180;
      const uw = parseFloat(userData?.weight) || 150;

      // temperature-scaled MET model
      const weightKg = uw * 0.45359237;
      let met = 1.5 + (tmp - 160) * 0.02;
      met = Math.min(Math.max(met, 1.3), 2.5);
      const kcalPerMin = (met * 3.5 * weightKg) / 200;
      const saunaCals = kcalPerMin * t;

            const next = [
        ...(cumulativeExercises || []).filter(e => e.exerciseType !== 'Sauna'),
        { exerciseType: 'Sauna', exerciseName: 'Sauna Session', calories: saunaCals }
      ];
      setCumulativeExercises(next);
      instantPersistWorkoutDraftToBanner(next);

    }

    setShowSaunaSection(false);
    setSaunaTime('');
    setSaunaTemp('180');
  };

  const handleCancelSaunaForm = () => {
    setShowSaunaSection(false);
    setSaunaTime('');
    setSaunaTemp('180');
  };

  // ✅ build a draft workout session that gets upserted continuously
  const buildDraftWorkoutSession = useCallback(() => {
    const now = new Date();
    const startedAt = startedAtRef.current || now.toISOString();
    const endedAt = now.toISOString();

    const todayLocalIso = localDayISO(now);
    const todayDisplay = now.toLocaleDateString('en-US');

    const totalRaw = cumulativeExercises.reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0);
    const total = Math.round(totalRaw * 100) / 100;

    return {
      // ✅ upsert key for device sync
      client_id: activeWorkoutSessionIdRef.current,
      user_id: user?.id || null,

      started_at: startedAt,
      ended_at: endedAt,
      total_calories: total,

      // local history fields (used by History UI)
      date: todayDisplay,
      name: (cumulativeExercises[0]?.exerciseName) || 'Workout',
      exercises: cumulativeExercises.map(ex => ({
        name: ex.exerciseName,
        sets: ex.sets,
        reps: ex.reps,
        weight: ex.weight || null,
        calories: ex.calories
      })),

      // local metadata
      id: activeWorkoutSessionIdRef.current,
      localId: `w_${getOrCreateClientId()}_${Date.now()}`,
      createdAt: startedAt,
      uploaded: false,

      // ✅ Cloud schema fields
      local_day: todayLocalIso,
      items: {
        exercises: cumulativeExercises.map(ex => ({
          name: ex.exerciseName,
          sets: ex.sets,
          reps: ex.reps,
          weight: ex.weight || null,
          calories: ex.calories
        }))
      },

      // helper
      __local_day: todayLocalIso
    };
  }, [cumulativeExercises, user?.id]);

  // ✅ INSTANT banner update (workout = meal behavior)
  // Meals update instantly because MealTracker writes to localStorage immediately.
  // Workouts MUST do the same: as you add/remove exercises, immediately upsert a draft
  // session into localStorage.workoutHistory + update burnedToday + dispatch event.
  
  const instantPersistWorkoutDraftToBanner = useCallback((nextExercises) => {
    try {
      const now = new Date();
      const todayISO = localDayISO(now);
      const todayUS = now.toLocaleDateString('en-US');
      const cid = activeWorkoutSessionIdRef.current;

      // ✅ Always write to the SAME scoped storage that the UI reads from
      const list = readWorkoutHistory();
      const filtered = (Array.isArray(list) ? list : []).filter(w => {
        const wDay = w?.date;
        const wCid = w?.client_id || w?.id;
        const isToday = (wDay === todayUS || wDay === todayISO);
        const same = String(wCid || '') === String(cid || '');
        return !(isToday && same);
      });

      let nextList = filtered;

      const exArr = Array.isArray(nextExercises) ? nextExercises : [];
      const totalRaw = exArr.reduce((sum, ex) => sum + (Number(ex?.calories) || 0), 0);
      const total = Math.round(totalRaw * 100) / 100;

      if (exArr.length > 0 && total > 0) {
        const startedAt = startedAtRef.current || now.toISOString();
        const draft = {
          // idempotent upsert key
          client_id: cid,
          id: cid,

          user_id: user?.id || null,

          started_at: startedAt,
          ended_at: now.toISOString(),
          local_day: todayISO,
          total_calories: total,

          // local UI fields
          date: todayUS,
          name: (exArr[0]?.exerciseName) || 'Workout',
          exercises: exArr.map(ex => ({
            name: ex.exerciseName,
            sets: ex.sets,
            reps: ex.reps,
            weight: ex.weight || null,
            calories: ex.calories
          })),

          // ✅ Cloud schema field (jsonb object with exercises array)
          items: {
            exercises: exArr.map(ex => ({
              name: ex.exerciseName,
              sets: ex.sets,
              reps: ex.reps,
              weight: ex.weight || null,
              calories: ex.calories
            }))
          },

          createdAt: startedAt,
          uploaded: false,
          __draft: true,
          __local_day: todayISO,
        };

        nextList = [draft, ...filtered];
      }

      writeWorkoutHistory(nextList);

      // recompute burned for today from the persisted history (single source of truth)
      const burnedToday = nextList
        .filter(w => (w?.date === todayUS || w?.date === todayISO))
        .reduce((s, w) => s + (Number(w?.totalCalories ?? w?.total_calories) || 0), 0);

      try {
        localStorage.setItem((userId ? scopedKey('burnedToday', userId) : 'burnedToday'), String(Math.round(burnedToday || 0)));
      } catch {}

      // keep daily cache in sync (DO NOT clobber consumed)
      try {
        const cache = readDailyCache();
        const prev = cache[todayISO] || {};
        const consumed = Math.round(Number(prev?.consumed ?? 0) || 0);
        cache[todayISO] = { ...prev, consumed, burned: Math.round(burnedToday || 0), updated_at: new Date().toISOString() };
        writeDailyCache(cache);
      } catch {}

      // broadcast so banner updates instantly everywhere
      try {
        window.dispatchEvent(new CustomEvent('slimcal:burned:update', { detail: { date: todayISO, burned: burnedToday } }));
        window.dispatchEvent(new CustomEvent('slimcal:workoutHistory:update', { detail: { date: todayISO } }));
      } catch {}
    } catch (e) {
      console.warn('[WorkoutPage] instantPersistWorkoutDraftToBanner failed', e);
    }
  }, [readWorkoutHistory, writeWorkoutHistory, readDailyCache, writeDailyCache, userId, user?.id]);



  // ✅ keeps daily_metrics in sync so calories carry over across devices
  const syncBurnedTodayToDailyMetrics = useCallback(async (todayDisplay, todayLocalIso) => {
    try {
      const workouts = readWorkoutHistory();
      const burnedToday = workouts
        .filter(w => w.date === todayDisplay)
        .reduce((s, w) => s + (Number(w.totalCalories ?? w.total_calories) || 0), 0);

      ensureScopedFromLegacy(KEYS.mealHistory, userId);
    const meals = readScopedJSON(KEYS.mealHistory, userId, []);
      const todayMealRec = meals.find(m => m.date === todayDisplay);
      const consumedToday = todayMealRec
        ? (todayMealRec.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0)
        : 0;

      // broadcast for UI
      try {
        window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
          detail: { date: todayLocalIso, burned: burnedToday }
        }));
      } catch { }

      // ✅ FIX: localFirst expects { consumed, burned }
      await upsertDailyMetricsLocalFirst({
        user_id: user?.id || null,
        local_day: todayLocalIso,
        consumed: consumedToday,
        burned: burnedToday
      });
    } catch (e) {
      console.warn('[WorkoutPage] syncBurnedTodayToDailyMetrics failed', e);
    }
  }, [user?.id]);

  // ✅ Submit now just finalizes (draft already saved) + navigates to history
  const handleFinish = async () => {
    // add partial exercise if valid
    if (
      (newExercise.exerciseType === 'cardio' && parseFloat(newExercise.manualCalories) > 0) ||
      (newExercise.exerciseName &&
        parseFloat(newExercise.weight) > 0 &&
        parseInt(newExercise.reps, 10) > 0)
    ) {
      handleAddExercise();
    }

    const totalRaw = cumulativeExercises.reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0);
    if (!cumulativeExercises.length || totalRaw <= 0) {
      alert('Add at least 1 exercise before submitting.');
      return;
    }

    try {
      const session = buildDraftWorkoutSession();

      // 1) Save workout header row (cloud + local-first queue)
      const saved = await saveWorkoutLocalFirst(session);
      const workoutId = saved?.id || null;

      // 2) Persist exercise details as workout_sets so other devices can render breakdown
      try {
        if (workoutId) {
          // clear any prior sets for this workout (idempotent on resubmit)
          await supabase
            .from('workout_sets')
            .delete()
            .eq('user_id', user.id)
            .eq('workout_id', workoutId);

          const rows = [];
          for (const ex of cumulativeExercises) {
            const name = String(ex?.exerciseName || '').trim();
            if (!name) continue;

            // For cardio/sauna/manual items, store a single row
            const setsN = Math.max(1, parseInt(ex?.sets, 10) || 1);
            const repsVal = ex?.reps != null && ex?.reps !== '' ? parseInt(ex.reps, 10) : null;
            const weightVal = ex?.weight != null && ex?.weight !== '' ? Number(ex.weight) : null;

            if (!weightVal && !repsVal) {
              rows.push({
                user_id: user.id,
                workout_id: workoutId,
                exercise_name: name,
                weight: null,
                reps: null,
                volume: 0
              });
              continue;
            }

            // Strength: one row per set (matches your current schema usage)
            for (let i = 0; i < setsN; i++) {
              const reps = repsVal || null;
              const weight = Number.isFinite(weightVal) ? weightVal : null;
              const volume = (Number.isFinite(weight) ? weight : 0) * (Number.isFinite(reps) ? reps : 0);
              rows.push({
                user_id: user.id,
                workout_id: workoutId,
                exercise_name: name,
                weight,
                reps,
                volume
              });
            }
          }

          if (rows.length) {
            const ins = await supabase.from('workout_sets').insert(rows);
            if (ins?.error) console.warn('[WorkoutPage] workout_sets insert error', ins.error);
          }
        }
      } catch (e) {
        console.warn('[WorkoutPage] workout_sets persistence failed (continuing)', e);
      }

      // 3) Mark the local session as uploaded (prevents "synced session may load details" placeholders)
      try {
        const key = 'workoutHistory';
        const raw = JSON.parse(localStorage.getItem(key) || '[]');
        const list = Array.isArray(raw) ? raw : [];
        const cid = String(session?.client_id || session?.id || '');
        const idx = list.findIndex(s => String(s?.client_id || s?.id || '') === cid);
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            uploaded: true,
            __draft: false,
            __cloud: true,
            __workout_id: workoutId || list[idx].__workout_id || null
          };
          localStorage.setItem(key, JSON.stringify(list));
          window.dispatchEvent(new CustomEvent('slimcal:workoutHistory:update'));
        }
      } catch {}

      updateStreak();

      if (typeof onWorkoutLogged === 'function') {
        const total = Math.round(totalRaw * 100) / 100;
        onWorkoutLogged(total);
      }

      // 4) Push today's burned total into daily_metrics (absolute, stable across devices)
      await syncBurnedTodayToDailyMetrics(session.date, session.__local_day);
    } catch (e) {
      console.warn('[WorkoutPage] finalize save failed', e);
    }

    // ✅ start fresh next time
    clearActiveWorkoutSessionId();
    activeWorkoutSessionIdRef.current = getOrCreateActiveWorkoutSessionId();
    startedAtRef.current = new Date().toISOString();

    history.push('/history');
  };

  const handleNewWorkout = () => {
    setCumulativeExercises([]);
    setCurrentCalories(0);
    setShowSaunaSection(false);
    setSaunaTime('');
    setSaunaTemp('180');
    setCurrentStep(1);

    clearActiveWorkoutSessionId();
    activeWorkoutSessionIdRef.current = getOrCreateActiveWorkoutSessionId();
    startedAtRef.current = new Date().toISOString();
  };

  const handleShareWorkout = () => setShareModalOpen(true);

  const handleAcceptSuggested = workout => {
    const intent = (localStorage.getItem('training_intent') || 'general').toLowerCase();
    const enriched = (workout?.exercises || []).map(ex => {
      const entry = {
        exerciseName: ex.exerciseName || ex.name || ex.exercise,
        sets: ex.sets || 3,
        reps: ex.reps || '8-12',
        tempo: ex.tempo,
        weight: ex.weight || 0
      };
      return {
        exerciseType: ex.exerciseType || '',
        muscleGroup: ex.muscleGroup || '',
        exerciseName: entry.exerciseName,
        weight: entry.weight,
        sets: entry.sets,
        reps: entry.reps,
        concentricTime: ex.concentricTime,
        eccentricTime: ex.eccentricTime,
        calories: calcExerciseCaloriesHybrid(
          entry,
          { weight: userData?.weight },
          { MET_VALUES, EXERCISE_ROM },
          intent
        )
      };
    });
    setCumulativeExercises(enriched);
  };

  // ✅ Identity-aware AI call prevents false 402 for trial/Pro
  const handleSuggestAIClick = async () => {
    if (!showSuggestCard) {
      if (!isProUser() && !canUseDailyFeature('ai_workout')) {
        setShowUpgrade(true);
        return;
      }
      try {
        const trainingIntent = localStorage.getItem('training_intent') || 'general';
        const fitnessGoal = localStorage.getItem('fitness_goal') || (userData?.goalType || 'maintenance');
        const equipmentList = JSON.parse(localStorage.getItem('equipment_list') || '["dumbbell","barbell","machine","bodyweight"]');

        await callAIGenerate({
          feature: 'workout',
          user_id: user?.id || null,
          goal: fitnessGoal,
          focus: localStorage.getItem('last_focus') || 'upper',
          equipment: equipmentList,
          constraints: { training_intent: trainingIntent },
          count: 1
        });
      } catch (e) {
        if (e?.code === 402) {
          setShowUpgrade(true);
          return;
        }
        console.warn('[WorkoutPage] AI gateway probe failed; continuing with local UI', e);
      }
      if (!isProUser()) registerDailyFeatureUse('ai_workout');
      setShowSuggestCard(true);
      return;
    }
    setShowSuggestCard(false);
  };

  // ---- derived UI stats for a compact strip ----
  const sessionTotals = useMemo(() => {
    const total = cumulativeExercises.reduce((s, ex) => s + (Number(ex.calories) || 0), 0);
    const sets = cumulativeExercises.reduce((s, ex) => s + (parseInt(ex.sets, 10) || 0), 0);
    return {
      kcal: Math.round(total),
      exercises: cumulativeExercises.length,
      sets
    };
  }, [cumulativeExercises]);

  // --- summary step UI ---
  if (currentStep === 3) {
    const total = cumulativeExercises.reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0);
    const shareText = `I just logged a workout on ${new Date().toLocaleDateString(
      'en-US'
    )} with Slimcal.ai: ${cumulativeExercises.length} items, ${total.toFixed(2)} cals! #SlimcalAI`;

    return (
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 4 } }}>
        <Typography variant="h4" align="center" gutterBottom sx={{ fontWeight: 800 }}>
          Workout Summary
        </Typography>
        <Divider sx={{ my: 2.5 }} />

        {cumulativeExercises.map((ex, idx) => (
          <Card
            key={idx}
            variant="outlined"
            sx={{
              mb: 1.25,
              borderRadius: 2,
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
            }}
          >
            <CardContent
              sx={{
                py: 1.1,
                px: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2
              }}
            >
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {formatExerciseLine(ex)}
              </Typography>
              <Button size="small" color="error" onClick={() => handleRemoveExercise(idx)}>
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}

        <Stack direction="row" spacing={1.25} justifyContent="center" sx={{ mt: 2 }}>
          <Chip label={`Total: ${total.toFixed(0)} kcal`} color="primary" />
          <Chip label={`${cumulativeExercises.length} exercises`} variant="outlined" />
          <Chip label={`${sessionTotals.sets} sets`} variant="outlined" />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center" sx={{ mt: 3 }}>
          <Button variant="contained" onClick={handleNewWorkout} fullWidth>
            New Session
          </Button>
          <Button variant="contained" onClick={handleShareWorkout} fullWidth>
            Share
          </Button>
          <Button variant="contained" onClick={handleFinish} fullWidth>
            Submit Workout
          </Button>
        </Stack>

        <ShareWorkoutModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          shareText={shareText}
          shareUrl={window.location.href}
        />

        {/* Help dialogs */}
        <Dialog
          open={showBackHelp}
          onClose={() =>
            handleDismiss('hasSeenBackHelp', setShowBackHelp, () => setCurrentStep(1))
          }
        >
          <DialogTitle>Go Back</DialogTitle>
          <DialogContent>Returns you to edit your inputs.</DialogContent>
          <DialogActions>
            <Button
              onClick={() =>
                handleDismiss('hasSeenBackHelp', setShowBackHelp, () => setCurrentStep(1))
              }
            >
              Got it
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showLogHelp}
          onClose={() => handleDismiss('hasSeenLogHelp', setShowLogHelp, handleFinish)}
        >
          <DialogTitle>Submit Workout</DialogTitle>
          <DialogContent>Sends you to history. Your workout is already saved.</DialogContent>
          <DialogActions>
            <Button onClick={() => handleDismiss('hasSeenLogHelp', setShowLogHelp, handleFinish)}>
              Got it
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showShareHelp}
          onClose={() =>
            handleDismiss('hasSeenShareHelp', setShowShareHelp, handleShareWorkout)
          }
        >
          <DialogTitle>Share Workout</DialogTitle>
          <DialogContent>Copy your summary to share.</DialogContent>
          <DialogActions>
            <Button
              onClick={() =>
                handleDismiss('hasSeenShareHelp', setShowShareHelp, handleShareWorkout)
              }
            >
              Got it
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showNewHelp}
          onClose={() => handleDismiss('hasSeenNewHelp', setShowNewHelp, handleNewWorkout)}
        >
          <DialogTitle>Start New Workout</DialogTitle>
          <DialogContent>Clears this session for a fresh start.</DialogContent>
          <DialogActions>
            <Button
              onClick={() =>
                handleDismiss('hasSeenNewHelp', setShowNewHelp, handleNewWorkout)
              }
            >
              Got it
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    );
  }

  // --- main UI ---
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 } }}>
      <Typography variant="h4" align="center" gutterBottom sx={{ fontWeight: 800 }}>
        Workout Tracker
      </Typography>

      {/* Slim session stats strip */}
      <Box
        sx={{
          mb: 2.5,
          display: 'flex',
          justifyContent: 'center',
          gap: 1,
          flexWrap: 'wrap'
        }}
      >
        <Chip color="primary" label={`${sessionTotals.kcal} kcal`} sx={{ fontWeight: 700 }} />
        <Chip variant="outlined" label={`${sessionTotals.exercises} exercises`} />
        <Chip variant="outlined" label={`${sessionTotals.sets} sets`} />
      </Box>

      <Grid container spacing={{ xs: 3, md: 4 }}>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            <Box>
              {!isProUser() && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                  <FeatureUseBadge featureKey="ai_workout" isPro={false} />
                </Box>
              )}
              <Button
                variant="contained"
                fullWidth
                onClick={handleSuggestAIClick}
                sx={{ fontWeight: 700 }}
              >
                Suggest a Workout (AI)
              </Button>
            </Box>

            {showSuggestCard && (
              <SuggestedWorkoutCard userData={userData} onAccept={handleAcceptSuggested} />
            )}

            <Card
              variant="outlined"
              sx={{
                borderRadius: 2,
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
              }}
            >
              <CardContent>
                <Button fullWidth variant="outlined" onClick={() => setShowTemplate(true)}>
                  Load Past Workout
                </Button>
                <Typography variant="body2" color="textSecondary" align="center" sx={{ mt: 1.25 }}>
                  Welcome! You are {userData?.age} years old and weigh {userData?.weight} lbs.
                </Typography>
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        <Grid item xs={12} md={8}>
          <Stack spacing={3}>
            {cumulativeExercises.length > 0 && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
                }}
              >
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 800 }}>
                  Current Session Logs
                </Typography>
                {cumulativeExercises.map((ex, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      mb: 1,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 2
                    }}
                  >
                    <Typography sx={{ fontWeight: 600 }}>
                      {formatExerciseLine(ex)}
                    </Typography>
                    <Button size="small" color="error" onClick={() => handleRemoveExercise(idx)}>
                      Remove
                    </Button>
                  </Box>
                ))}
              </Paper>
            )}

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
              }}
            >
              <ExerciseForm
                newExercise={newExercise}
                setNewExercise={setNewExercise}
                currentCalories={currentCalories}
                onCalculate={handleCalculate}
                onAddExercise={handleAddExercise}
                onDoneWithExercises={handleDoneWithExercises}
                exerciseOptions={exerciseOptions}
              />
            </Paper>

            <Box textAlign="center">
              <Button
                variant="contained"
                onClick={() => setShowSaunaSection(s => !s)}
              >
                {showSaunaSection ? 'Cancel Sauna Session' : 'Add Sauna Session'}
              </Button>
            </Box>

            {showSaunaSection && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
                }}
              >
                <SaunaForm
                  saunaTime={saunaTime}
                  saunaTemp={saunaTemp}
                  setSaunaTime={setSaunaTime}
                  setSaunaTemp={setSaunaTemp}
                />
                <Box sx={{ display: 'flex', gap: 2, mt: 2, justifyContent: 'center' }}>
                  <Button variant="contained" onClick={handleSaveSauna}>
                    Save Sauna
                  </Button>
                  <Button variant="contained" onClick={handleCancelSaunaForm}>
                    Cancel
                  </Button>
                </Box>
              </Paper>
            )}
          </Stack>
        </Grid>
      </Grid>

      {/* ✅ Meals-style: show today's logged workouts on-page so banner stays consistent */}
      <Paper
        variant="outlined"
        sx={{
          mt: 3,
          p: 2,
          borderRadius: 2,
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Today’s Logged Workouts
          </Typography>
          {loadingTodaySessions && (
            <Typography variant="caption" color="textSecondary">
              Syncing…
            </Typography>
          )}
        </Stack>

        {(!todaySessions || todaySessions.length === 0) ? (
          <Typography variant="body2" color="textSecondary">
            No workouts logged today yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {todaySessions.map((sess, idx) => {
              const title = sess?.name || 'Workout';
              const kcals = Math.round(safeNum(sess?.totalCalories ?? sess?.total_calories, 0));
              const hasDetails = Array.isArray(sess?.exercises) && sess.exercises.length > 0;
              return (
                <Card
                  key={sess?.client_id || sess?.id || idx}
                  variant="outlined"
                  sx={{ borderRadius: 2, border: '1px solid rgba(0,0,0,0.06)' }}
                >
                  <CardContent sx={{ py: 1.25, px: 2 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 2 }}>
                      <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
                      <Chip label={`${kcals} kcal`} color="primary" />
                    </Stack>
                    {hasDetails ? (
                      <Box sx={{ mt: 0.75 }}>
                        {sess.exercises.slice(0, 10).map((ex, i) => (
                          <Typography key={i} variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
                            {formatSessionExerciseDetail(ex)}
                          </Typography>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="caption" color="textSecondary">
                        No details yet.
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Box textAlign="center" sx={{ mt: 4 }}>
        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={handleFinish}
        >
          SUBMIT WORKOUT
        </Button>
      </Box>

      <TemplateSelector
        open={showTemplate}
        onClose={() => setShowTemplate(false)}
        onLoadTemplate={handleLoadTemplate}
      />

      <ShareWorkoutModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        shareText={`I just logged a workout on ${new Date().toLocaleDateString(
          'en-US'
        )} with Slimcal.ai: ${cumulativeExercises.length} items, ${cumulativeExercises
          .reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0)
          .toFixed(2)} cals! #SlimcalAI`}
        shareUrl={window.location.href}
      />

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI workout recommendations, AI meal suggestions, the Daily Recap Coach, and advanced insights."
      />
    </Container>
  );
}
