// src/MealTracker.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Typography, Box, TextField,
  Button, List, ListItem, ListItemText,
  Divider, Autocomplete, Alert, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import foodData from './foodData.json';
import useFirstTimeTip from './hooks/useFirstTimeTip';
import { updateStreak, hydrateStreakOnStartup } from './utils/streak';
import MealSuggestion from './MealSuggestion';
import UpgradeModal from './components/UpgradeModal';
import AIFoodLookupBox from './components/AIFoodLookupBox.jsx';

// auth + db (history/backup; NOT used for today’s banner math)
import { useAuth } from './context/AuthProvider.jsx';
import { saveMeal, upsertDailyMetrics } from './lib/db';

// ---- entitlement helpers shared across features ----
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};
const isTrialActive = () => {
  const ts = parseInt(localStorage.getItem('trialEndTs') || '0', 10);
  return ts && Date.now() < ts;
};

// Meal suggestion usage counter (per day, free users)
const getMealAICount = () =>
  parseInt(localStorage.getItem('aiMealCount') || '0', 10);
const incMealAICount = () =>
  localStorage.setItem('aiMealCount', String(getMealAICount() + 1));

// Food lookup usage counter (per day, free users)
function todayKey() {
  return new Date().toLocaleDateString('en-US'); // good enough for local gating
}
function getLookupAICount() {
  const day = localStorage.getItem('aiLookupDay') || '';
  const cnt = parseInt(localStorage.getItem('aiLookupCount') || '0', 10);
  if (day !== todayKey()) {
    // reset if new day
    localStorage.setItem('aiLookupDay', todayKey());
    localStorage.setItem('aiLookupCount', '0');
    return 0;
  }
  return cnt;
}
function incLookupAICount() {
  const day = todayKey();
  const current = getLookupAICount();
  localStorage.setItem('aiLookupDay', day);
  localStorage.setItem('aiLookupCount', String(current + 1));
}

// Ping AI meal endpoint just to see if user is gated (used for Suggest a Meal button)
async function probeEntitlement(payload) {
  const base = { feature: 'meal', type: 'meal', mode: 'meal', ...payload, count: 1 };
  try {
    let resp = await fetch('/api/ai/generate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(base)
    });
    if (resp.status === 402) return { gated:true };
    if (resp.ok) return { gated:false };

    if (resp.status === 400 || resp.status === 404) {
      resp = await fetch('/api/ai/meal-suggestion', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(base)
      });
      if (resp.status === 402) return { gated:true };
      return { gated: !resp.ok };
    }

    return { gated: !resp.ok };
  } catch {
    return { gated:false };
  }
}

function getBurnedTodayLocal(dateUS) {
  try {
    const all = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const entry = all.find(e => e.date === dateUS);
    return Number(entry?.totalCalories) || 0;
  } catch {
    return 0;
  }
}

// ------- calorie math helper for custom dialog -------
function kcalFromMacros(p=0,c=0,f=0) {
  const P = Number(p)||0, C = Number(c)||0, F = Number(f)||0;
  return Math.max(0, Math.round(P*4 + C*4 + F*9));
}

// ======================= Custom Food Dialog =======================
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
      return Math.max(0, parseInt(cal,10)||0);
    }
    if (p || c || f) {
      return kcalFromMacros(p,c,f);
    }
    return 0;
  }, [cal,p,c,f]);

  const canSave = name.trim().length>0 && effectiveCalories>0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Custom Food (enter calories or macros)</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField
            label="Food name"
            fullWidth
            value={name}
            onChange={e=>setName(e.target.value)}
          />

          <TextField
            label="Calories (kcal)"
            type="number"
            fullWidth
            value={cal}
            onChange={e=>setCal(e.target.value)}
          />

          <Typography variant="caption" color="text.secondary">
            Or enter macros (we’ll compute calories if the field above is blank)
          </Typography>

          <Stack direction="row" spacing={1.5}>
            <TextField
              label="Protein (g)"
              type="number"
              fullWidth
              value={p}
              onChange={e=>setP(e.target.value)}
            />
            <TextField
              label="Carbs (g)"
              type="number"
              fullWidth
              value={c}
              onChange={e=>setC(e.target.value)}
            />
            <TextField
              label="Fat (g)"
              type="number"
              fullWidth
              value={f}
              onChange={e=>setF(e.target.value)}
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
                protein_g: Number(p)||0,
                carbs_g: Number(c)||0,
                fat_g: Number(f)||0
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

