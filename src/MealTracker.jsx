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
import DailyRecapCoach from './DailyRecapCoach';

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
              <TextField label={`Ingredient ${i + 1}`} value={r.name} onChange={e => update(i, 'name', e.target.value)} fullWidth />
              <TextField label="Calories" type="number" value={r.calories} onChange={e => update(i, 'calories', e.target.value)} sx={{ width: 140 }} />
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

  useEffect(() => {
    const all = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayLog = all.find(e => e.date === todayUS);
    const meals = todayLog ? todayLog.meals || [] : [];
    setMealLog(meals);

    const totalInit = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
    onMealUpdate?.(totalInit);
  }, [onMealUpdate, todayUS]);

  // ------------ persistence helpers ------------
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
    const safe = {
      name,
      calories: Math.max(0, Number(calories) || 0),
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

  // toggle meal ideas panel — identity-aware probe to avoid false 402s
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

      {/* ------------------- ACCORDION: DAILY RECAP COACH (PRIMARY FEATURE) ------------------- */}
      <Accordion defaultExpanded disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 800 }}>Daily Recap Coach</Typography>
            <Chip size="small" color="primary" label="AI" sx={{ fontWeight: 700, height: 20 }} />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Get a short recap of today’s calories + training with 2–3 action steps to improve.
          </Typography>
          <DailyRecapCoach embedded />
        </AccordionDetails>
      </Accordion>

      {/* ------------------- ACCORDION: Quick Actions ------------------- */}
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

      {/* ------------------- ACCORDION: Manual Entry (default open) ------------------- */}
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
                // Mark manual override only if a structured food is selected
                if (selectedFood) setCaloriesManualOverride(true);
              }}
              helperText={
                selectedFood && selectedPortion
                  ? `Auto: ${autoCalories ?? 0} kcal (edit to override)`
                  : ''
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

      {/* ------------------- ACCORDION: AI Assist (open) ------------------- */}
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
                {mealLog.map((m, i) => (
                  <Box key={`${m.name}-${i}`}>
                    <ListItem
                      secondaryAction={
                        <Tooltip title="Delete this meal">
                          <IconButton edge="end" aria-label="delete meal" onClick={() => handleDeleteMeal(i)} size="small">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <ListItemText
                        primary={<Typography fontWeight={500}>{m.name}</Typography>}
                        secondary={`${Number(m.calories) || 0} cals`}
                      />
                    </ListItem>
                    {i < mealLog.length - 1 && <Divider />}
                  </Box>
                ))}
              </List>

              <Typography variant="h6" align="right" sx={{ mt: 2, fontWeight: 600 }}>
                Total Calories: {total}
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
