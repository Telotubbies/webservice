// Command-palette seam (v4 T11). The Shell wires the ⌘K / Ctrl+K listener to
// this signal; the panel itself is a placeholder until T12 ships the real
// palette — this module is the stable contract.

import { useSyncExternalStore } from 'react';

let openState = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const palette = {
  isOpen: () => openState,
  open() {
    if (openState) return;
    openState = true;
    emit();
  },
  close() {
    if (!openState) return;
    openState = false;
    emit();
  },
  toggle() {
    if (openState) palette.close();
    else palette.open();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(palette.subscribe, palette.isOpen, () => false);
}
