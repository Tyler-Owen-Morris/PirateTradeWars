import { create } from "zustand";

/** Whether keyboard auto-sail is engaged (written by Player.tsx, read by AutoSailIndicator). */
export const useAutoSail = create<{ active: boolean; setActive: (a: boolean) => void }>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
