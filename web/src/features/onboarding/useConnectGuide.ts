// Open/closed state for the Overview "Connect your plant" guide, per browser.
// Shared so the Overview header can reopen the guide after it is hidden.

import { useState } from 'react';

const HIDE_KEY = 'wds.connectGuide.hidden';

function readHidden(): boolean {
  try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}

export function useConnectGuide() {
  const [hidden, setHidden] = useState(readHidden);
  const set = (h: boolean) => {
    try { localStorage.setItem(HIDE_KEY, h ? '1' : '0'); } catch { /* session-only */ }
    setHidden(h);
  };
  return { hidden, hide: () => set(true), show: () => set(false) };
}
