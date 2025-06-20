// src/MealTracker.jsx
import React, { useState, useEffect } from 'react';
import {
  Container, Typography, Box, TextField,
  Button, List, ListItem, ListItemText,
  Divider, Autocomplete, Alert
} from '@mui/material';
import foodData from './foodData.json';
import useFirstTimeTip from './hooks/useFirstTimeTip';
import { updateStreak } from './utils/streak';
import MealSuggestion from './MealSuggestion';

export default function MealTracker({ onMealUpdate }) {
  const [FoodTip, triggerFoodTip]   = useFirstTimeTip('tip_food', 'Search or type a food name.');
  const [CalTip,  triggerCalTip]    = useFirstTimeTip('tip_cal',  'Enter calories.');
  const [AddTip,  triggerAddTip]    = useFirstTimeTip('tip_add',  'Tap to add this meal.');
  const [ClearTip,triggerClearTip]  = useFirstTimeTip('tip_clear','Tap to clear today’s meals.');

  const [foodInput, setFoodInput]     = useState('');
  const [selectedFood, setSelectedFood] = useState(null);
  const [calories, setCalories]       = useState('');
  const [mealLog, setMealLog]         = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);

  const today      = new Date().toLocaleDateString('en-US');
  const stored     = JSON.parse(localStorage.getItem('userData')||'{}');
  const dailyGoal  = stored.dailyGoal || 0;
  const goalType   = stored.goalType  || 'maintain';
  const recentMeals= mealLog.map(m=>m.name);

  // load
  useEffect(()=>{
    const all = JSON.parse(localStorage.getItem('mealHistory')||'[]');
    const todayLog = all.find(e=>e.date===today);
    const meals = todayLog?todayLog.meals:[];
    setMealLog(meals);
    onMealUpdate(meals.reduce((s,m)=>s+m.calories,0));
  },[onMealUpdate,today]);

  const save = meals => {
    const rest = JSON.parse(localStorage.getItem('mealHistory')||'[]')
      .filter(e=>e.date!==today);
    rest.push({ date:today, meals });
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    onMealUpdate(meals.reduce((s,m)=>s+m.calories,0));
  };

  const handleAdd = () => {
    const c = parseInt(calories,10);
    if (!foodInput.trim()||!c||c<=0) {
      return alert('Enter a valid food & calories.');
    }
    const nm = { name:foodInput.trim(), calories:c };
    const upd = [...mealLog,nm];
    setMealLog(upd); save(upd); updateStreak();
    setFoodInput(''); setCalories(''); setSelectedFood(null);
  };

  const handleClear = () => {
    const rest = JSON.parse(localStorage.getItem('mealHistory')||'[]')
      .filter(e=>e.date!==today);
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    setMealLog([]); onMealUpdate(0);
  };

  const total = mealLog.reduce((s,m)=>s+m.calories,0);

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
        <Button
          variant="outlined"
          onClick={()=>{setShowSuggest(!showSuggest);}}
        >
          Suggest a Meal (AI)
        </Button>
      </Box>

      {showSuggest && (
        <MealSuggestion
          consumedCalories={total}
          onAddMeal={m=>{
            const nm={ name:m.name, calories:m.calories };
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
                  <ListItemText primary={m.name} secondary={`${m.calories} cals`} />
                </ListItem>
                <Divider/>
              </Box>
            )}
          </List>
        )}

      <Typography variant="h6" align="right" sx={{mt:3}}>
        Total Calories: {total}
      </Typography>
    </Container>
  );
}
