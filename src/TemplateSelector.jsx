import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItemButton,
  ListItemText,
  Button
} from '@mui/material';

export default function TemplateSelector({ open, onClose, onLoadTemplate }) {
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    if (open) {
      const history = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
      setTemplates(history.reverse()); // most recent first
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Select a Workout Template</DialogTitle>
      <DialogContent dividers>
        {templates.length === 0 ? (
          <em>No past workouts found.</em>
        ) : (
          <List>
            {templates.map((session, idx) => (
              <ListItemButton
                key={idx}
                onClick={() => {
                  onLoadTemplate(session.exercises);
                  onClose();
                }}
              >
                <ListItemText
                  primary={`${session.exercises.length} exercises`}
                  secondary={`${session.date} — ${session.totalCalories.toFixed(2)} cals`}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
