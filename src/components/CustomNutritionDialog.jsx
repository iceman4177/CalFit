// src/components/CustomNutritionDialog.jsx
import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Stack
} from '@mui/material';

function calcCalories({ calories, protein_g, carbs_g, fat_g }) {
  const p = Number(protein_g) || 0;
  const c = Number(carbs_g) || 0;
  const f = Number(fat_g) || 0;
  const calFromMacros = Math.round(p * 4 + c * 4 + f * 9);
  const cal = Number(calories);
  return Number.isFinite(cal) && cal > 0 ? Math.round(cal) : calFromMacros;
}

export default function CustomNutritionDialog({ open, onClose, onSubmit, initialName = "" }) {
  const [name, setName] = useState(initialName || "Custom Food");
  const [calories, setCalories] = useState("");
  const [protein_g, setProtein] = useState("");
  const [carbs_g, setCarbs] = useState("");
  const [fat_g, setFat] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialName || "Custom Food");
      setCalories("");
      setProtein("");
      setCarbs("");
      setFat("");
    }
  }, [open, initialName]);

  const handleSave = () => {
    const payload = {
      name: name?.trim() || "Custom Food",
      calories: calcCalories({ calories, protein_g, carbs_g, fat_g }),
      protein_g: Number(protein_g) || 0,
      carbs_g: Number(carbs_g) || 0,
      fat_g: Number(fat_g) || 0,
    };
    if (!payload.calories || payload.calories <= 0) {
      // require at least calories or some macros
      return alert("Enter calories or any macros (protein, carbs, fat) so we can compute calories.");
    }
    onSubmit?.(payload);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Log custom food</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25} sx={{ mt: 0.5 }}>
          <TextField
            label="Name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Calories (optional if macros set)"
            type="number"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              label="Protein (g)"
              type="number"
              value={protein_g}
              onChange={(e) => setProtein(e.target.value)}
              fullWidth
            />
            <TextField
              label="Carbs (g)"
              type="number"
              value={carbs_g}
              onChange={(e) => setCarbs(e.target.value)}
              fullWidth
            />
            <TextField
              label="Fat (g)"
              type="number"
              value={fat_g}
              onChange={(e) => setFat(e.target.value)}
              fullWidth
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="text">Cancel</Button>
        <Button onClick={handleSave} variant="contained">Add</Button>
      </DialogActions>
    </Dialog>
  );
}
