// src/MealTracker.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  CardHeader,
  Chip
} from '@mui/material';

import DeleteIcon from '@mui/icons-material/Delete';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RestaurantIcon from '@mui/icons-material/RamenDining';

import foodData from './foodData.json';

import useFirstTimeTip from './hooks/useFirstTimeTip';
import { updateStreak, hydrateStreakOnStartup } from './utils/streak';

import MealSuggestion from './MealSuggestion';
import UpgradeModal from './components/UpgradeModal';
import AIFoodLookupBox from './components/AIFoodLookupBox.jsx';

// auth + db
import { useAuth } from './context/AuthProvider.jsx';
import { saveMeal, upsertDailyMetrics } from './lib/db';

// ---------------- Pro / gating helpers ----------------
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};

const getMealAICount = () =>
  parseInt(localStorage.getItem('aiMealCount') || '0', 10);

const incMealAICount = () =>
  localStorage.setItem('aiMealCount', String(getMealAICount() + 1));

async function probeEntitlement(payload) {
  const base = {
    feature: 'meal',
    type: 'meal',
    mode: 'meal',
    ...payload,
    count: 1
  };
  try {
    let resp = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base)
    });
    if (resp.status === 402) return { gated: true };
    if (resp.ok) return { gated: false };

    if (resp.status === 400 || resp.status === 404) {
      resp = await fetch('/api/ai/meal-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base)
      });
      if (resp.status === 402) return { gated: true };
      return { gated: !resp.ok };
    }
    return { gated: !resp.ok };
  } catch {
    return { gated: false };
  }
}

// ---------------- helpers ----------------
function kcalFromMacros(p = 0, c = 0, f = 0) {
  const P = Number(p) || 0,
    C = Number(c) || 0,
    F = Number(f) || 0;
  return Math.max(0, Math.round(P * 4 + C * 4 + F * 9));
}

