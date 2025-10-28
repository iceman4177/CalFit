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
  CardHeader,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
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

// ---------- Pro / gating helpers ----------
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

// ---------- helpers ----------
function kcalFromMacros(p = 0, c = 0, f = 0) {
  const P = Number(p) || 0,
    C = Number(c) || 0,
    F = Number(f) || 0;
  return Math.max(0, Math.round(P * 4 + C * 4 + F * 9));
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
            Or enter macros (we’ll calculate calories if Calories is blank)
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

// ---------- Main ----------
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

  // manual entry state
  const [foodInput, setFoodInput] = useState('');
  const [selectedFood, setSelectedFood] = useState(null);
  const [calories, setCalories] = useState('');

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
  const todayUS = now.toLocaleDateString('en-US'); // e.g. 10/26/2025
  const todayISO = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD @ local midnight

  // goalType (for AI probe)
  const stored = JSON.parse(localStorage.getItem('userData') || '{}');
  const goalType = stored.goalType || 'maintain';

  // streak + initial data load
  useEffect(() => {
    hydrateStreakOnStartup();
  }, []);

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

  // ------------ persistence helpers ------------
  const persistToday = meals => {
    const rest = JSON.parse(localStorage.getItem('mealHistory') || '[]').filter(
      e => e.date !== todayUS
    );
    rest.push({ date: todayUS, meals });
    localStorage.setItem('mealHistory', JSON.stringify(rest));
  };

  const emitConsumed = total => {
    try {
      window.dispatchEvent(
        new CustomEvent('slimcal:consumed:update', {
          detail: { date: todayISO, consumed: total }
        })
      );
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
    const total = meals.reduce(
      (s, m) => s + (Number(m.calories) || 0),
      0
    );
    onMealUpdate?.(total);
    syncDailyMetrics(total);
  };

  // core logger for any meal object
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

    // optional: send to Supabase for history
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

  // manual "Add Meal" button
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
    const rest = JSON.parse(localStorage.getItem('mealHistory') || '[]').filter(
      e => e.date !== todayUS
    );
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    setMealLog([]);
    onMealUpdate?.(0);
    syncDailyMetrics(0);
  };

  // toggle meal ideas panel (+ entitlement check first time opening)
  const handleToggleMealIdeas = useCallback(async () => {
    if (showSuggest) {
      setShowSuggest(false);
      return;
    }
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
          protein_per_meal_g: proteinMealG || undefined,
          calorie_bias: calorieBias || undefined
        }
      };

      const { gated } = await probeEntitlement(probePayload);
      if (gated) {
        setShowUpgrade(true);
        return;
      }
    } catch (e) {
      console.warn('[MealTracker] gateway probe failed', e);
    }

    if (!isProUser()) {
      incMealAICount();
    }

    setShowSuggest(true);

    setTimeout(() => {
      try {
        suggestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {}
    }, 50);
  }, [showSuggest, user?.id, goalType]);

  const total = mealLog.reduce(
    (s, m) => s + (Number(m.calories) || 0),
    0
  );

  // Autocomplete shows real foods only
  const options = useMemo(() => foodData, []);

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
          boxShadow: '0 24px 60px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)',
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

            {/* ✅ Single AI entrypoint (no duplicates elsewhere) */}
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
          {/* Food + Calories */}
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
                Not found — enter calories manually or use Quick Actions.
              </Alert>
            )}
          </Box>

          {/* Action row */}
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
          {/* AI Food Lookup */}
          <AIFoodLookupBox
            onAddFood={payload => {
              // { name, calories, protein_g, carbs_g, fat_g }
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

          {/* Meal suggestions panel (shown only when toggled from hero) */}
          {showSuggest && (
            <Box sx={{ mt: 2 }}>
              <MealSuggestion
                consumedCalories={total}
                onAddMeal={async meal => {
                  const safeCalories = Number.isFinite(meal.calories)
                    ? Number(meal.calories)
                    : 0;

                  await logOne({
                    name: meal.name,
                    calories: safeCalories
                  });
                }}
              />
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* ------------------- ACCORDION: Logged Meals (open) ------------------- */}
      <Accordion defaultExpanded disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ fontWeight: 700 }}>
            Meals Logged Today ({todayUS})
          </Typography>
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
                  boxShadow:
                    '0 8px 24px rgba(0,0,0,0.03), 0 2px 8px rgba(0,0,0,0.02)'
                }}
              >
                {mealLog.map((m, i) => (
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

      {/* Upgrade modal */}
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI meal suggestions, unlimited AI workouts, Daily Recap Coach, AI Food Lookup without limits, and advanced insights."
      />

      {/* Dialogs */}
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
