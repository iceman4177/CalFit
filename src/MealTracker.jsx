// src/MealTracker.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Container,
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
  Tooltip,
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
  InputLabel
} from '@mui/material';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RestaurantIcon from '@mui/icons-material/RamenDining';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import foodData from './foodData.json';

import useFirstTimeTip from './hooks/useFirstTimeTip';
import { updateStreak, hydrateStreakOnStartup } from './utils/streak';

import MealSuggestion from './MealSuggestion';
import UpgradeModal from './components/UpgradeModal';
import AIFoodLookupBox from './components/AIFoodLookupBox.jsx';

// auth + db
import { useAuth } from './context/AuthProvider.jsx';
import { saveMeal, upsertDailyMetrics } from './lib/db';
import { callAIGenerate } from './lib/ai';

// ---------- Pro / gating helpers ----------
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};

const getMealAICount = () => parseInt(localStorage.getItem('aiMealCount') || '0', 10);
const incMealAICount = () => localStorage.setItem('aiMealCount', String(getMealAICount() + 1));

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

  if (unit === 'slice') return 'slices';
  if (unit === 'clove') return 'cloves';
  if (unit === 'egg') return 'eggs';

  const noPlural = new Set(['g', 'oz', 'tbsp', 'tsp', 'cup', 'serving', 'item', 'scoop']);
  if (noPlural.has(unit)) return unit;

  return `${unit}s`;
}

function safeNumber(val, fallback = 0) {
  const n = typeof val === 'string' && val.trim() === '' ? NaN : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function fmt0(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x);
}

// Pull qty from the display string if needed: "Eggs — 6 eggs (1 large egg)"
function parseQtyFromName(name) {
  try {
    if (!name || typeof name !== 'string') return null;
    const m = name.match(/—\s*([0-9]+(?:\.[0-9]+)?)\s+/);
    if (!m) return null;
    const q = Number(m[1]);
    return Number.isFinite(q) ? q : null;
  } catch {
    return null;
  }
}

// Try match food by id first, else by name prefix "Eggs — ..."
function findFoodForMeal(meal, foods) {
  if (!meal) return null;

  const foodId = meal.food_id || meal.foodId || meal.foodID || null;
  if (foodId) {
    const byId = foods.find(f => String(f.id) === String(foodId));
    if (byId) return byId;
  }

  // fallback by name prefix (before " —")
  const rawName = typeof meal.name === 'string' ? meal.name : '';
  const prefix = rawName.split('—')[0]?.trim();
  if (!prefix) return null;

  const byName = foods.find(f => String(f.name).toLowerCase() === String(prefix).toLowerCase());
  return byName || null;
}

function findPortionForMeal(meal, food) {
  if (!food || !Array.isArray(food.portions)) return null;
  const pid = meal.portion_id || meal.portionId || null;
  if (pid) {
    const byId = food.portions.find(p => String(p.id) === String(pid));
    if (byId) return byId;
  }
  return null;
}

// read macros from portion in a flexible way
function getPortionMacros(portion) {
  if (!portion) return null;

  // preferred
  if (portion.macros && typeof portion.macros === 'object') {
    const p = portion.macros.protein_g ?? portion.macros.protein ?? 0;
    const c = portion.macros.carbs_g ?? portion.macros.carbs ?? 0;
    const f = portion.macros.fat_g ?? portion.macros.fat ?? 0;
    return { protein_g: Number(p) || 0, carbs_g: Number(c) || 0, fat_g: Number(f) || 0 };
  }

  // flat fields
  if (
    portion.protein_g != null ||
    portion.carbs_g != null ||
    portion.fat_g != null ||
    portion.protein != null ||
    portion.carbs != null ||
    portion.fat != null
  ) {
    const p = portion.protein_g ?? portion.protein ?? 0;
    const c = portion.carbs_g ?? portion.carbs ?? 0;
    const f = portion.fat_g ?? portion.fat ?? 0;
    return { protein_g: Number(p) || 0, carbs_g: Number(c) || 0, fat_g: Number(f) || 0 };
  }

  return null;
}

