// src/HealthDataForm.jsx
import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography
} from '@mui/material';
import useFirstTimeTip from './hooks/useFirstTimeTip';

export default function HealthDataForm({ setUserData }) {
  const history = useHistory();

  // ---- First-time tips ----
  const [AgeTip, triggerAgeTip] = useFirstTimeTip(
    'tip_age',
    'Enter your age to personalize calculations.'
  );
  const [WeightTip, triggerWeightTip] = useFirstTimeTip(
    'tip_weight',
    'Enter your weight (lbs).'
  );
  const [FeetTip, triggerFeetTip] = useFirstTimeTip(
    'tip_heightFeet',
    'Enter height in feet.'
  );
  const [InchesTip, triggerInchesTip] = useFirstTimeTip(
    'tip_heightInches',
    'Enter height in inches.'
  );
  const [ActivityTip, triggerActivityTip] = useFirstTimeTip(
    'tip_activityLevel',
    'Select your activity level.'
  );
  const [GoalTip, triggerGoalTip] = useFirstTimeTip(
    'tip_dailyGoal',
    'Enter your daily calorie goal (kcal).'
  );
  const [GoalTypeTip, triggerGoalTypeTip] = useFirstTimeTip(
    'tip_goalType',
    'Select your fitness goal (bulking, cutting, or maintenance).'
  );
  // NEW: tips for the added fields
  const [DietPrefTip, triggerDietPrefTip] = useFirstTimeTip(
    'tip_dietPreference',
    'Pick the diet style that best matches how you like to eat.'
  );
  const [TrainingIntentTip, triggerTrainingIntentTip] = useFirstTimeTip(
    'tip_trainingIntent',
    'Tell us what you’re training for so we can tailor protein targets and workouts.'
  );

  // ---- Dropdown open states ----
  const [activityOpen, setActivityOpen] = useState(false);
  const [goalTypeOpen, setGoalTypeOpen] = useState(false);
  const [dietOpen, setDietOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);

  // ---- Form state ----
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState(''); // lbs
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [activityLevel, setActivityLevel] = useState('');
  const [dailyGoal, setDailyGoal] = useState('');
  const [goalType, setGoalType] = useState('');
  // NEW fields
  const [dietPreference, setDietPreference] = useState(
    localStorage.getItem('diet_preference') || 'omnivore'
  );
  const [trainingIntent, setTrainingIntent] = useState(
    localStorage.getItem('training_intent') || 'general'
  );

  // ---- Load any existing saved values ----
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('userData') || '{}');
    if (saved.age) setAge(saved.age);
    if (saved.weight) setWeight(saved.weight);
    if (saved.height?.feet) setHeightFeet(saved.height.feet);
    if (saved.height?.inches) setHeightInches(saved.height.inches);
    if (saved.activityLevel) setActivityLevel(saved.activityLevel);
    if (saved.dailyGoal) setDailyGoal(saved.dailyGoal);
    if (saved.goalType) setGoalType(saved.goalType);
    // keep previously saved diet/training intent if present
    const dp = localStorage.getItem('diet_preference');
    const ti = localStorage.getItem('training_intent');
    if (dp) setDietPreference(dp);
    if (ti) setTrainingIntent(ti);
  }, []);

  // ---- Helpers (science-backed defaults kept simple) ----
  const lbToKg = (lb) => (lb ? lb / 2.20462 : 0);

  // Protein per lb by training intent
  // (≈ ISSN-aligned: bodybuilder ~1.0 g/lb ≈ 2.2 g/kg; general 0.8; endurance/yoga ~0.7)
  const proteinPerLbByIntent = (intent) => {
    switch (intent) {
      case 'bodybuilder':  return 1.0;
      case 'powerlifter':  return 0.9;
      case 'recomp':       return 0.9;
      case 'endurance':    return 0.7;
      case 'yoga_pilates': return 0.7;
      default:             return 0.8; // general
    }
  };

  // Per-meal protein target ~0.25 g/kg (clamped to 20–40 g for practicality)
  const perMealProteinTarget = (weightKg) => {
    const g = Math.round(0.25 * weightKg);
    return Math.min(Math.max(g, 20), 40);
  };

  // Small calorie bias used by AI suggestions later (bulk/cut)
  const goalToCalorieBias = (goal) => {
    if (goal === 'bulking') return 300;   // modest surplus
    if (goal === 'cutting') return -500;  // sustainable deficit
    return 0; // maintenance
  };

  // ---------- LIVE PREVIEW (no new files) ----------
  const weightLbNum = Number(weight || '0');
  const weightKg = lbToKg(weightLbNum);
  const perLb = proteinPerLbByIntent(trainingIntent);
  const previewProteinDailyG = Math.round(perLb * weightLbNum || 0);
  const previewProteinMealG  = perMealProteinTarget(weightKg || 0);

  const proteinSourcesByDiet = {
    vegan: [
      'Tofu/Tempeh/Seitan',
      'Lentils & beans',
      'Edamame',
      'Vegan protein powder'
    ],
    vegetarian: [
      'Eggs/Greek yogurt',
      'Cottage cheese',
      'Lentils/beans',
      'Whey/casein (if ok)'
    ],
    pescatarian: [
      'Salmon/Tuna',
      'Shrimp',
      'Eggs/Greek yogurt',
      'Whey/casein'
    ],
    keto: [
      'Steak/Chicken/Salmon',
      'Eggs/Cheese',
      'Greek yogurt (low-carb)',
      'Protein isolate'
    ],
    mediterranean: [
      'Fish/Seafood',
      'Greek yogurt/Feta',
      'Lentils/Chickpeas',
      'Chicken/Turkey'
    ],
    omnivore: [
      'Chicken/Turkey/Lean beef',
      'Eggs/Greek yogurt',
      'Whey/Casein',
      'Beans/Lentils'
    ]
  };
  const sourceList = proteinSourcesByDiet[dietPreference] || proteinSourcesByDiet.omnivore;

  const handleSubmit = (e) => {
    e.preventDefault();

    // Base user data
    const baseData = {
      age,
      weight,
      height: { feet: heightFeet, inches: heightInches },
      activityLevel,
      dailyGoal: Number(dailyGoal),
      goalType
    };

    // Derived targets (commit the preview numbers)
    const calorieBias = goalToCalorieBias(goalType);

    const enriched = {
      ...baseData,
      lastLogDate: '',
      currentStreak: 0,
      showFirstTimeTips: true,
      showMealReminders: true,
      // New personalization fields
      dietPreference,
      trainingIntent,
      proteinTargets: {
        daily_g: previewProteinDailyG,
        per_meal_g: previewProteinMealG
      },
      calorieBias
    };

    // Persist for the rest of the app (meals/workouts/AI)
    localStorage.setItem('userData', JSON.stringify(enriched));
    localStorage.setItem('hasCompletedHealthData', 'true');
    localStorage.setItem('diet_preference', dietPreference);
    localStorage.setItem('training_intent', trainingIntent);
    localStorage.setItem('protein_target_daily_g', String(previewProteinDailyG));
    localStorage.setItem('protein_target_meal_g', String(previewProteinMealG));
    localStorage.setItem('calorie_bias', String(calorieBias));
    // Optional: keep a simple goal alias others already read
    localStorage.setItem('fitness_goal', goalType);

    setUserData(enriched);
    history.push('/');
  };

  return (
    <Container maxWidth="sm">
      {/* First-time tips */}
      <AgeTip />
      <WeightTip />
      <FeetTip />
      <InchesTip />
      <ActivityTip />
      <GoalTip />
      <GoalTypeTip />
      <DietPrefTip />
      <TrainingIntentTip />

      <Paper elevation={3} sx={{ p: 4, mt: 4, borderRadius: 2 }}>
        <Typography variant="h4" align="center" gutterBottom>
          Enter Your Health & Fitness Goals
        </Typography>

        <form onSubmit={handleSubmit} autoComplete="off">
          <Box sx={{ mb: 2 }}>
            <TextField
              label="Age"
              type="number"
              value={age}
              onFocus={triggerAgeTip}
              onChange={e => setAge(e.target.value)}
              fullWidth
              required
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <TextField
              label="Weight (lbs)"
              type="number"
              value={weight}
              onFocus={triggerWeightTip}
              onChange={e => setWeight(e.target.value)}
              fullWidth
              required
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label="Height (feet)"
              type="number"
              value={heightFeet}
              onFocus={triggerFeetTip}
              onChange={e => setHeightFeet(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Height (inches)"
              type="number"
              value={heightInches}
              onFocus={triggerInchesTip}
              onChange={e => setHeightInches(e.target.value)}
              fullWidth
              required
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <Select
              open={activityOpen}
              onOpen={() => triggerActivityTip(() => setActivityOpen(true))}
              onClose={() => setActivityOpen(false)}
              value={activityLevel}
              onChange={e => setActivityLevel(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>
                Select Activity Level
              </MenuItem>
              <MenuItem value="sedentary">Sedentary</MenuItem>
              <MenuItem value="light">Light Exercise</MenuItem>
              <MenuItem value="moderate">Moderate Exercise</MenuItem>
              <MenuItem value="intense">Intense Exercise</MenuItem>
            </Select>
          </Box>

          <Box sx={{ mb: 2 }}>
            <TextField
              label="Daily Calorie Goal (kcal)"
              type="number"
              value={dailyGoal}
              onFocus={triggerGoalTip}
              onChange={e => setDailyGoal(e.target.value)}
              fullWidth
              required
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <Select
              open={goalTypeOpen}
              onOpen={() => triggerGoalTypeTip(() => setGoalTypeOpen(true))}
              onClose={() => setGoalTypeOpen(false)}
              value={goalType}
              onChange={e => setGoalType(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>
                Select Fitness Goal
              </MenuItem>
              <MenuItem value="bulking">Bulking</MenuItem>
              <MenuItem value="cutting">Cutting</MenuItem>
              <MenuItem value="maintenance">Maintenance</MenuItem>
            </Select>
          </Box>

          {/* NEW: Diet Preference */}
          <Box sx={{ mb: 2 }}>
            <Select
              open={dietOpen}
              onOpen={() => triggerDietPrefTip(() => setDietOpen(true))}
              onClose={() => setDietOpen(false)}
              value={dietPreference}
              onChange={e => setDietPreference(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>
                Select Diet Preference
              </MenuItem>
              <MenuItem value="omnivore">Omnivore</MenuItem>
              <MenuItem value="vegan">Vegan</MenuItem>
              <MenuItem value="vegetarian">Vegetarian</MenuItem>
              <MenuItem value="pescatarian">Pescatarian</MenuItem>
              <MenuItem value="keto">Keto</MenuItem>
              <MenuItem value="mediterranean">Mediterranean</MenuItem>
            </Select>
          </Box>

          {/* NEW: Training Intent */}
          <Box sx={{ mb: 3 }}>
            <Select
              open={trainingOpen}
              onOpen={() => triggerTrainingIntentTip(() => setTrainingOpen(true))}
              onClose={() => setTrainingOpen(false)}
              value={trainingIntent}
              onChange={e => setTrainingIntent(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>
                Select Training Intent
              </MenuItem>
              <MenuItem value="general">General Fitness</MenuItem>
              <MenuItem value="bodybuilder">Bodybuilder (Hypertrophy)</MenuItem>
              <MenuItem value="powerlifter">Powerlifter (Strength)</MenuItem>
              <MenuItem value="endurance">Endurance / Cardio</MenuItem>
              <MenuItem value="yoga_pilates">Yoga / Pilates</MenuItem>
              <MenuItem value="recomp">Recomposition</MenuItem>
            </Select>
          </Box>

          {/* LIVE PREVIEW CARD — relatable, no extra files */}
          <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
            <Typography variant="h6" gutterBottom>
              Your Personalized Targets
            </Typography>
            <Typography variant="body2">
              Training mode: <b>{trainingIntent.replace('_', ' ')}</b>{' '}
              {goalType ? <>• Goal: <b>{goalType}</b></> : null}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Protein target: <b>{isFinite(previewProteinDailyG) ? previewProteinDailyG : 0} g/day</b> 
              {' '}(~<b>{isFinite(previewProteinMealG) ? previewProteinMealG : 0} g/meal</b>)
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Suggested sources ({dietPreference}): {sourceList.join(' • ')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Tip: Bodybuilders often aim for ~1g protein/lb; endurance & yoga can run lighter.
            </Typography>
          </Paper>

          <Button variant="contained" fullWidth type="submit">
            Save & Continue
          </Button>
        </form>
      </Paper>
    </Container>
  );
}
