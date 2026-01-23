// src/HealthDataForm.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Divider,
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
  return userId ? `slimcal:healthFormSynced:user:${userId}:v1` : 'slimcal:healthFormSynced:anon:v1';
}

const activityOptions = [
  { value: 'sedentary', label: 'Sedentary (little to no exercise)', mult: 1.2 },
  { value: 'light', label: 'Light (1-3 days/week)', mult: 1.375 },
  { value: 'moderate', label: 'Moderate (3-5 days/week)', mult: 1.55 },
  { value: 'active', label: 'Active (6-7 days/week)', mult: 1.725 }
];

const goalTypes = [
  { value: 'cutting', label: 'Cutting (lose fat)' },
  { value: 'bulking', label: 'Bulking (gain muscle)' },
  { value: 'maintenance', label: 'Maintenance (recomp/hold)' }
];

const dietOptions = [
  { value: 'omnivore', label: 'Omnivore' },
  { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'keto', label: 'Keto' },
  { value: 'mediterranean', label: 'Mediterranean' }
];

const trainingIntentOptions = [
  { value: 'general', label: 'General fitness' },
  { value: 'strength', label: 'Strength' },
  { value: 'hypertrophy', label: 'Hypertrophy (muscle gain)' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'athletic', label: 'Athletic performance' }
];

const splitOptions = [
  { value: 'full_body', label: 'Full Body' },
  { value: 'upper_lower', label: 'Upper/Lower' },
  { value: 'push_pull_legs', label: 'Push/Pull/Legs' },
  { value: 'bro_split', label: 'Bro Split (1 body part/day)' },
  { value: 'custom', label: 'Custom' }
];

const focusOptions = [
  { value: 'none', label: 'No specific focus' },
  { value: 'upper_chest', label: 'Upper chest' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'arms', label: 'Arms' },
  { value: 'back', label: 'Back' },
  { value: 'glutes', label: 'Glutes' },
  { value: 'quads', label: 'Quads' },
  { value: 'hamstrings', label: 'Hamstrings' },
  { value: 'calves', label: 'Calves' },
  { value: 'abs', label: 'Abs' }
];

const equipmentOptions = [
  'Full gym',
  'Dumbbells only',
  'Barbell only',
  'Machines',
  'Bands',
  'Bodyweight only'
];

// --- Helpers ---
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function goalToCalorieBias(goalType) {
  if (goalType === 'cutting') return -300;
  if (goalType === 'bulking') return 250;
  return 0;
}

function estimateProteinTargets({ weightLbs, goalType }) {
  const w = num(weightLbs);
  const base = goalType === 'cutting' ? 0.9 : goalType === 'bulking' ? 0.8 : 0.75;
  const daily = Math.round(clamp(w * base, 90, 220));
  const perMeal = Math.round(clamp(daily / 3, 25, 60));
  return { daily, perMeal };
}

function getActivityMultiplier(activityLevel) {
  const opt = activityOptions.find((a) => a.value === activityLevel);
  return opt?.mult || 1.2;
}

// Mifflin–St Jeor (metric):
// male:   BMR = 10*kg + 6.25*cm - 5*age + 5
// female: BMR = 10*kg + 6.25*cm - 5*age - 161
function estimateBmrMifflin({ gender, ageYears, weightLbs, heightFeet, heightInches }) {
  const age = num(ageYears);
  const lbs = num(weightLbs);
  const ft = num(heightFeet);
  const inch = num(heightInches);

  if (!age || !lbs || (!ft && !inch) || !gender) return 0;

  const kg = lbs * 0.45359237;
  const cm = (ft * 12 + inch) * 2.54;

  const base = 10 * kg + 6.25 * cm - 5 * age;
  if (String(gender).toLowerCase() === 'male') return Math.round(base + 5);
  if (String(gender).toLowerCase() === 'female') return Math.round(base - 161);
  return 0;
}

function roundToNearest(n, step = 25) {
  const x = num(n);
  if (!x) return 0;
  return Math.round(x / step) * step;
}

