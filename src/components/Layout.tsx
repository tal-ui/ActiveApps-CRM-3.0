import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Banknote,
  CalendarRange,
  Calculator,
  LayoutDashboard,
  LayoutPanelLeft,
  LogOut,
  Slack,
  SlidersHorizontal,
} from "lucide-react";
import { NAV_OBJECTS, OBJECTS } from "../lib/objects";
import { useAuth } from "../lib/auth";
import TimerWidget from "./TimerWidget";
import ThemeToggle from "./ThemeToggle";

export default function Layout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "flex items-center gap-3 px-3 py-2 bg-[rgba(60,201,152,0.08)] border-l-2 border-[var(--mint)] rounded-r-[var(--radius-sm)] text-[var(--mint)] text-sm font-medium cursor-pointer"
      : "flex items-center gap-3 px-3 py-2 border-l-2 border-transparent text-[var(--text-dim)] text-sm cursor-pointer transition-colors duration-200 hover:text-[var(--foreground)] hover:bg-[var(--navy-surface)] rounded-[var(--radius-sm)]";

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <aside className="w-60 bg-[var(--navy)] border-r border-[var(--sidebar-border)] h-screen fixed flex flex-col z-40">
        <div className="p-5 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2.5 mb-1">
            <img src="/aa-logo.png" alt="ActiveApps" className="w-7 h-7 rounded" />
            <div>
              <span className="font-[var(--font-heading)] font-bold text-[var(--text-light)]">
                ACTIVE
              </span>
              <span className="font-[var(--font-heading)] font-bold text-[var(--mint)]">
                APPS
              </span>
            </div>
          </div>
          <p className="label-mono text-[var(--text-muted)] mb-7 ml-[38px]">CRM 3.0</p>

          <nav className="space-y-1">
            <NavLink to="/" end className={navItemClass}>
              <LayoutDashboard size={16} strokeWidth={1.5} />
              Dashboard
            </NavLink>
            <NavLink to="/financial" className={navItemClass}>
              <Banknote size={16} strokeWidth={1.5} />
              Financial
            </NavLink>
            <NavLink to="/monthly" className={navItemClass}>
              <CalendarRange size={16} strokeWidth={1.5} />
              Monthly Ops
            </NavLink>
            <NavLink to="/currency" className={navItemClass}>
              <Calculator size={16} strokeWidth={1.5} />
              Currency
            </NavLink>
            {NAV_OBJECTS.map((name) => {
              const def = OBJECTS[name];
              const Icon = def.icon;
              return (
                <NavLink key={name} to={`/${name}`} className={navItemClass}>
                  <Icon size={16} strokeWidth={1.5} />
                  {def.plural}
                </NavLink>
              );
            })}

            <p className="label-mono !text-[var(--text-muted)] pt-5 pb-1 px-3">
              Settings
            </p>
            <NavLink to="/settings/custom-fields" className={navItemClass}>
              <SlidersHorizontal size={16} strokeWidth={1.5} />
              Custom Fields
            </NavLink>
            <NavLink to="/settings/layouts" className={navItemClass}>
              <LayoutPanelLeft size={16} strokeWidth={1.5} />
              Page Layouts
            </NavLink>
            <NavLink to="/settings/slack" className={navItemClass}>
              <Slack size={16} strokeWidth={1.5} />
              Slack
            </NavLink>
          </nav>
        </div>

        {/* User footer */}
        <div className="p-4 border-t border-[var(--hairline)]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-[var(--text-light)] truncate">
                {profile?.full_name || "—"}
              </p>
              <p className="text-xs text-[var(--text-faint)] truncate">
                {profile?.email}
              </p>
            </div>
            <button
              onClick={async () => {
                await signOut();
                navigate("/login");
              }}
              className="text-[var(--text-dim)] hover:text-[var(--mint)] cursor-pointer transition-colors p-1.5"
              title="Sign out"
            >
              <LogOut size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="ml-60 min-h-screen">
        {/* Sticky header with global timer */}
        <header className="sticky top-0 z-30 backdrop-blur-xl bg-[var(--header-bg)] border-b border-[var(--sidebar-border)]">
          <div className="max-w-[1280px] mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
            <span className="label-mono">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </span>
            <div className="flex items-center gap-3">
              <TimerWidget />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
