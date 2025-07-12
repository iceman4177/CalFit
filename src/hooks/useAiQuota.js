import { useState, useEffect } from 'react';
import { useUserData } from '../UserDataContext.jsx';

export default function useAiQuota() {
  // Pull in the user data we need
  const { dailyGoal, goalType, recentMeals } = useUserData();

  const [quota, setQuota] = useState(0);

  useEffect(() => {
    // Example: load today's AI usage count from localStorage
    const todayKey = new Date().toLocaleDateString('en-US');
    const stored   = JSON.parse(localStorage.getItem('recapUsage') || '{}');
    const count    = stored.date === todayKey ? stored.count : 0;
    setQuota(count);
  }, []);

  return { dailyGoal, goalType, recentMeals, quota };
}
