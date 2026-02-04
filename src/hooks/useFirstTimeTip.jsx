// src/hooks/useFirstTimeTip.jsx
// NOTE: Field/tool tip dialogs have been fully disabled (UX request).
// This hook is kept for API compatibility across the codebase.
import React from 'react';

/**
 * Hook for one-off tip dialogs, with optional post-close callback.
 *
 * @param {string} storageKey – localStorage key to mark tip as seen.
 * @param {string} message    – text to show in the tip.
 * @param {{auto?:boolean}} options – if auto=true, shows immediately on mount.
 * @returns {[TipComponent: React.FC, trigger(afterClose?:()=>void):void]}
 */
export default function useFirstTimeTip(
  storageKey,
  message,
  { auto = false } = {}
) {
  // Tips disabled: always render nothing, and trigger immediately continues.
  function Tip() {
    return null;
  }

  const trigger = (afterClose) => {
    if (typeof afterClose === 'function') afterClose();
  };

  return [Tip, trigger];
}
