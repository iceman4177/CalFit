import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom'; // For React Router v5

function HealthDataForm({ setUserData }) {
  const history = useHistory();

  // Local state for health data
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [activityLevel, setActivityLevel] = useState('');

  // On mount, load saved health data from localStorage (if available)
  useEffect(() => {
    const savedData = localStorage.getItem('userData');
    if (savedData) {
      const parsed = JSON.parse(savedData);
      setAge(parsed.age || '');
      setWeight(parsed.weight || '');
      setHeightFeet(parsed.height?.feet || '');
      setHeightInches(parsed.height?.inches || '');
      setActivityLevel(parsed.activityLevel || '');
    }
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    const userData = {
      age,
      weight,
      height: { feet: heightFeet, inches: heightInches },
      activityLevel,
    };
    // Save to localStorage and update state
    localStorage.setItem('userData', JSON.stringify(userData));
    setUserData(userData);

    // Remove any finished flag from previous sessions
    localStorage.removeItem('workoutFinished');

    // Navigate to the Workout page
    history.push('/workout');
  };

  return (
    <div className="health-data-form">
      <h2>Enter Your Health Information</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Age:</label>
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Weight (lbs):</label>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Height (feet):</label>
          <input
            type="number"
            value={heightFeet}
            onChange={(e) => setHeightFeet(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Height (inches):</label>
          <input
            type="number"
            value={heightInches}
            onChange={(e) => setHeightInches(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Activity Level:</label>
          <select
            value={activityLevel}
            onChange={(e) => setActivityLevel(e.target.value)}
            required
          >
            <option value="">Select Activity Level</option>
            <option value="sedentary">Sedentary</option>
            <option value="light">Light Exercise</option>
            <option value="moderate">Moderate Exercise</option>
            <option value="intense">Intense Exercise</option>
          </select>
        </div>
        <button type="submit">Save Health Data</button>
      </form>
    </div>
  );
}

export default HealthDataForm;
