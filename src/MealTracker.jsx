// MealTracker.jsx
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

function MealTracker({ onMealUpdate, refreshCalories }) {
  const [foodInput, setFoodInput] = useState('');
  const [selectedFood, setSelectedFood] = useState(null);
  const [calories, setCalories] = useState('');
  const [mealLog, setMealLog] = useState([]);
  const today = new Date().toLocaleDateString('en-US');

  useEffect(() => {
    const savedMeals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayLog = savedMeals.find((entry) => entry.date === today);
    const meals = todayLog ? todayLog.meals : [];
    setMealLog(meals);
    onMealUpdate(meals.reduce((sum, m) => sum + m.calories, 0));
  }, []);

  const saveMeals = (meals) => {
    const saved = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const filtered = saved.filter((e) => e.date !== today);
    filtered.push({ date: today, meals });
    localStorage.setItem('mealHistory', JSON.stringify(filtered));
    onMealUpdate(meals.reduce((sum, m) => sum + m.calories, 0));
    refreshCalories();
  };

  const handleAddMeal = () => {
    const cal = parseInt(calories, 10);
    if (!foodInput.trim() || !cal || cal <= 0) {
      alert('Please enter a valid food and calorie value.');
      return;
    }
    const newMeal = { name: foodInput.trim(), calories: cal };
    const updated = [...mealLog, newMeal];
    setMealLog(updated);
    saveMeals(updated);
    setFoodInput('');
    setSelectedFood(null);
    setCalories('');
  };

  const handleClearMeals = () => {
    const saved = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const filtered = saved.filter((entry) => entry.date !== today);
    localStorage.setItem('mealHistory', JSON.stringify(filtered));
    setMealLog([]);
    onMealUpdate(0);
    refreshCalories();
  };

  const handleFoodChange = (e, value) => {
    setSelectedFood(value);
    if (value) {
      setFoodInput(value.name);
      setCalories(String(value.calories));
    } else {
      setCalories('');
    }
  };

  const totalCalories = mealLog.reduce((sum, m) => sum + m.calories, 0);

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" align="center" gutterBottom>
        Meal Tracker
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Autocomplete
          options={foodData}
          getOptionLabel={(option) => option.name}
          value={selectedFood}
          onChange={handleFoodChange}
          inputValue={foodInput}
          onInputChange={(e, v) => setFoodInput(v)}
          renderInput={(params) => <TextField {...params} label="Food Name" fullWidth />}
        />

        <TextField
          label="Calories"
          type="number"
          value={calories}
          onChange={(e) => setCalories(e.target.value)}
          fullWidth
          sx={{ mt: 2 }}
        />

        {!selectedFood && foodInput.length > 2 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Food not found in free lookup. You can enter calories manually.
          </Alert>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <Button variant="contained" onClick={handleAddMeal}>
          Add Meal
        </Button>
        <Button variant="outlined" color="error" onClick={handleClearMeals}>
          Clear Meals
        </Button>
      </Box>

      <Typography variant="h6" gutterBottom>
        Meals Logged Today ({today})
      </Typography>
      {mealLog.length === 0 ? (
        <Typography>No meals added yet.</Typography>
      ) : (
        <List>
          {mealLog.map((meal, i) => (
            <Box key={i}>
              <ListItem>
                <ListItemText primary={meal.name} secondary={`${meal.calories} calories`} />
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      )}

      <Typography variant="h6" align="right" sx={{ mt: 3 }}>
        Total Calories: {totalCalories}
      </Typography>
    </Container>
  );
}

export default MealTracker;
