import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Switch, Link } from 'react-router-dom';
import { Container, Box, Typography, Button, Stack } from '@mui/material';
import HealthDataForm from './HealthDataForm';
import WorkoutPage from './WorkoutPage';
import WorkoutHistory from './WorkoutHistory';
import ProgressDashboard from './ProgressDashboard';
import Achievements from './Achievements';

function App() {
  const [userData, setUserData] = useState(null);

  // Load user data from localStorage on mount
  useEffect(() => {
    const storedData = localStorage.getItem('userData');
    if (storedData) {
      setUserData(JSON.parse(storedData));
    }
  }, []);

  return (
    <Router>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h2" color="primary">
            CalFit Tracker
          </Typography>
          <Typography variant="body1" color="textSecondary">
            Track your workouts, calories, and sauna sessions!
          </Typography>
          {/* Navigation Buttons */}
          <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 2 }}>
            <Button variant="contained" component={Link} to="/workout">
              Workout
            </Button>
            <Button variant="outlined" component={Link} to="/history">
              History
            </Button>
            <Button variant="outlined" component={Link} to="/dashboard">
              Dashboard
            </Button>
            <Button variant="outlined" component={Link} to="/achievements">
              Achievements
            </Button>
          </Stack>
        </Box>

        <Switch>
          <Route exact path="/" render={() => <HealthDataForm setUserData={setUserData} />} />
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
          <Route path="/history" component={WorkoutHistory} />
          <Route path="/dashboard" component={ProgressDashboard} />
          <Route path="/achievements" component={Achievements} />
        </Switch>
      </Container>
    </Router>
  );
}

export default App;