// Compute macros for a meal:
// 1) use stored macros if present
// 2) else derive from foodData (food_id + portion_id + qty)
// If we can’t compute, returns nulls.
function computeMealMacros(meal, foods) {
  const storedHasAny =
    meal?.protein_g != null || meal?.carbs_g != null || meal?.fat_g != null;

  if (storedHasAny) {
    return {
      protein_g: Number(meal.protein_g) || 0,
      carbs_g: Number(meal.carbs_g) || 0,
      fat_g: Number(meal.fat_g) || 0,
      source: 'stored'
    };
  }

  const food = findFoodForMeal(meal, foods);
  if (!food) return { protein_g: null, carbs_g: null, fat_g: null, source: 'none' };

  const portion = findPortionForMeal(meal, food);
  if (!portion) return { protein_g: null, carbs_g: null, fat_g: null, source: 'none' };

  const per = getPortionMacros(portion);
  if (!per) return { protein_g: null, carbs_g: null, fat_g: null, source: 'none' };

  const q =
    (meal.qty != null && Number(meal.qty)) ||
    parseQtyFromName(meal.name) ||
    1;

  return {
    protein_g: (Number(per.protein_g) || 0) * (Number(q) || 1),
    carbs_g: (Number(per.carbs_g) || 0) * (Number(q) || 1),
    fat_g: (Number(per.fat_g) || 0) * (Number(q) || 1),
    source: 'derived'
  };
}

