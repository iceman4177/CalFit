import React from 'react';

const WorkoutSummary = ({
  cumulativeExercises,
  cumulativeTotal,
  onRemoveExercise,
  onClearAll,
  onNewWorkout
}) => {
  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', marginTop: '20px' }}>
      <h2>Workout Summary</h2>
      {cumulativeExercises.map((ex, idx) => {
        const safeCalories = ex.calories ?? 0;
        return (
          <div key={idx}>
            <p>
              {ex.exerciseName || ex.exerciseType} - {safeCalories.toFixed(2)} cals
              <button onClick={() => onRemoveExercise(idx)} style={{ marginLeft: '10px' }}>
                Remove
              </button>
            </p>
          </div>
        );
      })}

      <h3>Total Calories Burned: {(cumulativeTotal ?? 0).toFixed(2)}</h3>

      {cumulativeExercises.length > 0 && (
        <button onClick={onClearAll} style={{ marginTop: '10px', marginRight: '10px' }}>
          Clear All Exercises
        </button>
      )}

      {/* Start a new workout */}
      <button onClick={onNewWorkout} style={{ marginTop: '10px' }}>
        Start New Workout
      </button>
    </div>
  );
};

export default WorkoutSummary;
