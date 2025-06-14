// src/MealTracker.jsx

import React, { useState, useEffect } from 'react';
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
  Alert,
  Autocomplete
} from '@mui/material';
import foodData from './foodData.json';
import useFirstTimeTip from './hooks/useFirstTimeTip';
import { updateStreak } from './utils/streak';

export default function MealTracker({ onMealUpdate }) {
  const [FoodTip, triggerFoodTip]     = useFirstTimeTip('tip_food', 'Search or type a food name.');
  const [CalTip, triggerCalTip]       = useFirstTimeTip('tip_cal', 'Enter the calories amount.');
  const [AddTip, triggerAddTip]       = useFirstTimeTip('tip_addMeal', 'Tap to add this meal.');
  const [ClearTip, triggerClearTip]   = useFirstTimeTip('tip_clearMeals', 'Tap to clear today’s meals.');

  const [foodInput, setFoodInput]     = useState('');
  const [selectedFood, setSelectedFood] = useState(null);
  const [calories, setCalories]       = useState('');
  const [mealLog, setMealLog]         = useState([]);

  const today = new Date().toLocaleDateString('en-US');

  // Load today's meals from localStorage
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayLog = saved.find(e => e.date === today);
    const meals = todayLog ? todayLog.meals : [];
    setMealLog(meals);
    onMealUpdate(meals.reduce((sum, m) => sum + m.calories, 0));
  }, [onMealUpdate, today]);

  // Persist meals & notify parent
  const saveMeals = meals => {
    const rest = JSON.parse(localStorage.getItem('mealHistory') || '[]').filter(
      e => e.date !== today
    );
    rest.push({ date: today, meals });
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    onMealUpdate(meals.reduce((sum, m) => sum + m.calories, 0));
  };

  // Add button handler
  const handleAdd = () => {
    const cal = parseInt(calories, 10);
    if (!foodInput.trim() || !cal || cal <= 0) {
      alert('Enter a valid food & calories.');
      return;
    }
    const newMeal = { name: foodInput.trim(), calories: cal };
    const updated = [...mealLog, newMeal];
    setMealLog(updated);
    saveMeals(updated);
    updateStreak();

    // clear inputs
    setFoodInput('');
    setCalories('');
    setSelectedFood(null);
  };

  // Clear button handler
  const handleClear = () => {
    const rest = JSON.parse(localStorage.getItem('mealHistory') || '[]').filter(
      e => e.date !== today
    );
    localStorage.setItem('mealHistory', JSON.stringify(rest));
    setMealLog([]);
    onMealUpdate(0);
  };

  // When user selects from dropdown
  const handleFoodChange = (_, v) => {
    setSelectedFood(v);
    if (v) {
      setFoodInput(v.name);
      setCalories(String(v.calories));
    }
  };

  // AI Suggestion handler
  const handleSuggest = async () => {
    try {
      const res  = await fetch('/api/suggestMeal');
      const data = await res.json();
      console.log('AI Suggestion response:', data);

      const suggestion = data.suggestion || '';
      // split on en-dash or hyphen
      const parts = suggestion.split(/–|-/);
      const namePart = parts[0]?.trim().replace(/\.$/, '') || '';
      // fallback: any digits
      const match = suggestion.match(/(\d+)/);
      const calPart = match ? match[1] : '';

      console.log('Parsed suggestion:', { namePart, calPart });

      // set both fields
      setFoodInput(namePart);
      setCalories(calPart);
      // setSelectedFood so Autocomplete shows it
      setSelectedFood({ name: namePart, calories: parseInt(calPart, 10) });
      triggerFoodTip();
      triggerCalTip();
    } catch (err) {
      console.error('Error fetching AI suggestion:', err);
      alert('Could not get AI suggestion.');
    }
  };

  // Compute total for display
  const total = mealLog.reduce((sum, m) => sum + m.calories, 0);

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" align="center" gutterBottom>
        Meal Tracker
      </Typography>

      {/* First-time tips */}
      <FoodTip />
      <CalTip />
      <AddTip />
      <ClearTip />

      {/* Food name & calories inputs */}
      <Box sx={{ mb: 2 }}>
        <Autocomplete
          freeSolo
          options={foodData}
          getOptionLabel={o => o.name}
          value={selectedFood}
          onFocus={triggerFoodTip}
          onChange={handleFoodChange}
          inputValue={foodInput}
          onInputChange={(_, v) => setFoodInput(v)}
          renderInput={params => <TextField {...params} label="Food Name" fullWidth />}
        />
        <TextField
          label="Calories"
          type="number"
          value={calories}
          onFocus={triggerCalTip}
          onChange={e => setCalories(e.target.value)}
          fullWidth
          sx={{ mt: 2 }}
        />
        {!selectedFood && foodInput.length > 2 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Not found — enter calories manually.
          </Alert>
        )}
      </Box>

      {/* Action buttons */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Button
          variant="contained"
          onClick={() => { triggerAddTip(); handleAdd(); }}
        >
          Add Meal
        </Button>
        <Button
          variant="outlined"
          color="error"
          onClick={() => { triggerClearTip(); handleClear(); }}
        >
          Clear Meals
        </Button>
        <Button variant="outlined" onClick={handleSuggest}>
          Suggest a Meal (AI)
        </Button>
      </Box>

      {/* Meal log */}
      <Typography variant="h6" gutterBottom>
        Meals Logged Today ({today})
      </Typography>
      {mealLog.length === 0 ? (
        <Typography>No meals added yet.</Typography>
      ) : (
        <List>
          {mealLog.map((m, i) => (
            <Box key={i}>
              <ListItem>
                <ListItemText primary={m.name} secondary={`${m.calories} cals`} />
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      )}

      {/* Total calories */}
      <Typography variant="h6" align="right" sx={{ mt: 3 }}>
        Total Calories: {total}
      </Typography>
    </Container>
  );
}
