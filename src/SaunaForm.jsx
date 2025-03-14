import React, { useEffect } from 'react';

const SaunaForm = ({
  saunaTime,
  saunaTemp,
  setSaunaTime,
  setSaunaTemp,
  onAddSauna,
  onSkipSauna
}) => {
  // Persist sauna fields in sessionStorage
  useEffect(() => {
    sessionStorage.setItem('saunaTime', saunaTime);
  }, [saunaTime]);

  useEffect(() => {
    sessionStorage.setItem('saunaTemp', saunaTemp);
  }, [saunaTemp]);

  return (
    <div>
      <h2>Sauna Session</h2>
      <p>Optional: Enter your sauna session details to add to your calorie burn.</p>
      <form>
        <div>
          <label>Time in Sauna (minutes):</label>
          <input
            type="number"
            value={saunaTime}
            onChange={(e) => setSaunaTime(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Temperature (°F):</label>
          <input
            type="number"
            value={saunaTemp}
            onChange={(e) => setSaunaTemp(e.target.value)}
            required
          />
        </div>
        <div>
          {/* IMPORTANT: pass saunaTime and saunaTemp to onAddSauna */}
          <button onClick={(e) => onAddSauna(e, saunaTime, saunaTemp)}>
            Add Sauna Session
          </button>
          <button onClick={onSkipSauna}>Skip Sauna</button>
        </div>
      </form>
    </div>
  );
};

export default SaunaForm;
