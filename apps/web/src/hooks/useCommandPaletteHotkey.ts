import { useEffect } from 'react';
import { useCommandPalette } from '@/store/commandPaletteStore';

// Global ⌘K / Ctrl+K to toggle the command palette. Also supports "/" as a
// quick-open when the user isn't already typing in a field, matching the
// convention in GitHub/Linear. Mounted once, from PanelLayout.
export function useCommandPaletteHotkey() {
  const toggle = useCommandPalette((s) => s.toggle);
  const open = useCommandPalette((s) => s.open);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
        return;
      }
      // Bare "/" opens the palette, but only when the user isn't mid-typing
      // somewhere else (a console input, a form field, etc.).
      if (e.key === '/' && !typing) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle, open]);
}
