// src/hooks/useVariableRewards.js

import { useEffect } from 'react';

const BADGE_POOL = [
  { id: 'lucky_star',    name: 'Lucky Star',       description: 'A shining random badge!',           icon: '⭐' },
  { id: 'golden_boot',   name: 'Golden Boot',      description: 'Awarded for unexpected greatness!',  icon: '🥇' },
  { id: 'mystery_box',   name: 'Mystery Box',      description: 'You never know what’s inside!',     icon: '🎁' },
  { id: 'power_punch',   name: 'Power Punch',      description: 'Delivered an extra punch of effort!',icon: '👊' },
  { id: 'steady_logger', name: 'Steady Logger',    description: 'Consistent logs reward steady progress!', icon: '📅' },
];

export default function useVariableRewards({
  workoutsCount,
  mealsCount,
  rollChance = 0.05
}) {
  useEffect(() => {
    const totalLogs = workoutsCount + mealsCount;
    const prevTotal = parseInt(localStorage.getItem('lastTotalLogs') || '0', 10);

    if (totalLogs > prevTotal) {
      // “pity timer”: +1% per extra log, up to 20%
      const chance = Math.min(rollChance + ((totalLogs - prevTotal - 1) * 0.01), 0.20);

      if (Math.random() < chance) {
        const earned = JSON.parse(localStorage.getItem('randomBadges') || '[]');
        const available = BADGE_POOL.filter(b => !earned.some(e => e.id === b.id));

        if (available.length > 0) {
          const badge = available[Math.floor(Math.random() * available.length)];
          earned.push({ ...badge, random: true });
          localStorage.setItem('randomBadges', JSON.stringify(earned));
        }
      }

      localStorage.setItem('lastTotalLogs', String(totalLogs));
    }
  }, [workoutsCount, mealsCount, rollChance]);
}
