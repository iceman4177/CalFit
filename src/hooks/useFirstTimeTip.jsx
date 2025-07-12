// src/hooks/useFirstTimeTip.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography
} from '@mui/material';

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
  const [open, setOpen] = useState(false);
  const callbackRef = useRef(null);

  // Auto-show on mount if requested
  useEffect(() => {
    if (auto && message && !localStorage.getItem(storageKey)) {
      setOpen(true);
      localStorage.setItem(storageKey, 'true');
    }
  }, [storageKey, message, auto]);

  /**
   * Manually trigger the tip, and optionally run a callback after close.
   * @param {()=>void} afterClose
   */
  const trigger = (afterClose) => {
    if (!localStorage.getItem(storageKey) && message) {
      if (typeof afterClose === 'function') {
        callbackRef.current = afterClose;
      }
      setOpen(true);
      localStorage.setItem(storageKey, 'true');
    } else {
      if (typeof afterClose === 'function') {
        afterClose();
      }
    }
  };

  const handleClose = () => {
    setOpen(false);
    if (typeof callbackRef.current === 'function') {
      callbackRef.current();
      callbackRef.current = null;
    }
  };

  function Tip() {
    return (
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>Tip</DialogTitle>
        <DialogContent>
          <Typography>{message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Got it</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return [Tip, trigger];
}