// ======================= Build-a-Bowl Dialog =======================
function BuildBowlDialog({ open, onClose, onConfirm }) {
  const [rows, setRows] = useState([{ name:'', calories:'' }]);

  useEffect(() => {
    if (open) {
      setRows([{ name:'', calories:'' }]);
    }
  }, [open]);

  const addRow = () => setRows(prev => [...prev, { name:'', calories:'' }]);
  const update = (i, key, val) =>
    setRows(prev => prev.map((r,idx)=> idx===i ? {...r, [key]: val} : r));
  const remove = (i) =>
    setRows(prev => prev.filter((_,idx)=> idx!==i));

  const total = useMemo(
    () => rows.reduce((s,r)=> s + (parseInt(r.calories,10)||0), 0),
    [rows]
  );
  const hasValid = rows.every(
    r => r.name.trim().length>0 && (parseInt(r.calories,10)||0) > 0
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Build a Bowl (ingredient-by-ingredient)</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb:1 }}>
          Add each ingredient separately for accurate logging.
        </Typography>

        <Stack spacing={1.25} sx={{ mt: 1 }}>
          {rows.map((r, i) => (
            <Stack key={i} direction="row" spacing={1}>
              <TextField
                label={`Ingredient ${i+1}`}
                value={r.name}
                onChange={e=>update(i,'name',e.target.value)}
                fullWidth
              />
              <TextField
                label="Calories"
                type="number"
                value={r.calories}
                onChange={e=>update(i,'calories',e.target.value)}
                sx={{ width: 160 }}
              />
              <IconButton
                aria-label="remove"
                onClick={()=>remove(i)}
                disabled={rows.length===1}
              >
                <DeleteIcon/>
              </IconButton>
            </Stack>
          ))}

          <Button onClick={addRow}>Add Ingredient</Button>

          <Typography variant="body2" sx={{ mt:0.5 }}>
            Bowl total: <strong>{total}</strong> kcal
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!hasValid || total<=0}
          onClick={() => {
            const pretty = rows
              .map(r=>r.name.trim())
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

// ======================= Main Component =======================
export default function MealTracker({ onMealUpdate }) {
  // onboarding tooltips
  const [FoodTip,  triggerFoodTip]  = useFirstTimeTip('tip_food',  'Search or type a food name.');
  const [CalTip,   triggerCalTip]   = useFirstTimeTip('tip_cal',   'Enter calories.');
  const [AddTip,   triggerAddTip]   = useFirstTimeTip('tip_add',   'Tap to add this meal.');
  const [ClearTip, triggerClearTip] = useFirstTimeTip('tip_clear', 'Tap to clear today’s meals.');

  // base state
  const [foodInput, setFoodInput]       = useState('');
  const [selectedFood, setSelectedFood] = useState(null);
  const [calories, setCalories]         = useState('');
  const [mealLog, setMealLog]           = useState([]);
  const [showSuggest, setShowSuggest]   = useState(false);
  const [showUpgrade, setShowUpgrade]   = useState(false);

  // dialogs
  const [openCustom, setOpenCustom] = useState(false);
  const [openBowl, setOpenBowl]     = useState(false);

  const { user } = useAuth();

  // canonical "today"
  const now = new Date();
  const todayUS  = now.toLocaleDateString('en-US');
  const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    .toISOString()
    .slice(0,10);

  const stored   = JSON.parse(localStorage.getItem('userData')||'{}');
  const goalType = stored.goalType  || 'maintain';

  // init streak helpers etc
  useEffect(() => {
    hydrateStreakOnStartup();
  }, []);

  // load today's meals
  useEffect(() => {
    const all = JSON.parse(localStorage.getItem('mealHistory')||'[]');
    const todayLog = all.find(e=>e.date===todayUS);
    const meals = todayLog ? (todayLog.meals || []) : [];
    setMealLog(meals);
    const total = meals.reduce((s,m)=> s + (Number(m.calories)||0), 0);
    onMealUpdate?.(total);
  }, [onMealUpdate,todayUS]);

  // local persistence
  const persistToday = (meals) => {
    const rest = JSON.parse(localStorage.getItem('mealHistory')||'[]')
      .filter(e=>e.date!==todayUS);
    rest.push({ date:todayUS, meals });
    localStorage.setItem('mealHistory', JSON.stringify(rest));
  };

  // broadcast calories to rest of app
  const emitConsumed = (total) => {
    try {
      window.dispatchEvent(new CustomEvent('slimcal:consumed:update', {
        detail: { date: todayISO, consumed: total }
      }));
    } catch {}
  };

  // sync local->dailyMetrics cache and supabase
  const syncDailyMetrics = async (consumedTotal) => {
    const burned = getBurnedTodayLocal(todayUS);

    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}');
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

  // save helper
  const save = (meals) => {
    persistToday(meals);
    const total = meals.reduce((s,m)=> s + (Number(m.calories)||0), 0);
    onMealUpdate?.(total);
    syncDailyMetrics(total);
  };

  // log a single meal (used everywhere)
  const logOne = async ({ name, calories, macros }) => {
    const nm = {
      name,
      calories: Math.max(0, Number(calories)||0)
    };

    setMealLog(prev => {
      const upd = [...prev, nm];
      save(upd);
      return upd;
    });
    updateStreak();

    // cloud backup (optional)
    try {
      if (user?.id) {
        const eatenISO = new Date().toISOString();
        await saveMeal(
          user.id,
          {
            eaten_at: eatenISO,
            title: nm.name,
            total_calories: nm.calories
          },
          [{
            food_name: nm.name,
            qty: 1,
            unit: 'serving',
            calories: nm.calories,
            protein: macros?.protein_g ?? null,
            carbs:   macros?.carbs_g ?? null,
            fat:     macros?.fat_g ?? null
          }]
        );
      }
    } catch (err) {
      console.error('[MealTracker] cloud save failed', err);
    }
  };

  // manual add
  const handleAdd = async () => {
    const c = Number.parseInt(calories,10);
    if (!foodInput.trim() || !Number.isFinite(c) || c <= 0) {
      alert('Enter a valid food & calories.');
      return;
    }
    await logOne({
      name: foodInput.trim(),
      calories: c
    });
    setFoodInput('');
    setCalories('');
    setSelectedFood(null);
  };

  // delete single meal
  const handleDeleteMeal = (index) => {
    setMealLog(prev => {
      const updatedMeals = prev.filter((_, i) => i !== index);
      save(updatedMeals);
      return updatedMeals;
    });
  };

  // clear all meals
  const handleClear = () => {
    const rest = JSON.parse(localStorage.getItem('mealHistory')||'[]')
      .filter(e=>e.date!==todayUS);
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    setMealLog([]);
    onMealUpdate?.(0);
    syncDailyMetrics(0);
  };

  // "Suggest a Meal (AI)" button handler
  const handleAIMealSuggestClick = useCallback(async () => {
    if (!showSuggest) {
      // gate for free users
      if (!isProUser() && !isTrialActive() && getMealAICount() >= 3) {
        setShowUpgrade(true);
        return;
      }

      try {
        // probe server just in case we've hit remote cap
        const dietPreference = localStorage.getItem('diet_preference') || 'omnivore';
        const trainingIntent = localStorage.getItem('training_intent') || 'general';
        const proteinMealG   = parseInt(localStorage.getItem('protein_target_meal_g') || '0',10);
        const calorieBias    = parseInt(localStorage.getItem('calorie_bias') || '0',10);

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

      // count usage if they’re not pro/trial
      if (!isProUser() && !isTrialActive()) {
        incMealAICount();
      }

      setShowSuggest(true);
      return;
    }

    // hide panel
    setShowSuggest(false);
  }, [showSuggest, user?.id, goalType]);

  // running total
  const total = mealLog.reduce((s,m)=> s + (Number(m.calories)||0), 0);

  // ------- autocomplete options with special actions -------
  const actionRows = useMemo(() => [
    { name: '➕ Custom Food (enter calories/macros)', action: 'open_custom_nutrition' },
    { name: '🍲 Build a Bowl (add ingredients individually)', action: 'open_bowl_builder' }
  ], []);
  const options = useMemo(() => [...foodData, ...actionRows], [actionRows]);

  // ------- gating helpers for AI Food Lookup box -------
  const canUseLookup = useCallback(() => {
    // pro or trial? unlimited
    if (isProUser() || isTrialActive()) return true;
    // otherwise 3/day
    return getLookupAICount() < 3;
  }, []);

  const registerLookupUse = useCallback(() => {
    // only increment for non-pro/non-trial
    if (!isProUser() && !isTrialActive()) {
      incLookupAICount();
    }
  }, []);

  const handleLookupPaywall = useCallback(() => {
    setShowUpgrade(true);
  }, []);

  return (
    <Container maxWidth="sm" sx={{py:4}}>
      <Typography variant="h4" align="center" gutterBottom>
        Meal Tracker
      </Typography>

      <FoodTip/><CalTip/><AddTip/><ClearTip/>

      {/* ----- Manual quick entry row ----- */}
      <Box sx={{ mb:2 }}>
        <Autocomplete
          freeSolo
          options={options}
          getOptionLabel={o=>o.name}
          value={selectedFood}
          inputValue={foodInput}
          onChange={(_,v)=>{
            if (!v) {
              setSelectedFood(null);
              return;
            }
            // special actions
            if (v.action === 'open_custom_nutrition') {
              setSelectedFood(null);
              setFoodInput('');
              setCalories('');
              setOpenCustom(true);
              return;
            }
            if (v.action === 'open_bowl_builder') {
              setSelectedFood(null);
              setFoodInput('');
              setCalories('');
              setOpenBowl(true);
              return;
            }

            // normal food row
            setSelectedFood(v);
            setFoodInput(v.name);
            if (typeof v.calories !== 'undefined') {
              setCalories(String(v.calories));
            }
          }}
          onInputChange={(_,v)=>setFoodInput(v)}
          renderInput={p=>(
            <TextField
              {...p}
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
          sx={{mt:2}}
          value={calories}
          onFocus={triggerCalTip}
          onChange={e=>setCalories(e.target.value)}
        />

        {!selectedFood && foodInput.length>2 && (
          <Alert severity="info" sx={{mt:2}}>
            Not found — enter calories manually or pick “Custom Food”.
          </Alert>
        )}
      </Box>

      {/* ----- Actions row ----- */}
      <Box
        sx={{
          display:'flex',
          gap:2,
          mb:2.5,
          justifyContent:'center',
          flexWrap:'wrap'
        }}
      >
        <Button
          variant="contained"
          onClick={()=>{triggerAddTip();handleAdd();}}
        >
          Add Meal
        </Button>

        <Button
          variant="outlined"
          color="error"
          onClick={()=>{triggerClearTip();handleClear();}}
        >
          Clear Meals
        </Button>

        <Button
          variant="outlined"
          onClick={handleAIMealSuggestClick}
        >
          {showSuggest ? "Hide Suggestions" : "Suggest a Meal (AI)"}
        </Button>
      </Box>

      {/* ----- AI Food Lookup (always visible) ----- */}
      <Box sx={{ mb:3 }}>
        <Typography
          variant="subtitle2"
          sx={{ fontWeight:600, mb:1, textAlign:'center' }}
        >
          AI Food Lookup (brand + quantity)
        </Typography>

        <AIFoodLookupBox
          onAddFood={(payload)=>{
            // payload: { name, calories, protein_g, carbs_g, fat_g }
            logOne({
              name: payload.name,
              calories: payload.calories,
              macros: {
                protein_g: payload.protein_g,
                carbs_g:   payload.carbs_g,
                fat_g:     payload.fat_g
              }
            });
          }}
          canUseLookup={canUseLookup}
          registerLookupUse={registerLookupUse}
          onHitPaywall={handleLookupPaywall}
        />
      </Box>

      {/* ----- AI Meal Suggestions panel ----- */}
      {showSuggest && (
        <MealSuggestion
          consumedCalories={total}
          onAddMeal={(m)=>{
            const safeCalories = Number.isFinite(m.calories)
              ? Number(m.calories)
              : 0;
            const nm = { name:m.name, calories:safeCalories };
            setMealLog(prev => {
              const upd = [...prev, nm];
              save(upd);
              return upd;
            });
            updateStreak();
          }}
        />
      )}

      {/* ----- Logged meals list ----- */}
      <Typography variant="h6" gutterBottom sx={{mt:4}}>
        Meals Logged Today ({todayUS})
      </Typography>

      {mealLog.length===0 ? (
        <Typography>No meals added yet.</Typography>
      ) : (
        <List>
          {mealLog.map((m,i)=>(
            <Box key={`${m.name}-${i}`}>
              <ListItem
                secondaryAction={
                  <Tooltip title="Delete this meal">
                    <IconButton
                      edge="end"
                      aria-label="delete meal"
                      onClick={()=>handleDeleteMeal(i)}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemText
                  primary={m.name}
                  secondary={`${Number(m.calories)||0} cals`}
                />
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      )}

      <Typography variant="h6" align="right" sx={{mt:3}}>
        Total Calories: {total}
      </Typography>

      {/* paywall modal shared by both Suggest a Meal and AI Lookup */}
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI food lookups, AI meal suggestions, AI workouts, and Daily Recap Coach."
      />

      {/* Custom food + Bowl modals */}
      <CustomNutritionDialog
        open={openCustom}
        onClose={()=>setOpenCustom(false)}
        onConfirm={(item)=> logOne(item)}
      />

      <BuildBowlDialog
        open={openBowl}
        onClose={()=>setOpenBowl(false)}
        onConfirm={(item)=> logOne(item)}
      />
    </Container>
  );
}