export default function HealthDataForm({ setUserData }) {
  const history = useHistory();

  // Dropdown open controls
  const [activityOpen, setActivityOpen] = useState(false);
  const [goalTypeOpen, setGoalTypeOpen] = useState(false);
  const [dietOpen, setDietOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [equipOpen, setEquipOpen] = useState(false);

  // Fields
  const [age, setAge] = useState('');
  const [gender, setGender] = useState(() => {
    try {
      const ud = JSON.parse(localStorage.getItem('userData') || '{}') || {};
      return ud?.gender || localStorage.getItem('gender') || '';
    } catch {
      return localStorage.getItem('gender') || '';
    }
  });
  const [weight, setWeight] = useState(''); // lbs
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [activityLevel, setActivityLevel] = useState('');
  const [dailyGoal, setDailyGoal] = useState('');
  const [goalType, setGoalType] = useState('');

  const [dietPreference, setDietPreference] = useState(
    localStorage.getItem('diet_preference') || 'omnivore'
  );
  const [trainingIntent, setTrainingIntent] = useState(
    localStorage.getItem('training_intent') || 'general'
  );
  const [trainingSplit, setTrainingSplit] = useState(
    localStorage.getItem('training_split') || 'upper_lower'
  );
  const [lastFocus, setLastFocus] = useState(
    localStorage.getItem('last_focus') || 'none'
  );

  const [equipment, setEquipment] = useState(() => {
    try {
      const raw = localStorage.getItem('equipment_list');
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : ['Full gym'];
    } catch {
      return ['Full gym'];
    }
  });

  // Load saved userData on mount
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('userData') || '{}');

    if (saved.age != null && saved.age !== '') setAge(String(saved.age));
    if (saved.gender) setGender(saved.gender);
    if (saved.weight) setWeight(saved.weight);
    if (saved.height?.feet) setHeightFeet(saved.height.feet);
    if (saved.height?.inches) setHeightInches(saved.height.inches);
    if (saved.activityLevel) setActivityLevel(saved.activityLevel);
    if (saved.dailyGoal) setDailyGoal(saved.dailyGoal);
    if (saved.goalType) setGoalType(saved.goalType);

    if (saved.dietPreference) setDietPreference(saved.dietPreference);
    if (saved.trainingIntent) setTrainingIntent(saved.trainingIntent);
    if (saved.trainingSplit) setTrainingSplit(saved.trainingSplit);
    if (saved.lastFocus) setLastFocus(saved.lastFocus);
    if (Array.isArray(saved.equipment) && saved.equipment.length) setEquipment(saved.equipment);
  }, []);

  // First-time tips
  const [AgeTip, triggerAgeTip] = useFirstTimeTip(
    'tip_age_v1',
    'Your age helps personalize targets and Daily Evaluation context.',
    { auto: false }
  );
  const [GenderTip, triggerGenderTip] = useFirstTimeTip(
    'tip_gender_v1',
    'Gender is used for BMR (baseline calories) and more accurate Daily Evaluation guidance.',
    { auto: false }
  );
  const [WeightTip, triggerWeightTip] = useFirstTimeTip(
    'tip_weight_v1',
    'Weight is used to estimate protein targets and energy needs.',
    { auto: false }
  );
  const [FeetTip, triggerFeetTip] = useFirstTimeTip(
    'tip_height_feet_v1',
    'Height helps estimate baseline metabolism.',
    { auto: false }
  );
  const [InchesTip, triggerInchesTip] = useFirstTimeTip(
    'tip_height_inches_v1',
    'Almost there — inches completes your height.',
    { auto: false }
  );
  const [ActivityTip, triggerActivityTip] = useFirstTimeTip(
    'tip_activity_v1',
    'Activity level influences calorie targets.',
    { auto: false }
  );
  const [GoalTip, triggerGoalTip] = useFirstTimeTip(
    'tip_goal_v1',
    'Daily calorie goal becomes your default target.',
    { auto: false }
  );
  const [GoalTypeTip, triggerGoalTypeTip] = useFirstTimeTip(
    'tip_goaltype_v1',
    'Goal type helps the app decide whether you should be in a deficit, surplus, or balanced.',
    { auto: false }
  );
  const [DietPrefTip, triggerDietPrefTip] = useFirstTimeTip(
    'tip_dietpref_v1',
    'Diet preference helps tailor meal suggestions and protein examples.',
    { auto: false }
  );
  const [TrainingIntentTip, triggerTrainingIntentTip] = useFirstTimeTip(
    'tip_trainingintent_v1',
    'Training intent helps Daily Evaluation interpret workout signal.',
    { auto: false }
  );

  // Preview protein targets
  const { daily: previewProteinDailyG, perMeal: previewProteinMealG } = useMemo(() => {
    return estimateProteinTargets({ weightLbs: weight, goalType });
  }, [weight, goalType]);

  // ✅ BMR / TDEE / Recommended calories (goal-adjusted)
  const bmr = useMemo(() => {
    return estimateBmrMifflin({
      gender,
      ageYears: age,
      weightLbs: weight,
      heightFeet,
      heightInches
    });
  }, [gender, age, weight, heightFeet, heightInches]);

  const tdee = useMemo(() => {
    const mult = getActivityMultiplier(activityLevel);
    if (!bmr) return 0;
    return Math.round(bmr * mult);
  }, [bmr, activityLevel]);

  const recommendedDailyCalories = useMemo(() => {
    if (!tdee) return 0;
    const bias = goalToCalorieBias(goalType);
    return roundToNearest(tdee + bias, 25);
  }, [tdee, goalType]);

  const showRecommendation = !!recommendedDailyCalories && !!gender && !!activityLevel && num(age) > 0 && num(weight) > 0;

  const handleUseRecommendation = () => {
    if (!recommendedDailyCalories) return;
    setDailyGoal(String(recommendedDailyCalories));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Basic validation
    const ageN = num(age);
    if (!ageN || ageN < 13 || ageN > 99) {
      alert('Please enter a valid age (13–99).');
      return;
    }
    if (!gender) {
      alert('Please select a gender so we can estimate BMR accurately.');
      return;
    }

    // Base user data
    const baseData = {
      age: Number(age),
      gender,
      weight: Number(weight),
      height: { feet: Number(heightFeet), inches: Number(heightInches) },
      activityLevel,
      dailyGoal: Number(dailyGoal),
      goalType
    };

    // Derived targets
    const calorieBias = goalToCalorieBias(goalType);

    const enriched = {
      ...baseData,
      lastLogDate: '',
      currentStreak: 0,
      showFirstTimeTips: true,
      showMealReminders: true,
      dietPreference,
      trainingIntent,
      trainingSplit,
      lastFocus,
      equipment,
      proteinTargets: {
        daily_g: previewProteinDailyG,
        per_meal_g: previewProteinMealG
      },
      calorieBias,
      // Optional computed values (helpful later for coach/eval without recomputing)
      bmr_est: bmr || null,
      tdee_est: tdee || null
    };

    // Persist for the rest of the app
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
    localStorage.setItem('fitness_goal', goalType);
    localStorage.setItem('gender', gender);

    if (bmr) localStorage.setItem('bmr_est', String(bmr));
    if (tdee) localStorage.setItem('tdee_est', String(tdee));

    // Mark "seen" once
    let authedUser = null;
    try {
      const { data } = await supabase.auth.getUser();
      authedUser = data?.user ?? null;
    } catch {}

    const seenKey = getHealthSeenKeyForUser(authedUser?.id || null);
    try { localStorage.setItem(seenKey, 'true'); } catch {}

    // If logged in: sync to Supabase user metadata (no DB schema needed)
    if (authedUser?.id) {
      const syncedKey = getHealthSyncedKeyForUser(authedUser.id);

      try {
        await supabase.auth.updateUser({
          data: {
            slimcal_health_v1: {
              age: enriched.age,
              gender: enriched.gender,
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
              bmr_est: enriched.bmr_est,
              tdee_est: enriched.tdee_est
            }
          }
        });
        try { localStorage.setItem(syncedKey, 'true'); } catch {}
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
      <GenderTip />
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
              label="Age (years)"
              type="number"
              inputProps={{ min: 13, max: 99, step: 1 }}
              helperText="Used for calorie/protein targets and Daily Evaluation context."
              value={age}
              onFocus={triggerAgeTip}
              onChange={e => setAge(e.target.value)}
              fullWidth
              required
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Gender (for BMR)
            </Typography>
            <Select
              value={gender}
              onFocus={triggerGenderTip}
              onChange={(e) => setGender(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>Select your gender</MenuItem>
              <MenuItem value="male">Male</MenuItem>
              <MenuItem value="female">Female</MenuItem>
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Used to estimate baseline calories (BMR).
            </Typography>
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
            <Typography variant="subtitle2" gutterBottom>
              Activity Level
            </Typography>
            <Select
              open={activityOpen}
              onOpen={() => setActivityOpen(true)}
              onClose={() => setActivityOpen(false)}
              value={activityLevel}
              onFocus={triggerActivityTip}
              onChange={e => setActivityLevel(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>Select your activity level</MenuItem>
              {activityOptions.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Goal Type
            </Typography>
            <Select
              open={goalTypeOpen}
              onOpen={() => setGoalTypeOpen(true)}
              onClose={() => setGoalTypeOpen(false)}
              value={goalType}
              onFocus={triggerGoalTypeTip}
              onChange={e => setGoalType(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>Select your goal</MenuItem>
              {goalTypes.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </Box>

          {/* ✅ Recommendation card */}
          <Paper
            elevation={0}
            sx={{
              p: 2,
              mt: 1,
              mb: 2,
              borderRadius: 2,
              bgcolor: 'rgba(2,6,23,0.04)',
              border: '1px solid rgba(2,6,23,0.10)'
            }}
          >
            <Typography sx={{ fontWeight: 900 }}>
              Recommended Daily Calories
            </Typography>

            {showRecommendation ? (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Estimated BMR: <strong>{bmr}</strong> kcal/day • Estimated TDEE: <strong>{tdee}</strong> kcal/day
                </Typography>
                <Typography sx={{ mt: 0.8, fontWeight: 950, fontSize: 20 }}>
                  {recommendedDailyCalories} kcal/day
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.4 }}>
                  Includes your activity level + a {goalType === 'cutting' ? 'deficit' : goalType === 'bulking' ? 'surplus' : 'neutral'} adjustment.
                </Typography>

                <Button
                  variant="contained"
                  onClick={handleUseRecommendation}
                  sx={{ mt: 1.2, fontWeight: 950, borderRadius: 999 }}
                >
                  Use Recommendation
                </Button>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
                Fill out age, gender, height, weight, activity, and goal type to see a recommendation.
              </Typography>
            )}
          </Paper>

          <Box sx={{ mb: 2 }}>
            <TextField
              label="Daily Calorie Goal"
              type="number"
              value={dailyGoal}
              onFocus={triggerGoalTip}
              onChange={e => setDailyGoal(e.target.value)}
              fullWidth
              required
              helperText="You can use the recommendation above or set your own target."
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Diet Preference
            </Typography>
            <Select
              open={dietOpen}
              onOpen={() => setDietOpen(true)}
              onClose={() => setDietOpen(false)}
              value={dietPreference}
              onFocus={triggerDietPrefTip}
              onChange={e => setDietPreference(e.target.value)}
              fullWidth
            >
              {dietOptions.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Training Intent
            </Typography>
            <Select
              open={trainingOpen}
              onOpen={() => setTrainingOpen(true)}
              onClose={() => setTrainingOpen(false)}
              value={trainingIntent}
              onFocus={triggerTrainingIntentTip}
              onChange={e => setTrainingIntent(e.target.value)}
              fullWidth
            >
              {trainingIntentOptions.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Training Split
            </Typography>
            <Select
              open={splitOpen}
              onOpen={() => setSplitOpen(true)}
              onClose={() => setSplitOpen(false)}
              value={trainingSplit}
              onChange={e => setTrainingSplit(e.target.value)}
              fullWidth
            >
              {splitOptions.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Current Focus
            </Typography>
            <Select
              open={focusOpen}
              onOpen={() => setFocusOpen(true)}
              onClose={() => setFocusOpen(false)}
              value={lastFocus}
              onChange={e => setLastFocus(e.target.value)}
              fullWidth
            >
              {focusOptions.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Equipment Available
            </Typography>
            <Select
              multiple
              open={equipOpen}
              onOpen={() => setEquipOpen(true)}
              onClose={() => setEquipOpen(false)}
              value={equipment}
              onChange={(e) => {
                const v = e.target.value;
                setEquipment(typeof v === 'string' ? v.split(',') : v);
              }}
              renderValue={(selected) => (Array.isArray(selected) ? selected.join(', ') : '')}
              fullWidth
            >
              {equipmentOptions.map((name) => (
                <MenuItem key={name} value={name}>
                  <Checkbox checked={equipment.indexOf(name) > -1} />
                  <ListItemText primary={name} />
                </MenuItem>
              ))}
            </Select>
          </Box>

          {/* Targets preview */}
          <Paper
            elevation={0}
            sx={{
              p: 2,
              mt: 2,
              mb: 2,
              borderRadius: 2,
              bgcolor: 'rgba(2,6,23,0.03)',
              border: '1px solid rgba(2,6,23,0.08)'
            }}
          >
            <Typography sx={{ fontWeight: 900 }}>
              Targets Preview
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Protein: ~{previewProteinDailyG}g/day (~{previewProteinMealG}g/meal)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Calorie bias (used by evaluation/coach): {goalToCalorieBias(goalType)} kcal
            </Typography>
          </Paper>

          <Button type="submit" variant="contained" fullWidth sx={{ mt: 1, fontWeight: 900 }}>
            Save & Continue
          </Button>
        </form>
      </Paper>
    </Container>
  );
}
