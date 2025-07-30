// __tests__/workoutRecommender.test.js
import { recommendWorkout } from '../src/utils/workoutRecommender';

describe('recommendWorkout util', () => {
  const mockUser = {
    age: 30,
    weight: 180,
    height: { feet: 5, inches: 10 },
    activityLevel: 'moderate',
    dailyGoal: 2500,
    goalType: 'maintenance'
  };

  test('returns a non‑empty array', () => {
    const result = recommendWorkout(mockUser);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test('each workout has a name and exercise list', () => {
    const [workout] = recommendWorkout(mockUser);
    expect(typeof workout.name).toBe('string');
    expect(Array.isArray(workout.exercises)).toBe(true);
    expect(workout.exercises.length).toBeGreaterThan(0);
  });
});
