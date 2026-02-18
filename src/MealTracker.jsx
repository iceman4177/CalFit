// src/MealTracker.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Container,
  Typography,
  Box,
  TextField,
  Button,
  List,
  ListItem,
  ListItemText,
  Divider,
  Autocomplete,
  Alert,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Card,
  CardContent,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  MenuItem,
  Select,
  FormControl,
  InputLabel } from '@mui/material';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RestaurantIcon from '@mui/icons-material/RamenDining';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import foodData from './foodData.json';

import { ensureScopedFromLegacy, readScopedJSON, writeScopedJSON, scopedKey, KEYS } from './lib/scopedStorage.js';

import useFirstTimeTip from './hooks/useFirstTimeTip';
import { updateStreak, hydrateStreakOnStartup } from './utils/streak';

import MealSuggestion from './MealSuggestion';
import UpgradeModal from './components/UpgradeModal';
import AIFoodLookupBox from './components/AIFoodLookupBox.jsx';
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse
} from './components/FeatureUseBadge.jsx';

// auth + db
import { useAuth } from './context/AuthProvider.jsx';
import { saveMealLocalFirst, deleteMealLocalFirst, upsertDailyMetricsLocalFirst } from './lib/localFirst';
import { callAIGenerate } from './lib/ai';

// ✅ NEW: Supabase client (only used for simple “hydrate today” pulls)
import { supabase } from './lib/supabaseClient';

// ---------- Pro / gating helpers ----------
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};


// ---- local tombstones for deletions (prevents cloud re-hydrate re-adding deleted meals) ----
function deletedMealsKey(userId, dayISO) {
  const uid = userId || 'guest';
  const d = dayISO || 'today';
  return `deletedMealIds:${uid}:${d}`;
}

