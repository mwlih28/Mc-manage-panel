import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function PanelLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-60 min-h-screen">
        <div className="p-6 lg:p-8 max-w-screen-xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
