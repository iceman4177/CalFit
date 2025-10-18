// src/MealTracker.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Typography, Box, TextField,
  Button, List, ListItem, ListItemText,
  Divider, Autocomplete, Alert, IconButton, Tooltip
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import foodData from './foodData.json';
import useFirstTimeTip from './hooks/useFirstTimeTip';
import { updateStreak } from './utils/streak';
import MealSuggestion from './MealSuggestion';
import UpgradeModal from './components/UpgradeModal';

// auth + db (history/backup; NOT used for today’s banner math)
import { useAuth } from './context/AuthProvider.jsx';
import { saveMeal, upsertDailyMetrics } from './lib/db';

const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};
const getMealAICount = () => parseInt(localStorage.getItem('aiMealCount') || '0', 10);
const incMealAICount = () => localStorage.setItem('aiMealCount', String(getMealAICount() + 1));

async function probeEntitlement(payload) {
  const base = { feature: 'meal', type: 'meal', mode: 'meal', ...payload, count: 1 };
  try {
    let resp = await fetch('/api/ai/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(base) });
    if (resp.status === 402) return { gated:true };
    if (resp.ok) return { gated:false };
    if (resp.status === 400 || resp.status === 404) {
      resp = await fetch('/api/ai/meal-suggestion', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(base) });
      if (resp.status === 402) return { gated:true };
      return { gated: !resp.ok };
    }
    return { gated: !resp.ok };
  } catch { return { gated:false }; }
}

function getBurnedTodayLocal(dateUS) {
  try {
    const all = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const entry = all.find(e => e.date === dateUS);
    return Number(entry?.totalCalories) || 0;
  } catch { return 0; }
}

export default function MealTracker({ onMealUpdate }) {
  const [FoodTip,  triggerFoodTip]  = useFirstTimeTip('tip_food',  'Search or type a food name.');
  const [CalTip,   triggerCalTip]   = useFirstTimeTip('tip_cal',   'Enter calories.');
  const [AddTip,   triggerAddTip]   = useFirstTimeTip('tip_add',   'Tap to add this meal.');
  const [ClearTip, triggerClearTip] = useFirstTimeTip('tip_clear', 'Tap to clear today’s meals.');

  const [foodInput, setFoodInput]       = useState('');
  const [selectedFood, setSelectedFood] = useState(null);
  const [calories, setCalories]         = useState('');
  const [mealLog, setMealLog]           = useState([]);
  const [showSuggest, setShowSuggest]   = useState(false);
  const [showUpgrade, setShowUpgrade]   = useState(false);

  const { user } = useAuth();

  // 🔒 Single source of "today": local US string + local-midnight ISO (prevents UTC drift)
  const now = new Date();
  const todayUS  = now.toLocaleDateString('en-US');                 // e.g., 10/17/2025 (LOCAL)
  const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                    .toISOString().slice(0,10);                     // YYYY-MM-DD at LOCAL midnight

  const stored   = JSON.parse(localStorage.getItem('userData')||'{}');
  const goalType = stored.goalType  || 'maintain';

  // Load today’s meals (local-first)
  useEffect(()=>{
    const all = JSON.parse(localStorage.getItem('mealHistory')||'[]');
    const todayLog = all.find(e=>e.date===todayUS);
    const meals = todayLog ? (todayLog.meals || []) : [];
    setMealLog(meals);
    const total = meals.reduce((s,m)=> s + (Number(m.calories)||0), 0);
    onMealUpdate?.(total);
  },[onMealUpdate,todayUS]);

  const persistToday = (meals) => {
    const rest = JSON.parse(localStorage.getItem('mealHistory')||'[]').filter(e=>e.date!==todayUS);
    rest.push({ date:todayUS, meals });
    localStorage.setItem('mealHistory', JSON.stringify(rest));
  };

  const emitConsumed = (total) => {
    try {
      window.dispatchEvent(new CustomEvent('slimcal:consumed:update', {
        detail: { date: todayISO, consumed: total }
      }));
    } catch {}
  };

  const syncDailyMetrics = async (consumedTotal) => {
    // optional cache for other components (not required anymore)
    const burned = getBurnedTodayLocal(todayUS);
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}');
    cache[todayISO] = { burned, consumed: consumedTotal, net: consumedTotal - burned };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
    localStorage.setItem('consumedToday', String(consumedTotal));
    emitConsumed(consumedTotal);

    // cloud upsert for history/backup
    try {
      if (user?.id) await upsertDailyMetrics(user.id, todayISO, burned, consumedTotal);
    } catch (err) {
      console.error('[MealTracker] upsertDailyMetrics failed', err);
    }
  };

  const save = (meals) => {
    persistToday(meals);
    const total = meals.reduce((s,m)=> s + (Number(m.calories)||0), 0);
    onMealUpdate?.(total);
    syncDailyMetrics(total);
  };

  const handleAdd = async () => {
    const c = Number.parseInt(calories,10);
    if (!foodInput.trim() || !Number.isFinite(c) || c <= 0) {
      alert('Enter a valid food & calories.');
      return;
    }
    const nm = { name: foodInput.trim(), calories: c };

    setMealLog(prev => {
      const upd = [...prev, nm];
      save(upd);
      return upd;
    });
    updateStreak();
    setFoodInput(''); setCalories(''); setSelectedFood(null);

    // optional: itemized cloud save
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
      }
    } catch (err) {
      console.error('[MealTracker] cloud save failed', err);
    }
  };

  const handleDeleteMeal = (index) => {
    setMealLog(prev => {
      const updatedMeals = prev.filter((_, i) => i !== index);
      save(updatedMeals);
      return updatedMeals;
    });
  };

  const handleClear = () => {
    const rest = JSON.parse(localStorage.getItem('mealHistory')||'[]').filter(e=>e.date!==todayUS);
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    setMealLog([]);
    onMealUpdate?.(0);
    syncDailyMetrics(0);
  };

  const handleAIMealSuggestClick = useCallback(async () => {
    if (!showSuggest) {
      if (!isProUser() && getMealAICount() >= 3) { setShowUpgrade(true); return; }
      try {
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
            calorie_bias: calorieBias || undefined,
          }
        };
        const { gated } = await probeEntitlement(probePayload);
        if (gated) { setShowUpgrade(true); return; }
      } catch (e) { console.warn('[MealTracker] gateway probe failed', e); }
      if (!isProUser()) incMealAICount();
      setShowSuggest(true);
      return;
    }
    setShowSuggest(false);
  }, [showSuggest, user?.id, goalType]);

  const total = mealLog.reduce((s,m)=> s + (Number(m.calories)||0), 0);

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
            const safeCalories = Number.isFinite(m.calories) ? Number(m.calories) : 0;
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
                    <IconButton edge="end" aria-label="delete meal" onClick={()=>handleDeleteMeal(i)}>
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemText primary={m.name} secondary={`${Number(m.calories)||0} cals`} />
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      )}

      <Typography variant="h6" align="right" sx={{mt:3}}>
        Total Calories: {total}
      </Typography>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI meal suggestions, unlimited AI workouts, Daily Recap Coach, and advanced insights."
      />
    </Container>
  );
}
