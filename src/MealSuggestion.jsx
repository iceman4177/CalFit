// src/MealSuggestion.jsx
import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography
} from '@mui/material';

const suggestions = [
  { name: 'Chicken Bowl', calories: 550 },
  { name: 'Turkey Sandwich', calories: 400 },
  { name: 'Protein Shake', calories: 250 },
  { name: 'Greek Yogurt & Berries', calories: 180 },
  { name: 'Salmon & Rice', calories: 600 },
  { name: 'Veggie Wrap', calories: 350 },
  { name: 'Egg Omelette', calories: 300 },
  { name: 'Beef Stir Fry', calories: 500 },
];

export default function MealSuggestion({ netCalories, onAddMeal }) {
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  const handleSuggest = () => {
    let match;
    if (netCalories < -500) {
      match = suggestions.find(s => s.calories >= 500) || suggestions[0];
    } else if (netCalories < 0) {
      match = suggestions.find(s => s.calories >= 300 && s.calories <= 500) || suggestions[0];
    } else {
      match = suggestions.find(s => s.calories <= 300) || suggestions[0];
    }
    setSuggestion(match);
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const handleAdd = () => {
    onAddMeal(suggestion);
    setOpen(false);
  };

  return (
    <>
      <Button variant="outlined" onClick={handleSuggest} sx={{ mt: 2 }}>
        Suggest a Meal
      </Button>
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>🍽 Suggested Meal</DialogTitle>
        <DialogContent>
          <Typography variant="h6">{suggestion?.name}</Typography>
          <Typography>Calories: {suggestion?.calories}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd}>Add Meal</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