function formatMealSecondary(calories, macros) {
  const cals = fmt0(calories);
  const p = macros?.protein_g;
  const c = macros?.carbs_g;
  const f = macros?.fat_g;

  const hasAnyMacro = p != null || c != null || f != null;

  if (!hasAnyMacro) return `${cals} cals`;

  return `${cals} cals • P ${fmt0(p)}g • C ${fmt0(c)}g • F ${fmt0(f)}g`;
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
  const update = (i, key, val) => setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const remove = i => setRows(prev => prev.filter((_, idx) => idx !== i));

  const total = useMemo(() => rows.reduce((s, r) => s + (parseInt(r.calories, 10) || 0), 0), [rows]);

  const hasValid = rows.every(r => r.name.trim().length > 0 && (parseInt(r.calories, 10) || 0) > 0);

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
  const [FoodTip, triggerFoodTip] = useFirstTimeTip('tip_food', 'Search or type a food name.');
  const [CalTip, triggerCalTip] = useFirstTimeTip('tip_cal', 'Enter calories.');
  const [AddTip, triggerAddTip] = useFirstTimeTip('tip_add', 'Tap to add this meal.');
  const [ClearTip, triggerClearTip] = useFirstTimeTip('tip_clear', 'Tap to clear today’s meals.');

  const [foodInput, setFoodInput] = useState('');
  const [selectedFood, setSelectedFood] = useState(null);

  const [selectedPortionId, setSelectedPortionId] = useState('');
  const [qty, setQty] = useState('1');

  const [calories, setCalories] = useState('');
  const [caloriesManualOverride, setCaloriesManualOverride] = useState(false);

  const [mealLog, setMealLog] = useState([]);

  const [showSuggest, setShowSuggest] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const [openCustom, setOpenCustom] = useState(false);
  const [openBowl, setOpenBowl] = useState(false);

  const { user } = useAuth();

  const suggestRef = useRef(null);

  const now = new Date();
  const todayUS = now.toLocaleDateString('en-US');
  const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);

  useEffect(() => {
    hydrateStreakOnStartup();
  }, []);

  useEffect(() => {
    const all = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayLog = all.find(e => e.date === todayUS);
    const meals = todayLog ? todayLog.meals || [] : [];
    setMealLog(meals);

    const totalInit = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
    onMealUpdate?.(totalInit);
  }, [onMealUpdate, todayUS]);

  const persistToday = meals => {
    const rest = JSON.parse(localStorage.getItem('mealHistory') || '[]').filter(e => e.date !== todayUS);
    rest.push({ date: todayUS, meals });
    localStorage.setItem('mealHistory', JSON.stringify(rest));
  };

  const emitConsumed = total => {
    try {
      window.dispatchEvent(new CustomEvent('slimcal:consumed:update', { detail: { date: todayISO, consumed: total } }));
    } catch {}
  };

  const getBurnedTodayLocal = dateUS => {
    try {
      const all = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
      const entry = all.find(e => e.date === dateUS);
      return Number(entry?.totalCalories) || 0;
    } catch {
      return 0;
    }
  };

  const syncDailyMetrics = async consumedTotal => {
    const burned = getBurnedTodayLocal(todayUS);

    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}');
    cache[todayISO] = { burned, consumed: consumedTotal, net: consumedTotal - burned };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
    localStorage.setItem('consumedToday', String(consumedTotal));
    emitConsumed(consumedTotal);

    try {
      if (user?.id) {
        await upsertDailyMetrics(user.id, todayISO, burned, consumedTotal);
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

  useEffect(() => {
    if (!selectedFood || !selectedPortion) return;
    if (caloriesManualOverride) return;
    if (autoCalories == null) return;
    setCalories(String(autoCalories));
  }, [selectedFood, selectedPortion, qty, autoCalories, caloriesManualOverride]);

  const logOne = async ({ name, calories, macros, meta }) => {
    const safe = {
      name,
      calories: Math.max(0, Number(calories) || 0),
      protein_g: macros?.protein_g != null ? Number(macros.protein_g) || 0 : undefined,
      carbs_g: macros?.carbs_g != null ? Number(macros.carbs_g) || 0 : undefined,
      fat_g: macros?.fat_g != null ? Number(macros.fat_g) || 0 : undefined,
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

        const qtyNum = meta?.qty != null ? Number(meta.qty) : 1;
        const unitStr = meta?.unit || 'serving';

        await saveMeal(
          user.id,
          {
            eaten_at: eatenISO,
            title: safe.name,
            total_calories: safe.calories
          },
          [
            {
              food_name: meta?.food_name || safe.name,
              qty: Number.isFinite(qtyNum) ? qtyNum : 1,
              unit: unitStr,
              calories: safe.calories,
              protein: macros?.protein_g ?? null,
              carbs: macros?.carbs_g ?? null,
              fat: macros?.fat_g ?? null
            }
          ]
        );
      }
    } catch (err) {
      console.error('[MealTracker] cloud save failed', err);
    }
  };

  const handleAdd = async () => {
    const nameText = foodInput.trim();

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

      const displayName = `${selectedFood.name} — ${q} ${unitPretty} (${selectedPortion.label})`;

      // If foodData portions contain macros, store them at log-time too.
      const per = getPortionMacros(selectedPortion);
      const macros = per
        ? {
            protein_g: (Number(per.protein_g) || 0) * q,
            carbs_g: (Number(per.carbs_g) || 0) * q,
            fat_g: (Number(per.fat_g) || 0) * q
          }
        : undefined;

      await logOne({
        name: displayName,
        calories: c,
        macros,
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

  const handleDeleteMeal = index => {
    setMealLog(prev => {
      const updated = prev.filter((_, i) => i !== index);
      saveDay(updated);
      return updated;
    });
  };

  const handleClear = () => {
    const rest = JSON.parse(localStorage.getItem('mealHistory') || '[]').filter(e => e.date !== todayUS);
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    setMealLog([]);
    onMealUpdate?.(0);
    syncDailyMetrics(0);
  };

  const handleToggleMealIdeas = useCallback(async () => {
    if (showSuggest) {
      setShowSuggest(false);
      return;
    }

    if (!isProUser() && getMealAICount() >= 3) {
      // continue to server probe; if gated, it will 402
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

    if (!isProUser()) incMealAICount();

    setShowSuggest(true);

    setTimeout(() => {
      try {
        suggestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {}
    }, 50);
  }, [showSuggest, user?.id]);

  const options = useMemo(() => (Array.isArray(foodData) ? foodData.filter(f => !f.action) : []), []);
  const customAction = useMemo(() => {
    return Array.isArray(foodData) ? foodData.find(f => f.action === 'open_custom_nutrition') : null;
  }, []);

  // ✅ Rehydrate macros for display using foodData when missing
  const displayMeals = useMemo(() => {
    const foods = options; // only real foods
    return (mealLog || []).map(m => {
      const macros = computeMealMacros(m, foods);
      return { ...m, _displayMacros: macros };
    });
  }, [mealLog, options]);

  const totalCalories = useMemo(() => {
    return (mealLog || []).reduce((s, m) => s + (Number(m.calories) || 0), 0);
  }, [mealLog]);

  const totalMacros = useMemo(() => {
    return displayMeals.reduce(
      (acc, m) => {
        const mm = m._displayMacros;
        acc.protein += Number(mm?.protein_g) || 0;
        acc.carbs += Number(mm?.carbs_g) || 0;
        acc.fat += Number(mm?.fat_g) || 0;
        return acc;
      },
      { protein: 0, carbs: 0, fat: 0 }
    );
  }, [displayMeals]);

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

      <Card
        sx={{
          borderRadius: 3,
          boxShadow: '0 24px 60px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)'
        }}
      >
        <CardContent sx={{ pb: 2 }}>
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

      <Accordion disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ fontWeight: 700 }}>Quick Actions</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button
              onClick={() => setOpenCustom(true)}
              startIcon={<AddCircleOutlineIcon />}
              variant="outlined"
              size="small"
              sx={{ flexGrow: 1, textTransform: 'none', fontWeight: 600, borderRadius: 999, px: 2 }}
            >
              Custom Food
            </Button>
            <Button
              onClick={() => setOpenBowl(true)}
              startIcon={<RestaurantIcon />}
              variant="outlined"
              size="small"
              sx={{ flexGrow: 1, textTransform: 'none', fontWeight: 600, borderRadius: 999, px: 2 }}
            >
              Build a Bowl
            </Button>
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Accordion defaultExpanded disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ fontWeight: 700 }}>Manual Entry</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ mb: 2 }}>
            <Autocomplete
              freeSolo
              options={options}
              getOptionLabel={o => (typeof o === 'string' ? o : o?.name || '')}
              value={selectedFood}
              inputValue={foodInput}
              onChange={(_, v) => {
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

                setSelectedFood(v);
                setFoodInput(v.name);

                const firstPortion = Array.isArray(v.portions) && v.portions.length ? v.portions[0] : null;
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

            {selectedFood && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="portion-label">Portion</InputLabel>
                  <Select
                    labelId="portion-label"
                    label="Portion"
                    value={selectedPortionId || (portions[0]?.id ? String(portions[0].id) : '')}
                    onChange={(e) => {
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
                  onChange={(e) => {
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
                if (selectedFood) setCaloriesManualOverride(true);
              }}
              helperText={
                selectedFood && selectedPortion
                  ? `Auto: ${autoCalories ?? 0} kcal (edit to override)`
                  : ''
              }
            />

            {!selectedFood && foodInput.length > 2 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Not found — enter calories manually or use Quick Actions.
              </Alert>
            )}

            {customAction && (
              <Button
                onClick={() => setOpenCustom(true)}
                variant="text"
                sx={{ mt: 1, textTransform: 'none', fontWeight: 600 }}
              >
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

      <Accordion defaultExpanded disableGutters ref={suggestRef}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 700 }}>AI Assist</Typography>
            <Chip size="small" color="primary" label="BETA" sx={{ fontWeight: 500, height: 20 }} />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <AIFoodLookupBox
            onAddFood={payload => {
              logOne({
                name: payload.name,
                calories: payload.calories,
                macros: {
                  protein_g: payload.protein_g,
                  carbs_g: payload.carbs_g,
                  fat_g: payload.fat_g
                }
              });
            }}
          />

          {showSuggest && (
            <Box sx={{ mt: 2 }}>
              <MealSuggestion
                consumedCalories={totalCalories}
                onAddMeal={async meal => {
                  const safeCalories = Number.isFinite(meal.calories) ? Number(meal.calories) : 0;
                  await logOne({ name: meal.name, calories: safeCalories });
                }}
              />
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* ------------------- Logged Meals ------------------- */}
      <Accordion defaultExpanded disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ fontWeight: 700 }}>Meals Logged Today ({todayUS})</Typography>
        </AccordionSummary>
        <AccordionDetails>
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
                {displayMeals.map((m, i) => (
                  <Box key={`${m.name}-${i}`}>
                    <ListItem
                      secondaryAction={
                        <Tooltip title="Delete this meal">
                          <IconButton
                            edge="end"
                            aria-label="delete meal"
                            onClick={() => handleDeleteMeal(i)}
                            size="small"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <ListItemText
                        primary={<Typography fontWeight={500}>{m.name}</Typography>}
                        secondary={formatMealSecondary(m.calories, m._displayMacros)}
                      />
                    </ListItem>
                    {i < displayMeals.length - 1 && <Divider />}
                  </Box>
                ))}
              </List>

              <Typography variant="h6" align="right" sx={{ mt: 2, fontWeight: 600 }}>
                Total Calories: {fmt0(totalCalories)}
              </Typography>

              <Typography variant="body2" align="right" color="text.secondary" sx={{ mt: 0.5 }}>
                Totals — P {fmt0(totalMacros.protein)}g • C {fmt0(totalMacros.carbs)}g • F {fmt0(totalMacros.fat)}g
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
