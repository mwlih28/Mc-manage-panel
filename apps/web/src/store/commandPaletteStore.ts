import { create } from 'zustand';

interface CommandPaletteState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

// Deliberately not persisted — the palette is always closed on load. Kept in
// a tiny global store (rather than local layout state) so anything, anywhere
// can open it: the sidebar's search button, a future "?" help menu, or a
// per-page "run a command" affordance, without prop-drilling a setter.
export const useCommandPalette = create<CommandPaletteState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
