import { Outlet } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';

export function AdminLayout() {
  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 min-w-0 ml-64 min-h-screen">
        <div className="p-6 lg:p-8 max-w-screen-xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
