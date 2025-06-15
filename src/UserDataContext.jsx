// src/UserDataContext.jsx
import React, { createContext, useState, useEffect } from 'react';

export const UserDataContext = createContext({
  dailyGoal: 0,
  goalType: 'maintain',
  recentMeals: []
});

export function UserDataProvider({ children }) {
  const [settings, setSettings] = useState({
    dailyGoal: 0,
    goalType: 'maintain',
    recentMeals: []
  });

  useEffect(() => {
    const ud = JSON.parse(localStorage.getItem('userData') || '{}');
    const dg = ud.dailyGoal   || 0;
    const gt = ud.goalType    || 'maintain';
    const shown = JSON.parse(localStorage.getItem('shownMeals') || '{}');
    const rec   = shown.date === new Date().toLocaleDateString() ? shown.names : [];
    setSettings({ dailyGoal: dg, goalType: gt, recentMeals: rec });
  }, []);

  return (
    <UserDataContext.Provider value={settings}>
      {children}
    </UserDataContext.Provider>
  );
}
