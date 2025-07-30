// src/utils/workoutRecommender.js

/**
 * Stubbed AI workout recommender.
 * Returns an array of 1–N workouts based on userData.
 */
export function recommendWorkout(userData) {
    // pull their goal off userData (you may store it in setUserData)
    const goal = userData.fitnessGoal || 'maintenance'; // 'bulk' | 'cut' | 'maintenance'
  
    // choose a name based on goal
    const workoutName =
      goal === 'bulk'
        ? 'Upper Body Hypertrophy'
        : goal === 'cut'
        ? 'High‑Volume Upper Body'
        : 'Balanced Upper Body';
  
    // example exercise list
    const exercises = [
      {
        exerciseType:    'barbell',
        exerciseName:    'Barbell Bench Press',
        weight:          Math.round((userData.weight || 150) * 0.6),
        sets:            4,
        reps:            goal === 'cut' ? 12 : 8,
        concentricTime:  2,
        eccentricTime:   3
      },
      {
        exerciseType:    'dumbbell',
        exerciseName:    'Dumbbell Row (One‑Arm Row)',
        weight:          Math.round((userData.weight || 150) * 0.4),
        sets:            4,
        reps:            goal === 'cut' ? 12 : 8,
        concentricTime:  2,
        eccentricTime:   2
      },
      {
        exerciseType:    'machine',
        exerciseName:    'Chest Press Machine',
        weight:          Math.round((userData.weight || 150) * 0.5),
        sets:            3,
        reps:            10,
        concentricTime:  2,
        eccentricTime:   2
      }
    ];
  
    return [
      {
        name:      workoutName,
        exercises
      }
    ];
  }
  