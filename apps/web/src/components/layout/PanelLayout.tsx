import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { useCommandPaletteHotkey } from '@/hooks/useCommandPaletteHotkey';

export function PanelLayout() {
  useCommandPaletteHotkey();
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-64 min-h-screen">
        <div className="p-6 lg:p-8 max-w-screen-xl">
          <Outlet />
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
