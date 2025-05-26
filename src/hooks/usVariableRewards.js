// src/hooks/useVariableRewards.js

import { useEffect } from 'react';

const BADGE_POOL = [
  { id: 'lucky-star',    name: 'Lucky Star',       description: 'A shining random badge!',           icon: '⭐' },
  { id: 'golden-boot',   name: 'Golden Boot',      description: 'Awarded for unexpected greatness!',  icon: '🥇' },
  { id: 'mystery-box',   name: 'Mystery Box',      description: 'You never know what’s inside!',     icon: '🎁' },
  { id: 'power-punch',   name: 'Power Punch',      description: 'Delivered an extra punch of effort!',icon: '👊' },
  { id: 'steady-logger', name: 'Steady Logger',    description: 'Consistent logs reward steady progress!', icon: '📅' },
];

export default function useVariableRewards({
  workoutsCount,
  mealsCount,
  rollChance = 0.05
}) {
  useEffect(() => {
    const total = workoutsCount + mealsCount;
    const prevTotal = parseInt(localStorage.getItem('lastTotalLogs') || '0', 10);

    if (total > prevTotal) {
      // add a “pity timer” boost of +1% per extra log, max 20%
      const chance = Math.min(rollChance + ((total - prevTotal - 1) * 0.01), 0.20);

      if (Math.random() < chance) {
        const randomBadges = JSON.parse(localStorage.getItem('randomBadges') || '[]');
        const available = BADGE_POOL.filter(b => !randomBadges.some(rb => rb.id === b.id));

        if (available.length > 0) {
          const badge = available[Math.floor(Math.random() * available.length)];
          const updated = [...randomBadges, { ...badge, random: true }];
          localStorage.setItem('randomBadges', JSON.stringify(updated));
        }
      }

      localStorage.setItem('lastTotalLogs', total.toString());
    }
  }, [workoutsCount, mealsCount, rollChance]);
}
