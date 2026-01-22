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
  Typography,
  Checkbox,
  ListItemText
} from '@mui/material';
import useFirstTimeTip from './hooks/useFirstTimeTip';
import { supabase } from './lib/supabaseClient';

function getHealthSeenKeyForUser(userId) {
  return userId ? `slimcal:healthFormSeen:user:${userId}:v1` : 'slimcal:healthFormSeen:anon:v1';
}

function getHealthSyncedKeyForUser(userId) {
  return userId ? `slimcal:healthFormSynced:user:${userId}:v1` : '';
}

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
  // NEW: tips for added fields
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
  const [splitOpen, setSplitOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [equipOpen, setEquipOpen] = useState(false);

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
  const [trainingSplit, setTrainingSplit] = useState(
    localStorage.getItem('training_split') || 'full_body'
  );
  const [lastFocus, setLastFocus] = useState(
    localStorage.getItem('last_focus') || 'upper'
  );
  const [equipment, setEquipment] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('equipment_list') || '[]');
      return Array.isArray(saved) && saved.length ? saved : ['dumbbell', 'barbell', 'machine', 'bodyweight'];
    } catch {
      return ['dumbbell', 'barbell', 'machine', 'bodyweight'];
    }
  });

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

    // already initialized diet/trainingIntent from localStorage above
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

  // ---------- LIVE PREVIEW ----------
  const weightLbNum = Number(weight || '0');
  const weightKg = lbToKg(weightLbNum);
  const perLb = proteinPerLbByIntent(trainingIntent);
  const previewProteinDailyG = Math.round(perLb * weightLbNum || 0);
  const previewProteinMealG  = perMealProteinTarget(weightKg || 0);

  const proteinSourcesByDiet = {
    vegan: ['Tofu/Tempeh/Seitan','Lentils & beans','Edamame','Vegan protein powder'],
    vegetarian: ['Eggs/Greek yogurt','Cottage cheese','Lentils/beans','Whey/casein (if ok)'],
    pescatarian: ['Salmon/Tuna','Shrimp','Eggs/Greek yogurt','Whey/casein'],
    keto: ['Steak/Chicken/Salmon','Eggs/Cheese','Greek yogurt (low-carb)','Protein isolate'],
    mediterranean: ['Fish/Seafood','Greek yogurt/Feta','Lentils/Chickpeas','Chicken/Turkey'],
    omnivore: ['Chicken/Turkey/Lean beef','Eggs/Greek yogurt','Whey/Casein','Beans/Lentils']
  };
  const sourceList = proteinSourcesByDiet[dietPreference] || proteinSourcesByDiet.omnivore;

  // Equipment options
  const EQUIP_OPTIONS = [
    'bodyweight',
    'dumbbell',
    'barbell',
    'kettlebell',
    'machine',
    'cable',
    'bands'
  ];

  const handleSubmit = async (e) => {
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
      trainingSplit,
      lastFocus,
      equipment,
      proteinTargets: {
        daily_g: previewProteinDailyG,
        per_meal_g: previewProteinMealG
      },
      calorieBias
    };

    // Persist for the rest of the app (meals/workouts/AI)
    localStorage.setItem('userData', JSON.stringify(enriched));
    localStorage.setItem('hasCompletedHealthData', 'true');

    // Keys used by AI endpoints/components
    localStorage.setItem('diet_preference', dietPreference);
    localStorage.setItem('training_intent', trainingIntent);
    localStorage.setItem('training_split', trainingSplit);
    localStorage.setItem('last_focus', lastFocus);
    localStorage.setItem('equipment_list', JSON.stringify(equipment));

    localStorage.setItem('protein_target_daily_g', String(previewProteinDailyG));
    localStorage.setItem('protein_target_meal_g', String(previewProteinMealG));
    localStorage.setItem('calorie_bias', String(calorieBias));
    // Alias some components already read
    localStorage.setItem('fitness_goal', goalType);

    // ✅ Mark the form "seen" once (anon OR per-user)
    let authedUser = null;
    try {
      const { data } = await supabase.auth.getUser();
      authedUser = data?.user ?? null;
    } catch {}

    const seenKey = getHealthSeenKeyForUser(authedUser?.id || null);
    try { localStorage.setItem(seenKey, 'true'); } catch {}

    // ✅ If logged in: sync health to Supabase user metadata (no DB schema needed)
    if (authedUser?.id) {
      const syncedKey = getHealthSyncedKeyForUser(authedUser.id);

      try {
        await supabase.auth.updateUser({
          data: {
            slimcal_health_v1: {
              age: enriched.age,
              weight: enriched.weight,
              height: enriched.height,
              activityLevel: enriched.activityLevel,
              dailyGoal: enriched.dailyGoal,
              goalType: enriched.goalType,

              dietPreference: enriched.dietPreference,
              trainingIntent: enriched.trainingIntent,
              trainingSplit: enriched.trainingSplit,
              lastFocus: enriched.lastFocus,
              equipment: enriched.equipment,

              proteinTargets: enriched.proteinTargets,
              calorieBias: enriched.calorieBias,
            },
          },
        });

        if (syncedKey) {
          try { localStorage.setItem(syncedKey, 'true'); } catch {}
        }
      } catch (err) {
        console.warn('[HealthDataForm] Failed to sync to Supabase metadata', err);
      }
    }

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
          <Box sx={{ mb: 2 }}>
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

          {/* NEW: Training Split */}
          <Box sx={{ mb: 2 }}>
            <Select
              open={splitOpen}
              onOpen={() => setSplitOpen(true)}
              onClose={() => setSplitOpen(false)}
              value={trainingSplit}
              onChange={e => setTrainingSplit(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>
                Select Training Split
              </MenuItem>
              <MenuItem value="full_body">Full Body</MenuItem>
              <MenuItem value="upper_lower">Upper / Lower</MenuItem>
              <MenuItem value="push_pull_legs">Push / Pull / Legs</MenuItem>
              <MenuItem value="chest_back">Chest &amp; Back</MenuItem>
              <MenuItem value="legs_only">Legs Only</MenuItem>
              <MenuItem value="cardio_only">Cardio Day</MenuItem>
              <MenuItem value="yoga_pilates">Yoga / Pilates</MenuItem>
            </Select>
          </Box>

          {/* NEW: Preferred Focus (fallback) */}
          <Box sx={{ mb: 2 }}>
            <Select
              open={focusOpen}
              onOpen={() => setFocusOpen(true)}
              onClose={() => setFocusOpen(false)}
              value={lastFocus}
              onChange={e => setLastFocus(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>
                Preferred Focus (fallback)
              </MenuItem>
              <MenuItem value="upper">Upper</MenuItem>
              <MenuItem value="lower">Lower</MenuItem>
              <MenuItem value="full">Full Body</MenuItem>
            </Select>
          </Box>

          {/* NEW: Equipment (multi-select) */}
          <Box sx={{ mb: 3 }}>
            <Select
              multiple
              open={equipOpen}
              onOpen={() => setEquipOpen(true)}
              onClose={() => setEquipOpen(false)}
              value={equipment}
              onChange={(e) => {
                const value = e.target.value;
                setEquipment(typeof value === 'string' ? value.split(',') : value);
              }}
              fullWidth
              renderValue={(selected) => (selected || []).join(', ')}
            >
              {EQUIP_OPTIONS.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  <Checkbox checked={equipment.indexOf(opt) > -1} />
                  <ListItemText primary={opt.charAt(0).toUpperCase() + opt.slice(1)} />
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary">
              Used by the AI workout to only choose feasible movements.
            </Typography>
          </Box>

          {/* LIVE PREVIEW CARD — no extra files */}
          <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
            <Typography variant="h6" gutterBottom>
              Your Personalized Targets
            </Typography>
            <Typography variant="body2">
              Training mode: <b>{trainingIntent.replace('_', ' ')}</b> • Split:{' '}
              <b>{trainingSplit.replaceAll('_', ' ')}</b>
              {goalType ? <> • Goal: <b>{goalType}</b></> : null}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Protein target: <b>{isFinite(previewProteinDailyG) ? previewProteinDailyG : 0} g/day</b>{' '}
              (~<b>{isFinite(previewProteinMealG) ? previewProteinMealG : 0} g/meal</b>)
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Equipment: {equipment.join(', ')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Suggested sources ({dietPreference}): {sourceList.join(' • ')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Tip: Bodybuilders often aim for ~1g protein/lb; endurance &amp; yoga can run lighter.
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
