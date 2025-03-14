import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import HealthDataForm from './HealthDataForm';
import WorkoutPage from './WorkoutPage';

function App() {
  const [userData, setUserData] = useState(null);

  // On mount, load saved health data from localStorage (if available)
  useEffect(() => {
    const storedData = localStorage.getItem('userData');
    if (storedData) {
      setUserData(JSON.parse(storedData));
    }
  }, []);

  return (
    <Router>
      <div className="App">
        <Switch>
          <Route
            path="/"
            exact
            render={() => <HealthDataForm setUserData={setUserData} />}
          />
          <Route
            path="/workout"
            render={() =>
              userData ? (
                <WorkoutPage userData={userData} />
              ) : (
                <HealthDataForm setUserData={setUserData} />
              )
            }
          />
        </Switch>
      </div>
    </Router>
  );
}

export default App;
