import React, { useEffect } from 'react';

const ExerciseForm = ({
  newExercise,
  setNewExercise,
  currentCalories,
  setCurrentCalories,
  onAddExercise,
  onFinishWorkout,
  exerciseOptions
}) => {
  // Persist newExercise state to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('newExerciseFields', JSON.stringify(newExercise));
  }, [newExercise]);

  // Persist currentCalories to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('currentWorkoutCalories', currentCalories.toString());
  }, [currentCalories]);

  // Helper: Calculate calories for the new exercise (including sets)
  const calculateCalories = (exercise) => {
    const w = parseFloat(exercise.weight) || 0;
    const s = parseInt(exercise.sets) || 1; // default to 1 if not provided
    const r = parseInt(exercise.reps) || 0;
    let cals = w * s * r * 0.05;
    if (exercise.exerciseType === 'machine') {
      cals *= 1.5;
    } else if (exercise.exerciseType === 'dumbbell' || exercise.exerciseType === 'barbell') {
      cals *= 1.2;
    }
    return cals;
  };

  const handleCalculate = (e) => {
    e.preventDefault();
    const cals = calculateCalories(newExercise);
    setCurrentCalories(cals);
  };

  return (
    <div>
      <h3>Add New Exercise</h3>
      <form>
        <div>
          <label>Exercise Type:</label>
          <select
            value={newExercise.exerciseType}
            onChange={(e) =>
              setNewExercise({ ...newExercise, exerciseType: e.target.value, exerciseName: '' })
            }
            required
          >
            <option value="">Select Exercise Type</option>
            <option value="machine">Machine</option>
            <option value="dumbbell">Dumbbell</option>
            <option value="barbell">Barbell</option>
          </select>
        </div>
        {newExercise.exerciseType && (
          <div>
            <label>Select Exercise:</label>
            <select
              value={newExercise.exerciseName}
              onChange={(e) => setNewExercise({ ...newExercise, exerciseName: e.target.value })}
              required
            >
              <option value="">Select Exercise</option>
              {newExercise.exerciseType === 'machine'
                ? exerciseOptions.machine.map((ex, idx) => (
                    <option key={idx} value={ex}>
                      {ex}
                    </option>
                  ))
                : newExercise.exerciseType === 'dumbbell'
                ? exerciseOptions.dumbbell.map((ex, idx) => (
                    <option key={idx} value={ex}>
                      {ex}
                    </option>
                  ))
                : exerciseOptions.barbell.map((ex, idx) => (
                    <option key={idx} value={ex}>
                      {ex}
                    </option>
                  ))}
            </select>
          </div>
        )}
        <div>
          <label>
            {newExercise.exerciseType === 'dumbbell'
              ? 'Weight (lbs per dumbbell):'
              : 'Weight (lbs):'}
          </label>
          <input
            type="number"
            value={newExercise.weight}
            onChange={(e) => setNewExercise({ ...newExercise, weight: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Sets:</label>
          <input
            type="number"
            value={newExercise.sets}
            onChange={(e) => setNewExercise({ ...newExercise, sets: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Reps:</label>
          <input
            type="number"
            value={newExercise.reps}
            onChange={(e) => setNewExercise({ ...newExercise, reps: e.target.value })}
            required
          />
        </div>
        <div>
          <button onClick={handleCalculate}>Calculate Calories Burned</button>
          <button onClick={onAddExercise}>Add Exercise</button>
          <button onClick={onFinishWorkout}>Finish Workout</button>
        </div>
      </form>
      <div>
        <h3>New Exercise Calories: {currentCalories.toFixed(2)}</h3>
      </div>
    </div>
  );
};

export default ExerciseForm;
