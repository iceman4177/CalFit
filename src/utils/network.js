// src/utils/network.js
export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}
