import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Typography, Box, TextField,
  Button, List, ListItem, ListItemText,
  Divider, Autocomplete, Alert
} from '@mui/material';
import foodData from './foodData.json';
import useFirstTimeTip from './hooks/useFirstTimeTip';
import { updateStreak } from './utils/streak';
import MealSuggestion from './MealSuggestion';
import UpgradeModal from './components/UpgradeModal';

// ✅ NEW: auth + db
import { useAuth } from './context/AuthProvider.jsx';
import { saveMeal, upsertDailyMetrics } from './lib/db';

// ---- Pro gating helpers (kept as a client-side fallback) ----
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};

const getMealAICount = () =>
  parseInt(localStorage.getItem('aiMealCount') || '0', 10);

const incMealAICount = () =>
  localStorage.setItem('aiMealCount', String(getMealAICount() + 1));

// Lightweight POST for entitlement probe
async function probeEntitlement(payload) {
  // Try unified first with generous keys
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
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(base)
    });
    if (resp.status === 402) return { gated: true };
    if (resp.ok) return { gated: false };
    // try legacy if 400/404
    if (resp.status === 400 || resp.status === 404) {
      resp = await fetch('/api/ai/meal-suggestion', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(base)
      });
      if (resp.status === 402) return { gated: true };
      return { gated: !resp.ok };
    }
    return { gated: !resp.ok };
  } catch {
    // Network failure: do not falsely gate; allow UI and let MealSuggestion handle fallback
    return { gated: false };
  }
}

