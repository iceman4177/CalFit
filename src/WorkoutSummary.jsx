import React from 'react';

const WorkoutSummary = ({
  cumulativeExercises,
  cumulativeTotal,
  onRemoveExercise,
  onClearAll,
}) => {
  return (
    <div>
      <h2>Workout Summary</h2>
      {cumulativeExercises.map((ex, idx) => {
        // Safely handle null or undefined calories
        const safeCalories = ex.calories ?? 0;
        return (
          <div key={idx}>
            <p>
              {ex.exerciseType} - {ex.exerciseName}: {safeCalories.toFixed(2)} cals
              <button onClick={() => onRemoveExercise(idx)} style={{ marginLeft: '10px' }}>
                Remove
              </button>
            </p>
          </div>
        );
      })}

      <h3>Total Calories Burned: {(cumulativeTotal ?? 0).toFixed(2)}</h3>

      {cumulativeExercises.length > 0 && (
        <button onClick={onClearAll} style={{ marginTop: '10px' }}>
          Clear All Exercises
        </button>
      )}
    </div>
  );
};

export default WorkoutSummary;
