import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function Layout() {
  const { user, signOut } = useAuth();

  // Underline navigation, not pills — the header should read like a masthead.
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `border-b-2 px-1 pt-0.5 pb-2 -mb-[13px] text-sm font-medium transition ${
      isActive
        ? 'border-accent text-ink'
        : 'border-transparent text-muted hover:text-ink'
    }`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-3">
          <span className="mr-3 font-serif text-lg font-semibold">
            Career Intelligence
          </span>

          <NavLink to="/documents" className={linkClass}>
            Documents
          </NavLink>
          <NavLink to="/sessions" className={linkClass}>
            Comparisons
          </NavLink>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">
              {user?.email}
            </span>
            <button
              onClick={signOut}
              className="text-sm text-muted transition hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