export default function MealTracker({ onMealUpdate }) {
  const [FoodTip,  triggerFoodTip]  = useFirstTimeTip('tip_food',  'Search or type a food name.');
  const [CalTip,   triggerCalTip]   = useFirstTimeTip('tip_cal',   'Enter calories.');
  const [AddTip,   triggerAddTip]   = useFirstTimeTip('tip_add',   'Tap to add this meal.');
  const [ClearTip, triggerClearTip] = useFirstTimeTip('tip_clear', 'Tap to clear today’s meals.');

  const [foodInput, setFoodInput]         = useState('');
  const [selectedFood, setSelectedFood]   = useState(null);
  const [calories, setCalories]           = useState('');
  const [mealLog, setMealLog]             = useState([]);
  const [showSuggest, setShowSuggest]     = useState(false);
  const [showUpgrade, setShowUpgrade]     = useState(false);

  // ✅ who is signed in (if any)
  const { user } = useAuth();

  const today       = new Date().toLocaleDateString('en-US');
  const stored      = JSON.parse(localStorage.getItem('userData')||'{}');
  const dailyGoal   = stored.dailyGoal || 0;
  const goalType    = stored.goalType  || 'maintain';
  const recentMeals = mealLog.map(m=>m.name);

  // Load today’s meals
  useEffect(()=>{
    const all = JSON.parse(localStorage.getItem('mealHistory')||'[]');
    const todayLog = all.find(e=>e.date===today);
    const meals = todayLog?todayLog.meals:[];
    setMealLog(meals);
    onMealUpdate(meals.reduce((s,m)=>s+(m.calories||0),0));
  },[onMealUpdate,today]);

  const save = meals => {
    const rest = JSON.parse(localStorage.getItem('mealHistory')||'[]')
      .filter(e=>e.date!==today);
    rest.push({ date:today, meals });
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    onMealUpdate(meals.reduce((s,m)=>s+(m.calories||0),0));
  };

  const handleAdd = async () => {
    const c = parseInt(calories,10);
    if (!foodInput.trim() || !Number.isFinite(c) || c <= 0) {
      return alert('Enter a valid food & calories.');
    }
    const nm = { name:foodInput.trim(), calories:c };
    const upd = [...mealLog,nm];
    setMealLog(upd); save(upd); updateStreak();
    setFoodInput(''); setCalories(''); setSelectedFood(null);

    // ✅ Cloud write-through (if logged in)
    try {
      if (user?.id) {
        const eatenISO = new Date().toISOString();
        await saveMeal(user.id, {
          eaten_at: eatenISO,
          title: nm.name,
          total_calories: nm.calories,
        }, [{
          food_name: nm.name, qty: 1, unit: 'serving',
          calories: nm.calories, protein: null, carbs: null, fat: null,
        }]);
        const day = eatenISO.slice(0,10);
        await upsertDailyMetrics(user.id, day, 0, nm.calories || 0);
      }
    } catch (err) {
      console.error('[MealTracker] cloud save failed', err);
    }
  };

  const handleClear = () => {
    const rest = JSON.parse(localStorage.getItem('mealHistory')||'[]')
      .filter(e=>e.date!==today);
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    setMealLog([]); onMealUpdate(0);
  };

  // ---- PRO GATE: Suggest a Meal (AI) ----
  // Keep your local 3/day fallback, but prefer server gating via /api/ai/generate
  const handleAIMealSuggestClick = useCallback(async () => {
    if (!showSuggest) {
      // quick client fallback
      if (!isProUser()) {
        const used = getMealAICount();
        if (used >= 3) {
          setShowUpgrade(true);
          return;
        }
      }

      // ping the gateway once to see if server wants to gate (returns 402)
      try {
        const dietPreference   = localStorage.getItem('diet_preference') || 'omnivore';
        const trainingIntent   = localStorage.getItem('training_intent') || 'general';
        const proteinMealG     = parseInt(localStorage.getItem('protein_target_meal_g') || '0',10);
        const calorieBias      = parseInt(localStorage.getItem('calorie_bias') || '0',10);

        const probePayload = {
          user_id: user?.id || null, // null triggers 402/login/upgrade path server-side
          goal: goalType || 'maintenance',
          constraints: {
            diet_preference: dietPreference,
            training_intent: trainingIntent,
            protein_per_meal_g: proteinMealG || undefined,
            calorie_bias: calorieBias || undefined,
          }
        };

        const { gated } = await probeEntitlement(probePayload);
        if (gated) {
          setShowUpgrade(true);
          return;
        }
        // ok to show the UI; MealSuggestion will do the real fetch
      } catch (e) {
        // if gateway unreachable, fall back to old behavior
        console.warn('[MealTracker] gateway probe failed, showing local suggestions UI', e);
      }

      if (!isProUser()) incMealAICount();
      setShowSuggest(true);
      return;
    }
    setShowSuggest(false);
  }, [showSuggest, user?.id, goalType]);

  const total = mealLog.reduce((s,m)=>s+(m.calories||0),0);

  return (
    <Container maxWidth="sm" sx={{py:4}}>
      <Typography variant="h4" align="center" gutterBottom>Meal Tracker</Typography>
      <FoodTip/><CalTip/><AddTip/><ClearTip/>

      <Box sx={{ mb:2 }}>
        <Autocomplete
          freeSolo
          options={foodData}
          getOptionLabel={o=>o.name}
          value={selectedFood}
          inputValue={foodInput}
          onChange={(_,v)=>{ setSelectedFood(v); if(v){ setFoodInput(v.name); setCalories(String(v.calories)); }}}
          onInputChange={(_,v)=>setFoodInput(v)}
          renderInput={p=><TextField {...p} label="Food Name" fullWidth />}
        />
        <TextField
          label="Calories" type="number"
          fullWidth sx={{mt:2}}
          value={calories}
          onFocus={triggerCalTip}
          onChange={e=>setCalories(e.target.value)}
        />
        {!selectedFood && foodInput.length>2 && (
          <Alert severity="info" sx={{mt:2}}>
            Not found — enter calories manually.
          </Alert>
        )}
      </Box>

      <Box sx={{ display:'flex', gap:2, mb:3, justifyContent:'center' }}>
        <Button variant="contained" onClick={()=>{triggerAddTip();handleAdd();}}>
          Add Meal
        </Button>
        <Button variant="outlined" color="error" onClick={()=>{triggerClearTip();handleClear();}}>
          Clear Meals
        </Button>
        <Button variant="outlined" onClick={handleAIMealSuggestClick}>
          {showSuggest ? "Hide Suggestions" : "Suggest a Meal (AI)"}
        </Button>
      </Box>

      {showSuggest && (
        <MealSuggestion
          consumedCalories={total}
          onAddMeal={m=>{
            const safeCalories = Number.isFinite(m.calories) ? m.calories : 0;
            const nm={ name:m.name, calories:safeCalories };
            const upd=[...mealLog,nm];
            setMealLog(upd);
            save(upd);
            updateStreak();
          }}
        />
      )}

      <Typography variant="h6" gutterBottom sx={{mt:4}}>
        Meals Logged Today ({today})
      </Typography>
      {mealLog.length===0
        ? <Typography>No meals added yet.</Typography>
        : (
          <List>
            {mealLog.map((m,i)=>
              <Box key={i}>
                <ListItem>
                  <ListItemText primary={m.name} secondary={`${m.calories||0} cals`} />
                </ListItem>
                <Divider/>
              </Box>
            )}
          </List>
        )}

      <Typography variant="h6" align="right" sx={{mt:3}}>
        Total Calories: {total}
      </Typography>

      {/* Paywall modal */}
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI meal suggestions, unlimited AI workouts, Daily Recap Coach, and advanced insights."
      />
    </Container>
  );
}