// ---------------- Dialogs ----------------
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
          <TextField
            label="Food name"
            fullWidth
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <TextField
            label="Calories (kcal)"
            type="number"
            fullWidth
            value={cal}
            onChange={e => setCal(e.target.value)}
          />
          <Typography variant="caption" color="text.secondary">
            Or enter macros (we’ll calculate calories if you leave Calories
            blank)
          </Typography>
          <Stack direction="row" spacing={1.5}>
            <TextField
              label="Protein (g)"
              type="number"
              fullWidth
              value={p}
              onChange={e => setP(e.target.value)}
            />
            <TextField
              label="Carbs (g)"
              type="number"
              fullWidth
              value={c}
              onChange={e => setC(e.target.value)}
            />
            <TextField
              label="Fat (g)"
              type="number"
              fullWidth
              value={f}
              onChange={e => setF(e.target.value)}
            />
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
    if (open) {
      setRows([{ name: '', calories: '' }]);
    }
  }, [open]);

  const addRow = () =>
    setRows(prev => [...prev, { name: '', calories: '' }]);

  const update = (i, key, val) =>
    setRows(prev =>
      prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r))
    );

  const remove = i =>
    setRows(prev => prev.filter((_, idx) => idx !== i));

  const total = useMemo(
    () =>
      rows.reduce((s, r) => s + (parseInt(r.calories, 10) || 0), 0),
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
              <IconButton
                aria-label="remove"
                onClick={() => remove(i)}
                disabled={rows.length === 1}
              >
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
            const pretty = rows
              .map(r => r.name.trim())
              .filter(Boolean)
              .join(', ');
            onConfirm?.({
              name: `Bowl: ${pretty}`,
              calories: total
            });
            onClose?.();
          }}
        >
          Add Bowl
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------- Main ----------------
export default function MealTracker({ onMealUpdate }) {
  // onboarding tips
  const [FoodTip, triggerFoodTip] = useFirstTimeTip(
    'tip_food',
    'Search or type a food name.'
  );
  const [CalTip, triggerCalTip] = useFirstTimeTip(
    'tip_cal',
    'Enter calories.'
  );
  const [AddTip, triggerAddTip] = useFirstTimeTip(
    'tip_add',
    'Tap to add this meal.'
  );
  const [ClearTip, triggerClearTip] = useFirstTimeTip(
    'tip_clear',
    'Tap to clear today’s meals.'
  );

  // form state
  const [foodInput, setFoodInput] = useState('');
  const [selectedFood, setSelectedFood] = useState(null);
  const [calories, setCalories] = useState('');

  // logged meals & totals
  const [mealLog, setMealLog] = useState([]);

  // AI suggestion panel
  const [showSuggest, setShowSuggest] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // dialogs
  const [openCustom, setOpenCustom] = useState(false);
  const [openBowl, setOpenBowl] = useState(false);

  const { user } = useAuth();

  // canonical "today"
  const now = new Date();
  const todayUS = now.toLocaleDateString('en-US'); // 10/26/2025
  const todayISO = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD local midnight

  // goalType for AI meal suggestions
  const stored = JSON.parse(localStorage.getItem('userData') || '{}');
  const goalType = stored.goalType || 'maintain';

  // hydrate streak model on mount
  useEffect(() => {
    hydrateStreakOnStartup();
  }, []);

  // load today's meals from localStorage
  useEffect(() => {
    const all = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayLog = all.find(e => e.date === todayUS);
    const meals = todayLog ? todayLog.meals || [] : [];
    setMealLog(meals);

    const totalInit = meals.reduce(
      (s, m) => s + (Number(m.calories) || 0),
      0
    );
    onMealUpdate?.(totalInit);
  }, [onMealUpdate, todayUS]);

  // helpers to persist day's meals
  const persistToday = meals => {
    const rest = JSON.parse(localStorage.getItem('mealHistory') || '[]')
      .filter(e => e.date !== todayUS);

    rest.push({ date: todayUS, meals });
    localStorage.setItem('mealHistory', JSON.stringify(rest));
  };

  // dispatch "consumed" so Dashboard updates net calories live
  const emitConsumed = total => {
    try {
      window.dispatchEvent(
        new CustomEvent('slimcal:consumed:update', {
          detail: { date: todayISO, consumed: total }
        })
      );
    } catch {}
  };

  // sync (local + supabase)
  const getBurnedTodayLocal = dateUS => {
    try {
      const all = JSON.parse(
        localStorage.getItem('workoutHistory') || '[]'
      );
      const entry = all.find(e => e.date === dateUS);
      return Number(entry?.totalCalories) || 0;
    } catch {
      return 0;
    }
  };

  const syncDailyMetrics = async consumedTotal => {
    // update local cache for charting
    const burned = getBurnedTodayLocal(todayUS);
    const cache = JSON.parse(
      localStorage.getItem('dailyMetricsCache') || '{}'
    );
    cache[todayISO] = {
      burned,
      consumed: consumedTotal,
      net: consumedTotal - burned
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
    localStorage.setItem('consumedToday', String(consumedTotal));
    emitConsumed(consumedTotal);

    // backup to db
    try {
      if (user?.id) {
        await upsertDailyMetrics(
          user.id,
          todayISO,
          burned,
          consumedTotal
        );
      }
    } catch (err) {
      console.error('[MealTracker] upsertDailyMetrics failed', err);
    }
  };

  const saveDay = meals => {
    persistToday(meals);
    const total = meals.reduce(
      (s, m) => s + (Number(m.calories) || 0),
      0
    );
    onMealUpdate?.(total);
    syncDailyMetrics(total);
  };

  // log a meal object `{ name, calories, macros? }`
  const logOne = async ({ name, calories, macros }) => {
    const safe = {
      name,
      calories: Math.max(0, Number(calories) || 0)
    };

    setMealLog(prev => {
      const upd = [...prev, safe];
      saveDay(upd);
      return upd;
    });

    updateStreak();

    // optional: save line item up to Supabase for history
    try {
      if (user?.id) {
        const eatenISO = new Date().toISOString();
        await saveMeal(
          user.id,
          {
            eaten_at: eatenISO,
            title: safe.name,
            total_calories: safe.calories
          },
          [
            {
              food_name: safe.name,
              qty: 1,
              unit: 'serving',
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

  // manual Add Meal button
  const handleAdd = async () => {
    const c = Number.parseInt(calories, 10);
    if (!foodInput.trim() || !Number.isFinite(c) || c <= 0) {
      alert('Enter a valid food & calories.');
      return;
    }
    await logOne({ name: foodInput.trim(), calories: c });

    setFoodInput('');
    setCalories('');
    setSelectedFood(null);
  };

  const handleDeleteMeal = index => {
    setMealLog(prev => {
      const updated = prev.filter((_, i) => i !== index);
      saveDay(updated);
      return updated;
    });
  };

  const handleClear = () => {
    // wipe today
    const rest = JSON.parse(
      localStorage.getItem('mealHistory') || '[]'
    ).filter(e => e.date !== todayUS);
    localStorage.setItem('mealHistory', JSON.stringify(rest));

    setMealLog([]);
    onMealUpdate?.(0);
    syncDailyMetrics(0);
  };

  // AI meal ideas panel toggle + entitlement check
  const handleAIMealSuggestClick = useCallback(async () => {
    if (!showSuggest) {
      // opening panel
      if (!isProUser() && getMealAICount() >= 3) {
        setShowUpgrade(true);
        return;
      }

      try {
        const dietPreference =
          localStorage.getItem('diet_preference') || 'omnivore';
        const trainingIntent =
          localStorage.getItem('training_intent') || 'general';
        const proteinMealG = parseInt(
          localStorage.getItem('protein_target_meal_g') || '0',
          10
        );
        const calorieBias = parseInt(
          localStorage.getItem('calorie_bias') || '0',
          10
        );

        const probePayload = {
          user_id: user?.id || null,
          goal: goalType || 'maintenance',
          constraints: {
            diet_preference: dietPreference,
            training_intent: trainingIntent,
            protein_per_meal_g:
              proteinMealG || undefined,
            calorie_bias: calorieBias || undefined
          }
        };

        const { gated } = await probeEntitlement(
          probePayload
        );
        if (gated) {
          setShowUpgrade(true);
          return;
        }
      } catch (e) {
        console.warn(
          '[MealTracker] gateway probe failed',
          e
        );
      }

      if (!isProUser()) {
        incMealAICount();
      }

      setShowSuggest(true);
      return;
    }

    // closing panel
    setShowSuggest(false);
  }, [showSuggest, user?.id, goalType]);

  const total = mealLog.reduce(
    (s, m) => s + (Number(m.calories) || 0),
    0
  );

  // Autocomplete choices: ONLY real foods now
  const options = useMemo(() => foodData, []);

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      {/* ---------- CARD: Manual Entry ---------- */}
      <Card
        sx={{
          borderRadius: 2,
          mb: 3,
          boxShadow:
            '0 8px 24px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.03)'
        }}
      >
        <CardHeader
          title={
            <Typography variant="h6" fontWeight={600}>
              Manual Entry
            </Typography>
          }
          sx={{ pb: 0 }}
        />
        <CardContent sx={{ pt: 2 }}>
          {/* Food picker + calories */}
          <Box sx={{ mb: 2 }}>
            <Autocomplete
              freeSolo
              options={options}
              getOptionLabel={o => o.name}
              value={selectedFood}
              inputValue={foodInput}
              onChange={(_, v) => {
                if (!v) {
                  setSelectedFood(null);
                  return;
                }
                setSelectedFood(v);
                setFoodInput(v.name);
                if (typeof v.calories !== 'undefined') {
                  setCalories(String(v.calories));
                }
              }}
              onInputChange={(_, v) => setFoodInput(v)}
              renderInput={params => (
                <TextField
                  {...params}
                  label="Food Name"
                  fullWidth
                  onFocus={triggerFoodTip}
                />
              )}
            />

            <TextField
              label="Calories"
              type="number"
              fullWidth
              sx={{ mt: 2 }}
              value={calories}
              onFocus={triggerCalTip}
              onChange={e => setCalories(e.target.value)}
            />

            {!selectedFood && foodInput.length > 2 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Not found — enter calories manually, or use the
                quick actions below.
              </Alert>
            )}
          </Box>

          {/* 🔥 NEW quick actions row so they’re obvious */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              mb: 2
            }}
          >
            <Button
              size="small"
              startIcon={<AddCircleOutlineIcon />}
              onClick={() => {
                setOpenCustom(true);
              }}
              sx={{
                textTransform: 'none'
              }}
            >
              Custom Food
            </Button>

            <Button
              size="small"
              startIcon={<RestaurantIcon />}
              onClick={() => {
                setOpenBowl(true);
              }}
              sx={{
                textTransform: 'none'
              }}
            >
              Build a Bowl
            </Button>
          </Box>

          {/* Action buttons for manual entry */}
          <Box
            sx={{
              display: 'flex',
              gap: 1.5,
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}
          >
            <Button
              variant="contained"
              onClick={() => {
                triggerAddTip();
                handleAdd();
              }}
            >
              Add Meal
            </Button>

            <Button
              variant="outlined"
              color="error"
              onClick={() => {
                triggerClearTip();
                handleClear();
              }}
            >
              Clear Meals
            </Button>

            <Button
              variant="outlined"
              onClick={handleAIMealSuggestClick}
            >
              {showSuggest
                ? 'Hide Meal Ideas'
                : 'Suggest a Meal (AI)'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* ---------- CARD: AI Assist (Food Lookup + Meal Suggestions) ---------- */}
      <Card
        sx={{
          borderRadius: 2,
          mb: 4,
          boxShadow:
            '0 8px 24px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.03)'
        }}
      >
        <CardHeader
          title={
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 1
              }}
            >
              <Typography variant="h6" fontWeight={600}>
                AI Assist
              </Typography>
              <Chip
                size="small"
                color="primary"
                label="BETA"
                sx={{ fontWeight: 500 }}
              />
            </Box>
          }
          sx={{ pb: 0 }}
        />
        <CardContent sx={{ pt: 2 }}>
          {/* AI Food Lookup (3 free / day uses also enforced server-side) */}
          <AIFoodLookupBox
            onAddFood={payload => {
              // payload: { name, calories, protein_g, carbs_g, fat_g }
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

          {/* Meal suggestions panel (shows only if toggled on) */}
          {showSuggest && (
            <MealSuggestion
              consumedCalories={total}
              onAddMeal={async meal => {
                // meal = { name, calories }
                const safeCalories = Number.isFinite(
                  meal.calories
                )
                  ? Number(meal.calories)
                  : 0;
                await logOne({
                  name: meal.name,
                  calories: safeCalories
                });
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* ---------- Logged meals ---------- */}
      <Typography
        variant="h6"
        gutterBottom
        sx={{ fontWeight: 600 }}
      >
        Meals Logged Today ({todayUS})
      </Typography>

      {mealLog.length === 0 ? (
        <Typography>No meals added yet.</Typography>
      ) : (
        <List>
          {mealLog.map((m, i) => (
            <Box key={`${m.name}-${i}`}>
              <ListItem
                secondaryAction={
                  <Tooltip title="Delete this meal">
                    <IconButton
                      edge="end"
                      aria-label="delete meal"
                      onClick={() => handleDeleteMeal(i)}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemText
                  primary={m.name}
                  secondary={`${Number(
                    m.calories
                  ) || 0} cals`}
                />
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      )}

      <Typography
        variant="h6"
        align="right"
        sx={{ mt: 3, fontWeight: 600 }}
      >
        Total Calories: {total}
      </Typography>

      {/* paywall modal */}
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI meal suggestions, unlimited AI workouts, Daily Recap Coach, AI Food Lookup without limits, and advanced insights."
      />

      {/* dialogs */}
      <CustomNutritionDialog
        open={openCustom}
        onClose={() => setOpenCustom(false)}
        onConfirm={item => logOne(item)}
      />
      <BuildBowlDialog
        open={openBowl}
        onClose={() => setOpenBowl(false)}
        onConfirm={item => logOne(item)}
      />
    </Container>
  );
}