function readDeletedMealIds(userId, dayISO) {
  try {
    const raw = localStorage.getItem(deletedMealsKey(userId, dayISO));
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function addDeletedMealId(userId, dayISO, clientId) {
  if (!clientId) return;
  try {
    const prev = readDeletedMealIds(userId, dayISO);
    if (prev.includes(clientId)) return;
    const next = prev.concat([clientId]).slice(-500);
    localStorage.setItem(deletedMealsKey(userId, dayISO), JSON.stringify(next));
  } catch {}
}

// ---------- helpers ----------
function kcalFromMacros(p = 0, c = 0, f = 0) {
  const P = Number(p) || 0,
    C = Number(c) || 0,
    F = Number(f) || 0;
  return Math.max(0, Math.round(P * 4 + C * 4 + F * 9));
}

function pluralizeUnit(unit, qty) {
  const q = Number(qty) || 0;
  if (!unit) return '';
  if (q === 1) return unit;

  // common irregular-ish
  if (unit === 'slice') return 'slices';
  if (unit === 'clove') return 'cloves';
  if (unit === 'egg') return 'eggs';

  // units that generally shouldn't pluralize
  const noPlural = new Set(['g', 'oz', 'tbsp', 'tsp', 'cup', 'serving', 'item', 'scoop']);
  if (noPlural.has(unit)) return unit;

  return `${unit}s`;
}

function safeNumber(val, fallback = 0) {
  const n = typeof val === 'string' && val.trim() === '' ? NaN : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

// Normalize + clamp macros
function normMacro(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.round(x));
}

// Find a food item in foodData by id or name (case-insensitive)
function findFoodInData(fd, { food_id, food_name, displayName }) {
  const arr = Array.isArray(fd) ? fd : [];
  const id = String(food_id || '').trim();
  if (id) {
    const byId = arr.find(f => String(f?.id || '') === id);
    if (byId) return byId;
  }

  const nameCandidates = [food_name, displayName]
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);

  if (nameCandidates.length) {
    const lower = nameCandidates.map(s => s.toLowerCase());
    const byName = arr.find(f => {
      const fn = String(f?.name || '').toLowerCase();
      return lower.includes(fn);
    });
    if (byName) return byName;

    // softer contains match (last resort)
    const soft = arr.find(f => {
      const fn = String(f?.name || '').toLowerCase();
      return lower.some(x => x.includes(fn) || fn.includes(x));
    });
    if (soft) return soft;
  }

  return null;
}

function findPortion(food, portion_id) {
  const portions = Array.isArray(food?.portions) ? food.portions : [];
  if (!portions.length) return null;
  const pid = String(portion_id || '').trim();
  if (pid) {
    const p = portions.find(x => String(x?.id || '') === pid);
    if (p) return p;
  }
  return portions[0] || null;
}

/**
 * Hydrate macros from foodData.json (per portion) and scale by qty.
 * Expects portion macros fields:
 *   protein_g, carbs_g, fat_g  (numbers per 1 portion)
 */
function getMacrosForEntry(fd, { macros, meta, name }) {
  // If macros were already provided and non-zero-ish, respect them.
  const p0 = Number(macros?.protein_g);
  const c0 = Number(macros?.carbs_g);
  const f0 = Number(macros?.fat_g);
  const hasProvided = Number.isFinite(p0) || Number.isFinite(c0) || Number.isFinite(f0);

  if (hasProvided) {
    return {
      protein_g: normMacro(p0),
      carbs_g: normMacro(c0),
      fat_g: normMacro(f0)
    };
  }

  const qty = safeNumber(meta?.qty ?? 1, 1);
  const food = findFoodInData(fd, {
    food_id: meta?.food_id,
    food_name: meta?.food_name,
    displayName: name
  });
  if (!food) return null;

  const portion = findPortion(food, meta?.portion_id);
  if (!portion) return null;

  const P = normMacro((Number(portion?.protein_g) || 0) * qty);
  const C = normMacro((Number(portion?.carbs_g) || 0) * qty);
  const F = normMacro((Number(portion?.fat_g) || 0) * qty);

  // If your foodData doesn't yet have macros for some items, don't force 0s into UI.
  const any = P > 0 || C > 0 || F > 0;
  if (!any) return null;

  return { protein_g: P, carbs_g: C, fat_g: F };
}

// ✅ NEW: local midnight → tomorrow midnight range (so “today” matches user timezone)
function getTodayRangeISOLocal() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

// ---------- Dialogs ----------
function CustomNutritionDialog({ open, onClose, onConfirm }) {
  const [name, setName] = useState('');
  const [cal, setCal] = useState('');
  const [p, setP] = useState('');
  const [c, setC] = useState('');
  const [f, setF] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setCal('');
      setP('');
      setC('');
      setF('');
    }
  }, [open]);

  const effectiveCalories = useMemo(() => {
    if (String(cal).trim() !== '') {
      return Math.max(0, parseInt(cal, 10) || 0);
    }
    if (p || c || f) {
      return kcalFromMacros(p, c, f);
    }
    return 0;
  }, [cal, p, c, f]);

  const canSave = name.trim().length > 0 && effectiveCalories > 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Custom Food</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField label="Food name" fullWidth value={name} onChange={e => setName(e.target.value)} />
          <TextField
            label="Calories (kcal)"
            type="number"
            fullWidth
            value={cal}
            onChange={e => setCal(e.target.value)}
          />
          <Typography variant="caption" color="text.secondary">
            Or enter macros (we’ll calculate calories if Calories is blank)
          </Typography>
          <Stack direction="row" spacing={1.5}>
            <TextField label="Protein (g)" type="number" fullWidth value={p} onChange={e => setP(e.target.value)} />
            <TextField label="Carbs (g)" type="number" fullWidth value={c} onChange={e => setC(e.target.value)} />
            <TextField label="Fat (g)" type="number" fullWidth value={f} onChange={e => setF(e.target.value)} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Total calories: <strong>{effectiveCalories}</strong>
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!canSave}
          onClick={() => {
            onConfirm?.({
              name: name.trim(),
              calories: effectiveCalories,
              macros: {
                protein_g: Number(p) || 0,
                carbs_g: Number(c) || 0,
                fat_g: Number(f) || 0
              }
            });
            onClose?.();
          }}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function BuildBowlDialog({ open, onClose, onConfirm }) {
  const [rows, setRows] = useState([{ name: '', calories: '' }]);

  useEffect(() => {
    if (open) setRows([{ name: '', calories: '' }]);
  }, [open]);

  const addRow = () => setRows(prev => [...prev, { name: '', calories: '' }]);
  const update = (i, key, val) =>
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const remove = i => setRows(prev => prev.filter((_, idx) => idx !== i));

  const total = useMemo(
    () => rows.reduce((s, r) => s + (parseInt(r.calories, 10) || 0), 0),
    [rows]
  );

  const hasValid = rows.every(
    r => r.name.trim().length > 0 && (parseInt(r.calories, 10) || 0) > 0
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Build a Bowl</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Add each ingredient separately for accurate tracking.
        </Typography>
        <Stack spacing={1.25} sx={{ mt: 1 }}>
          {rows.map((r, i) => (
            <Stack key={i} direction="row" spacing={1}>
              <TextField
                label={`Ingredient ${i + 1}`}
                value={r.name}
                onChange={e => update(i, 'name', e.target.value)}
                fullWidth
              />
              <TextField
                label="Calories"
                type="number"
                value={r.calories}
                onChange={e => update(i, 'calories', e.target.value)}
                sx={{ width: 140 }}
              />
              <IconButton aria-label="remove" onClick={() => remove(i)} disabled={rows.length === 1}>
                <DeleteIcon />
              </IconButton>
            </Stack>
          ))}
          <Button onClick={addRow} startIcon={<AddCircleOutlineIcon />}>
            Add Ingredient
          </Button>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Bowl total: <strong>{total}</strong> kcal
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!hasValid || total <= 0}
          onClick={() => {
            const pretty = rows.map(r => r.name.trim()).filter(Boolean).join(', ');
            onConfirm?.({ name: `Bowl: ${pretty}`, calories: total });
            onClose?.();
          }}
        >
          Add Bowl
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------- Main ----------
export default function MealTracker({ onMealUpdate }) {
  // onboarding tips
  const [FoodTip, triggerFoodTip] = useFirstTimeTip('tip_food', 'Search or type a food name.');
  const [CalTip, triggerCalTip] = useFirstTimeTip('tip_cal', 'Enter calories.');
  const [AddTip, triggerAddTip] = useFirstTimeTip('tip_add', 'Tap to add this meal.');
  const [ClearTip, triggerClearTip] = useFirstTimeTip('tip_clear', 'Tap to clear today’s meals.');

  // manual entry state
  const [foodInput, setFoodInput] = useState('');
  const [selectedFood, setSelectedFood] = useState(null);

  const [selectedPortionId, setSelectedPortionId] = useState('');
  const [qty, setQty] = useState('1');

  const [calories, setCalories] = useState('');
  const [caloriesManualOverride, setCaloriesManualOverride] = useState(false);

  // logged meals
  const [mealLog, setMealLog] = useState([]);

  // AI panel state
  const [showSuggest, setShowSuggest] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // dialogs
  const [openCustom, setOpenCustom] = useState(false);
  const [openBowl, setOpenBowl] = useState(false);

  const { user } = useAuth();

  // --- User-scoped local caches (prevents cross-account contamination on same device) ---
  const userId = user?.id || null;

  const readMealHistory = useCallback(() => {
    try {
      ensureScopedFromLegacy(KEYS.mealHistory, userId);
      const list = readScopedJSON(KEYS.mealHistory, userId, []);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }, [userId]);

  const writeMealHistory = useCallback((list) => {
    try {
      ensureScopedFromLegacy(KEYS.mealHistory, userId);
      writeScopedJSON(KEYS.mealHistory, userId, Array.isArray(list) ? list : []);
    } catch {}
  }, [userId]);


  // smooth scroll target for suggestions on mobile
  const suggestRef = useRef(null);

  // canonical "today"
  const now = new Date();
  const todayUS = now.toLocaleDateString('en-US');
  const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);

  // streak + initial data load
  useEffect(() => {
    hydrateStreakOnStartup();
  }, []);

  // ------------ persistence helpers ------------
  const persistToday = meals => {
    const rest = readMealHistory().filter(e => e.date !== todayUS);
    rest.push({ date: todayUS, meals });
    writeMealHistory(rest);
  };

  const emitConsumed = total => {
    try {
      window.dispatchEvent(
        new CustomEvent('slimcal:consumed:update', { detail: { date: todayISO, consumed: total } })
      );
    } catch {}
  };

  const emitBurned = total => {
    try {
      // Avoid flicker: if computed total is 0 but we already have a non-zero local burnedToday, prefer local.
      let out = total;
      try {
        const k = scopedKey('burnedToday', userId);
        const local = Number(localStorage.getItem(k) || localStorage.getItem('burnedToday') || 0) || 0;
        if ((Number(out) || 0) === 0 && local > 0) out = local;
      } catch {}
      window.dispatchEvent(
        new CustomEvent('slimcal:burned:update', { detail: { date: todayISO, burned: out } })
      );
    } catch {}
  };

  const getBurnedTodayLocal = dateUS => {
    try {
      ensureScopedFromLegacy(KEYS.workoutHistory, userId);
      const all = readScopedJSON(KEYS.workoutHistory, userId, []) || [];
      // Your workoutHistory can have multiple workouts per day, so SUM them
      return (Array.isArray(all) ? all : [])
        .filter(e => e.date === dateUS)
        .reduce((s, w) => s + (Number(w?.totalCalories ?? w?.total_calories) || 0), 0);
    } catch {
      return 0;
    }
  };

  const syncDailyMetrics = async consumedTotal => {
    const burned = getBurnedTodayLocal(todayUS);

    try {
      ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
      const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {}) || {};
      cache[todayISO] = {
        ...(cache[todayISO] || {}),
        burned,
        consumed: consumedTotal,
        net: consumedTotal - burned,
        updated_at: new Date().toISOString(),
      };
      writeScopedJSON(KEYS.dailyMetricsCache, userId, cache);

      // Convenience keys (also scoped) for legacy readers
      localStorage.setItem(scopedKey('consumedToday', userId), String(consumedTotal));
      localStorage.setItem(scopedKey('burnedToday', userId), String(burned));
    } catch {}

    emitConsumed(consumedTotal);
    emitBurned(burned);

    try {
      if (user?.id) {
        await upsertDailyMetricsLocalFirst({
          user_id: user.id,
          local_day: todayISO,
          calories_eaten: consumedTotal,
          calories_burned: burned,
          net_calories: consumedTotal - burned
        });
      }
    } catch (err) {
      console.error('[MealTracker] upsertDailyMetrics failed', err);
    }
  };

  const saveDay = meals => {
    persistToday(meals);
    const total = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
    onMealUpdate?.(total);
    syncDailyMetrics(total);
  };

  // ✅ IMPORTANT FIX: when signed in on a NEW device, pull TODAY from Supabase
  // and write it into the same local caches your banner already reads.
  useEffect(() => {
    let ignore = false;

    // First: local load (keeps your existing behavior)
    const all = readMealHistory();
    const todayLog = all.find(e => e.date === todayUS);
    const meals = todayLog ? todayLog.meals || [] : [];

    setMealLog(meals);

    const totalInit = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
    onMealUpdate?.(totalInit);

    // Then: if logged in, hydrate from cloud → local
    (async () => {
      if (!user?.id || !supabase) return;

      try {
        const { startIso, endIso } = getTodayRangeISOLocal();

        // 1) Pull TODAY meals from cloud
        const mealsRes = await supabase
          .from('meals')
          .select('client_id,title,total_calories,eaten_at,protein_g,carbs_g,fat_g,food_id,portion_id,portion_label,qty,unit')
          .eq('user_id', user.id)
          .gte('eaten_at', startIso)
          .lt('eaten_at', endIso)
          .order('eaten_at', { ascending: true });

        if (mealsRes?.error) {
          console.warn('[MealTracker] cloud meals fetch error', mealsRes.error);
        }

        const cloudMealsRaw = Array.isArray(mealsRes?.data) ? mealsRes.data : [];

        // Normalize into your local shape
        const cloudMeals = cloudMealsRaw.map((m) => {
          const cid =
            m?.client_id ||
            `cloud_${String(m?.eaten_at || '')}_${String(m?.title || '')}_${String(m?.total_calories || '')}`;
          return {
            client_id: cid,
            name: m?.title || 'Meal',
            calories: Number(m?.total_calories) || 0,

            // ✅ macros + meta (when available) so cross-device rings + checklist are accurate
            protein_g: Number(m?.protein_g) || 0,
            carbs_g: Number(m?.carbs_g) || 0,
            fat_g: Number(m?.fat_g) || 0,

            food_id: m?.food_id ?? null,
            portion_id: m?.portion_id ?? null,
            portion_label: m?.portion_label ?? null,
            qty: m?.qty ?? 1,
            unit: m?.unit ?? 'serving',

            createdAt: m?.eaten_at || new Date().toISOString()
          };
        });

        // Respect local deletions (tombstones) so hydration never resurrects removed meals
        const deletedIds = readDeletedMealIds(user.id, todayISO);
        const deletedSet = new Set(deletedIds);
        const cloudMealsFiltered = deletedIds.length ? cloudMeals.filter((m) => !deletedSet.has(String(m?.client_id || ''))) : cloudMeals;


        // 2) Merge into local without duplicates (client_id is the idempotent key)
        const mergedMap = new Map();
        for (const lm of meals || []) {
          const cid = lm?.client_id || `local_${lm?.name || ''}_${lm?.createdAt || ''}_${lm?.calories || 0}`;
          if (deletedSet?.has?.(String(cid))) continue;
          mergedMap.set(cid, { ...lm, client_id: cid });
        }
        for (const cm of cloudMealsFiltered) {
          if (deletedSet?.has?.(String(cm?.client_id || ''))) continue;
          if (!mergedMap.has(cm.client_id)) mergedMap.set(cm.client_id, cm);
        }

        const merged = Array.from(mergedMap.values());

        // 3) Persist merged into the SAME local history store
        persistToday(merged);

        // 4) Update UI totals immediately
        const consumedTotal = merged.reduce((s, m) => s + (Number(m.calories) || 0), 0);

        if (!ignore) {
          setMealLog(merged);
          onMealUpdate?.(consumedTotal);
          emitConsumed(consumedTotal);
        }

        // 5) Pull TODAY workouts burned (so banner & net calories are correct on new device)
        const workoutsRes = await supabase
          .from('workouts')
          .select('total_calories,started_at,ended_at')
          .eq('user_id', user.id)
          .gte('started_at', startIso)
          .lt('started_at', endIso);

        let burnedToday = 0;
        if (!workoutsRes?.error && Array.isArray(workoutsRes?.data)) {
          burnedToday = workoutsRes.data.reduce((s, w) => s + (Number(w?.total_calories) || 0), 0);
        }

        if (!ignore) emitBurned(burnedToday);

        // 6) Write dailyMetricsCache in the exact keys your UI reads
        try {
          const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
          cache[todayISO] = {
            burned: burnedToday,
            consumed: consumedTotal,
            net: consumedTotal - burnedToday,
            calories_burned: burnedToday,
            calories_eaten: consumedTotal,
            net_calories: consumedTotal - burnedToday,
            updated_at: new Date().toISOString()
          };
          localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
        } catch {}

        // 7) Also upsert via local-first so it stays consistent everywhere
        try {
          await upsertDailyMetricsLocalFirst({
            user_id: user.id,
            local_day: todayISO,
            calories_eaten: consumedTotal,
            calories_burned: burnedToday,
            net_calories: consumedTotal - burnedToday
          });
        } catch (e) {
          console.warn('[MealTracker] upsertDailyMetricsLocalFirst hydrate failed', e);
        }
      } catch (err) {
        console.warn('[MealTracker] hydrate today from cloud failed', err);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [onMealUpdate, todayUS, todayISO, user?.id]);

  // Helpers for selected food/portion
  const portions = useMemo(() => {
    return Array.isArray(selectedFood?.portions) ? selectedFood.portions : [];
  }, [selectedFood]);

  const selectedPortion = useMemo(() => {
    if (!portions.length) return null;
    const found = portions.find(p => String(p.id) === String(selectedPortionId));
    return found || portions[0] || null;
  }, [portions, selectedPortionId]);

  const autoCalories = useMemo(() => {
    if (!selectedFood || !selectedPortion) return null;
    const q = safeNumber(qty, 0);
    const per = safeNumber(selectedPortion.calories, 0);
    if (q <= 0 || per <= 0) return 0;
    return Math.round(q * per);
  }, [selectedFood, selectedPortion, qty]);

  // When food/portion/qty changes, update calories unless user overrode it manually
  useEffect(() => {
    if (!selectedFood || !selectedPortion) return;
    if (caloriesManualOverride) return;
    if (autoCalories == null) return;
    setCalories(String(autoCalories));
  }, [selectedFood, selectedPortion, qty, autoCalories, caloriesManualOverride]);

  // core logger for any meal object (local + optional cloud)
  const logOne = async ({ name, calories, macros, meta }) => {
    const baseCalories = Math.max(0, Number(calories) || 0);

    // ✅ If macros missing, hydrate from foodData using meta or name
    const hydrated = getMacrosForEntry(foodData, { macros, meta, name });

    const finalMacros =
      hydrated ||
      (macros
        ? {
            protein_g: normMacro(macros?.protein_g),
            carbs_g: normMacro(macros?.carbs_g),
            fat_g: normMacro(macros?.fat_g)
          }
        : null);

    const safe = {
      client_id:
        (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `meal_${Date.now()}_${Math.random().toString(16).slice(2)}`,

      name,
      calories: baseCalories,

      // Persist macros locally when available so totals + recap are correct (even offline / no account)
      protein_g: finalMacros ? finalMacros.protein_g : undefined,
      carbs_g: finalMacros ? finalMacros.carbs_g : undefined,
      fat_g: finalMacros ? finalMacros.fat_g : undefined,

      createdAt: new Date().toISOString(),
      ...(meta || {})
    };

    setMealLog(prev => {
      const upd = [...prev, safe];
      saveDay(upd);
      return upd;
    });

    updateStreak();

    try {
      if (user?.id) {
        const eatenISO = new Date().toISOString();

        // Build one "meal item" line with qty/unit if present
        const qtyNum = meta?.qty != null ? Number(meta.qty) : 1;
        const unitStr = meta?.unit || 'serving';

        await saveMealLocalFirst({
          user_id: user.id,
          client_id: safe.client_id,
          eaten_at: eatenISO,
          title: safe.name,
          total_calories: safe.calories,
          __day: todayUS,

          // Preserve any optional macro/meta info for local UI + future hydration
          protein_g: finalMacros?.protein_g ?? safe.protein_g ?? null,
          carbs_g: finalMacros?.carbs_g ?? safe.carbs_g ?? null,
          fat_g: finalMacros?.fat_g ?? safe.fat_g ?? null,

          food_id: meta?.food_id ?? null,
          portion_id: meta?.portion_id ?? null,
          portion_label: meta?.portion_label ?? null,
          qty: Number.isFinite(qtyNum) ? qtyNum : 1,
          unit: unitStr,
          food_name: meta?.food_name || safe.name
        });
      }
    } catch (err) {
      console.error('[MealTracker] cloud save failed', err);
    }
  };

  // manual "Add Meal" button
  const handleAdd = async () => {
    const nameText = foodInput.trim();

    // Structured path: selectedFood + portion + qty
    if (selectedFood && selectedPortion) {
      const q = safeNumber(qty, 0);
      if (!Number.isFinite(q) || q <= 0) {
        alert('Enter a valid quantity.');
        return;
      }

      const c = safeNumber(calories, NaN);
      if (!Number.isFinite(c) || c <= 0) {
        alert('Calories must be greater than 0.');
        return;
      }

      const unit = selectedPortion.unit || 'serving';
      const unitPretty = pluralizeUnit(unit, q);

      // Nice display name: "Eggs — 6 eggs (1 large egg)"
      const displayName = `${selectedFood.name} — ${q} ${unitPretty} (${selectedPortion.label})`;

      await logOne({
        name: displayName,
        calories: c,
        macros: {
          protein_g:
            selectedPortion.protein_g != null ? Number(selectedPortion.protein_g) * q : undefined,
          carbs_g:
            selectedPortion.carbs_g != null ? Number(selectedPortion.carbs_g) * q : undefined,
          fat_g: selectedPortion.fat_g != null ? Number(selectedPortion.fat_g) * q : undefined
        },
        meta: {
          food_id: selectedFood.id,
          portion_id: selectedPortion.id,
          portion_label: selectedPortion.label,
          qty: q,
          unit,
          food_name: selectedFood.name
        }
      });

      setFoodInput('');
      setSelectedFood(null);
      setSelectedPortionId('');
      setQty('1');
      setCalories('');
      setCaloriesManualOverride(false);
      return;
    }

    // Legacy/freeSolo path: requires manual calories
    const c = Number.parseInt(calories, 10);
    if (!nameText || !Number.isFinite(c) || c <= 0) {
      alert('Enter a valid food & calories.');
      return;
    }

    await logOne({ name: nameText, calories: c });

    setFoodInput('');
    setCalories('');
    setSelectedFood(null);
    setSelectedPortionId('');
    setQty('1');
    setCaloriesManualOverride(false);
  };

  const handleDeleteMeal = (index) => {
    const row = mealLog?.[index];
    const cid = row?.client_id || null;

    // 1) Optimistic local remove (UI updates instantly)
    setMealLog((prev) => {
      const updated = (Array.isArray(prev) ? prev : []).filter((_, i) => i !== index);
      saveDay(updated);
      return updated;
    });

    // 2) Tombstone so cloud hydration can't re-add it for today
    if (cid) addDeletedMealId(user?.id || null, todayISO, cid);

    // 3) If signed in, delete from cloud (or queue delete op offline)
    (async () => {
      try {
        if (user?.id && cid) {
          await deleteMealLocalFirst({ user_id: user.id, client_id: cid });
        }
      } catch (e) {
        console.warn('[MealTracker] deleteMealLocalFirst failed', e);
      }
    })();
  };

  const handleClear = () => {
    const rest = readMealHistory().filter(e => e.date !== todayUS);
    writeMealHistory(rest);
    setMealLog([]);
    onMealUpdate?.(0);
    syncDailyMetrics(0);
  };

  // toggle meal ideas panel — identity-aware probe to avoid false 402s
  const handleToggleMealIdeas = useCallback(async () => {
    if (showSuggest) {
      setShowSuggest(false);
      return;
    }

    // Local free-limit gate (server-side 402 still acts as backup)
    if (!isProUser() && !canUseDailyFeature('ai_meal')) {
      setShowUpgrade(true);
      return;
    }

    try {
      const dietPreference = localStorage.getItem('diet_preference') || 'omnivore';
      const trainingIntent = localStorage.getItem('training_intent') || 'general';
      const proteinMealG = parseInt(localStorage.getItem('protein_target_meal_g') || '0', 10);
      const calorieBias = parseInt(localStorage.getItem('calorie_bias') || '0', 10);

      await callAIGenerate({
        feature: 'meal',
        user_id: user?.id || null,
        constraints: {
          diet_preference: dietPreference,
          training_intent: trainingIntent,
          protein_per_meal_g: proteinMealG || undefined,
          calorie_bias: calorieBias || undefined
        },
        count: 1
      });
    } catch (e) {
      if (e?.code === 402) {
        setShowUpgrade(true);
        return;
      }
      console.warn('[MealTracker] gateway probe failed', e);
    }

    if (!isProUser()) {
      registerDailyFeatureUse('ai_meal');
    }

    setShowSuggest(true);

    setTimeout(() => {
      try {
        suggestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {}
    }, 50);
  }, [showSuggest, user?.id]);

  const total = mealLog.reduce((s, m) => s + (Number(m.calories) || 0), 0);

  // Autocomplete options: foods only (portions handled separately)
  const options = useMemo(() => (Array.isArray(foodData) ? foodData.filter(f => !f.action) : []), []);

  // Handle special custom action row (kept as a "pseudo option" below)
  const customAction = useMemo(() => {
    return Array.isArray(foodData) ? foodData.find(f => f.action === 'open_custom_nutrition') : null;
  }, []);

  return (
    <Container
      maxWidth="sm"
      sx={{
        py: { xs: 2, md: 4 },
        display: 'flex',
        flexDirection: 'column',
        gap: 3
      }}
    >
      <FoodTip />
      <CalTip />
      <AddTip />
      <ClearTip />

      {/* ------------------- HERO: Title + Single AI CTA ------------------- */}
      <Card
        sx={{
          borderRadius: 3,
          overflow: 'visible', // ✅ critical: allow the top-right badge to render fully
          boxShadow: '0 24px 60px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)'
        }}
      >
        <CardContent
          sx={{
            pb: 2,
            pt: 2,
            overflow: 'visible'
          }}
        >
          {!isProUser() && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
              <FeatureUseBadge featureKey="ai_meal" isPro={false} />
            </Box>
          )}

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                Meals
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Log foods and keep your net calories up to date.
              </Typography>
            </Box>

            <Button
              onClick={handleToggleMealIdeas}
              variant={showSuggest ? 'outlined' : 'contained'}
              startIcon={<SmartToyOutlinedIcon />}
              size="large"
              sx={{ fontWeight: 700, borderRadius: 999 }}
            >
              {showSuggest ? 'Hide AI Meals' : 'AI Suggest a Meal'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* ------------------- ACCORDION: Quick Actions ------------------- */}
      <Accordion disableGutters sx={{ overflow: 'visible' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ overflow: 'visible' }}>
          <Typography sx={{ fontWeight: 700 }}>Quick Actions</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ overflow: 'visible' }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button
              onClick={() => setOpenCustom(true)}
              startIcon={<AddCircleOutlineIcon />}
              variant="outlined"
              size="small"
              sx={{
                flexGrow: 1,
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 999,
                px: 2
              }}
            >
              Custom Food
            </Button>
            <Button
              onClick={() => setOpenBowl(true)}
              startIcon={<RestaurantIcon />}
              variant="outlined"
              size="small"
              sx={{
                flexGrow: 1,
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 999,
                px: 2
              }}
            >
              Build a Bowl
            </Button>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* ------------------- ACCORDION: Manual Entry (default open) ------------------- */}
      <Accordion defaultExpanded disableGutters sx={{ overflow: 'visible' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ overflow: 'visible' }}>
          <Typography sx={{ fontWeight: 700 }}>Manual Entry</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ overflow: 'visible' }}>
          <Box sx={{ mb: 2 }}>
            <Autocomplete
              freeSolo
              options={options}
              getOptionLabel={o => (typeof o === 'string' ? o : o?.name || '')}
              value={selectedFood}
              inputValue={foodInput}
              onChange={(_, v) => {
                // If user types freeSolo string
                if (!v) {
                  setSelectedFood(null);
                  setSelectedPortionId('');
                  setQty('1');
                  setCalories('');
                  setCaloriesManualOverride(false);
                  return;
                }

                if (typeof v === 'string') {
                  setSelectedFood(null);
                  setFoodInput(v);
                  setSelectedPortionId('');
                  setQty('1');
                  setCaloriesManualOverride(false);
                  return;
                }

                // Selected structured food
                setSelectedFood(v);
                setFoodInput(v.name);

                const firstPortion =
                  Array.isArray(v.portions) && v.portions.length ? v.portions[0] : null;
                setSelectedPortionId(firstPortion?.id ? String(firstPortion.id) : '');
                setQty('1');
                setCaloriesManualOverride(false);

                if (firstPortion?.calories != null) {
                  setCalories(String(Math.round(Number(firstPortion.calories) || 0)));
                } else {
                  setCalories('');
                }
              }}
              onInputChange={(_, v) => {
                setFoodInput(v);
                // If user starts typing, treat it as freeSolo unless they re-select an option
                if (!selectedFood) return;
                if (v !== selectedFood?.name) {
                  setSelectedFood(null);
                  setSelectedPortionId('');
                  setQty('1');
                  setCaloriesManualOverride(false);
                }
              }}
              renderInput={params => (
                <TextField {...params} label="Food Name" fullWidth onFocus={triggerFoodTip} />
              )}
            />

            {/* Portion + Quantity only if a structured food is selected */}
            {selectedFood && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="portion-label">Portion</InputLabel>
                  <Select
                    labelId="portion-label"
                    label="Portion"
                    value={selectedPortionId || (portions[0]?.id ? String(portions[0].id) : '')}
                    onChange={e => {
                      setSelectedPortionId(String(e.target.value || ''));
                      setCaloriesManualOverride(false);
                    }}
                  >
                    {portions.map(p => (
                      <MenuItem key={String(p.id)} value={String(p.id)}>
                        {p.label} — {Number(p.calories) || 0} kcal
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  label="Quantity"
                  type="number"
                  fullWidth
                  value={qty}
                  onChange={e => {
                    setQty(e.target.value);
                    setCaloriesManualOverride(false);
                  }}
                  inputProps={{ min: 0, step: 1 }}
                />
              </Stack>
            )}

            <TextField
              label="Calories"
              type="number"
              fullWidth
              sx={{ mt: 2 }}
              value={calories}
              onFocus={triggerCalTip}
              onChange={e => {
                setCalories(e.target.value);
                // Mark manual override only if a structured food is selected
                if (selectedFood) setCaloriesManualOverride(true);
              }}
              helperText={
                selectedFood && selectedPortion ? `Auto: ${autoCalories ?? 0} kcal (edit to override)` : ''
              }
            />

            {/* Provide a quick "Custom Food" action hint */}
            {!selectedFood && foodInput.length > 2 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Not found — enter calories manually or use Quick Actions.
              </Alert>
            )}

            {/* Explicit custom item button (keeps old behavior but cleaner) */}
            {customAction && (
              <Button onClick={() => setOpenCustom(true)} variant="text" sx={{ mt: 1, textTransform: 'none', fontWeight: 600 }}>
                + Custom Food (macros)
              </Button>
            )}
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              rowGap: 1.5,
              columnGap: 2,
              justifyContent: { xs: 'flex-start', sm: 'space-between' }
            }}
          >
            <Button
              variant="contained"
              sx={{ minWidth: 120, fontWeight: 600 }}
              onClick={() => {
                triggerAddTip();
                handleAdd();
              }}
            >
              Add Meal
            </Button>

            <Button
              variant="text"
              color="error"
              sx={{ fontWeight: 500, minWidth: 120 }}
              onClick={() => {
                triggerClearTip();
                handleClear();
              }}
            >
              Clear Meals
            </Button>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* ------------------- ACCORDION: AI Assist (open) ------------------- */}
      <Accordion defaultExpanded disableGutters ref={suggestRef} sx={{ overflow: 'visible' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ overflow: 'visible' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 700 }}>AI Assist</Typography>
            <Chip size="small" color="primary" label="BETA" sx={{ fontWeight: 500, height: 20 }} />
          </Box>
        </AccordionSummary>

        <AccordionDetails sx={{ overflow: 'visible' }}>
          {!isProUser() && (
            <Box
              sx={{
                position: 'relative',
                mb: 1,
                overflow: 'visible',
                pt: 2 // ✅ creates room so the absolute badge can't clip in this section either
              }}
            >
              <FeatureUseBadge
                featureKey="ai_food_lookup"
                isPro={false}
                sx={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  zIndex: 3,
                  pointerEvents: 'none'
                }}
              />
            </Box>
          )}

          <AIFoodLookupBox
            canUseLookup={() => isProUser() || canUseDailyFeature('ai_food_lookup')}
            registerLookupUse={() => {
              if (!isProUser()) registerDailyFeatureUse('ai_food_lookup');
            }}
            onAddFood={payload => {
              logOne({
                name: payload.name,
                calories: payload.calories,
                macros: {
                  protein_g: payload.protein_g,
                  carbs_g: payload.carbs_g,
                  fat_g: payload.fat_g
                },
                meta: {
                  food_id: payload.food_id,
                  portion_id: payload.portion_id,
                  qty: payload.qty,
                  unit: payload.unit,
                  food_name: payload.food_name || payload.name
                }
              });
            }}
          />

          {showSuggest && (
            <Box sx={{ mt: 2 }}>
              <MealSuggestion
                consumedCalories={total}
                onAddMeal={async meal => {
                  const safeCalories = Number.isFinite(meal.calories) ? Number(meal.calories) : 0;
                  await logOne({ name: meal.name, calories: safeCalories });
                }}
              />
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* ------------------- ACCORDION: Logged Meals (open) ------------------- */}
      <Accordion defaultExpanded disableGutters sx={{ overflow: 'visible' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ overflow: 'visible' }}>
          <Typography sx={{ fontWeight: 700 }}>Meals Logged Today ({todayUS})</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ overflow: 'visible' }}>
          {mealLog.length === 0 ? (
            <Typography color="text.secondary">No meals added yet.</Typography>
          ) : (
            <>
              <List
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: '1px solid rgba(0,0,0,0.05)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.03), 0 2px 8px rgba(0,0,0,0.02)'
                }}
              >
                {mealLog.map((m, i) => (
                  <Box key={`${m.name}-${i}`}>
                    <ListItem
                      secondaryAction={
                        
                          <IconButton edge="end" aria-label="delete meal" onClick={() => handleDeleteMeal(i)} size="small">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        
                      }
                    >
                      <ListItemText
                        primary={<Typography fontWeight={500}>{m.name}</Typography>}
                        secondary={
                          <>
                            <span>{Number(m.calories) || 0} cals</span>
                            {((Number(m.protein_g) || 0) + (Number(m.carbs_g) || 0) + (Number(m.fat_g) || 0)) > 0 && (
                              <span>{` • P ${Number(m.protein_g) || 0}g • C ${Number(m.carbs_g) || 0}g • F ${Number(m.fat_g) || 0}g`}</span>
                            )}
                          </>
                        }
                      />
                    </ListItem>
                    {i < mealLog.length - 1 && <Divider />}
                  </Box>
                ))}
              </List>

              <Typography variant="h6" align="right" sx={{ mt: 2, fontWeight: 600 }}>
                Total Calories: {total}
              </Typography>

              <Typography variant="body2" align="right" sx={{ mt: 0.5, color: 'text.secondary' }}>
                Totals — P {mealLog.reduce((s, m) => s + (Number(m.protein_g) || 0), 0)}g • C{' '}
                {mealLog.reduce((s, m) => s + (Number(m.carbs_g) || 0), 0)}g • F{' '}
                {mealLog.reduce((s, m) => s + (Number(m.fat_g) || 0), 0)}g
              </Typography>
            </>
          )}
        </AccordionDetails>
      </Accordion>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI meal suggestions, unlimited AI workouts, Daily Recap Coach, AI Food Lookup without limits, and advanced insights."
      />

      <CustomNutritionDialog open={openCustom} onClose={() => setOpenCustom(false)} onConfirm={item => logOne(item)} />
      <BuildBowlDialog open={openBowl} onClose={() => setOpenBowl(false)} onConfirm={item => logOne(item)} />
    </Container>
  );
}