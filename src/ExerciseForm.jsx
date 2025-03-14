import React, { useState, useEffect } from 'react';
import Select from 'react-select';

const ExerciseForm = ({
  newExercise,
  setNewExercise,
  currentCalories,
  setCurrentCalories,
  onAddExercise,
  onFinishWorkout,
  exerciseOptions
}) => {
  // Local state to control the open/close state of the react-select dropdown
  const [menuIsOpen, setMenuIsOpen] = useState(false);

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

  // Format options for react-select as { label, value }
  const formatOptions = (optionsArray) =>
    optionsArray.map((option) => ({ label: option, value: option }));

  const getExerciseOptions = () => {
    if (!newExercise.exerciseType) return [];
    if (newExercise.exerciseType === 'machine')
      return formatOptions(exerciseOptions.machine);
    if (newExercise.exerciseType === 'dumbbell')
      return formatOptions(exerciseOptions.dumbbell);
    if (newExercise.exerciseType === 'barbell')
      return formatOptions(exerciseOptions.barbell);
    return [];
  };

  return (
    <div>
      <h3>Add New Exercise</h3>
      <form>
        <div>
          <label>Exercise Type:</label>
          <select
            value={newExercise.exerciseType}
            onChange={(e) => {
              setNewExercise({
                ...newExercise,
                exerciseType: e.target.value,
                exerciseName: ''
              });
              setMenuIsOpen(false); // close dropdown if type changes
            }}
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
            <Select
              menuIsOpen={menuIsOpen}
              onMenuOpen={() => setMenuIsOpen(true)}
              onMenuClose={() => setMenuIsOpen(false)}
              value={
                newExercise.exerciseName
                  ? { label: newExercise.exerciseName, value: newExercise.exerciseName }
                  : null
              }
              onChange={(selectedOption) => {
                setNewExercise({ ...newExercise, exerciseName: selectedOption.value });
                setMenuIsOpen(false); // close dropdown on selection
              }}
              options={getExerciseOptions()}
              placeholder="Select Exercise"
            />
          </div>
        )}
        <div>
          <label>Weight (lbs):</label>
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
